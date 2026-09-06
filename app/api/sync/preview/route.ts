// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * GET /api/sync/preview
 * Downloads and previews ANAC bulk OCDS data without writing to Supabase.
 *
 * Query params:
 *   year   = 2026 (default: last year)
 *   month  = 03   (default: last month, zero-padded)
 *   rows   = 20   (max 100)
 *   debug  = 1    (show raw bytes instead of parsed records)
 *
 * The ANAC bulk file is an OCDS Release Package (single JSON object ~748MB).
 * We stream the response and extract releases via brace-depth tracking.
 * This works within Vercel's memory limits.
 */

import { NextRequest, NextResponse } from "next/server"

const ANAC_BASE = "https://dati.anticorruzione.it"
const BULK_BASE = `${ANAC_BASE}/opendata/download/dataset/ocds/filesystem/bulk`

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
}

export const maxDuration = 60

// ── Field mapping ─────────────────────────────────────────────────────────────

function trunc(v: unknown, max: number): string | null {
  if (v == null || v === "") return null
  const s = String(v).trim()
  return s ? s.substring(0, max) : null
}

function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return isFinite(v) ? v : null
  const n = Number(String(v).replace(/\s+/g, "").replace(",", "."))
  return isFinite(n) ? n : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRelease(release: any) {
  const t = release?.tender ?? {}
  const cig = trunc(t.id ?? release.ocid, 50)
  if (!cig) return null

  return {
    cig,
    oggetto_gara: trunc(t.title, 200),
    importo_lotto: parseAmount(t.value?.amount),
    currency: trunc(t.value?.currency, 10),
    oggetto_principale_contratto: trunc(t.mainProcurementCategory, 100),
    status: trunc(t.status, 100),
    entita_appaltante: trunc(t.procuringEntity?.name, 200),
    indirizzo_region: trunc(t.procuringEntity?.address?.region, 100),
    indirizzo_locality: trunc(t.procuringEntity?.address?.locality, 100),
    data_pubblicazione: trunc(t.tenderPeriod?.startDate, 30),
    data_scadenza_offerta: trunc(t.tenderPeriod?.endDate, 30),
    categoria_cpv: trunc(t.items?.[0]?.classification?.id, 20),
    descrizione_cpv: trunc(t.items?.[0]?.classification?.description, 200),
    esito_award: trunc(release.awards?.[0]?.status, 100),
    ocid: release.ocid,
    // Debug: show raw tender keys
    _tender_keys: Object.keys(t),
  }
}

// ── Streaming parser (brace-depth) ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function* streamReleases(res: Response): AsyncGenerator<any> {
  if (!res.body) throw new Error("Response body è null")
  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")

  let buffer = ""
  let foundReleases = false
  let depth = 0
  let inObj = false
  let objStart = 0
  let inString = false
  let escape = false
  const SEARCH_TOKEN = '"releases":['

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: !done })

      if (!foundReleases) {
        const idx = buffer.indexOf(SEARCH_TOKEN)
        if (idx === -1) {
          const k = Math.max(0, buffer.length - SEARCH_TOKEN.length)
          buffer = buffer.slice(k)
          continue
        }
        buffer = buffer.slice(idx + SEARCH_TOKEN.length)
        foundReleases = true
      }

      let i = 0
      while (i < buffer.length) {
        const ch = buffer[i]
        if (escape) { escape = false; i++; continue }
        if (inString) {
          if (ch === "\\") { escape = true; i++; continue }
          if (ch === '"') inString = false
          i++; continue
        }
        if (ch === '"') { inString = true; i++; continue }

        if (!inObj) {
          if (ch === "{") { inObj = true; depth = 1; objStart = i }
          else if (ch === "]") break
          i++; continue
        }

        if (ch === "{") depth++
        else if (ch === "}") {
          depth--
          if (depth === 0) {
            const jsonStr = buffer.slice(objStart, i + 1)
            try { yield JSON.parse(jsonStr) } catch { /* skip malformed */ }
            buffer = buffer.slice(i + 1)
            i = 0; inObj = false; depth = 0
            continue
          }
        }
        i++
      }

      if (inObj && objStart > 0) {
        buffer = buffer.slice(objStart)
        objStart = 0
      } else if (!inObj) {
        buffer = ""
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const now = new Date()

  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth()

  const year = searchParams.get("year") ?? String(defaultYear)
  const month = (searchParams.get("month") ?? String(defaultMonth)).padStart(2, "0")
  const maxRows = Math.min(parseInt(searchParams.get("rows") ?? "20"), 100)
  const debug = searchParams.get("debug") === "1"

  const url = `${BULK_BASE}/${year}/${month}.json`

  // HEAD check for availability
  const head = await fetch(url, {
    method: "HEAD",
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(10_000),
    redirect: "follow",
  }).catch((err) => {
    throw new Error(`HEAD failed: ${err.message}`)
  })

  if (!head.ok) {
    return NextResponse.json(
      { ok: false, url, error: `HTTP ${head.status} — file non disponibile` },
      { status: head.status }
    )
  }

  if (debug) {
    // Fetch only first 2KB to inspect format
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Range: "bytes=0-2047" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    })
    const text = await res.text()
    return NextResponse.json({
      ok: true,
      url,
      status: res.status,
      content_type: res.headers.get("content-type"),
      file_size_bytes: head.headers.get("content-length"),
      raw_start: text.substring(0, 800),
    })
  }

  // Full streaming parse
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(55_000),
    redirect: "follow",
  })

  const parsed = []
  let skipped = 0
  let parseErrors = 0

  try {
    for await (const release of streamReleases(res)) {
      if (parsed.length >= maxRows) break
      const mapped = mapRelease(release)
      if (mapped) parsed.push(mapped)
      else skipped++

      if (parsed.length + skipped > maxRows * 5) break // safety limit
    }
  } catch (err) {
    parseErrors++
    return NextResponse.json({
      ok: false,
      url,
      parsed_so_far: parsed.length,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    url,
    file_size_mb: Math.round(parseInt(head.headers.get("content-length") ?? "0") / 1024 / 1024),
    parsed_records: parsed.length,
    skipped_no_cig: skipped,
    parse_errors: parseErrors,
    field_names: parsed[0] ? Object.keys(parsed[0]).filter((k) => !k.startsWith("_")) : [],
    sample: parsed,
  })
}
