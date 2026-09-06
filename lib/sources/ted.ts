// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/sources/ted.ts
 * Adapter per TED Europa (api.ted.europa.eu/v3)
 *
 * Campi validi: https://api.ted.europa.eu/swagger-ui/index.html
 * Auth: X-API-Key header
 *
 * Note dall'esplorazione API (vedi anche https://docs.ted.europa.eu/apis/3.0/search.html
 * e lo spec OpenAPI https://api.ted.europa.eu/api-v3.yaml):
 * - Risposta: { notices: [...], totalNoticeCount: N }
 * - Ogni notice: publication-number, buyer-name (multilingua), links, title-lot, total-value, ...
 * - Query "buyer-country=ITA" per filtrare Italia (ISO 3166-1 alpha-3)
 * - Pagination: page (1-based), limit (max 250/pagina, max 15.000 risultati raggiungibili)
 * - Sort: non è un parametro JSON separato, si esprime dentro "query" con
 *   "SORT BY <field> ASC|DESC" (Expert Query Language)
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

function formatTedDate(date: Date): string {
  return date.toISOString().split("T")[0].replace(/-/g, "")
}

// Estrae il testo dalla struttura multilingua di TED (preferenza: ita > eng > primo disponibile)
function extractLang(obj: Record<string, string[]> | string[] | string | null | undefined): string | null {
  if (!obj) return null
  // Se è già una stringa, restituiscila direttamente
  if (typeof obj === "string") return obj
  // Se è un array di stringhe, prendi il primo elemento
  if (Array.isArray(obj)) return obj[0] ?? null
  // Oggetto multilingua { ita: [...], eng: [...], ... }
  return (
    obj.ita?.[0] ??
    obj.eng?.[0] ??
    obj.fra?.[0] ??
    Object.values(obj)[0]?.[0] ??
    null
  )
}

/** Unwrap un valore TED che può essere stringa, array di stringhe, o null */
function unwrapTedValue(val: unknown): string | null {
  if (val == null) return null
  if (typeof val === "string") return val
  if (Array.isArray(val)) return val[0] ?? null
  return String(val)
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
  // TED v3: title-lot (lotti eForms, titolo vero), notice-title (spesso solo iniziale paese "I"),
  // announcement-title, title-proc
  // Scarta titoli ≤ 2 caratteri (es. "I" = Italia, "S" = Spain)
  const minLen = (s: string | null) => s && s.length > 2 ? s : null
  const titleText =
    minLen(extractLang(n["title-lot"]        as Record<string,string[]>)) ??
    minLen(extractLang(n["notice-title"]     as Record<string,string[]>)) ??
    minLen(extractLang(n["announcement-title"] as Record<string,string[]>)) ??
    minLen(extractLang(n["title-proc"]       as Record<string,string[]>)) ??
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

  // CPV — può essere oggetto multilingua, array, stringa, o numero
  const cpvRaw  = n["main-classification-proc"] ?? n["cpv-code"] ?? null
  const cpvText = extractLang(cpvRaw as Record<string, string[]> | string[] | string | null)

  // Date
  // publication-date = data di pubblicazione sul TES
  // dispatch-date = data di invio al giornale
  // deadline-receipt-tender-date-lot = scadenza presentazione offerte (campo eForms standard, BT-131),
  // deadline-date-lot/deadline = equivalenti legacy (schema pre-eForms), usati come fallback
  // Questi campi possono arrivare come array: ["2025-06-23+02:00"] → estrarre e pulire
  const dataPub = unwrapTedValue(n["publication-date"] ?? n["dispatch-date"])
  const dataScadRaw = unwrapTedValue(
    n["deadline-receipt-tender-date-lot"] ?? n["deadline-date-lot"] ?? n["deadline"]
  )
  // Rimuovi timezone offset (+02:00) per uniformità ISO
  const dataScadenza = dataScadRaw?.replace(/\+\d{2}:\d{2}$/, "") ?? null

  // Luogo di esecuzione (città) — presente per lotto o, in mancanza, a livello di procedura
  const provincia = unwrapTedValue(
    n["place-of-performance-city-lot"] ?? n["place-of-performance-city-proc"]
  )

  return {
    id:                  `ted:${pubNum}`,
    cig:                 pubNum,
    oggetto:             titleText,
    importo,
    stato:               "active",
    provincia,
    data_pubblicazione:  typeof dataPub === "string" ? dataPub.replace(/\+\d{2}:\d{2}$/, "") : dataPub,
    data_scadenza:       dataScadenza,
    tipo_contratto:      mapTedContractNature(n["contract-nature-main-lot"]),
    descrizione_cpv:     cpvText || null,
    sources:             "ted",
    link_originale:      htmlLink,
    stazione_appaltante: stazione,
  }
}

/** Mappa il tipo contratto TED (può essere array) in label italiana */
function mapTedContractNature(raw: unknown): string | null {
  if (!raw) return null
  const val = Array.isArray(raw) ? raw[0] : String(raw)
  if (!val) return null
  const map: Record<string, string> = {
    supplies: "Forniture", SUPPLIES: "Forniture",
    services: "Servizi",   SERVICES: "Servizi",
    works:    "Lavori",     WORKS:    "Lavori",
  }
  return map[val] ?? val
}

export interface TedFetchParams {
  q?:        string
  page?:     number
  pageSize?: number
  importo?:  string
  scadenza?: string
  pubblicazione?: string
  tipo?:     string
  onlyIT?:   boolean
  /** Filtro paese ISO-2 (IT, FR, DE, etc.) — sovrascrive onlyIT se specificato */
  country?:  string
}

export async function fetchTED(
  params: TedFetchParams,
  apiKey: string,
): Promise<SourceResult> {
  const { q, page = 0, pageSize = 10, importo, scadenza, pubblicazione, tipo, onlyIT = true, country } = params

  // Mappa codice ISO-2 → ISO alpha-3 per TED Expert Query
  const ISO2_TO_ISO3: Record<string, string> = {
    IT: "ITA", FR: "FRA", DE: "DEU", ES: "ESP", GB: "GBR", US: "USA",
    NL: "NLD", BE: "BEL", AT: "AUT", PT: "PRT", SE: "SWE", PL: "POL",
    CZ: "CZE", HU: "HUN", RO: "ROU", BG: "BGR", HR: "HRV", SI: "SVN",
    SK: "SVK", LT: "LTU", LV: "LVA", EE: "EST", IE: "IRL", DK: "DNK",
    FI: "FIN", LU: "LUX", MT: "MLT", CY: "CYP", GR: "GRC", NO: "NOR",
    CH: "CHE",
  }

  // Expert Search Query Language di TED v3
  const clauses: string[] = []

  // Filtro paese: country esplicito sovrascrive onlyIT
  if (country && country !== "ALL" && country !== "INTL") {
    const alpha3 = ISO2_TO_ISO3[country.toUpperCase()] ?? country.toUpperCase()
    clauses.push(`buyer-country=${alpha3}`)
  } else if (!country && onlyIT) {
    clauses.push("buyer-country=ITA")   // default: solo Italia
  }
  // Se country === "ALL" o "INTL" → nessun filtro paese (tutti i bandi TED)

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
      // TED v3 usa formato data YYYYMMDD (senza trattini)
      const todayStr    = today.toISOString().split("T")[0].replace(/-/g, "")
      const deadlineStr = deadline.toISOString().split("T")[0].replace(/-/g, "")
      clauses.push(`deadline-date-lot>=${todayStr}`)
      clauses.push(`deadline-date-lot<=${deadlineStr}`)
    }
  }

  const publicationCutoff = pubblicazione ? getPublicationCutoff(pubblicazione) : null
  if (publicationCutoff) {
    clauses.push(`publication-date>=${formatTedDate(publicationCutoff)}`)
  }

  const importoRange = importo ? IMPORTO_TO_TED[importo] : null
  if (importoRange?.gte != null) clauses.push(`total-value>=${importoRange.gte}`)
  if (importoRange?.lte != null) clauses.push(`total-value<=${importoRange.lte}`)

  // Filtra solo bandi di gara (competition notices) — esclude esiti (can-*) e qualification systems (qu-sy)
  // TED non supporta IN(...) con virgola, serve un OR esplicito
  clauses.push("(notice-type=cn-standard OR notice-type=cn-social OR notice-type=cn-desg OR notice-type=pin-cfc-standard OR notice-type=pin-cfc-social)")

  // deadline-date-lot è presente solo per ~10% dei bandi TED (il resto lo ha solo nella pagina web, non nell'API)
  // Usiamo publication-date degli ultimi 2 mesi + scope ACTIVE come proxy ragionevole
  // per gare ancora aperte: un bando pubblicato < 2 mesi fa con scope ACTIVE è probabilmente attivo
  if (!scadenza && !pubblicazione) {
    const twoMonthsAgo = new Date()
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)
    const pubDateFilter = twoMonthsAgo.toISOString().split("T")[0].replace(/-/g, "")
    clauses.push(`publication-date>=${pubDateFilter}`)
  }

  // Testo libero: split parole e AND — ogni parola deve matchare in almeno un campo titolo
  const textClauses: string[] = []
  if (q) {
    const words = q.trim().split(/\s+/).filter(Boolean)
    for (const word of words) {
      textClauses.push(`(title-lot~${word} OR notice-title~${word} OR announcement-title~${word})`)
    }
  }

  const expertQuery = [
    ...textClauses,
    ...clauses,
  ].join(" AND ")

  const defaultQuery = country && country !== "ALL" && country !== "INTL"
    ? `buyer-country=${ISO2_TO_ISO3[country.toUpperCase()] ?? country.toUpperCase()}`
    : "buyer-country=ITA"
  // SORT BY va in coda alla query (Expert Query Language), non è un parametro JSON separato:
  // così i risultati arrivano dal più recente al più vecchio invece che in ordine arbitrario.
  const query = `${expertQuery || defaultQuery} SORT BY publication-date DESC`
  const body = {
    query,
    // scope "ACTIVE" = solo bandi con deadline non ancora scaduta
    scope:  "ACTIVE",
    // Solo campi validi per TED API v3 (il sort è nella query, vedi sopra)
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
      "deadline-receipt-tender-date-lot",
      "deadline-date-lot",
      "deadline",
      "contract-nature-main-lot",
      "links",
      "main-classification-proc",
      "notice-type",
      "place-of-performance-city-lot",
      "place-of-performance-city-proc",
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
  const mapped  = notices.map(mapTedNotice)

  // Post-filtro: rimuovi bandi senza scadenza pubblicati più di 60 giorni fa
  // (sono probabilmente scaduti ma TED li segna ancora come "ACTIVE")
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 60)
  const today = new Date().toISOString().slice(0, 10)
  const filtered = mapped.filter((item: NormalizedTender) => {
    // deadline-date-lot è spesso un valore stale legato a un lotto già chiuso:
    // se c'è una scadenza, tienila solo se non è già passata
    if (item.data_scadenza) return item.data_scadenza >= today
    if (!item.data_pubblicazione) return false  // nessuna data → scarta
    return new Date(item.data_pubblicazione) >= cutoff
  })

  return {
    items:  filtered,
    total:  Math.min(total, total - (mapped.length - filtered.length)),
    source: "ted",
  }
}
