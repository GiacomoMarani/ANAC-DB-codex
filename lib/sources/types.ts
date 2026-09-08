// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/sources/types.ts
 * Schema comune per tutti gli adapter di fonte (TED, ANAC, ITA, ecc.)
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
  /** Chiave fonte: ted | anac | ita (principali) + sub-fonti ITA */
  sources: SourceKey
  /** URL originale del bando */
  link_originale: string | null
  /** Stazione appaltante */
  stazione_appaltante: string | null
  /** Codice paese ISO (IT, FR, EU, US, etc.) — disponibile per fonti multi-paese come INTL */
  country?: string | null
}

export type SourceKey =
  | "ted"
  | "anac"
  | "intl"
  | "sintel"
  | "mepa"
  | "start_toscana"
  | "halleyweb"
  | "place_vda"
  | "ita"
  // Sotto-fonti ITA scoperte via analisi diretta dell'API (devtools su get-cato.com/gare):
  // il valore usato qui è lo stesso valore raw restituito dal campo 'sources' di ITA,
  // così ITA_SOURCE_MAP (route.ts) non deve tradurlo.
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
  // Sotto-fonti ITA scoperte 2026-09-02 (multi-page scan API):
  | "esercito_difesa"
  | "jaggaer"
  | "arpa_piemonte"
  | "cnr"
  | "metro_roma"
  | "comune_milano"
  // Sotto-fonti ITA scoperte 2026-09-02 (full sync 67K → Supabase DB):
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
  // Sotto-fonti ITA scoperte 2026-09-08 (full DB scan — 36 fonti aggiuntive):
  | "sestosangiovanni"
  | "acquistionlinerfi"
  | "aslto3"
  | "roga"
  | "consorzioit"
  | "sardegna_regione"
  | "eutalia"
  | "docsuite"
  | "gruppocap"
  | "onaosi"
  | "urbi"
  | "pleiade"
  | "bibbiena"
  | "aspcrotone"
  | "umbria"
  | "ats_lombardia"
  | "roma"
  | "gomrc"
  | "aressardegna"
  | "telemat"
  | "posteprocurement"
  | "provincia_treviso"
  | "crocerossa"
  | "mit"
  | "asp_reggio_calabria"
  | "sacile"
  | "cuc_molise"
  | "ats_milano"
  | "rfi"
  | "proq"
  | "aulss1dolomiti"
  | "sicilia"
  | "asst_fbf_sacco"
  | "marche"
  | "sua_rb"
  | "aslroma2"
  | "leonardo"
  | "unict"
  // Fonti dirette internazionali (sync scripts dedicati):
  | "boamp"
  | "contracts_finder"
  | "grants_gov"
  | "ec_funding"

/** Label human-readable per ogni fonte */
export const SOURCE_LABELS: Record<SourceKey, string> = {
  ted:           "TED Europa",
  anac:          "ANAC",
  intl:          "Altre fonti",
  sintel:        "Sintel",
  mepa:          "MePA",
  start_toscana: "Start Toscana",
  halleyweb:     "Halley Web",
  place_vda:     "Valle d'Aosta",
  ita:           "ANAC",
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
  // Sotto-fonti 2026-09-08:
  sestosangiovanni:   "Sesto San Giovanni",
  acquistionlinerfi:  "Acquisti Online RFI",
  aslto3:             "ASL TO3 Torino",
  roga:               "ROGA",
  consorzioit:        "Consorzio.IT",
  sardegna_regione:   "Regione Sardegna",
  eutalia:            "Eutalia",
  docsuite:           "DocSuite",
  gruppocap:          "Gruppo CAP",
  onaosi:             "ONAOSI",
  urbi:               "URBI",
  pleiade:            "Pleiade",
  bibbiena:           "Comune di Bibbiena",
  aspcrotone:         "ASP Crotone",
  umbria:             "Umbria",
  ats_lombardia:      "ATS Lombardia",
  roma:               "Roma Capitale",
  gomrc:              "GOMRC",
  aressardegna:       "ARES Sardegna",
  telemat:            "Telemat",
  posteprocurement:   "Poste Procurement",
  provincia_treviso:  "Provincia di Treviso",
  crocerossa:         "Croce Rossa Italiana",
  mit:                "MIT Infrastrutture",
  asp_reggio_calabria: "ASP Reggio Calabria",
  sacile:             "Comune di Sacile",
  cuc_molise:         "CUC Molise",
  ats_milano:         "ATS Milano",
  rfi:                "RFI (Rete Ferroviaria)",
  proq:               "ProQ",
  aulss1dolomiti:     "AULSS1 Dolomiti",
  sicilia:            "Sicilia",
  asst_fbf_sacco:     "ASST FBF Sacco",
  marche:             "Marche",
  sua_rb:             "SUA RB",
  aslroma2:           "ASL Roma 2",
  leonardo:           "Leonardo S.p.A.",
  unict:              "Università di Catania",
  // Fonti dirette internazionali:
  boamp:            "BOAMP (Francia)",
  contracts_finder: "Contracts Finder (UK)",
  grants_gov:       "Grants.gov (USA)",
  ec_funding:       "EU Funding Portal",
}

/** Colori badge per ogni fonte (Tailwind-compatible) */
export const SOURCE_COLORS: Record<SourceKey, { bg: string; text: string; border: string }> = {
  ted:           { bg: "bg-blue-500/15",   text: "text-blue-700",   border: "border-blue-200" },
  anac:          { bg: "bg-indigo-500/15", text: "text-indigo-700", border: "border-indigo-200" },
  intl:          { bg: "bg-gray-400/15",   text: "text-gray-600",   border: "border-gray-200" },
  sintel:        { bg: "bg-green-500/15",  text: "text-green-700",  border: "border-green-200" },
  mepa:          { bg: "bg-teal-500/15",   text: "text-teal-700",   border: "border-teal-200" },
  start_toscana: { bg: "bg-red-500/15",    text: "text-red-700",    border: "border-red-200" },
  halleyweb:     { bg: "bg-orange-500/15", text: "text-orange-700", border: "border-orange-200" },
  place_vda:     { bg: "bg-violet-500/15", text: "text-violet-700", border: "border-violet-200" },
  ita:           { bg: "bg-gray-500/15",   text: "text-gray-700",   border: "border-gray-200" },
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
  // Sotto-fonti 2026-09-08:
  sestosangiovanni:   { bg: "bg-blue-400/15",    text: "text-blue-600",    border: "border-blue-200" },
  acquistionlinerfi:  { bg: "bg-green-400/15",   text: "text-green-600",   border: "border-green-200" },
  aslto3:             { bg: "bg-teal-400/15",    text: "text-teal-600",    border: "border-teal-200" },
  roga:               { bg: "bg-orange-400/15",  text: "text-orange-600",  border: "border-orange-200" },
  consorzioit:        { bg: "bg-indigo-400/15",  text: "text-indigo-600",  border: "border-indigo-200" },
  sardegna_regione:   { bg: "bg-lime-400/15",    text: "text-lime-600",    border: "border-lime-200" },
  eutalia:            { bg: "bg-violet-400/15",  text: "text-violet-600",  border: "border-violet-200" },
  docsuite:           { bg: "bg-cyan-400/15",    text: "text-cyan-600",    border: "border-cyan-200" },
  gruppocap:          { bg: "bg-sky-400/15",     text: "text-sky-600",     border: "border-sky-200" },
  onaosi:             { bg: "bg-amber-400/15",   text: "text-amber-600",   border: "border-amber-200" },
  urbi:               { bg: "bg-pink-400/15",    text: "text-pink-600",    border: "border-pink-200" },
  pleiade:            { bg: "bg-fuchsia-400/15", text: "text-fuchsia-600", border: "border-fuchsia-200" },
  bibbiena:           { bg: "bg-emerald-400/15", text: "text-emerald-600", border: "border-emerald-200" },
  aspcrotone:         { bg: "bg-rose-400/15",    text: "text-rose-600",    border: "border-rose-200" },
  umbria:             { bg: "bg-purple-400/15",  text: "text-purple-600",  border: "border-purple-200" },
  ats_lombardia:      { bg: "bg-red-400/15",     text: "text-red-600",     border: "border-red-200" },
  roma:               { bg: "bg-yellow-400/15",  text: "text-yellow-600",  border: "border-yellow-200" },
  gomrc:              { bg: "bg-stone-400/15",   text: "text-stone-600",   border: "border-stone-200" },
  aressardegna:       { bg: "bg-slate-400/15",   text: "text-slate-600",   border: "border-slate-200" },
  telemat:            { bg: "bg-zinc-400/15",    text: "text-zinc-600",    border: "border-zinc-200" },
  posteprocurement:   { bg: "bg-blue-700/15",    text: "text-blue-900",    border: "border-blue-400" },
  provincia_treviso:  { bg: "bg-green-700/15",   text: "text-green-900",   border: "border-green-400" },
  crocerossa:         { bg: "bg-red-700/15",     text: "text-red-900",     border: "border-red-400" },
  mit:                { bg: "bg-indigo-700/15",  text: "text-indigo-900",  border: "border-indigo-400" },
  asp_reggio_calabria:{ bg: "bg-orange-700/15",  text: "text-orange-900",  border: "border-orange-400" },
  sacile:             { bg: "bg-teal-700/15",    text: "text-teal-900",    border: "border-teal-400" },
  cuc_molise:         { bg: "bg-violet-700/15",  text: "text-violet-900",  border: "border-violet-400" },
  ats_milano:         { bg: "bg-cyan-700/15",    text: "text-cyan-900",    border: "border-cyan-400" },
  rfi:                { bg: "bg-amber-700/15",   text: "text-amber-900",   border: "border-amber-400" },
  proq:               { bg: "bg-lime-700/15",    text: "text-lime-900",    border: "border-lime-400" },
  aulss1dolomiti:     { bg: "bg-sky-700/15",     text: "text-sky-900",     border: "border-sky-400" },
  sicilia:            { bg: "bg-pink-700/15",    text: "text-pink-900",    border: "border-pink-400" },
  asst_fbf_sacco:     { bg: "bg-fuchsia-700/15", text: "text-fuchsia-900", border: "border-fuchsia-400" },
  marche:             { bg: "bg-emerald-700/15", text: "text-emerald-900", border: "border-emerald-400" },
  sua_rb:             { bg: "bg-rose-700/15",    text: "text-rose-900",    border: "border-rose-400" },
  aslroma2:           { bg: "bg-purple-700/15",  text: "text-purple-900",  border: "border-purple-400" },
  leonardo:           { bg: "bg-stone-700/15",   text: "text-stone-900",   border: "border-stone-400" },
  unict:              { bg: "bg-yellow-700/15",  text: "text-yellow-900",  border: "border-yellow-400" },
  // Fonti dirette internazionali:
  boamp:            { bg: "bg-blue-500/15",    text: "text-blue-700",    border: "border-blue-200" },
  contracts_finder: { bg: "bg-red-500/15",     text: "text-red-700",     border: "border-red-200" },
  grants_gov:       { bg: "bg-indigo-500/15",  text: "text-indigo-700",  border: "border-indigo-200" },
  ec_funding:       { bg: "bg-yellow-500/15",  text: "text-yellow-700",  border: "border-yellow-200" },
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
