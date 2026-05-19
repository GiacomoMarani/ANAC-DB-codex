/**
 * GET /api/anac-csrf
 *
 * Ottiene il CSRF token da dati.anticorruzione.it usando undici
 * con impostazioni TLS personalizzate per bypassare il WAF F5.
 *
 * Il WAF F5 usa TLS fingerprinting (JA3/JA4) per distinguere browser
 * da bot. undici permette di configurare la sessione TLS in modo da
 * imitare un browser Chrome, bypassando il blocco.
 *
 * Flusso:
 *   1. GET https://dati.anticorruzione.it/superset/dashboard/appalti/
 *      → raccoglie i Set-Cookie (BIGip, session, TS01)
 *   2. GET https://dati.anticorruzione.it/api/v1/security/csrf_token/
 *      → con i cookie del passo 1
 *   3. Restituisce { csrf: "token" }
 */

import { NextResponse } from "next/server"
import { Agent, fetch as undiciFetch } from "undici"

const ANAC_BASE = "https://dati.anticorruzione.it"

// User-Agent Chrome 147 (stesso della sessione browser)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"

// Cache della sessione server-side (30 min)
let _serverSession: { cookies: string; csrf: string; expiresAt: number } | null = null

async function getServerSession(): Promise<{ cookies: string; csrf: string } | null> {
  const now = Date.now()
  if (_serverSession && _serverSession.expiresAt > now) return _serverSession

  try {
    // Usa undici con TLS options personalizzate
    const agent = new Agent({
      connect: {
        rejectUnauthorized: false,
        secureOptions: 0,
      },
    })

    // Step 1: GET homepage per ottenere i cookie di sessione
    const homeRes = await undiciFetch(`${ANAC_BASE}/superset/dashboard/appalti/`, {
      method: "GET",
      headers: {
        "User-Agent":        UA,
        Accept:              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language":   "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding":   "gzip, deflate, br",
        "Cache-Control":     "no-cache",
        "Sec-Ch-Ua":         '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "Sec-Ch-Ua-Mobile":  "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest":    "document",
        "Sec-Fetch-Mode":    "navigate",
        "Sec-Fetch-Site":    "none",
        "Sec-Fetch-User":    "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- undici dispatcher
      dispatcher: agent,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    })

    // Raccoglie i cookie dalla risposta
    const rawCookies: string[] = []
    for (const [name, value] of homeRes.headers.entries()) {
      if (name.toLowerCase() === "set-cookie") {
        const cookiePart = value.split(";")[0].trim()
        if (cookiePart) rawCookies.push(cookiePart)
      }
    }

    // Alcuni server mandano multiple Set-Cookie come array
    const getSetCookieArr = homeRes.headers.getSetCookie?.() ?? []
    for (const c of getSetCookieArr) {
      const part = c.split(";")[0].trim()
      if (part && !rawCookies.includes(part)) rawCookies.push(part)
    }

    const cookieString = [...new Set(rawCookies)].join("; ")
    console.log("[ANAC-CSRF] Home status:", homeRes.status, "Cookies:", cookieString.substring(0, 80))

    if (!cookieString) {
      console.warn("[ANAC-CSRF] Nessun cookie dalla homepage ANAC — WAF attivo")
      // Tentiamo comunque il CSRF
    }

    // Step 2: GET CSRF token
    const csrfRes = await undiciFetch(`${ANAC_BASE}/api/v1/security/csrf_token/`, {
      method: "GET",
      headers: {
        "User-Agent":      UA,
        Accept:            "application/json, text/plain, */*",
        "Accept-Language": "it-IT,it;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Referer:           `${ANAC_BASE}/superset/dashboard/appalti/`,
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Ch-Ua":         '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "Sec-Ch-Ua-Mobile":  "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest":    "empty",
        "Sec-Fetch-Mode":    "cors",
        "Sec-Fetch-Site":    "same-origin",
        ...(cookieString ? { Cookie: cookieString } : {}),
      },
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- undici dispatcher
      dispatcher: agent,
      signal: AbortSignal.timeout(12_000),
    })

    console.log("[ANAC-CSRF] CSRF status:", csrfRes.status)

    if (!csrfRes.ok) {
      const body = await csrfRes.text().catch(() => "")
      console.error("[ANAC-CSRF] CSRF error:", csrfRes.status, body.substring(0, 200))
      return null
    }

    const json = await csrfRes.json() as { result?: string }
    const csrf = json?.result

    if (!csrf) {
      console.error("[ANAC-CSRF] CSRF vuoto nella risposta")
      return null
    }

    _serverSession = { cookies: cookieString, csrf, expiresAt: now + 30 * 60_000 }
    console.log("[ANAC-CSRF] Sessione server ottenuta, csrf:", csrf.substring(0, 20))
    return _serverSession
  } catch (err) {
    console.error("[ANAC-CSRF] Errore:", err)
    return null
  }
}

export async function GET() {
  const session = await getServerSession()

  if (!session) {
    return NextResponse.json(
      { error: "Impossibile ottenere la sessione ANAC. Il WAF sta bloccando le richieste server-side." },
      { status: 503 },
    )
  }

  return NextResponse.json(
    { csrf: session.csrf, hasCookies: !!session.cookies },
    { headers: { "Cache-Control": "no-store" } },
  )
}

// Esporta la sessione server per uso interno dal proxy
export async function getAnacServerSession() {
  return getServerSession()
}
