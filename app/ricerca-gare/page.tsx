"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { ArrowLeft, Globe, Loader2, CheckCircle2, Circle, Search, Euro, Clock, X, ChevronLeft, Mail, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { buildAnacCigUrl } from "@/lib/sources/types"

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompanyProfile {
  name: string
  sector: string
  description: string
}

interface AnalysisResult {
  lead_id: string
  company: CompanyProfile
  keywords: string[]
  cpv_ids: string[]
}

interface TenderItem {
  id: number
  cig: string
  oggetto: string | null
  importo: number | null
  stato: string | null
  data_scadenza: string | null
  tipo_contratto: string | null
  descrizione_cpv: string | null
  provincia: string | null
}

interface WidgetResponse { items: TenderItem[] }

type Step = "input" | "analyzing" | "results"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(v: number | null) {
  if (!v) return null
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v)
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
}

function ScadenzaBadge({ data }: { data: string | null }) {
  const days = daysUntil(data)
  if (days === null) return null
  const label = days <= 0 ? "Scaduta" : days === 1 ? "Scade domani" : `Scade tra ${days} giorni`
  const color = days <= 3 ? "text-orange-500" : days <= 10 ? "text-yellow-600" : "text-green-600"
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}><Clock className="h-3 w-3" />{label}</span>
}

// ─── Steps ────────────────────────────────────────────────────────────────────

const ANALYSIS_STEPS = [
  "Analisi del profilo aziendale...",
  "Identificazione settore e servizi...",
  "Ricerca gare pertinenti nel database ANAC...",
]

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RicercaGarePage() {
  const [step, setStep]           = useState<Step>("input")
  const [url, setUrl]             = useState("")
  const [analysis, setAnalysis]   = useState<AnalysisResult | null>(null)
  const [tenders, setTenders]     = useState<TenderItem[]>([])
  const [totalTenders, setTotalTenders] = useState(0)
  const [searchKw, setSearchKw]   = useState("")
  const [filteredTenders, setFilteredTenders] = useState<TenderItem[] | null>(null)
  const [analysisStep, setAnalysisStep] = useState(0)
  const [error, setError]         = useState("")
  const [reportModalId, setReportModalId] = useState<number | null>(null)
  const [reportForm, setReportForm] = useState({ nome: "", cognome: "", email: "" })
  const [reportSent, setReportSent] = useState(false)

  // Step 1: analyze site
  const handleAnalyze = useCallback(async () => {
    if (!url.trim()) return
    const urlToAnalyze = url.startsWith("http") ? url : `https://${url}`

    setStep("analyzing")
    setError("")
    setAnalysisStep(0)

    // Simulate step progression
    const stepTimer1 = setTimeout(() => setAnalysisStep(1), 1200)
    const stepTimer2 = setTimeout(() => setAnalysisStep(2), 2400)

    try {
      const res = await fetch("/api/edge/analyze-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToAnalyze }),
      })
      if (!res.ok) throw new Error("Errore nell'analisi del sito")
      const data: AnalysisResult = await res.json()
      setAnalysis(data)

      // Fetch matching tenders
      const kwParam = encodeURIComponent(data.keywords.join(","))
      const cpvParam = encodeURIComponent(data.cpv_ids[0] ?? "")
      const widgetRes = await fetch(`/api/tenders/widget?cpv=${cpvParam}&kw=${kwParam}`)
      const widgetData: WidgetResponse = await widgetRes.json()
      setTenders(widgetData.items || [])
      setTotalTenders((widgetData.items || []).length)

      clearTimeout(stepTimer1); clearTimeout(stepTimer2)
      setStep("results")
    } catch (err) {
      clearTimeout(stepTimer1); clearTimeout(stepTimer2)
      setError(err instanceof Error ? err.message : "Errore durante l'analisi")
      setStep("input")
    }
  }, [url])

  // Widget search
  const handleWidgetSearch = useCallback(async () => {
    if (!analysis) return
    const kwParam = encodeURIComponent([...analysis.keywords, searchKw].filter(Boolean).join(","))
    const cpvParam = encodeURIComponent(analysis.cpv_ids[0] ?? "")
    const res = await fetch(`/api/tenders/widget?cpv=${cpvParam}&kw=${kwParam}&q=${encodeURIComponent(searchKw)}`)
    const data: WidgetResponse = await res.json()
    setFilteredTenders(data.items || [])
  }, [analysis, searchKw])

  const displayedTenders = filteredTenders ?? tenders

  // ── Input Step ──────────────────────────────────────────────────────────────
  if (step === "input") {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="container mx-auto px-4 py-4">
            <Link href="/gare" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
              <ArrowLeft className="h-4 w-4" /> Torna alla home
            </Link>
          </div>
        </header>

        <main className="container mx-auto px-4 py-16 max-w-4xl">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Analisi Avanzata di Gare d&apos;Appalto
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Ottimizza il tuo processo di valutazione dei bandi. Riduci i tempi di lettura ed evidenzia i requisiti chiave in pochi istanti.
            </p>
          </div>

          {/* URL Input */}
          <div className="flex gap-3 max-w-xl mx-auto mb-4">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="company-url"
                type="url"
                placeholder="Inserisci il sito web della tua azienda"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAnalyze()}
                className="pl-10 h-12 text-base"
              />
            </div>
            <Button size="lg" onClick={handleAnalyze} className="px-8 h-12" id="btn-analizza">
              Continua →
            </Button>
          </div>
          {error && <p className="text-center text-destructive text-sm mt-2">{error}</p>}

          {/* Comparison Cards */}
          <div className="grid md:grid-cols-2 gap-6 mt-16">
            <div className="border rounded-2xl p-6 bg-card">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">✗</span>
                <h3 className="font-semibold text-lg">Senza questo strumento</h3>
              </div>
              <ul className="space-y-3 text-muted-foreground text-sm">
                <li className="flex items-start gap-2"><span className="text-orange-400 mt-0.5">✗</span>Ore spese a leggere decine di pagine di PDF complessi.</li>
                <li className="flex items-start gap-2"><span className="text-orange-400 mt-0.5">✗</span>Rischio elevato di perdere requisiti fondamentali nascosti tra le righe.</li>
                <li className="flex items-start gap-2"><span className="text-orange-400 mt-0.5">✗</span>Difficoltà nel calcolare rapidamente il punteggio tecnico ed economico.</li>
              </ul>
            </div>
            <div className="border-2 border-primary rounded-2xl p-6 bg-card relative">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">✓</span>
                <h3 className="font-semibold text-lg">Con ANAC Explorer AI</h3>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2 text-emerald-600"><span className="mt-0.5">✓</span>Estrazione immediata dei dati chiave in un formato leggibile.</li>
                <li className="flex items-start gap-2 text-emerald-600"><span className="mt-0.5">✓</span>Highlight automatico di requisiti vincolanti e clausole penali.</li>
                <li className="flex items-start gap-2 text-emerald-600"><span className="mt-0.5">✓</span>Simulazione istantanea dei punteggi per valutare la convenienza.</li>
              </ul>
            </div>
          </div>

          {/* Features */}
          <div className="mt-16">
            <h3 className="text-xl font-semibold text-center mb-8">Cosa comprende l&apos;analisi</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { n: 1, t: "Riepilogo e requisiti", d: "Importo, tipo procedura, criterio di aggiudicazione, requisiti di partecipazione." },
                { n: 2, t: "Prodotti richiesti", d: "Tabella dettagliata con caratteristiche tecniche, certificazioni e prezzi stimati." },
                { n: 3, t: "Garanzie e scadenze", d: "Garanzia provvisoria, definitiva, campionatura e note operative sul sopralluogo." },
                { n: 4, t: "Red flag e criticità", d: "Elementi di attenzione, incongruenze e rischi identificati nei documenti di gara." },
              ].map(f => (
                <div key={f.n} className="flex gap-4 p-4 border rounded-xl bg-card hover:border-primary/40 transition-colors cursor-pointer">
                  <span className="text-2xl font-bold text-primary/30">{f.n}</span>
                  <div>
                    <p className="font-semibold text-sm mb-1">{f.t}</p>
                    <p className="text-xs text-muted-foreground">{f.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── Analyzing Step ───────────────────────────────────────────────────────────
  if (step === "analyzing") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="relative inline-block mb-8">
            <div className="h-20 w-20 rounded-full border-4 border-primary/20 flex items-center justify-center mx-auto">
              <Search className="h-8 w-8 text-primary animate-pulse" />
            </div>
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Elaborazione in corso</h2>
          <p className="text-muted-foreground mb-8">
            Stiamo analizzando i dati e cercando le gare più rilevanti. L&apos;operazione potrebbe richiedere alcuni secondi.
          </p>
          <div className="border rounded-xl p-5 bg-card text-left space-y-3">
            {ANALYSIS_STEPS.map((s, i) => (
              <div key={i} className={`flex items-center gap-3 text-sm transition-opacity ${i <= analysisStep ? "opacity-100" : "opacity-30"}`}>
                {i < analysisStep ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : i === analysisStep ? (
                  <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className={i === analysisStep ? "font-medium" : ""}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Results Step ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/gare" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Torna alla home
          </Link>
          <button
            onClick={() => { setStep("input"); setAnalysis(null); setTenders([]) }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            id="btn-nuova-ricerca"
          >
            <ChevronLeft className="h-4 w-4" /> Nuova ricerca
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">

        {/* Company profile */}
        {analysis && (
          <div className="border rounded-xl p-5 bg-card mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                {analysis.company.name.charAt(0)}
              </div>
              <div>
                <p className="font-semibold">{analysis.company.name}</p>
                <p className="text-sm text-muted-foreground">{analysis.company.sector}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-3">{analysis.company.description}</p>
            <div className="flex flex-wrap gap-2">
              {analysis.keywords.map(kw => (
                <Badge key={kw} variant="secondary" className="text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Search within results */}
        <div className="border rounded-xl p-5 bg-card mb-6">
          <p className="font-semibold mb-4">Filtra le gare d&apos;appalto</p>
          <div className="flex gap-2">
            <Input
              id="widget-search"
              placeholder="Es. Manutenzione"
              value={searchKw}
              onChange={e => setSearchKw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleWidgetSearch()}
              className="h-10"
            />
            <Button onClick={handleWidgetSearch} id="btn-cerca-gare">
              <Search className="h-4 w-4 mr-2" /> Cerca gare
            </Button>
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold">
            Risultati Trovati (<span className="text-primary">{displayedTenders.length}</span>)
          </p>
          <p className="text-sm text-muted-foreground">
            Mostrando 1–{Math.min(3, displayedTenders.length)} di {displayedTenders.length}
          </p>
        </div>

        {/* Tender cards (first 3 visible) */}
        <div className="space-y-4 mb-6">
          {displayedTenders.slice(0, 3).map(tender => (
            <div key={tender.id} className="border rounded-xl p-5 bg-card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1">
                  {tender.descrizione_cpv && (
                    <Badge variant="outline" className="font-mono text-xs mb-2 max-w-[200px] truncate block">
                      {tender.descrizione_cpv}
                    </Badge>
                  )}
                  <ScadenzaBadge data={tender.data_scadenza} />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-primary shrink-0"
                  onClick={() => setReportModalId(tender.id)}
                  id={`btn-vedi-analisi-${tender.id}`}
                >
                  Vedi analisi →
                </Button>
              </div>
              <p className="font-medium text-sm leading-snug mb-3 line-clamp-2">{tender.oggetto}</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {tender.importo && (
                  <span className="flex items-center gap-1">
                    <Euro className="h-3 w-3" />
                    {formatCurrency(tender.importo)}
                  </span>
                )}
                {tender.cig && (
                  <a
                    href={buildAnacCigUrl(tender.cig)}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-primary transition-colors"
                  >
                    CIG: {tender.cig} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Locked results paywall */}
        {displayedTenders.length > 3 && (
          <div className="border-2 border-dashed rounded-xl p-8 bg-muted/30 text-center">
            <p className="font-semibold mb-1">Vedi tutti i risultati</p>
            <p className="text-sm text-muted-foreground mb-4">
              Ci sono altre <span className="font-medium">{displayedTenders.length - 3}</span> gare che corrispondono ai tuoi criteri.
            </p>
            <Link href="/gare">
              <Button id="btn-sblocca-risultati">
                Vedi tutte le gare →
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground mt-2">Accesso gratuito · Nessuna registrazione richiesta</p>
          </div>
        )}
      </main>

      {/* ── Report Modal ── */}
      {reportModalId !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full flex overflow-hidden max-h-[90vh]">
            {/* Left panel */}
            <div className="bg-foreground text-background p-8 w-80 shrink-0 hidden md:flex flex-col">
              <div className="flex items-center gap-2 mb-6">
                <div className="h-8 w-8 bg-primary rounded flex items-center justify-center">
                  <Mail className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="font-semibold text-sm uppercase tracking-wider">Report Gratuito</span>
              </div>
              <h2 className="text-xl font-bold mb-3">Ricevi il report dettagliato della gara</h2>
              <p className="text-sm opacity-70 mb-6">Analisi completa in PDF generata dall&apos;AI, direttamente nella tua casella email in circa 5 minuti.</p>
              <ul className="space-y-4 text-sm">
                {[
                  ["1", "Riepilogo e requisiti", "Importo, tipo procedura, criterio di aggiudicazione, requisiti di partecipazione"],
                  ["2", "Prodotti richiesti", "Tabella dettagliata con caratteristiche tecniche, certificazioni e prezzi stimati"],
                  ["3", "Garanzie e scadenze", "Garanzia provvisoria, definitiva, campionatura e note operative"],
                  ["4", "Red flag e criticità", "Elementi di attenzione, incongruenze e rischi identificati"],
                ].map(([n, t, d]) => (
                  <li key={n} className="flex gap-3">
                    <span className="font-bold text-primary">{n}</span>
                    <div>
                      <p className="font-semibold">{t}</p>
                      <p className="opacity-60 text-xs mt-0.5">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {/* Right panel */}
            <div className="flex-1 p-8 overflow-y-auto">
              <div className="flex items-start justify-between mb-6">
                <h3 className="text-lg font-bold">Dove inviamo il report?</h3>
                <button onClick={() => { setReportModalId(null); setReportSent(false) }} className="text-muted-foreground hover:text-foreground" id="btn-chiudi-modal">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {reportSent ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
                  <p className="font-semibold text-lg">Funzionalità in arrivo!</p>
                  <p className="text-muted-foreground text-sm mt-2">
                    I report via email saranno disponibili a breve. Nel frattempo, puoi consultare tutti i bandi nella sezione{" "}
                    <Link href="/gare" className="text-primary hover:underline">Gare →</Link>
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-6">Il PDF arriverà nella tua casella email in circa 5 minuti.</p>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block" htmlFor="report-nome">Nome</label>
                      <Input id="report-nome" placeholder="Nome" value={reportForm.nome} onChange={e => setReportForm(f => ({ ...f, nome: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block" htmlFor="report-cognome">Cognome</label>
                      <Input id="report-cognome" placeholder="Cognome" value={reportForm.cognome} onChange={e => setReportForm(f => ({ ...f, cognome: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block" htmlFor="report-email">Email aziendale</label>
                      <Input id="report-email" type="email" placeholder="nome@azienda.it" value={reportForm.email} onChange={e => setReportForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <Button className="w-full" id="btn-ricevi-report" onClick={() => { if (reportForm.email) setReportSent(true) }}>
                      Ricevi il report →
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">Gratuito · Nessun impegno · In ~5 minuti</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
