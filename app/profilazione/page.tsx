// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
"use client"

/**
 * app/profilazione/page.tsx
 * Profilazione Rapida — Analisi CPV e verifica requisiti aziendali via P.IVA
 *
 * Feature differenziante: inserendo una Partita IVA si ottiene in pochi secondi
 * il profilo aziendale con codici CPV, storico gare, copertura territoriale
 * e matching istantaneo con i bandi attivi.
 *
 * Competitor (INTL/ITA) richiedono upload manuali di documenti.
 * Noi estraiamo tutto automaticamente dallo storico ANAC.
 */

import { useState, useCallback, useMemo, useRef, type ReactNode } from "react"
import Link from "next/link"
import { SiteNav } from "@/components/site-nav"
import {
  Search, Loader2, Building2, MapPin, TrendingUp,
  FileText, ArrowRight, Copy, Check, BarChart3,
  ChevronRight, AlertCircle, Zap, Shield, Target,
  ExternalLink, X, Eye, Filter,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { isValidPartitaIva } from "@/lib/utils/piva"
import { buildAnacCigUrl } from "@/lib/sources/types"
import { useAnacRelay, AnacConnectButton } from "@/components/AnacConnectButton"

// ─── Types ──────────────────────────────────────────────────────────────────

interface CpvEntry {
  code: string
  description: string
  count: number
  total_value: number
  percentage: number
}

interface CpvDivision {
  division: string
  label: string
  count: number
  percentage: number
}

interface ProvinceEntry {
  name: string
  count: number
}

interface ContractType {
  tipo: string
  count: number
  percentage: number
}

interface CompanyProfile {
  partita_iva: string
  ragione_sociale: string | null
  sede: string | null
  regione: string | null
  totale_gare: number
  gare_vinte: number
  gare_partecipate: number
  tasso_successo: number
  gare_non_aggiudicate: number
  importo_totale: number
  importo_medio: number
  prima_gara: string | null
  ultima_gara: string | null
  cpv_codes: CpvEntry[]
  cpv_divisions: CpvDivision[]
  province: ProvinceEntry[]
  tipi_contratto: ContractType[]
}

interface TenderMatch {
  cig: string
  oggetto_gara: string
  importo: number | null
  provincia: string | null
  data_scadenza: string | null
  descrizione_cpv: string | null
  score: number
  cpv_match: string[]
  stato: string | null
}

interface HistoricalTender {
  cig: string
  oggetto_gara: string
  importo: number | null
  provincia: string | null
  descrizione_cpv: string | null
  data_aggiudicazione: string | null
  source: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Auto-detect: l'input è una P.IVA/CF (numerico) o una ragione sociale (testo)? */
function detectIsNumeric(input: string): boolean {
  const cleaned = input.trim().replace(/[\s\-\.]/g, "")
  return /^(?:IT)?\d{6,16}$/i.test(cleaned)
}

/** Validazione P.IVA lato client (formato 11 cifre e checksum Luhn) */
function isValidPivaFormat(piva: string): boolean {
  const clean = piva.replace(/[\s\-\.]/g, "")
  return isValidPartitaIva(clean)
}

function formatCurrency(n: number | null): string {
  if (n == null || n === 0) return "N/D"
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(d: string | null): string {
  if (!d) return "N/D"
  try {
    return new Date(d).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  } catch {
    return d
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, accent = "primary",
}: {
  label: string
  value: string | number
  icon: ReactNode
  accent?: "primary" | "emerald" | "amber" | "rose"
}) {
  const colors = {
    primary: "border-primary/20 bg-primary/5",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    amber: "border-amber-500/20 bg-amber-500/5",
    rose: "border-rose-500/20 bg-rose-500/5",
  }

  return (
    <div className={`rounded-xl border p-4 ${colors[accent]} transition-shadow hover:shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function CpvBar({
  entry, maxCount, isExpanded, onToggle, onScrollToBandi,
}: {
  entry: CpvEntry
  maxCount: number
  isExpanded: boolean
  onToggle: () => void
  onScrollToBandi: (cpvCode: string) => void
}) {
  const width = maxCount > 0 ? (entry.count / maxCount) * 100 : 0
  const [copied, setCopied] = useState(false)
  const numericCode = entry.code.replace(/-\d+$/, "")

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(numericCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [numericCode])

  return (
    <div className="group">
      <button
        onClick={onToggle}
        className="w-full text-left py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <code className="text-xs font-mono text-primary font-semibold shrink-0">
              {entry.code}
            </code>
            <span className="text-sm truncate" title={entry.description}>
              {entry.description}
            </span>
            <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform duration-200 shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {entry.count} {entry.count === 1 ? "gara" : "gare"}
            </span>
            <span className="text-xs font-semibold text-foreground tabular-nums w-10 text-right">
              {entry.percentage.toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
          <div
            className="h-1.5 rounded-full bg-primary transition-all duration-700"
            style={{ width: `${width}%` }}
          />
        </div>
      </button>

      {/* Expandable detail panel */}
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1 ml-4 border-l-2 border-primary/20">
            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
              {entry.description}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 font-mono"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copiato" : `Copia ${numericCode}`}
              </Button>
              <a
                href={`/codici-cpv?q=${encodeURIComponent(numericCode)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border text-xs font-medium hover:bg-muted transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Eye className="h-3 w-3" />
                Gerarchia CPV
                <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
              </a>
              <button
                onClick={(e) => { e.stopPropagation(); onScrollToBandi(entry.code) }}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
              >
                <Search className="h-3 w-3" />
                Bandi con questo CPV
              </button>
            </div>
            {entry.total_value > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Volume totale: <strong className="text-foreground">{formatCurrency(entry.total_value)}</strong>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DivisionChip({
  division,
}: {
  division: CpvDivision
}) {
  return (
    <a
      href={`/codici-cpv?q=${encodeURIComponent(division.label)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:border-primary/50 hover:shadow-sm transition-all text-sm group"
    >
      <code className="text-xs font-mono text-primary font-bold">{division.division}</code>
      <span className="truncate max-w-[200px]" title={division.label}>
        {division.label}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {division.percentage.toFixed(0)}%
      </span>
      <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
    </a>
  )
}

function MatchCard({
  tender, onClick, onCpvClick, highlightedCpv,
}: {
  tender: TenderMatch
  onClick: () => void
  onCpvClick: (cpvCode: string) => void
  highlightedCpv: string | null
}) {
  const isExpired = tender.data_scadenza && new Date(tender.data_scadenza) < new Date()

  return (
    <div
      onClick={onClick}
      className="border rounded-xl p-4 bg-card hover:shadow-md hover:border-primary/30 transition-all duration-200 cursor-pointer active:scale-[0.99] group/card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`
              inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold
              ${tender.score >= 70
                ? "bg-emerald-500/15 text-emerald-700 border border-emerald-200"
                : tender.score >= 40
                ? "bg-amber-500/15 text-amber-700 border border-amber-200"
                : "bg-muted text-muted-foreground border"
              }
            `}>
              {tender.score}% match
            </span>
            {isExpired && (
              <span className="text-[10px] text-rose-500 font-medium">Scaduto</span>
            )}
          </div>
          <p className="text-sm font-medium leading-snug mb-1 line-clamp-2 group-hover/card:text-primary transition-colors">
            {tender.oggetto_gara || "Bando senza titolo"}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {tender.provincia && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {tender.provincia}
              </span>
            )}
            {tender.importo != null && (
              <span>{formatCurrency(tender.importo)}</span>
            )}
            {tender.data_scadenza && (
              <span>Scade: {formatDate(tender.data_scadenza)}</span>
            )}
          </div>
          {tender.cpv_match.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tender.cpv_match.map((cpv) => (
                <button
                  key={cpv}
                  onClick={(e) => { e.stopPropagation(); onCpvClick(cpv) }}
                  className={`
                    inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded
                    transition-all duration-200 cursor-pointer
                    ${highlightedCpv === cpv
                      ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                      : "bg-primary/10 text-primary hover:bg-primary/20"
                    }
                  `}
                >
                  {cpv}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <code className="text-[10px] text-muted-foreground font-mono">
            {tender.cig}
          </code>
          <span className="text-[10px] text-primary font-medium opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center gap-1">
            Dettaglio <ArrowRight className="h-2.5 w-2.5" />
          </span>
        </div>
      </div>
    </div>
  )
}
// ─── Tender Detail Sheet ────────────────────────────────────────────────────

function TenderDetailSheet({
  tender, open, onOpenChange, onCpvClick, ragioneSociale,
}: {
  tender: TenderMatch | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCpvClick: (cpvCode: string) => void
  ragioneSociale: string | null
}) {
  const [cigCopied, setCigCopied] = useState(false)

  const handleCopyCig = useCallback(async () => {
    if (!tender) return
    await navigator.clipboard.writeText(tender.cig)
    setCigCopied(true)
    setTimeout(() => setCigCopied(false), 1500)
  }, [tender])

  if (!tender) return null

  const isExpired = tender.data_scadenza && new Date(tender.data_scadenza) < new Date()
  const anacUrl = buildAnacCigUrl(tender.cig)
  const gareSearchUrl = `/gare?q=${encodeURIComponent(tender.oggetto_gara?.slice(0, 80) || tender.cig)}`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className="font-mono text-xs">
              {tender.cig}
            </Badge>
            <span className={`
              inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold
              ${tender.score >= 70
                ? "bg-emerald-500/15 text-emerald-700 border border-emerald-200"
                : tender.score >= 40
                ? "bg-amber-500/15 text-amber-700 border border-amber-200"
                : "bg-muted text-muted-foreground border"
              }
            `}>
              {tender.score}% match
            </span>
            {isExpired ? (
              <Badge variant="destructive" className="text-[10px]">Scaduto</Badge>
            ) : (
              <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 text-[10px]">Attivo</Badge>
            )}
          </div>
          <SheetTitle className="text-base leading-snug">
            {tender.oggetto_gara || "Bando senza titolo"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          {/* Info grid */}
          <div className="space-y-3">
            {tender.importo != null && (
              <div className="flex justify-between items-baseline py-2 border-b">
                <span className="text-sm text-muted-foreground">Importo a base d&apos;asta</span>
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(tender.importo)}</span>
              </div>
            )}
            {tender.provincia && (
              <div className="flex justify-between items-baseline py-2 border-b">
                <span className="text-sm text-muted-foreground">Provincia</span>
                <span className="text-sm font-medium flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {tender.provincia}
                </span>
              </div>
            )}
            {tender.data_scadenza && (
              <div className="flex justify-between items-baseline py-2 border-b">
                <span className="text-sm text-muted-foreground">Scadenza offerte</span>
                <span className="text-sm font-medium">{formatDate(tender.data_scadenza)}</span>
              </div>
            )}
            {tender.descrizione_cpv && (
              <div className="py-2 border-b">
                <span className="text-sm text-muted-foreground block mb-1">Classificazione CPV</span>
                <span className="text-sm font-medium">{tender.descrizione_cpv}</span>
              </div>
            )}
          </div>

          {/* Matching CPV codes */}
          {tender.cpv_match.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Codici CPV compatibili
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tender.cpv_match.map((cpv) => (
                  <button
                    key={cpv}
                    onClick={() => { onCpvClick(cpv); onOpenChange(false) }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    {cpv}
                    <ChevronRight className="h-2.5 w-2.5" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <a
              href={anacUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-sm font-medium"
            >
              <ExternalLink className="h-4 w-4 text-primary" />
              Visualizza su ANAC
              <span className="text-muted-foreground text-xs ml-auto">dati.anticorruzione.it</span>
            </a>
            <a
              href={gareSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-sm font-medium"
            >
              <Search className="h-4 w-4 text-primary" />
              Cerca in Gare
              <span className="text-muted-foreground text-xs ml-auto">tender-ai-db</span>
            </a>
            <button
              onClick={handleCopyCig}
              className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-sm font-medium"
            >
              {cigCopied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
              {cigCopied ? "CIG copiato" : `Copia CIG ${tender.cig}`}
            </button>
          </div>

          {/* Cross-link to company search in /gare */}
          {ragioneSociale && (
            <div className="rounded-lg bg-muted/30 border p-3">
              <p className="text-xs text-muted-foreground mb-2">
                Vuoi vedere tutte le gare di questa azienda?
              </p>
              <a
                href={`/gare?q=${encodeURIComponent(ragioneSociale)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Building2 className="h-3 w-3" />
                Cerca &quot;{ragioneSociale}&quot; in Gare
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ProfilazionePage() {
  const [piva, setPiva] = useState("")
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [matches, setMatches] = useState<TenderMatch[]>([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [historicalTenders, setHistoricalTenders] = useState<HistoricalTender[]>([])
  const [showHistorical, setShowHistorical] = useState(false)
  const [candidates, setCandidates] = useState<{ partita_iva: string; denominazione: string }[]>([])

  // ── New interactive state ──
  const [selectedTender, setSelectedTender] = useState<TenderMatch | null>(null)
  const [expandedCpv, setExpandedCpv] = useState<string | null>(null)
  const [activeProvinceFilter, setActiveProvinceFilter] = useState<string | null>(null)
  const [highlightedCpv, setHighlightedCpv] = useState<string | null>(null)

  // ── Refs for scroll-to-section ──
  const cpvSectionRef = useRef<HTMLDivElement>(null)
  const bandiSectionRef = useRef<HTMLDivElement>(null)

  // ── ANAC Live Relay ──
  const anacRelay = useAnacRelay()
  const [anacSource, setAnacSource] = useState<"live" | "cached" | null>(null)

  // ── Auto-detection: P.IVA/CF (numerico) o ragione sociale (testo) ──
  const isNumericInput = useMemo(() => detectIsNumeric(piva), [piva])
  const isValid = useMemo(() => isValidPivaFormat(piva), [piva])
  const isSearchValid = useMemo(() => {
    if (isNumericInput) return piva.trim().replace(/[\s\-\.]/g, "").replace(/^IT/i, "").length >= 6
    return piva.trim().length >= 3 // ragione sociale min 3 caratteri
  }, [isNumericInput, piva])

  // ── Filtered matches (by province) ──
  const filteredMatches = useMemo(() => {
    if (!activeProvinceFilter) return matches
    return matches.filter(
      (m) => m.provincia && m.provincia.toUpperCase() === activeProvinceFilter.toUpperCase()
    )
  }, [matches, activeProvinceFilter])

  // ── Scroll to CPV section and highlight ──
  const handleScrollToCpv = useCallback((cpvCode: string) => {
    setHighlightedCpv(cpvCode)
    cpvSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    // Auto-expand the matching CPV entry
    setExpandedCpv(cpvCode)
    // Clear highlight after animation
    setTimeout(() => setHighlightedCpv(null), 2000)
  }, [])

  // ── Scroll to bandi section with optional CPV filter visual ──
  const handleScrollToBandi = useCallback((cpvCode: string) => {
    bandiSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    setHighlightedCpv(cpvCode)
    setTimeout(() => setHighlightedCpv(null), 2000)
  }, [])

  // ── Province filter handler ──
  const handleProvinceClick = useCallback((provinceName: string) => {
    setActiveProvinceFilter((prev) => prev === provinceName ? null : provinceName)
    bandiSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!isSearchValid) return

    setLoading(true)
    setError(null)
    setProfile(null)
    setMatches([])
    setHistoricalTenders([])
    setShowHistorical(false)
    setCandidates([])
    setSelectedTender(null)
    setExpandedCpv(null)
    setActiveProvinceFilter(null)
    setHighlightedCpv(null)
    setAnacSource(null)

    try {
      // ── Se il relay ANAC è connesso e l'input è numerico (P.IVA/CF),
      //    query ANAC live per dati completi con CPV ──
      let anacData: Record<string, unknown>[] | undefined
      const cleanQuery = piva.trim().replace(/[\s\-\.]/g, "").replace(/^IT/i, "")

      if (anacRelay.connected && detectIsNumeric(piva)) {
        try {
          const anacResult = await anacRelay.query(cleanQuery)
          if (anacResult.rows && anacResult.rows.length > 0) {
            anacData = anacResult.rows as Record<string, unknown>[]
            setAnacSource("live")
          }
        } catch (anacErr) {
          console.warn("[Profiling] ANAC relay query failed, fallback to cached:", anacErr)
        }
      }

      // Unified query: backend auto-detects P.IVA vs ragione sociale
      // Se abbiamo dati ANAC live, li passiamo al backend per merge/arricchimento
      const res = await fetch("/api/profiling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: piva.trim(),
          ...(anacData ? { anacData } : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Errore ${res.status}`)
      }

      const data = await res.json()

      // If API returned multiple candidates, show selection list
      if (data.candidates && Array.isArray(data.candidates)) {
        setCandidates(data.candidates)
        setLoading(false)
        return
      }

      setProfile(data.profile)
      if (!anacSource && data.profile) setAnacSource("cached")

      // Store historical tenders if returned
      if (data.recent_tenders && Array.isArray(data.recent_tenders)) {
        setHistoricalTenders(data.recent_tenders)
      }

      // Auto-fetch matching tenders if we have CPV codes
      if (data.profile.cpv_codes.length > 0) {
        setMatchesLoading(true)
        try {
          const matchRes = await fetch("/api/profiling/match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cpv_codes: data.profile.cpv_codes.map((c: CpvEntry) => c.code),
              provincia: data.profile.province[0]?.name,
              limit: 20,
            }),
          })
          if (matchRes.ok) {
            const matchData = await matchRes.json()
            setMatches(matchData.matches || [])
          }
        } catch (matchErr) {
          console.warn("Errore nel recupero dei bandi compatibili:", matchErr)
          setMatches([])
        } finally {
          setMatchesLoading(false)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore nell'analisi")
    } finally {
      setLoading(false)
    }
  }, [piva, isSearchValid, anacRelay, anacSource])

  const handleSelectCandidate = useCallback((pivaSelected: string) => {
    setCandidates([])
    setPiva(pivaSelected)
    // Trigger analysis with selected P.IVA
    setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/profiling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: pivaSelected }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `Errore ${res.status}`)
        }
        const data = await res.json()
        setProfile(data.profile)
        if (data.recent_tenders) setHistoricalTenders(data.recent_tenders)
        if (data.profile.cpv_codes.length > 0) {
          setMatchesLoading(true)
          try {
            const matchRes = await fetch("/api/profiling/match", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cpv_codes: data.profile.cpv_codes.map((c: CpvEntry) => c.code) }),
            })
            if (matchRes.ok) {
              const matchData = await matchRes.json()
              setMatches(matchData.matches || [])
            }
          } finally { setMatchesLoading(false) }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore sconosciuto")
      } finally { setLoading(false) }
    }, 0)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleAnalyze()
    },
    [handleAnalyze]
  )

  const handleCopyPiva = useCallback(async () => {
    if (!profile) return
    await navigator.clipboard.writeText(profile.partita_iva)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [profile])

  const maxCpvCount = useMemo(
    () => Math.max(...(profile?.cpv_codes.map((c) => c.count) ?? [1]), 1),
    [profile]
  )

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <SiteNav variant="profilazione" />

      {/* ── Hero ── */}
      <section className="relative border-b border-border overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 0% 0%, oklch(0.52 0.22 160 / 0.10) 0%, transparent 70%)",
          }}
        />

        <div className="container mx-auto px-4 sm:px-6 py-10 sm:py-14 md:py-20">
          <div className="max-w-3xl space-y-5">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-semibold">
                Profilazione Rapida
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] text-foreground">
              Analisi aziendale<br className="hidden sm:block" /> istantanea
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-[52ch]">
              Inserisci una Partita IVA o il nome dell&apos;azienda e ottieni in
              pochi secondi il profilo completo: codici CPV, storico appalti,
              copertura territoriale e bandi compatibili.
            </p>

            {/* Stat chips */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { value: "< 3s", label: "tempo di analisi" },
                { value: "CPV", label: "codici estratti" },
                { value: "ANAC", label: "dati ufficiali" },
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
                  <span className="text-foreground font-bold tabular-nums">
                    {chip.value}
                  </span>
                  <span className="text-muted-foreground">{chip.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Content ── */}
      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1">
        {/* ── Input Section ── */}
        <div className="border rounded-xl overflow-hidden mb-8">
          <div className="bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold flex items-center gap-2">
              <Search className="h-4 w-4" />
              Cerca azienda
            </span>
            <AnacConnectButton
              connected={anacRelay.connected}
              onConnect={anacRelay.connect}
              onDisconnect={anacRelay.disconnect}
            />
          </div>
          <div className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  maxLength={100}
                  value={piva}
                  onChange={(e) => setPiva(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Inserisci P.IVA o Ragione Sociale"
                  className={`pl-10 h-12 text-base ${isNumericInput ? "font-mono tracking-wider" : ""}`}
                />
                {isNumericInput && piva && !isValid && piva.replace(/[\s\-\.]/g, "").replace(/^IT/i, "").length >= 11 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-amber-500 font-medium">
                    Checksum P.IVA non valido — potrebbe essere un CF
                  </span>
                )}
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={loading || !isSearchValid}
                className="h-12 px-6 text-sm font-medium gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analisi...
                  </>
                ) : (
                  <>
                    <Target className="h-4 w-4" />
                    Analizza Profilo
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3 max-w-2xl">
              Inserisci una Partita IVA, un Codice Fiscale o il nome dell&apos;azienda.
              I dati vengono cercati nell&apos;archivio ANAC, nella banca dati SCP/MIT e sul TED europeo.
            </p>
            {anacSource && (
              <div className="mt-2 flex items-center gap-2">
                {anacSource === "live" ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold text-emerald-600">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    📡 Dati live da ANAC Superset
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border text-[10px] font-medium text-muted-foreground">
                    💾 Dati cached + SCP/MIT + TED
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/5">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />
              <span className="text-sm text-rose-700 dark:text-rose-400 flex-1">
                {error}
              </span>
              <button
                onClick={() => setError(null)}
                className="text-rose-400 hover:text-rose-600 transition-colors text-sm"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* ── Candidates Selection (multiple name matches) ── */}
        {candidates.length > 0 && (
          <div className="mb-6">
            <div className="border rounded-xl overflow-hidden">
              <div className="bg-foreground text-background px-4 sm:px-5 py-3">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Seleziona l&apos;azienda
                </span>
                <span className="text-xs text-background/70 mt-0.5 block">
                  Trovate {candidates.length} aziende corrispondenti. Seleziona quella corretta.
                </span>
              </div>
              <div className="divide-y">
                {candidates.map((c) => (
                  <button
                    key={c.partita_iva}
                    onClick={() => handleSelectCandidate(c.partita_iva)}
                    className="w-full px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors text-left cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{c.denominazione}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">P.IVA {c.partita_iva}</p>
                    </div>
                    <span className="text-xs font-medium text-primary shrink-0 flex items-center gap-1">
                      Seleziona
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
              <Loader2 className="relative h-12 w-12 text-primary animate-spin" />
            </div>
            <p className="text-muted-foreground mt-6 text-sm">
              Analisi dei dati pubblici ANAC in corso...
            </p>
            <div className="flex items-center gap-2 mt-3">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        {/* ── Profile Results ── */}
        {profile && !loading && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* ── Section 1: Anagrafica ── */}
            <section className="border rounded-xl overflow-hidden">
              <div className="bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Anagrafica Aziendale
                </span>
                <button
                  onClick={handleCopyPiva}
                  className="flex items-center gap-1.5 text-xs text-background/70 hover:text-background transition-colors"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiata" : "Copia P.IVA"}
                </button>
              </div>
              <div className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-foreground mb-1">
                      {profile.ragione_sociale || "Azienda"}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-mono text-xs">P.IVA {profile.partita_iva}</span>
                      {profile.sede && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {profile.sede}
                        </span>
                      )}
                      {profile.regione && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                          {profile.regione}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <StatCard
                    label="Gare totali"
                    value={profile.totale_gare.toLocaleString("it-IT")}
                    icon={<FileText className="h-4 w-4" />}
                    accent="primary"
                  />
                  <StatCard
                    label="Gare vinte"
                    value={profile.gare_vinte.toLocaleString("it-IT")}
                    icon={<TrendingUp className="h-4 w-4" />}
                    accent="emerald"
                  />
                  <StatCard
                    label="Tasso successo"
                    value={`${profile.tasso_successo ?? 0}%`}
                    icon={<Target className="h-4 w-4" />}
                    accent="primary"
                  />
                  <StatCard
                    label="Volume totale"
                    value={formatCurrency(profile.importo_totale)}
                    icon={<BarChart3 className="h-4 w-4" />}
                    accent="amber"
                  />
                  <StatCard
                    label="Valore medio"
                    value={formatCurrency(profile.importo_medio)}
                    icon={<Target className="h-4 w-4" />}
                    accent="rose"
                  />
                </div>

                {(profile.prima_gara || profile.ultima_gara) && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 pt-4 border-t text-xs text-muted-foreground">
                    {profile.prima_gara && (
                      <span>Prima gara: <strong className="text-foreground">{formatDate(profile.prima_gara)}</strong></span>
                    )}
                    {profile.ultima_gara && (
                      <span>Ultima gara: <strong className="text-foreground">{formatDate(profile.ultima_gara)}</strong></span>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* ── Section 1.5: Storico Gare Aggiudicate (espandibile) ── */}
            {historicalTenders.length > 0 && (
              <section className="border rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowHistorical(!showHistorical)}
                  className="w-full bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-foreground/90 transition-colors"
                >
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Storico gare aggiudicate
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-background/70">
                      {historicalTenders.length} gare
                    </span>
                    <ChevronRight className={`h-4 w-4 text-background/70 transition-transform duration-200 ${showHistorical ? "rotate-90" : ""}`} />
                  </span>
                </button>

                {/* Preview: always show first 3 */}
                {!showHistorical && (
                  <div className="divide-y">
                    {historicalTenders.slice(0, 3).map((tender) => (
                      <div key={tender.cig} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{tender.oggetto_gara}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <code className="font-mono text-[10px]">{tender.cig}</code>
                            {tender.provincia && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-2.5 w-2.5" />
                                {tender.provincia}
                              </span>
                            )}
                          </div>
                        </div>
                        {tender.importo != null && (
                          <span className="text-xs font-semibold tabular-nums shrink-0">{formatCurrency(tender.importo)}</span>
                        )}
                      </div>
                    ))}
                    {historicalTenders.length > 3 && (
                      <button
                        onClick={() => setShowHistorical(true)}
                        className="w-full px-4 py-2.5 text-xs text-primary font-medium hover:bg-muted/30 transition-colors flex items-center justify-center gap-1"
                      >
                        Mostra tutte le {historicalTenders.length} gare
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Expanded: show all */}
                {showHistorical && (
                  <div className="divide-y max-h-[60vh] overflow-y-auto">
                    {historicalTenders.map((tender, i) => (
                      <div key={`${tender.cig}-${i}`} className="px-4 sm:px-5 py-3 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug mb-1">{tender.oggetto_gara}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <code className="font-mono text-[10px]">{tender.cig}</code>
                              {tender.provincia && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-2.5 w-2.5" />
                                  {tender.provincia}
                                </span>
                              )}
                              {tender.data_aggiudicazione && (
                                <span>{formatDate(tender.data_aggiudicazione)}</span>
                              )}
                              {tender.descrizione_cpv && (
                                <span className="truncate max-w-[200px]" title={tender.descrizione_cpv}>
                                  CPV: {tender.descrizione_cpv}
                                </span>
                              )}
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                                {tender.source === "scp_mit" ? "SCP/MIT" : tender.source === "ted" ? "TED" : "ANAC"}
                              </Badge>
                            </div>
                          </div>
                          {tender.importo != null && (
                            <span className="text-sm font-semibold tabular-nums shrink-0">{formatCurrency(tender.importo)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setShowHistorical(false)}
                      className="w-full px-4 py-2.5 text-xs text-muted-foreground font-medium hover:bg-muted/30 transition-colors flex items-center justify-center gap-1 sticky bottom-0 bg-background border-t"
                    >
                      Comprimi lista
                      <ChevronRight className="h-3 w-3 -rotate-90" />
                    </button>
                  </div>
                )}
              </section>
            )}
            {/* ── Section 2: CPV Strategy Map ── */}
            {profile.cpv_codes.length > 0 && (
              <section ref={cpvSectionRef} className="border rounded-xl overflow-hidden">
                <div className="bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    CPV Strategy Map
                  </span>
                  <a
                    href="/codici-cpv"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-background/70 hover:text-background transition-colors"
                  >
                    Esplora tutti i CPV
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="p-4 sm:p-6">
                  {/* Divisions overview */}
                  {profile.cpv_divisions.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                        Divisioni CPV principali
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {profile.cpv_divisions.map((d) => (
                          <DivisionChip key={d.division} division={d} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Detailed CPV codes */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Codici CPV dettagliati ({profile.cpv_codes.length})
                      <span className="normal-case font-normal ml-2 text-muted-foreground/70">— clicca per espandere</span>
                    </h3>
                    <div className="divide-y">
                      {profile.cpv_codes.slice(0, 15).map((cpv) => (
                        <CpvBar
                          key={cpv.code}
                          entry={cpv}
                          maxCount={maxCpvCount}
                          isExpanded={expandedCpv === cpv.code}
                          onToggle={() => setExpandedCpv(expandedCpv === cpv.code ? null : cpv.code)}
                          onScrollToBandi={handleScrollToBandi}
                        />
                      ))}
                    </div>
                    {profile.cpv_codes.length > 15 && (
                      <p className="text-xs text-muted-foreground mt-3 text-center">
                        e altri {profile.cpv_codes.length - 15} codici CPV...
                      </p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ── Section 3: Copertura Territoriale & Tipi Contratto ── */}
            {(profile.province.length > 0 || profile.tipi_contratto.length > 0) && (
              <div className="grid md:grid-cols-2 gap-6">
                {/* Province */}
                {profile.province.length > 0 && (
                  <section className="border rounded-xl overflow-hidden">
                    <div className="bg-foreground text-background px-4 sm:px-5 py-3">
                      <span className="text-sm font-semibold flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Copertura Territoriale
                      </span>
                    </div>
                    <div className="p-4 sm:p-5">
                      <p className="text-[10px] text-muted-foreground mb-3">Clicca una provincia per filtrare i bandi compatibili</p>
                      <div className="space-y-1">
                        {profile.province.slice(0, 10).map((p) => {
                          const isActive = activeProvinceFilter === p.name
                          const matchingBandi = matches.filter(
                            (m) => m.provincia && m.provincia.toUpperCase() === p.name.toUpperCase()
                          ).length
                          return (
                            <button
                              key={p.name}
                              onClick={() => handleProvinceClick(p.name)}
                              className={`
                                flex items-center justify-between py-2 px-2.5 text-sm w-full rounded-lg
                                transition-all duration-200 cursor-pointer text-left
                                ${isActive
                                  ? "bg-primary/10 ring-2 ring-primary/40 border-primary/20"
                                  : "hover:bg-muted/50"
                                }
                              `}
                            >
                              <span className="flex items-center gap-2">
                                <MapPin className={`h-3 w-3 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                                <span className={isActive ? "font-medium text-primary" : ""}>{p.name}</span>
                              </span>
                              <span className="flex items-center gap-2">
                                {matchingBandi > 0 && (
                                  <span className="text-[10px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">
                                    {matchingBandi} bandi
                                  </span>
                                )}
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {p.count} {p.count === 1 ? "gara" : "gare"}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </section>
                )}

                {/* Contract types */}
                {profile.tipi_contratto.length > 0 && (
                  <section className="border rounded-xl overflow-hidden">
                    <div className="bg-foreground text-background px-4 sm:px-5 py-3">
                      <span className="text-sm font-semibold flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Tipologie di Contratto
                      </span>
                    </div>
                    <div className="p-4 sm:p-5">
                      <div className="space-y-3">
                        {profile.tipi_contratto.map((t) => (
                          <div key={t.tipo}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">{t.tipo}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {t.count} ({t.percentage.toFixed(0)}%)
                              </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className="h-2 rounded-full bg-primary transition-all duration-700"
                                style={{ width: `${t.percentage}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* ── Section 4: Bandi Compatibili ── */}
            <section ref={bandiSectionRef} className="border rounded-xl overflow-hidden">
              <div className="bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Bandi Compatibili
                </span>
                <span className="text-xs text-background/70">
                  {activeProvinceFilter
                    ? `${filteredMatches.length} di ${matches.length} bandi`
                    : matches.length > 0
                    ? `${matches.length} bandi trovati`
                    : null
                  }
                </span>
              </div>
              <div className="p-4 sm:p-6">
                {/* Province filter badge */}
                {activeProvinceFilter && (
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                    <Filter className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs text-muted-foreground">Filtro attivo:</span>
                    <Badge variant="outline" className="gap-1 text-xs">
                      <MapPin className="h-2.5 w-2.5" />
                      {activeProvinceFilter}
                      <button
                        onClick={() => setActiveProvinceFilter(null)}
                        className="ml-1 rounded-full hover:bg-muted p-0.5 transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  </div>
                )}

                {matchesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground ml-3">
                      Ricerca bandi compatibili...
                    </span>
                  </div>
                ) : filteredMatches.length > 0 ? (
                  <div className="space-y-3">
                    {filteredMatches.map((tender) => (
                      <MatchCard
                        key={tender.cig}
                        tender={tender}
                        onClick={() => setSelectedTender(tender)}
                        onCpvClick={handleScrollToCpv}
                        highlightedCpv={highlightedCpv}
                      />
                    ))}
                  </div>
                ) : activeProvinceFilter && matches.length > 0 ? (
                  <div className="text-center py-12">
                    <Filter className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Nessun bando nella provincia di {activeProvinceFilter}
                    </p>
                    <button
                      onClick={() => setActiveProvinceFilter(null)}
                      className="text-xs text-primary hover:underline"
                    >
                      Rimuovi filtro e mostra tutti i {matches.length} bandi
                    </button>
                  </div>
                ) : profile.cpv_codes.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Nessun codice CPV trovato nello storico
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Questa P.IVA potrebbe non avere gare pubbliche registrate su ANAC.{" "}
                      <a href="/codici-cpv" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Esplora i codici CPV manualmente
                      </a>
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Nessun bando attivo trovato per i CPV di questa azienda.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* ── Quick Actions Bar ── */}
            {matches.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3">
                {profile.ragione_sociale && (
                  <a
                    href={`/gare?q=${encodeURIComponent(profile.ragione_sociale)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all text-sm font-medium group"
                  >
                    <Search className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    Cerca tutte le gare di {profile.ragione_sociale}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                )}
                <a
                  href="/ricerca-gare"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all text-sm font-medium group"
                >
                  <Zap className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  Analisi avanzata
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              </div>
            )}

            {/* ── Tender Detail Sheet ── */}
            <TenderDetailSheet
              tender={selectedTender}
              open={selectedTender !== null}
              onOpenChange={(open) => { if (!open) setSelectedTender(null) }}
              onCpvClick={handleScrollToCpv}
              ragioneSociale={profile.ragione_sociale}
            />

            {/* ── Empty state hint ── */}
            {profile.totale_gare === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/5 p-6 text-center">
                <AlertCircle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-foreground mb-1">
                  Nessun dato disponibile per questa P.IVA
                </h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  L&apos;azienda non risulta avere gare pubbliche registrate nel database ANAC.
                  Puoi esplorare i codici CPV manualmente per trovare bandi nel tuo settore.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/codici-cpv" className="gap-2">
                      <Search className="h-4 w-4" />
                      Esplora Codici CPV
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/gare" className="gap-2">
                      <FileText className="h-4 w-4" />
                      Cerca Gare
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Initial empty state ── */}
        {!profile && !loading && !error && (
          <div className="rounded-xl border p-14 text-center">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-primary/10 blur-xl animate-pulse" />
              <div className="relative w-20 h-20 rounded-2xl bg-primary/5 border flex items-center justify-center">
                <Building2 className="h-10 w-10 text-primary" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Profilazione Aziendale Istantanea
            </h2>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto leading-relaxed">
              Inserisci una Partita IVA o il nome dell&apos;azienda per ottenere
              il profilo completo: codici CPV, storico appalti, copertura
              territoriale e bandi compatibili.
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-[11px] text-muted-foreground">
              {[
                { icon: <Zap className="h-3 w-3" />, label: "Analisi in < 3 secondi" },
                { icon: <BarChart3 className="h-3 w-3" />, label: "CPV Strategy Map" },
                { icon: <MapPin className="h-3 w-3" />, label: "Copertura territoriale" },
                { icon: <Target className="h-3 w-3" />, label: "Matching bandi attivi" },
              ].map((f) => (
                <span key={f.label} className="flex items-center gap-1.5">
                  {f.icon}
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-7 mt-auto">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground font-medium tracking-wide">
              Tender AI DB
            </span>
            <p className="text-xs text-muted-foreground text-center">
              Dati da{" "}
              <a
                href="https://dati.anticorruzione.it"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline underline-offset-2"
              >
                ANAC
              </a>
              {" · "}
              Vocabolario{" "}
              <Link
                href="/codici-cpv"
                className="text-primary hover:underline underline-offset-2"
              >
                CPV 2008
              </Link>
            </p>
            <span className="text-[10px] text-muted-foreground/50 tracking-[0.12em] uppercase">
              Profilazione Rapida
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}
