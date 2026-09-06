// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/services/tedAwards.ts
 *
 * Servizio per il recupero live degli esiti e vincitori di gara tramite le API REST v3
 * di TED Europa (Tenders Electronic Daily - api.ted.europa.eu/v3).
 *
 * Consente di estrarre le gare vinte (Contract Award Notices - CAN) da un'operatore
 * economico, sia in Italia (sopra le soglie comunitarie) sia all'estero.
 */

const TED_API_BASE = "https://api.ted.europa.eu/v3"
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_RETRIES = 2

export interface TedAward {
  id: string
  publication_number: string
  cig: string | null
  denominazione: string | null
  oggetto_gara: string | null
  importo_aggiudicazione: number | null
  data_aggiudicazione: string | null
  codice_cpv: string | null
  descrizione_cpv: string | null
  provincia: string | null
  ruolo: string | null
  stazione_appaltante: string | null
  buyer_country: string | null
  source: "ted"
}

/**
 * Pulisce la ragione sociale per la ricerca a frase su TED.
 * Rimuove suffissi societari (S.p.A., S.r.l., ecc.) e caratteri speciali per massimizzare il matching.
 */
export function cleanCompanyNameForSearch(raw: string): string {
  if (!raw) return ""

  let cleaned = raw
    .replace(/[«»""''„“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // Rimuovi forme giuridiche italiane ed europee prima di rimuovere i punti
  const suffixes = [
    /\bS\.?\s*P\.?\s*A\.?\b/gi,
    /\bS\.?\s*R\.?\s*L\.?\b/gi,
    /\bS\.?\s*N\.?\s*C\.?\b/gi,
    /\bS\.?\s*A\.?\s*S\.?\b/gi,
    /\bS\.?\s*C\.?\s*A\.?\s*R\.?\s*L\.?\b/gi,
    /\bS\.?\s*C\.?\s*R\.?\s*L\.?\b/gi,
    /\bSOCIET[AÀ]\s+PER\s+AZIONI\b/gi,
    /\bSOCIET[AÀ]\s+A\s+RESPONSABILIT[AÀ]\s+LIMITATA\b/gi,
    /\bSOCIET[AÀ]\s+COOPERATIVA\b/gi,
    /\bCOOPERATIVA\s+SOCIALE\b/gi,
    /\bCOOP(?:\.|\b)/gi,
    /\bONLUS\b/gi,
    /\bCONSORZIO(?:\s+STABILE|\s+ORDINARIO)?\b/gi,
  ]

  for (const rx of suffixes) {
    cleaned = cleaned.replace(rx, " ")
  }

  // Rimuovi punteggiatura residua
  cleaned = cleaned
    .replace(/[–—\-_/\\()[\],.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // Se dopo la pulizia è troppo corta (< 3 caratteri), fallback alla stringa originaria sanitizzata
  if (cleaned.length < 3) {
    return raw.replace(/["\\]/g, "").trim()
  }

  return cleaned
}

/** Estrae un valore multilingua da un campo TED (priorità: ita > eng > fra > primo) */
function extractTedText(obj: unknown): string | null {
  if (!obj) return null
  if (typeof obj === "string") return obj.trim() || null
  if (Array.isArray(obj)) {
    const first = obj[0]
    return typeof first === "string" ? first.trim() || null : null
  }
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>
    const val = rec.ita ?? rec.eng ?? rec.fra ?? Object.values(rec)[0]
    if (typeof val === "string") return val.trim() || null
    if (Array.isArray(val) && typeof val[0] === "string") return val[0].trim() || null
  }
  return null
}

/** Estrae tutti i testi multilingua in un array di stringhe */
function extractTedStringArray(obj: unknown): string[] {
  if (!obj) return []
  if (typeof obj === "string") return [obj.trim()]
  if (Array.isArray(obj)) {
    return obj.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
  }
  if (typeof obj === "object") {
    const res: string[] = []
    for (const val of Object.values(obj as Record<string, unknown>)) {
      if (typeof val === "string") res.push(val.trim())
      else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string" && item.trim()) res.push(item.trim())
        }
      }
    }
    return res
  }
  return []
}

/**
 * Cerca un CIG italiano all'interno di un testo o identificativo.
 * Un CIG è un codice alfanumerico di 10 caratteri contenente sia cifre che lettere.
 */
export function extractCigFromText(text: string | null | undefined): string | null {
  if (!text) return null
  const cigRegex = /\b([0-9A-Z]{10})\b/gi
  const matches = text.match(cigRegex)
  if (!matches) return null

  for (const m of matches) {
    const upper = m.toUpperCase()
    // Deve contenere sia numeri che lettere (scarta parole alfabetiche tipo 'CONCEPTION' e numeri puri)
    if (!/\d/.test(upper) || !/[A-Z]/.test(upper)) continue
    if (/^(0000000000|XXXXXXXXXX|YYYYYYYYYY)$/.test(upper)) continue
    return upper
  }
  return null
}

/**
 * Interroga live TED API v3 per cercare le gare vinte (Contract Award Notices)
 * da una specifica azienda per nome o keyword.
 */
export async function lookupTedAwards(
  companyName: string,
  options?: {
    apiKey?: string
    timeoutMs?: number
    limit?: number
  }
): Promise<TedAward[]> {
  const cleanName = cleanCompanyNameForSearch(companyName)
  if (!cleanName || cleanName.length < 3) return []

  const apiKey = options?.apiKey ?? process.env.TED_API_KEY ?? ""
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const limit = options?.limit ?? 50

  // Query Expert Search di TED: cerca nei bandi di tipo aggiudicazione (CAN)
  // dove il vincitore contiene la frase del nome aziendale
  const escapedName = cleanName.replace(/["\\]/g, "")
  const query = `notice-type IN (can-standard, can-social, can-desg, can-tran) AND winner-name ~ "${escapedName}"`

  const fields = [
    "publication-number",
    "notice-type",
    "tender-identifier",
    "internal-identifier-lot",
    "winner-name",
    "winner-city",
    "winner-country",
    "buyer-name",
    "buyer-country",
    "total-value",
    "main-classification-proc",
    "publication-date",
    "title-lot",
    "title-proc",
  ]

  const payload = JSON.stringify({
    query,
    fields,
    limit,
  })

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "ANAC-DB-Codex/1.0",
      }
      if (apiKey) {
        headers["X-API-Key"] = apiKey
      }

      const res = await fetch(`${TED_API_BASE}/notices/search`, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }

      const data = await res.json()
      const notices = data.notices ?? []
      const results: TedAward[] = []

      for (const notice of notices) {
        const pubNum = notice["publication-number"]
        if (!pubNum) continue

        // Titolo
        const titleLot = extractTedText(notice["title-lot"])
        const titleProc = extractTedText(notice["title-proc"])
        const oggettoGara = titleLot || titleProc || `Appalto TED n. ${pubNum}`

        // CIG: cerca prima in tender-identifier, poi in internal-identifier-lot, poi nel titolo
        const tenderIds = extractTedStringArray(notice["tender-identifier"])
        const internalLots = extractTedStringArray(notice["internal-identifier-lot"])
        let extractedCig: string | null = null

        for (const idStr of [...tenderIds, ...internalLots]) {
          extractedCig = extractCigFromText(idStr)
          if (extractedCig) break
        }
        if (!extractedCig) {
          extractedCig = extractCigFromText(oggettoGara)
        }

        // Importo totale
        let importo: number | null = null
        const totalVal = notice["total-value"]
        if (typeof totalVal === "number" && !isNaN(totalVal)) {
          importo = totalVal
        } else if (typeof totalVal === "object" && totalVal != null) {
          const valObj = totalVal as { amount?: unknown; value?: unknown }
          const num = Number(valObj.amount ?? valObj.value)
          if (!isNaN(num) && num > 0) importo = num
        }

        // Data pubblicazione / aggiudicazione
        let dataPub: string | null = null
        if (notice["publication-date"]) {
          const rawDate = String(notice["publication-date"]).trim()
          dataPub = rawDate.replace(/\+\d{2}:\d{2}$/, "").replace(/Z$/, "").split("T")[0]
        }

        // CPV
        let cpvCode: string | null = null
        const cpvArr = extractTedStringArray(notice["main-classification-proc"])
        if (cpvArr.length > 0) {
          const cleanCpv = cpvArr[0].replace(/[^0-9]/g, "")
          if (cleanCpv.length >= 8) {
            cpvCode = cleanCpv.slice(0, 8)
          }
        }

        // Stazione appaltante
        const stazione = extractTedText(notice["buyer-name"])

        // Paese buyer
        const buyerCountries = extractTedStringArray(notice["buyer-country"])
        const buyerCountry = buyerCountries[0] || null

        // Città vincitore o provincia
        const winnerCities = extractTedStringArray(notice["winner-city"])
        const provincia = winnerCities[0] || buyerCountry || null

        // Nome vincitore confermato
        const winnerNames = extractTedStringArray(notice["winner-name"])
        const winnerName = winnerNames[0] || companyName

        results.push({
          id: `ted:${pubNum}`,
          publication_number: String(pubNum),
          cig: extractedCig,
          denominazione: winnerName,
          oggetto_gara: oggettoGara,
          importo_aggiudicazione: importo,
          data_aggiudicazione: dataPub,
          codice_cpv: cpvCode,
          descrizione_cpv: null,
          provincia,
          ruolo: "aggiudicatario (TED)",
          stazione_appaltante: stazione,
          buyer_country: buyerCountry,
          source: "ted",
        })
      }

      return results
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        // Pausa breve prima del retry in caso di disconnessione
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
    }
  }

  console.warn(`[TED Awards] Lookup failed for "${companyName}":`, lastError?.message)
  return []
}
