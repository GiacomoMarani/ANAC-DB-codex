// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
import { NextResponse } from "next/server"
import { isValidPartitaIva, formatPartitaIva } from "@/lib/utils/piva"
import { lookupVies } from "@/lib/utils/vies"
import { lookupScpMit, searchScpMitByName, type ScpAggiudicazione } from "@/lib/services/scpMit"
import { lookupTedAwards, type TedAward } from "@/lib/services/tedAwards"
import { deduplicateAwards, type UnifiedAward } from "@/lib/utils/dedupAwards"
import { queryAggiudicatariByFiscalCode } from "@/lib/turso"
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
    // Unified search: accept `query` field (auto-detect P.IVA vs name)
    // Backward compatibility: also accept `partita_iva` and `ragione_sociale`
    const rawQuery = (body.query || body.partita_iva || "") as string
    const rawRagioneSociale = body.ragione_sociale as string | undefined
    // ANAC live data passed from frontend relay (dataset AGGIUDICATARI_NO_ACCORDO_QUADRO)
    const anacData = (body.anacData || null) as Array<Record<string, unknown>> | null

    // Auto-detect: if the input is numeric (optionally prefixed with IT), treat as P.IVA
    const cleanedQuery = rawQuery.trim().replace(/[\s\-\.]/g, "")
    const isNumericQuery = /^(?:IT)?\d{6,16}$/i.test(cleanedQuery)

    let rawPiva: string | undefined = undefined
    let ragioneSociale: string | undefined = rawRagioneSociale

    if (isNumericQuery) {
      // Strip "IT" prefix if present
      rawPiva = cleanedQuery.replace(/^IT/i, "")
    } else if (rawQuery.trim().length >= 3) {
      ragioneSociale = ragioneSociale || rawQuery.trim()
    } else if (rawRagioneSociale && rawRagioneSociale.trim().length >= 3) {
      // backward compat: ragione_sociale field was sent separately
    } else if (rawQuery.trim().length > 0) {
      return NextResponse.json(
        { error: "Inserisci almeno 3 caratteri per cercare per nome, oppure una Partita IVA/CF." },
        { status: 400 }
      )
    }

    // Supporta ricerca per ragione sociale: cerca la P.IVA nell'archivio locale + SCP/MIT live
    if ((!rawPiva || rawPiva.trim() === "") && ragioneSociale && ragioneSociale.trim().length >= 3) {
      let createAdminClient: typeof import("@/lib/supabase/admin").createAdminClient
      try {
        const mod = await import("@/lib/supabase/admin")
        createAdminClient = mod.createAdminClient
      } catch {
        return NextResponse.json({ error: "Database non configurato" }, { status: 503 })
      }
      let supabase: ReturnType<typeof createAdminClient>
      try {
        supabase = createAdminClient()
      } catch {
        return NextResponse.json({ error: "Impossibile connettersi al database" }, { status: 503 })
      }

      // Normalizza: rimuovi punteggiatura, uppercase, splitta parole
      const normalized = ragioneSociale.trim()
        .toUpperCase()
        .replace(/[.\-,'"]/g, " ")  // punteggiatura → spazi
        .replace(/\s+/g, " ")        // spazi multipli → singolo
        .trim()
      const words = normalized.split(" ").filter((w: string) => w.length >= 2)

      // Cerca in parallelo: DB locale (aggiudicatari + partecipanti) + SCP/MIT live
      const localSearchPromise = (async () => {
        // Search aggiudicatari
        let query1 = supabase
          .from("aggiudicatari")
          .select("codice_fiscale, denominazione")
          .not("codice_fiscale", "is", null)
        for (const word of words.slice(0, 3)) {
          query1 = query1.ilike("denominazione", `%${word}%`)
        }
        const { data: fromAgg } = await query1.limit(10)

        // Search partecipanti
        let query2 = supabase
          .from("partecipanti")
          .select("codice_fiscale, denominazione")
          .not("codice_fiscale", "is", null)
        for (const word of words.slice(0, 3)) {
          query2 = query2.ilike("denominazione", `%${word}%`)
        }
        const { data: fromPart } = await query2.limit(10)

        return [...(fromAgg || []), ...(fromPart || [])]
      })()

      const scpNamePromise = searchScpMitByName(ragioneSociale.trim()).catch((err) => {
        console.warn("[profiling] SCP/MIT name search error:", err)
        return { candidates: [] as { partita_iva: string; denominazione: string }[], records: [] }
      })

      const [localFound, scpNameResult] = await Promise.all([localSearchPromise, scpNamePromise])

      // Merge and deduplicate by codice_fiscale
      const cfMap = new Map<string, string>()
      for (const r of localFound) {
        if (r.codice_fiscale && !cfMap.has(r.codice_fiscale)) {
          cfMap.set(r.codice_fiscale, r.denominazione ?? r.codice_fiscale)
        }
      }
      for (const c of scpNameResult.candidates) {
        if (!cfMap.has(c.partita_iva)) {
          cfMap.set(c.partita_iva, c.denominazione)
        }
      }

      if (cfMap.size === 0) {
        return NextResponse.json(
          { error: `Nessuna azienda trovata per "${ragioneSociale.trim()}". Prova con la Partita IVA.` },
          { status: 404 }
        )
      }

      // Se ci sono più candidati, restituiscili per la selezione in UI
      if (cfMap.size > 1) {
        return NextResponse.json({
          candidates: [...cfMap.entries()].map(([piva, denom]) => ({
            partita_iva: piva,
            denominazione: denom,
          })),
        })
      }

      // Unico risultato: usa direttamente la P.IVA trovata
      rawPiva = [...cfMap.keys()][0]
    }

    if (!rawPiva || typeof rawPiva !== "string") {
      return NextResponse.json(
        { error: "Inserisci una Partita IVA o una ragione sociale" },
        { status: 400 }
      )
    }

    const piva = formatPartitaIva(rawPiva)

    // Accept both P.IVA (11 digits) and Codice Fiscale (16 alphanumeric chars)
    const isCF16 = /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(rawPiva.trim())
    if (!isCF16 && !isValidPartitaIva(piva)) {
      return NextResponse.json(
        { error: "Partita IVA non valida. Deve essere composta da 11 cifre con checksum corretto, oppure un Codice Fiscale a 16 caratteri." },
        { status: 400 }
      )
    }

    // For CF16, use the raw value (uppercase, trimmed) instead of the digit-only formatted version
    const lookupKey = isCF16 ? rawPiva.trim().toUpperCase() : piva

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

    // ── VIES + DB locale + SCP/MIT (live) + TED Europa (live) ────────
    // 1. VIES (EU Commission, gratuito) → ragione sociale e indirizzo reali
    // 2. DB locale `aggiudicatari` → gare vinte salvate localmente per questa P.IVA
    // 3. SCP/MIT (live) → Banca dati contratti pubblici MIT (CKAN)
    // 4. TED Europa (live) → Gare sopra-soglia europea e appalti internazionali

    // Avvia VIES, query locale e SCP/MIT in parallelo
    const viesPromise = isCF16 ? Promise.resolve({ name: null, sede: null, regione: null, valid: false }) : lookupVies(piva)

    const localPromise = (async () => {
      try {
        const { data } = await supabase
          .from("aggiudicatari")
          .select("codice_fiscale, denominazione, cig, importo_aggiudicazione, data_aggiudicazione, codice_cpv, descrizione_cpv, oggetto_gara, provincia, ruolo")
          .eq("codice_fiscale", lookupKey)
          .order("data_aggiudicazione", { ascending: false })
          .limit(500)
        return data && data.length > 0 ? data : []
      } catch {
        return []
      }
    })()

    const scpPromise = lookupScpMit(lookupKey).catch((err) => {
      console.warn("[profiling] SCP/MIT lookup error:", err)
      return { records: [], total: 0 }
    })

    // 5. DB locale `partecipanti` → gare a cui l'azienda ha partecipato (anche senza vincere)
    const partecipantiPromise = (async () => {
      try {
        const { data } = await supabase
          .from("partecipanti")
          .select("cig, codice_cpv, oggetto_gara, provincia")
          .eq("codice_fiscale", lookupKey)
          .limit(2000)
        return data && data.length > 0 ? data : []
      } catch {
        return []
      }
    })()

    const [viesResult, localData, scpResult, partecipantiData, tursoData] = await Promise.all([
      viesPromise,
      localPromise,
      scpPromise,
      partecipantiPromise,
      queryAggiudicatariByFiscalCode(lookupKey),
    ])

    const scpData = scpResult.records

    if (tursoData.length > 0) {
      console.log(`[profiling] Turso storico: ${tursoData.length} records for ${lookupKey}`)
    }

    // ── Map ANAC live data (relay) to local format if present ─────
    const anacLiveRecords = (anacData || []).map((r) => ({
      codice_fiscale: String(r.cod_fisc_partecipante || lookupKey),
      denominazione: String(r.denominazione_partecipante || ""),
      cig: String(r.cig || ""),
      importo_aggiudicazione: r.importo_aggiudicazione != null ? Number(r.importo_aggiudicazione) : null,
      data_aggiudicazione: r.data_aggiudicazione_definitiva ? String(r.data_aggiudicazione_definitiva) : null,
      codice_cpv: r.cod_cpv ? String(r.cod_cpv) : null,
      descrizione_cpv: null as string | null,
      oggetto_gara: r.oggetto_bando ? String(r.oggetto_bando) : null,
      provincia: r.provincia ? String(r.provincia) : null,
      ruolo: r.partecipante_ruolo ? String(r.partecipante_ruolo) : null,
      tipo_appalto: r.oggetto_principale_contratto ? String(r.oggetto_principale_contratto) : null,
      source: "anac_live" as const,
    }))

    if (anacLiveRecords.length > 0) {
      console.log(`[profiling] ANAC live relay: ${anacLiveRecords.length} records for ${lookupKey}`)
    }

    // Nome azienda per interrogare le gare europee su TED (CAN notices)
    const companyNameForTed =
      viesResult.name ||
      localData[0]?.denominazione ||
      (anacLiveRecords.length > 0 ? anacLiveRecords[0].denominazione : null) ||
      scpData[0]?.denominazione ||
      null

    let tedAwards: TedAward[] = []
    if (companyNameForTed) {
      try {
        tedAwards = await lookupTedAwards(companyNameForTed, { limit: 100 })
      } catch (tedErr) {
        console.warn("[profiling] TED lookup error:", tedErr)
      }
    }

    // ── Map Turso storico records to local format ─────
    const tursoRecords = tursoData.map((r) => ({
      codice_fiscale: r.cod_fisc,
      denominazione: r.denominazione || "",
      cig: r.cig,
      importo_aggiudicazione: r.importo_aggiudicazione,
      data_aggiudicazione: r.data_aggiudicazione,
      codice_cpv: r.cod_cpv,
      descrizione_cpv: null as string | null,
      oggetto_gara: r.oggetto_bando,
      provincia: r.provincia,
      ruolo: r.ruolo,
      tipo_appalto: r.tipo_contratto,
      source: "turso_storico" as const,
    }))

    // Merge local + ANAC live + Turso storico records
    const combinedLocalRecords = [
      ...localData.map((r) => ({
        ...r,
        source: "local" as const,
      })),
      ...anacLiveRecords,
      ...tursoRecords,
    ]

    // Unifica e deduplica con algoritmo a 3 livelli (CIG esatto, ID notice, Fuzzy heuristic)
    const { deduped: aggiudicatariData, stats: dedupStats } = deduplicateAwards({
      localAwards: combinedLocalRecords,
      scpAwards: scpData.map((r) => ({
        id: `scp:${r.cig}`,
        codice_fiscale: r.codice_fiscale,
        denominazione: r.denominazione,
        cig: r.cig,
        importo_aggiudicazione: r.importo_aggiudicazione,
        data_aggiudicazione: r.data_aggiudicazione,
        codice_cpv: r.codice_cpv,
        descrizione_cpv: r.descrizione_cpv,
        oggetto_gara: r.oggetto_gara,
        provincia: r.provincia,
        ruolo: r.ruolo,
        tipo_appalto: r.tipo_appalto,
        source: "scp_mit" as const,
      })),
      tedAwards: tedAwards.map((r) => ({
        ...r,
        codice_fiscale: lookupKey,
        source: "ted" as const,
      })),
    })

    const hasRealData = aggiudicatariData.length > 0

    let dataSource: "local" | "scp_mit" | "ted" | "merged" = "local"
    if (localData.length > 0 && scpData.length === 0 && tedAwards.length === 0) {
      dataSource = "local"
    } else if (scpData.length > 0 && localData.length === 0 && tedAwards.length === 0) {
      dataSource = "scp_mit"
    } else if (tedAwards.length > 0 && localData.length === 0 && scpData.length === 0) {
      dataSource = "ted"
    } else if (hasRealData) {
      dataSource = "merged"
    }

    // ── Inizializza profilo con dati VIES reali ────────────────────
    const profile: ProfilingResponse["profile"] = {
      partita_iva: lookupKey,
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
      gare_partecipate: 0,
      tasso_successo: 0,
      gare_non_aggiudicate: 0,
    }

    // Se aggiudicatari ha la denominazione e VIES non ha il nome, usa quella
    if (!profile.ragione_sociale && hasRealData) {
      profile.ragione_sociale = aggiudicatariData[0].denominazione
    }

    // ── PATH A: Dati reali da aggiudicatari (locale o SCP/MIT) ──────
    if (hasRealData) {
      const cpvMap = new Map<string, { code: string; description: string; count: number; total_value: number }>()
      const provMap = new Map<string, number>()
      const tipiMap = new Map<string, number>()
      const dates: number[] = []
      let importoTotale = 0

      for (const row of aggiudicatariData) {
        const importo = Number(row.importo_aggiudicazione) || 0
        importoTotale += importo

        if (row.data_aggiudicazione) {
          const d = new Date(row.data_aggiudicazione)
          const yr = d.getFullYear()
          if (!isNaN(d.getTime()) && yr >= 1990 && yr <= 2035) {
            dates.push(d.getTime())
          }
        }

        if (row.provincia && row.provincia.trim()) {
          const p = row.provincia.trim().toUpperCase()
          provMap.set(p, (provMap.get(p) || 0) + 1)
        }

        // Tipo contratto (da SCP/MIT abbiamo tipo_appalto nel campo ruolo extra)
        const tipoAppalto = (row as { tipo_appalto?: string | null }).tipo_appalto
        if (tipoAppalto) {
          const tipo = normalizeContractType(tipoAppalto)
          if (tipo) tipiMap.set(tipo, (tipiMap.get(tipo) || 0) + 1)
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

      // Tipi contratto
      profile.tipi_contratto = [...tipiMap.entries()]
        .map(([tipo, count]) => ({
          tipo,
          count,
          percentage: totalGare > 0 ? Math.round((count / totalGare) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count)

      // ── Calcolo tasso di successo (partecipate vs vinte) ──────────
      // CIG distinti a cui l'azienda ha partecipato (da tabella partecipanti)
      const partCigs = new Set(partecipantiData.map((r) => r.cig))
      // Aggiungi anche i CIG delle aggiudicazioni (l'azienda ha partecipato se ha vinto)
      for (const row of aggiudicatariData) {
        if (row.cig) partCigs.add(row.cig)
      }
      const garePartecipate = partCigs.size
      const gareVinte = profile.gare_vinte
      profile.gare_partecipate = garePartecipate
      profile.gare_non_aggiudicate = Math.max(0, garePartecipate - gareVinte)
      profile.tasso_successo = garePartecipate > 0
        ? Math.round((gareVinte / garePartecipate) * 100)
        : 0

      // ── Lista gare aggiudicate (per la UI espandibile) ──────────
      const recentTenders = aggiudicatariData.slice(0, 30).map((row: UnifiedAward) => ({
        cig: row.cig || "N/D",
        oggetto_gara: row.oggetto_gara || "Gara senza titolo",
        importo: Number(row.importo_aggiudicazione) || null,
        provincia: row.provincia || null,
        descrizione_cpv: row.descrizione_cpv || row.codice_cpv || null,
        data_aggiudicazione: row.data_aggiudicazione || null,
        source: row.source || "local",
      }))

      return NextResponse.json({
        profile,
        recent_tenders: recentTenders,
        dataSource,
        sources: {
          local: dedupStats.localCount,
          scp_mit: dedupStats.scpCount,
          ted: dedupStats.tedCount,
          duplicates_removed: dedupStats.duplicatesRemoved,
          total_deduped: dedupStats.totalUnique,
          partecipanti: partecipantiData.length,
        },
        ...(dataSource === "scp_mit" ? { scpMitTotal: scpData.length } : {}),
      })
    }

    // ── P.IVA non trovata: restituisci profilo vuoto con dati VIES ──
    // NON fabbrichiamo dati falsi dal campione CIG generico.
    return NextResponse.json({
      profile,
      foundInRegistry: false,
      dataSource: "none",
      sources: {
        local: dedupStats.localCount,
        scp_mit: dedupStats.scpCount,
        ted: dedupStats.tedCount,
        duplicates_removed: dedupStats.duplicatesRemoved,
        total_deduped: 0,
        partecipanti: partecipantiData.length,
      },
      message: "Nessuna aggiudicazione trovata nel database ANAC, nella banca dati SCP/MIT né sul TED europeo per questa Partita IVA.",
    })
  } catch (err) {
    console.error("[profiling] Unhandled error:", err)
    return NextResponse.json(
      { error: "Errore interno del server" },
      { status: 500 }
    )
  }
}

// ─── Helper functions ────────────────────────────────────────────────────────

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
