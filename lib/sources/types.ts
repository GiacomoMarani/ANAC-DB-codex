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
  /** Codice paese ISO (IT, FR, EU, US, etc.) — disponibile per fonti multi-paese come Bandolo */
  country?: string | null
}

export type SourceKey =
  | "ted"
  | "anac"
  | "bandolo"
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
  // Sotto-fonti CATO scoperte 2026-09-02 (multi-page scan API):
  | "esercito_difesa"
  | "jaggaer"
  | "arpa_piemonte"
  | "cnr"
  | "metro_roma"
  | "comune_milano"
  // Sotto-fonti CATO scoperte 2026-09-02 (full sync 67K → Supabase DB):
  | "pvl_anac"
  | "acquistinretepa"
  | "portaletrasparenza"
  | "gdf_gov"
  | "veneto_cf"
  | "cultura"
  | "portaleappalti"
  | "contracta"
  | "traspare"
  | "aulss4veneto"
  | "infoplus"
  | "aslroma1"
  | "appaltiitalia"
  | "eni_proc"
  | "sisgap"
  // Sotto-fonti Bandolo (getbandolo.com — incentivi/finanziamenti):
  | "incentivi_gov"
  | "invitalia"
  | "inpa_gov"
  | "concorsipubblici"
  | "euraxess"
  | "ted_bandolo"
  | "untalent"
  // Fonti dirette internazionali (sync indipendente da Bandolo):
  | "boamp"
  | "contracts_finder"
  | "grants_gov"
  | "ec_funding"
  | "nih_reporter"

/** Label human-readable per ogni fonte */
export const SOURCE_LABELS: Record<SourceKey, string> = {
  ted:           "TED Europa",
  anac:          "ANAC",
  bandolo:       "Altre fonti",
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
  esercito_difesa:  "Esercito / Difesa",
  jaggaer:          "Jaggaer",
  arpa_piemonte:    "ARPA Piemonte",
  cnr:              "CNR",
  metro_roma:       "Metro Roma",
  comune_milano:    "Comune di Milano",
  pvl_anac:         "PVL ANAC",
  acquistinretepa:  "Acquisti in Rete PA",
  portaletrasparenza: "Portale Trasparenza",
  gdf_gov:          "Guardia di Finanza",
  veneto_cf:        "Veneto CF",
  cultura:          "Ministero Cultura",
  portaleappalti:   "Portale Appalti",
  contracta:        "Contracta",
  traspare:         "Traspare",
  aulss4veneto:     "AULSS4 Veneto",
  infoplus:         "InfoPlus",
  aslroma1:         "ASL Roma 1",
  appaltiitalia:    "Appalti Italia",
  eni_proc:         "ENI Procurement",
  sisgap:           "SISGAP",
  // Sotto-fonti Bandolo (incentivi / finanziamenti / concorsi):
  incentivi_gov:    "Incentivi.gov.it",
  invitalia:        "Invitalia",
  inpa_gov:         "InPA",
  concorsipubblici: "Concorsi Pubblici",
  euraxess:         "Euraxess",
  ted_bandolo:      "TED (incentivi)",
  untalent:         "Untalent",
  // Fonti dirette internazionali:
  boamp:            "BOAMP (Francia)",
  contracts_finder: "Contracts Finder (UK)",
  grants_gov:       "Grants.gov (USA)",
  ec_funding:       "EU Funding Portal",
  nih_reporter:     "NIH RePORTER",
}

/** Colori badge per ogni fonte (Tailwind-compatible) */
export const SOURCE_COLORS: Record<SourceKey, { bg: string; text: string; border: string }> = {
  ted:           { bg: "bg-blue-500/15",   text: "text-blue-700",   border: "border-blue-200" },
  anac:          { bg: "bg-indigo-500/15", text: "text-indigo-700", border: "border-indigo-200" },
  bandolo:       { bg: "bg-gray-400/15",   text: "text-gray-600",   border: "border-gray-200" },
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
  esercito_difesa:  { bg: "bg-red-600/15",     text: "text-red-800",     border: "border-red-300" },
  jaggaer:          { bg: "bg-blue-600/15",    text: "text-blue-800",    border: "border-blue-300" },
  arpa_piemonte:    { bg: "bg-green-600/15",   text: "text-green-800",   border: "border-green-300" },
  cnr:              { bg: "bg-indigo-600/15",  text: "text-indigo-800",  border: "border-indigo-300" },
  metro_roma:       { bg: "bg-orange-600/15",  text: "text-orange-800",  border: "border-orange-300" },
  comune_milano:    { bg: "bg-teal-600/15",    text: "text-teal-800",    border: "border-teal-300" },
  pvl_anac:         { bg: "bg-violet-600/15",  text: "text-violet-800",  border: "border-violet-300" },
  acquistinretepa:  { bg: "bg-cyan-600/15",    text: "text-cyan-800",    border: "border-cyan-300" },
  portaletrasparenza:{ bg: "bg-lime-600/15",   text: "text-lime-800",    border: "border-lime-300" },
  gdf_gov:          { bg: "bg-amber-600/15",   text: "text-amber-800",   border: "border-amber-300" },
  veneto_cf:        { bg: "bg-emerald-600/15", text: "text-emerald-800", border: "border-emerald-300" },
  cultura:          { bg: "bg-pink-600/15",    text: "text-pink-800",    border: "border-pink-300" },
  portaleappalti:   { bg: "bg-sky-600/15",     text: "text-sky-800",     border: "border-sky-300" },
  contracta:        { bg: "bg-fuchsia-600/15", text: "text-fuchsia-800", border: "border-fuchsia-300" },
  traspare:         { bg: "bg-rose-600/15",    text: "text-rose-800",    border: "border-rose-300" },
  aulss4veneto:     { bg: "bg-purple-600/15",  text: "text-purple-800",  border: "border-purple-300" },
  infoplus:         { bg: "bg-stone-600/15",   text: "text-stone-800",   border: "border-stone-300" },
  aslroma1:         { bg: "bg-yellow-600/15",  text: "text-yellow-800",  border: "border-yellow-300" },
  appaltiitalia:    { bg: "bg-zinc-600/15",    text: "text-zinc-800",    border: "border-zinc-300" },
  eni_proc:         { bg: "bg-slate-600/15",   text: "text-slate-800",   border: "border-slate-300" },
  sisgap:           { bg: "bg-red-500/15",     text: "text-red-700",     border: "border-red-200" },
  // Sotto-fonti Bandolo:
  incentivi_gov:    { bg: "bg-amber-500/15",   text: "text-amber-700",   border: "border-amber-200" },
  invitalia:        { bg: "bg-emerald-500/15", text: "text-emerald-700", border: "border-emerald-200" },
  inpa_gov:         { bg: "bg-sky-500/15",     text: "text-sky-700",     border: "border-sky-200" },
  concorsipubblici: { bg: "bg-violet-500/15",  text: "text-violet-700",  border: "border-violet-200" },
  euraxess:         { bg: "bg-cyan-600/15",    text: "text-cyan-800",    border: "border-cyan-300" },
  ted_bandolo:      { bg: "bg-blue-600/15",    text: "text-blue-800",    border: "border-blue-300" },
  untalent:         { bg: "bg-rose-500/15",    text: "text-rose-700",    border: "border-rose-200" },
  // Fonti dirette internazionali:
  boamp:            { bg: "bg-blue-500/15",    text: "text-blue-700",    border: "border-blue-200" },
  contracts_finder: { bg: "bg-red-500/15",     text: "text-red-700",     border: "border-red-200" },
  grants_gov:       { bg: "bg-indigo-500/15",  text: "text-indigo-700",  border: "border-indigo-200" },
  ec_funding:       { bg: "bg-yellow-500/15",  text: "text-yellow-700",  border: "border-yellow-200" },
  nih_reporter:     { bg: "bg-teal-500/15",    text: "text-teal-700",    border: "border-teal-200" },
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
  // Fallback: ricerca CIG sul portale pubblicità legale ANAC
  return `https://pubblicitalegale.anticorruzione.it/ricerca?cig=${encodeURIComponent(cig)}`
}

