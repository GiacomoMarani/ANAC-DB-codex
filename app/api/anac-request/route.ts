/**
 * /api/anac-request
 *
 * Registro della "richiesta corrente" dell'hook useAnacTenders.
 * Il console script (su dati.anticorruzione.it) fa polling qui
 * per sapere quali dati deve fetchare.
 *
 * PUT  /api/anac-request       { key, params }  → salva la richiesta corrente
 * GET  /api/anac-request       → restituisce la richiesta corrente
 *
 * CORS: GET aperto anche a dati.anticorruzione.it (il console script legge da qui)
 */

import { NextRequest, NextResponse } from "next/server"
import type { AnacFetchParams }       from "@/lib/sources/anac"

const CORS = {
  "Access-Control-Allow-Origin":  "https://dati.anticorruzione.it",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

let _current: { key: string; params: AnacFetchParams; updatedAt: number } | null = null

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export function GET() {
  if (!_current) {
    return NextResponse.json({ empty: true }, { headers: CORS })
  }
  return NextResponse.json({ ..._current }, { headers: CORS })
}

export async function PUT(req: NextRequest) {
  try {
    const { key, params } = await req.json() as {
      key:    string
      params: AnacFetchParams
    }
    _current = { key, params, updatedAt: Date.now() }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}
