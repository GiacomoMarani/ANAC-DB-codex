"use client"

import { useState, useCallback, useDeferredValue, useMemo } from "react"
import useSWR from "swr"
import {
  Search, SlidersHorizontal, ChevronLeft, ChevronRight,
  ExternalLink, Clock, Euro, Building2, MapPin, FileText, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

// ─── Types ────────────────────────────────────────────────────────────────────

interface CigLotto {
  cig: string
  lotto: string
  valore_lotto: number
}

interface TenderItem {
  id: number
  cig: CigLotto[] | string | null  // Cato returns array of lots
  oggetto: string | null
  importo: number | null
  stato: string | null
  provincia: string | null
  data_pubblicazione: string | null
  data_scadenza: string | null
  tipo_contratto: string | null   // Contains CPV codes in Cato data
  descrizione_cpv: string | null
  sources: string
  link_originale: string | null
}

interface TendersResponse {
  items: TenderItem[]
  total: number
}

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

// ─── Main Component ───────────────────────────────────────────────────────────

export function GareListClient() {
  const [search, setSearch]     = useState("")
  const [tipo, setTipo]         = useState("")
  const [importo, setImporto]   = useState("")
  const [scadenza, setScadenza] = useState("")
  const [page, setPage]         = useState(0)

  const deferredSearch = useDeferredValue(search)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    params.set("p", String(page))
    if (deferredSearch) params.set("q", deferredSearch)
    if (tipo && tipo !== "all")     params.set("tipo", tipo)
    if (importo && importo !== "all") params.set("importo", importo)
    if (scadenza && scadenza !== "all") params.set("scadenza", scadenza)
    return params.toString()
  }, [page, deferredSearch, tipo, importo, scadenza])

  const { data, isLoading } = useSWR<TendersResponse>(
    `/api/tenders?${queryString}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  )

  const totalPages = data ? Math.ceil(data.total / 10) : 0

  const resetFilters = useCallback(() => {
    setSearch(""); setTipo(""); setImporto(""); setScadenza(""); setPage(0)
  }, [])

  const handleFilterChange = useCallback(() => setPage(0), [])

  return (
    <div className="space-y-6">

      {/* ── Search Bar ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="gare-search"
            placeholder="Cerca per oggetto della gara..."
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

        {(search || tipo || importo || scadenza) && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
            Cancella filtri
          </Button>
        )}
      </div>

      {/* ── Results Count ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isLoading ? (
            <span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Caricamento...</span>
          ) : (
            <><span className="font-semibold text-foreground">{data?.total?.toLocaleString("it-IT")}</span> gare trovate</>
          )}
        </p>
        {totalPages > 1 && (
          <p className="text-sm text-muted-foreground">
            Pagina <span className="font-medium">{page + 1}</span> di <span className="font-medium">{totalPages.toLocaleString("it-IT")}</span>
          </p>
        )}
      </div>

      {/* ── Tender Cards ── */}
      {data?.items?.length === 0 && !isLoading && (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Nessuna gara trovata</p>
          <p className="text-sm mt-1">Prova a modificare i filtri di ricerca</p>
        </div>
      )}

      <div className="space-y-4">
        {(data?.items || []).map(tender => (
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
  const days = daysUntil(tender.data_scadenza)
  const isActive = tender.stato === "active" || (days !== null && days > 0)
  const cigCode = getCigCode(tender.cig)
  const lotti = getLotti(tender.cig)
  const sourceUrl = tender.link_originale ??
    (tender.sources === "ted" ? `https://ted.europa.eu/it/notice/-/detail/${cigCode}` :
      `https://www.get-cato.com/gara/${tender.id}`)
  // tipo_contratto contains CPV codes in Cato data
  const cpvCodes = tender.tipo_contratto ?? tender.descrizione_cpv

  return (
    <div className="border rounded-xl p-5 bg-card hover:shadow-md transition-shadow space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        {isActive && (
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 font-medium text-xs px-2 py-0.5">
            ● ATTIVA
          </Badge>
        )}
        {cpvCodes && (
          <Badge variant="outline" className="font-mono text-xs max-w-[240px] truncate">
            {cpvCodes}
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs uppercase tracking-wide">
          {tender.sources || "ANAC"}
        </Badge>
      </div>

      {/* Title */}
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="block group">
        <h2 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {tender.oggetto || "—"}
        </h2>
      </a>

      {/* CIG / Lotti */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {lotti.length > 1 ? (
          <span className="text-xs">
            <span className="font-medium">{lotti.length} lotti</span> — CIG:{" "}
            {lotti.slice(0, 2).map(l => l.cig).join(", ")}
            {lotti.length > 2 && ` +${lotti.length - 2}`}
          </span>
        ) : (
          <span className="font-mono text-xs">Nr. Gara: {cigCode}</span>
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
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Fonte</p>
          <p className="font-medium text-sm uppercase">{tender.sources || "—"}</p>
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
          Stazione Appaltante &amp; Contatti
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
