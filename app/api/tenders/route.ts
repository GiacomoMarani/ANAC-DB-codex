/**
 * GET /api/tenders — Aggregatore multi-fonte
 *
 * Parametri:
 *   p        — pagina 0-based (default: 0)
 *   q        — ricerca full-text
 *   tipo     — goods | services | works
 *   importo  — fascia (< €40.000 | €40k – €150k | €150k – €1M | €1M – €5M | > €5M)
 *   scadenza — giorni alla scadenza (7 | 30 | 90)
 *   source   — fonte specifica: ted | anac | cato | sintel | mepa | start_toscana |
 *              halleyweb | place_vda | intercenter | sardegna | tuttogare |
 *              lazio_stella | estar | bolzano | digitalpa | abruzzo | net4market |
 *              acquedotto_fiora | empulia | soresa | efvg
 *              (può essere ripetuto più volte per multi-fonte)
 *
 * Fan-out per fonte:
 *   ted            → adapter TED Europa diretto (X-API-Key)
 *   anac           → adapter ANAC diretto (BDNCP Superset / Dremio)
 *   cato / (vuoto) → Cato generico (tutte le sotto-fonti)
 *   altre chiavi   → Cato, filtrato client-side sul campo 'sources' (l'API Cato non
 *                    supporta un filtro server-side per fonte — vedi lib/sources/cato.ts).
 *                    NOTA: Cato aggrega anche 'ted' e 'pvl_anac' (= ANAC) al suo interno,
 *                    ma quelle due chiavi non sono esposte qui perché già coperte dagli
 *                    adapter diretti sopra (evita fonti duplicate/ridondanti in UI).
 */
import { NextRequest, NextResponse } from "next/server"
import { fetchTED }  from "@/lib/sources/ted"
import { fetchCato } from "@/lib/sources/cato"
import { fetchANAC } from "@/lib/sources/anac"
import type { SourceKey, SourceResult } from "@/lib/sources/types"

// Mappa fonte → valore raw del campo 'sources' di Cato (usato per il filtro client-side
// in fetchCato, l'API Cato non supporta un filtro server-side — vedi lib/sources/cato.ts)
const CATO_SOURCE_MAP: Partial<Record<SourceKey, string>> = {
  sintel:           "sintel",
  mepa:             "acquistinretepa",
  start_toscana:    "start_toscana",
  halleyweb:        "halleyweb",
  place_vda:        "place_vda",
  intercenter:      "intercenter",
  sardegna:         "sardegna",
  tuttogare:        "tuttogare",
  lazio_stella:     "lazio_stella",
  estar:            "estar",
  bolzano:          "bolzano",
  digitalpa:        "digitalpa",
  abruzzo:          "abruzzo",
  net4market:       "net4market",
  acquedotto_fiora: "acquedotto_fiora",
  empulia:          "empulia",
  soresa:           "soresa",
  efvg:             "efvg",
  cato:             "",  // vuoto = tutte le sotto-fonti Cato, nessun filtro
  // anac: usa fetchANAC diretto
}

function getPublicationCutoff(value: string): Date | null {
  const match = value.trim().toLowerCase().match(/^(\d+)(h|d)?$/)
  if (!match) return null

  const amount = Number.parseInt(match[1], 10)
  const unit = match[2] ?? "d"
  if (!Number.isFinite(amount) || amount <= 0) return null

  const cutoff = new Date()
  if (unit === "h") {
    cutoff.setHours(cutoff.getHours() - amount)
  } else {
    cutoff.setDate(cutoff.getDate() - amount)
  }

  return cutoff
}

function isPublishedSince(value: string | null, cutoff: Date, now = new Date()): boolean {
  if (!value) return false
  const text = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const dayStart = new Date(`${text}T00:00:00`).getTime()
    const dayEnd = new Date(`${text}T23:59:59.999`).getTime()
    return !Number.isNaN(dayStart) && !Number.isNaN(dayEnd) && dayEnd >= cutoff.getTime() && dayStart <= now.getTime()
  }

  const publishedAt = new Date(text).getTime()
  return !Number.isNaN(publishedAt) && publishedAt >= cutoff.getTime() && publishedAt <= now.getTime()
}

async function resolveSource(
  key: SourceKey,
  commonParams: Parameters<typeof fetchCato>[0],
  tedKey: string,
): Promise<SourceResult> {
  try {
    if (key === "ted") {
      return await fetchTED(commonParams, tedKey)
    }

    if (key === "anac") {
      return await fetchANAC({
        q:        commonParams.q,
        page:     commonParams.page,
        pageSize: commonParams.pageSize ?? 10,
        tipo:     commonParams.tipo,
        importo:  commonParams.importo,
        pubblicazione: commonParams.pubblicazione,
        inCorso:  true,   // usa BANDI_IN_CORSO (ds 81) — già filtrati per bandi aperti
      })
    }

    const catoSrc = CATO_SOURCE_MAP[key]
    if (catoSrc !== undefined) {
      return await fetchCato({ ...commonParams, source: catoSrc || undefined }, key)
    }

    // Fonte sconosciuta → fallback Cato generico
    return await fetchCato(commonParams, "cato")
  } catch (err) {
    return {
      items:  [],
      total:  0,
      source: key,
      error:  err instanceof Error ? err.message : String(err),
    }
  }
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const page     = parseInt(sp.get("p") ?? "0")
  const q        = sp.get("q") ?? undefined
  const tipo     = sp.get("tipo") ?? undefined
  const importo  = sp.get("importo") ?? undefined
  const scadenza = sp.get("scadenza") ?? undefined
  const pubblicazione = sp.get("pubblicazione") ?? undefined

  // Multi-valore: ?source=ted&source=cato
  const rawSources = sp.getAll("source")
  const sources: SourceKey[] = rawSources.length > 0
    ? (rawSources as SourceKey[])
    : ["ted", "cato"] // default: TED + Cato (aggregazione reale multi-fonte)

  const tedKey = process.env.TED_API_KEY ?? ""

  const commonParams = { q, page, importo, scadenza, tipo, pubblicazione }

  // Fan-out parallelo su tutte le fonti richieste
  const results = await Promise.all(
    sources.map(src => resolveSource(src, commonParams, tedKey)),
  )

  // Merge risultati (interleaved per fonte se multi-fonte, altrimenti lineare)
  let allItems = results.flatMap(r => r.items)
  let totalItems = results.reduce((acc, r) => acc + r.total, 0)
  const errors = results.filter(r => r.error).map(r => ({ source: r.source, error: r.error }))

  // De-duplication leggera per oggetto simile (stesso cig se disponibile)
  const seen = new Set<string>()
  allItems = allItems.filter(item => {
    const key = item.cig ?? item.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Rimuovi gare con scadenza già passata
  const now = new Date().toISOString()
  allItems = allItems.filter(item => {
    if (!item.data_scadenza) return true          // senza scadenza → tieni
    return item.data_scadenza >= now.slice(0, 10) // confronto YYYY-MM-DD
  })

  const publicationCutoff = pubblicazione ? getPublicationCutoff(pubblicazione) : null
  if (publicationCutoff) {
    allItems = allItems.filter(item => isPublishedSince(item.data_pubblicazione, publicationCutoff))
    totalItems = allItems.length
  }

  // Ordinamento: prima bandi con scadenza (dalla più vicina), poi quelli senza
  allItems.sort((a, b) => {
    const aHas = !!a.data_scadenza
    const bHas = !!b.data_scadenza
    // Entrambi hanno scadenza → ordina per scadenza crescente (più vicina prima)
    if (aHas && bHas) return a.data_scadenza!.localeCompare(b.data_scadenza!)
    // Solo uno ha scadenza → quello con scadenza va prima
    if (aHas !== bHas) return aHas ? -1 : 1
    // Nessuno ha scadenza → ordina per data pubblicazione decrescente (più recente prima)
    return (b.data_pubblicazione ?? "").localeCompare(a.data_pubblicazione ?? "")
  })

  return NextResponse.json(
    {
      items:   allItems,
      total:   totalItems,
      sources: results.map(r => ({ source: r.source, count: r.items.length, error: r.error })),
      ...(errors.length > 0 ? { errors } : {}),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  )
}
