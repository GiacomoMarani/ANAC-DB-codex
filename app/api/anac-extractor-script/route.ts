// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

import { NextResponse } from "next/server"
import { ANAC_EXTRACTOR_SCRIPT } from "@/lib/anac-extractor-script"

const INGEST_API_KEY = process.env.INGEST_API_KEY || ""

/**
 * GET /api/anac-extractor-script
 *
 * Serves the ANAC extraction script as JavaScript.
 * The script is pre-configured with the ingest URL and API key.
 *
 * Usage in ANAC browser console:
 *   fetch('https://tender-ai-db.vercel.app/api/anac-extractor-script').then(r=>r.text()).then(eval)
 */
export async function GET() {
  if (!INGEST_API_KEY) {
    return NextResponse.json(
      { error: "INGEST_API_KEY not configured" },
      { status: 503 }
    )
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://tender-ai-db.vercel.app"
  const ingestUrl = `${baseUrl}/api/ingest`

  const script = ANAC_EXTRACTOR_SCRIPT
    .replace("%%INGEST_URL%%", ingestUrl)
    .replace("%%API_KEY%%", INGEST_API_KEY)

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "https://dati.anticorruzione.it",
    },
  })
}
