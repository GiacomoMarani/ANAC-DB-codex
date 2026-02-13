import { createAdminClient } from "@/lib/supabase/admin"
import type { Database } from "@/lib/supabase/database.types"
import { NextResponse } from "next/server"

interface CigRecord {
  cig: string
  oggetto_gara?: string | null
  importo_lotto?: number | null
  oggetto_principale_contratto?: string | null
  stato?: string | null
  provincia?: string | null
  data_pubblicazione?: string | null
  data_scadenza_offerta?: string | null
  sezione_regionale?: string | null
  descrizione_cpv?: string | null
  esito?: string | null
}

type CigInsert = Database["public"]["Tables"]["cig"]["Insert"]
type SupabaseAdminClient = ReturnType<typeof createAdminClient>

const MAX_RETRIES = 3
const BASE_DELAY_MS = 250

// Define max lengths for each field to prevent truncation errors
const FIELD_LIMITS: Record<string, number> = {
  cig: 50,
  oggetto_gara: 4000,
  importo_lotto: 9999999999,
  oggetto_principale_contratto: 500,
  stato: 100,
  provincia: 100,
  data_pubblicazione: 50,
  data_scadenza_offerta: 50,
  sezione_regionale: 100,
  descrizione_cpv: 1000,
  esito: 100,
}

function truncateString(value: string | null | undefined, fieldName: string): string | null {
  if (!value) return null
  const limit = FIELD_LIMITS[fieldName] || 500
  if (typeof value === "string" && value.length > limit) {
    return value.substring(0, limit)
  }
  return value
}

function parseImporto(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const cleaned = value.replace(/\s+/g, "").replace(",", ".")
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isTransientError(message?: string, status?: number): boolean {
  if (status === 429) return true
  if (status && status >= 500) return true
  const lower = (message || "").toLowerCase()
  const tokens = [
    "timeout",
    "timed out",
    "cloudflare",
    "internal server error",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "fetch failed",
    "econnreset",
    "socket",
    "connection",
    "network",
    "temporarily unavailable",
    "rate limit",
    "too many requests",
  ]
  return tokens.some((token) => lower.includes(token))
}

function sanitizeErrorMessage(message: string, status?: number): string {
  const cleaned = message.replace(/\s+/g, " ").trim()
  const isHtml = cleaned.includes("<!DOCTYPE") || cleaned.includes("<html")
  if (isHtml) {
    return `Errore temporaneo dal server Supabase${status ? ` (HTTP ${status})` : ""}. Riprova.`
  }
  if (status === 429) {
    return "Troppe richieste (HTTP 429). Riprova tra qualche secondo."
  }
  if (status && status >= 500) {
    return `Errore temporaneo dal server Supabase (HTTP ${status}). Riprova.`
  }
  if (cleaned.length > 200) {
    return `${cleaned.slice(0, 200)}…`
  }
  return cleaned
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function upsertWithRetry(client: SupabaseAdminClient, record: CigInsert) {
  let lastMessage = "Errore sconosciuto"
  let lastStatus: number | undefined

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { error, status } = await client
        .from("cig")
        .upsert(record, { onConflict: "cig" })

      if (!error) {
        return { ok: true as const }
      }

      lastMessage = error.message
      lastStatus = status

      if (!isTransientError(error.message, status) || attempt === MAX_RETRIES - 1) {
        break
      }
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : "Errore sconosciuto"
      lastStatus = undefined

      if (!isTransientError(lastMessage) || attempt === MAX_RETRIES - 1) {
        break
      }
    }

    const backoff = BASE_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 150)
    await delay(backoff)
  }

  return { ok: false as const, message: lastMessage, status: lastStatus }
}

function normalizeRecord(record: CigRecord): CigInsert {
  // Normalize field names (handle both lowercase and uppercase)
  const normalized: Record<string, unknown> = {}
  
  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase()
    normalized[lowerKey] = value
  }

  const rawCig = normalized.cig
  const cigValue =
    typeof rawCig === "string"
      ? rawCig.trim()
      : rawCig !== null && rawCig !== undefined
        ? String(rawCig).trim()
        : ""

  if (!cigValue) {
    throw new Error("CIG mancante")
  }

  return {
    cig: cigValue.substring(0, 50),
    oggetto_gara: truncateString(normalized.oggetto_gara as string, "oggetto_gara"),
    importo_lotto: parseImporto(normalized.importo_lotto),
    oggetto_principale_contratto: truncateString(normalized.oggetto_principale_contratto as string, "oggetto_principale_contratto"),
    stato: truncateString(normalized.stato as string, "stato"),
    provincia: truncateString(normalized.provincia as string, "provincia"),
    data_pubblicazione: truncateString(normalized.data_pubblicazione as string, "data_pubblicazione"),
    data_scadenza_offerta: truncateString(normalized.data_scadenza_offerta as string, "data_scadenza_offerta"),
    sezione_regionale: truncateString(normalized.sezione_regionale as string, "sezione_regionale"),
    descrizione_cpv: truncateString(normalized.descrizione_cpv as string, "descrizione_cpv"),
    esito: truncateString(normalized.esito as string, "esito"),
  }
}

export async function POST(request: Request) {
  try {
    const { records } = await request.json()

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: "Nessun record da importare" }, { status: 400 })
    }

    let supabase
    try {
      supabase = createAdminClient()
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Supabase admin client non configurato" },
        { status: 500 }
      )
    }
    
    let imported = 0
    let errors = 0
    const errorMessages: string[] = []

    // Normalize and prepare records for upsert
    const normalizedRecords = records
      .map((r: CigRecord) => {
        try {
          return normalizeRecord(r)
        } catch (err) {
          errors++
          const upperCig = (r as unknown as { CIG?: unknown }).CIG
          const cigFallback = (r as { cig?: unknown }).cig ?? upperCig
          errorMessages.push(
            `Errore nel record ${cigFallback ? String(cigFallback) : "sconosciuto"}: ${
              err instanceof Error ? err.message : "errore sconosciuto"
            }`
          )
          return null
        }
      })
      .filter((record): record is ReturnType<typeof normalizeRecord> => Boolean(record))

    // Deduplicate records by CIG (keep the last occurrence)
    const deduplicatedRecords = Array.from(
      new Map(normalizedRecords.map((r) => [r.cig, r])).values()
    )

    if (deduplicatedRecords.length > 0) {
      // Insert one record at a time to avoid timeout on large upserts
      for (let i = 0; i < deduplicatedRecords.length; i++) {
        const record = deduplicatedRecords[i]
        
        const result = await upsertWithRetry(supabase, record)
        if (!result.ok) {
          errors++
          if (errorMessages.length < 10) {
            errorMessages.push(
              `CIG ${record.cig}: ${sanitizeErrorMessage(result.message, result.status)}`
            )
          }
        } else {
          imported++
        }
        
        // Small delay every 5 records to avoid rate limiting
        if (i > 0 && i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
    }

    return NextResponse.json({
      imported,
      errors,
      errorMessages: errorMessages.slice(0, 10),
    })
  } catch (error) {
    console.error("Import error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore durante l'importazione" },
      { status: 500 }
    )
  }
}
