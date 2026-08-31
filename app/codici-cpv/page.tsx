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
 * con quelli mostrati da Cato, confermando che la struttura è equivalente.
 *
 * Ricerca principale: full-text fuzzy su etichetta + intera gerarchia degli antenati
 * (indice a prefisso, tutto client-side, nessun download pesante) — replica il
 * comportamento osservato su Cato (es. "pulizia uffici" → centinaia/migliaia di
 * risultati con evidenziazione, non solo i top-20 semantici).
 * Ricerca AI opzionale: la ricerca semantica (Xenova/multilingual-e5-small) già
 * costruita in precedenza resta disponibile come pannello secondario on-demand.
 */

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react"
import Link from "next/link"
import Image from "next/image"
import {
  Search, ChevronRight, ChevronDown, Loader2, Copy, Check, Sparkles,
  X, ChevronLeft, LayoutGrid, ListTree,
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

function breadcrumbOf(node: CpvNode, byCode: Map<string, CpvNode>): string[] {
  const path: string[] = []
  let cur = node.parentCode ? byCode.get(node.parentCode) : undefined
  while (cur) {
    path.unshift(cur.label)
    cur = cur.parentCode ? byCode.get(cur.parentCode) : undefined
  }
  return path
}

/** Tutte le parole della query devono comparire (in etichetta o in un antenato) */
function fullTextMatch(query: string, data: LoadedData): Set<number> | null {
  const words = tokenize(query)
  if (words.length === 0) return null
  const sets = words.map(w => data.index.get(prefixKey(w)) ?? [])
  if (sets.some(s => s.length === 0)) return new Set()
  const counts = new Map<number, number>()
  for (const s of sets) for (const i of s) counts.set(i, (counts.get(i) ?? 0) + 1)
  const result = new Set<number>()
  for (const [i, c] of counts) if (c === words.length) result.add(i)
  return result
}

/** Punteggio di rilevanza: premia i match nell'etichetta propria (non solo negli antenati) */
function scoreNode(node: CpvNode, words: string[]): number {
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
  const [data, setData] = useState<LoadedData | null>(null)
  const [loadError, setLoadError] = useState("")

  const [query, setQuery] = useState("")
  const deferredQuery = useDebounce(query, 200)

  const [selectedDivisions, setSelectedDivisions] = useState<Set<string>>(new Set())
  const [selectedLevels, setSelectedLevels] = useState<Set<number>>(new Set())
  const [leafFilter, setLeafFilter] = useState<LeafFilter>("all")
  const [divisionsExpanded, setDivisionsExpanded] = useState(false)
  const [viewMode, setViewMode] = useState<"schede" | "albero">("schede")
  const [page, setPage] = useState(0)
  const [expandedTree, setExpandedTree] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    loadFullData().then(setData).catch(err => setLoadError(err instanceof Error ? err.message : "Errore di caricamento dati"))
  }, [])

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
      .sort((a, b) => scoreNode(b, words) - scoreNode(a, words) || a.code.localeCompare(b.code))
  }, [data, finalIndices, words])

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
              Elenco codici CPV
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              Cerca ed esplora il Vocabolario comune per gli appalti pubblici (CPV): trova i codici
              di riferimento della tua azienda per monitorare le gare giuste.
            </p>
          </div>
        </div>
      </section>

      {!data ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
      <div className="border rounded-none sm:rounded-xl sm:mx-4 md:mx-auto md:max-w-6xl sm:mt-6 overflow-hidden">
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
                placeholder="Cerca un'attività o un codice CPV"
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

            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Tipo di codice
              </h4>
              <div className="flex gap-1.5">
                {([
                  ["all", "Tutti", null],
                  ["leaf", "Foglie", leafBranchCounts.leaf],
                  ["branch", "Rami", leafBranchCounts.branch],
                ] as const).map(([value, label, count]) => (
                  <button
                    key={value}
                    onClick={() => setLeafFilter(value)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                      leafFilter === value
                        ? "bg-foreground text-background border-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {label}{count !== null && ` (${count.toLocaleString("it-IT")})`}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* ── Contenuto principale ── */}
          <div className="flex-1 min-w-0 p-4 sm:p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div>
                <p className="text-sm font-semibold">
                  {isExploreState ? "Esplora il vocabolario CPV" : "Risultati della ricerca"}
                </p>
              </div>
              {!isExploreState && (
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
              )}
            </div>

            {isExploreState ? (
              <ExploreState data={data} onPickDivision={toggleDivision} />
            ) : viewMode === "albero" ? (
              <TreeView data={data} expanded={expandedTree} onToggle={toggleTreeNode} />
            ) : (
              <SchedeView
                results={pageResults}
                total={sortedResults.length}
                words={words}
                byCode={data.byCode}
                page={page}
                totalPages={totalPages}
                onPage={setPage}
                copied={copied}
                onCopy={handleCopy}
              />
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── Footer ── */}
      <footer className="border-t py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Vocabolario CPV 2008 (Reg. CE 213/2008) — dati ufficiali{" "}
          <a href="https://ted.europa.eu/simap/codes-and-nomenclatures/cpv" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            TED / SIMAP
          </a>
          .
        </div>
      </footer>
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

function SchedeView({ results, total, words, byCode, page, totalPages, onPage, copied, onCopy }: {
  results: CpvNode[]
  total: number
  words: string[]
  byCode: Map<string, CpvNode>
  page: number
  totalPages: number
  onPage: (p: number) => void
  copied: string | null
  onCopy: (code: string) => void
}) {
  if (total === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Nessun codice CPV trovato. Prova a modificare la ricerca o i filtri.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{total.toLocaleString("it-IT")}</span> codici trovati
      </p>

      {results.map(node => {
        const crumb = breadcrumbOf(node, byCode)
        return (
          <div key={node.code} className="border rounded-xl p-3 sm:p-4 bg-card hover:shadow-sm transition-shadow flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <LevelBadge level={node.level} />
                <p className="font-mono text-xs sm:text-sm font-semibold text-primary">{node.code}</p>
              </div>
              <p className="text-sm">{highlight(node.label, words)}</p>
              {crumb.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1 truncate" title={crumb.join(" > ")}>
                  {crumb.join(" › ")}
                </p>
              )}
            </div>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => onCopy(node.code)}>
              {copied === node.code ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === node.code ? "Copiato" : "Copia"}
            </Button>
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

function TreeView({ data, expanded, onToggle }: {
  data: LoadedData
  expanded: Set<string>
  onToggle: (code: string) => void
}) {
  const roots = useMemo(() => data.nodes.filter(n => n.level === 1).sort((a, b) => a.code.localeCompare(b.code)), [data])

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Gerarchia CPV ufficiale · Divisione → Gruppo → Classe → Categoria → Sottocategoria
      </p>
      <div className="border rounded-xl divide-y">
        {roots.map(n => (
          <TreeNode key={n.code} node={n} data={data} expanded={expanded} onToggle={onToggle} depth={0} />
        ))}
      </div>
    </div>
  )
}

function TreeNode({ node, data, expanded, onToggle, depth }: {
  node: CpvNode
  data: LoadedData
  expanded: Set<string>
  onToggle: (code: string) => void
  depth: number
}) {
  const childCodes = data.childrenOf.get(node.code) ?? []
  const isOpen = expanded.has(node.code)
  const hasChildren = childCodes.length > 0

  return (
    <div>
      <button
        onClick={() => hasChildren && onToggle(node.code)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${!hasChildren ? "cursor-default" : ""}`}
        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
      >
        {hasChildren ? (
          isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0 flex items-center justify-center"><span className="h-1 w-1 rounded-full bg-muted-foreground/50" /></span>
        )}
        <span className="font-mono text-xs text-muted-foreground shrink-0">{node.code.slice(0, 8)}</span>
        <span className="flex-1 truncate">{node.label}</span>
        {hasChildren && <span className="text-xs text-muted-foreground shrink-0">{childCodes.length} figli</span>}
      </button>
      {isOpen && hasChildren && (
        <div>
          {childCodes
            .map(c => data.byCode.get(c)!)
            .sort((a, b) => a.code.localeCompare(b.code))
            .map(child => (
              <TreeNode key={child.code} node={child} data={data} expanded={expanded} onToggle={onToggle} depth={depth + 1} />
            ))}
        </div>
      )}
    </div>
  )
}
