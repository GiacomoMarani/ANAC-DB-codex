import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  
  const q = searchParams.get("q") || ""
  const provincia = searchParams.get("provincia") || ""
  const stato = searchParams.get("stato") || ""
  const tipo_contratto = searchParams.get("tipo_contratto") || ""
  const anno = searchParams.get("anno") || ""
  const importo_min = searchParams.get("importo_min") || ""
  const importo_max = searchParams.get("importo_max") || ""
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
      oggetto_principale_contratto,
      descrizione_cpv,
      esito
    `, { count: "exact" })
    .order("id", { ascending: false })
    .range(offset, offset + pageSize - 1)

  // Apply filters
  if (q) {
    const searchTerm = `%${q}%`
    query = query.or(`cig.ilike.${searchTerm},oggetto_gara.ilike.${searchTerm}`)
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

  if (importo_min) {
    query = query.gte("importo_lotto", Number(importo_min))
  }

  if (importo_max) {
    query = query.lte("importo_lotto", Number(importo_max))
  }

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Calculate page totals from current data
  const pageImporto = (data || []).reduce((sum, item) => sum + (item.importo_lotto || 0), 0)

  return NextResponse.json({
    data: data || [],
    count: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
    pageImporto,
  })
}
