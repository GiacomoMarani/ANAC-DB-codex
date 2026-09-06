// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * scpMit.ts — Servizio Contratti Pubblici (SCP) / MIT
 *
 * Query live alla Banca dati SCP del Ministero delle Infrastrutture e Trasporti
 * via CKAN Datastore API (dati.mit.gov.it).
 *
 * Fonte: https://dati.mit.gov.it/catalog/dataset/scp
 *
 * Dataset "Esiti" — contiene gli esiti di gara con:
 *   - cf_aggiudicatario  → codice fiscale / P.IVA dell'aggiudicatario
 *   - aggiudicatario     → ragione sociale
 *   - cig, cpv, importo, tipo_appalto, provincia, ruolo, ecc.
 *
 * Due risorse:
 *   - Esiti (dal 2020 in poi):  resource_id = 1f08fc66-0b04-4c1c-a398-cdb17f3ea8f4
 *   - Esiti (pre 2020):         resource_id = 6b3c2eac-d619-444b-8d1e-cbec4ece7e18
 *
 * Aggiornamento: quotidiano.
 * Licenza: CC BY 4.0
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const MIT_BASE = "https://dati.mit.gov.it/catalog/api/3/action/datastore_search"

/** Resource IDs nel portale CKAN del MIT */
const ESITI_POST_2020 = "1f08fc66-0b04-4c1c-a398-cdb17f3ea8f4"
const ESITI_PRE_2020  = "6b3c2eac-d619-444b-8d1e-cbec4ece7e18"

const REQUEST_TIMEOUT_MS = 15_000  // 15s per risorsa

// ─── Types ────────────────────────────────────────────────────────────────────

/** Record grezzo dalla risposta CKAN */
export interface ScpEsitoRaw {
  _id: number
  cig: string | null
  oggetto_lotto: string | null
  oggetto_della_gara: string | null
  tipo_appalto: string | null
  cpv: string | null
  aggiudicatario: string | null
  cf_aggiudicatario: string | null
  imp_di_aggiudicazione: string | null
  importo_gara: string | null
  data_aggiudicazione_definitiva: string | null
  data_pubblicazione_esito: string | null
  ruolo: string | null
  provincia_stazione_appaltante: string | null
  denominazione_stazione_appaltante: string | null
  tipo_procedura: string | null
  criterio_aggiudicazione: string | null
  categoria_prevalente: string | null
  cup: string | null
}

/** Record normalizzato per il profiling */
export interface ScpAggiudicazione {
  codice_fiscale: string
  denominazione: string | null
  cig: string
  importo_aggiudicazione: number | null
  data_aggiudicazione: string | null
  codice_cpv: string | null
  descrizione_cpv: null          // SCP non ha la descrizione CPV, solo il codice
  oggetto_gara: string | null
  provincia: string | null
  ruolo: string | null
  tipo_appalto: string | null
  stazione_appaltante: string | null
}

// ─── CKAN API response shape ──────────────────────────────────────────────────

interface CkanResponse {
  success: boolean
  result: {
    records: ScpEsitoRaw[]
    total: number
    _links?: { next?: string }
  }
}

// ─── Core query function ──────────────────────────────────────────────────────

/**
 * Interroga una singola risorsa CKAN per cf_aggiudicatario.
 * Restituisce i record grezzi o [] in caso di errore.
 */
async function queryResource(
  resourceId: string,
  cfAggiudicatario: string,
  limit = 500
): Promise<ScpEsitoRaw[]> {
  const filters = JSON.stringify({ cf_aggiudicatario: cfAggiudicatario })
  const url = `${MIT_BASE}?resource_id=${resourceId}&filters=${encodeURIComponent(filters)}&limit=${limit}`

  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ANAC-DB-Codex/1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      console.warn(`[SCP/MIT] HTTP ${res.status} for resource ${resourceId}`)
      return []
    }

    const data = (await res.json()) as CkanResponse
    if (!data.success || !data.result?.records) {
      console.warn(`[SCP/MIT] Unexpected response for resource ${resourceId}`)
      return []
    }

    return data.result.records
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[SCP/MIT] Query failed for resource ${resourceId}: ${msg}`)
    return []
  }
}

// ─── Normalizzazione ──────────────────────────────────────────────────────────

function parseDate(raw: string | null): string | null {
  if (!raw) return null
  // Formato MIT: "2020-05-13 02:00:00" → "2020-05-13"
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function parseAmount(raw: string | null): number | null {
  if (!raw) return null
  const n = parseFloat(raw.replace(/\s+/g, "").replace(",", "."))
  return isFinite(n) && n > 0 ? n : null
}

function normalizeRecord(raw: ScpEsitoRaw): ScpAggiudicazione | null {
  const cf = raw.cf_aggiudicatario?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  if (!cf || cf.length < 11) return null

  const cig = raw.cig?.trim()
  if (!cig) return null

  return {
    codice_fiscale: cf,
    denominazione: raw.aggiudicatario?.trim() || null,
    cig,
    importo_aggiudicazione: parseAmount(raw.imp_di_aggiudicazione),
    data_aggiudicazione: parseDate(raw.data_aggiudicazione_definitiva)
      || parseDate(raw.data_pubblicazione_esito),
    codice_cpv: raw.cpv?.trim() || null,
    descrizione_cpv: null,
    oggetto_gara: (raw.oggetto_lotto || raw.oggetto_della_gara)?.trim().substring(0, 4000) || null,
    provincia: raw.provincia_stazione_appaltante?.trim().toUpperCase() || null,
    ruolo: raw.ruolo?.trim().toLowerCase() || null,
    tipo_appalto: raw.tipo_appalto?.trim() || null,
    stazione_appaltante: raw.denominazione_stazione_appaltante?.trim() || null,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Cerca tutte le aggiudicazioni per una data P.IVA/CF nella banca dati SCP/MIT.
 *
 * Interroga in parallelo le due risorse (post-2020 e pre-2020) e restituisce
 * i risultati unificati e de-duplicati per (codice_fiscale, cig).
 */
export async function lookupScpMit(partitaIva: string): Promise<{
  records: ScpAggiudicazione[]
  total: number
  source: "scp_mit"
}> {
  // Query parallele sulle due risorse
  const [postRecords, preRecords] = await Promise.all([
    queryResource(ESITI_POST_2020, partitaIva),
    queryResource(ESITI_PRE_2020, partitaIva),
  ])

  // Normalizza e de-duplica per (cf, cig)
  const seen = new Set<string>()
  const records: ScpAggiudicazione[] = []

  // Post-2020 ha priorità (dati più recenti/aggiornati)
  for (const raw of [...postRecords, ...preRecords]) {
    const normalized = normalizeRecord(raw)
    if (!normalized) continue

    const key = `${normalized.codice_fiscale}:${normalized.cig}`
    if (seen.has(key)) continue
    seen.add(key)

    records.push(normalized)
  }

  // Ordina per data aggiudicazione (più recenti prima)
  records.sort((a, b) => {
    if (!a.data_aggiudicazione && !b.data_aggiudicazione) return 0
    if (!a.data_aggiudicazione) return 1
    if (!b.data_aggiudicazione) return -1
    return b.data_aggiudicazione.localeCompare(a.data_aggiudicazione)
  })

  return { records, total: records.length, source: "scp_mit" }
}
