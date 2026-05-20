"use client"

import { useState, useCallback, useDeferredValue, useMemo } from "react"
import useSWR from "swr"
import {
  Search, SlidersHorizontal, ChevronLeft, ChevronRight,
  ExternalLink, Clock, Euro, Building2, MapPin, FileText, Loader2,
  Globe, ShieldCheck, Database,
} from "lucide-react"
import { Button }  from "@/components/ui/button"
import { Input }   from "@/components/ui/input"
import { Badge }   from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { SourceKey } from "@/lib/sources/types"
import { SOURCE_LABELS, SOURCE_COLORS } from "@/lib/sources/types"
import type { NormalizedTender } from "@/lib/sources/types"

// ─── Types ────────────────────────────────────────────────────────────────────

interface CigLotto {
  cig:         string
  lotto:       string
  valore_lotto: number
}

interface TenderItem {
  id:                  string | number
  cig:                 CigLotto[] | string | null
  oggetto:             string | null
  importo:             number | null
  stato:               string | null
  provincia:           string | null
  data_pubblicazione:  string | null
  data_scadenza:       string | null
  tipo_contratto:      string | null
  descrizione_cpv:     string | null
  sources:             string
  link_originale:      string | null
  stazione_appaltante: string | null
}

interface TendersResponse {
  items:   TenderItem[]
  total:   number
  sources?: { source: SourceKey; count: number; error?: string }[]
}

// ─── Fonti disponibili ────────────────────────────────────────────────────────

const ALL_SOURCES: { value: SourceKey | "all"; label: string; flag?: string }[] = [
  { value: "all",          label: "Tutte le fonti" },
  { value: "anac",         label: "ANAC (Bandi in corso)", flag: "🏛️" },
  { value: "ted",          label: "TED Europa",             flag: "🇪🇺" },
  { value: "cato",         label: "CATO (aggregato)",       flag: "📡" },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json())

function formatCurrency(v: number | null) {
  if (!v) return null
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v)
}

function formatDate(d: string | null) {
  if (!d) return null
  try { return new Date(d).toLocaleDateString("it-IT") } catch { return d }
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const diff = new Date(d).getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

function ScadenzaBadge({ data }: { data: string | null }) {
  const days = daysUntil(data)
  if (days === null) return null
  const label = days <= 0 ? "Scaduta" : days === 1 ? "Scade domani" : `Scade tra ${days} giorni`
  const color = days <= 3 ? "text-orange-500" : days <= 10 ? "text-yellow-600" : "text-green-600"
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Clock className="h-3 w-3" />
      {label}
    </span>
  )
}

function SourceBadge({ source }: { source: string }) {
  const key    = source as SourceKey
  const colors = SOURCE_COLORS[key] ?? { bg: "bg-gray-500/15", text: "text-gray-700", border: "border-gray-200" }
  const label  = SOURCE_LABELS[key] ?? source.toUpperCase()
  const entry  = ALL_SOURCES.find(s => s.value === key)

  return (
    <Badge
      variant="outline"
      className={`text-xs font-medium px-2 py-0.5 ${colors.bg} ${colors.text} ${colors.border}`}
    >
      {entry?.flag && <span className="mr-1">{entry.flag}</span>}
      {label}
    </Badge>
  )
}

// ─── ANAC Supabase Panel ──────────────────────────────────────────────────────

function AnacDbPanel({ total, isLoading }: { total: number; isLoading: boolean }) {
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/20 dark:border-indigo-800/50 p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldCheck className="h-4 w-4 text-indigo-600 shrink-0" />
        <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
          BDNCP · Bandi in Corso
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
          <Database className="h-3 w-3" /> Sincronizzato
        </span>
      </div>
      {!isLoading && total > 0 && (
        <p className="text-xs text-indigo-600/70">
          <span className="font-semibold">{total.toLocaleString("it-IT")}</span>{" "}
          bandi attivi · BDNCP — Autorità Nazionale Anticorruzione
        </p>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

/** Importo filter ranges (mapped to Supabase importo_min/importo_max) */
const IMPORTO_RANGES: Record<string, { min?: number; max?: number }> = {
  "< €40.000":    { max: 40_000 },
  "€40k – €150k": { min: 40_000,    max: 150_000 },
  "€150k – €1M":  { min: 150_000,   max: 1_000_000 },
  "€1M – €5M":    { min: 1_000_000, max: 5_000_000 },
  "> €5M":        { min: 5_000_000 },
}

/** Map tipo filter to oggetto_principale_contratto values */
const TIPO_TO_CONTRATTO: Record<string, string> = {
  goods:    "FORNITURE",
  services: "SERVIZI",
  works:    "LAVORI",
}

interface CigApiResponse {
  data: TenderItem[]
  count: number
  totalPages: number
}

export function GareListClient() {
  const [search,   setSearch]   = useState("")
  const [tipo,     setTipo]     = useState("")
  const [importo,  setImporto]  = useState("")
  const [scadenza, setScadenza] = useState("")
  const [source,   setSource]   = useState<SourceKey | "all">("all")
  const [page,     setPage]     = useState(0)

  const deferredSearch = useDeferredValue(search)

  const isAnacMode = source === "anac"

  // ── Query string per ANAC (Supabase /api/cig) ─────────────────────────────
  const anacQueryString = useMemo(() => {
    if (!isAnacMode) return ""
    const params = new URLSearchParams()
    params.set("page", String(page + 1)) // /api/cig uses 1-indexed pages
    params.set("stato", "active")
    if (deferredSearch) params.set("q", deferredSearch)
    if (tipo && tipo !== "all") {
      const contratto = TIPO_TO_CONTRATTO[tipo.toLowerCase()]
      if (contratto) params.set("tipo_contratto", contratto)
    }
    if (importo && importo !== "all") {
      const range = IMPORTO_RANGES[importo]
      if (range?.min != null) params.set("importo_min", String(range.min))
      if (range?.max != null) params.set("importo_max", String(range.max))
    }
    return params.toString()
  }, [isAnacMode, page, deferredSearch, tipo, importo])

  const { data: anacData, isLoading: anacLoading } = useSWR<CigApiResponse>(
    isAnacMode ? `/api/cig?${anacQueryString}` : null,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  // Map /api/cig response to TenderItem format
  const anacItems: TenderItem[] = useMemo(() => {
    if (!anacData?.data) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return anacData.data.map((row: any) => ({
      id:                  `anac:${row.cig}`,
      cig:                 row.cig ?? null,
      oggetto:             row.oggetto_gara ?? null,
      importo:             row.importo_lotto ?? null,
      stato:               row.stato ?? "active",
      provincia:           row.provincia ?? null,
      data_pubblicazione:  row.data_pubblicazione ?? null,
      data_scadenza:       row.data_scadenza_offerta ?? null,
      tipo_contratto:      row.oggetto_principale_contratto ?? null,
      descrizione_cpv:     row.descrizione_cpv ?? null,
      sources:             "anac",
      link_originale:      row.cig
        ? `https://dati.anticorruzione.it/superset/recaptcha/?cig=${row.cig}&next=dettaglio_cig`
        : null,
      stazione_appaltante: row.denominazione_amministrazione_appaltante ?? row.sezione_regionale ?? null,
    }))
  }, [anacData])

  // ── Query string per /api/tenders (non-ANAC) ─────────────────────────────────
  const queryString = useMemo(() => {
    if (isAnacMode) return ""  // non usato
    const params = new URLSearchParams()
    params.set("p", String(page))
    if (deferredSearch)               params.set("q",       deferredSearch)
    if (tipo    && tipo    !== "all") params.set("tipo",    tipo)
    if (importo && importo !== "all") params.set("importo", importo)
    if (scadenza && scadenza !== "all") params.set("scadenza", scadenza)
    if (source  && source  !== "all") params.set("source",  source)
    return params.toString()
  }, [page, deferredSearch, tipo, importo, scadenza, source, isAnacMode])

  const { data, isLoading: swrLoading } = useSWR<TendersResponse>(
    isAnacMode ? null : `/api/tenders?${queryString}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  // ── Dati unificati ─────────────────────────────────────────────────────────
  const items: TenderItem[] = isAnacMode ? anacItems : (data?.items || [])
  const total     = isAnacMode ? (anacData?.count ?? 0) : (data?.total ?? 0)
  const isLoading = isAnacMode ? anacLoading : swrLoading
  const pageSize  = isAnacMode ? 20 : 10
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0

  const resetFilters = useCallback(() => {
    setSearch(""); setTipo(""); setImporto(""); setScadenza(""); setSource("all"); setPage(0)
  }, [])

  const handleFilterChange = useCallback(() => setPage(0), [])

  const hasFilters = !!(search || tipo || importo || scadenza || source !== "all")

  const sourceStats = data?.sources?.filter(s => s.count > 0 || s.error)

  return (
    <div className="space-y-6">

      {/* ── Search Bar ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="gare-search"
            placeholder={
              isAnacMode
                ? "Cerca nei bandi ANAC in corso (oggetto gara)…"
                : "Cerca per oggetto della gara…"
            }
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="pl-10 h-11 text-base"
          />
        </div>
        <Button size="lg" className="px-6" onClick={() => setPage(0)}>
          Cerca
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Fonte */}
        <Select
          value={source}
          onValueChange={v => { setSource(v as SourceKey | "all"); handleFilterChange() }}
        >
          <SelectTrigger id="filter-source" className="w-[220px]">
            <Globe className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Tutte le fonti" />
          </SelectTrigger>
          <SelectContent>
            {ALL_SOURCES.map(s => (
              <SelectItem key={s.value} value={s.value}>
                {s.flag && <span className="mr-1.5">{s.flag}</span>}
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Tipo procedura */}
        <Select value={tipo || "all"} onValueChange={v => { setTipo(v === "all" ? "" : v); handleFilterChange() }}>
          <SelectTrigger id="filter-tipo" className="w-[180px]">
            <SelectValue placeholder="Tipo procedura" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tipo procedura</SelectItem>
            <SelectItem value="goods">Forniture</SelectItem>
            <SelectItem value="services">Servizi</SelectItem>
            <SelectItem value="works">Lavori</SelectItem>
          </SelectContent>
        </Select>

        {/* Importo */}
        <Select value={importo || "all"} onValueChange={v => { setImporto(v === "all" ? "" : v); handleFilterChange() }}>
          <SelectTrigger id="filter-importo" className="w-[180px]">
            <SelectValue placeholder="Valore appalto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Valore appalto</SelectItem>
            <SelectItem value="< €40.000">{"< €40.000"}</SelectItem>
            <SelectItem value="€40k – €150k">€40k – €150k</SelectItem>
            <SelectItem value="€150k – €1M">€150k – €1M</SelectItem>
            <SelectItem value="€1M – €5M">€1M – €5M</SelectItem>
            <SelectItem value="> €5M">{"> €5M"}</SelectItem>
          </SelectContent>
        </Select>

        {/* Scadenza (solo non-ANAC: BANDI_IN_CORSO è già filtrato) */}
        {!isAnacMode && (
          <Select value={scadenza || "all"} onValueChange={v => { setScadenza(v === "all" ? "" : v); handleFilterChange() }}>
            <SelectTrigger id="filter-scadenza" className="w-[180px]">
              <SelectValue placeholder="Scadenza offerte" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Scadenza offerte</SelectItem>
              <SelectItem value="7">Entro 7 giorni</SelectItem>
              <SelectItem value="30">Entro 30 giorni</SelectItem>
              <SelectItem value="90">Entro 3 mesi</SelectItem>
            </SelectContent>
          </Select>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
            Cancella filtri
          </Button>
        )}
      </div>

      {/* ── ANAC DB Panel ── */}
      {isAnacMode && (
        <AnacDbPanel total={total} isLoading={isLoading} />
      )}

      {/* ── Source Stats (non-ANAC) ── */}
      {!isAnacMode && sourceStats && sourceStats.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground">Fonti attive:</span>
          {sourceStats.map(s => (
            <span key={s.source} className="inline-flex items-center gap-1">
              <SourceBadge source={s.source} />
              <span className="text-xs text-muted-foreground">({s.count})</span>
              {s.error && <span className="text-xs text-destructive ml-1" title={s.error}>⚠</span>}
            </span>
          ))}
        </div>
      )}

      {/* ── Results Count ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isLoading ? (
            <span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Caricamento…</span>
          ) : (
            <><span className="font-semibold text-foreground">{total.toLocaleString("it-IT")}</span> gare trovate</>
          )}
        </p>
        {totalPages > 1 && (
          <p className="text-sm text-muted-foreground">
            Pagina <span className="font-medium">{page + 1}</span> di <span className="font-medium">{totalPages.toLocaleString("it-IT")}</span>
          </p>
        )}
      </div>

      {/* ── Tender Cards ── */}
      {items.length === 0 && !isLoading && (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Nessuna gara trovata</p>
          <p className="text-sm mt-1">
            {isAnacMode
              ? "Prova a modificare i filtri o verifica la connessione con ANAC"
              : "Prova a modificare i filtri di ricerca"}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {items.map(tender => (
          <TenderCard key={tender.id} tender={tender} />
        ))}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            id="btn-prev-page"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Pagina precedente
          </Button>
          <span className="text-sm text-muted-foreground">
            Pagina {page + 1} di {totalPages.toLocaleString("it-IT")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            id="btn-next-page"
          >
            Pagina successiva
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Tender Card Component ────────────────────────────────────────────────────

function getCigCode(cig: CigLotto[] | string | null): string {
  if (!cig) return "—"
  if (typeof cig === "string") return cig
  if (Array.isArray(cig) && cig.length > 0) return cig[0].cig
  return "—"
}

function getLotti(cig: CigLotto[] | string | null): CigLotto[] {
  if (Array.isArray(cig)) return cig
  return []
}

function TenderCard({ tender }: { tender: TenderItem }) {
  const days     = daysUntil(tender.data_scadenza)
  const isActive = tender.stato === "active" || (days !== null && days > 0) || tender.sources === "anac"
  const cigCode  = getCigCode(tender.cig)
  const lotti    = getLotti(tender.cig)

  const src = tender.sources as SourceKey
  const sourceUrl = tender.link_originale ?? (
    src === "ted"
      ? `https://ted.europa.eu/it/notice/-/detail/${cigCode}`
      : `https://www.get-cato.com/gara/${tender.id}`
  )

  const cpvCodes = tender.descrizione_cpv ?? tender.tipo_contratto

  return (
    <div className="border rounded-xl p-5 bg-card hover:shadow-md transition-shadow space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        {isActive && (
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 font-medium text-xs px-2 py-0.5">
            ● ATTIVA
          </Badge>
        )}
        {/* Badge fonte colorato */}
        <SourceBadge source={tender.sources} />
        {cpvCodes && (
          <Badge variant="outline" className="font-mono text-xs max-w-[240px] truncate" title={cpvCodes}>
            CPV: {cpvCodes}
          </Badge>
        )}
        {/* Badge PNRR (solo ANAC) */}
        {(tender as NormalizedTender & { flag_pnrr_pnc?: string }).flag_pnrr_pnc === "Sì" && (
          <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 text-xs font-medium">
            PNRR/PNC
          </Badge>
        )}
      </div>

      {/* Title */}
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="block group">
        <h2 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {tender.oggetto || "—"}
        </h2>
      </a>

      {/* CIG / Location */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {lotti.length > 1 ? (
          <span className="text-xs">
            <span className="font-medium">{lotti.length} lotti</span> — CIG:{" "}
            {lotti.slice(0, 2).map(l => l.cig).join(", ")}
            {lotti.length > 2 && ` +${lotti.length - 2}`}
          </span>
        ) : (
          <span className="font-mono text-xs">CIG: {cigCode}</span>
        )}
        {tender.provincia && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {tender.provincia}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-dashed">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Valore stimato</p>
          <p className="font-semibold text-sm flex items-center gap-1">
            <Euro className="h-3 w-3 text-muted-foreground" />
            {formatCurrency(tender.importo) ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Scadenza offerte</p>
          <div className="space-y-0.5">
            <p className="font-medium text-sm">{formatDate(tender.data_scadenza) ?? "—"}</p>
            <ScadenzaBadge data={tender.data_scadenza} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Stazione appaltante</p>
          <p className="font-medium text-sm truncate" title={tender.stazione_appaltante ?? undefined}>
            {tender.stazione_appaltante ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Pubblicato il</p>
          <p className="font-medium text-sm">{formatDate(tender.data_pubblicazione) ?? "—"}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Building2 className="h-3 w-3" />
          {tender.stazione_appaltante ?? "Stazione appaltante n.d."}
        </span>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Apri fonte <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  )
}
