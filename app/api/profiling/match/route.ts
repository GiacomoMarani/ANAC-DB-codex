import { NextResponse } from "next/server"
import { isActiveTender } from "@/lib/utils/tenderLogic"

/**
 * POST /api/profiling/match
 *
 * Matching bandi — riceve una lista di descrizioni CPV e restituisce
 * i bandi attivi compatibili dalle tabelle `cig` e `ita_tenders`.
 *
 * La tabella `ita_tenders` ha un campo `codice_cpv` (codice numerico)
 * mentre la tabella `cig` ha solo `descrizione_cpv` (testo).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { cpv_codes, provincia, limit = 20 } = body

    if (!cpv_codes || !Array.isArray(cpv_codes) || cpv_codes.length === 0) {
      return NextResponse.json(
        { error: "cpv_codes (array) è obbligatorio" },
        { status: 400 }
      )
    }

    // Dynamic import
    let createAdminClient: typeof import("@/lib/supabase/admin").createAdminClient
    try {
      const mod = await import("@/lib/supabase/admin")
      createAdminClient = mod.createAdminClient
    } catch {
      return NextResponse.json(
        { error: "Database non configurato" },
        { status: 503 }
      )
    }

    let supabase: ReturnType<typeof createAdminClient>
    try {
      supabase = createAdminClient()
    } catch {
      return NextResponse.json(
        { error: "Impossibile connettersi al database" },
        { status: 503 }
      )
    }

    interface MatchResult {
      cig: string
      oggetto_gara: string
      importo: number | null
      provincia: string | null
      data_scadenza: string | null
      descrizione_cpv: string | null
      score: number
      cpv_match: string[]
      stato: string | null
    }

    const matches: MatchResult[] = []
    const seenCigs = new Set<string>()

    // ── 1. Cerca su ita_tenders (matching preciso via codice_cpv) ──
    try {
      // Estrai solo i codici numerici CPV dalle descriptions
      const cpvCodes = cpv_codes
        .map((c: string) => {
          const match = c.match(/^(\d{8})/)
          return match ? match[1] : null
        })
        .filter(Boolean) as string[]

      if (cpvCodes.length > 0) {
        const { data: itaData } = await supabase
          .from("ita_tenders")
          .select("id, oggetto, importo, provincia, data_scadenza, codice_cpv, cig, data_pubblicazione")
          .or(cpvCodes.map(c => `codice_cpv.ilike.%${c}%`).join(","))
          .order("data_scadenza", { ascending: true, nullsFirst: false })
          .limit(limit)

        if (itaData) {
          for (const row of itaData) {
            const cigKey = row.cig || `ita:${row.id}`
            if (seenCigs.has(cigKey)) continue
            seenCigs.add(cigKey)

            // Trova quali CPV matchano
            const matchedCpvs = cpvCodes.filter(
              (c) => row.codice_cpv && row.codice_cpv.includes(c)
            )

            // Score: base 60 + CPV overlap bonus + province bonus
            let score = 60
            score += Math.min(matchedCpvs.length * 15, 30) // max +30 per CPV match
            if (provincia && row.provincia && row.provincia.toUpperCase() === provincia.toUpperCase()) {
              score += 10
            }
            // Penalità se scaduto
            if (row.data_scadenza && new Date(row.data_scadenza) < new Date()) {
              score -= 20
            }

            matches.push({
              cig: cigKey,
              oggetto_gara: row.oggetto || "Bando senza titolo",
              importo: row.importo != null ? Number(row.importo) : null,
              provincia: row.provincia,
              data_scadenza: row.data_scadenza,
              descrizione_cpv: row.codice_cpv,
              score: Math.max(0, Math.min(100, score)),
              cpv_match: matchedCpvs,
              stato: null,
            })
          }
        }
      }
    } catch (err) {
      console.warn("[match] ita_tenders query error:", err)
    }

    // ── 2. Cerca su cig (matching testo via descrizione_cpv) ──────
    try {
      // Usa le prime 3 parole significative di ogni CPV description per la ricerca
      const searchTerms = cpv_codes
        .slice(0, 5) // limita a 5 CPV per performance
        .map((c: string) => {
          // Rimuovi codice numerico se presente
          const desc = c.replace(/^\d{8}(-\d)?\s*[-–—]\s*/, "").trim()
          // Prendi le prime 2 parole significative (>= 4 caratteri)
          const words = desc
            .split(/\s+/)
            .filter((w: string) => w.length >= 4)
            .slice(0, 2)
          return words.join(" ")
        })
        .filter((t: string) => t.length >= 4)

      if (searchTerms.length > 0) {
        const orConditions = searchTerms
          .map((term: string) => `descrizione_cpv.ilike.%${term}%`)
          .join(",")

        const { data: cigData } = await supabase
          .from("cig")
          .select("cig, oggetto_gara, importo_lotto, provincia, data_scadenza_offerta, descrizione_cpv, stato")
          .or(orConditions)
          .order("data_pubblicazione", { ascending: false })
          .limit(limit)

        if (cigData) {
          for (const row of cigData) {
            if (seenCigs.has(row.cig)) continue
            seenCigs.add(row.cig)

            // Filtra solo gare attive
            if (!isActiveTender(row)) continue

            // Score
            let score = 50
            const matchedTerms = searchTerms.filter(
              (t: string) => row.descrizione_cpv && row.descrizione_cpv.toLowerCase().includes(t.toLowerCase())
            )
            score += Math.min(matchedTerms.length * 12, 24)

            if (provincia && row.provincia && row.provincia.toUpperCase() === provincia.toUpperCase()) {
              score += 10
            }

            matches.push({
              cig: row.cig,
              oggetto_gara: row.oggetto_gara || "Bando senza titolo",
              importo: row.importo_lotto != null ? Number(row.importo_lotto) : null,
              provincia: row.provincia,
              data_scadenza: row.data_scadenza_offerta,
              descrizione_cpv: row.descrizione_cpv,
              score: Math.max(0, Math.min(100, score)),
              cpv_match: matchedTerms,
              stato: row.stato,
            })
          }
        }
      }
    } catch (err) {
      console.warn("[match] cig query error:", err)
    }

    // ── Ordinamento finale ───────────────────────────────────────
    matches.sort((a, b) => b.score - a.score)
    const finalMatches = matches.slice(0, limit)

    return NextResponse.json({
      matches: finalMatches,
      total: finalMatches.length,
    })
  } catch (err) {
    console.error("[match] Unhandled error:", err)
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    )
  }
}
