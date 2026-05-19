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
 * NOTA: questa route usa Playwright che richiede il binario Chromium.
 * Funziona in locale (Next.js dev). In produzione serverless non è disponibile.
 */

import { NextRequest, NextResponse }     from "next/server"
import { fetchAnacWithPlaywright }        from "@/lib/anac-playwright-fetcher"
import type { AnacFetchParams }           from "@/lib/sources/anac"

// Previeni richieste concorrenti (una sola sessione Playwright alla volta)
let _inFlight = false

export async function POST(req: NextRequest) {
  try {
    const { key, params } = await req.json() as {
      key:    string
      params: AnacFetchParams
    }

    if (!key || !params) {
      return NextResponse.json({ error: "key e params richiesti" }, { status: 400 })
    }

    // Dedup: se c'è già una richiesta in volo, aspetta 500ms e riprova
    if (_inFlight) {
      return NextResponse.json(
        { queued: true, message: "Fetch già in corso, riprova tra 3s" },
        { status: 202 },
      )
    }

    _inFlight = true
    try {
      const result = await fetchAnacWithPlaywright(params)

      // Salva nel data store — mappiamo NormalizedTender → raw rows
      // che il /api/anac-data riconvertirà via mapAnacRow
      const storeRes = await fetch(
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

      if (!storeRes.ok) {
        console.warn("[ANAC-FETCH-NOW] Store save failed:", storeRes.status)
      }

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
      {
        error:    message,
        fallback: true,  // il client può mostrare le istruzioni manuali come fallback
      },
      { status: 503 },
    )
  }
}
