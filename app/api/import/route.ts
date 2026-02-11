import { createAdminClient } from "@/lib/supabase/admin"
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

function normalizeRecord(record: CigRecord) {
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
          const recordAny = r as Record<string, unknown>
          const cigFallback = recordAny.cig ?? recordAny.CIG
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
        
        const { error: insertError } = await supabase
          .from("cig")
          .upsert(record, { 
            onConflict: "cig",
          })

        if (insertError) {
          errors++
          if (errorMessages.length < 10) {
            errorMessages.push(`CIG ${record.cig}: ${insertError.message}`)
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
