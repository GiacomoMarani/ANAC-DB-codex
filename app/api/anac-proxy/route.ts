/**
 * POST /api/anac-proxy
 *
 * Proxy lato server per ANAC Superset.
 * Usa la sessione server ottenuta da /api/anac-csrf (undici + header Chrome).
 *
 * Accetta:
 *   - csrf:   token CSRF (obbligatorio — ottenuto da /api/anac-csrf)
 *   - params: AnacFetchParams (filtri)
 *   - cookie: stringa cookie opzionale (se disponibile)
 */

import { NextRequest, NextResponse } from "next/server"
import { Agent, fetch as undiciFetch } from "undici"
import { mapAnacRow, buildAnacPayload } from "@/lib/sources/anac"
import type { AnacFetchParams }         from "@/lib/sources/anac"
import { getAnacServerSession }         from "@/app/api/anac-csrf/route"
import { getAnacSessionFromStore }      from "@/app/api/anac-session/route"

const ANAC_BASE = "https://dati.anticorruzione.it"
const CHART_URL = `${ANAC_BASE}/api/v1/chart/data`
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"

export async function POST(req: NextRequest) {
  try {
    const body: {
      csrf?:    string
      cookie?:  string
      params?:  AnacFetchParams
      payload?: unknown  // payload precostruito dall'hook
    } = await req.json()

    const { params = {} } = body

    // Ottieni la sessione: priorità → session-store (da bookmarklet/console) → server-side (undici)
    const storedSession = getAnacSessionFromStore()
    const serverSession = storedSession ? null : await getAnacServerSession()
    const session = storedSession ?? serverSession

    const csrf    = body.csrf ?? session?.csrf
    const cookies = body.cookie ?? session?.cookies ?? storedSession?.cookies

    if (!csrf) {
      return NextResponse.json(
        { error: "CSRF token non disponibile — esegui il console script su dati.anticorruzione.it" },
        { status: 503 },
      )
    }

    // Usa il payload precostruito (se fornito) altrimenti build dai params
    const payload = body.payload ?? buildAnacPayload({ inCorso: true, ...params })

    const agent = new Agent({
      connect: { rejectUnauthorized: false },
    })

    const requestHeaders: Record<string, string> = {
      "Content-Type":    "application/json",
      Accept:            "application/json, text/plain, */*",
      "X-CSRFToken":     csrf,
      Referer:           `${ANAC_BASE}/superset/dashboard/appalti/`,
      Origin:            ANAC_BASE,
      "User-Agent":      req.headers.get("user-agent") ?? UA,
      "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Sec-Ch-Ua":         '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "Sec-Ch-Ua-Mobile":  "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest":    "empty",
      "Sec-Fetch-Mode":    "cors",
      "Sec-Fetch-Site":    "same-origin",
    }

    if (cookies) requestHeaders["Cookie"] = cookies

    const anacRes = await undiciFetch(CHART_URL, {
      method:  "POST",
      headers: requestHeaders,
      body:    JSON.stringify(payload),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- undici dispatcher
      dispatcher: agent,
      signal:  AbortSignal.timeout(25_000),
    })

    if (!anacRes.ok) {
      const errText = await anacRes.text().catch(() => anacRes.statusText)
      console.error("[ANAC-PROXY] Error:", anacRes.status, errText.substring(0, 300))
      return NextResponse.json(
        { error: `ANAC HTTP ${anacRes.status}`, detail: errText.slice(0, 300) },
        { status: anacRes.status },
      )
    }

    const data   = await anacRes.json() as { result?: Array<{ data?: unknown[]; rowcount?: number; error?: string; query?: string }> }
    const result = data?.result?.[0]

    if (result?.error) {
      return NextResponse.json(
        { error: `ANAC Dremio: ${String(result.error).slice(0, 300)}` },
        { status: 500 },
      )
    }

    const rows: Record<string, unknown>[] = (result?.data ?? []) as Record<string, unknown>[]
    const items = rows.map(mapAnacRow)

    console.log(`[ANAC-PROXY] OK — ${items.length} items (total: ${result?.rowcount})`)

    return NextResponse.json(
      {
        items,
        total:  result?.rowcount ?? rows.length,
        source: "anac",
        query:  result?.query ?? null,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    )
  } catch (err) {
    console.error("[ANAC-PROXY] Exception:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
