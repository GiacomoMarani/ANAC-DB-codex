/**
 * lib/sources/cato.ts
 * Adapter Cato (www.get-cato.com/api/tenders)
 *
 * NOTA: l'API Cato non supporta un filtro "fonte" lato server — un parametro
 * `source` (in qualunque valore, anche inventato) viene ignorato silenziosamente
 * e restituisce sempre lo stesso set di risultati (verificato via devtools su
 * get-cato.com/gare, che infatti non espone alcun filtro "Fonte" in UI).
 * Il filtro per fonte qui sotto è quindi applicato client-side dopo il fetch
 * (vedi fetchCato) — ogni pagina Cato restituisce comunque sempre 10 item grezzi
 * (nessun parametro di page-size ha effetto), quindi con il filtro attivo
 * alcune pagine possono risultare vuote/parziali.
 * Parametri nativi verificati: q (full-text), tp (tipo_procedura, match esatto),
 * min/max (importo), days (scadenza in giorni), p (pagina).
 */

import type { NormalizedTender, SourceKey, SourceResult } from "./types"

const CATO_BASE = "https://www.get-cato.com/api/tenders"

/**
 * Mappa fasce importo → parametri min/max numerici in euro
 * (CATO usa ?min=150000&max=1000000, NON la stringa label)
 */
const IMPORTO_TO_MINMAX: Record<string, { min?: number; max?: number }> = {
  "< €40.000":    { max: 40_000 },
  "€40k – €150k": { min: 40_000,   max: 150_000 },
  "€150k – €1M":  { min: 150_000,  max: 1_000_000 },
  "€1M – €5M":    { min: 1_000_000, max: 5_000_000 },
  "> €5M":        { min: 5_000_000 },
}

/**
 * Mappa tipo contratto → valori accettati da CATO
 * (dall'ispezione dei select del portale get-cato.com/gare)
 */
const TIPO_TO_CATO: Record<string, string> = {
  goods:    "Forniture",
  services: "Servizi",
  works:    "Lavori pubblici",
}

export interface CatoFetchParams {
  q?:        string
  page?:     number
  pageSize?: number
  importo?:  string
  scadenza?: string
  pubblicazione?: string
  tipo?:     string
  /** Fonte specifica (valore raw del campo 'sources' Cato, es. "sintel"): filtrato
   *  client-side, l'API Cato non lo supporta lato server (vedi header file) */
  source?:   string
}

function getPublicationCutoff(value: string): Date | null {
  const match = value.trim().toLowerCase().match(/^(\d+)(h|d)?$/)
  if (!match) return null

  const amount = Number.parseInt(match[1], 10)
  const unit = match[2] ?? "d"
  if (!Number.isFinite(amount) || amount <= 0) return null

  const cutoff = new Date()
  if (unit === "h") {
    cutoff.setHours(cutoff.getHours() - amount)
  } else {
    cutoff.setDate(cutoff.getDate() - amount)
  }

  return cutoff
}

/** Converte "DD/MM/YYYY" / "DD/MM/YYYY HH:mm" (italiano) o ISO in "YYYY-MM-DD" */
function parseCatoDate(raw: unknown): string | null {
  if (!raw) return null
  const dmyMatch = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`
  }
  return String(raw).split('T')[0] // già ISO
}

function isPublishedSince(value: string | null, cutoff: Date, now = new Date()): boolean {
  if (!value) return false
  const text = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const dayStart = new Date(`${text}T00:00:00`).getTime()
    const dayEnd = new Date(`${text}T23:59:59.999`).getTime()
    return !Number.isNaN(dayStart) && !Number.isNaN(dayEnd) && dayEnd >= cutoff.getTime() && dayStart <= now.getTime()
  }

  const publishedAt = new Date(text).getTime()
  return !Number.isNaN(publishedAt) && publishedAt >= cutoff.getTime() && publishedAt <= now.getTime()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCatoItem(item: any, defaultSource: SourceKey): NormalizedTender {
  const info = item.extracted_main_info ?? {}
  const src  = (item.sources ?? item.source ?? defaultSource) as SourceKey

  // Oggetto: Cato usa 'oggetto' (non 'title')
  const oggetto = item.oggetto ?? info.oggetto ?? item.title ?? null

  // Data scadenza: campo diretto o nested in extracted_main_info.date
  const scadenzaRaw =
    item.data_scadenza ??
    info.date?.termine_presentazione_offerte ??
    info.data_scadenza ??
    info.scadenza ??
    item.data_scadenza_offerta ??
    null
  const data_scadenza = parseCatoDate(scadenzaRaw)

  // Data pubblicazione: info.date.pubblicazione è la data REALE del bando (può essere anche
  // molto nel passato). item.created_at è invece la data di ingestion nel DB di Cato — usarla
  // come pubblicazione farebbe apparire "nuovi" bandi vecchi di mesi/anni. Fallback su created_at
  // solo quando la data reale non è disponibile.
  const data_pubblicazione = parseCatoDate(info.date?.pubblicazione) ?? item.created_at ?? null

  // Link: Cato usa 'link_web' come URL diretto alla fonte
  const link = item.link_web ?? item.original_url ?? item.link_originale ?? null

  // Importo
  const importoRaw = item.importo ?? info.importi?.importo_base ?? info.importi?.importo_complessivo ?? info.importo ?? 0
  const importo = parseFloat(String(importoRaw)) || null

  // Stazione appaltante
  const stazione = info.stazione_appaltante ??
    info.dati_stazione_appaltante?.nome ??
    item.stazione_appaltante ?? null

  // Luogo: preferisci la coppia "Comune, Regione" (più informativa), poi il campo
  // 'luogo' già composto da Cato, infine la sola provincia come ultima risorsa
  const { comune, regione, provincia: provinciaSola } = info.ubicazione ?? {}
  const provincia =
    (comune && regione ? `${comune}, ${regione}` : (comune || regione)) ??
    item.luogo ??
    provinciaSola ??
    null

  // CIG: info.cig[].cig è spesso solo un indice di lotto placeholder ("1", "2", …), non un
  // vero CIG (10 caratteri alfanumerici) — succede per bandi con origine TED o pvl_anac dentro
  // Cato. In quel caso numero_gara è più affidabile: per i bandi di origine TED coincide
  // esattamente col publication-number che usa anche il nostro adapter TED nativo (fixa sia il
  // "CIG" fittizio in UI sia la mancata de-duplicazione tra Cato e TED in route.ts).
  const isRealCig = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9]{10}$/.test(s)
  const lotCig = info.cig?.[0]?.cig
  const cig = isRealCig(lotCig) ? lotCig : (item.numero_gara ?? item.cig ?? String(item.id))

  return {
    id:                  `${src}:${item.id}`,
    cig,
    oggetto,
    importo,
    stato:               item.status ?? item.stato ?? "active",
    provincia,
    data_pubblicazione,
    data_scadenza,
    tipo_contratto:      info.procedura?.tipo_procedura ?? item.tipo_procedura ?? item.tipo_contratto ?? null,
    descrizione_cpv:     (info.procedura?.codice_cpv as Array<{codice:string;etichetta:string}> | undefined)
                           ?.map(c => c.codice).join(", ") ??
                         (item.cpv_codes as string[] | undefined)?.join(", ") ??
                         item.descrizione_cpv ?? null,
    sources:             src,
    link_originale:      link,
    stazione_appaltante: stazione,
  }
}

export async function fetchCato(
  params: CatoFetchParams,
  defaultSource: SourceKey = "cato",
): Promise<SourceResult> {
  const { q, page = 0, importo, scadenza, pubblicazione, tipo, source } = params

  const p = new URLSearchParams()
  p.set("p", String(page))

  if (q?.trim()) p.set("q", q.trim())

  // Tipo procedura: parametro nativo "tp" (match esatto su tipo_procedura, verificato via devtools
  // sul sito get-cato.com/gare — es. tp=Servizi, tp=Forniture, tp=Lavori+pubblici)
  const tipoNativo = tipo ? (TIPO_TO_CATO[tipo.toLowerCase()] ?? tipo) : null
  if (tipoNativo) p.set("tp", tipoNativo)

  // Importo: usa min/max numerici in euro
  if (importo) {
    const range = IMPORTO_TO_MINMAX[importo]
    if (range) {
      if (range.min != null) p.set("min", String(range.min))
      if (range.max != null) p.set("max", String(range.max))
    }
  }

  // Scadenza: parametro nativo "days" (verificato via devtools — "scadenza" non è supportato
  // ed è ignorato silenziosamente dall'API)
  if (scadenza) p.set("days", scadenza)

  const url = `${CATO_BASE}?${p.toString()}`

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept":     "application/json",
      "Referer":    "https://www.get-cato.com/gare",
    },
    signal: AbortSignal.timeout(10_000),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- Next.js estende RequestInit con 'next'
    next:   { revalidate: 60 },
  })

  if (!res.ok) {
    return {
      items:  [],
      total:  0,
      source: defaultSource,
      error:  `Cato upstream ${res.status}`,
    }
  }

  const raw   = await res.json()
  let items = (raw.items ?? raw.data ?? []).map((i: unknown) =>
    mapCatoItem(i, defaultSource),
  )

  // Filtro per sotto-fonte: applicato client-side sul campo 'sources' della risposta perché
  // l'API Cato non supporta un filtro server-side per fonte (vedi header file). Ogni pagina
  // Cato restituisce sempre 10 item grezzi (verificato: nessun parametro di page-size ha
  // effetto), quindi con un filtro attivo alcune pagine possono risultare vuote o parziali
  // anche se altrove ci sono altri risultati corrispondenti.
  if (source) {
    items = items.filter((item: NormalizedTender) => item.sources === source)
  }

  const publicationCutoff = pubblicazione ? getPublicationCutoff(pubblicazione) : null
  if (publicationCutoff) {
    items = items.filter((item: NormalizedTender) => isPublishedSince(item.data_pubblicazione, publicationCutoff))
  }

  return {
    items,
    total:  (source || publicationCutoff) ? items.length : raw.total ?? items.length,
    source: defaultSource,
  }
}
