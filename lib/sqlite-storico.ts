// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * lib/sqlite-storico.ts — Query aggiudicatari storici dai DB SQLite locali
 *
 * Sostituisce lib/turso.ts.
 * Apre i 5 DB annuali (data/anac_YYYY.sqlite) e cerca per codice fiscale
 * in parallelo su tutti gli anni, poi unisce i risultati ordinati per data.
 *
 * Usa better-sqlite3 (sincrono, veloce ~1ms per query su indice).
 * I DB sono aperti come singleton in modalità readonly.
 */

import path from "path"

// Dynamic import di better-sqlite3 — è un modulo nativo, non disponibile in Edge Runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any = null

function getDatabase() {
  if (!Database) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Database = require("better-sqlite3")
    } catch {
      console.warn("[sqlite-storico] better-sqlite3 not available")
      return null
    }
  }
  return Database
}

// ─── Types (stessa interfaccia di turso.ts per compatibilità) ──────────────

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

// ─── Singleton DB pool ─────────────────────────────────────────────────────

const YEARS = [2022, 2023, 2024, 2025, 2026]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _dbPool: Map<number, any> = new Map()

function getDataDir(): string {
  // In produzione (Vercel), process.cwd() punta alla root del progetto
  return path.join(process.cwd(), "data")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openDb(year: number): any | null {
  if (_dbPool.has(year)) return _dbPool.get(year)

  const Db = getDatabase()
  if (!Db) return null

  const dbPath = path.join(getDataDir(), `anac_${year}.sqlite`)

  try {
    const db = new Db(dbPath, { readonly: true, fileMustExist: true })
    db.pragma("journal_mode = WAL")
    db.pragma("cache_size = -8000") // 8MB cache per DB
    _dbPool.set(year, db)
    return db
  } catch (err) {
    console.warn(`[sqlite-storico] Cannot open ${dbPath}:`, err)
    return null
  }
}

// ─── Query functions ───────────────────────────────────────────────────────

const QUERY_SQL = `
  SELECT cig, cod_fisc, denominazione, cod_cpv, oggetto_bando,
         importo_aggiudicazione, data_aggiudicazione, provincia,
         stazione_appaltante, tipo_contratto, sezione_regionale,
         settore, importo_lotto, ruolo, flag_pnrr
  FROM aggiudicatari
  WHERE cod_fisc = ?
  ORDER BY data_aggiudicazione DESC
  LIMIT 500
`

/**
 * Query aggiudicatari storico by codice fiscale / P.IVA.
 * Cerca in tutti i DB annuali e restituisce i risultati unificati.
 */
export async function queryAggiudicatariByFiscalCode(
  codFisc: string
): Promise<AggiudicatarioStorico[]> {
  const allResults: AggiudicatarioStorico[] = []

  for (const year of YEARS) {
    const db = openDb(year)
    if (!db) continue

    try {
      const rows = db.prepare(QUERY_SQL).all(codFisc) as AggiudicatarioStorico[]
      allResults.push(...rows)
    } catch (err) {
      console.error(`[sqlite-storico] Query error on ${year}:`, err)
    }
  }

  // Ordina per data decrescente e limita a 500 totali
  allResults.sort((a, b) => {
    if (!a.data_aggiudicazione && !b.data_aggiudicazione) return 0
    if (!a.data_aggiudicazione) return 1
    if (!b.data_aggiudicazione) return -1
    return b.data_aggiudicazione.localeCompare(a.data_aggiudicazione)
  })

  return allResults.slice(0, 500)
}

/**
 * Get total count of records across all yearly databases.
 */
export async function getAggiudicatariCount(): Promise<number> {
  let total = 0

  for (const year of YEARS) {
    const db = openDb(year)
    if (!db) continue

    try {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM aggiudicatari").get() as { cnt: number }
      total += row.cnt
    } catch {
      // skip
    }
  }

  return total
}

/**
 * Check if SQLite storico is available (at least one DB file exists).
 */
export function isStoricoAvailable(): boolean {
  return YEARS.some((year) => openDb(year) !== null)
}
