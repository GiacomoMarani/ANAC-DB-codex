/**
 * lib/utils/vies.ts
 *
 * Integrazione con il servizio VIES (VAT Information Exchange System)
 * della Commissione Europea per la validazione e il lookup delle P.IVA.
 *
 * Endpoint gratuito, nessuna registrazione richiesta.
 * Rate limit: ~100 req/min (non documentato ufficialmente).
 *
 * @see https://ec.europa.eu/taxation_customs/vies/
 */

const VIES_BASE = "https://ec.europa.eu/taxation_customs/vies/rest-api"
const VIES_TIMEOUT_MS = 5_000 // 5 secondi — non rallentare la profilazione

export interface ViesResult {
  /** P.IVA valida secondo VIES */
  isValid: boolean
  /** Ragione sociale (può essere null per alcune P.IVA italiane) */
  name: string | null
  /** Indirizzo registrato (formato libero, es. "VIA ROMA 1 - 00100 ROMA RM") */
  address: string | null
  /** Sede estratta dall'indirizzo (provincia/città) */
  sede: string | null
  /** Regione stimata dalla provincia nell'indirizzo */
  regione: string | null
}

/**
 * Interroga il servizio VIES per ottenere ragione sociale e indirizzo
 * a partire da una Partita IVA italiana.
 *
 * Non lancia eccezioni: ritorna un risultato con `isValid: false` in caso di errore.
 */
export async function lookupVies(partitaIva: string): Promise<ViesResult> {
  const fallback: ViesResult = {
    isValid: false,
    name: null,
    address: null,
    sede: null,
    regione: null,
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VIES_TIMEOUT_MS)

    const res = await fetch(
      `${VIES_BASE}/ms/IT/vat/${partitaIva}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "TenderAIDB/1.0",
        },
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)

    if (!res.ok) {
      console.warn(`[VIES] HTTP ${res.status} for P.IVA ${partitaIva}`)
      return fallback
    }

    const data = await res.json()

    // VIES response shape:
    // { isValid: boolean, requestDate: string, userError: string,
    //   name: string, address: string, requestIdentifier: string }

    if (!data.isValid) {
      return { ...fallback, isValid: false }
    }

    const name = cleanViesField(data.name)
    const address = cleanViesField(data.address)
    const parsed = parseViesAddress(address)

    return {
      isValid: true,
      name,
      address,
      sede: parsed.sede,
      regione: parsed.regione,
    }
  } catch (err) {
    // Timeout, network error, etc. — non-blocking
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[VIES] Lookup failed for P.IVA ${partitaIva}: ${msg}`)
    return fallback
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Pulisce i campi VIES (rimuove "---" e stringhe vuote) */
function cleanViesField(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s || s === "---" || s === "N/A") return null
  return s
}

/**
 * Analizza l'indirizzo VIES per estrarre provincia e regione.
 *
 * Formati tipici per l'Italia:
 * - "VIA ROMA 1 - 00100 ROMA RM"
 * - "VIA GARIBALDI 5\n20100 MILANO MI"
 * - "PIAZZA DUOMO 1 50122 FIRENZE FI"
 */
function parseViesAddress(address: string | null): {
  sede: string | null
  regione: string | null
} {
  if (!address) return { sede: null, regione: null }

  // Cerca il pattern: CAP (5 cifre) + CITTÀ + SIGLA PROVINCIA (2 lettere)
  const match = address.match(/\b\d{5}\s+([A-Z\s']+?)\s+([A-Z]{2})\s*$/i)
  if (match) {
    const citta = match[1].trim()
    const sigla = match[2].toUpperCase()
    const regione = siglaToRegione(sigla)
    return {
      sede: citta || sigla,
      regione,
    }
  }

  // Fallback: cerca solo la sigla provincia alla fine
  const siglaMatch = address.match(/\b([A-Z]{2})\s*$/i)
  if (siglaMatch) {
    const sigla = siglaMatch[1].toUpperCase()
    return {
      sede: sigla,
      regione: siglaToRegione(sigla),
    }
  }

  return { sede: null, regione: null }
}

/** Mapping sigla provincia → regione */
function siglaToRegione(sigla: string): string | null {
  const map: Record<string, string> = {
    // Piemonte
    TO: "Piemonte", VC: "Piemonte", NO: "Piemonte", CN: "Piemonte",
    AT: "Piemonte", AL: "Piemonte", BI: "Piemonte", VB: "Piemonte",
    // Valle d'Aosta
    AO: "Valle d'Aosta",
    // Lombardia
    MI: "Lombardia", VA: "Lombardia", CO: "Lombardia", SO: "Lombardia",
    BG: "Lombardia", BS: "Lombardia", PV: "Lombardia", CR: "Lombardia",
    MN: "Lombardia", LC: "Lombardia", LO: "Lombardia", MB: "Lombardia",
    // Trentino-Alto Adige
    BZ: "Trentino-Alto Adige", TN: "Trentino-Alto Adige",
    // Veneto
    VR: "Veneto", VI: "Veneto", BL: "Veneto", TV: "Veneto",
    VE: "Veneto", PD: "Veneto", RO: "Veneto",
    // Friuli-Venezia Giulia
    UD: "Friuli-Venezia Giulia", GO: "Friuli-Venezia Giulia",
    TS: "Friuli-Venezia Giulia", PN: "Friuli-Venezia Giulia",
    // Liguria
    IM: "Liguria", SV: "Liguria", GE: "Liguria", SP: "Liguria",
    // Emilia-Romagna
    PC: "Emilia-Romagna", PR: "Emilia-Romagna", RE: "Emilia-Romagna",
    MO: "Emilia-Romagna", BO: "Emilia-Romagna", FE: "Emilia-Romagna",
    RA: "Emilia-Romagna", FC: "Emilia-Romagna", RN: "Emilia-Romagna",
    // Toscana
    MS: "Toscana", LU: "Toscana", PT: "Toscana", FI: "Toscana",
    LI: "Toscana", PI: "Toscana", AR: "Toscana", SI: "Toscana",
    GR: "Toscana", PO: "Toscana",
    // Umbria
    PG: "Umbria", TR: "Umbria",
    // Marche
    PU: "Marche", AN: "Marche", MC: "Marche", AP: "Marche", FM: "Marche",
    // Lazio
    VT: "Lazio", RI: "Lazio", RM: "Lazio", LT: "Lazio", FR: "Lazio",
    // Abruzzo
    AQ: "Abruzzo", TE: "Abruzzo", PE: "Abruzzo", CH: "Abruzzo",
    // Molise
    CB: "Molise", IS: "Molise",
    // Campania
    CE: "Campania", BN: "Campania", NA: "Campania", AV: "Campania", SA: "Campania",
    // Puglia
    FG: "Puglia", BA: "Puglia", TA: "Puglia", BR: "Puglia", LE: "Puglia", BT: "Puglia",
    // Basilicata
    PZ: "Basilicata", MT: "Basilicata",
    // Calabria
    CS: "Calabria", CZ: "Calabria", KR: "Calabria", VV: "Calabria", RC: "Calabria",
    // Sicilia
    TP: "Sicilia", PA: "Sicilia", ME: "Sicilia", AG: "Sicilia",
    CL: "Sicilia", EN: "Sicilia", CT: "Sicilia", RG: "Sicilia", SR: "Sicilia",
    // Sardegna
    SS: "Sardegna", NU: "Sardegna", CA: "Sardegna", OR: "Sardegna", SU: "Sardegna",
  }
  return map[sigla] || null
}
