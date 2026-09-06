// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
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

function getPublicationCutoffDate(value: string): string | null {
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

  return cutoff.toISOString().slice(0, 10)
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
  const scadenza = searchParams.get("scadenza") || ""
  const pubblicazione = searchParams.get("pubblicazione") || ""
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
      denominazione_amministrazione_appaltante,
      anac_id_avviso,
      esito
    `, { count: "exact" })
    .order("data_pubblicazione", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + pageSize - 1)

  // Apply filters — keyword search
  if (q) {
    const trimmed = q.trim()
    // Detect CIG code (10 alphanumeric characters) → exact match for instant lookup
    if (/^[A-Z0-9]{10}$/i.test(trimmed)) {
      query = query.ilike("cig", `%${trimmed.toUpperCase()}%`)
    } else {
      // AND logic: every word must match at least one field
      // Now also searches denominazione_amministrazione_appaltante (stazione appaltante)
      const words = trimmed.split(/\s+/).filter(Boolean)
      for (const word of words) {
        const cleanWord = word.replace(/[,()"'\\%]/g, "").trim()
        if (!cleanWord) continue
        const term = `%${cleanWord}%`
        query = query.or(
          `cig.ilike.${term},oggetto_gara.ilike.${term},descrizione_cpv.ilike.${term},denominazione_amministrazione_appaltante.ilike.${term}`
        )
      }
    }
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
    const cleanCpv = cpv.trim()
    const digits = cleanCpv.replace(/[^0-9]/g, "")
    if (digits.startsWith("45")) {
      query = query.or("oggetto_principale_contratto.eq.LAVORI,descrizione_cpv.ilike.%costruzion%,descrizione_cpv.ilike.%lavori%")
    } else if (digits.startsWith("72") || digits.startsWith("48")) {
      query = query.or("descrizione_cpv.ilike.%informatic%,descrizione_cpv.ilike.%software%,descrizione_cpv.ilike.%consulenza%")
    } else if (digits.startsWith("90")) {
      query = query.or("descrizione_cpv.ilike.%rifiut%,descrizione_cpv.ilike.%pulizia%,descrizione_cpv.ilike.%fognar%")
    } else if (digits.startsWith("33")) {
      query = query.or("descrizione_cpv.ilike.%medic%,descrizione_cpv.ilike.%farmaceutic%,descrizione_cpv.ilike.%sanitar%")
    } else if (digits.startsWith("60")) {
      query = query.or("descrizione_cpv.ilike.%trasport%")
    } else if (digits.startsWith("15")) {
      query = query.or("descrizione_cpv.ilike.%alimentar%")
    } else if (digits.startsWith("71")) {
      query = query.or("descrizione_cpv.ilike.%architett%,descrizione_cpv.ilike.%ingegner%")
    } else {
      const safeText = cleanCpv.replace(/[,()"'\\%]/g, "")
      if (safeText) {
        query = query.ilike("descrizione_cpv", `%${safeText}%`)
      }
    }
  }

  if (scadenza) {
    const days = Number.parseInt(scadenza, 10)
    if (Number.isFinite(days) && days > 0) {
      const today = getTodayDateString()
      const maxDate = new Date()
      maxDate.setDate(maxDate.getDate() + days)
      const maxDateStr = maxDate.toISOString().slice(0, 10)
      query = query.gte("data_scadenza_offerta", today).lte("data_scadenza_offerta", maxDateStr)
    }
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

  if (pubblicazione) {
    const cutoffDate = getPublicationCutoffDate(pubblicazione)
    if (cutoffDate) {
      query = query.gte("data_pubblicazione", cutoffDate)
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
