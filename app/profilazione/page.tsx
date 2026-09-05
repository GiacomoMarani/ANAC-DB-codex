"use client"

/**
 * app/profilazione/page.tsx
 * Profilazione Rapida — Analisi CPV e verifica requisiti aziendali via P.IVA
 *
 * Feature differenziante: inserendo una Partita IVA si ottiene in pochi secondi
 * il profilo aziendale con codici CPV, storico gare, copertura territoriale
 * e matching istantaneo con i bandi attivi.
 *
 * Competitor (Bandolo/Cato) richiedono upload manuali di documenti.
 * Noi estraiamo tutto automaticamente dallo storico ANAC.
 */

import { useState, useCallback, useMemo, type ReactNode } from "react"
import Link from "next/link"
import { SiteNav } from "@/components/site-nav"
import {
  Search, Loader2, Building2, MapPin, TrendingUp,
  FileText, ArrowRight, Copy, Check, BarChart3,
  ChevronRight, AlertCircle, Zap, Shield, Target,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Validazione P.IVA lato client (formato rapido, 11 cifre) */
function isValidPivaFormat(piva: string): boolean {
  const clean = piva.replace(/[\s\-\.]/g, "")
  return /^\d{11}$/.test(clean)
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

function CpvBar({ entry, maxCount }: { entry: CpvEntry; maxCount: number }) {
  const width = maxCount > 0 ? (entry.count / maxCount) * 100 : 0

  return (
    <div className="group py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <code className="text-xs font-mono text-primary font-semibold shrink-0">
            {entry.code}
          </code>
          <span className="text-sm truncate" title={entry.description}>
            {entry.description}
          </span>
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
    </div>
  )
}

function DivisionChip({
  division,
}: {
  division: CpvDivision
}) {
  return (
    <Link
      href={`/codici-cpv?q=${encodeURIComponent(division.label)}`}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:border-primary/50 hover:shadow-sm transition-all text-sm group"
    >
      <code className="text-xs font-mono text-primary font-bold">{division.division}</code>
      <span className="truncate max-w-[200px]" title={division.label}>
        {division.label}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {division.percentage.toFixed(0)}%
      </span>
      <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
    </Link>
  )
}

function MatchCard({ tender }: { tender: TenderMatch }) {
  const isExpired = tender.data_scadenza && new Date(tender.data_scadenza) < new Date()

  return (
    <div className="border rounded-xl p-4 bg-card hover:shadow-sm transition-shadow">
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
          <p className="text-sm font-medium leading-snug mb-1 line-clamp-2">
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
                <span
                  key={cpv}
                  className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded bg-primary/10 text-primary"
                >
                  {cpv}
                </span>
              ))}
            </div>
          )}
        </div>
        <code className="text-[10px] text-muted-foreground font-mono shrink-0">
          {tender.cig}
        </code>
      </div>
    </div>
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

  const isValid = useMemo(() => isValidPivaFormat(piva), [piva])

  const handleAnalyze = useCallback(async () => {
    if (!isValid) return

    const cleanPiva = piva.replace(/[\s\-\.]/g, "")
    setLoading(true)
    setError(null)
    setProfile(null)
    setMatches([])

    try {
      const res = await fetch("/api/profiling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partita_iva: cleanPiva }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Errore ${res.status}`)
      }

      const data = await res.json()
      setProfile(data.profile)

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
          // Log the error so it's traceable; matches are optional but the user
          // should know if the API failed rather than seeing "no results"
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
  }, [piva, isValid])

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
              Inserisci una Partita IVA e ottieni in pochi secondi il profilo
              completo: codici CPV, storico appalti, copertura territoriale e
              bandi compatibili.
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
              Inserisci la Partita IVA
            </span>
          </div>
          <div className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
              <div className="flex-1 relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={13}
                  value={piva}
                  onChange={(e) => setPiva(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Es. 12345678901"
                  className="pl-10 h-12 text-base font-mono tracking-wider"
                />
                {piva && !isValid && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-rose-500 font-medium">
                    11 cifre richieste
                  </span>
                )}
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={loading || !isValid}
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
              La Partita IVA viene usata per cercare lo storico appalti pubblici
              dall&apos;ANAC. I dati sono pubblici e non vengono memorizzati.
            </p>
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

            {/* ── Section 2: CPV Strategy Map ── */}
            {profile.cpv_codes.length > 0 && (
              <section className="border rounded-xl overflow-hidden">
                <div className="bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    CPV Strategy Map
                  </span>
                  <Link
                    href="/codici-cpv"
                    className="flex items-center gap-1 text-xs text-background/70 hover:text-background transition-colors"
                  >
                    Esplora tutti i CPV
                    <ArrowRight className="h-3 w-3" />
                  </Link>
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
                    </h3>
                    <div className="divide-y">
                      {profile.cpv_codes.slice(0, 15).map((cpv) => (
                        <CpvBar key={cpv.code} entry={cpv} maxCount={maxCpvCount} />
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
                      <div className="space-y-2">
                        {profile.province.slice(0, 10).map((p) => (
                          <div
                            key={p.name}
                            className="flex items-center justify-between py-1.5 text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <MapPin className="h-3 w-3 text-muted-foreground" />
                              {p.name}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {p.count} {p.count === 1 ? "gara" : "gare"}
                            </span>
                          </div>
                        ))}
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
            <section className="border rounded-xl overflow-hidden">
              <div className="bg-foreground text-background px-4 sm:px-5 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Bandi Compatibili
                </span>
                {matches.length > 0 && (
                  <span className="text-xs text-background/70">
                    {matches.length} bandi trovati
                  </span>
                )}
              </div>
              <div className="p-4 sm:p-6">
                {matchesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground ml-3">
                      Ricerca bandi compatibili...
                    </span>
                  </div>
                ) : matches.length > 0 ? (
                  <div className="space-y-3">
                    {matches.map((tender) => (
                      <MatchCard key={tender.cig} tender={tender} />
                    ))}
                  </div>
                ) : profile.cpv_codes.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Nessun codice CPV trovato nello storico
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Questa P.IVA potrebbe non avere gare pubbliche registrate su ANAC.{" "}
                      <Link href="/codici-cpv" className="text-primary hover:underline">
                        Esplora i codici CPV manualmente
                      </Link>
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
              Inserisci una Partita IVA per ottenere il profilo completo
              dell&apos;azienda: codici CPV, storico appalti, copertura
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
