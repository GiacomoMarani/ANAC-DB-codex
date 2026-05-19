/**
 * POST /api/anac-session
 *
 * Endpoint che riceve le credenziali ANAC inviate dal bookmarklet
 * o dallo script eseguito sulla pagina ANAC.
 *
 * Il bookmarklet, eseguito sulla pagina dati.anticorruzione.it, legge
 * il CSRF token e lo invia qui tramite fetch (cross-origin dalla pagina ANAC).
 * Poi l'app usa questo token + i cookie ANAC per fare le query.
 *
 * HEADERS NECESSARI: CORS aperto per accettare POST da dati.anticorruzione.it
 */

import { NextRequest, NextResponse } from "next/server"

// Store in-memory (per istanza server — in produzione usare Redis o KV)
let _anacSession: {
  csrf:      string
  cookies?:  string
  expiresAt: number
} | null = null

export async function POST(req: NextRequest) {
  try {
    const { csrf, cookies } = await req.json() as {
      csrf:     string
      cookies?: string
    }

    if (!csrf) {
      return NextResponse.json({ error: "csrf required" }, { status: 400 })
    }

    _anacSession = {
      csrf,
      cookies:   cookies || undefined,
      expiresAt: Date.now() + 30 * 60_000,
    }

    console.log("[ANAC-SESSION] Sessione ricevuta dal browser, csrf:", csrf.substring(0, 20))

    return NextResponse.json(
      { ok: true, expiresAt: _anacSession.expiresAt },
      {
        headers: {
          "Access-Control-Allow-Origin":  "https://dati.anticorruzione.it",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      },
    )
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  if (!_anacSession || _anacSession.expiresAt < Date.now()) {
    return NextResponse.json({ active: false }, { status: 404 })
  }

  return NextResponse.json({
    active:    true,
    csrf:      _anacSession.csrf,
    hasCookies: !!_anacSession.cookies,
    expiresAt: _anacSession.expiresAt,
  })
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  "https://dati.anticorruzione.it",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}

export function getAnacSessionFromStore() {
  if (!_anacSession || _anacSession.expiresAt < Date.now()) return null
  return _anacSession
}
