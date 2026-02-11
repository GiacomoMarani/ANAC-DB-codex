import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()

  // Use parallel queries for stats - these are simple counts that use indexes
  const [totalResult, activeResult, anniResult] = await Promise.all([
    supabase.from("cig").select("*", { count: "exact", head: true }),
    supabase.from("cig").select("*", { count: "exact", head: true }).eq("stato", "ATTIVO"),
    supabase.from("cig").select("data_pubblicazione").not("data_pubblicazione", "is", null).order("data_pubblicazione", { ascending: false }).limit(500),
  ])

  // Extract years from dates
  const anni = [...new Set(
    anniResult.data
      ?.map((r: any) => {
        if (r.data_pubblicazione) {
          return new Date(r.data_pubblicazione).getFullYear()
        }
        return null
      })
      .filter((year: number | null): year is number => year !== null)
  )].sort((a, b) => b - a)

  return NextResponse.json({
    total: totalResult.count || 0,
    active: activeResult.count || 0,
    anni,
  })
}
