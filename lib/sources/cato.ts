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
  const src  = (item.source ?? defaultSource) as SourceKey

  return {
    id:                  `${src}:${item.id}`,
    cig:                 info.cig ?? item.cig ?? String(item.id),
    oggetto:             item.title ?? item.oggetto_gara ?? item.oggetto ?? null,
    importo:             parseFloat(String(info.importo ?? item.importo ?? 0)) || null,
    stato:               item.status ?? item.stato ?? "active",
    provincia:           info.provincia ?? item.provincia ?? null,
    data_pubblicazione:  item.created_at ?? item.data_pubblicazione ?? null,
    data_scadenza:       info.data_scadenza ?? info.scadenza ?? item.data_scadenza_offerta ?? null,
    tipo_contratto:      item.tipo_procedura ?? item.tipo_contratto ?? info.tipo ?? null,
    descrizione_cpv:     (item.cpv_codes as string[] | undefined)?.join(", ") ?? item.descrizione_cpv ?? null,
    sources:             src,
    link_originale:      item.original_url ?? item.link_originale ?? null,
    stazione_appaltante: info.stazione_appaltante ?? item.stazione_appaltante ?? null,
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
