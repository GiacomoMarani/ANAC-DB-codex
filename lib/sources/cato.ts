/**
 * lib/sources/cato.ts
 * Adapter Cato (www.get-cato.com/api/tenders)
 *
 * Supporta il parametro `source` nativo di Cato per isolare
 * fonti specifiche: sintel, acquistinretepa, start_toscana,
 * halleyweb, place_vda, ted (fallback), ecc.
 */

import type { NormalizedTender, SourceKey, SourceResult } from "./types"

const CATO_BASE = "https://www.get-cato.com/api/tenders"

const IMPORTO_MAP: Record<string, string> = {
  "< €40.000":    "< €40.000",
  "€40k – €150k": "€40k – €150k",
  "€150k – €1M":  "€150k – €1M",
  "€1M – €5M":    "€1M – €5M",
  "> €5M":        "> €5M",
}

const SCADENZA_MAP: Record<string, string> = {
  "7":  "Entro 7 giorni",
  "30": "Entro 30 giorni",
  "90": "Entro 3 mesi",
}

export interface CatoFetchParams {
  q?:        string
  page?:     number
  pageSize?: number
  importo?:  string
  scadenza?: string
  tipo?:     string
  /** Fonte specifica da passare a Cato (es. "sintel", "start_toscana") */
  source?:   string
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
  // Normalizza formato italiano "DD/MM/YYYY HH:mm" → ISO
  let data_scadenza: string | null = null
  if (scadenzaRaw) {
    const dmyMatch = String(scadenzaRaw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (dmyMatch) {
      data_scadenza = `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`
    } else {
      data_scadenza = String(scadenzaRaw).split('T')[0] // già ISO
    }
  }

  // Link: Cato usa 'link_web' come URL diretto alla fonte
  const link = item.link_web ?? item.original_url ?? item.link_originale ?? null

  // Importo
  const importoRaw = item.importo ?? info.importi?.importo_base ?? info.importi?.importo_complessivo ?? info.importo ?? 0
  const importo = parseFloat(String(importoRaw)) || null

  // Stazione appaltante
  const stazione = info.stazione_appaltante ??
    info.dati_stazione_appaltante?.nome ??
    item.stazione_appaltante ?? null

  // Provincia/regione
  const provincia = info.ubicazione?.provincia ?? info.ubicazione?.regione ?? item.luogo ?? null

  return {
    id:                  `${src}:${item.id}`,
    cig:                 info.cig?.[0]?.cig ?? item.cig ?? String(item.id),
    oggetto,
    importo,
    stato:               item.status ?? item.stato ?? "active",
    provincia,
    data_pubblicazione:  item.created_at ?? item.data_pubblicazione ?? null,
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
  const { q, page = 0, importo, scadenza, tipo, source } = params

  const p = new URLSearchParams()
  p.set("p", String(page))

  // Ricerca: combina q + tipo come Cato si aspetta
  const qParts = [q, tipo].filter(Boolean)
  if (qParts.length) p.set("q", qParts.join(" ").trim())

  if (importo) p.set("importo", IMPORTO_MAP[importo] ?? importo)
  if (scadenza) {
    const label = SCADENZA_MAP[scadenza]
    if (label) p.set("scadenza", label)
  }
  // Filtro fonte nativo Cato
  if (source) p.set("source", source)

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
  const items = (raw.items ?? raw.data ?? []).map((i: unknown) =>
    mapCatoItem(i, defaultSource),
  )

  return {
    items,
    total:  raw.total ?? items.length,
    source: defaultSource,
  }
}
