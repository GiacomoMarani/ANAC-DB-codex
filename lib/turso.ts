// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

import { createClient, type Client } from "@libsql/client"

let _client: Client | null = null

/**
 * Singleton Turso (libSQL) client.
 * Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from env.
 * Returns null if env vars are missing (graceful fallback).
 */
export function getTursoClient(): Client | null {
  if (_client) return _client

  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (!url) {
    console.warn("[turso] TURSO_DATABASE_URL not set — Turso disabled")
    return null
  }

  _client = createClient({
    url,
    authToken: authToken || undefined,
  })

  return _client
}

/**
 * Query aggiudicatari storico by codice fiscale / P.IVA.
 * Returns empty array if Turso is not configured.
 */
export async function queryAggiudicatariByFiscalCode(
  codFisc: string
): Promise<AggiudicatarioStorico[]> {
  const client = getTursoClient()
  if (!client) return []

  try {
    const result = await client.execute({
      sql: `SELECT cig, cod_fisc, denominazione, cod_cpv, oggetto_bando,
                   importo_aggiudicazione, data_aggiudicazione, provincia,
                   stazione_appaltante, tipo_contratto, sezione_regionale,
                   settore, importo_lotto, ruolo, flag_pnrr
            FROM aggiudicatari_storico
            WHERE cod_fisc = ?
            ORDER BY data_aggiudicazione DESC
            LIMIT 500`,
      args: [codFisc],
    })

    return result.rows.map((row) => ({
      cig: String(row.cig ?? ""),
      cod_fisc: String(row.cod_fisc ?? ""),
      denominazione: row.denominazione ? String(row.denominazione) : null,
      cod_cpv: row.cod_cpv ? String(row.cod_cpv) : null,
      oggetto_bando: row.oggetto_bando ? String(row.oggetto_bando) : null,
      importo_aggiudicazione: row.importo_aggiudicazione
        ? Number(row.importo_aggiudicazione)
        : null,
      data_aggiudicazione: row.data_aggiudicazione
        ? String(row.data_aggiudicazione)
        : null,
      provincia: row.provincia ? String(row.provincia) : null,
      stazione_appaltante: row.stazione_appaltante
        ? String(row.stazione_appaltante)
        : null,
      tipo_contratto: row.tipo_contratto ? String(row.tipo_contratto) : null,
      sezione_regionale: row.sezione_regionale
        ? String(row.sezione_regionale)
        : null,
      settore: row.settore ? String(row.settore) : null,
      importo_lotto: row.importo_lotto ? Number(row.importo_lotto) : null,
      ruolo: row.ruolo ? String(row.ruolo) : null,
      flag_pnrr: row.flag_pnrr ? String(row.flag_pnrr) : null,
    }))
  } catch (err) {
    console.error("[turso] Query error:", err)
    return []
  }
}

/**
 * Get count of records in aggiudicatari_storico.
 */
export async function getAggiudicatariCount(): Promise<number> {
  const client = getTursoClient()
  if (!client) return 0

  try {
    const result = await client.execute(
      "SELECT COUNT(*) as cnt FROM aggiudicatari_storico"
    )
    return Number(result.rows[0]?.cnt ?? 0)
  } catch {
    return 0
  }
}

export interface AggiudicatarioStorico {
  cig: string
  cod_fisc: string
  denominazione: string | null
  cod_cpv: string | null
  oggetto_bando: string | null
  importo_aggiudicazione: number | null
  data_aggiudicazione: string | null
  provincia: string | null
  stazione_appaltante: string | null
  tipo_contratto: string | null
  sezione_regionale: string | null
  settore: string | null
  importo_lotto: number | null
  ruolo: string | null
  flag_pnrr: string | null
}
