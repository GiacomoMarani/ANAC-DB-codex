// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * /api/anac-request
 *
 * Canale di comunicazione app → Tampermonkey relay.
 *
 * PUT  → useAnacTenders pubblica { key, params } da eseguire
 * GET  → Tampermonkey legge la request corrente (polling ogni 3s)
 * DEL  → Tampermonkey conferma completamento
 *
 * CORS *: GM_xmlhttpRequest bypassa CORS, ma alcuni browser
 *         richiedono headers espliciti; usiamo * per sicurezza.
 */

import { NextRequest, NextResponse } from "next/server"
import type { AnacFetchParams }      from "@/lib/sources/anac"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

const TTL = 5 * 60_000   // 5 minuti

let _current: { key: string; params: AnacFetchParams; updatedAt: number } | null = null

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export function GET() {
  if (!_current) {
    return NextResponse.json({ pending: false }, { headers: CORS })
  }
  if (Date.now() - _current.updatedAt > TTL) {
    _current = null
    return NextResponse.json({ pending: false }, { headers: CORS })
  }
  return NextResponse.json(
    { pending: true, key: _current.key, params: _current.params },
    { headers: CORS },
  )
}

export async function PUT(req: NextRequest) {
  try {
    const { key, params } = await req.json() as { key: string; params: AnacFetchParams }
    _current = { key, params, updatedAt: Date.now() }
    console.log(`[ANAC-REQUEST] Pubblicata key="${key}"`)
    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

export function DELETE() {
  _current = null
  return NextResponse.json({ ok: true }, { headers: CORS })
}
