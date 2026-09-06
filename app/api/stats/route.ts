// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()

  // Use parallel queries for stats - these are simple counts that use indexes
  const [totalResult, activeResult, anniResult, cpvResult] = await Promise.all([
    supabase.from("cig").select("*", { count: "exact", head: true }),
    supabase.from("cig").select("*", { count: "exact", head: true }).in("stato", ["active", "ATTIVO"]),
    supabase.from("cig").select("data_pubblicazione").not("data_pubblicazione", "is", null).order("data_pubblicazione", { ascending: false }).limit(500),
    supabase.from("cig").select("descrizione_cpv").not("descrizione_cpv", "is", null).order("descrizione_cpv", { ascending: true }).limit(1000),
  ])

  // Extract years from dates
  const getYear = (value: string) => {
    const parts = value.split("-")
    if (parts.length === 3) {
      const year = Number.parseInt(parts[0], 10)
      return Number.isFinite(year) ? year : null
    }
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : null
  }

  const anni = [...new Set(
    anniResult.data
      ?.map((r: { data_pubblicazione?: string | null }) => {
        if (r.data_pubblicazione) {
          return getYear(r.data_pubblicazione)
        }
        return null
      })
      .filter((year: number | null): year is number => year !== null)
  )].sort((a, b) => b - a)

  const cpv = [
    ...new Set(
      cpvResult.data
        ?.map((r: { descrizione_cpv?: string | null }) => r.descrizione_cpv?.trim() || null)
        .filter((value: string | null): value is string => Boolean(value))
    ),
  ]

  return NextResponse.json({
    total: totalResult.count || 0,
    active: activeResult.count || 0,
    anni,
    cpv,
  })
}
