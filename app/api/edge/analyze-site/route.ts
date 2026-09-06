// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
import { NextRequest, NextResponse } from "next/server"

export const runtime = "edge"

// CPV macro-categories for matching (top-level divisions)
const CPV_CATEGORIES: Record<string, string[]> = {
  "03": ["agricoltura", "orticoltura", "pesca", "silvicoltura", "allevamento"],
  "09": ["petrolio", "gas", "carburante", "combustibile", "energia"],
  "14": ["minerali", "metalli", "pietre"],
  "15": ["alimentari", "bevande", "cibo", "food"],
  "16": ["macchine", "attrezzature", "agricole"],
  "18": ["abbigliamento", "tessuti", "calzature", "moda"],
  "19": ["cuoio", "pelle"],
  "22": ["stampa", "editoria", "pubblicazioni", "libri"],
  "24": ["chimica", "farmaceutica", "pesticidi"],
  "30": ["computer", "informatica", "hardware", "ufficio"],
  "31": ["elettronica", "elettricità", "illuminazione"],
  "32": ["radio", "televisione", "telecomunicazioni"],
  "33": ["medico", "sanitario", "ospedale", "farmaci", "chirurgia"],
  "34": ["trasporto", "veicoli", "auto", "autobus"],
  "35": ["sicurezza", "difesa", "polizia"],
  "37": ["sport", "giochi", "intrattenimento"],
  "38": ["laboratorio", "ottica", "strumenti scientifici", "misura"],
  "39": ["arredamento", "mobili", "cucine"],
  "41": ["acqua", "trattamento acque"],
  "42": ["industriale", "macchinari", "impianti"],
  "43": ["costruzione", "miniere", "escavazione"],
  "44": ["costruzioni", "materiali edili"],
  "45": ["lavori", "edilizia", "costruzione", "opere civili"],
  "48": ["software", "sviluppo", "applicazioni", "cloud", "saas"],
  "50": ["manutenzione", "riparazione", "installazione"],
  "51": ["installazione"],
  "55": ["ristorazione", "alberghiero", "catering", "hotel"],
  "60": ["trasporti", "logistica", "spedizioni", "corriere"],
  "63": ["servizi trasporto", "porto", "aeroporto"],
  "64": ["poste", "telecomunicazioni", "telefonia"],
  "65": ["gas", "acqua", "pubblica utilità"],
  "66": ["assicurazioni", "banca", "finanza"],
  "70": ["immobiliare", "affitti", "gestione edifici"],
  "71": ["architettura", "ingegneria", "progettazione"],
  "72": ["informatica", "it", "software", "cybersecurity", "cloud", "sistemi informativi"],
  "73": ["ricerca", "sviluppo", "r&d", "innovazione"],
  "75": ["pubblica amministrazione", "difesa", "sicurezza sociale"],
  "76": ["petrolio", "gas naturale"],
  "77": ["giardinaggio", "verde pubblico", "forestale"],
  "79": ["consulenza", "gestione", "risorse umane", "formazione"],
  "80": ["istruzione", "formazione", "università", "scuola"],
  "85": ["sanità", "sociale", "assistenza", "welfare"],
  "90": ["fognatura", "rifiuti", "smaltimento", "pulizia", "sanificazione"],
  "92": ["cultura", "sport", "giochi", "intrattenimento"],
  "98": ["servizi personali", "lavanderia", "parrucchieri"],
}

function guessCpvFromText(text: string): string[] {
  const lower = text.toLowerCase()
  const matches: string[] = []
  for (const [cpvCode, keywords] of Object.entries(CPV_CATEGORIES)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matches.push(cpvCode)
    }
  }
  return [...new Set(matches)].slice(0, 3)
}

async function scrapeWebsite(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TenderBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ""
    const html = await res.text()
    // Strip HTML tags and extract readable text
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000)
  } catch {
    return ""
  }
}

async function analyzeWithGemini(text: string, url: string): Promise<{
  company: { name: string; sector: string; description: string }
  keywords: string[]
  cpv_ids: string[]
}> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new Error("GEMINI_API_KEY non configurata")

  const prompt = `Analizza il seguente testo estratto dal sito web aziendale "${url}".
Rispondi SOLO con un JSON valido (nessun testo prima o dopo) con questa struttura:
{
  "company": {
    "name": "nome dell'azienda",
    "sector": "settore principale in italiano",
    "description": "descrizione breve dell'azienda in italiano (max 100 parole)"
  },
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "cpv_ids": ["codice CPV a 2 cifre", "secondo CPV"]
}

Le keywords devono essere termini tecnici specifici dei prodotti/servizi offerti, utili per trovare gare d'appalto pertinenti.
I cpv_ids devono essere le prime 2 cifre dei codici CPV europei più rilevanti per questa azienda.

Testo del sito:
${text.slice(0, 3000)}`

  const apiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(15000),
    }
  )

  if (!apiRes.ok) throw new Error(`Gemini API error: ${apiRes.status}`)
  const geminiData = await apiRes.json()
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""

  // Extract JSON from response
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Risposta Gemini non valida")
  return JSON.parse(jsonMatch[0])
}

function fallbackAnalysis(text: string, url: string): {
  company: { name: string; sector: string; description: string }
  keywords: string[]
  cpv_ids: string[]
} {
  // Extract domain name as company name fallback
  const domain = url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0].split(".")[0]
  const cpvIds = guessCpvFromText(text)
  
  // Extract potential keywords (nouns, 4+ chars, not common words)
  const stopwords = new Set(["della", "delle", "dello", "degli", "nella", "nelle", "sono", "viene", "questa", "nostro", "nostra", "tutti", "tutte"])
  const words = text.toLowerCase().match(/[a-zàáèéìíòóùú]{4,}/g) || []
  const freq: Record<string, number> = {}
  for (const w of words) {
    if (!stopwords.has(w)) freq[w] = (freq[w] ?? 0) + 1
  }
  const keywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)

  return {
    company: {
      name: domain.charAt(0).toUpperCase() + domain.slice(1),
      sector: cpvIds.length > 0 ? `Settore CPV ${cpvIds[0]}` : "Servizi generali",
      description: text.slice(0, 200),
    },
    keywords: keywords.slice(0, 5),
    cpv_ids: cpvIds,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const url: string = body?.url?.trim()

    if (!url || !url.startsWith("http")) {
      return NextResponse.json({ error: "URL non valido" }, { status: 400 })
    }

    // 1. Scrape website
    const siteText = await scrapeWebsite(url)

    // 2. Analyze with Gemini (or fallback to rule-based)
    let analysis
    try {
      analysis = await analyzeWithGemini(siteText || url, url)
    } catch {
      analysis = fallbackAnalysis(siteText || url, url)
    }

    // 3. Ensure CPV IDs are valid 2-digit strings
    const cpv_ids = (analysis.cpv_ids || [])
      .map((c: unknown) => String(c).padStart(2, "0").slice(0, 2))
      .filter((c: string) => /^\d{2}$/.test(c))
      .slice(0, 3)

    const lead_id = crypto.randomUUID()

    return NextResponse.json({
      success: true,
      lead_id,
      company: analysis.company,
      keywords: analysis.keywords?.slice(0, 8) || [],
      cpv_ids: cpv_ids.length > 0 ? cpv_ids : ["72"],
      site_pages: siteText ? Math.ceil(siteText.length / 2000) : 1,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore interno" },
      { status: 500 }
    )
  }
}
