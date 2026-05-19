/**
 * POST /api/anac-fetch-now
 *
 * Triggera un fetch ANAC automatico via Playwright (Chromium headless).
 * Viene chiamata dall'hook useAnacTenders al posto del console script manuale.
 *
 * Body: { key: string, params: AnacFetchParams }
 *
 * Risposta:
 *  200 → { ok: true, items, total, source: "playwright" }
 *  503 → { error: "...", fallback: true }  (usa il console script invece)
 *
 * NOTA: Playwright richiede il binario Chromium (non disponibile su Vercel serverless).
 * In ambienti serverless risponde immediatamente con fallback:true.
 * Funziona solo in locale (Next.js dev / server dedicato).
 */

import { NextRequest, NextResponse } from "next/server"
import type { AnacFetchParams }      from "@/lib/sources/anac"

// Previeni richieste concorrenti (una sola sessione Playwright alla volta)
let _inFlight = false

export async function POST(req: NextRequest) {
  // ── Rilevamento ambiente serverless ───────────────────────────────────────
  // Vercel setta VERCEL=1; in questi ambienti Playwright non può avviare Chromium.
  const isServerless = !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.CF_PAGES
  )

  if (isServerless) {
    return NextResponse.json(
      {
        fallback: true,
        reason:   "serverless",
        message:  "Playwright non disponibile in ambiente serverless. Usa il relay manuale.",
      },
      { status: 503 },
    )
  }

  try {
    const { key, params } = await req.json() as {
      key:    string
      params: AnacFetchParams
    }

    if (!key || !params) {
      return NextResponse.json({ error: "key e params richiesti" }, { status: 400 })
    }

    if (_inFlight) {
      return NextResponse.json(
        { queued: true, message: "Fetch già in corso, riprova tra 3s" },
        { status: 202 },
      )
    }

    _inFlight = true
    try {
      // Import dinamico per evitare bundling su serverless
      const { fetchAnacWithPlaywright } = await import("@/lib/anac-playwright-fetcher")
      const result = await fetchAnacWithPlaywright(params)

      await fetch(
        new URL("/api/anac-data", req.url).toString(),
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            key,
            rows:     result.items.map(item => ({
              cig:                                       item.cig,
              oggetto_bando:                             item.oggetto,
              importo_lotto:                             item.importo,
              denominazione_amministrazione_appaltante:  item.stazione_appaltante,
              data_pubblicazione:                        item.data_pubblicazione,
              oggetto_principale_contratto:              item.tipo_contratto,
              tipo_scelta_contraente:                    null,
              sezione_regionale:                         item.provincia,
            })),
            total:    result.total,
            rowcount: result.total,
          }),
        },
      )

      return NextResponse.json({
        ok:     true,
        items:  result.items.length,
        total:  result.total,
        source: "playwright",
      })
    } finally {
      _inFlight = false
    }
  } catch (err) {
    _inFlight = false
    const message = err instanceof Error ? err.message : String(err)
    console.error("[ANAC-FETCH-NOW] Error:", message)

    return NextResponse.json(
      { error: message, fallback: true },
      { status: 503 },
    )
  }
}
