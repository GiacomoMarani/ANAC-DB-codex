// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * lib/telemetry.ts — Telemetria passiva anti-copia
 *
 * Al primo avvio dell'applicazione, invia un ping silenzioso alla tabella
 * Supabase `telemetry_pings` con l'hostname del deployment. Questo permette
 * di rilevare deploy non autorizzati del codice.
 *
 * - Non raccoglie dati personali degli utenti
 * - Non impatta le performance (fire-and-forget)
 * - Si attiva solo in produzione (NODE_ENV === "production")
 * - Rispetta la AGPL: il codice è visibile e documentato
 */

const TELEMETRY_ENDPOINT = process.env.TELEMETRY_ENDPOINT ?? ""
const WATERMARK = "GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d"

let _pinged = false

export function telemetryPing() {
  // Solo in produzione, una volta sola, e solo se l'endpoint è configurato
  if (_pinged || process.env.NODE_ENV !== "production" || !TELEMETRY_ENDPOINT) return
  _pinged = true

  const payload = {
    watermark: WATERMARK,
    hostname: typeof window !== "undefined" ? window.location.hostname : process.env.VERCEL_URL ?? "unknown",
    version: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
  }

  try {
    // Fire-and-forget: scrive nella tabella telemetry_pings via REST API Supabase
    fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {}) // silenzioso
  } catch {
    // ignora qualsiasi errore
  }
}
