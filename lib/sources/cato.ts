/**
 * lib/sources/cato.ts
 * Adapter Cato (www.get-cato.com/api/tenders)
 *
 * NOTA: l'API Cato non supporta un filtro "fonte" lato server — un parametro
 * `source` (in qualunque valore, anche inventato) viene ignorato silenziosamente
 * e restituisce sempre lo stesso set di risultati (verificato via devtools su
 * get-cato.com/gare, che infatti non espone alcun filtro "Fonte" in UI).
 * Il filtro per fonte qui sotto è quindi applicato client-side dopo il fetch
 * (vedi fetchCato) — ogni pagina Cato restituisce comunque sempre 10 item grezzi
 * (nessun parametro di page-size ha effetto), quindi con il filtro attivo
 * alcune pagine possono risultare vuote/parziali.
 * Parametri nativi verificati: q (full-text), tp (tipo_procedura, match esatto),
 * min/max (importo), days (scadenza in giorni), p (pagina).
 */

import type { NormalizedTender, SourceKey, SourceResult } from "./types"

const CATO_BASE = "https://www.get-cato.com/api/tenders"

/**
 * Mappa fasce importo → parametri min/max numerici in euro
 * (CATO usa ?min=150000&max=1000000, NON la stringa label)
 */
const IMPORTO_TO_MINMAX: Record<string, { min?: number; max?: number }> = {
  "< €40.000":    { max: 40_000 },
  "€40k – €150k": { min: 40_000,   max: 150_000 },
  "€150k – €1M":  { min: 150_000,  max: 1_000_000 },
  "€1M – €5M":    { min: 1_000_000, max: 5_000_000 },
  "> €5M":        { min: 5_000_000 },
}

/**
 * Mappa tipo contratto → valori accettati da CATO
 * (dall'ispezione dei select del portale get-cato.com/gare)
 */
const TIPO_TO_CATO: Record<string, string> = {
  goods:    "Forniture",
  services: "Servizi",
  works:    "Lavori pubblici",
}

export interface CatoFetchParams {
  q?:        string
  page?:     number
  pageSize?: number
  importo?:  string
  scadenza?: string
  pubblicazione?: string
  tipo?:     string
  /** Fonte specifica (valore raw del campo 'sources' Cato, es. "sintel"): filtrato
   *  client-side, l'API Cato non lo supporta lato server (vedi header file) */
  source?:   string
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

/** Converte "DD/MM/YYYY" / "DD/MM/YYYY HH:mm" (italiano) o ISO in "YYYY-MM-DD" */
function parseCatoDate(raw: unknown): string | null {
  if (!raw) return null
  const dmyMatch = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`
  }
  return String(raw).split('T')[0] // già ISO
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCatoItem(item: any, defaultSource: SourceKey): NormalizedTender {
  const info = item.extracted_main_info ?? {}
  const src  = (item.sources ?? item.source ?? defaultSource) as SourceKey

  // Oggetto: Cato usa 'oggetto' (non 'title')
  const oggetto = item.oggetto ?? info.oggetto ?? item.title ?? null

  // Data scadenza: campo diretto o nested in extracted_main_info.date
  const scadenzaRaw =
    item.data_scadenza ??
    info.date?.termine_presentazione_offerte ??
    info.data_scadenza ??
    info.scadenza ??
    item.data_scadenza_offerta ??
    null
  const data_scadenza = parseCatoDate(scadenzaRaw)

  // Data pubblicazione: info.date.pubblicazione è la data REALE del bando (può essere anche
  // molto nel passato). item.created_at è invece la data di ingestion nel DB di Cato — usarla
  // come pubblicazione farebbe apparire "nuovi" bandi vecchi di mesi/anni. Fallback su created_at
  // solo quando la data reale non è disponibile.
  const data_pubblicazione = parseCatoDate(info.date?.pubblicazione) ?? item.created_at ?? null

  // Link: Cato usa 'link_web' come URL diretto alla fonte
  const link = item.link_web ?? item.original_url ?? item.link_originale ?? null

  // Importo
  const importoRaw = item.importo ?? info.importi?.importo_base ?? info.importi?.importo_complessivo ?? info.importo ?? 0
  const importo = parseFloat(String(importoRaw)) || null

  // Stazione appaltante
  const stazione = info.stazione_appaltante ??
    info.dati_stazione_appaltante?.nome ??
    item.stazione_appaltante ?? null

  // Luogo: preferisci la coppia "Comune, Regione" (più informativa), poi il campo
  // 'luogo' già composto da Cato, infine la sola provincia come ultima risorsa
  const { comune, regione, provincia: provinciaSola } = info.ubicazione ?? {}
  const provincia =
    (comune && regione ? `${comune}, ${regione}` : (comune || regione)) ??
    item.luogo ??
    provinciaSola ??
    null

  // CIG: info.cig[].cig è spesso solo un indice di lotto placeholder ("1", "2", …), non un
  // vero CIG (10 caratteri alfanumerici) — succede per bandi con origine TED o pvl_anac dentro
  // Cato. In quel caso numero_gara è più affidabile: per i bandi di origine TED coincide
  // esattamente col publication-number che usa anche il nostro adapter TED nativo (fixa sia il
  // "CIG" fittizio in UI sia la mancata de-duplicazione tra Cato e TED in route.ts).
  const isRealCig = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9]{10}$/.test(s)
  const lotCig = info.cig?.[0]?.cig
  const cig = isRealCig(lotCig) ? lotCig : (item.numero_gara ?? item.cig ?? String(item.id))

  return {
    id:                  `${src}:${item.id}`,
    cig,
    oggetto,
    importo,
    stato:               item.status ?? item.stato ?? "active",
    provincia,
    data_pubblicazione,
    data_scadenza,
    tipo_contratto:      info.procedura?.tipo_procedura ?? item.tipo_procedura ?? item.tipo_contratto ?? null,
    descrizione_cpv:     (info.procedura?.codice_cpv as Array<{codice:string;etichetta:string}> | undefined)
                           ?.map(c => c.codice).join(", ") ??
                         (item.cpv_codes as string[] | undefined)?.join(", ") ??
                         item.descrizione_cpv ?? null,
    sources:             src,
    link_originale:      link,
    stazione_appaltante: stazione,
  }
}

/**
 * Quanti item filtrati vogliamo restituire per "pagina logica" quando un filtro
 * sotto-fonte è attivo. L'API Cato restituisce sempre 10 item grezzi per pagina
 * (mix di tutte le fonti), quindi servono più pagine per accumulare abbastanza
 * risultati della fonte richiesta.
 */
const TARGET_FILTERED_ITEMS = 10

/**
 * Quante pagine CATO consecutive possiamo scansionare per ogni richiesta
 * con filtro sotto-fonte attivo. 30 pagine = 300 item grezzi, sufficienti per
 * trovare anche le fonti più rare. Cap di sicurezza per evitare fetch infiniti.
 */
const MAX_CATO_SCAN_PAGES = 30

/** Dimensione di un batch parallelo (fetchiamo N pagine alla volta).
 *  10 pagine in parallelo completano in ~1-2 secondi (latency rete singola). */
const CATO_BATCH_SIZE = 10

/** Numero di item per pagina restituiti dall'API CATO (costante, non configurabile) */
const CATO_PAGE_SIZE = 10

/**
 * Costruisce i parametri di query per l'API CATO (tutto tranne il numero di pagina).
 */
function buildCatoQueryParams(params: CatoFetchParams): URLSearchParams {
  const { q, importo, scadenza, tipo } = params
  const p = new URLSearchParams()

  if (q?.trim()) p.set("q", q.trim())

  // Tipo procedura: parametro nativo "tp" (match esatto su tipo_procedura, verificato via devtools
  // sul sito get-cato.com/gare — es. tp=Servizi, tp=Forniture, tp=Lavori+pubblici)
  const tipoNativo = tipo ? (TIPO_TO_CATO[tipo.toLowerCase()] ?? tipo) : null
  if (tipoNativo) p.set("tp", tipoNativo)

  // Importo: usa min/max numerici in euro
  if (importo) {
    const range = IMPORTO_TO_MINMAX[importo]
    if (range) {
      if (range.min != null) p.set("min", String(range.min))
      if (range.max != null) p.set("max", String(range.max))
    }
  }

  // Scadenza: parametro nativo "days" (verificato via devtools — "scadenza" non è supportato
  // ed è ignorato silenziosamente dall'API)
  if (scadenza) p.set("days", scadenza)

  return p
}

/**
 * Fetch di una singola pagina CATO e mapping in NormalizedTender[].
 * Restituisce { items, rawTotal } dove rawTotal è il totale globale CATO.
 */
async function fetchCatoPage(
  catoPage: number,
  baseParams: URLSearchParams,
  defaultSource: SourceKey,
): Promise<{ items: NormalizedTender[]; rawTotal: number }> {
  const p = new URLSearchParams(baseParams)
  p.set("p", String(catoPage))
  const url = `${CATO_BASE}?${p.toString()}`

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept":     "application/json",
      "Referer":    "https://www.get-cato.com/gare",
    },
    signal: AbortSignal.timeout(10_000),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- Next.js estende RequestInit con 'next'
    next:   { revalidate: 60 },
  })

  if (!res.ok) {
    return { items: [], rawTotal: 0 }
  }

  const raw = await res.json()
  const items = (raw.items ?? raw.data ?? []).map((i: unknown) =>
    mapCatoItem(i, defaultSource),
  )
  return { items, rawTotal: raw.total ?? 0 }
}

export async function fetchCato(
  params: CatoFetchParams,
  defaultSource: SourceKey = "cato",
): Promise<SourceResult> {
  const { page = 0, pubblicazione, source } = params
  const baseParams = buildCatoQueryParams(params)

  const publicationCutoff = pubblicazione ? getPublicationCutoff(pubblicazione) : null

  // ── Modalità senza filtro sotto-fonte: fetch singola pagina (comportamento originale) ──
  if (!source) {
    const { items: rawItems, rawTotal } = await fetchCatoPage(page, baseParams, defaultSource)

    let items = rawItems
    if (publicationCutoff) {
      items = items.filter((item: NormalizedTender) => isPublishedSince(item.data_pubblicazione, publicationCutoff))
    }

    return {
      items,
      total:  publicationCutoff ? items.length : rawTotal,
      source: defaultSource,
    }
  }

  // ── Modalità con filtro sotto-fonte: multi-page fetch ──────────────────────
  // L'API Cato non supporta un filtro server-side per fonte — restituisce sempre
  // 10 item grezzi per pagina (mix di tutte le fonti). Dobbiamo scansionare più
  // pagine CATO per accumulare abbastanza item della fonte richiesta.
  //
  // Strategia: lanciamo tutte le pagine CATO in parallelo in un singolo
  // Promise.all (l'API Cato regge bene il carico, verificato via test).
  // Questo riduce la latenza da 3 batch sequenziali a 1 burst parallelo.

  const startCatoPage = page * MAX_CATO_SCAN_PAGES
  const pagesToFetch = Array.from(
    { length: MAX_CATO_SCAN_PAGES },
    (_, i) => startCatoPage + i,
  )

  const allResults = await Promise.all(
    pagesToFetch.map(cp => fetchCatoPage(cp, baseParams, defaultSource)),
  )

  const collected: NormalizedTender[] = []
  let totalRawScanned = 0
  let globalRawTotal = 0

  for (const result of allResults) {
    if (result.items.length === 0) continue // pagina vuota → oltre la fine dei dati CATO
    if (result.rawTotal > globalRawTotal) globalRawTotal = result.rawTotal

    totalRawScanned += result.items.length

    for (const item of result.items) {
      if (item.sources === source) {
        if (!publicationCutoff || isPublishedSince(item.data_pubblicazione, publicationCutoff)) {
          collected.push(item)
        }
      }
    }
  }

  // Stima il totale proporzionalmente: se su N item grezzi ne abbiamo trovati M
  // della fonte richiesta, il totale stimato è (M/N) * totale globale CATO
  const estimatedTotal = totalRawScanned > 0
    ? Math.max(collected.length, Math.round((collected.length / totalRawScanned) * globalRawTotal))
    : collected.length

  return {
    items:  collected.slice(0, TARGET_FILTERED_ITEMS),
    total:  estimatedTotal,
    source: defaultSource,
  }
}

// ── DB-backed fetch (uses Supabase cato_tenders table) ──────────────────────

/**
 * Fetch CATO tenders from the local Supabase `cato_tenders` table.
 * This is used when the DB has been populated via `scripts/sync-cato.mjs`.
 *
 * Benefits over API-based fetch:
 * - Instant filtering by sub-source (SQL WHERE vs client-side scan)
 * - Real pagination with accurate total counts
 * - Full-text search on oggetto/descrizione
 * - All ~67K tenders available, not just the first 300
 *
 * Falls back to `fetchCato()` (API-based) if:
 * - Supabase env vars are not configured
 * - The cato_tenders table is empty or doesn't exist
 */
export async function fetchCatoFromDB(
  params: CatoFetchParams,
  defaultSource: SourceKey = "cato",
): Promise<SourceResult | null> {
  // Lazy import to avoid errors when Supabase is not configured
  let createAdminClient: typeof import("@/lib/supabase/admin").createAdminClient
  try {
    const mod = await import("@/lib/supabase/admin")
    createAdminClient = mod.createAdminClient
  } catch {
    return null // Supabase not available
  }

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch {
    return null // Missing env vars
  }

  const { q, page = 0, importo, scadenza, pubblicazione, source } = params
  const PAGE_SIZE = 10

  // Build query
  let query = supabase
    .from("cato_tenders")
    .select("*", { count: "exact" })

  // Filter by sub-source
  if (source) {
    query = query.eq("sources", source)
  }

  // Full-text search
  if (q?.trim()) {
    query = query.textSearch("fts", q.trim(), { type: "plain", config: "italian" })
  }

  // Importo range
  if (importo) {
    const range = IMPORTO_TO_MINMAX[importo]
    if (range) {
      if (range.min != null) query = query.gte("importo", range.min)
      if (range.max != null) query = query.lte("importo", range.max)
    }
  }

  // Scadenza (days from now)
  if (scadenza) {
    const days = parseInt(scadenza, 10)
    if (!isNaN(days)) {
      const now = new Date()
      const deadline = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
      query = query.gte("data_scadenza", now.toISOString())
      query = query.lte("data_scadenza", deadline.toISOString())
    }
  }

  // Publication date filter
  if (pubblicazione) {
    const cutoff = getPublicationCutoff(pubblicazione)
    if (cutoff) {
      query = query.gte("data_pubblicazione", cutoff.toISOString())
    }
  }

  // Pagination & ordering
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  query = query
    .order("created_at", { ascending: false })
    .range(from, to)

  const { data, count, error } = await query

  if (error) {
    // Table might not exist yet
    console.warn("[fetchCatoFromDB] Query error:", error.message)
    return null
  }

  // If table is empty, fall back to API
  if (!data || (data.length === 0 && page === 0 && !source && !q)) {
    return null
  }

  // Map DB rows to NormalizedTender
  const items: NormalizedTender[] = (data ?? []).map((row) => {
    const src = (row.sources ?? defaultSource) as SourceKey
    return {
      id:                  `${src}:${row.id}`,
      cig:                 row.cig ?? row.numero_gara ?? String(row.id),
      oggetto:             row.oggetto,
      importo:             row.importo ? Number(row.importo) : null,
      stato:               "active",
      provincia:           row.provincia,
      data_pubblicazione:  row.data_pubblicazione,
      data_scadenza:       row.data_scadenza,
      tipo_contratto:      row.tipo_procedura,
      descrizione_cpv:     row.codice_cpv,
      sources:             src,
      link_originale:      row.link_web,
      stazione_appaltante: row.stazione_appaltante,
    }
  })

  return {
    items,
    total:  count ?? items.length,
    source: defaultSource,
  }
}
