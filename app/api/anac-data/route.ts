// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * /api/anac-data
 *
 * Store in-memory dei dati ANAC pre-fetchati dal console script.
 *
 * Il console script (eseguito su dati.anticorruzione.it in same-origin)
 * fa la query completa all'API ANAC e invia i risultati JSON qui via POST.
 * L'hook useAnacTenders li legge via GET.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Console Script (su dati.anticorruzione.it)                 │
 * │    → fetch('/api/v1/security/csrf_token/')  ← same-origin ✅│
 * │    → fetch('/api/v1/chart/data', payload)   ← same-origin ✅│
 * │    → POST http://localhost:3000/api/anac-data  ← CORS ✅    │
 * │         { key, items[], total, rowcount }                   │
 * ├─────────────────────────────────────────────────────────────┤
 * │  Hook useAnacTenders (su localhost:3000)                    │
 * │    → GET /api/anac-data?key=...   ← same-origin ✅          │
 * │    → Mostra items, total                                    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * CORS: il POST da dati.anticorruzione.it è cross-origin → abilita CORS.
 * Il GET da localhost è same-origin → nessun problema.
 *
 * STORE: Map<key, { items, total, savedAt }>
 * TTL: 10 minuti per ogni bucket.
 * Max bucket: 20 (FIFO rotation).
 */

import { NextRequest, NextResponse } from "next/server"
import { mapAnacRow }                from "@/lib/sources/anac"

// ── Tipi ──────────────────────────────────────────────────────────────────────

interface AnacDataBucket {
  items:    ReturnType<typeof mapAnacRow>[]
  total:    number
  savedAt:  number
  key:      string
}

// ── Store in-memory ───────────────────────────────────────────────────────────

const store = new Map<string, AnacDataBucket>()
const TTL   = 10 * 60_000   // 10 minuti
const MAX   = 20             // max bucket concorrenti

function evict() {
  if (store.size <= MAX) return
  // Rimuovi il bucket più vecchio
  let oldest: string | null = null
  let oldestTime = Infinity
  for (const [k, v] of store.entries()) {
    if (v.savedAt < oldestTime) { oldestTime = v.savedAt; oldest = k }
  }
  if (oldest) store.delete(oldest)
}

function cleanExpired() {
  const now = Date.now()
  for (const [k, v] of store.entries()) {
    if (now - v.savedAt > TTL) store.delete(k)
  }
}

// ── CORS headers per dati.anticorruzione.it ───────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "https://dati.anticorruzione.it",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Anac-Key",
}

// ── OPTIONS (preflight CORS) ──────────────────────────────────────────────────

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ── POST: riceve i dati dal console script su ANAC ───────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      key:       string                          // hash params (q, page, tipo, importo)
      rows:      Record<string, unknown>[]       // raw rows da ANAC
      total:     number
      rowcount?: number
    }

    const { key, rows, total, rowcount } = body

    if (!key || !Array.isArray(rows)) {
      return NextResponse.json(
        { error: "key e rows sono obbligatori" },
        { status: 400, headers: CORS_HEADERS },
      )
    }

    cleanExpired()

    const items = rows.map(mapAnacRow)
    store.set(key, {
      items,
      total:   rowcount ?? total ?? items.length,
      savedAt: Date.now(),
      key,
    })
    evict()

    console.log(`[ANAC-DATA] Saved key="${key}" items=${items.length} total=${total}`)

    return NextResponse.json(
      { ok: true, saved: items.length },
      { headers: CORS_HEADERS },
    )
  } catch (err) {
    console.error("[ANAC-DATA] POST error:", err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: CORS_HEADERS },
    )
  }
}

// ── GET: l'hook legge i dati cachati ─────────────────────────────────────────

export function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key")

  if (!key) {
    // Lista tutti i bucket attivi (debug)
    cleanExpired()
    const buckets = Array.from(store.values()).map(b => ({
      key:     b.key,
      items:   b.items.length,
      total:   b.total,
      age:     Math.round((Date.now() - b.savedAt) / 1000),
    }))
    return NextResponse.json({ buckets })
  }

  cleanExpired()
  const bucket = store.get(key)

  if (!bucket || Date.now() - bucket.savedAt > TTL) {
    return NextResponse.json(
      { stale: true, items: [], total: 0 },
      { status: 404 },
    )
  }

  return NextResponse.json({
    items:   bucket.items,
    total:   bucket.total,
    savedAt: bucket.savedAt,
    age:     Math.round((Date.now() - bucket.savedAt) / 1000),
  })
}
