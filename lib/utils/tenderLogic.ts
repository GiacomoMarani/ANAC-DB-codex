// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
import { isBefore, parseISO, isValid } from "date-fns"

export const TERMINAL_STATES = [
  "CONCLUSO",
  "AGGIUDICATO",
  "ANNULLATO",
  "REVOCATO",
  "INTERROTTO",
  "AGGIUDICATA", // Sometimes ANAC data uses feminine forms
  "CONCLUSA",
  "REVOCATA",
  "ANNULLATA"
]

export interface CigRecord {
  cig: string
  oggetto_gara?: string | null
  importo_lotto?: number | null
  oggetto_principale_contratto?: string | null
  stato?: string | null
  provincia?: string | null
  data_pubblicazione?: string | null
  data_scadenza_offerta?: string | null
  sezione_regionale?: string | null
  descrizione_cpv?: string | null
  esito?: string | null
}

export function isActiveTender(record: Partial<CigRecord>): boolean {
  // 1. Terminal state check
  if (record.stato) {
    const statoUpper = record.stato.toUpperCase().trim()
    if (TERMINAL_STATES.some(state => statoUpper.includes(state))) {
      return false // Exclude terminal states
    }
  }

  // 2. Expiration date check
  if (record.data_scadenza_offerta) {
    try {
      const expirationDate = parseISO(record.data_scadenza_offerta)
      const now = new Date()

      // If the expiration date is strictly valid and it occurred before today, it is NOT active
      if (isValid(expirationDate) && isBefore(expirationDate, now)) {
        return false
      }
    } catch {
      // If the date is malformed, we fall back to the state check returning true
    }
  }

  // If it's not a terminal state and hasn't explicitly expired, keep it
  return true
}
