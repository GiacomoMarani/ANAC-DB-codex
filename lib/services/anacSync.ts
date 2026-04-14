import { createAdminClient } from "@/lib/supabase/admin"
import { isActiveTender } from "@/lib/utils/tenderLogic"

const ANAC_BULK_BASE =
  "https://dati.anticorruzione.it/opendata/download/dataset/ocds/filesystem/bulk"

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500

export interface SyncResult {
  month: string
  fetched: number
  imported: number
  skipped: number
  errors: number
  errorMessages: string[]
}

interface OcdsRelease {
  ocid?: string
  tender?: {
    id?: string
    title?: string
    status?: string
    value?: { amount?: number; currency?: string }
    procuringEntity?: {
      address?: { region?: string; locality?: string }
    }
    tenderPeriod?: { startDate?: string; endDate?: string }
    mainProcurementCategory?: string
    items?: Array<{ classification?: { description?: string } }>
  }
  awards?: Array<{ status?: string }>
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function mapOcdsToRecord(release: OcdsRelease) {
  const tender = release.tender ?? {}
  const cig = (tender.id ?? release.ocid ?? "").trim().substring(0, 50)
  if (!cig) return null

  const stato = tender.status ?? null
  const data_scadenza_offerta = tender.tenderPeriod?.endDate?.substring(0, 50) ?? null
  const data_pubblicazione = tender.tenderPeriod?.startDate?.substring(0, 50) ?? null
  const importo_lotto = tender.value?.amount ?? null
  const oggetto_gara = (tender.title ?? "").substring(0, 4000) || null
  const provincia =
    (
      tender.procuringEntity?.address?.region ??
      tender.procuringEntity?.address?.locality ??
      ""
    )
      .substring(0, 100) || null
  const oggetto_principale_contratto =
    (tender.mainProcurementCategory ?? "").substring(0, 500) || null
  const descrizione_cpv =
    (tender.items?.[0]?.classification?.description ?? "").substring(0, 1000) || null
  const esito =
    (release.awards?.[0]?.status ?? "").substring(0, 100) || null

  return {
    cig,
    oggetto_gara,
    importo_lotto,
    oggetto_principale_contratto,
    stato,
    provincia,
    data_pubblicazione,
    data_scadenza_offerta,
    sezione_regionale: null as string | null,
    descrizione_cpv,
    esito,
  }
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error = new Error("Unknown error")
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Encoding": "gzip, deflate, br",
          "User-Agent": "Mozilla/5.0 (compatible; ANACDataExplorer/1.0; +https://anac-db-codex.vercel.app)",
        },
      })
      if (res.ok) return res
      if (res.status === 404) throw new Error(`File non ancora disponibile (HTTP 404): ${url}`)
      if (res.status < 500) throw new Error(`HTTP ${res.status}`) // non-retryable
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Don't retry 404s
      if (lastError.message.includes("404")) throw lastError
    }
    await delay(BASE_DELAY_MS * Math.pow(2, attempt))
  }
  throw lastError
}

/** Sync a single month (format: "YYYY-MM") */
export async function syncMonth(yearMonth: string): Promise<SyncResult> {
  const [year, month] = yearMonth.split("-")
  const url = `${ANAC_BULK_BASE}/${year}/${month}.json`

  const result: SyncResult = {
    month: yearMonth,
    fetched: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  }

  const res = await fetchWithRetry(url)
  const text = await res.text()
  const lines = text.split("\n").filter((l) => l.trim())

  const supabase = createAdminClient()

  const BATCH_SIZE = 50
  const batch: ReturnType<typeof mapOcdsToRecord>[] = []

  const flush = async () => {
    const valid = batch.filter(Boolean) as NonNullable<ReturnType<typeof mapOcdsToRecord>>[]
    batch.length = 0
    if (!valid.length) return

    const { error } = await supabase.from("cig").upsert(valid, { onConflict: "cig" })
    if (error) {
      result.errors += valid.length
      if (result.errorMessages.length < 10) result.errorMessages.push(error.message)
    } else {
      result.imported += valid.length
    }
  }

  for (const line of lines) {
    result.fetched++
    try {
      const release: OcdsRelease = JSON.parse(line)
      const record = mapOcdsToRecord(release)
      if (!record || !isActiveTender(record)) {
        result.skipped++
        continue
      }
      batch.push(record)
      if (batch.length >= BATCH_SIZE) await flush()
    } catch {
      result.errors++
    }
  }

  await flush()
  return result
}

/** Returns array of "YYYY-MM" strings for the last N months, excluding the current month */
export function getRecentMonths(count = 3): string[] {
  const months: string[] = []
  const now = new Date()
  // Start from last month (current month's file is not yet published by ANAC)
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    months.push(`${y}-${m}`)
  }
  return months
}
