"use client"

import { useState, useCallback, useMemo, useRef, useEffect, createContext, useContext } from "react"
import useSWR from "swr"
import {
  Search, SlidersHorizontal, ChevronLeft, ChevronRight,
  ExternalLink, Clock, Euro, Building2, MapPin, FileText, Loader2,
  Globe, ShieldCheck, Database, Sparkles, Key, X, ChevronDown, ChevronUp,
  Copy, Download, Check, History,
} from "lucide-react"
import { Button }  from "@/components/ui/button"
import { Input }   from "@/components/ui/input"
import { Badge }   from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { SourceKey } from "@/lib/sources/types"
import { SOURCE_LABELS, SOURCE_COLORS, buildAnacCigUrl } from "@/lib/sources/types"
import type { NormalizedTender } from "@/lib/sources/types"
import { useDebounce } from "@/hooks/use-debounce"

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
  { value: "sintel",       label: "Sintel",                 flag: "📡" },
  { value: "mepa",         label: "MePA",                   flag: "📡" },
  { value: "start_toscana", label: "Start Toscana",         flag: "📡" },
  { value: "halleyweb",    label: "Halley Web",             flag: "📡" },
  { value: "place_vda",    label: "Valle d'Aosta",          flag: "📡" },
  // Sotto-fonti CATO scoperte via analisi diretta dell'API (devtools su get-cato.com/gare)
  { value: "intercenter",      label: "Intercenter",              flag: "📡" },
  { value: "sardegna",         label: "Sardegna CAT",              flag: "📡" },
  { value: "tuttogare",        label: "TuttoGare",                 flag: "📡" },
  { value: "lazio_stella",     label: "Lazio (S.TEL.LA.)",          flag: "📡" },
  { value: "estar",            label: "ESTAR Toscana",              flag: "📡" },
  { value: "bolzano",          label: "Alto Adige",                 flag: "📡" },
  { value: "digitalpa",        label: "DigitalPA",                  flag: "📡" },
  { value: "abruzzo",          label: "Abruzzo",                    flag: "📡" },
  { value: "net4market",       label: "Net4Market",                 flag: "📡" },
  { value: "acquedotto_fiora", label: "Acquedotto del Fiora",       flag: "📡" },
  { value: "empulia",          label: "EmPulia",                    flag: "📡" },
  { value: "soresa",           label: "SoReSa Campania",            flag: "📡" },
  { value: "efvg",             label: "Friuli Venezia Giulia",      flag: "📡" },
  // Sotto-fonti CATO scoperte 2026-09-02 (multi-page scan API)
  { value: "esercito_difesa",  label: "Esercito / Difesa",          flag: "🪖" },
  { value: "jaggaer",          label: "Jaggaer",                    flag: "📡" },
  { value: "arpa_piemonte",    label: "ARPA Piemonte",              flag: "📡" },
  { value: "cnr",              label: "CNR",                        flag: "🔬" },
  { value: "metro_roma",       label: "Metro Roma",                 flag: "🚇" },
  { value: "comune_milano",    label: "Comune di Milano",           flag: "🏛️" },
]

// ─── Search Context (per highlight nei risultati) ─────────────────────────────

const SearchQueryContext = createContext<string>("")

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

// ─── Highlight Helper ────────────────────────────────────────────────────────

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2)
  if (words.length === 0) return <>{text}</>
  const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part)
          ? <mark key={i} className="bg-yellow-100/80 dark:bg-yellow-400/20 text-inherit rounded-sm px-0.5">{part}</mark>
          : part
      )}
    </>
  )
}

// ─── Recent Searches ─────────────────────────────────────────────────────────

const RECENT_SEARCHES_KEY = "anac_recent_searches"
const MAX_RECENT_SEARCHES = 8

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function addRecentSearch(query: string) {
  if (!query.trim() || typeof window === "undefined") return
  const searches = getRecentSearches().filter(s => s.toLowerCase() !== query.trim().toLowerCase())
  searches.unshift(query.trim())
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches.slice(0, MAX_RECENT_SEARCHES)))
}

function clearRecentSearches() {
  if (typeof window === "undefined") return
  localStorage.removeItem(RECENT_SEARCHES_KEY)
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const diff = new Date(d).getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

function isPublishedWithinHours(d: string | null, hours: number): boolean {
  if (!d) return false
  const value = d.trim()
  const now = Date.now()
  const cutoff = now - hours * 3_600_000

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const dayStart = new Date(`${value}T00:00:00`).getTime()
    const dayEnd = new Date(`${value}T23:59:59.999`).getTime()
    if (Number.isNaN(dayStart) || Number.isNaN(dayEnd)) return false
    return dayEnd >= cutoff && dayStart <= now
  }

  const publishedAt = new Date(value).getTime()
  if (Number.isNaN(publishedAt)) return false
  return publishedAt >= cutoff && publishedAt <= now
}

// ─── AI Analysis Helpers ─────────────────────────────────────────────────────

const GEMINI_KEY_STORAGE = "gemini_api_key"
const AI_CACHE_PREFIX    = "ai_analysis_"

function getGeminiKey(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(GEMINI_KEY_STORAGE)
}

function setGeminiKey(key: string) {
  localStorage.setItem(GEMINI_KEY_STORAGE, key)
}

function removeGeminiKey() {
  localStorage.removeItem(GEMINI_KEY_STORAGE)
}

function getCachedAnalysis(id: string): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(AI_CACHE_PREFIX + id)
}

function setCachedAnalysis(id: string, result: string) {
  sessionStorage.setItem(AI_CACHE_PREFIX + id, result)
}

class QuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QuotaError"
  }
}

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"] as const

interface GeminiResult {
  text: string
  sources: { title: string; url: string }[]
}

async function callGeminiModel(
  apiKey: string,
  model: string,
  prompt: string,
  useSearch = false,
): Promise<GeminiResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
  }

  // Abilita Google Search grounding per cercare link reali
  if (useSearch) {
    body.tools = [{ google_search: {} }]
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    const msg = err.error?.message || `Errore API Gemini (${model}): ${res.status}`

    // Quota esaurita → errore specifico con messaggio chiaro
    if (res.status === 429 || msg.toLowerCase().includes("quota")) {
      // Estrai tempo di retry se presente (es. "retry in 16.4s")
      const retryMatch = msg.match(/retry in ([\d.]+)s/i)
      const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null
      const retryHint = retrySec ? ` Riprova tra ${retrySec} secondi.` : ""
      throw new QuotaError(
        `Quota API esaurita per ${model}.${retryHint} Verifica il tuo piano su ai.google.dev.`
      )
    }

    throw new Error(msg)
  }

  const data = await res.json()
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.[0]?.text || "Nessuna risposta generata."

  // Estrai fonti dal grounding metadata
  const sources: { title: string; url: string }[] = []
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    const uri   = chunk?.web?.uri
    const title = chunk?.web?.title
    if (uri && !seen.has(uri)) {
      seen.add(uri)
      sources.push({ title: title || uri, url: uri })
    }
  }

  return { text, sources }
}

async function analyzeWithGemini(apiKey: string, tender: TenderItem, sourceUrl?: string): Promise<string> {
  const cigCode = getCigCode(tender.cig)
  const prompt = `Sei un esperto di appalti pubblici italiani. Analizza questo bando e CERCA SUL WEB informazioni aggiornate.

**Dati disponibili:**
- Oggetto: ${tender.oggetto || "Non specificato"}
- CIG: ${cigCode !== "—" ? cigCode : "Non disponibile"}
- Importo stimato: ${formatCurrency(tender.importo) || "Non specificato"}
- Stazione appaltante: ${tender.stazione_appaltante || "Non specificata"}
- CPV: ${tender.descrizione_cpv || "Non specificato"}
- Tipo contratto: ${tender.tipo_contratto || "Non specificato"}
- Scadenza offerte: ${formatDate(tender.data_scadenza) || "Non specificata"}
- Fonte: ${tender.sources?.toUpperCase() || "Non specificata"}
- Link fonte: ${sourceUrl || "Non disponibile"}

Cerca sul web e fornisci un'analisi strutturata:

1. **Sintesi** — cosa richiede il bando in 2-3 frasi semplici

2. **Date chiave** — elenca tutte le date importanti trovate:
   - Data pubblicazione
   - Scadenza presentazione offerte
   - Data apertura buste (se disponibile)
   - Eventuali proroghe

3. **Link utili** — cerca e fornisci i link diretti a:
   - Pagina ufficiale del bando sulla piattaforma di e-procurement
   - Pagina di download della documentazione di gara
   - Disciplinare, capitolato, modelli di partecipazione se trovati
   - Eventuali chiarimenti/FAQ pubblicati

4. **Dove scaricare la documentazione** — indica esattamente su quale piattaforma e in quale sezione trovare i documenti di gara (es. Sintel, MePA, Start Toscana, sito della stazione appaltante)

5. **Requisiti di partecipazione** — requisiti tecnici, economici e certificazioni necessarie

6. **Consiglio rapido** — se vale la pena approfondire e perché

IMPORTANTE: Includi sempre gli URL completi che trovi. Se non trovi un link, indicalo chiaramente.
Rispondi in italiano, in modo professionale ma accessibile.`

  // Prova i modelli in ordine, fallback al successivo se il modello non è disponibile
  // Se è un errore di quota, prova il modello successivo (più leggero = meno quota)
  let lastError: Error | null = null
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    try {
      const result = await callGeminiModel(apiKey, GEMINI_MODELS[i], prompt, true)

      // Componi il testo finale con le fonti trovate
      let output = result.text

      if (result.sources.length > 0) {
        output += "\n\n---\n\n### 🔗 Fonti trovate\n"
        for (const src of result.sources) {
          output += `- [${src.title}](${src.url})\n`
        }
      }

      return output
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (i < GEMINI_MODELS.length - 1) {
        console.warn(`Modello ${GEMINI_MODELS[i]} non disponibile, fallback su ${GEMINI_MODELS[i + 1]}`)
      }
    }
  }

  // Tutti i modelli falliti
  if (lastError instanceof QuotaError) {
    throw new Error(
      "⚠️ Quota API Gemini esaurita su tutti i modelli. " +
      "Attendi qualche minuto oppure passa a un piano a pagamento su ai.google.dev/pricing"
    )
  }
  throw lastError ?? new Error("Nessun modello Gemini disponibile")
}

// ─── AI Settings Modal ──────────────────────────────────────────────────────

function AiKeyModal({ onClose }: { onClose: () => void }) {
  const [key, setKeyVal] = useState(getGeminiKey() || "")
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    if (key.trim()) {
      setGeminiKey(key.trim())
      setSaved(true)
      setTimeout(() => onClose(), 800)
    }
  }

  const handleRemove = () => {
    removeGeminiKey()
    setKeyVal("")
    setSaved(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold text-lg">Configurazione AI</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          Inserisci la tua API key di <strong>Google Gemini</strong> per abilitare l&apos;analisi AI dei bandi.
          La chiave viene salvata solo nel tuo browser.
        </p>

        <div className="space-y-2">
          <label className="text-sm font-medium">Gemini API Key</label>
          <Input
            type="password"
            placeholder="AIzaSy..."
            value={key}
            onChange={e => setKeyVal(e.target.value)}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Ottieni una chiave da{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Google AI Studio
            </a>
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={!key.trim()} className="flex-1 gap-2">
            <Key className="h-4 w-4" />
            {saved ? "✓ Salvata!" : "Salva"}
          </Button>
          {getGeminiKey() && (
            <Button variant="outline" onClick={handleRemove} className="text-red-600 hover:text-red-700">
              Rimuovi
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers per rendering AI ────────────────────────────────────────────────

function renderAiHtml(md: string): string {
  return md
    // Separatore orizzontale
    .replace(/^---$/gm, '<hr class="border-amber-200 dark:border-amber-800/40 my-3" />')
    // Titoli
    .replace(/^#{1,4}\s+(.+)$/gm, '<div class="font-semibold text-amber-800 dark:text-amber-300 mt-3 mb-1">$1</div>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/(?<![*])\*(?![*])(.*?)\*(?![*])/g, '<em>$1</em>')
    // Markdown links [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5">$1 ↗</a>')
    // Bare URLs
    .replace(/(?<!["=])(https?:\/\/[^\s<,)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline break-all">$1 ↗</a>')
    // Numbered lists
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div class="flex gap-2 ml-1"><span class="text-amber-500 font-semibold shrink-0">$1.</span><span>$2</span></div>')
    // Bullet lists
    .replace(/^[-•]\s+(.+)$/gm, '<div class="flex gap-2 ml-3"><span class="text-amber-400">•</span><span>$1</span></div>')
    // Line breaks
    .replace(/\n/g, '<br/>')
    .replace(/(<br\/>){3,}/g, '<br/><br/>')
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadAsDocx(content: string, filename: string) {
  const html = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
<head><meta charset='utf-8'><title>${filename}</title>
<style>body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.6;color:#333}h3{color:#b45309;margin-top:16pt}strong{color:#92400e}ul,ol{margin-left:20pt}</style>
</head><body>
${content
  .replace(/^#{1,4}\s+(.+)$/gm, '<h3>$1</h3>')
  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  .replace(/^(\d+)\.\s+(.+)$/gm, '<p style="margin-left:20pt"><b>$1.</b> $2</p>')
  .replace(/^[-•]\s+(.+)$/gm, '<p style="margin-left:30pt">• $1</p>')
  .replace(/\n/g, '<br>')}
</body></html>`
  downloadFile(html, filename + '.doc', 'application/msword')
}

// ─── AI Analysis Panel (inline expandable) ───────────────────────────────────

function AiAnalysisPanel({ tender, sourceUrl }: { tender: TenderItem; sourceUrl?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)

  const tenderId = String(tender.cig ?? tender.id)
  const fileName = `analisi_${tenderId}`

  const handleAnalyze = async () => {
    const apiKey = getGeminiKey()
    if (!apiKey) return
    const cached = getCachedAnalysis(tenderId)
    if (cached) { setResult(cached); setExpanded(true); return }
    setLoading(true); setError(null); setExpanded(true)
    try {
      const text = await analyzeWithGemini(apiKey, tender, sourceUrl)
      setResult(text); setCachedAnalysis(tenderId, text)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante l'analisi")
    } finally { setLoading(false) }
  }

  const handleCopy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const hasKey = typeof window !== "undefined" && !!getGeminiKey()
  if (!hasKey) return null

  return (
    <div className="pt-2">
      {!expanded ? (
        <button onClick={handleAnalyze} className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors">
          <Sparkles className="h-3.5 w-3.5" /> Analizza con AI
        </button>
      ) : (
        <div className="space-y-2">
          <button onClick={() => setExpanded(false)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronUp className="h-3 w-3" /> Chiudi analisi
          </button>
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">Analisi AI</span>
              </div>
              {result && (
                <div className="flex items-center gap-1">
                  <button onClick={handleCopy} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40 transition-colors" title="Copia testo">
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copiato!" : "Copia"}
                  </button>
                  <button onClick={() => downloadFile(result, fileName + '.md', 'text/markdown')} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40 transition-colors" title="Scarica come Markdown">
                    <Download className="h-3 w-3" /> .md
                  </button>
                  <button onClick={() => downloadAsDocx(result, fileName)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40 transition-colors" title="Scarica come Word">
                    <Download className="h-3 w-3" /> .doc
                  </button>
                </div>
              )}
            </div>
            {loading && (<div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Analisi in corso...</div>)}
            {error && (<p className="text-sm text-red-600">{error}</p>)}
            {result && (<div className="text-sm leading-relaxed text-foreground/90" dangerouslySetInnerHTML={{ __html: renderAiHtml(result) }} />)}
          </div>
        </div>
      )}
    </div>
  )
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
  const [pubblicazione, setPubblicazione] = useState("")
  const [source,   setSource]   = useState<SourceKey | "all">("all")
  const [cpv,      setCpv]      = useState("")
  const [page,     setPage]     = useState(0)
  const [showAiModal, setShowAiModal] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const searchRef = useRef<HTMLDivElement>(null)

  const deferredSearch = useDebounce(search, 300)
  const deferredCpv    = useDebounce(cpv, 400)

  // Load recent searches on mount
  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [])

  // Save search when debounced value changes (user finished typing)
  useEffect(() => {
    if (deferredSearch.trim().length >= 3) {
      addRecentSearch(deferredSearch)
      setRecentSearches(getRecentSearches())
    }
  }, [deferredSearch])

  // Close recent searches dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowRecent(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const isAnacMode = source === "anac"
  const isAllMode  = source === "all"
  // Fetch ANAC quando è selezionato "anac" O "tutte le fonti"
  const needAnac   = isAnacMode || isAllMode
  // Fetch TED/CATO quando NON è "anac" (cioè "all", "ted", sotto-fonti CATO)
  const needTenders = !isAnacMode

  // ── Query string per ANAC (Supabase /api/cig) ─────────────────────────────
  const anacQueryString = useMemo(() => {
    if (!needAnac) return ""
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
    if (pubblicazione && pubblicazione !== "all") params.set("pubblicazione", pubblicazione)
    if (deferredCpv.trim()) params.set("cpv", deferredCpv.trim())
    return params.toString()
  }, [needAnac, page, deferredSearch, tipo, importo, pubblicazione, deferredCpv])

  const { data: anacData, isLoading: anacLoading } = useSWR<CigApiResponse>(
    needAnac ? `/api/cig?${anacQueryString}` : null,
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
        ? buildAnacCigUrl(row.cig, row.anac_id_avviso)
        : null,
      stazione_appaltante: row.denominazione_amministrazione_appaltante ?? row.sezione_regionale ?? null,
    }))
  }, [anacData])

  // ── Query string per /api/tenders (TED + CATO) ─────────────────────────────
  const queryString = useMemo(() => {
    if (!needTenders) return ""  // non usato in modalità solo-ANAC
    const params = new URLSearchParams()
    params.set("p", String(page))
    if (deferredSearch)               params.set("q",       deferredSearch)
    if (tipo    && tipo    !== "all") params.set("tipo",    tipo)
    if (importo && importo !== "all") params.set("importo", importo)
    if (scadenza && scadenza !== "all") params.set("scadenza", scadenza)
    if (pubblicazione && pubblicazione !== "all") params.set("pubblicazione", pubblicazione)
    if (source  && source  !== "all") params.set("source",  source)
    if (deferredCpv.trim()) params.set("cpv", deferredCpv.trim())
    return params.toString()
  }, [page, deferredSearch, tipo, importo, scadenza, pubblicazione, source, needTenders, deferredCpv])

  const { data, isLoading: swrLoading } = useSWR<TendersResponse>(
    needTenders ? `/api/tenders?${queryString}` : null,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  // ── Dati unificati ─────────────────────────────────────────────────────────
  // In modalità "all": merge ANAC + TED/CATO con ordinamento per scadenza
  const items: TenderItem[] = useMemo(() => {
    if (isAnacMode) return anacItems
    if (!isAllMode) return data?.items || []
    // All mode: merge ANAC + TED/CATO
    const tedCatoItems = data?.items || []
    const merged = [...tedCatoItems, ...anacItems]
    // Dedup per CIG (ANAC potrebbe avere stessi bandi di TED/CATO)
    const seen = new Set<string>()
    const deduped = merged.filter(item => {
      const key = String(item.cig ?? item.id)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Rimuovi gare con scadenza passata
    const today = new Date().toISOString().slice(0, 10)
    const active = deduped.filter(item => {
      if (!item.data_scadenza) return true
      return item.data_scadenza >= today
    })
    // Ordina: ultime 48h sempre in cima, poi scadenza più vicina prima
    active.sort((a, b) => {
      const aNew = isPublishedWithinHours(a.data_pubblicazione, 48)
      const bNew = isPublishedWithinHours(b.data_pubblicazione, 48)
      // Le gare nuove (48h) vanno sempre in cima
      if (aNew !== bNew) return aNew ? -1 : 1
      // Dentro ogni gruppo: scadenza più vicina prima
      const aHas = !!a.data_scadenza
      const bHas = !!b.data_scadenza
      if (aHas && bHas) return a.data_scadenza!.localeCompare(b.data_scadenza!)
      if (aHas !== bHas) return aHas ? -1 : 1
      return (b.data_pubblicazione ?? "").localeCompare(a.data_pubblicazione ?? "")
    })
    return active
  }, [isAnacMode, isAllMode, anacItems, data?.items])

  const total     = isAnacMode ? (anacData?.count ?? 0) : isAllMode ? ((data?.total ?? 0) + (anacData?.count ?? 0)) : (data?.total ?? 0)
  const isLoading = isAnacMode ? anacLoading : isAllMode ? (swrLoading || anacLoading) : swrLoading
  const pageSize  = isAnacMode ? 20 : 10
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0

  const resetFilters = useCallback(() => {
    setSearch(""); setTipo(""); setImporto(""); setScadenza(""); setPubblicazione(""); setSource("all"); setCpv(""); setPage(0)
  }, [])

  const handleFilterChange = useCallback(() => setPage(0), [])

  const hasFilters = !!(search || tipo || importo || scadenza || pubblicazione || source !== "all" || cpv)

  const sourceStats = data?.sources?.filter(s => s.count > 0 || s.error)

  return (
    <div className="space-y-6">

      {/* ── Search Bar ── */}
      <div className="flex gap-2">
        <div className="relative flex-1" ref={searchRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="gare-search"
            placeholder={
              isAnacMode
                ? "Cerca per oggetto, CIG, stazione appaltante…"
                : "Cerca per oggetto, CIG, stazione appaltante…"
            }
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            onFocus={() => setShowRecent(true)}
            className="pl-10 h-11 text-sm sm:text-base"
          />
          {/* Recent Searches Dropdown */}
          {showRecent && !search && recentSearches.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-40 mt-1 bg-card border rounded-lg shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <History className="h-3 w-3" /> Ricerche recenti
                </span>
                <button
                  onClick={() => { clearRecentSearches(); setRecentSearches([]); setShowRecent(false) }}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  Cancella
                </button>
              </div>
              {recentSearches.map((q, i) => (
                <button
                  key={i}
                  onClick={() => { setSearch(q); setShowRecent(false); setPage(0) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
                >
                  <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate">{q}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button size="lg" className="px-4 sm:px-6" onClick={() => setPage(0)}>
          Cerca
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Fonte */}
        <Select
          value={source}
          onValueChange={v => { setSource(v as SourceKey | "all"); handleFilterChange() }}
        >
          <SelectTrigger id="filter-source" className="w-[160px] sm:w-[220px] text-xs sm:text-sm">
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
          <SelectTrigger id="filter-tipo" className="w-[140px] sm:w-[180px] text-xs sm:text-sm">
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
          <SelectTrigger id="filter-importo" className="w-[140px] sm:w-[180px] text-xs sm:text-sm">
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
            <SelectTrigger id="filter-scadenza" className="w-[150px] sm:w-[180px] text-xs sm:text-sm">
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

        {/* Pubblicazione */}
        <Select value={pubblicazione || "all"} onValueChange={v => { setPubblicazione(v === "all" ? "" : v); handleFilterChange() }}>
          <SelectTrigger id="filter-pubblicazione" className="w-[165px] sm:w-[190px] text-xs sm:text-sm">
            <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Pubblicazione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Pubblicazione</SelectItem>
            <SelectItem value="48h">Ultime 48 ore</SelectItem>
            <SelectItem value="7d">Ultimi 7 giorni</SelectItem>
            <SelectItem value="30d">Ultimi 30 giorni</SelectItem>
            <SelectItem value="90d">Ultimi 90 giorni</SelectItem>
          </SelectContent>
        </Select>

        {/* CPV */}
        <div className="relative flex items-center">
          <Input
            id="filter-cpv"
            placeholder="Codice CPV (es. 45)"
            value={cpv}
            inputMode="numeric"
            onChange={e => {
              const onlyDigits = e.target.value.replace(/[^0-9]/g, "")
              setCpv(onlyDigits)
              handleFilterChange()
            }}
            className="w-[160px] sm:w-[185px] text-xs sm:text-sm h-9 pr-6"
          />
          {cpv && (
            <button
              onClick={() => { setCpv(""); setPage(0) }}
              className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Cancella CPV"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
            Cancella filtri
          </Button>
        )}

        {/* AI Settings button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAiModal(true)}
          className="ml-auto gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {getGeminiKey() ? "AI attiva" : "Configura AI"}
        </Button>
      </div>

      {/* AI Key Modal */}
      {showAiModal && <AiKeyModal onClose={() => setShowAiModal(false)} />}

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

      <SearchQueryContext.Provider value={deferredSearch}>
      <div className="space-y-4">
        {items.map(tender => (
          <TenderCard key={tender.id} tender={tender} />
        ))}
      </div>
      </SearchQueryContext.Provider>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            id="btn-prev-page"
            className="text-xs sm:text-sm"
          >
            <ChevronLeft className="h-4 w-4 mr-0.5 sm:mr-1" />
            <span className="hidden sm:inline">Pagina precedente</span>
            <span className="sm:hidden">Prec</span>
          </Button>
          <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
            {page + 1} / {totalPages.toLocaleString("it-IT")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            id="btn-next-page"
            className="text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">Pagina successiva</span>
            <span className="sm:hidden">Succ</span>
            <ChevronRight className="h-4 w-4 ml-0.5 sm:ml-1" />
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
  const isNew    = isPublishedWithinHours(tender.data_pubblicazione, 48)
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
    <div
      className={cn(
        "border rounded-xl p-3 sm:p-5 bg-card hover:shadow-md transition-shadow space-y-2 sm:space-y-3",
        isNew && "border-primary/40 bg-primary/[0.03] ring-1 ring-primary/10 shadow-sm dark:border-primary/30 dark:bg-primary/[0.04]",
      )}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        {isNew && (
          <Badge className="gap-1 bg-primary/10 text-primary border-primary/20 font-semibold text-xs px-2 py-0.5 dark:text-primary dark:border-primary/30">
            <Clock className="h-3 w-3" />
            NUOVO 48H
          </Badge>
        )}
        {isActive && (
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 font-medium text-xs px-2 py-0.5">
            ● ATTIVA
          </Badge>
        )}
        {/* Badge fonte colorato */}
        <SourceBadge source={tender.sources} />
        {cpvCodes && (
          <Badge variant="outline" className="font-mono text-[10px] sm:text-xs max-w-[180px] sm:max-w-[240px] truncate" title={cpvCodes}>
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
        <h2 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors">
          <HighlightText text={tender.oggetto || "—"} query={useContext(SearchQueryContext)} />
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
          <p className={cn("font-medium text-sm", isNew && "text-primary dark:text-primary")}>
            {formatDate(tender.data_pubblicazione) ?? "—"}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0 pt-1">
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

      {/* AI Analysis */}
      <AiAnalysisPanel tender={tender} sourceUrl={sourceUrl} />
    </div>
  )
}
