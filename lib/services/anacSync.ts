/**
 * anacSync.ts — ANAC "Bandi in Corso" sync service
 *
 * Fetches ONLY active tenders from the ANAC OCDS bulk monthly files.
 *
 * WHY THIS APPROACH:
 * - Superset explore_json → backend Dremio times out (HYT00 OperationalError)
 * - /api/v1/chart/data → NoneType errors on Jinja virtual datasets
 * - Bulk OCDS files → HTTP 200, reliable, no Dremio dependency
 *
 * HOW IT WORKS (streaming, memory-safe):
 * 1. HEAD check: verify the file for [year]/[month] is published (HTTP 200)
 * 2. GET request with browser-like headers to bypass WAF
 * 3. Stream the response body chunk by chunk via ReadableStream
 * 4. Brace-depth parser extracts individual OCDS Release objects
 * 5. Filter: keep only records where tender.status === "active" (bandi in corso)
 * 6. Map OCDS → Supabase `cig` schema and upsert in batches
 *
 * The file is an OCDS Release Package (~748 MB/month), structured as:
 *   { "version":"1.1", ..., "releases": [ {...}, {...}, ... ] }
 *
 * For the current month (bulk not yet published ~5th of following month),
 * we fall back to the previous month's file automatically.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import type { Database } from "@/lib/supabase/database.types"
import { isActiveTender } from "@/lib/utils/tenderLogic"

// ─── Constants ────────────────────────────────────────────────────────────────

const ANAC_BASE = "https://dati.anticorruzione.it"
const BULK_BASE = `${ANAC_BASE}/opendata/download/dataset/ocds/filesystem/bulk`

const MAX_RETRIES = 3
const BATCH_SIZE = 100   // records per Supabase upsert batch
const MAX_BUFFER_BYTES = 8 * 1024 * 1024  // 8 MB rolling buffer window

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  month: string
  source: "bulk_ocds"
  fetched: number
  imported: number
  skipped: number
  errors: number
  errorMessages: string[]
}

type CigInsert = Database["public"]["Tables"]["cig"]["Insert"]

// ─── OCDS Release shape (partial) ────────────────────────────────────────────

interface OcdsItem {
  id?: string
  classification?: { id?: string; description?: string; scheme?: string }
  quantity?: number
  unit?: { name?: string }
}

interface OcdsRelease {
  ocid?: string
  id?: string
  tender?: {
    id?: string
    title?: string
    status?: string            // "active" | "complete" | "cancelled" | "unsuccessful" | "planned"
    value?: { amount?: number; currency?: string }
    procuringEntity?: {
      name?: string
      address?: {
        streetAddress?: string
        locality?: string
        region?: string
        postalCode?: string
        countryName?: string
      }
    }
    tenderPeriod?: { startDate?: string; endDate?: string }
    contractPeriod?: { startDate?: string; endDate?: string }
    mainProcurementCategory?: string   // "goods" | "services" | "works"
    items?: OcdsItem[]
    numberOfTenderers?: number
    procurementMethod?: string
    procurementMethodDetails?: string
  }
  awards?: Array<{
    id?: string
    status?: string              // "active" | "pending" | "unsuccessful" | "cancelled"
    date?: string
    value?: { amount?: number; currency?: string }
    suppliers?: Array<{
      name?: string
      id?: string
      identifier?: {
        id?: string              // Codice fiscale / P.IVA dell'aggiudicatario
        scheme?: string          // "IT-CF" o "IT-PIVA"
        legalName?: string
      }
      address?: {
        region?: string
        locality?: string
      }
      roles?: string[]           // ["mandataria", "mandante", "singola"]
      details?: {
        scale?: string           // "micro", "small", "medium", "large"
      }
    }>
  }>
  contracts?: Array<{ status?: string }>
  [key: string]: unknown
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

function trunc(value: unknown, max: number): string | null {
  if (value == null || value === "") return null
  const s = String(value).trim()
  return s ? s.substring(0, max) : null
}

function parseAmount(value: unknown): number | null {
  if (value == null || value === "") return null
  if (typeof value === "number") return isFinite(value) ? value : null
  const n = Number(String(value).replace(/\s+/g, "").replace(",", "."))
  return isFinite(n) ? n : null
}

// ─── OCDS → CIG mapping ───────────────────────────────────────────────────────

/**
 * Maps one OCDS Release object to the Supabase `cig` table schema.
 * Returns null if the CIG identifier cannot be determined.
 */
function mapOcds(release: OcdsRelease): CigInsert | null {
  const t = release.tender ?? {}

  // CIG is mandatory — it lives in tender.id for ANAC data
  const cig = trunc(t.id ?? release.ocid, 50)
  if (!cig) return null

  // CPV from first item classification
  const cpvId = trunc(t.items?.[0]?.classification?.id, 20)
  const cpvDesc = trunc(t.items?.[0]?.classification?.description, 1000)

  // OCDS status → stato
  const stato = trunc(t.status, 100)

  return {
    cig,
    oggetto_gara:                 trunc(t.title, 4000),
    importo_lotto:                parseAmount(t.value?.amount),
    oggetto_principale_contratto: trunc(t.mainProcurementCategory, 500),
    stato,
    provincia:                    trunc(t.procuringEntity?.address?.region ?? t.procuringEntity?.address?.locality, 100),
    data_pubblicazione:           trunc(t.tenderPeriod?.startDate, 50),
    data_scadenza_offerta:        trunc(t.tenderPeriod?.endDate, 50),
    sezione_regionale:            trunc(t.procuringEntity?.address?.region, 100),
    descrizione_cpv:              cpvDesc ?? cpvId,
    esito:                        trunc(release.awards?.[0]?.status, 100),
  }
}

// ─── OCDS → Aggiudicatari mapping ─────────────────────────────────────────────

type AggiudicatariInsert = Database["public"]["Tables"]["aggiudicatari"]["Insert"]

/**
 * Estrae i record aggiudicatari da un OCDS Release.
 * Un singolo release può avere più awards, ognuno con più suppliers.
 * Restituisce un array (vuoto se non ci sono awards attivi con suppliers).
 *
 * Il codice fiscale dell'aggiudicatario è in: award.suppliers[].identifier.id
 * Lo schema ANAC usa "IT-CF" come identifier.scheme.
 */
function extractAggiudicatari(release: OcdsRelease): AggiudicatariInsert[] {
  const results: AggiudicatariInsert[] = []
  const t = release.tender ?? {}
  const cig = trunc(t.id ?? release.ocid, 50)
  if (!cig) return results

  // Dati denormalizzati dalla gara
  const cpvId = trunc(t.items?.[0]?.classification?.id, 20)
  const cpvDesc = trunc(t.items?.[0]?.classification?.description, 1000)
  const oggetto = trunc(t.title, 4000)
  const provincia = trunc(
    t.procuringEntity?.address?.region ?? t.procuringEntity?.address?.locality,
    100
  )

  for (const award of release.awards ?? []) {
    // Solo awards attivi/completati (non "unsuccessful" o "cancelled")
    const awardStatus = award.status?.toLowerCase()
    if (awardStatus === "unsuccessful" || awardStatus === "cancelled") continue

    const awardDate = trunc(award.date, 50)
    const awardAmount = parseAmount(award.value?.amount)

    for (const supplier of award.suppliers ?? []) {
      // Il codice fiscale è il campo chiave
      const cf = trunc(
        supplier.identifier?.id ?? supplier.id,
        16
      )
      if (!cf) continue

      // Sanitizza: solo alfanumerico, rimuovi spazi
      const cfClean = cf.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
      if (cfClean.length < 11) continue  // P.IVA=11 cifre, CF=16 caratteri

      const denominazione = trunc(
        supplier.identifier?.legalName ?? supplier.name,
        1000
      )

      // Ruolo (se disponibile nei dati ANAC)
      const ruolo = trunc(
        supplier.roles?.[0],
        100
      )

      results.push({
        codice_fiscale: cfClean,
        denominazione,
        tipo_soggetto: null,
        cig,
        importo_aggiudicazione: awardAmount,
        data_aggiudicazione: awardDate,
        ruolo,
        codice_cpv: cpvId,
        descrizione_cpv: cpvDesc,
        oggetto_gara: oggetto,
        provincia,
      })
    }
  }

  return results
}


/**
 * Returns true if the OCDS release represents an active ("bando in corso") tender.
 * Primary check: tender.status === "active"
 * Secondary check: reuses tenderLogic.isActiveTender for expiry date validation.
 */
function isOcdsActive(release: OcdsRelease): boolean {
  const status = release.tender?.status
  // Fast-path: OCDS defines "active" explicitly
  if (status && status !== "active") return false
  // Validate via existing business logic (expiry date, Italian stato strings etc.)
  return isActiveTender({
    stato: status ?? null,
    data_scadenza_offerta: release.tender?.tenderPeriod?.endDate ?? null,
  })
}

// ─── Browser-like fetch (WAF bypass) ─────────────────────────────────────────

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Connection: "keep-alive",
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error = new Error("Unknown fetch error")
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(300_000), // 5 min — file is large
        redirect: "follow",
      })
      if (res.ok) return res
      if (res.status === 404) throw new Error(`HTTP 404: ${url}`)
      if (res.status === 403) throw new Error(`HTTP 403: ${url}`)
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (lastError.message.includes("404") || lastError.message.includes("403")) throw lastError
    }
    if (attempt < MAX_RETRIES - 1) await delay(1000 * Math.pow(2, attempt))
  }
  throw lastError
}

// ─── Streaming OCDS Release Package parser ────────────────────────────────────

/**
 * Streams the ANAC OCDS Release Package and yields individual Release objects.
 *
 * The file format is a single JSON object:
 *   { "releases": [ {...}, {...}, ... ], ... }
 *
 * We scan the byte stream for `"releases":[` then use brace-depth tracking
 * to extract each `{...}` object without loading the full file into RAM.
 */
async function* streamReleases(res: Response): AsyncGenerator<OcdsRelease> {
  if (!res.body) throw new Error("Response body è null — streaming non supportato")

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")

  let buffer = ""
  let foundReleases = false
  let depth = 0
  let inObj = false
  let objStart = 0
  let inString = false
  let escaped = false
  // ANAC uses indented JSON: "releases": [  (space before bracket)
  // Try both formats for robustness
  const SEARCH_TOKENS = ['"releases": [', '"releases":[', '"releases" : [']
  let SEARCH_TOKEN = '"releases": ['

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: !done })

      // ── Phase 1: scan for the "releases": [ token ─────────────────────────
      if (!foundReleases) {
        // Try all known token formats (ANAC uses indented JSON with spaces)
        let bestIdx = -1
        for (const tok of SEARCH_TOKENS) {
          const idx = buffer.indexOf(tok)
          if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) {
            bestIdx = idx
            SEARCH_TOKEN = tok
          }
        }
        if (bestIdx === -1) {
          // Keep last N chars to avoid missing a token split across chunks
          const keep = Math.max(0, buffer.length - 30)
          buffer = buffer.slice(keep)
          continue
        }
        buffer = buffer.slice(bestIdx + SEARCH_TOKEN.length)
        foundReleases = true
        inObj = false
        depth = 0
        inString = false
        escaped = false
      }

      // ── Phase 2: brace-depth extraction of individual releases ────────────
      let i = 0
      while (i < buffer.length) {
        const ch = buffer[i]

        if (escaped) { escaped = false; i++; continue }
        if (inString) {
          if (ch === "\\") { escaped = true; i++; continue }
          if (ch === '"') inString = false
          i++; continue
        }
        if (ch === '"') { inString = true; i++; continue }

        if (!inObj) {
          if (ch === "{") { inObj = true; depth = 1; objStart = i }
          else if (ch === "]") break  // end of releases array
          i++; continue
        }

        // Inside an object
        if (ch === "{") depth++
        else if (ch === "}") {
          depth--
          if (depth === 0) {
            const jsonStr = buffer.slice(objStart, i + 1)
            try {
              yield JSON.parse(jsonStr) as OcdsRelease
            } catch { /* skip malformed object */ }
            // Trim the processed prefix to control buffer size
            buffer = buffer.slice(i + 1)
            i = 0
            inObj = false
            depth = 0
            continue
          }
        }
        i++
      }

      // If mid-object and buffer is growing too large, something is wrong
      if (!inObj) {
        buffer = ""  // fully consumed
      } else if (buffer.length > MAX_BUFFER_BYTES && objStart > 0) {
        // Shift buffer: drop everything before current object start
        buffer = buffer.slice(objStart)
        objStart = 0
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────

async function upsertBatch(
  supabase: ReturnType<typeof createAdminClient>,
  records: CigInsert[],
  result: SyncResult
) {
  if (!records.length) return
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from("cig").upsert(chunk, { onConflict: "cig" })
    if (error) {
      result.errors += chunk.length
      if (result.errorMessages.length < 10) {
        result.errorMessages.push(`Supabase upsert: ${error.message}`)
      }
    } else {
      result.imported += chunk.length
    }
    if (i + BATCH_SIZE < records.length) await delay(120)
  }
}

async function upsertAggiudicatariBatch(
  supabase: ReturnType<typeof createAdminClient>,
  records: AggiudicatariInsert[],
  result: SyncResult
) {
  if (!records.length) return
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from("aggiudicatari")
      .upsert(chunk, { onConflict: "codice_fiscale,cig" })
    if (error) {
      // Non-fatal: log but don't count as main sync errors
      if (result.errorMessages.length < 10) {
        result.errorMessages.push(`Aggiudicatari upsert: ${error.message}`)
      }
    }
    if (i + BATCH_SIZE < records.length) await delay(120)
  }
}

// ─── Core sync function ───────────────────────────────────────────────────────

/**
 * Syncs active tenders for a given month from the ANAC bulk OCDS file.
 * Only records with `tender.status === "active"` are upserted.
 */
/**
 * DEADLINE_MS: stop streaming this many ms before Vercel kills the function.
 * • Vercel Hobby  = 60s  → stop at 50s (10s buffer for final upsert)
 * • Vercel Pro    = 300s → set SYNC_DEADLINE_MS=280000 in env
 */
const DEADLINE_MS = parseInt(process.env.SYNC_DEADLINE_MS ?? "50000")

async function syncMonthBulk(yearMonth: string): Promise<SyncResult> {
  const [year, month] = yearMonth.split("-")
  const url = `${BULK_BASE}/${year}/${month.padStart(2, "0")}.json`
  const startedAt = Date.now()

  const result: SyncResult = {
    month: yearMonth,
    source: "bulk_ocds",
    fetched: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  }

  // HEAD check — fail fast if file not yet published
  const head = await fetch(url, {
    method: "HEAD",
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  })
  if (!head.ok) throw new Error(`HTTP ${head.status}: bulk file non disponibile — ${url}`)

  const res = await fetchWithRetry(url)
  const supabase = createAdminClient()
  const batch: CigInsert[] = []
  const awardBatch: AggiudicatariInsert[] = []
  let timedOut = false

  const flush = async () => {
    if (batch.length) {
      await upsertBatch(supabase, batch, result)
      batch.length = 0
    }
    if (awardBatch.length) {
      await upsertAggiudicatariBatch(supabase, awardBatch, result)
      awardBatch.length = 0
    }
  }

  try {
    for await (const release of streamReleases(res)) {
      // ── Time guard: stop before Vercel kills the function ────────────────
      if (Date.now() - startedAt > DEADLINE_MS) {
        timedOut = true
        break
      }

      result.fetched++

      // ── Estrai aggiudicatari da TUTTE le release (anche non-active) ─────
      // Gli awards hanno il CF dell'aggiudicatario, indipendentemente
      // dallo stato corrente della gara.
      const awards = extractAggiudicatari(release)
      if (awards.length > 0) {
        awardBatch.push(...awards)
        if (awardBatch.length >= BATCH_SIZE) {
          await upsertAggiudicatariBatch(supabase, awardBatch, result)
          awardBatch.length = 0
        }
      }

      // ── Filter: only "bandi in corso" (active tenders) for CIG upsert ───
      if (!isOcdsActive(release)) {
        result.skipped++
        continue
      }

      const record = mapOcds(release)
      if (!record) { result.skipped++; continue }

      batch.push(record)
      if (batch.length >= BATCH_SIZE) await flush()
    }
    await flush()

    if (timedOut && result.errorMessages.length < 10) {
      result.errorMessages.push(
        `Sync parziale: limite ${DEADLINE_MS / 1000}s raggiunto dopo ${result.fetched} record ` +
        `(${result.imported} importati, ${result.skipped} scartati). ` +
        `Rilanciare il sync per continuare dall'inizio del file.`
      )
    }
  } catch (err) {
    result.errors++
    result.errorMessages.push(
      `Stream error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return result
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Syncs active tenders for a given month ("YYYY-MM").
 * If the current month's file is not yet published, falls back to last month.
 */
export async function syncMonth(yearMonth: string): Promise<SyncResult> {
  try {
    return await syncMonthBulk(yearMonth)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // If HTTP 404, try falling back to the previous month
    if (msg.includes("404")) {
      const [y, m] = yearMonth.split("-").map(Number)
      const prev = new Date(y, m - 2, 1)
      const fallback = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`
      try {
        const result = await syncMonthBulk(fallback)
        result.errorMessages.unshift(`Mese ${yearMonth} non disponibile — usato fallback: ${fallback}`)
        return result
      } catch (fallbackErr) {
        throw new Error(
          `Sync fallita per ${yearMonth} e ${fallback}: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
        )
      }
    }
    throw err
  }
}

/**
 * Returns "YYYY-MM" for the most recent N months (most recent first).
 * Starts from last month since the current month's bulk is published ~5th of next month.
 */
export function getRecentMonths(count = 2): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  return months
}
