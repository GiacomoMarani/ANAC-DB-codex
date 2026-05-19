/**
 * lib/sources/ted.ts
 * Adapter per TED Europa (api.ted.europa.eu/v3)
 *
 * Campi validi: https://api.ted.europa.eu/swagger-ui/index.html
 * Auth: X-API-Key header
 *
 * Note dall'esplorazione API:
 * - Risposta: { notices: [...], totalNoticeCount: N }
 * - Ogni notice: publication-number, buyer-name (multilingua), links, title-lot, total-value, ...
 * - Query "buyer-country=ITA" per filtrare Italia (ISO 3166-1 alpha-3)
 * - Pagination: page (1-based), limit
 * - Sort: [{ field, order }] — order: DESC/ASC
 */

import type { NormalizedTender, SourceResult } from "./types"

const TED_API_BASE = "https://api.ted.europa.eu/v3"

const IMPORTO_TO_TED: Record<string, { gte?: number; lte?: number }> = {
  "< €40.000":    { lte: 40_000 },
  "€40k – €150k": { gte: 40_000,  lte: 150_000 },
  "€150k – €1M":  { gte: 150_000, lte: 1_000_000 },
  "€1M – €5M":    { gte: 1_000_000, lte: 5_000_000 },
  "> €5M":        { gte: 5_000_000 },
}

// Estrae il testo dalla struttura multilingua di TED (preferenza: ita > eng > primo disponibile)
function extractLang(obj: Record<string, string[]> | null | undefined): string | null {
  if (!obj) return null
  return (
    obj.ita?.[0] ??
    obj.eng?.[0] ??
    obj.fra?.[0] ??
    Object.values(obj)[0]?.[0] ??
    null
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTedNotice(n: any): NormalizedTender {
  const pubNum = n["publication-number"] ?? n.id ?? null

  // Link alla pagina TED
  const htmlLink =
    n.links?.html?.ITA ??
    n.links?.html?.ENG ??
    (pubNum ? `https://ted.europa.eu/it/notice/-/detail/${pubNum}` : null)

  // Titolo: prova più campi in ordine di preferenza
  // TED v3: title-lot (lotti eForms), notice-title (CN standard), announcement-title, title-proc
  const titleText =
    extractLang(n["title-lot"]        as Record<string,string[]>) ??
    extractLang(n["notice-title"]     as Record<string,string[]>) ??
    extractLang(n["announcement-title"] as Record<string,string[]>) ??
    extractLang(n["title-proc"]       as Record<string,string[]>) ??
    (pubNum ? `Bando TED n. ${pubNum}` : null)

  // Importo
  const totalVal = n["total-value"]
  const importo = typeof totalVal === "number"
    ? totalVal
    : (typeof totalVal === "object" ? (totalVal?.amount ?? totalVal?.value ?? null) : null)

  // Stazione appaltante
  const buyerRaw = n["buyer-name"]
  const stazione = typeof buyerRaw === "object"
    ? extractLang(buyerRaw as Record<string, string[]>)
    : (buyerRaw as string | null) ?? null

  // CPV
  const cpvRaw  = n["main-classification-proc"] ?? n["cpv-code"] ?? null
  const cpvText = typeof cpvRaw === "object" ? extractLang(cpvRaw as Record<string,string[]>) : String(cpvRaw ?? "")

  // Date
  // publication-date = data di pubblicazione sul TES
  // dispatch-date = data di invio al giornale
  // deadline-date-lot = scadenza offerte (eForms), deadline = scadenza legacy
  const dataPub = n["publication-date"] ?? n["dispatch-date"] ?? null
  const dataScadenza = n["deadline-date-lot"] ?? n["deadline"] ?? null

  return {
    id:                  `ted:${pubNum}`,
    cig:                 pubNum,
    oggetto:             titleText,
    importo,
    stato:               "active",
    provincia:           null,
    data_pubblicazione:  dataPub,
    data_scadenza:       dataScadenza,
    tipo_contratto:      n["contract-nature-main-lot"] ?? null,
    descrizione_cpv:     cpvText || null,
    sources:             "ted",
    link_originale:      htmlLink,
    stazione_appaltante: stazione,
  }
}

export interface TedFetchParams {
  q?:        string
  page?:     number
  pageSize?: number
  importo?:  string
  scadenza?: string
  tipo?:     string
  onlyIT?:   boolean
}

export async function fetchTED(
  params: TedFetchParams,
  apiKey: string,
): Promise<SourceResult> {
  const { q, page = 0, pageSize = 10, importo, scadenza, tipo, onlyIT = true } = params

  // Expert Search Query Language di TED v3
  const clauses: string[] = []

  if (onlyIT) {
    clauses.push("buyer-country=ITA")   // ISO 3166-1 alpha-3
  }

  if (tipo) {
    const natureMap: Record<string, string> = {
      goods:    "SUPPLIES",
      services: "SERVICES",
      works:    "WORKS",
    }
    const nat = natureMap[tipo] ?? tipo.toUpperCase()
    clauses.push(`contract-nature=${nat}`)
  }

  if (scadenza) {
    const days = parseInt(scadenza)
    if (!isNaN(days)) {
      const today    = new Date()
      const deadline = new Date()
      deadline.setDate(today.getDate() + days)
      const todayStr    = today.toISOString().split("T")[0]
      const deadlineStr = deadline.toISOString().split("T")[0]
      // deadline-date-lot è il campo valido per TED API v3 (submission-deadline non esiste)
      clauses.push(`deadline-date-lot>=${todayStr}`)
      clauses.push(`deadline-date-lot<=${deadlineStr}`)
    }
  }

  const importoRange = importo ? IMPORTO_TO_TED[importo] : null
  if (importoRange?.gte != null) clauses.push(`total-value>=${importoRange.gte}`)
  if (importoRange?.lte != null) clauses.push(`total-value<=${importoRange.lte}`)

  // Filtro automatico per recency: ultime 12 mesi
  // (TED v3 NON supporta sort — filtriamo per data per ottenere bandi recenti)
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  clauses.push(`publication-date>=${oneYearAgo.toISOString().split("T")[0]}`)

  // Testo libero + clausole
  // NOTA: NON usare parentesi intorno al testo libero — causano errore di sintassi
  const expertQuery = [
    ...(q ? [q] : []),
    ...clauses,
  ].join(" AND ")

  const body = {
    query:  expertQuery || `buyer-country=ITA AND publication-date>=${new Date(Date.now() - 365*86400000).toISOString().split("T")[0]}`,
    // Solo campi validi per TED API v3 (sort non è supportato)
    fields: [
      "publication-number",
      "title-lot",
      "notice-title",
      "announcement-title",
      "title-proc",
      "total-value",
      "buyer-name",
      "publication-date",
      "dispatch-date",
      "deadline-date-lot",
      "deadline",
      "contract-nature-main-lot",
      "links",
      "main-classification-proc",
    ],
    page:  page + 1,
    limit: pageSize,
  }

  const res = await fetch(`${TED_API_BASE}/notices/search`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept":        "application/json",
      "X-API-Key":     apiKey,
    },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15_000),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- Next.js estende RequestInit con 'next'
    next:    { revalidate: 120 },
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    return {
      items:  [],
      total:  0,
      source: "ted",
      error:  `TED API ${res.status}: ${errText.slice(0, 300)}`,
    }
  }

  const data    = await res.json()
  const notices = data.notices ?? data.results ?? data.data ?? []
  const total   = data.totalNoticeCount ?? data.total ?? notices.length

  return {
    items:  notices.map(mapTedNotice),
    total,
    source: "ted",
  }
}
