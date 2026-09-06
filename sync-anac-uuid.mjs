// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * sync-anac-uuid.mjs
 *
 * Risolve CIG → UUID per i bandi attivi in Supabase,
 * scaricando l'elenco dalla Piattaforma di Pubblicità a Valore Legale di ANAC
 * (pubblicitalegale.anticorruzione.it) e aggiornando il campo anac_id_avviso.
 *
 * USO:
 *   node sync-anac-uuid.mjs              → sync completo
 *   node sync-anac-uuid.mjs --limit 100  → solo i primi 100 CIG (test)
 *   node sync-anac-uuid.mjs --force      → riscrive anche UUID già presenti
 *
 * L'API /api/v0/avvisi restituisce gli avvisi paginati.
 * Il CIG è annidato in template[].template.sections[].items[].cig.
 * Ogni avviso ha un idAvviso (UUID) usato per il link diretto:
 *   https://pubblicitalegale.anticorruzione.it/bandi/{idAvviso}
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Carica .env.local ─────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local non trovato
  }
}

loadEnv();

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PVL_API = "https://pubblicitalegale.anticorruzione.it/api/v0/avvisi";
const PAGE_SIZE = 500;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const MAX_LIMIT = getArg("limit") ? parseInt(getArg("limit"), 10) : Infinity;
const FORCE = hasFlag("force");

// ── Estrai CIG da un avviso ───────────────────────────────────────────────────

function extractCigsFromAvviso(avviso) {
  const results = [];
  const uuid = avviso.idAvviso;
  if (!uuid) return results;

  try {
    const templates = avviso.template || [];
    for (const t of templates) {
      const sections = t?.template?.sections || [];
      for (const section of sections) {
        const items = section?.items || [];
        for (const item of items) {
          if (item.cig) {
            results.push({ cig: item.cig, uuid });
          }
        }
      }
    }
  } catch {
    // struttura inattesa, skip
  }

  return results;
}

// ── Fetch una pagina dall'API PVL ─────────────────────────────────────────────

async function fetchPage(page, retries = 3, codiceScheda = "2,4") {
  let url = `${PVL_API}?page=${page}&size=${PAGE_SIZE}&sortField=dataPubblicazione&sortDirection=desc`;
  if (codiceScheda) url += `&codiceScheda=${codiceScheda}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      return data;
    } catch (e) {
      if (attempt === retries) throw e;
      const wait = attempt * 2000;
      console.warn(`  ⚠️ Tentativo ${attempt}/${retries} fallito: ${e.message} — attesa ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString("it-IT");

  console.log("═".repeat(70));
  console.log("  ANAC PVL → Supabase UUID Sync");
  console.log(`  ${today}`);
  console.log("═".repeat(70));
  if (MAX_LIMIT < Infinity) console.log(`  📊 Limite CIG: ${MAX_LIMIT}`);
  if (FORCE) console.log(`  🔄 Modalità force: riscrittura UUID esistenti`);
  console.log("");

  // 1. Carica i CIG attivi da Supabase che hanno bisogno dell'UUID (paginato)
  console.log("📋 Caricamento CIG attivi da Supabase...");

  const allCigs = [];
  const SB_PAGE = 1000;
  let sbOffset = 0;

  while (true) {
    let query = supabase
      .from("cig")
      .select("cig, anac_id_avviso")
      .eq("stato", "active")
      .range(sbOffset, sbOffset + SB_PAGE - 1);

    if (!FORCE) {
      query = query.is("anac_id_avviso", null);
    }

    const { data, error: fetchErr } = await query;

    if (fetchErr) {
      console.error("❌ Errore lettura Supabase:", fetchErr.message);
      process.exit(1);
    }

    if (!data || data.length === 0) break;
    allCigs.push(...data);
    if (data.length < SB_PAGE) break;
    sbOffset += SB_PAGE;
  }

  const needsUuid = new Set(
    allCigs
      .slice(0, MAX_LIMIT)
      .map((r) => r.cig)
  );

  console.log(`  📌 CIG da risolvere: ${needsUuid.size}`);

  if (needsUuid.size === 0) {
    console.log("✅ Tutti i CIG attivi hanno già un UUID. Niente da fare.");
    return;
  }

  // Stato condiviso tra i passaggi
  const cigToUuid = new Map();
  let totalAvvisi = 0;
  let resolvedCount = 0;

  // Funzione di scansione riutilizzabile
  async function scanPages(codiceScheda, label, maxPages = Infinity) {
    const firstPage = await fetchPage(0, 3, codiceScheda);
    const totalElements = firstPage?.totalElements || 0;
    const totalPages = Math.min(Math.ceil(totalElements / PAGE_SIZE), maxPages);

    console.log(`  📊 Totale avvisi (${label}): ${totalElements} (~${totalPages} pagine${maxPages < Infinity ? ', max ' + maxPages : ''})`);

    // Processa la prima pagina
    for (const avviso of firstPage?.content || []) {
      const pairs = extractCigsFromAvviso(avviso);
      for (const { cig, uuid } of pairs) {
        if (needsUuid.has(cig) && !cigToUuid.has(cig)) {
          cigToUuid.set(cig, uuid);
          resolvedCount++;
        }
      }
    }
    totalAvvisi += (firstPage?.content || []).length;
    process.stdout.write(`\r  📄 Pagina 1/${totalPages} — risolti: ${resolvedCount}/${needsUuid.size}`);

    // Paginazione
    for (let p = 1; p < totalPages; p++) {
      if (resolvedCount >= needsUuid.size) {
        console.log(`\n  ✅ Tutti i CIG risolti! Interrompo alla pagina ${p}.`);
        break;
      }

      try {
        const data = await fetchPage(p, 3, codiceScheda);
        const content = data?.content || [];
        totalAvvisi += content.length;

        for (const avviso of content) {
          const pairs = extractCigsFromAvviso(avviso);
          for (const { cig, uuid } of pairs) {
            if (needsUuid.has(cig) && !cigToUuid.has(cig)) {
              cigToUuid.set(cig, uuid);
              resolvedCount++;
            }
          }
        }

        process.stdout.write(`\r  📄 Pagina ${p + 1}/${totalPages} — risolti: ${resolvedCount}/${needsUuid.size}    `);

        if (content.length < PAGE_SIZE) break;
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        console.error(`\n  ❌ Errore pagina ${p + 1}: ${e.message}`);
        break;
      }
    }
    console.log("");
  }

  // ── PASSAGGIO 1: codiceScheda=2,4 (bulk scan) ──────────────────────────────
  console.log("\n📡 Passaggio 1: Scansione bulk (codiceScheda=2,4)...");
  await scanPages("2,4", "codiceScheda=2,4");

  console.log(`\n📥 Avvisi scansionati: ${totalAvvisi}`);
  console.log(`🔗 CIG risolti dopo passaggio 1: ${cigToUuid.size}/${needsUuid.size}`);

  // ── PASSAGGIO 2: lookup puntuale per CIG non trovati (max 500 per run) ──────
  const missing = [...needsUuid].filter((cig) => !cigToUuid.has(cig));
  const LOOKUP_LIMIT = 500;
  const lookupBatch = missing.slice(0, LOOKUP_LIMIT);

  if (lookupBatch.length > 0) {
    console.log(`\n📡 Passaggio 2: Keyword lookup per ${lookupBatch.length}/${missing.length} CIG mancanti...`);
    let lookupResolved = 0;

    for (let i = 0; i < lookupBatch.length; i++) {
      const cig = lookupBatch[i];
      try {
        // Usa keywords=CIG con codiceScheda=4 per trovare bandi P1_16 etc.
        const url = `${PVL_API}?keywords=${encodeURIComponent(cig)}&codiceScheda=4&size=5&page=0`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          const data = await res.json();
          for (const avviso of data.content || []) {
            if (!avviso.attivo) continue;
            const pairs = extractCigsFromAvviso(avviso);
            const match = pairs.find((p) => p.cig === cig);
            if (match) {
              cigToUuid.set(cig, match.uuid);
              resolvedCount++;
              lookupResolved++;
              break;
            }
          }
        }
      } catch {
        // Skip errori singoli
      }

      if ((i + 1) % 50 === 0 || i === lookupBatch.length - 1) {
        process.stdout.write(`\r  🔍 ${i + 1}/${lookupBatch.length} cercati — trovati: ${lookupResolved}`);
      }

      // Pausa breve per non sovraccaricare
      if ((i + 1) % 10 === 0) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    console.log(`\n  ✅ Passaggio 2: ${lookupResolved} UUID trovati tramite keyword lookup`);
    if (missing.length > LOOKUP_LIMIT) {
      console.log(`  ℹ️  ${missing.length - LOOKUP_LIMIT} CIG rimanenti verranno cercati nei prossimi run`);
    }
  }

  console.log(`\n🔗 CIG risolti totali: ${cigToUuid.size}/${needsUuid.size}`);

  // 3. Aggiorna Supabase con gli UUID trovati
  if (cigToUuid.size === 0) {
    console.log("\n⚠️ Nessun UUID trovato. I CIG potrebbero non essere ancora su PVL.");
    return;
  }

  console.log("\n💾 Aggiornamento Supabase...");
  let updated = 0;
  let errors = 0;

  const entries = [...cigToUuid.entries()];

  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);

    for (const [cig, uuid] of batch) {
      const { error } = await supabase
        .from("cig")
        .update({ anac_id_avviso: uuid })
        .eq("cig", cig);

      if (error) {
        errors++;
        if (errors <= 5) console.error(`  ❌ ${cig}: ${error.message}`);
      } else {
        updated++;
      }
    }

    process.stdout.write(`\r  💾 ${updated}/${cigToUuid.size} aggiornati...`);

    // Pausa ogni 50 per evitare rate limit Supabase
    if (i + 50 < entries.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // 4. Riepilogo
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n" + "═".repeat(70));
  console.log("  ✅ SYNC UUID COMPLETATO");
  console.log("═".repeat(70));
  console.log(`  📥 Avvisi scansionati:      ${totalAvvisi}`);
  console.log(`  🔗 CIG → UUID mappati:      ${cigToUuid.size}`);
  console.log(`  💾 Aggiornati su Supabase:   ${updated}`);
  if (errors > 0) console.log(`  ❌ Errori:                  ${errors}`);
  console.log(`  ⏱️  Tempo totale:             ${elapsed}s`);
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("\n❌ Errore fatale:", err.message);
  process.exit(1);
});
