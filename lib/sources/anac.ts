/**
 * lib/sources/anac.ts
 *
 * Adapter per ANAC — Banca Dati Nazionale Contratti Pubblici
 *
 * ARCHITETTURA:
 * Il portale ANAC (dati.anticorruzione.it) usa Apache Superset + Dremio.
 * Il WAF F5 di ANAC blocca le connessioni server-to-server (TLS fingerprinting).
 * 
 * Soluzioni implementate:
 * 1. buildAnacPayload() — costruisce il body per POST /api/v1/chart/data
 *    → usato dal proxy client-side (/api/anac-proxy) quando il browser
 *      passa le sue credenziali ANAC al backend
 * 2. fetchANAC() — tenta la connessione server-to-server; fallisce sul
 *    WAF di produzione ma funziona in ambienti senza F5 (dev locale →
 *    dati.anticorruzione.it se il WAF non è attivo sul tuo IP)
 *
 * ENDPOINT ANAC SUPERSET:
 *   POST https://dati.anticorruzione.it/api/v1/chart/data
 *   datasource id: 83 (APPALTI_NO_ACCORDO_QUADRO)
 *   tabella SQL: appalti."06_all_noAQ"
 *
 * SCOPERTO VIA Chrome DevTools reverse engineering del dashboard:
 *   https://dati.anticorruzione.it/superset/dashboard/appalti/
 *
 * Campi disponibili (da datasets API):
 *   cig, oggetto_bando, importo_lotto, data_pubblicazione,
 *   denominazione_amministrazione_appaltante, oggetto_principale_contratto,
 *   tipo_scelta_contraente, provincia, sezione_regionale,
 *   anno_pubblicazione, data_aggiudicazione_definitiva
 */

import type { NormalizedTender, SourceResult } from "./types"

const ANAC_BASE    = "https://dati.anticorruzione.it"

/**
 * Datasource ANAC Superset (Dremio):
 *   id=83 → APPALTI_NO_ACCORDO_QUADRO → appalti."06_all_noAQ"   (tutti gli appalti)
 *   id=81 → BANDI_IN_CORSO            → appalti.ordinari."05_ordinari_inCorso_noAq"
 */
const DS_APPALTI   = 83
const DS_BANDI_IN_CORSO = 81

const TIPO_MAP: Record<string, string> = {
  FORNITURE: "Forniture",
  SERVIZI:   "Servizi",
  LAVORI:    "Lavori",
}

const IMPORTO_RANGES: Record<string, { gte?: number; lte?: number }> = {
  "< €40.000":    { lte: 40_000 },
  "€40k – €150k": { gte: 40_000,  lte: 150_000 },
  "€150k – €1M":  { gte: 150_000, lte: 1_000_000 },
  "€1M – €5M":    { gte: 1_000_000, lte: 5_000_000 },
  "> €5M":        { gte: 5_000_000 },
}

export interface AnacFetchParams {
  q?:        string
  page?:     number
  pageSize?: number
  anno?:     number
  tipo?:     string
  importo?:  string
  provincia?: string
  /** Se true usa il datasource BANDI_IN_CORSO (ds id=81) */
  inCorso?:  boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapAnacRow(row: Record<string, any>): NormalizedTender {
  const tsMs = typeof row.data_pubblicazione === "number" ? row.data_pubblicazione : null
  return {
    id:                  `anac:${row.cig}`,
    cig:                 row.cig ?? null,
    oggetto:             row.oggetto_bando ?? null,
    importo:             typeof row.importo_lotto === "number" ? row.importo_lotto : null,
    stato:               "active",
    provincia:           row.provincia ?? row.sezione_regionale?.replace("SEZIONE REGIONALE ", "") ?? null,
    data_pubblicazione:  tsMs ? new Date(tsMs).toISOString() : null,
    data_scadenza:       null,
    tipo_contratto:      TIPO_MAP[row.oggetto_principale_contratto] ?? row.oggetto_principale_contratto ?? null,
    descrizione_cpv:     row.cod_cpv ?? null,
    sources:             "anac",
    link_originale:      row.cig
      ? `https://dati.anticorruzione.it/superset/recaptcha/?cig=${row.cig}&next=dettaglio_cig`
      : null,
    stazione_appaltante: row.denominazione_amministrazione_appaltante ?? null,
  }
}

/**
 * Costruisce il payload Superset per la query ANAC.
 * Esportato per uso lato client (proxy pattern).
 */
export function buildAnacPayload(params: AnacFetchParams) {
  const {
    q,
    pageSize = 10,
    anno     = new Date().getFullYear(),
    tipo,
    importo,
    provincia,
    inCorso  = false,
  } = params

  // BANDI_IN_CORSO non ha anno_pubblicazione — usa tutti i record
  const datasourceId = inCorso ? DS_BANDI_IN_CORSO : DS_APPALTI

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filters: any[] = inCorso
    ? []  // BANDI_IN_CORSO già filtra per bandi aperti
    : [{ col: "anno_pubblicazione", op: "==", val: anno }]

  if (q)         filters.push({ col: "oggetto_bando", op: "LIKE", val: `%${q.toUpperCase()}%` })
  if (provincia) filters.push({ col: "provincia", op: "==", val: provincia })

  if (tipo) {
    const m: Record<string, string> = { goods: "FORNITURE", services: "SERVIZI", works: "LAVORI" }
    filters.push({ col: "oggetto_principale_contratto", op: "==", val: m[tipo.toLowerCase()] ?? tipo.toUpperCase() })
  }

  const ir = importo ? IMPORTO_RANGES[importo] : null
  if (ir?.gte != null) filters.push({ col: "importo_lotto", op: ">=", val: ir.gte })
  if (ir?.lte != null) filters.push({ col: "importo_lotto", op: "<=", val: ir.lte })

  // Colonne diverse per datasource 81 (BANDI_IN_CORSO) vs 83 (APPALTI)
  const columns = inCorso
    ? ["cig","oggetto_bando","importo_lotto","denominazione_amministrazione_appaltante","data_pubblicazione","oggetto_principale_contratto","tipo_scelta_contraente","sezione_regionale","cod_cpv","flag_pnrr_pnc","provincia"]
    : ["cig","oggetto_bando","importo_lotto","denominazione_amministrazione_appaltante","data_pubblicazione","oggetto_principale_contratto","tipo_scelta_contraente","provincia","sezione_regionale"]

  return {
    datasource: { id: datasourceId, type: "table" },
    force:      false,
    queries: [{
      time_range: "No filter",
      filters,
      extras: { time_range_endpoints: ["inclusive", "exclusive"], having: "", having_druid: [], where: "" },
      applied_time_extras: {},
      columns,
      metrics:           [],
      orderby:           [["data_pubblicazione", false]],
      annotation_layers: [],
      row_limit:         pageSize,
      timeseries_limit:  0,
      order_desc:        true,
      url_params:        {},
      custom_params:     {},
      custom_form_data:  {},
      groupby:           [],
    }],
    form_data: {
      datasource:   `${datasourceId}__table`,
      viz_type:     "table",
      query_mode:   "raw",
      all_columns:  columns,
      groupby:      [],
      metrics:      [],
      row_limit:    pageSize,
      order_desc:   true,
      result_format: "json",
      result_type:  "full",
    },
    result_format: "json",
    result_type:   "full",
  }
}

// Cache della sessione server-side (funziona solo senza WAF / in dev)
let _session: { rawCookies: string; csrf: string; expiresAt: number } | null = null

async function getAnacSession(): Promise<{ rawCookies: string; csrf: string } | null> {
  const now = Date.now()
  if (_session && _session.expiresAt > now) return _session

  try {
    const homeRes = await fetch(`${ANAC_BASE}/superset/dashboard/appalti/`, {
      method:   "GET",
      redirect: "follow",
      headers: {
        "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:           "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- Next.js estende RequestInit con 'next'
      next:   { revalidate: 0 },
      signal: AbortSignal.timeout(30_000),
    })

    const setCookieHeaders = homeRes.headers.getSetCookie?.() ?? []
    const cookieString = setCookieHeaders.map(c => c.split(";")[0].trim()).filter(Boolean).join("; ")

    if (!cookieString) return null

    const csrfRes = await fetch(`${ANAC_BASE}/api/v1/security/csrf_token/`, {
      method:  "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:       "application/json",
        Cookie:       cookieString,
      },
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- Next.js estende RequestInit con 'next'
      next:   { revalidate: 0 },
      signal: AbortSignal.timeout(15_000),
    })

    if (!csrfRes.ok) return null
    const { result: csrf } = await csrfRes.json()
    if (!csrf) return null

    _session = { rawCookies: cookieString, csrf, expiresAt: now + 20 * 60_000 }
    return _session
  } catch {
    return null
  }
}

export async function fetchANAC(params: AnacFetchParams): Promise<SourceResult> {
  const session = await getAnacSession()
  if (!session) {
    // Il WAF blocca le connessioni server-to-server.
    // I dati ANAC sono accessibili via proxy client-side (/api/anac-proxy).
    return {
      items:  [],
      total:  0,
      source: "anac",
      error:  "ANAC: sessione server-to-server bloccata dal WAF. Usa /api/anac-proxy con le credenziali browser.",
    }
  }

  const payload = buildAnacPayload(params)

  try {
    const res = await fetch(`${ANAC_BASE}/api/v1/chart/data`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        "X-CSRFToken":  session.csrf,
        Cookie:         session.rawCookies,
        Referer:        `${ANAC_BASE}/superset/dashboard/appalti/`,
        Origin:         ANAC_BASE,
        "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- Next.js aggiunge 'next' a RequestInit
      next:   { revalidate: 60 },
    })

    if (!res.ok) {
      _session = null
      return { items: [], total: 0, source: "anac", error: `ANAC HTTP ${res.status}` }
    }

    const data   = await res.json()
    const result = data?.result?.[0]

    if (result?.error) {
      return { items: [], total: 0, source: "anac", error: `ANAC Dremio: ${String(result.error).slice(0, 200)}` }
    }

    const rows: Record<string, unknown>[] = result?.data ?? []
    return { items: rows.map(mapAnacRow), total: result?.rowcount ?? rows.length, source: "anac" }
  } catch (err) {
    _session = null
    return { items: [], total: 0, source: "anac", error: `ANAC fetch: ${err instanceof Error ? err.message : String(err)}` }
  }
}
