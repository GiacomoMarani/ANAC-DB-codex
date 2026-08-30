"use client"

/**
 * app/codici-cpv/page.tsx
 * Ricerca semantica dei codici CPV (Vocabolario Comune per gli Appalti).
 *
 * Dati: vocabolario ufficiale CPV 2008 (Regolamento CE 213/2008), 9.454 codici,
 * scaricato da ted.europa.eu — non dipende da servizi terzi.
 * Ricerca: embedding testuale con Xenova/multilingual-e5-small (modello open-source,
 * eseguito interamente nel browser via @huggingface/transformers — nessun dato
 * inviato a un server). Gli embedding dei 9.454 codici sono precalcolati in
 * /public/cpv/cpv-vectors.bin; solo la query dell'utente viene calcolata al volo.
 *
 * NOTA: il modello (~118MB) viene scaricato dalla CDN di Hugging Face al primo
 * utilizzo e resta in cache nel browser (IndexedDB) per le visite successive.
 */

import { useState, useRef, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { Search, Loader2, Copy, Check, FileSearch2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ─── Tipi ──────────────────────────────────────────────────────────────────

interface CpvIndex {
  divisions: Record<string, string>
  items: [code: string, labelIt: string, labelEn: string][]
}

interface CpvVectorsMeta {
  model: string
  dims: number
  count: number
  scale: number
  dtype: string
  queryPrefix: string
  docPrefix: string
}

interface CpvResult {
  code: string
  labelIt: string
  division: string
  score: number
}

type Status = "idle" | "loading-model" | "searching" | "done" | "error"

// ─── Cache a livello di modulo (evita di ricaricare tra una ricerca e l'altra) ──

let cachedIndex: CpvIndex | null = null
let cachedVectors: Int8Array | null = null
let cachedMeta: CpvVectorsMeta | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedExtractor: any = null

async function loadData(): Promise<{ index: CpvIndex; vectors: Int8Array; meta: CpvVectorsMeta }> {
  if (cachedIndex && cachedVectors && cachedMeta) {
    return { index: cachedIndex, vectors: cachedVectors, meta: cachedMeta }
  }
  const [index, meta, vecBuf] = await Promise.all([
    fetch("/cpv/cpv-index.json").then(r => r.json()) as Promise<CpvIndex>,
    fetch("/cpv/cpv-vectors.json").then(r => r.json()) as Promise<CpvVectorsMeta>,
    fetch("/cpv/cpv-vectors.bin").then(r => r.arrayBuffer()),
  ])
  const vectors = new Int8Array(vecBuf)
  cachedIndex = index
  cachedVectors = vectors
  cachedMeta = meta
  return { index, vectors, meta }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadExtractor(onProgress: (pct: number) => void): Promise<any> {
  if (cachedExtractor) return cachedExtractor
  const { pipeline } = await import("@huggingface/transformers")
  const seen = new Map<string, number>()
  cachedExtractor = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", {
    dtype: "q8",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (p: any) => {
      if (p.status === "progress" && typeof p.loaded === "number" && typeof p.total === "number" && p.total > 0) {
        seen.set(p.file ?? "?", p.loaded / p.total)
        const avg = [...seen.values()].reduce((a, b) => a + b, 0) / seen.size
        onProgress(Math.round(avg * 100))
      }
    },
  })
  return cachedExtractor
}

function cosineTopN(
  query: Float32Array,
  vectors: Int8Array,
  meta: CpvVectorsMeta,
  index: CpvIndex,
  topN: number,
): CpvResult[] {
  const { dims, scale } = meta
  const scores = new Float32Array(index.items.length)
  for (let i = 0; i < index.items.length; i++) {
    let dot = 0
    const base = i * dims
    for (let d = 0; d < dims; d++) {
      dot += query[d] * (vectors[base + d] / scale)
    }
    scores[i] = dot
  }
  const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, topN)
  return order.map(i => {
    const [code, labelIt] = index.items[i]
    return { code, labelIt, division: index.divisions[code.slice(0, 2)] ?? "", score: scores[i] }
  })
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function CodiciCpvPage() {
  const [query, setQuery]     = useState("")
  const [status, setStatus]   = useState<Status>("idle")
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<CpvResult[]>([])
  const [error, setError]     = useState("")
  const [copied, setCopied]   = useState<string | null>(null)
  const hasSearchedOnce = useRef(false)

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return

    setError("")
    setStatus(hasSearchedOnce.current ? "searching" : "loading-model")
    setProgress(0)

    try {
      const [{ index, vectors, meta }, extractor] = await Promise.all([
        loadData(),
        loadExtractor(setProgress),
      ])
      hasSearchedOnce.current = true
      setStatus("searching")

      const out = await extractor([meta.queryPrefix + q], { pooling: "mean", normalize: true })
      const embedded = out.data as Float32Array

      const top = cosineTopN(embedded, vectors, meta, index, 20)
      setResults(top)
      setStatus("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante la ricerca")
      setStatus("error")
    }
  }, [query])

  const handleCopy = useCallback(async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }, [])

  const isBusy = status === "loading-model" || status === "searching"

  return (
    <div className="min-h-screen bg-background">
      {/* ── Navbar ── */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between">
          <Link href="/gare" className="flex items-center gap-2.5 sm:gap-3 group">
            <div className="relative h-10 w-10 sm:h-11 sm:w-11 rounded-xl overflow-hidden shadow-sm ring-1 ring-black/5">
              <Image src="/logo.jpg" alt="Tender AI DB" fill className="object-cover" priority />
            </div>
            <div className="flex flex-col">
              <span className="text-base sm:text-lg font-bold tracking-tight leading-none group-hover:text-primary transition-colors">
                Tender AI DB
              </span>
              <span className="text-[11px] sm:text-xs text-blue-500 font-medium uppercase tracking-wider leading-tight">
                Motore di ricerca gare
              </span>
            </div>
          </Link>
          <Link href="/gare" className="text-xs sm:text-sm font-medium text-primary hover:underline whitespace-nowrap">
            ← Torna alle gare
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="border-b bg-gradient-to-b from-card to-background">
        <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 md:py-14">
          <div className="max-w-2xl">
            <h1 className="text-xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2 sm:mb-3">
              Cerca il codice CPV giusto
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              Descrivi a parole cosa cerchi — la ricerca capisce il significato, non solo le parole esatte.
              {" "}Vocabolario ufficiale CPV 2008 (9.454 codici), ricerca eseguita nel tuo browser.
            </p>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-3xl">
        {/* ── Search bar ── */}
        <div className="flex gap-2 mb-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="cpv-search"
              placeholder="Es. pulizia degli uffici, manutenzione ascensori, servizio mensa scolastica…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !isBusy && handleSearch()}
              className="pl-10 h-11 text-sm sm:text-base"
              disabled={isBusy}
            />
          </div>
          <Button size="lg" className="px-4 sm:px-6" onClick={handleSearch} disabled={isBusy || !query.trim()}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cerca"}
          </Button>
        </div>

        {/* ── Stato: primo caricamento modello ── */}
        {status === "loading-model" && (
          <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground space-y-2">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 shrink-0" />
              <span>Primo utilizzo: scarico il modello AI (~118MB, resta in cache nel browser per le prossime volte)…</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {status === "searching" && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cerco tra 9.454 codici…
          </p>
        )}
        {status === "error" && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* ── Risultati ── */}
        {status === "done" && (
          <div className="space-y-3 mt-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{results.length}</span> codici più rilevanti
            </p>
            {results.map(r => (
              <div key={r.code} className="border rounded-xl p-3 sm:p-4 bg-card hover:shadow-sm transition-shadow flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs sm:text-sm font-semibold text-primary">{r.code}</p>
                  <p className="text-sm mt-0.5">{r.labelIt}</p>
                  {r.division && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{r.division}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => handleCopy(r.code)}
                >
                  {copied === r.code ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === r.code ? "Copiato" : "Copia"}
                </Button>
              </div>
            ))}
          </div>
        )}

        {status === "idle" && (
          <div className="text-center py-16 text-muted-foreground">
            <FileSearch2 className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Scrivi cosa cerchi e premi Cerca per trovare il codice CPV corrispondente.</p>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Vocabolario CPV 2008 (Reg. CE 213/2008) — dati ufficiali{" "}
          <a href="https://ted.europa.eu/simap/codes-and-nomenclatures/cpv" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            TED / SIMAP
          </a>
          . Modello di ricerca:{" "}
          <a href="https://huggingface.co/Xenova/multilingual-e5-small" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            multilingual-e5-small
          </a>
          {" "}(open-source, eseguito localmente nel browser).
        </div>
      </footer>
    </div>
  )
}
