// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

import { NextResponse } from "next/server"
import { getTursoClient, getAggiudicatariCount } from "@/lib/turso"

const INGEST_API_KEY = process.env.INGEST_API_KEY || ""

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

/**
 * OPTIONS /api/ingest — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

interface AnacRecord {
  cig?: string
  cod_fisc_partecipante?: string
  denominazione_partecipante?: string
  cod_cpv?: string
  oggetto_bando?: string
  importo_aggiudicazione?: number
  data_aggiudicazione_definitiva?: number | string
  provincia?: string
  denominazione_amministrazione_appaltante?: string
  oggetto_principale_contratto?: string
  sezione_regionale?: string
  settore?: string
  importo_lotto?: number
  partecipante_ruolo?: string
  flag_pnrr_pnc?: string
}

/**
 * Helper: NextResponse.json with CORS headers
 */
function corsJson(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { ...init, headers: CORS_HEADERS })
}

/**
 * POST /api/ingest — Batch insert aggiudicatari records into Turso.
 * Protected by INGEST_API_KEY.
 * Accepts JSON body: { records: AnacRecord[], apiKey: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { records, apiKey } = body as {
      records: AnacRecord[]
      apiKey: string
    }

    // Auth check
    if (!INGEST_API_KEY || apiKey !== INGEST_API_KEY) {
      return corsJson({ error: "Unauthorized" }, { status: 401 })
    }

    if (!Array.isArray(records) || records.length === 0) {
      return corsJson({ error: "No records provided" }, { status: 400 })
    }

    const client = getTursoClient()
    if (!client) {
      return corsJson({ error: "Turso not configured" }, { status: 503 })
    }

    // Batch insert using transaction
    const statements = records
      .filter((r) => r.cig && r.cod_fisc_partecipante)
      .map((r) => {
        // Convert timestamp to ISO date if numeric
        let dataAgg: string | null = null
        if (r.data_aggiudicazione_definitiva) {
          if (typeof r.data_aggiudicazione_definitiva === "number") {
            dataAgg = new Date(r.data_aggiudicazione_definitiva)
              .toISOString()
              .split("T")[0]
          } else {
            dataAgg = String(r.data_aggiudicazione_definitiva)
          }
        }

        return {
          sql: `INSERT OR REPLACE INTO aggiudicatari_storico
                (cig, cod_fisc, denominazione, cod_cpv, oggetto_bando,
                 importo_aggiudicazione, data_aggiudicazione, provincia,
                 stazione_appaltante, tipo_contratto, sezione_regionale,
                 settore, importo_lotto, ruolo, flag_pnrr)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            r.cig!,
            r.cod_fisc_partecipante!,
            r.denominazione_partecipante || null,
            r.cod_cpv || null,
            r.oggetto_bando || null,
            r.importo_aggiudicazione ?? null,
            dataAgg,
            r.provincia || null,
            r.denominazione_amministrazione_appaltante || null,
            r.oggetto_principale_contratto || null,
            r.sezione_regionale || null,
            r.settore || null,
            r.importo_lotto ?? null,
            r.partecipante_ruolo || null,
            r.flag_pnrr_pnc || null,
          ],
        }
      })

    if (statements.length === 0) {
      return corsJson(
        { error: "No valid records (missing cig or cod_fisc)" },
        { status: 400 }
      )
    }

    // Execute in batches of 500 to avoid hitting limits
    const BATCH_SIZE = 500
    let inserted = 0
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const batch = statements.slice(i, i + BATCH_SIZE)
      await client.batch(batch)
      inserted += batch.length
    }

    return corsJson({
      ok: true,
      inserted,
      total: records.length,
      filtered: records.length - statements.length,
    })
  } catch (err) {
    console.error("[ingest] Error:", err)
    return corsJson({ error: String(err) }, { status: 500 })
  }
}

/**
 * GET /api/ingest — Returns current record count and status.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const apiKey = url.searchParams.get("apiKey")

  if (!INGEST_API_KEY || apiKey !== INGEST_API_KEY) {
    return corsJson({ error: "Unauthorized" }, { status: 401 })
  }

  const count = await getAggiudicatariCount()
  return corsJson({ ok: true, count })
}
