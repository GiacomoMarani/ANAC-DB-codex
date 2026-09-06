// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * GET /api/sync/test
 * Validates the bulk OCDS streaming pipeline end-to-end.
 * Downloads the first ~300KB of the latest bulk file, extracts and maps
 * a few active releases, WITHOUT writing to Supabase.
 *
 * Query params:
 *   year=2026  month=03  (defaults: last published month)
 */

import { NextRequest, NextResponse } from "next/server"
import { isActiveTender } from "@/lib/utils/tenderLogic"

const ANAC_BASE = "https://dati.anticorruzione.it"
const BULK_BASE = `${ANAC_BASE}/opendata/download/dataset/ocds/filesystem/bulk`

export const maxDuration = 60

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8",
  // NO Accept-Encoding â€” forces uncompressed response so TextDecoder works
  "Cache-Control": "no-cache",
}

function trunc(v: unknown, max: number): string | null {
  if (v == null || v === "") return null
  const s = String(v).trim()
  return s ? s.substring(0, max) : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function* streamReleases(res: Response): AsyncGenerator<any> {
  if (!res.body) throw new Error("No body")
  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let found = false
  let depth = 0
  let inObj = false
  let objStart = 0
  let inStr = false
  let esc = false
  // ANAC indented JSON uses "releases": [ (space), not "releases":[
  const TOKENS = ['"releases": [', '"releases":[', '"releases" : [']
  let TOKEN = '"releases": ['
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: !done })
      if (!found) {
        let bestIdx = -1
        for (const t of TOKENS) {
          const idx = buffer.indexOf(t)
          if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) { bestIdx = idx; TOKEN = t }
        }
        if (bestIdx === -1) { buffer = buffer.slice(Math.max(0, buffer.length - 30)); continue }
        buffer = buffer.slice(bestIdx + TOKEN.length)
        found = true
      }
      let i = 0
      while (i < buffer.length) {
        const ch = buffer[i]
        if (esc) { esc = false; i++; continue }
        if (inStr) { if (ch === "\\") { esc = true; i++; continue } if (ch === '"') inStr = false; i++; continue }
        if (ch === '"') { inStr = true; i++; continue }
        if (!inObj) { if (ch === "{") { inObj = true; depth = 1; objStart = i } else if (ch === "]") break; i++; continue }
        if (ch === "{") depth++
        else if (ch === "}") { depth--; if (depth === 0) { try { yield JSON.parse(buffer.slice(objStart, i + 1)) } catch { /**/ } buffer = buffer.slice(i + 1); i = 0; inObj = false; depth = 0; continue } }
        i++
      }
      if (!inObj) buffer = ""
    }
  } finally { reader.cancel().catch(() => {}) }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const now = new Date()
  const year = searchParams.get("year") ?? String(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear())
  const month = (searchParams.get("month") ?? String(now.getMonth() === 0 ? 12 : now.getMonth())).padStart(2, "0")
  const url = `${BULK_BASE}/${year}/${month}.json`
  const steps: Record<string, unknown> = { url }

  // HEAD check
  const head = await fetch(url, { method: "HEAD", headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10_000), redirect: "follow" })
    .catch((e) => { steps.head_error = e.message; return null })
  if (!head) return NextResponse.json({ ok: false, steps }, { status: 500 })

  steps.head_status = head.status
  steps.file_size_mb = Math.round(parseInt(head.headers.get("content-length") ?? "0") / 1024 / 1024)
  steps.file_available = head.ok
  if (!head.ok) return NextResponse.json({ ok: false, steps }, { status: head.status })

  // Download first 8 MB to ensure we capture the releases array start
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Range: "bytes=0-8388607" },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  })
  steps.range_status = res.status  // 206 = partial content OK
  steps.range_bytes = res.headers.get("content-range")
  steps.response_content_type = res.headers.get("content-type")
  steps.response_content_encoding = res.headers.get("content-encoding") ?? "none (uncompressed)"
  // Quick peek at first 200 chars to verify we're getting plain JSON
  const textPeek = await res.clone().text().catch(() => "").then(t => t.substring(0, 200))
  steps.raw_preview = textPeek
  steps.releases_token_found = textPeek.includes('"releases"') || (await res.clone().text().catch(() => "")).includes('"releases":[')
  const sample: unknown[] = []
  let seen = 0
  let active = 0
  let inactive = 0

  try {
    for await (const release of streamReleases(res)) {
      seen++
      const status = release?.tender?.status
      const endDate = release?.tender?.tenderPeriod?.endDate ?? null
      const isActive = isActiveTender({ stato: status ?? null, data_scadenza_offerta: endDate })
      if (isActive) {
        active++
        if (sample.length < 5) {
          sample.push({
            cig: trunc(release?.tender?.id ?? release?.ocid, 50),
            title: trunc(release?.tender?.title, 120),
            status,
            value: release?.tender?.value?.amount,
            endDate: trunc(endDate, 30),
            region: trunc(release?.tender?.procuringEntity?.address?.region, 60),
            category: release?.tender?.mainProcurementCategory,
          })
        }
      } else inactive++
      if (active >= 20 || seen >= 500) break
    }
  } catch (err) {
    steps.stream_error = err instanceof Error ? err.message : String(err)
  }

  steps.seen_total = seen
  steps.active_found = active
  steps.inactive_skipped = inactive
  steps.active_ratio_pct = seen > 0 ? Math.round((active / seen) * 100) : 0
  steps.sample_active_records = sample

  return NextResponse.json({ ok: true, steps })
}
