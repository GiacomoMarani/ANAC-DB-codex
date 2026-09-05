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
 *              acquedotto_fiora | empulia | soresa | efvg | bandolo |
 *              incentivi_gov | invitalia | inpa_gov | concorsipubblici | euraxess |
 *              ted_bandolo | untalent
 *              (può essere ripetuto più volte per multi-fonte)
 *   country  — filtro paese ISO: IT | FR | EU | US | GB | DE | ES | INTL
 *              (agisce su Bandolo; TED e CATO/ANAC restano solo italiani)
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
import { fetchCato, fetchCatoFromDB } from "@/lib/sources/cato"
import { fetchANAC } from "@/lib/sources/anac"
import { fetchBandoloFromDB, BANDOLO_SOURCE_REVERSE } from "@/lib/sources/bandolo"
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
  esercito_difesa:  "esercito_difesa",
  jaggaer:          "jaggaer",
  arpa_piemonte:    "arpa_piemonte",
  cnr:              "cnr",
  metro_roma:       "metro_roma",
  comune_milano:    "comune_milano",
  // Nuove fonti scoperte via full sync (67K gare):
  pvl_anac:         "pvl_anac",
  acquistinretepa:  "acquistinretepa",
  portaletrasparenza: "portaletrasparenza",
  gdf_gov:          "gdf_gov",
  veneto_cf:        "veneto_cf",
  cultura:          "cultura",
  portaleappalti:   "portaleappalti",
  contracta:        "contracta",
  traspare:         "traspare",
  aulss4veneto:     "aulss4veneto",
  infoplus:         "infoplus",
  aslroma1:         "aslroma1",
  appaltiitalia:    "appaltiitalia",
  eni_proc:         "eni_proc",
  sisgap:           "sisgap",
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
      return await fetchTED({ ...commonParams, country: commonParams.country }, tedKey)
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

    // ── Bandolo: sotto-fonti individuali (incentivi_gov, invitalia, …) ──
    if (key === "bandolo") {
      // Meta-source: tutti i bandi Bandolo, senza filtro sotto-fonte
      const result = await fetchBandoloFromDB({
        q:            commonParams.q,
        page:         commonParams.page,
        pageSize:     commonParams.pageSize ?? 10,
        importo:      commonParams.importo,
        scadenza:     commonParams.scadenza,
        pubblicazione: commonParams.pubblicazione,
        country:      commonParams.country,
      })
      return result ?? { items: [], total: 0, source: "bandolo" }
    }

    const bandoloSubSource = BANDOLO_SOURCE_REVERSE[key]
    if (bandoloSubSource !== undefined) {
      // Sotto-fonte specifica: es. incentivi_gov → WHERE source = 'incentivi.gov.it'
      const result = await fetchBandoloFromDB({
        q:            commonParams.q,
        page:         commonParams.page,
        pageSize:     commonParams.pageSize ?? 10,
        importo:      commonParams.importo,
        scadenza:     commonParams.scadenza,
        pubblicazione: commonParams.pubblicazione,
        country:      commonParams.country,
        subSource:    bandoloSubSource,
      }, key)
      return result ?? { items: [], total: 0, source: key }
    }

    const catoSrc = CATO_SOURCE_MAP[key]
    if (catoSrc !== undefined) {
      // Try DB first (instant SQL query), fall back to API multi-page scan
      const dbResult = await fetchCatoFromDB({ ...commonParams, source: catoSrc || undefined }, key)
      if (dbResult) return dbResult
      return await fetchCato({ ...commonParams, source: catoSrc || undefined }, key)
    }

    // Fonte sconosciuta → try DB, then fallback Cato generico
    const dbResult = await fetchCatoFromDB(commonParams, "cato")
    if (dbResult) return dbResult
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
  const cpv      = sp.get("cpv") ?? undefined
  const country  = sp.get("country") ?? undefined

  // Multi-valore: ?source=ted&source=cato
  const rawSources = sp.getAll("source")
  const sources: SourceKey[] = rawSources.length > 0
    ? (rawSources as SourceKey[])
    : ["ted", "cato", "bandolo"] // default: TED + Cato + Bandolo (aggregazione reale multi-fonte)

  const tedKey = process.env.TED_API_KEY ?? ""

  const commonParams = { q, page, importo, scadenza, tipo, pubblicazione, country }

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

  // Filtra per scadenza massima (giorni dalla scadenza)
  // Solo Bandolo applica questo filtro server-side; per TED/Cato/CatoFromDB
  // applichiamo il filtro qui come post-filter
  if (scadenza) {
    const maxDays = parseInt(scadenza, 10)
    if (Number.isFinite(maxDays) && maxDays > 0) {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() + maxDays)
      const cutoffStr = cutoffDate.toISOString().slice(0, 10)
      allItems = allItems.filter(item => {
        if (!item.data_scadenza) return true // senza scadenza → tieni
        return item.data_scadenza <= cutoffStr
      })
      totalItems = allItems.length
    }
  }

  const publicationCutoff = pubblicazione ? getPublicationCutoff(pubblicazione) : null
  if (publicationCutoff) {
    allItems = allItems.filter(item => isPublishedSince(item.data_pubblicazione, publicationCutoff))
    totalItems = allItems.length
  }

  // Filtro CPV — solo per codice, prefix-match (Cato/TED non supportano filtro server-side)
  if (cpv) {
    const cpvDigits = cpv.replace(/[^0-9]/g, "")
    allItems = allItems.filter(item => {
      const code = (item.descrizione_cpv ?? "").replace(/[^0-9]/g, "")
      return code.startsWith(cpvDigits)
    })
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
