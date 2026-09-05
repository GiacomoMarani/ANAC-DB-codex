/**
 * lib/sources/bandolo.ts
 * Adapter per Bandolo (getbandolo.com) — DB-backed
 *
 * Legge dalla tabella `bandolo_tenders` in Supabase, popolata da
 * scripts/sync-bandolo.mjs. Aggrega 1.096 fonti istituzionali:
 * incentivi.gov.it, invitalia.it, ted.europa.eu e altre.
 *
 * ARCHITETTURA SOTTO-FONTI:
 * Come CATO, Bandolo è un aggregatore: ogni bando ha un campo `source`
 * con la fonte originale (es. "incentivi.gov.it", "inpa.gov.it").
 * Le sotto-fonti principali sono registrate in SourceKey e mostrate
 * come badge separati nell'UI — il badge "Bandolo" non esiste.
 * Le sotto-fonti non registrate vengono comunque mostrate usando
 * direttamente il valore raw del campo `source` come label.
 */

import type { NormalizedTender, SourceKey, SourceResult } from "./types"

const IMPORTO_RANGES: Record<string, { gte?: number; lte?: number }> = {
  "< €40.000":    { lte: 40_000 },
  "€40k – €150k": { gte: 40_000,  lte: 150_000 },
  "€150k – €1M":  { gte: 150_000, lte: 1_000_000 },
  "€1M – €5M":    { gte: 1_000_000, lte: 5_000_000 },
  "> €5M":        { gte: 5_000_000 },
}

/**
 * Mappa sotto-fonte Bandolo → SourceKey registrata.
 * Le chiavi qui devono esistere in SourceKey (lib/sources/types.ts).
 * Fonti non mappate useranno "bandolo" come fallback.
 */
export const BANDOLO_SOURCE_MAP: Record<string, SourceKey> = {
  // Vecchie sotto-fonti Bandolo
  "incentivi.gov.it":       "incentivi_gov",
  "invitalia.it":           "invitalia",
  "inpa.gov.it":            "inpa_gov",
  "concorsipubblici.com":   "concorsipubblici",
  "euraxess.ec.europa.eu":  "euraxess",
  "ted.europa.eu":          "ted_bandolo",
  "untalent.org":           "untalent",
  // Nuove fonti dirette
  "boamp":                  "boamp",
  "contracts-finder":       "contracts_finder",
  "grants.gov":             "grants_gov",
  "ec.europa.eu":           "ec_funding",
  "reporter.nih.gov":       "nih_reporter",
  "lazioeuropa.it":         "bandolo",
  "regione.basilicata.it":  "bandolo",
  "fondazioneconilsud.it":  "bandolo",
}


/** Inverso: SourceKey → valore raw del campo `source` in bandolo_tenders */
export const BANDOLO_SOURCE_REVERSE: Partial<Record<SourceKey, string>> = {}
for (const [raw, key] of Object.entries(BANDOLO_SOURCE_MAP)) {
  BANDOLO_SOURCE_REVERSE[key] = raw
}

export interface BandoloFetchParams {
  q?:            string
  page?:         number
  pageSize?:     number
  importo?:      string
  scadenza?:     string
  pubblicazione?: string
  country?:      string
  /** Sotto-fonte Bandolo (valore raw del campo source, es. "incentivi.gov.it") */
  subSource?:    string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBandoloRow(row: Record<string, any>): NormalizedTender {
  // Usa la sotto-fonte registrata se disponibile, altrimenti "bandolo" come fallback
  const rawSource = row.source ?? "unknown"
  const sourceKey = BANDOLO_SOURCE_MAP[rawSource] ?? "bandolo"

  return {
    id:                  `bandolo:${row.id}`,
    cig:                 row.slug ?? String(row.id),
    oggetto:             row.titolo ?? null,
    importo:             row.importo_max != null ? Number(row.importo_max) : null,
    stato:               "active",
    provincia:           row.regione_richiesta ?? null,
    data_pubblicazione:  row.bandolo_created_at ?? row.synced_at ?? null,
    data_scadenza:       row.scadenza ?? null,
    tipo_contratto:      row.tender_type ?? null,
    descrizione_cpv:     row.settori ?? null,
    sources:             sourceKey,
    link_originale:      row.link ?? null,
    stazione_appaltante: row.ente ?? null,
    country:             row.country ?? null,
  }
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

/**
 * Fetch Bandolo tenders from the local Supabase `bandolo_tenders` table.
 * Populated via `scripts/sync-bandolo.mjs`.
 *
 * Returns null if the table doesn't exist or Supabase is not configured.
 */
export async function fetchBandoloFromDB(
  params: BandoloFetchParams,
  sourceKeyOverride?: SourceKey,
): Promise<SourceResult | null> {
  let createAdminClient: typeof import("@/lib/supabase/admin").createAdminClient
  try {
    const mod = await import("@/lib/supabase/admin")
    createAdminClient = mod.createAdminClient
  } catch {
    return null
  }

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch {
    return null
  }

  const { q, page = 0, importo, scadenza, pubblicazione, country, subSource } = params
  const PAGE_SIZE = params.pageSize ?? 10

  let query = supabase
    .from("bandolo_tenders")
    .select("*", { count: "exact" })

  // Filter by sub-source (raw value in DB)
  if (subSource) {
    query = query.eq("source", subSource)
  }

  // Filter by country
  if (country) {
    query = query.eq("country", country.toUpperCase())
  }

  // Full-text search (Italian)
  if (q?.trim()) {
    query = query.textSearch("fts", q.trim(), { type: "plain", config: "simple" })
  }

  // Importo range
  if (importo) {
    const range = IMPORTO_RANGES[importo]
    if (range) {
      if (range.gte != null) query = query.gte("importo_max", range.gte)
      if (range.lte != null) query = query.lte("importo_max", range.lte)
    }
  }

  // Scadenza (days from now)
  if (scadenza) {
    const days = parseInt(scadenza, 10)
    if (!isNaN(days)) {
      const now = new Date()
      const deadline = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
      query = query.gte("scadenza", now.toISOString().slice(0, 10))
      query = query.lte("scadenza", deadline.toISOString().slice(0, 10))
    }
  }

  // Publication date filter
  if (pubblicazione) {
    const cutoff = getPublicationCutoff(pubblicazione)
    if (cutoff) {
      query = query.gte("bandolo_created_at", cutoff.toISOString())
    }
  }

  // Pagination & ordering
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  query = query
    .order("scadenza", { ascending: true, nullsFirst: false })
    .order("synced_at", { ascending: false })
    .range(from, to)

  const { data, count, error } = await query

  if (error) {
    console.warn("[fetchBandoloFromDB] Query error:", error.message)
    return null
  }

  if (!data || (data.length === 0 && page === 0 && !q && !subSource && !country)) {
    return null
  }

  const items: NormalizedTender[] = (data ?? []).map(mapBandoloRow)

  return {
    items,
    total:  count ?? items.length,
    source: sourceKeyOverride ?? "bandolo",
  }
}
