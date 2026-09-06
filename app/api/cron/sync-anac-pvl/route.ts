// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Allow up to 5 minutes for full sync on Vercel Pro
export const maxDuration = 300

const PVL_API = "https://pubblicitalegale.anticorruzione.it/api/v0/avvisi"
const PAGE_SIZE = 100

// ── Auth check ──────────────────────────────────────────────────────────────

function checkAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return null
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

// ── PVL Template Parser ─────────────────────────────────────────────────────

interface PVLRecord {
  cig: string
  uuid: string
  dataPubblicazione: string | null
  dataScadenza: string | null
  oggetto: string | null
  importo: number | null
  cpv: string | null
  natura: string | null
  luogo: string | null
  stazione: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromPVL(avviso: any): PVLRecord[] {
  const records: PVLRecord[] = []
  const uuid = avviso.idAvviso
  const dataPub = avviso.dataPubblicazione
  const dataScad = avviso.dataScadenza

  const tpls = avviso.templates || avviso.template || []
  for (const tpl of tpls) {
    const t = tpl.template || tpl
    const metadata = t.metadata || {}
    const sections = t.sections || []

    let stazione: string | null = null

    for (const sec of sections) {
      if (sec.fields?.soggetti_sa) {
        const sa = sec.fields.soggetti_sa[0]
        if (sa?.denominazione_amministrazione) {
          stazione = sa.denominazione_amministrazione
        }
      }

      if (sec.items) {
        for (const item of sec.items) {
          if (!item.cig) continue
          records.push({
            cig: item.cig,
            uuid,
            dataPubblicazione: dataPub,
            dataScadenza: item.termine_ricezione || dataScad,
            oggetto: item.descrizione || metadata.descrizione || null,
            importo: item.valore_complessivo_stimato ?? null,
            cpv: item.cpv || null,
            natura: item.natura_principale || null,
            luogo: item.luogo_nuts || item.luogo_istat || null,
            stazione,
          })
        }
      }
    }
  }
  return records
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function trunc(val: string | null | undefined, max = 3990): string | null {
  if (!val) return null
  return val.length > max ? val.slice(0, max) + "…" : val
}

const NATURA_MAP: Record<string, string> = {
  Servizi: "SERVIZI",
  Lavori: "LAVORI",
  Forniture: "FORNITURE",
}

function mapToSupabase(rec: PVLRecord) {
  return {
    cig: rec.cig,
    oggetto_gara: trunc(rec.oggetto),
    importo_lotto: rec.importo,
    oggetto_principale_contratto: NATURA_MAP[rec.natura || ""] || trunc(rec.natura, 490),
    stato: "active",
    provincia: trunc(rec.luogo, 95),
    data_pubblicazione: rec.dataPubblicazione?.split("T")[0] || null,
    data_scadenza_offerta: rec.dataScadenza?.split("T")[0] || null,
    sezione_regionale: trunc(rec.luogo, 95),
    descrizione_cpv: trunc(rec.cpv, 990),
    denominazione_amministrazione_appaltante: trunc(rec.stazione),
    anac_id_avviso: rec.uuid,
    esito: null,
  }
}

// ── Fetch with retry ────────────────────────────────────────────────────────

async function fetchPVLPage(page: number): Promise<{ content: unknown[]; totalElements: number; totalPages: number }> {
  const url = `${PVL_API}?page=${page}&size=${PAGE_SIZE}&codiceScheda=4&sortField=dataPubblicazione&sortDirection=desc`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise(r => setTimeout(r, attempt * 2000))
    }
  }
  throw new Error("Unreachable")
}

function isStillBiddable(rec: PVLRecord, today: string): boolean {
  if (!rec.dataScadenza) return true
  const deadline = rec.dataScadenza.split("T")[0]
  return deadline >= today
}

// ── Main sync logic ─────────────────────────────────────────────────────────

async function syncAnacPVL(maxPages = Infinity) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = new Date().toISOString().split("T")[0]
  const firstPage = await fetchPVLPage(0)
  const totalPages = Math.min(firstPage.totalPages || 0, maxPages)
  const totalAvvisi = firstPage.totalElements || 0

  const allCigs = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRecords: any[] = []

  // Process first page
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const avviso of (firstPage.content || []) as any[]) {
    for (const rec of extractFromPVL(avviso)) {
      if (!allCigs.has(rec.cig) && isStillBiddable(rec, today)) {
        allCigs.add(rec.cig)
        allRecords.push(mapToSupabase(rec))
      }
    }
  }

  // Paginate
  for (let p = 1; p < totalPages; p++) {
    try {
      const data = await fetchPVLPage(p)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const avviso of (data.content || []) as any[]) {
        for (const rec of extractFromPVL(avviso)) {
          if (!allCigs.has(rec.cig) && isStillBiddable(rec, today)) {
            allCigs.add(rec.cig)
            allRecords.push(mapToSupabase(rec))
          }
        }
      }
      if ((data.content || []).length < PAGE_SIZE) break
      await new Promise(r => setTimeout(r, 200))
    } catch {
      // Continue on error
    }
  }

  // Upsert
  let totalUpserted = 0
  let errors = 0
  for (let i = 0; i < allRecords.length; i += 100) {
    const batch = allRecords.slice(i, i + 100)
    const { error } = await supabase
      .from("cig")
      .upsert(batch, { onConflict: "cig", ignoreDuplicates: false })
    if (error) errors++
    else totalUpserted += batch.length
  }

  // Mark stale as closed (safety: only full scan when all pages were fetched can mark missing CIGs as closed)
  let staleClosed = 0
  const isFullScan = totalPages >= (firstPage.totalPages || 0)
  if (isFullScan && allCigs.size > 0) {
    let allActive: { cig: string }[] = []
    let from = 0
    while (true) {
      const { data } = await supabase
        .from("cig")
        .select("cig")
        .eq("stato", "active")
        .range(from, from + 999)
      if (!data || data.length === 0) break
      allActive.push(...data)
      if (data.length < 1000) break
      from += data.length
    }
    const stale = allActive.filter(r => !allCigs.has(r.cig)).map(r => r.cig)
    for (let i = 0; i < stale.length; i += 100) {
      await supabase.from("cig").update({ stato: "closed" }).in("cig", stale.slice(i, i + 100))
    }
    staleClosed = stale.length
  } else {
    // In partial/incremental scan: close only tenders whose deadline has already passed
    const { count } = await supabase
      .from("cig")
      .update({ stato: "closed" }, { count: "exact" })
      .eq("stato", "active")
      .lt("data_scadenza_offerta", today)
    staleClosed = count ?? 0
  }

  return {
    totalAvvisi,
    cigsFound: allCigs.size,
    upserted: totalUpserted,
    staleClosed,
    errors,
  }
}

// ── GET handler (Vercel Cron) ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkAuth(request)
  if (authError) return authError

  try {
    const result = await syncAnacPVL()
    return NextResponse.json({ ok: true, source: "PVL API", ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    )
  }
}

// ── POST handler (manual trigger with optional maxPages) ────────────────────

export async function POST(request: NextRequest) {
  const authError = checkAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const maxPages = typeof body.maxPages === "number" ? body.maxPages : Infinity
    const result = await syncAnacPVL(maxPages)
    return NextResponse.json({ ok: true, source: "PVL API", ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    )
  }
}
