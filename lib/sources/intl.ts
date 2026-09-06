// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/sources/intl.ts
 * Adapter per fonti esterne — DB-backed
 *
 * Legge dalla tabella `intl_tenders` in Supabase, popolata da
 * script di sync dedicati (sync-boamp.mjs, sync-contracts-finder.mjs,
 * sync-grants-gov.mjs, sync-ec-funding.mjs, sync-rss-feeds.mjs).
 *
 * ARCHITETTURA SOTTO-FONTI:
 * Ogni bando ha un campo `source` con la fonte originale.
 * Le sotto-fonti principali sono registrate in SourceKey e mostrate
 * come badge separati nell'UI — il badge "INTL" è usato come
 * fallback generico per fonti non registrate.
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
 * Mappa sotto-fonte → SourceKey registrata.
 * Le chiavi qui devono esistere in SourceKey (lib/sources/types.ts).
 * Fonti non mappate useranno "intl" come fallback.
 */
export const INTL_SOURCE_MAP: Record<string, SourceKey> = {
  // Fonti dirette con script di sync attivo
  "boamp":                  "boamp",
  "contracts-finder":       "contracts_finder",
  "grants.gov":             "grants_gov",
  "ec.europa.eu":           "ec_funding",
  // RSS feeds italiani
  "lazioeuropa.it":         "intl",
  "regione.basilicata.it":  "intl",
  "fondazioneconilsud.it":  "intl",
}


/** Inverso: SourceKey → valore raw del campo `source` in intl_tenders */
export const INTL_SOURCE_REVERSE: Partial<Record<SourceKey, string>> = {}
for (const [raw, key] of Object.entries(INTL_SOURCE_MAP)) {
  INTL_SOURCE_REVERSE[key] = raw
}

export interface IntlFetchParams {
  q?:            string
  page?:         number
  pageSize?:     number
  importo?:      string
  scadenza?:     string
  pubblicazione?: string
  country?:      string
  /** Sotto-fonte INTL (valore raw del campo source, es. "incentivi.gov.it") */
  subSource?:    string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIntlRow(row: Record<string, any>): NormalizedTender {
  // Usa la sotto-fonte registrata se disponibile, altrimenti "intl" come fallback
  const rawSource = row.source ?? "unknown"
  const sourceKey = INTL_SOURCE_MAP[rawSource] ?? "intl"

  return {
    id:                  `intl:${row.id}`,
    cig:                 row.slug ?? String(row.id),
    oggetto:             row.titolo ?? null,
    importo:             row.importo_max != null ? Number(row.importo_max) : null,
    stato:               "active",
    provincia:           row.regione_richiesta ?? null,
    data_pubblicazione:  row.intl_created_at ?? row.synced_at ?? null,
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
 * Fetch tenders from the local Supabase `intl_tenders` table.
 * Populated via sync-boamp.mjs, sync-contracts-finder.mjs,
 * sync-grants-gov.mjs, sync-ec-funding.mjs, sync-rss-feeds.mjs.
 *
 * Returns null if the table doesn't exist or Supabase is not configured.
 */
export async function fetchIntlFromDB(
  params: IntlFetchParams,
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
    .from("intl_tenders")
    .select("*", { count: "exact" })

  // Filter by sub-source (raw value in DB)
  if (subSource) {
    query = query.eq("source", subSource)
  }

  // Filter by country
  if (country) {
    query = query.eq("country", country.toUpperCase())
  }

  // Full-text search (multilingual: simple tokenizer)
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
      query = query.gte("intl_created_at", cutoff.toISOString())
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
    console.warn("[fetchIntlFromDB] Query error:", error.message)
    return null
  }

  if (!data || (data.length === 0 && page === 0 && !q && !subSource && !country)) {
    return null
  }

  const items: NormalizedTender[] = (data ?? []).map(mapIntlRow)

  return {
    items,
    total:  count ?? items.length,
    source: sourceKeyOverride ?? "intl",
  }
}
