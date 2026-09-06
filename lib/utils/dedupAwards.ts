// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/utils/dedupAwards.ts
 *
 * Algoritmo di deduplicazione e merge a 3 livelli per gare vinte (Aggiudicatari).
 * Consente di unificare record provenienti da:
 *   - DB locale Supabase (`aggiudicatari`)
 *   - SCP/MIT (CKAN Datastore)
 *   - TED Europa API v3 (Contract Award Notices)
 *
 * Previene il doppio conteggio di gare e importi quando una gara sopra-soglia
 * è presente sia su SCP/ANAC che su TED.
 */

export interface BaseAward {
  id?: string | null
  codice_fiscale?: string | null
  denominazione: string | null
  cig: string | null
  importo_aggiudicazione: number | null
  data_aggiudicazione: string | null
  codice_cpv: string | null
  descrizione_cpv: string | null
  oggetto_gara: string | null
  provincia: string | null
  ruolo: string | null
  tipo_appalto?: string | null
  source?: "local" | "scp_mit" | "ted" | "merged"
}

export interface UnifiedAward extends BaseAward {
  cig: string
  source: "local" | "scp_mit" | "ted" | "merged"
}

/** Verifica se una stringa è un CIG standard valido (10 caratteri alfanumerici contenente sia numeri che lettere) */
export function isValidCig(cig: string | null | undefined): boolean {
  if (!cig) return false
  const clean = cig.trim().toUpperCase()
  return /^[0-9A-Z]{10}$/.test(clean) && /\d/.test(clean) && /[A-Z]/.test(clean)
}

/** Estrae le parole significative (>= 4 caratteri) da un titolo per il confronto */
function getSignificantTokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set()
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9àèéìòù]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
  )
}

/** Calcola l'indice di Jaccard tra due insiemi di parole */
function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union > 0 ? intersection / union : 0
}

/** Estrae l'anno da una stringa data (YYYY-MM-DD o ISO) */
function extractYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const match = dateStr.match(/^(\d{4})/)
  if (match) {
    const yr = parseInt(match[1], 10)
    if (yr >= 1990 && yr <= 2035) return yr
  }
  return null
}

/** Unisce i dati di un record duplicato preservando le informazioni più ricche */
function mergeAwardRecord(target: UnifiedAward, incoming: BaseAward): void {
  target.source = "merged"

  // Se incoming ha un CIG valido e target aveva solo un placeholder (es. ted:...), usa il CIG
  if (isValidCig(incoming.cig) && !isValidCig(target.cig)) {
    target.cig = incoming.cig!.toUpperCase().trim()
  }

  // Importo: usa quello non nullo / maggiore se c'è discordanza minima
  if (
    (target.importo_aggiudicazione == null || target.importo_aggiudicazione === 0) &&
    incoming.importo_aggiudicazione != null &&
    incoming.importo_aggiudicazione > 0
  ) {
    target.importo_aggiudicazione = incoming.importo_aggiudicazione
  }

  // CPV
  if (!target.codice_cpv && incoming.codice_cpv) {
    target.codice_cpv = incoming.codice_cpv
  }
  if (!target.descrizione_cpv && incoming.descrizione_cpv) {
    target.descrizione_cpv = incoming.descrizione_cpv
  }

  // Provincia / Luogo
  if (!target.provincia && incoming.provincia) {
    target.provincia = incoming.provincia
  }

  // Data aggiudicazione
  if (!target.data_aggiudicazione && incoming.data_aggiudicazione) {
    target.data_aggiudicazione = incoming.data_aggiudicazione
  }

  // Ruolo e tipo appalto
  if (!target.ruolo && incoming.ruolo) {
    target.ruolo = incoming.ruolo
  }
  if (!target.tipo_appalto && incoming.tipo_appalto) {
    target.tipo_appalto = incoming.tipo_appalto
  }
}

/**
 * Deduplica e fonde record di aggiudicazione da fonti eterogenee.
 *
 * Livello 1: CIG identico (10 caratteri alfanumerici)
 * Livello 2: Identificatore univoco (es. ted:367203-2024)
 * Livello 3: Fuzzy Heuristic (stesso anno, importo entro il 2%, similarità semantica del titolo >= 50%)
 */
export function deduplicateAwards(sources: {
  localAwards?: BaseAward[]
  scpAwards?: BaseAward[]
  tedAwards?: BaseAward[]
}): {
  deduped: UnifiedAward[]
  stats: {
    localCount: number
    scpCount: number
    tedCount: number
    duplicatesRemoved: number
    totalUnique: number
  }
} {
  const localList = sources.localAwards ?? []
  const scpList = sources.scpAwards ?? []
  const tedList = sources.tedAwards ?? []

  const deduped: UnifiedAward[] = []
  const cigIndex = new Map<string, UnifiedAward>()
  const idIndex = new Map<string, UnifiedAward>()

  let duplicatesRemoved = 0

  const allIncoming: Array<{ award: BaseAward; defaultSource: "local" | "scp_mit" | "ted" }> = [
    ...localList.map((a) => ({ award: a, defaultSource: "local" as const })),
    ...scpList.map((a) => ({ award: a, defaultSource: "scp_mit" as const })),
    ...tedList.map((a) => ({ award: a, defaultSource: "ted" as const })),
  ]

  for (const item of allIncoming) {
    const raw = item.award
    const source = (raw.source ?? item.defaultSource) as UnifiedAward["source"]

    const rawCig = raw.cig ? raw.cig.trim().toUpperCase() : null
    const validCig = isValidCig(rawCig) ? rawCig! : null
    const recordId = raw.id ? raw.id.trim() : null

    // ── LIVELLO 1: CIG Match ──────────────────────────────────────────────
    if (validCig && cigIndex.has(validCig)) {
      const existing = cigIndex.get(validCig)!
      mergeAwardRecord(existing, raw)
      duplicatesRemoved++
      continue
    }

    // ── LIVELLO 2: ID Match ───────────────────────────────────────────────
    if (recordId && idIndex.has(recordId)) {
      const existing = idIndex.get(recordId)!
      mergeAwardRecord(existing, raw)
      duplicatesRemoved++
      continue
    }

    // ── LIVELLO 3: Fuzzy Heuristic Match ──────────────────────────────────
    let isFuzzyDuplicate = false
    const incomingYear = extractYear(raw.data_aggiudicazione)
    const incomingAmount = Number(raw.importo_aggiudicazione) || 0
    const incomingTokens = getSignificantTokens(raw.oggetto_gara)

    if (incomingTokens.size > 0 && incomingAmount > 0) {
      for (const existing of deduped) {
        const existYear = extractYear(existing.data_aggiudicazione)
        const existAmount = Number(existing.importo_aggiudicazione) || 0

        // Se l'anno è noto in entrambi e non coincide, non sono la stessa gara
        if (incomingYear && existYear && incomingYear !== existYear) {
          continue
        }

        // Se entrambi hanno un importo positivo, controlla la differenza relativa (< 2.5%)
        if (existAmount > 0) {
          const diff = Math.abs(incomingAmount - existAmount)
          const maxVal = Math.max(incomingAmount, existAmount)
          if (diff / maxVal > 0.025) {
            continue
          }
        }

        // Similarità lessicale del titolo della gara
        const existTokens = getSignificantTokens(existing.oggetto_gara)
        const similarity = computeJaccardSimilarity(incomingTokens, existTokens)

        if (similarity >= 0.5) {
          mergeAwardRecord(existing, raw)
          isFuzzyDuplicate = true
          duplicatesRemoved++
          break
        }
      }
    }

    if (isFuzzyDuplicate) continue

    // Record nuovo e univoco
    const fallbackCig = validCig ?? recordId ?? (rawCig ? rawCig : `award:${deduped.length + 1}`)
    const newAward: UnifiedAward = {
      ...raw,
      cig: fallbackCig,
      source,
    }

    deduped.push(newAward)

    if (validCig) {
      cigIndex.set(validCig, newAward)
    }
    if (recordId) {
      idIndex.set(recordId, newAward)
    }
  }

  return {
    deduped,
    stats: {
      localCount: localList.length,
      scpCount: scpList.length,
      tedCount: tedList.length,
      duplicatesRemoved,
      totalUnique: deduped.length,
    },
  }
}
