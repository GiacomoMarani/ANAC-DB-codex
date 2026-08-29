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
  // Sotto-fonti CATO scoperte via analisi diretta dell'API (devtools su get-cato.com/gare):
  // il valore usato qui è lo stesso valore raw restituito dal campo 'sources' di Cato,
  // così CATO_SOURCE_MAP (route.ts) non deve tradurlo.
  | "intercenter"
  | "sardegna"
  | "tuttogare"
  | "lazio_stella"
  | "estar"
  | "bolzano"
  | "digitalpa"
  | "abruzzo"
  | "net4market"
  | "acquedotto_fiora"
  | "empulia"
  | "soresa"
  | "efvg"

/** Label human-readable per ogni fonte */
export const SOURCE_LABELS: Record<SourceKey, string> = {
  ted:           "TED Europa",
  anac:          "ANAC",
  sintel:        "Sintel",
  mepa:          "MePA",
  start_toscana: "Start Toscana",
  halleyweb:     "Halley Web",
  place_vda:     "Valle d'Aosta",
  cato:          "ANAC",
  intercenter:      "Intercenter",
  sardegna:         "Sardegna CAT",
  tuttogare:        "TuttoGare",
  lazio_stella:     "Lazio (S.TEL.LA.)",
  estar:            "ESTAR Toscana",
  bolzano:          "Alto Adige",
  digitalpa:        "DigitalPA",
  abruzzo:          "Abruzzo",
  net4market:       "Net4Market",
  acquedotto_fiora: "Acquedotto del Fiora",
  empulia:          "EmPulia",
  soresa:           "SoReSa Campania",
  efvg:             "Friuli Venezia Giulia",
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
  intercenter:      { bg: "bg-cyan-500/15",    text: "text-cyan-700",    border: "border-cyan-200" },
  sardegna:         { bg: "bg-lime-500/15",    text: "text-lime-700",    border: "border-lime-200" },
  tuttogare:        { bg: "bg-pink-500/15",    text: "text-pink-700",    border: "border-pink-200" },
  lazio_stella:     { bg: "bg-amber-500/15",   text: "text-amber-700",   border: "border-amber-200" },
  estar:            { bg: "bg-emerald-500/15", text: "text-emerald-700", border: "border-emerald-200" },
  bolzano:          { bg: "bg-sky-500/15",     text: "text-sky-700",     border: "border-sky-200" },
  digitalpa:        { bg: "bg-fuchsia-500/15", text: "text-fuchsia-700", border: "border-fuchsia-200" },
  abruzzo:          { bg: "bg-rose-500/15",    text: "text-rose-700",    border: "border-rose-200" },
  net4market:       { bg: "bg-purple-500/15",  text: "text-purple-700",  border: "border-purple-200" },
  acquedotto_fiora: { bg: "bg-stone-500/15",   text: "text-stone-700",   border: "border-stone-200" },
  empulia:          { bg: "bg-yellow-500/15",  text: "text-yellow-700",  border: "border-yellow-200" },
  soresa:           { bg: "bg-zinc-500/15",    text: "text-zinc-700",    border: "border-zinc-200" },
  efvg:             { bg: "bg-slate-500/15",   text: "text-slate-700",   border: "border-slate-200" },
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
 * Altrimenti rimanda al portale dati aperti ANAC (dati.anticorruzione.it).
 */
export function buildAnacCigUrl(cig: string, anacIdAvviso?: string | null): string {
  if (anacIdAvviso) {
    return `https://pubblicitalegale.anticorruzione.it/bandi/${anacIdAvviso}?ricercaArchivio=false`
  }
  // Fallback: dettaglio CIG su portale dati aperti ANAC
  return `https://dettaglio-cig.anticorruzione.it/cig/${encodeURIComponent(cig)}`
}

