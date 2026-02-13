import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

function parseAmount(value: string): number | null {
  if (!value) return null
  const cleaned = value.replace(/\s+/g, "").replace(",", ".")
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseImporto(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const cleaned = value.replace(/\s+/g, "").replace(",", ".")
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function getTodayDateString(timeZone = "Europe/Rome"): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = formatter.formatToParts(new Date())
  const year = parts.find((p) => p.type === "year")?.value
  const month = parts.find((p) => p.type === "month")?.value
  const day = parts.find((p) => p.type === "day")?.value
  if (year && month && day) {
    return `${year}-${month}-${day}`
  }
  return new Date().toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  
  const q = searchParams.get("q") || ""
  const provincia = searchParams.get("provincia") || ""
  const stato = searchParams.get("stato") || ""
  const tipo_contratto = searchParams.get("tipo_contratto") || ""
  const anno = searchParams.get("anno") || ""
  const cpv = searchParams.get("cpv") || ""
  const importo_min = searchParams.get("importo_min") || ""
  const importo_max = searchParams.get("importo_max") || ""
  const non_scadute = searchParams.get("non_scadute") || ""
  const page = Number(searchParams.get("page")) || 1
  const pageSize = 20
  const offset = (page - 1) * pageSize

  const supabase = await createClient()

  // Build the main data query
  let query = supabase
    .from("cig")
    .select(`
      id,
      cig,
      oggetto_gara,
      importo_lotto,
      stato,
      provincia,
      data_pubblicazione,
      data_scadenza_offerta,
      sezione_regionale,
      oggetto_principale_contratto,
      descrizione_cpv,
      esito
    `, { count: "exact" })
    .order("id", { ascending: false })
    .range(offset, offset + pageSize - 1)

  // Apply filters
  if (q) {
    const searchTerm = `%${q}%`
    query = query.or(
      `cig.ilike.${searchTerm},oggetto_gara.ilike.${searchTerm},descrizione_cpv.ilike.${searchTerm}`
    )
  }

  if (provincia) {
    query = query.eq("provincia", provincia)
  }

  if (stato) {
    query = query.eq("stato", stato)
  }

  if (tipo_contratto) {
    query = query.eq("oggetto_principale_contratto", tipo_contratto)
  }

  if (cpv) {
    query = query.ilike("descrizione_cpv", `%${cpv}%`)
  }

  if (non_scadute === "true") {
    const today = getTodayDateString()
    query = query.gte("data_scadenza_offerta", today)
  }

  if (anno) {
    const year = Number.parseInt(anno, 10)
    if (Number.isFinite(year)) {
      query = query
        .gte("data_pubblicazione", `${year}-01-01`)
        .lte("data_pubblicazione", `${year}-12-31`)
    }
  }

  if (importo_min) {
    const minValue = parseAmount(importo_min)
    if (minValue !== null) {
      query = query.gte("importo_lotto", minValue)
    }
  }

  if (importo_max) {
    const maxValue = parseAmount(importo_max)
    if (maxValue !== null) {
      query = query.lte("importo_lotto", maxValue)
    }
  }

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Calculate page totals from current data
  const pageImporto = (data || []).reduce((sum, item) => sum + parseImporto(item.importo_lotto), 0)

  return NextResponse.json({
    data: data || [],
    count: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
    pageImporto,
  })
}
