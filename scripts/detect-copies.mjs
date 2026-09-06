#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * scripts/detect-copies.mjs — Rileva copie del codice su GitHub
 *
 * Cerca stringhe uniche del progetto tramite GitHub Code Search API.
 * Segnala qualsiasi repo (non il nostro) che contenga il watermark o
 * nomi di funzione/file unici del progetto.
 *
 * Uso:
 *   node scripts/detect-copies.mjs                  # cerca su GitHub
 *   node scripts/detect-copies.mjs --forks          # mostra anche i fork
 *
 * Richiede: GITHUB_TOKEN (con scope 'repo' o 'public_repo')
 * oppure: gh CLI autenticato (fallback)
 */

const OWNER = "GiacomoMarani"
const REPO  = "ANAC-DB-codex"
const WATERMARK = "GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d"

// Stringhe uniche da cercare — chiunque copi il codice avrà almeno una di queste
const SEARCH_QUERIES = [
  WATERMARK,                              // Watermark UUID
  "ANAC-DB-codex",                        // Nome progetto
  "fetchItaFromDB",                       // Funzione unica nostra
  "ITA_SOURCE_MAP",                       // Costante unica nostra
  "sync-ita.mjs",                         // Script unico nostro
  "intl_created_at",                      // Colonna DB unica nostra
]

const SHOW_FORKS = process.argv.includes("--forks")

async function searchGitHub(query) {
  const token = process.env.GITHUB_TOKEN
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=20`

  const headers = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "ANAC-DB-codex-copy-detector/1.0",
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })

  if (res.status === 403) {
    console.error("⚠️  Rate limit raggiunto. Usa GITHUB_TOKEN per più richieste.")
    return null
  }
  if (!res.ok) {
    console.error(`⚠️  GitHub API error ${res.status}: ${await res.text()}`)
    return null
  }

  const data = await res.json()
  return data
}

async function checkForks() {
  const token = process.env.GITHUB_TOKEN
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/forks?per_page=100`
  const headers = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "ANAC-DB-codex-copy-detector/1.0",
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  if (!res.ok) return []
  return await res.json()
}

async function main() {
  console.log("🔍 ANAC-DB-codex Copy Detector")
  console.log("=" .repeat(60))
  console.log()

  // 1. Check forks
  console.log("📋 Fork pubblici:")
  const forks = await checkForks()
  if (forks.length === 0) {
    console.log("   ✅ Nessun fork trovato")
  } else {
    console.log(`   ⚠️  ${forks.length} fork trovati:`)
    for (const f of forks) {
      console.log(`   - ${f.full_name} (${f.html_url}) — creato ${f.created_at.slice(0, 10)}`)
    }
  }
  console.log()

  // 2. Search code
  console.log("🔎 Ricerca codice su GitHub:")
  let suspiciousRepos = new Set()

  for (const query of SEARCH_QUERIES) {
    // Rate limit: 10 req/min per utenti non autenticati
    await new Promise(r => setTimeout(r, 6500))

    console.log(`\n   Cerco: "${query}"...`)
    const result = await searchGitHub(query)
    if (!result) continue

    const otherRepos = (result.items || [])
      .filter(item => {
        const repo = item.repository.full_name
        if (repo === `${OWNER}/${REPO}`) return false
        if (!SHOW_FORKS && forks.some(f => f.full_name === repo)) return false
        return true
      })

    if (otherRepos.length === 0) {
      console.log(`   ✅ Nessuna copia trovata`)
    } else {
      for (const item of otherRepos) {
        const repo = item.repository.full_name
        console.log(`   🚨 COPIA TROVATA: ${repo}`)
        console.log(`      File: ${item.path}`)
        console.log(`      URL: ${item.html_url}`)
        suspiciousRepos.add(repo)
      }
    }
  }

  // 3. Summary
  console.log("\n" + "=".repeat(60))
  if (suspiciousRepos.size === 0) {
    console.log("✅ Nessuna copia non autorizzata trovata.")
  } else {
    console.log(`🚨 ${suspiciousRepos.size} repo sospetti trovati:`)
    for (const repo of suspiciousRepos) {
      console.log(`   - https://github.com/${repo}`)
    }
    console.log("\n   Azione: verifica se rispettano la AGPL-3.0 (sorgente pubblico, attribuzione).")
  }

  console.log(`\n📊 Fork totali: ${forks.length}`)
  console.log(`🔍 Query eseguite: ${SEARCH_QUERIES.length}`)
}

main().catch(e => { console.error("Errore:", e.message); process.exit(1) })
