/**
 * lib/sources/types.ts
 * Schema comune per tutti gli adapter di fonte (TED, ANAC, Cato, ecc.)
 */

export interface NormalizedTender {
  /** ID univoco composto da fonte + id originale, es. "ted:123456" */
  id: string
  /** Codice CIG (o codice notice/procedure) */
  cig: string | null
  /** Oggetto/titolo della gara */
  oggetto: string | null
  /** Valore stimato in EUR */
  importo: number | null
  /** Stato: active | awarded | cancelled */
  stato: string | null
  /** Città/regione */
  provincia: string | null
  /** Data di pubblicazione ISO8601 */
  data_pubblicazione: string | null
  /** Data scadenza offerte ISO8601 */
  data_scadenza: string | null
  /** Categoria contratto: works | services | goods */
  tipo_contratto: string | null
  /** Codici CPV (stringa) */
  descrizione_cpv: string | null
  /** Chiave fonte: ted | anac | cato (principali) + sub-fonti CATO */
  sources: SourceKey
  /** URL originale del bando */
  link_originale: string | null
  /** Stazione appaltante */
  stazione_appaltante: string | null
}

export type SourceKey =
  | "ted"
  | "anac"
  | "sintel"
  | "mepa"
  | "start_toscana"
  | "halleyweb"
  | "place_vda"
  | "cato"

/** Label human-readable per ogni fonte */
export const SOURCE_LABELS: Record<SourceKey, string> = {
  ted:           "TED Europa",
  anac:          "ANAC",
  sintel:        "Sintel",
  mepa:          "MePA",
  start_toscana: "Start Toscana",
  halleyweb:     "Halley Web",
  place_vda:     "Valle d'Aosta",
  cato:          "CATO",
}

/** Colori badge per ogni fonte (Tailwind-compatible) */
export const SOURCE_COLORS: Record<SourceKey, { bg: string; text: string; border: string }> = {
  ted:           { bg: "bg-blue-500/15",   text: "text-blue-700",   border: "border-blue-200" },
  anac:          { bg: "bg-indigo-500/15", text: "text-indigo-700", border: "border-indigo-200" },
  sintel:        { bg: "bg-green-500/15",  text: "text-green-700",  border: "border-green-200" },
  mepa:          { bg: "bg-teal-500/15",   text: "text-teal-700",   border: "border-teal-200" },
  start_toscana: { bg: "bg-red-500/15",    text: "text-red-700",    border: "border-red-200" },
  halleyweb:     { bg: "bg-orange-500/15", text: "text-orange-700", border: "border-orange-200" },
  place_vda:     { bg: "bg-violet-500/15", text: "text-violet-700", border: "border-violet-200" },
  cato:          { bg: "bg-gray-500/15",   text: "text-gray-700",   border: "border-gray-200" },
}

export interface SourceResult {
  items: NormalizedTender[]
  total: number
  source: SourceKey
  error?: string
}

/**
 * Genera l'URL di dettaglio per un CIG sul portale ANAC.
 *
 * Se `anacIdAvviso` (UUID) è disponibile, genera un link diretto alla scheda:
 *   https://pubblicitalegale.anticorruzione.it/bandi/{uuid}
 *
 * Altrimenti rimanda alla pagina di ricerca avanzata.
 */
export function buildAnacCigUrl(cig: string, anacIdAvviso?: string | null): string {
  if (anacIdAvviso) {
    return `https://pubblicitalegale.anticorruzione.it/bandi/${anacIdAvviso}?ricercaArchivio=false`
  }
  return `https://pubblicitalegale.anticorruzione.it/bandi/ricerca?testoLibero=${encodeURIComponent(cig)}`
}

