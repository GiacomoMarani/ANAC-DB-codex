/**
 * lib/anac-playwright-fetcher.ts
 *
 * Fetcher automatico per ANAC usando Playwright (Chromium headless).
 *
 * PERCHÉ FUNZIONA:
 * Playwright usa il vero motore Chromium — il TLS fingerprint (JA3/JA4)
 * è identico a quello di un utente Chrome reale. Il WAF F5 di ANAC
 * non può distinguerlo da un browser vero e non blocca le richieste.
 *
 * ARCHITETTURA SINGLETON:
 * Il browser viene avviato una sola volta e riutilizzato tra le richieste.
 * Le sessioni/cookie vengono persistiti nel BrowserContext.
 * Alla prima chiamata, naviga su ANAC per ottenere i cookie di sessione.
 *
 * NOTA: funziona in locale (Next.js dev). In produzione serverless
 * (Vercel) non è disponibile — serve un server dedicato o Railway.
 */

import { chromium } from "playwright"
import type { Browser, BrowserContext } from "playwright"
import { mapAnacRow, buildAnacPayload } from "@/lib/sources/anac"
import type { AnacFetchParams }          from "@/lib/sources/anac"
import type { NormalizedTender }         from "@/lib/sources/types"

const ANAC_DASHBOARD = "https://dati.anticorruzione.it/superset/dashboard/appalti/"
const ANAC_CSRF_URL  = "https://dati.anticorruzione.it/api/v1/security/csrf_token/"
const ANAC_CHART_URL = "https://dati.anticorruzione.it/api/v1/chart/data"

// ── Singleton browser + context ───────────────────────────────────────────────
// In Next.js dev con Turbopack il modulo può essere ricaricato —
// usiamo global per sopravvivere ai hot-reload.

declare global {
  // eslint-disable-next-line no-var
  var __anacBrowser:    Browser        | undefined
  // eslint-disable-next-line no-var
  var __anacContext:    BrowserContext | undefined
  // eslint-disable-next-line no-var
  var __anacCsrf:       string         | undefined
  // eslint-disable-next-line no-var
  var __anacCsrfExpiry: number         | undefined
  // eslint-disable-next-line no-var
  var __anacSessionOk:  boolean        | undefined
}

async function getBrowserContext(): Promise<BrowserContext> {
  // Riutilizza il browser se è ancora connesso
  if (global.__anacBrowser?.isConnected() && global.__anacContext) {
    return global.__anacContext
  }

  console.log("[ANAC-PLAYWRIGHT] Avvio Chromium headless…")
  global.__anacBrowser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",  // evita rilevamento bot
    ],
  })

  global.__anacContext = await global.__anacBrowser.newContext({
    userAgent:   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    locale:      "it-IT",
    timezoneId:  "Europe/Rome",
    viewport:    { width: 1280, height: 800 },
    // Nessun stealth plugin necessario — Chromium reale bypassa il WAF
  })

  global.__anacSessionOk = false
  global.__anacCsrf      = undefined

  console.log("[ANAC-PLAYWRIGHT] Browser avviato ✓")
  return global.__anacContext
}

/** Naviga su ANAC per ottenere i cookie di sessione (solo alla prima chiamata) */
async function ensureSession(): Promise<void> {
  if (global.__anacSessionOk) return

  const ctx  = await getBrowserContext()
  const page = await ctx.newPage()
  try {
    console.log("[ANAC-PLAYWRIGHT] Inizializzazione sessione ANAC…")
    await page.goto(ANAC_DASHBOARD, {
      waitUntil: "domcontentloaded",
      timeout:   30_000,
    })
    // Aspetta che Superset abbia inizializzato i cookie
    await page.waitForTimeout(2_000)
    global.__anacSessionOk = true
    console.log("[ANAC-PLAYWRIGHT] Sessione ANAC inizializzata ✓")
  } finally {
    await page.close()
  }
}

/** Ottieni il CSRF token (con cache 25 minuti) */
async function getCsrfToken(): Promise<string> {
  if (
    global.__anacCsrf &&
    global.__anacCsrfExpiry &&
    global.__anacCsrfExpiry > Date.now()
  ) {
    return global.__anacCsrf
  }

  const ctx  = await getBrowserContext()
  const page = await ctx.newPage()
  try {
    const res = await page.request.get(ANAC_CSRF_URL, {
      headers: { Accept: "application/json" },
    })
    const body = await res.json() as { result?: string }
    if (!body.result) throw new Error("CSRF vuoto dalla risposta ANAC")

    global.__anacCsrf      = body.result
    global.__anacCsrfExpiry = Date.now() + 25 * 60_000
    console.log("[ANAC-PLAYWRIGHT] CSRF rinnovato:", body.result.substring(0, 20) + "…")
    return body.result
  } finally {
    await page.close()
  }
}

// ── Fetch principale ──────────────────────────────────────────────────────────

export interface AnacPlaywrightResult {
  items:  NormalizedTender[]
  total:  number
  query?: string
}

export async function fetchAnacWithPlaywright(
  params: AnacFetchParams,
  signal?: AbortSignal,
): Promise<AnacPlaywrightResult> {
  await ensureSession()

  const csrf    = await getCsrfToken()
  const payload = buildAnacPayload({ inCorso: true, ...params })

  const ctx  = await getBrowserContext()
  const page = await ctx.newPage()

  try {
    // Fai la chiamata API dall'interno del browser Playwright
    // page.request mantiene i cookie della sessione ANAC automaticamente
    const res = await page.request.post(ANAC_CHART_URL, {
      headers: {
        "Content-Type": "application/json",
        Accept:         "application/json",
        "X-CSRFToken":  csrf,
        Referer:        ANAC_DASHBOARD,
        Origin:         "https://dati.anticorruzione.it",
      },
      data:    JSON.stringify(payload),
      timeout: 25_000,
    })

    if (!res.ok()) {
      const text = await res.text()

      // Se 401/403 il CSRF è scaduto — invalida la cache
      if (res.status() === 401 || res.status() === 403) {
        global.__anacCsrf       = undefined
        global.__anacSessionOk  = false
      }

      throw new Error(`ANAC HTTP ${res.status()}: ${text.slice(0, 200)}`)
    }

    const data   = await res.json() as {
      result?: Array<{
        data?:     Record<string, unknown>[]
        rowcount?: number
        error?:    string
        query?:    string
      }>
    }
    const result = data?.result?.[0]

    if (result?.error) {
      throw new Error(`Dremio error: ${result.error}`)
    }

    const rows  = (result?.data ?? []) as Record<string, unknown>[]
    const items = rows.map(mapAnacRow)

    console.log(`[ANAC-PLAYWRIGHT] ✓ ${items.length} bandi (tot: ${result?.rowcount})`)

    return {
      items,
      total: result?.rowcount ?? rows.length,
      query: result?.query,
    }
  } catch (err) {
    // Se il CSRF è scaduto, prova a recuperarlo al prossimo invio
    if (err instanceof Error && err.message.includes("403")) {
      global.__anacCsrf = undefined
    }
    throw err
  } finally {
    if (!signal?.aborted) await page.close()
  }
}

/** Chiudi il browser (usato per cleanup) */
export async function closeAnacBrowser(): Promise<void> {
  try {
    await global.__anacContext?.close()
    await global.__anacBrowser?.close()
  } catch { /* ignora */ }
  global.__anacBrowser    = undefined
  global.__anacContext    = undefined
  global.__anacSessionOk  = false
  global.__anacCsrf       = undefined
}
