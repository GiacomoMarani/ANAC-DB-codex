"use client"

/**
 * app/codici-cpv/page.tsx
 * Browser del vocabolario CPV — struttura ricalcata da get-cato.com/risorse/codici-cpv
 * (analizzata via devtools), stile visivo nostro.
 *
 * Dati: vocabolario ufficiale CPV 2008 (Reg. CE 213/2008), 9.454 codici, scaricato da
 * ted.europa.eu. Gerarchia (divisione/gruppo/classe/categoria/sottocategoria, genitori,
 * foglie/rami) derivata autonomamente dal codice a 8 cifre — verificata: i conteggi
 * per livello (45/272/1002/2379/5756) e foglie/rami (6531/2923) combaciano esattamente
 * con quelli mostrati da ITA, confermando che la struttura è equivalente.
 *
 * Ricerca principale: full-text fuzzy su etichetta + intera gerarchia degli antenati
 * (indice a prefisso, tutto client-side, nessun download pesante) — replica il
 * comportamento osservato su ITA (es. "pulizia uffici" → centinaia/migliaia di
 * risultati con evidenziazione, non solo i top-20 semantici).
 * Ricerca per codice: corsia preferenziale per query numeriche (es. "45453000", "454",
 * "45453000-7") che fa prefix-match diretto su node.code, ispirata a elencocpv.it.
 * Ricerca AI opzionale: la ricerca semantica (Xenova/multilingual-e5-small) già
 * costruita in precedenza resta disponibile come pannello secondario on-demand.
 */

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { SiteNav } from "@/components/site-nav"
import {
  Search, ChevronRight, ChevronDown, Loader2, Copy, Check, Sparkles,
  X, ChevronLeft, LayoutGrid, ListTree, ExternalLink, ArrowLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useDebounce } from "@/hooks/use-debounce"

// ─── Tipi ──────────────────────────────────────────────────────────────────

/** [code, labelIt, level, parentCode, division, isLeaf(0|1), search] */
type RawItem = [string, string, number, string | null, string, 0 | 1, string]

interface CpvDivisionStat { code: string; label: string; total: number; groups: number }
interface CpvFullData { divisions: CpvDivisionStat[]; items: RawItem[] }

interface CpvNode {
  code: string
  label: string
  level: number
  parentCode: string | null
  division: string
  isLeaf: boolean
  search: string
}

interface LoadedData {
  divisions: CpvDivisionStat[]
  nodes: CpvNode[]
  byCode: Map<string, CpvNode>
  childrenOf: Map<string, string[]>
  index: Map<string, number[]>
}

const LEVEL_LABELS = ["", "Divisione", "Gruppo", "Classe", "Categoria", "Sottocategoria"] as const
const LEVEL_BADGE  = ["", "DIV", "GRUPPO", "CLASSE", "CAT", "SOTTO"] as const
type LeafFilter = "all" | "leaf" | "branch"

// ─── Helpers testuali ────────────────────────────────────────────────────────

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function tokenize(q: string): string[] {
  return stripAccents(q).split(/[^a-z0-9]+/).filter(w => w.length >= 2)
}

function prefixKey(word: string): string {
  return word.slice(0, 5)
}

// ─── Helpers ricerca per codice ──────────────────────────────────────────────

/**
 * Restituisce true se la query assomiglia a un codice CPV numerico:
 * almeno 2 cifre consecutive (es. "45", "454", "45453000", "45453000-7").
 */
function isCodeQuery(q: string): boolean {
  return /\d{2,}/.test(q.trim())
}

/**
 * Estrae la parte numerica pura di una query codice:
 * "45453000-7" → "45453000", "45 453" → "45453", " 90 " → "90"
 */
function normalizeCodeQuery(q: string): string {
  // Rimuove il suffisso di controllo dopo il trattino (es. "-7")
  const withoutControl = q.trim().replace(/-\d+$/, "")
  // Mantiene solo le cifre
  return withoutControl.replace(/\D/g, "")
}

/**
 * Ricerca per prefisso del codice numerico (corsia preferenziale).
 * Restituisce l'insieme degli indici dei nodi il cui codice (senza "-N")
 * inizia con il prefisso numerico estratto dalla query.
 * Restituisce null se la query non è un codice.
 */
function codeSearch(query: string, nodes: CpvNode[]): Set<number> | null {
  if (!isCodeQuery(query)) return null
  const prefix = normalizeCodeQuery(query)
  if (prefix.length < 2) return null
  const result = new Set<number>()
  nodes.forEach((n, i) => {
    // node.code è tipo "45453000-7", confrontiamo solo le prime 8 cifre
    const numericCode = n.code.replace(/-\d+$/, "")
    if (numericCode.startsWith(prefix)) result.add(i)
  })
  return result
}

// ─── Caricamento dati (cache a livello di modulo) ───────────────────────────

let cachedData: LoadedData | null = null
let cachedPromise: Promise<LoadedData> | null = null

async function loadFullData(): Promise<LoadedData> {
  if (cachedData) return cachedData
  if (cachedPromise) return cachedPromise
  cachedPromise = (async () => {
    const raw: CpvFullData = await fetch("/cpv/cpv-full.json").then(r => r.json())
    const nodes: CpvNode[] = raw.items.map(([code, label, level, parentCode, division, isLeaf, search]) => ({
      code, label, level, parentCode, division, isLeaf: isLeaf === 1, search,
    }))
    const byCode = new Map(nodes.map(n => [n.code, n]))

    const childrenOf = new Map<string, string[]>()
    for (const n of nodes) {
      if (!n.parentCode) continue
      const arr = childrenOf.get(n.parentCode)
      if (arr) arr.push(n.code)
      else childrenOf.set(n.parentCode, [n.code])
    }

    // Indice a prefisso (5 caratteri) per la ricerca full-text fuzzy
    const index = new Map<string, number[]>()
    nodes.forEach((n, i) => {
      const words = new Set(tokenize(n.search))
      for (const w of words) {
        const key = prefixKey(w)
        const arr = index.get(key)
        if (arr) arr.push(i)
        else index.set(key, [i])
      }
    })

    const data: LoadedData = { divisions: raw.divisions, nodes, byCode, childrenOf, index }
    cachedData = data
    return data
  })()
  return cachedPromise
}

// ─── Traduzioni multilingua (lazy, caricato solo quando si apre il modal) ────

interface TranslationsData {
  langs: string[]    // ["bg","cs","da","de","el","en","es","et","fi","fr","hr","hu","it","lt","lv","mt","nl","pl","pt","ro","sk","sl","sv"]
  codes: Record<string, (string | null)[]>  // "03000000" → array 23 stringhe nell'ordine di langs
}

const LANG_NAMES: Record<string, string> = {
  bg: "Bulgaro", cs: "Ceco", da: "Danese", de: "Tedesco", el: "Greco",
  en: "Inglese", es: "Spagnolo", et: "Estone", fi: "Finlandese", fr: "Francese",
  hr: "Croato", hu: "Ungherese", it: "Italiano", lt: "Lituano", lv: "Lettone",
  mt: "Maltese", nl: "Olandese", pl: "Polacco", pt: "Portoghese", ro: "Rumeno",
  sk: "Slovacco", sl: "Sloveno", sv: "Svedese",
}

let cachedTranslations: TranslationsData | null = null
let cachedTranslationsPromise: Promise<TranslationsData> | null = null

async function loadTranslations(): Promise<TranslationsData> {
  if (cachedTranslations) return cachedTranslations
  if (cachedTranslationsPromise) return cachedTranslationsPromise
  cachedTranslationsPromise = fetch("/cpv/cpv-translations.json")
    .then(r => r.json())
    .then((d: TranslationsData) => { cachedTranslations = d; return d })
  return cachedTranslationsPromise
}

function breadcrumbOf(node: CpvNode, byCode: Map<string, CpvNode>): string[] {
  const path: string[] = []
  let cur = node.parentCode ? byCode.get(node.parentCode) : undefined
  while (cur) {
    path.unshift(cur.label)
    cur = cur.parentCode ? byCode.get(cur.parentCode) : undefined
  }
  return path
}

/** Tutte le parole della query devono comparire (in etichetta o in un antenato).
 *  Se la query contiene cifre, combina i risultati con la ricerca per codice. */
function fullTextMatch(query: string, data: LoadedData): Set<number> | null {
  const words = tokenize(query)
  const codeResults = codeSearch(query, data.nodes)

  // Solo cifre (pura ricerca per codice) → usa solo codeSearch
  if (codeResults && words.every(w => /^\d+$/.test(w))) {
    return codeResults
  }

  // Ricerca testuale normale
  let textResults: Set<number> | null = null
  if (words.length > 0) {
    const sets = words.map(w => data.index.get(prefixKey(w)) ?? [])
    if (!sets.some(s => s.length === 0)) {
      const counts = new Map<number, number>()
      for (const s of sets) for (const i of s) counts.set(i, (counts.get(i) ?? 0) + 1)
      textResults = new Set<number>()
      for (const [i, c] of counts) if (c === words.length) textResults.add(i)
    } else {
      textResults = new Set()
    }
  }

  // Query mista (testo + cifre) → unione
  if (codeResults && textResults) {
    const merged = new Set(textResults)
    for (const i of codeResults) merged.add(i)
    return merged
  }

  if (codeResults) return codeResults
  return textResults
}

/** Punteggio di rilevanza:
 *  - match esatto di codice → punteggio massimo
 *  - premia i match nell'etichetta propria (non solo negli antenati) */
function scoreNode(node: CpvNode, words: string[], rawQuery: string): number {
  // Bonus match esatto codice
  if (rawQuery.trim()) {
    const prefix = normalizeCodeQuery(rawQuery)
    const numericCode = node.code.replace(/-\d+$/, "")
    if (prefix.length >= 2 && numericCode === prefix) return 1_000_000
    if (prefix.length >= 2 && numericCode.startsWith(prefix)) return 500_000 - node.code.length
  }
  if (words.length === 0) return -node.label.length
  const ownPrefixes = new Set(tokenize(node.label).map(prefixKey))
  let ownMatches = 0
  for (const w of words) if (ownPrefixes.has(prefixKey(w))) ownMatches++
  return ownMatches * 1000 - node.label.length
}

function highlight(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text
  const prefixes = words.map(prefixKey).filter(Boolean)
  const re = new RegExp(`(${prefixes.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[a-zà-ú]*`, "gi")
  const parts = text.split(re)
  return parts.map((part, i) =>
    re.test(part) && prefixes.some(p => stripAccents(part).startsWith(p))
      ? <mark key={i} className="bg-amber-200/70 dark:bg-amber-500/30 text-inherit rounded-sm px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  )
}

/** Evidenzia la porzione di codice che corrisponde al prefisso numerico cercato */
function highlightCode(code: string, rawQuery: string): ReactNode {
  if (!isCodeQuery(rawQuery)) return code
  const prefix = normalizeCodeQuery(rawQuery)
  if (!prefix || prefix.length < 2) return code
  // Separa il codice in "8 cifre" + eventuale "-N"
  const numeric = code.replace(/-\d+$/, "")
  const suffix = code.slice(numeric.length) // es. "-7" oppure ""
  if (!numeric.startsWith(prefix)) return code
  return (
    <>
      <mark className="bg-amber-200/70 dark:bg-amber-500/30 text-inherit rounded-sm px-0">{numeric.slice(0, prefix.length)}</mark>
      <span>{numeric.slice(prefix.length)}{suffix}</span>
    </>
  )
}

// ─── Componenti di supporto ──────────────────────────────────────────────────

function LevelBadge({ level }: { level: number }) {
  const colors = [
    "", "bg-blue-500/15 text-blue-700 border-blue-200",
    "bg-violet-500/15 text-violet-700 border-violet-200",
    "bg-teal-500/15 text-teal-700 border-teal-200",
    "bg-amber-500/15 text-amber-700 border-amber-200",
    "bg-rose-500/15 text-rose-700 border-rose-200",
  ]
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide shrink-0 ${colors[level]}`}>
      {LEVEL_BADGE[level]}
    </span>
  )
}

function FacetCheckbox({ label, count, checked, onChange }: {
  label: string; count: number; checked: boolean; onChange: () => void
}) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm cursor-pointer group">
      <Checkbox checked={checked} onCheckedChange={onChange} className="shrink-0" />
      <span className="flex-1 truncate group-hover:text-foreground text-foreground/90" title={label}>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
    </label>
  )
}

// ─── Componente principale ───────────────────────────────────────────────────

const PAGE_SIZE = 20

export default function CodiciCpvPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [data, setData] = useState<LoadedData | null>(null)
  const [loadError, setLoadError] = useState("")

  // Inizializza query da ?q= nell'URL
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "")
  const deferredQuery = useDebounce(query, 200)

  const [selectedDivisions, setSelectedDivisions] = useState<Set<string>>(new Set())
  const [selectedLevels, setSelectedLevels] = useState<Set<number>>(new Set())
  const [leafFilter, setLeafFilter] = useState<LeafFilter>("all")
  const [divisionsExpanded, setDivisionsExpanded] = useState(false)
  const [viewMode, setViewMode] = useState<"schede" | "albero">("schede")
  const [page, setPage] = useState(0)
  const [expandedTree, setExpandedTree] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  // Modal dettaglio codice
  const [selectedNode, setSelectedNode] = useState<CpvNode | null>(null)

  useEffect(() => {
    loadFullData().then(setData).catch(err => setLoadError(err instanceof Error ? err.message : "Errore di caricamento dati"))
  }, [])

  // Sincronizza ?q= nella URL quando la query cambia
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    const params = new URLSearchParams(searchParams.toString())
    if (deferredQuery) params.set("q", deferredQuery)
    else params.delete("q")
    const newUrl = params.size > 0 ? `${pathname}?${params.toString()}` : pathname
    router.replace(newUrl, { scroll: false })
  }, [deferredQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(0) }, [deferredQuery, selectedDivisions, selectedLevels, leafFilter])

  const words = useMemo(() => tokenize(deferredQuery), [deferredQuery])

  // Set di indici che matchano il testo (null = nessuna query attiva)
  const textMatches = useMemo(() => {
    if (!data) return null
    return fullTextMatch(deferredQuery, data)
  }, [data, deferredQuery])

  const hasActiveFilters = selectedDivisions.size > 0 || selectedLevels.size > 0 || leafFilter !== "all"
  const isExploreState = !deferredQuery.trim() && !hasActiveFilters

  // Base: risultati testo (o tutti, se nessuna query)
  const baseIndices = useMemo(() => {
    if (!data) return []
    if (textMatches === null) return data.nodes.map((_, i) => i)
    return [...textMatches]
  }, [data, textMatches])

  const matchesDivision = useCallback((n: CpvNode) => selectedDivisions.size === 0 || selectedDivisions.has(n.division), [selectedDivisions])
  const matchesLevel     = useCallback((n: CpvNode) => selectedLevels.size === 0 || selectedLevels.has(n.level), [selectedLevels])
  const matchesLeaf      = useCallback((n: CpvNode) => leafFilter === "all" || (leafFilter === "leaf" ? n.isLeaf : !n.isLeaf), [leafFilter])

  // Risultati finali (tutti e 3 i filtri applicati)
  const finalIndices = useMemo(() => {
    if (!data) return []
    return baseIndices.filter(i => {
      const n = data.nodes[i]
      return matchesDivision(n) && matchesLevel(n) && matchesLeaf(n)
    })
  }, [data, baseIndices, matchesDivision, matchesLevel, matchesLeaf])

  const sortedResults = useMemo(() => {
    if (!data) return []
    return [...finalIndices]
      .map(i => data.nodes[i])
      .sort((a, b) => scoreNode(b, words, deferredQuery) - scoreNode(a, words, deferredQuery) || a.code.localeCompare(b.code))
  }, [data, finalIndices, words, deferredQuery])


  // Conteggi per faccetta: ricalcolati escludendo SOLO la dimensione della faccetta stessa
  // (standard faceted search: gli altri filtri + la ricerca restano applicati)
  const divisionCounts = useMemo(() => {
    if (!data) return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const i of baseIndices) {
      const n = data.nodes[i]
      if (matchesLevel(n) && matchesLeaf(n)) counts.set(n.division, (counts.get(n.division) ?? 0) + 1)
    }
    return counts
  }, [data, baseIndices, matchesLevel, matchesLeaf])

  const levelCounts = useMemo(() => {
    if (!data) return new Map<number, number>()
    const counts = new Map<number, number>()
    for (const i of baseIndices) {
      const n = data.nodes[i]
      if (matchesDivision(n) && matchesLeaf(n)) counts.set(n.level, (counts.get(n.level) ?? 0) + 1)
    }
    return counts
  }, [data, baseIndices, matchesDivision, matchesLeaf])

  const leafBranchCounts = useMemo(() => {
    if (!data) return { leaf: 0, branch: 0 }
    let leaf = 0, branch = 0
    for (const i of baseIndices) {
      const n = data.nodes[i]
      if (!matchesDivision(n) || !matchesLevel(n)) continue
      if (n.isLeaf) leaf++; else branch++
    }
    return { leaf, branch }
  }, [data, baseIndices, matchesDivision, matchesLevel])

  const divisionFacetList = useMemo(() => {
    if (!data) return []
    return data.divisions
      .map(d => ({ ...d, count: divisionCounts.get(d.code) ?? 0 }))
      .filter(d => d.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [data, divisionCounts])

  const visibleDivisionFacets = divisionsExpanded ? divisionFacetList : divisionFacetList.slice(0, 7)

  const toggleDivision = useCallback((code: string) => {
    setSelectedDivisions(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }, [])
  const toggleLevel = useCallback((level: number) => {
    setSelectedLevels(prev => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level); else next.add(level)
      return next
    })
  }, [])

  const resetAll = useCallback(() => {
    setQuery(""); setSelectedDivisions(new Set()); setSelectedLevels(new Set()); setLeafFilter("all")
  }, [])

  const handleCopy = useCallback(async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }, [])

  const totalPages = Math.ceil(sortedResults.length / PAGE_SIZE)
  const pageResults = sortedResults.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const toggleTreeNode = useCallback((code: string) => {
    setExpandedTree(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }, [])

  // ── Stati di caricamento/errore ──────────────────────────────────────────
  if (loadError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-destructive">Errore nel caricamento del vocabolario CPV: {loadError}</p>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* ── Shared nav (cpv variant shows back-to-gare link) ── */}
      <SiteNav variant="cpv" />

      {/* ── Hero ── */}
      <section className="relative border-b border-border overflow-hidden">
        {/* Subtle blue bloom */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 0% 0%, oklch(0.52 0.22 255 / 0.10) 0%, transparent 70%)",
          }}
        />

        <div className="container mx-auto px-4 sm:px-6 py-10 sm:py-14 md:py-20">
          <div className="max-w-3xl space-y-5">
            {/* Headline */}
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] text-foreground">
              Codici CPV
            </h1>

            {/* Subtext — max 20 words */}
            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-[52ch]">
              Il Vocabolario comune per gli appalti pubblici.{" "}
              Ricerca full-text istantanea su 9.454 codici ufficiali CE.
            </p>

            {/* Stat chips */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { value: "9.454", label: "codici totali" },
                { value: "5", label: "livelli gerarchici" },
                { value: "CE 2008", label: "Reg. 213/2008" },
              ].map((chip) => (
                <span
                  key={chip.value}
                  className="
                    inline-flex items-center gap-1.5
                    px-3 py-1.5 rounded-md
                    border border-border bg-card/60
                    text-xs font-medium
                  "
                >
                  <span className="text-foreground font-bold tabular-nums">{chip.value}</span>
                  <span className="text-muted-foreground">{chip.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1">
        {!data ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
        <div className="border rounded-xl overflow-hidden">
          {/* ── Toolbar ── */}
          <div className="bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Esplora i codici CPV</span>
          </div>

        <div className="flex flex-col md:flex-row">
          {/* ── Sidebar filtri ── */}
          <aside className="md:w-[280px] shrink-0 border-b md:border-b-0 md:border-r p-4 space-y-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="cpv-search"
                placeholder='Es. "pulizia uffici" o "90911200"'
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="pl-9 pr-8 h-10 text-sm"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Pulisci ricerca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Hint contestuale per ricerca per codice */}
            {deferredQuery && isCodeQuery(deferredQuery) && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Search className="h-3 w-3 shrink-0" />
                Ricerca per codice CPV attiva
              </p>
            )}


            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Filtri</h3>
                {hasActiveFilters && (
                  <button onClick={resetAll} className="text-xs text-muted-foreground hover:text-destructive">Azzera</button>
                )}
              </div>

              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Settore · Divisione
              </h4>
              <div className="space-y-0.5">
                {visibleDivisionFacets.map(d => (
                  <FacetCheckbox
                    key={d.code}
                    label={d.label}
                    count={d.count}
                    checked={selectedDivisions.has(d.code)}
                    onChange={() => toggleDivision(d.code)}
                  />
                ))}
              </div>
              {divisionFacetList.length > 7 && (
                <button
                  onClick={() => setDivisionsExpanded(v => !v)}
                  className="text-xs text-primary hover:underline mt-1.5"
                >
                  {divisionsExpanded ? "Mostra meno" : `+ altre ${divisionFacetList.length - 7} divisioni`}
                </button>
              )}
            </div>

            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Livello gerarchico
              </h4>
              <div className="space-y-0.5">
                {[1, 2, 3, 4, 5].map(lvl => (
                  <FacetCheckbox
                    key={lvl}
                    label={LEVEL_LABELS[lvl]}
                    count={levelCounts.get(lvl) ?? 0}
                    checked={selectedLevels.has(lvl)}
                    onChange={() => toggleLevel(lvl)}
                  />
                ))}
              </div>
            </div>

          </aside>

          {/* ── Contenuto principale ── */}
          <div className="flex-1 min-w-0 p-4 sm:p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div>
                <p className="text-sm font-semibold">
                  {viewMode === "albero"
                    ? "Alberatura CPV"
                    : isExploreState
                    ? "Esplora il vocabolario CPV"
                    : "Risultati della ricerca"}
                </p>
              </div>
              {/* Toggle sempre visibile */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Visualizza</span>
                <div className="flex rounded-lg border p-0.5">
                  <button
                    onClick={() => setViewMode("schede")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${viewMode === "schede" ? "bg-foreground text-background" : "hover:bg-muted"}`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" /> Schede
                  </button>
                  <button
                    onClick={() => setViewMode("albero")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${viewMode === "albero" ? "bg-foreground text-background" : "hover:bg-muted"}`}
                  >
                    <ListTree className="h-3.5 w-3.5" /> Alberatura
                  </button>
                </div>
              </div>
            </div>

            {viewMode === "albero" ? (
              <TreeView data={data} expanded={expandedTree} onToggle={toggleTreeNode} onOpenDetail={setSelectedNode} />
            ) : isExploreState ? (
              <ExploreState data={data} onPickDivision={toggleDivision} />
            ) : (
              <SchedeView
                results={pageResults}
                total={sortedResults.length}
                words={words}
                rawQuery={deferredQuery}
                byCode={data.byCode}
                page={page}
                totalPages={totalPages}
                onPage={setPage}
                copied={copied}
                onCopy={handleCopy}
                onOpenDetail={setSelectedNode}
              />
            )}
          </div>
        </div>
      </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-7 mt-auto">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground font-medium tracking-wide">Tender AI DB</span>
            <p className="text-xs text-muted-foreground text-center">
              Vocabolario CPV 2008 (Reg. CE 213/2008){" "}
              <a href="https://ted.europa.eu/simap/codes-and-nomenclatures/cpv" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline underline-offset-2">TED / SIMAP</a>
            </p>
            <span className="text-[10px] text-muted-foreground/50 tracking-[0.12em] uppercase">Dati ufficiali CE</span>
          </div>
        </div>
      </footer>

      {/* ── Modal dettaglio codice ── */}
      {selectedNode && data && (
        <CpvDetailModal
          node={selectedNode}
          data={data}
          onClose={() => setSelectedNode(null)}
          onOpenDetail={setSelectedNode}
        />
      )}
    </div>
  )
}


// ─── Stato "Esplora" (griglia divisioni, nessuna ricerca/filtro attivo) ──────

function ExploreState({ data, onPickDivision }: { data: LoadedData; onPickDivision: (code: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-muted/40 border p-5 sm:p-6 text-center">
        <h2 className="text-lg sm:text-xl font-bold mb-1.5">Quali CPV descrivono la tua azienda?</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Scrivi cosa fai nella barra di ricerca — al resto pensiamo noi.
          {" "}Oppure parti dal tuo settore qui sotto.
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{data.nodes.length.toLocaleString("it-IT")}</span> codici ·{" "}
          <span className="font-semibold text-foreground">{data.divisions.length}</span> divisioni · 5 livelli
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Esplora per settore
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.divisions.map(d => (
            <button
              key={d.code}
              onClick={() => onPickDivision(d.code)}
              className="text-left border rounded-xl p-3.5 bg-card hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <p className="font-mono text-xs font-bold text-primary mb-1">{d.code}</p>
              <p className="text-sm font-medium leading-snug mb-1.5 line-clamp-2">{d.label}</p>
              <p className="text-xs text-muted-foreground">
                {d.total.toLocaleString("it-IT")} codici · {d.groups} gruppi
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Vista "Schede" (risultati di ricerca) ───────────────────────────────────

function SchedeView({ results, total, words, rawQuery, byCode, page, totalPages, onPage, copied, onCopy, onOpenDetail }: {
  results: CpvNode[]
  total: number
  words: string[]
  rawQuery: string
  byCode: Map<string, CpvNode>
  page: number
  totalPages: number
  onPage: (p: number) => void
  copied: string | null
  onCopy: (code: string) => void
  onOpenDetail: (node: CpvNode) => void
}) {
  if (total === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Nessun codice CPV trovato. Prova a modificare la ricerca o i filtri.</p>
      </div>
    )
  }

  const codePrefix = isCodeQuery(rawQuery) ? normalizeCodeQuery(rawQuery) : ""

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{total.toLocaleString("it-IT")}</span> codici trovati
      </p>

      {results.map(node => {
        const crumb = breadcrumbOf(node, byCode)
        const numericCode = node.code.replace(/-\d+$/, "")
        const isExactMatch = codePrefix.length >= 2 && numericCode === codePrefix
        return (
          <div
            key={node.code}
            className={`border rounded-xl p-3 sm:p-4 bg-card hover:shadow-sm transition-shadow flex items-start justify-between gap-3 ${isExactMatch ? "border-primary/40 bg-primary/5" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <LevelBadge level={node.level} />
                <button
                  onClick={() => onOpenDetail(node)}
                  className="font-mono text-xs sm:text-sm font-semibold text-primary hover:underline underline-offset-2"
                >
                  {highlightCode(node.code, rawQuery)}
                </button>
                {isExactMatch && (
                  <span className="inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                    Corrispondenza esatta
                  </span>
                )}
              </div>
              <p className="text-sm">{highlight(node.label, words)}</p>
              {crumb.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1 truncate" title={crumb.join(" > ")}>
                  {crumb.join(" › ")}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onCopy(numericCode)}>
                {copied === numericCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === numericCode ? "Copiato" : "Copia"}
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-muted-foreground h-7 px-2" onClick={() => onOpenDetail(node)}>
                <ExternalLink className="h-3 w-3" /> Dettaglio
              </Button>
            </div>
          </div>
        )
      })}



      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t gap-2">
          <Button variant="outline" size="sm" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Precedente
          </Button>
          <span className="text-xs sm:text-sm text-muted-foreground">
            Pagina {page + 1} di {totalPages.toLocaleString("it-IT")}
          </span>
          <Button variant="outline" size="sm" onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
            Successiva <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Vista "Alberatura" (albero gerarchico completo, indipendente dai filtri) ─

function TreeView({ data, expanded, onToggle, onOpenDetail }: {
  data: LoadedData
  expanded: Set<string>
  onToggle: (code: string) => void
  onOpenDetail: (node: CpvNode) => void
}) {
  const roots = useMemo(() => data.nodes.filter(n => n.level === 1).sort((a, b) => a.code.localeCompare(b.code)), [data])

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Gerarchia CPV ufficiale · Divisione → Gruppo → Classe → Categoria → Sottocategoria
      </p>
      <div className="border rounded-xl divide-y">
        {roots.map(n => (
          <TreeNode key={n.code} node={n} data={data} expanded={expanded} onToggle={onToggle} onOpenDetail={onOpenDetail} depth={0} />
        ))}
      </div>
    </div>
  )
}

function TreeNode({ node, data, expanded, onToggle, onOpenDetail, depth }: {
  node: CpvNode
  data: LoadedData
  expanded: Set<string>
  onToggle: (code: string) => void
  onOpenDetail: (node: CpvNode) => void
  depth: number
}) {
  const childCodes = data.childrenOf.get(node.code) ?? []
  const isOpen = expanded.has(node.code)
  const hasChildren = childCodes.length > 0

  return (
    <div>
      <div
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors group"
        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
      >
        <button
          onClick={() => hasChildren && onToggle(node.code)}
          className={`shrink-0 ${!hasChildren ? "cursor-default" : ""}`}
          aria-label={hasChildren ? (isOpen ? `Comprimi ${node.code}` : `Espandi ${node.code}`) : undefined}
        >
          {hasChildren ? (
            isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <span className="h-3.5 w-3.5 flex items-center justify-center"><span className="h-1 w-1 rounded-full bg-muted-foreground/50" /></span>
          )}
        </button>
        <button
          onClick={() => onOpenDetail(node)}
          className="font-mono text-xs text-primary hover:underline underline-offset-2 shrink-0"
        >
          {node.code.slice(0, 8)}
        </button>
        <span className="flex-1 truncate text-left">{node.label}</span>
        {hasChildren && <span className="text-xs text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">{childCodes.length} figli</span>}
      </div>
      {isOpen && hasChildren && (
        <div>
          {childCodes
            .map(c => data.byCode.get(c)!)
            .sort((a, b) => a.code.localeCompare(b.code))
            .map(child => (
              <TreeNode key={child.code} node={child} data={data} expanded={expanded} onToggle={onToggle} onOpenDetail={onOpenDetail} depth={depth + 1} />
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Modal dettaglio codice CPV ──────────────────────────────────────────────

function CpvDetailModal({ node, data, onClose, onOpenDetail }: {
  node: CpvNode
  data: LoadedData
  onClose: () => void
  onOpenDetail: (node: CpvNode) => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const [translations, setTranslations] = useState<TranslationsData | null>(null)
  const [transLoading, setTransLoading] = useState(false)
  const numericCode = node.code.replace(/-\d+$/, "")
  const fullCode = node.code // includes check digit e.g. "45453000-7"
  const hasCheckDigit = fullCode.includes("-")

  const breadcrumb = useMemo(() => {
    const path: CpvNode[] = []
    let cur = node.parentCode ? data.byCode.get(node.parentCode) : undefined
    while (cur) { path.unshift(cur); cur = cur.parentCode ? data.byCode.get(cur.parentCode) : undefined }
    return path
  }, [node, data])

  const children = useMemo(() => {
    const codes = data.childrenOf.get(node.code) ?? []
    return codes.map(c => data.byCode.get(c)!).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code))
  }, [node, data])

  const handleCopy = useCallback(async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }, [])

  // Carica le traduzioni in background all'apertura del modal
  useEffect(() => {
    if (cachedTranslations) { setTranslations(cachedTranslations); return }
    setTransLoading(true)
    loadTranslations().then(d => { setTranslations(d); setTransLoading(false) }).catch(() => setTransLoading(false))
  }, [])

  // Chiudi con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Dettaglio codice CPV ${numericCode}`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer / Modal */}
      <div className="relative z-10 w-full sm:max-w-2xl max-h-[90dvh] bg-background rounded-t-2xl sm:rounded-2xl border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <LevelBadge level={node.level} />
              <span className="font-mono text-sm font-bold text-primary">{numericCode}</span>
              {hasCheckDigit && (
                <span className="text-xs text-muted-foreground font-mono">({fullCode})</span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-bold leading-snug">{node.label}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md p-1.5 hover:bg-muted transition-colors" aria-label="Chiudi">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* Breadcrumb */}
          {breadcrumb.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Percorso gerarchico</p>
              <nav className="flex flex-wrap items-center gap-1 text-xs">
                {breadcrumb.map((ancestor, i) => (
                  <span key={ancestor.code} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <button
                      onClick={() => onOpenDetail(ancestor)}
                      className="font-mono text-primary hover:underline underline-offset-2"
                    >
                      {ancestor.code.slice(0, 8)}
                    </button>
                    <span className="text-muted-foreground truncate max-w-[12ch]" title={ancestor.label}>
                      {ancestor.label}
                    </span>
                  </span>
                ))}
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono font-semibold text-foreground">{numericCode}</span>
              </nav>
            </div>
          )}

          {/* Copia codice */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Copia codice</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-2 font-mono"
                onClick={() => handleCopy(numericCode)}
              >
                {copied === numericCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === numericCode ? "Copiato!" : `Copia ${numericCode}`}
              </Button>
              {hasCheckDigit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-2 font-mono text-muted-foreground"
                  onClick={() => handleCopy(fullCode)}
                >
                  {copied === fullCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === fullCode ? "Copiato!" : `Con cifra di controllo: ${fullCode}`}
                </Button>
              )}
            </div>
            {hasCheckDigit && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                TED pubblica le 8 cifre senza suffisso. Alcuni portali legacy richiedono la cifra di controllo ({fullCode}).
              </p>
            )}
          </div>

          {/* Codici subordinati */}
          {children.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Codici subordinati <span className="normal-case font-normal">({children.length})</span>
              </p>
              <div className="border rounded-xl divide-y">
                {children.map(child => (
                  <div key={child.code} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors">
                    <button
                      onClick={() => onOpenDetail(child)}
                      className="flex items-center gap-2 min-w-0 text-left flex-1"
                    >
                      <span className="font-mono text-xs text-primary shrink-0">{child.code.slice(0, 8)}</span>
                      <span className="text-sm truncate">{child.label}</span>
                      {!child.isLeaf && <span className="text-[10px] text-muted-foreground shrink-0">+ figli</span>}
                    </button>
                    <button
                      onClick={() => handleCopy(child.code.replace(/-\d+$/, ""))}
                      className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={`Copia ${child.code}`}
                    >
                      {copied === child.code.replace(/-\d+$/, "") ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {node.isLeaf && children.length === 0 && (
            <div className="rounded-xl bg-muted/40 border px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Questo è un <span className="font-semibold text-foreground">codice foglia</span> — il più specifico disponibile in questa categoria. Non ha sottocodici.
              </p>
            </div>
          )}

          {/* Link esterno */}
          {/* Traduzioni nelle 23 lingue UE */}
          <div className="pt-1 border-t">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Questo codice in tutte le lingue UE
            </p>
            {transLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Caricamento traduzioni…
              </div>
            )}
            {translations && (() => {
              const row = translations.codes[numericCode]
              if (!row) return (
                <p className="text-xs text-muted-foreground">Traduzioni non disponibili per questo codice.</p>
              )
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {translations.langs.map((lang, i) => {
                    const label = row[i]
                    if (!label) return null
                    return (
                      <div key={lang} className="flex gap-2 items-baseline min-w-0">
                        <span className="font-mono text-[10px] uppercase text-muted-foreground shrink-0 w-5">{lang}</span>
                        <span className="text-xs leading-tight text-foreground/80">{label}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            {!transLoading && !translations && (
              <a
                href={`https://elencocpv.it/codice/${numericCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Visualizza in tutte le 23 lingue UE su elencocpv.it
              </a>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
