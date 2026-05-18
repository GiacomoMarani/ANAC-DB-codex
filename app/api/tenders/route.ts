/**
 * /api/tenders — Proxy verso get-cato.com/api/tenders (API pubblica, no auth)
 *
 * Parametri supportati (identici a Cato):
 *   p        — pagina 0-based (default: 0)
 *   q        — ricerca full-text sull'oggetto
 *   tipo     — tipo procedura (Forniture, Servizi, Lavori, ...)
 *   importo  — fascia importo (< €40.000 | €40k – €150k | ...)
 *   scadenza — giorni alla scadenza (7 | 30 | 90)
 *
 * Il proxy aggiunge CORS e cache headers.
 */
import { NextRequest, NextResponse } from "next/server"

const CATO_BASE = "https://www.get-cato.com/api/tenders"

// Fascia importo → parametri Cato (url-encoded)
const IMPORTO_MAP: Record<string, string> = {
  "< €40.000":   "< €40.000",
  "€40k – €150k": "€40k – €150k",
  "€150k – €1M": "€150k – €1M",
  "€1M – €5M":   "€1M – €5M",
  "> €5M":       "> €5M",
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  // Build Cato query string
  const catoParams = new URLSearchParams()
  catoParams.set("p", sp.get("p") ?? "0")
  if (sp.get("q"))       catoParams.set("q", sp.get("q")!)
  if (sp.get("tipo"))    catoParams.set("q", `${sp.get("q") ?? ""} ${sp.get("tipo")}`.trim())
  if (sp.get("importo")) catoParams.set("importo", IMPORTO_MAP[sp.get("importo")!] ?? sp.get("importo")!)
  if (sp.get("scadenza")) {
    // Map days → Cato scadenza label
    const scadenzaMap: Record<string, string> = { "7": "Entro 7 giorni", "30": "Entro 30 giorni", "90": "Entro 3 mesi" }
    const label = scadenzaMap[sp.get("scadenza")!]
    if (label) catoParams.set("scadenza", label)
  }

  const catoUrl = `${CATO_BASE}?${catoParams.toString()}`

  try {
    const res = await fetch(catoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.get-cato.com/gare",
      },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 60 }, // cache 60s server-side
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Cato upstream: ${res.status}` }, { status: res.status })
    }

    const raw = await res.json()

    // Normalize Cato response → our format
    // Cato returns: { items: [...], total: number }
    // Each item has: id, extracted_main_info (CIG, importo, scadenza, stazione), ...
    const items = (raw.items ?? raw.data ?? []).map((item: Record<string, unknown>) => {
      const info = (item.extracted_main_info as Record<string, unknown>) ?? {}
      return {
        id:                 item.id,
        cig:                info.cig ?? item.cig ?? item.id,
        oggetto:            item.title ?? item.oggetto_gara ?? item.oggetto ?? null,
        importo:            parseFloat(String(info.importo ?? item.importo ?? 0)) || null,
        stato:              item.status ?? item.stato ?? "active",
        provincia:          info.provincia ?? item.provincia ?? null,
        data_pubblicazione: item.created_at ?? item.data_pubblicazione ?? null,
        data_scadenza:      info.data_scadenza ?? info.scadenza ?? item.data_scadenza_offerta ?? null,
        tipo_contratto:     item.tipo_procedura ?? item.tipo_contratto ?? info.tipo ?? null,
        descrizione_cpv:    (item.cpv_codes as string[] | undefined)?.join(", ") ?? item.descrizione_cpv ?? null,
        sources:            item.source ?? "cato",
        link_originale:     item.original_url ?? item.link_originale ?? null,
      }
    })

    return NextResponse.json(
      { items, total: raw.total ?? items.length },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upstream error" },
      { status: 502 }
    )
  }
}
