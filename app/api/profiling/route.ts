import { NextResponse } from "next/server"
import { isValidPartitaIva, formatPartitaIva } from "@/lib/utils/piva"
import { lookupVies } from "@/lib/utils/vies"
import type { ProfilingResponse } from "@/lib/utils/piva"

/**
 * POST /api/profiling
 *
 * Profilazione Rapida — riceve una Partita IVA e restituisce un profilo
 * aziendale con codici CPV, storico gare, copertura territoriale.
 *
 * v1: poiché la tabella `cig` non ha il campo cf_aggiudicatario,
 * la ricerca avviene sulla denominazione dell'amministrazione appaltante.
 * I dati CPV vengono estratti dal campo `descrizione_cpv`.
 * L'oggetto_principale_contratto fornisce il tipo (SERVIZI/LAVORI/FORNITURE).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rawPiva = body.partita_iva

    if (!rawPiva || typeof rawPiva !== "string") {
      return NextResponse.json(
        { error: "Il campo partita_iva è obbligatorio" },
        { status: 400 }
      )
    }

    const piva = formatPartitaIva(rawPiva)

    if (!isValidPartitaIva(piva)) {
      return NextResponse.json(
        { error: "Partita IVA non valida. Deve essere composta da 11 cifre con checksum corretto." },
        { status: 400 }
      )
    }

    // Dynamic import: handle missing Supabase gracefully
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

    // ── VIES + aggiudicatari + CIG in parallelo ────────────────────
    // 1. VIES (EU Commission, gratuito) → ragione sociale e indirizzo reali
    // 2. aggiudicatari (tabella locale) → gare vinte reali per questa P.IVA
    // 3. cig (fallback) → campione generico se non ci sono aggiudicatari

    const [viesResult, aggiudicatariResult, dbResult] = await Promise.all([
      lookupVies(piva),
      supabase
        .from("aggiudicatari")
        .select("codice_fiscale, denominazione, cig, importo_aggiudicazione, data_aggiudicazione, codice_cpv, descrizione_cpv, oggetto_gara, provincia, ruolo")
        .eq("codice_fiscale", piva)
        .order("data_aggiudicazione", { ascending: false })
        .limit(500),
      supabase
        .from("cig")
        .select("oggetto_gara, importo_lotto, oggetto_principale_contratto, stato, provincia, data_pubblicazione, data_scadenza_offerta, sezione_regionale, descrizione_cpv, esito")
        .order("data_pubblicazione", { ascending: false })
        .limit(200),
    ])

    const { data: aggiudicatariData } = aggiudicatariResult
    const { data: cigData, error: dbError } = dbResult

    // Se abbiamo dati reali dall'aggiudicatari table, usiamo quelli
    const hasRealData = aggiudicatariData && aggiudicatariData.length > 0

    // ── Inizializza profilo con dati VIES reali ────────────────────
    const profile: ProfilingResponse["profile"] = {
      partita_iva: piva,
      ragione_sociale: viesResult.name,
      sede: viesResult.sede,
      regione: viesResult.regione,
      totale_gare: 0,
      gare_vinte: 0,
      importo_totale: 0,
      importo_medio: 0,
      prima_gara: null,
      ultima_gara: null,
      cpv_codes: [],
      cpv_divisions: [],
      province: [],
      tipi_contratto: [],
    }

    // Se aggiudicatari ha la denominazione e VIES non ha il nome, usa quella
    if (!profile.ragione_sociale && hasRealData) {
      profile.ragione_sociale = aggiudicatariData[0].denominazione
    }

    // ── PATH A: Dati reali da aggiudicatari ─────────────────────────
    if (hasRealData) {
      const cpvMap = new Map<string, { code: string; description: string; count: number; total_value: number }>()
      const provMap = new Map<string, number>()
      const dates: number[] = []
      let importoTotale = 0

      for (const row of aggiudicatariData) {
        const importo = Number(row.importo_aggiudicazione) || 0
        importoTotale += importo

        if (row.data_aggiudicazione) {
          const ts = new Date(row.data_aggiudicazione).getTime()
          if (!isNaN(ts)) dates.push(ts)
        }

        if (row.provincia && row.provincia.trim()) {
          const p = row.provincia.trim().toUpperCase()
          provMap.set(p, (provMap.get(p) || 0) + 1)
        }

        // CPV reale dall'aggiudicazione
        if (row.codice_cpv || row.descrizione_cpv) {
          const code = row.codice_cpv || "UNKNOWN"
          const desc = row.descrizione_cpv || code
          if (!cpvMap.has(code)) {
            cpvMap.set(code, { code, description: desc, count: 0, total_value: 0 })
          }
          const entry = cpvMap.get(code)!
          entry.count += 1
          entry.total_value += importo
        }
      }

      const totalGare = aggiudicatariData.length
      profile.totale_gare = totalGare
      profile.gare_vinte = totalGare  // sono TUTTE gare vinte (aggiudicate)
      profile.importo_totale = importoTotale
      profile.importo_medio = totalGare > 0 ? Math.round(importoTotale / totalGare) : 0

      if (dates.length > 0) {
        dates.sort((a, b) => a - b)
        profile.prima_gara = new Date(dates[0]).toISOString().split("T")[0]
        profile.ultima_gara = new Date(dates[dates.length - 1]).toISOString().split("T")[0]
      }

      // Sede: VIES ha priorità, fallback su provincia più frequente
      if (!profile.sede && provMap.size > 0) {
        const topProvincia = [...provMap.entries()].sort((a, b) => b[1] - a[1])[0]
        profile.sede = topProvincia[0]
        if (!profile.regione) {
          profile.regione = provinciaToRegione(topProvincia[0])
        }
      }

      // CPV codes
      profile.cpv_codes = [...cpvMap.values()]
        .map((c) => ({
          ...c,
          percentage: totalGare > 0 ? Math.round((c.count / totalGare) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30)

      // CPV divisions
      const divMap = new Map<string, { division: string; label: string; count: number }>()
      for (const c of profile.cpv_codes) {
        const div = c.code.length >= 2 ? c.code.substring(0, 2) : "??"
        if (!divMap.has(div)) {
          divMap.set(div, { division: div, label: cpvDivisionLabel(div), count: 0 })
        }
        divMap.get(div)!.count += c.count
      }
      profile.cpv_divisions = [...divMap.values()]
        .map((d) => ({
          ...d,
          percentage: totalGare > 0 ? Math.round((d.count / totalGare) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count)

      // Province
      profile.province = [...provMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      // Tipi contratto: non disponibili negli aggiudicatari, lasciamo vuoto
      // (saranno disponibili quando faremo join con cig)

      return NextResponse.json({ profile })
    }

    // ── PATH B: Fallback su campione generico da CIG ────────────────
    if (dbError) {
      console.warn("[profiling] DB query error:", dbError.message)
      return NextResponse.json({ profile })
    }

    if (!cigData || cigData.length === 0) {
      return NextResponse.json({ profile })
    }

    // ── Aggregazione dati ────────────────────────────────────────
    const cpvMap = new Map<string, { code: string; description: string; count: number; total_value: number }>()
    const provMap = new Map<string, number>()
    const tipoMap = new Map<string, number>()
    const dates: number[] = []
    let importoTotale = 0
    let gareConclusePositive = 0

    for (const row of cigData) {
      const importo = Number(row.importo_lotto) || 0
      importoTotale += importo

      // Date
      if (row.data_pubblicazione) {
        const ts = new Date(row.data_pubblicazione).getTime()
        if (!isNaN(ts)) dates.push(ts)
      }

      // Province
      if (row.provincia && row.provincia.trim()) {
        const p = row.provincia.trim().toUpperCase()
        provMap.set(p, (provMap.get(p) || 0) + 1)
      }

      // Tipo contratto (da oggetto_principale_contratto)
      if (row.oggetto_principale_contratto) {
        const tipo = normalizeContractType(row.oggetto_principale_contratto)
        if (tipo) {
          tipoMap.set(tipo, (tipoMap.get(tipo) || 0) + 1)
        }
      }

      // Esito = "aggiudicata" o simile
      if (row.esito) {
        const esitoUpper = row.esito.toUpperCase()
        if (esitoUpper.includes("AGGIUDICAT") || esitoUpper.includes("CONCLUS")) {
          gareConclusePositive++
        }
      }

      // CPV: parse dal campo descrizione_cpv
      // Formato tipico: "72210000-7 - Servizi di programmazione di pacchetti software"
      // oppure solo testo descrittivo
      if (row.descrizione_cpv && row.descrizione_cpv.trim()) {
        const cpvParsed = parseCpvField(row.descrizione_cpv)
        const key = cpvParsed.code

        if (!cpvMap.has(key)) {
          cpvMap.set(key, {
            code: cpvParsed.code,
            description: cpvParsed.description,
            count: 0,
            total_value: 0,
          })
        }
        const entry = cpvMap.get(key)!
        entry.count += 1
        entry.total_value += importo
      }
    }

    const totalGare = cigData.length

    // ── Costruzione profilo ──────────────────────────────────────
    profile.totale_gare = totalGare
    profile.gare_vinte = gareConclusePositive
    profile.importo_totale = importoTotale
    profile.importo_medio = totalGare > 0 ? Math.round(importoTotale / totalGare) : 0

    // Date
    if (dates.length > 0) {
      dates.sort((a, b) => a - b)
      profile.prima_gara = new Date(dates[0]).toISOString().split("T")[0]
      profile.ultima_gara = new Date(dates[dates.length - 1]).toISOString().split("T")[0]
    }

    // Sede: VIES ha priorità, fallback su provincia più frequente dal DB
    if (!profile.sede && provMap.size > 0) {
      const topProvincia = [...provMap.entries()].sort((a, b) => b[1] - a[1])[0]
      profile.sede = topProvincia[0]
      if (!profile.regione) {
        profile.regione = provinciaToRegione(topProvincia[0])
      }
    }

    // CPV codes (top 30)
    profile.cpv_codes = [...cpvMap.values()]
      .map((c) => ({
        ...c,
        percentage: totalGare > 0 ? Math.round((c.count / totalGare) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)

    // CPV divisions (aggregazione per prime 2 cifre)
    const divMap = new Map<string, { division: string; label: string; count: number }>()
    for (const c of profile.cpv_codes) {
      const div = c.code.length >= 2 ? c.code.substring(0, 2) : "??"
      if (!divMap.has(div)) {
        divMap.set(div, { division: div, label: cpvDivisionLabel(div), count: 0 })
      }
      divMap.get(div)!.count += c.count
    }

    profile.cpv_divisions = [...divMap.values()]
      .map((d) => ({
        ...d,
        percentage: totalGare > 0 ? Math.round((d.count / totalGare) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    // Province (top 10)
    profile.province = [...provMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Tipi contratto
    profile.tipi_contratto = [...tipoMap.entries()]
      .map(([tipo, count]) => ({
        tipo,
        count,
        percentage: totalGare > 0 ? Math.round((count / totalGare) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({ profile })
  } catch (err) {
    console.error("[profiling] Unhandled error:", err)
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    )
  }
}

// ─── Helper functions ────────────────────────────────────────────────────────

/**
 * Parse il campo descrizione_cpv per estrarre codice e descrizione.
 * Formato atteso: "72210000-7 - Servizi di programmazione"
 * oppure: "Servizi informatici" (solo testo)
 */
function parseCpvField(raw: string): { code: string; description: string } {
  const trimmed = raw.trim()

  // Pattern: codice numerico (con eventuale suffisso -N) seguito da separatore e descrizione
  const match = trimmed.match(/^(\d{8}(?:-\d)?)\s*[-–—]\s*(.+)$/)
  if (match) {
    return { code: match[1], description: match[2].trim() }
  }

  // Pattern: solo codice numerico
  if (/^\d{8}(-\d)?$/.test(trimmed)) {
    return { code: trimmed, description: trimmed }
  }

  // Solo testo descrittivo — usa un hash come chiave
  return { code: `TXT_${simpleHash(trimmed)}`, description: trimmed }
}

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) & 0x7fffffff
  }
  return h.toString(36).substring(0, 6)
}

/** Normalizza il tipo di contratto ANAC/OCDS */
function normalizeContractType(raw: string): string | null {
  const upper = raw.toUpperCase().trim()
  if (upper.includes("SERVIZ") || upper === "SERVICES") return "SERVIZI"
  if (upper.includes("FORNITUR") || upper === "GOODS") return "FORNITURE"
  if (upper.includes("LAVOR") || upper === "WORKS") return "LAVORI"
  if (upper.includes("MIST") || upper === "MIXED") return "MISTI"
  if (upper) return upper.substring(0, 30)
  return null
}

/** Mapping basilare delle principali divisioni CPV */
function cpvDivisionLabel(div: string): string {
  const labels: Record<string, string> = {
    "03": "Prodotti agricoli e della pesca",
    "09": "Prodotti petroliferi e combustibili",
    "14": "Prodotti minerari",
    "15": "Prodotti alimentari",
    "18": "Indumenti e accessori",
    "22": "Stampati e prodotti affini",
    "24": "Prodotti chimici",
    "30": "Macchine per ufficio ed elaboratori",
    "31": "Apparecchiature elettriche",
    "32": "Apparecchiature radio e televisive",
    "33": "Apparecchiature mediche",
    "34": "Attrezzature di trasporto",
    "35": "Attrezzature di sicurezza",
    "37": "Strumenti musicali e sportivi",
    "38": "Strumenti di laboratorio e ottici",
    "39": "Mobili e arredamento",
    "42": "Macchinari industriali",
    "43": "Macchinari per miniere e cave",
    "44": "Costruzioni e materiali da costruzione",
    "45": "Lavori di costruzione",
    "48": "Pacchetti software",
    "50": "Servizi di riparazione e manutenzione",
    "51": "Servizi di installazione",
    "55": "Servizi alberghieri e di ristorazione",
    "60": "Servizi di trasporto",
    "63": "Servizi ausiliari di trasporto",
    "64": "Servizi postali e telecomunicazioni",
    "65": "Servizi pubblici",
    "66": "Servizi finanziari e assicurativi",
    "70": "Servizi immobiliari",
    "71": "Servizi architettura e ingegneria",
    "72": "Servizi informatici",
    "73": "Servizi di ricerca e sviluppo",
    "75": "Servizi di pubblica amministrazione",
    "76": "Servizi relativi all'industria estrattiva",
    "77": "Servizi agricoli e forestali",
    "79": "Servizi alle imprese",
    "80": "Servizi di istruzione e formazione",
    "85": "Servizi sanitari e sociali",
    "90": "Servizi fognari e di raccolta rifiuti",
    "92": "Servizi ricreativi e culturali",
    "98": "Altri servizi",
  }
  return labels[div] || `Divisione ${div}`
}

/** Mapping semplificato provincia → regione per le province italiane più comuni */
function provinciaToRegione(prov: string): string | null {
  const map: Record<string, string> = {
    ROMA: "Lazio", MILANO: "Lombardia", NAPOLI: "Campania",
    TORINO: "Piemonte", FIRENZE: "Toscana", BOLOGNA: "Emilia-Romagna",
    GENOVA: "Liguria", VENEZIA: "Veneto", PALERMO: "Sicilia",
    BARI: "Puglia", CATANIA: "Sicilia", CAGLIARI: "Sardegna",
    PERUGIA: "Umbria", ANCONA: "Marche", "L'AQUILA": "Abruzzo",
    POTENZA: "Basilicata", CATANZARO: "Calabria", CAMPOBASSO: "Molise",
    TRENTO: "Trentino-Alto Adige", BOLZANO: "Trentino-Alto Adige",
    TRIESTE: "Friuli-Venezia Giulia", AOSTA: "Valle d'Aosta",
  }
  return map[prov.toUpperCase()] || null
}
