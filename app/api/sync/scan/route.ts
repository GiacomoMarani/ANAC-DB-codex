/**
 * GET /api/sync/scan?mb=0
 * Scans the ANAC bulk file at a specific MB offset to find where "releases":[ starts.
 * Diagnostic only — not for production use.
 */
import { NextRequest, NextResponse } from "next/server"

const URL = "https://dati.anticorruzione.it/opendata/download/dataset/ocds/filesystem/bulk/2026/03.json"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const WINDOW = 512 * 1024  // 512KB window per scan

export const maxDuration = 30

export async function GET(request: NextRequest) {
  const mb = parseInt(request.nextUrl.searchParams.get("mb") ?? "0")
  const start = mb * 1024 * 1024
  const end = start + WINDOW - 1

  const res = await fetch(URL, {
    headers: { "User-Agent": UA, Accept: "*/*", Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  })

  const text = await res.text()
  const TOKENS = ['"releases": [', '"releases":[', '"releases" : [']
  let tokenIdx = -1
  let foundToken = ""
  for (const tok of TOKENS) {
    const idx = text.indexOf(tok)
    if (idx >= 0 && (tokenIdx === -1 || idx < tokenIdx)) { tokenIdx = idx; foundToken = tok }
  }

  return NextResponse.json({
    mb,
    byte_range: `${start}-${end}`,
    status: res.status,
    text_length: text.length,
    token_found: tokenIdx >= 0,
    found_token: foundToken,
    token_byte_offset: tokenIdx >= 0 ? start + tokenIdx : null,
    preview_at_token: tokenIdx >= 0 ? text.substring(tokenIdx, tokenIdx + 200) : null,
    preview_start: text.substring(0, 200),
  })
}
