// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * /api/tenders/widget — Proxy verso get-cato.com/api/tenders/widget (no auth)
 *
 * Parametri:
 *   cpv  — codice CPV (2 cifre)
 *   kw   — keyword comma-separated
 *   q    — ricerca diretta
 */
import { NextRequest, NextResponse } from "next/server"

const ITA_WIDGET = "https://www.get-cato.com/api/tenders/widget"

export async function GET(request: NextRequest) {
  const sp  = request.nextUrl.searchParams
  const cpv = sp.get("cpv") ?? ""
  const kw  = sp.get("kw") ?? ""
  const q   = sp.get("q") ?? ""

  const itaParams = new URLSearchParams()
  if (cpv) itaParams.set("cpv", cpv)
  if (kw)  itaParams.set("kw", kw)
  if (q)   itaParams.set("q", q)

  const itaUrl = `${ITA_WIDGET}?${itaParams.toString()}`

  try {
    const res = await fetch(itaUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.get-cato.com/ricerca-gare",
      },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 30 },
    })

    if (!res.ok) {
      // Fallback: use main tenders endpoint with keyword filter
      const fallback = await fetch(
        `https://www.get-cato.com/api/tenders?p=0&q=${encodeURIComponent(kw || q || cpv)}`,
        { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8_000) }
      )
      if (!fallback.ok) return NextResponse.json({ items: [] })
      const fbData = await fallback.json()
      return NextResponse.json({ items: (fbData.items ?? []).slice(0, 6) })
    }

    const raw = await res.json()

    const items = (raw.items ?? raw.data ?? []).map((item: Record<string, unknown>) => {
      const info = (item.extracted_main_info as Record<string, unknown>) ?? {}
      return {
        id:             item.id,
        cig:            info.cig ?? item.cig ?? item.id,
        oggetto:        item.title ?? item.oggetto ?? null,
        importo:        parseFloat(String(info.importo ?? item.importo ?? 0)) || null,
        stato:          item.status ?? "active",
        data_scadenza:  info.data_scadenza ?? info.scadenza ?? item.data_scadenza_offerta ?? null,
        tipo_contratto: item.tipo_procedura ?? null,
        descrizione_cpv: (item.cpv_codes as string[] | undefined)?.join(", ") ?? null,
        provincia:      info.provincia ?? item.provincia ?? null,
        sources:        item.source ?? "ita",
        link_originale: item.original_url ?? null,
      }
    })

    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upstream error", items: [] },
      { status: 502 }
    )
  }
}
