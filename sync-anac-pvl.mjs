// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * sync-anac-pvl.mjs
 *
 * Sincronizza i bandi attivi da ANAC PVL → Supabase.
 * SOSTITUTO di sync-anac.mjs + sync-anac-uuid.mjs.
 *
 * VANTAGGI rispetto a sync-anac.mjs (Playwright/Superset):
 *   - Nessun Playwright / browser headless necessario
 *   - Funziona da qualsiasi cloud (Vercel, GitHub Actions, ecc.)
 *   - ~73K bandi attivi (vs ~8K di Superset ds81)
 *   - Include data_scadenza_offerta (Superset non ce l'ha)
 *   - Include UUID (anac_id_avviso) nativamente (elimina sync-anac-uuid.mjs)
 *   - Include link documenti di gara
 *
 * LOGICA:
 *   1. fetch paginato su PVL API (codiceScheda=4, bandi di gara)
 *   2. Estrae CIG + dati dai template annidati (SEZ. A/B/C)
 *   3. Upsert su Supabase (per CIG, no duplicati)
 *   4. Bandi in Supabase che NON sono più su PVL → marcati "closed"
 *
 * USO:
 *   node sync-anac-pvl.mjs                  → sync completo
 *   node sync-anac-pvl.mjs --limit 500      → solo i primi 500 CIG (test)
 *   node sync-anac-pvl.mjs --query "scuola" → solo bandi con "scuola"
 *
 * SCHEDULAZIONE:
 *   GitHub Actions cron: ogni 6 ore
 *   Vercel Cron: ogni 6 ore
 *   Windows Task Scheduler: come prima
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
const PAGE_SIZE = 100; // PVL restituisce max 100 per pagina in modo stabile

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const MAX_CIGS = getArg("limit") ? parseInt(getArg("limit"), 10) : Infinity;
const SEARCH_QUERY = getArg("query") || null;

// ── PVL Template Parser ───────────────────────────────────────────────────────

/**
 * Estrae i record CIG da un avviso PVL.
 *
 * Struttura PVL:
 *   avviso.templates[].template.metadata   → titolo, descrizione
 *   avviso.templates[].template.sections[] → sezioni A/B/C
 *     SEZ. A - Committente  → fields.soggetti_sa[].denominazione_amministrazione
 *     SEZ. B - Dati Generali → fields.tipo_procedura_aggiudicazione, documenti_di_gara_link
 *     SEZ. C - Oggetto       → items[].cig, .descrizione, .cpv, .importo, .luogo, ecc.
 */
function extractFromPVL(avviso) {
  const records = [];
  const uuid = avviso.idAvviso;
  const dataPub = avviso.dataPubblicazione;
  const dataScad = avviso.dataScadenza;

  const tpls = avviso.templates || avviso.template || [];
  for (const tpl of tpls) {
    const t = tpl.template || tpl;
    const metadata = t.metadata || {};
    const sections = t.sections || [];

    let stazione = null;
    let tipoProcedura = null;

    for (const sec of sections) {
      // SEZ. A — Committente
      if (sec.fields?.soggetti_sa) {
        const sa = sec.fields.soggetti_sa[0];
        if (sa?.denominazione_amministrazione) {
          stazione = sa.denominazione_amministrazione;
        }
      }

      // SEZ. B — Dati Generali
      if (sec.fields?.tipo_procedura_aggiudicazione) {
        tipoProcedura = sec.fields.tipo_procedura_aggiudicazione;
      }

      // SEZ. C — Oggetto (contiene i lotti con CIG)
      if (sec.items) {
        for (const item of sec.items) {
          if (!item.cig) continue;

          records.push({
            cig: item.cig,
            uuid,
            dataPubblicazione: dataPub,
            dataScadenza: item.termine_ricezione || dataScad,
            oggetto: item.descrizione || metadata.descrizione || null,
            importo: item.valore_complessivo_stimato ?? null,
            cpv: item.cpv || null,
            natura: item.natura_principale || null,
            luogo: item.luogo_nuts || item.luogo_istat || null,
            stazione,
            tipoProcedura,
          });
        }
      }
    }
  }

  return records;
}

// ── Mapping PVL → Supabase ────────────────────────────────────────────────────

/** Tronca stringhe lunghe per rientrare nei limiti varchar di Supabase */
function trunc(val, max = 3990) {
  if (!val || typeof val !== "string") return val || null;
  return val.length > max ? val.slice(0, max) + "…" : val;
}

/**
 * Mappa natura_principale PVL → oggetto_principale_contratto Superset/Supabase
 * PVL usa "Servizi", "Lavori", "Forniture" → Superset usa le stesse ma in maiuscolo
 */
const NATURA_MAP = {
  Servizi: "SERVIZI",
  Lavori: "LAVORI",
  Forniture: "FORNITURE",
};

function mapToSupabase(rec) {
  // Data pubblicazione: PVL dà ISO string, Supabase vuole DATE
  const dataPub = rec.dataPubblicazione
    ? rec.dataPubblicazione.split("T")[0]
    : null;

  // Data scadenza: PVL dà ISO string con timezone
  const dataScad = rec.dataScadenza
    ? rec.dataScadenza.split("T")[0]
    : null;

  // CPV: PVL dà "85320000_Servizi sociali" → separiamo codice e descrizione
  let cpvDesc = null;
  if (rec.cpv) {
    cpvDesc = rec.cpv;
  }

  // Luogo → provincia / sezione_regionale
  const luogo = rec.luogo ? trunc(rec.luogo, 95) : null;

  return {
    cig: rec.cig,
    oggetto_gara: trunc(rec.oggetto),
    importo_lotto: typeof rec.importo === "number" ? rec.importo : null,
    oggetto_principale_contratto: NATURA_MAP[rec.natura] || trunc(rec.natura, 490),
    stato: "active",
    provincia: luogo,
    data_pubblicazione: dataPub,
    data_scadenza_offerta: dataScad,
    sezione_regionale: luogo, // PVL fornisce luogo NUTS/ISTAT
    descrizione_cpv: trunc(cpvDesc, 990),
    denominazione_amministrazione_appaltante: trunc(rec.stazione, 3990),
    anac_id_avviso: rec.uuid,
    esito: null,
  };
}

// ── Fetch PVL con retry ───────────────────────────────────────────────────────

async function fetchPVLPage(page, retries = 3) {
  let url = `${PVL_API}?page=${page}&size=${PAGE_SIZE}&codiceScheda=4&sortField=dataPubblicazione&sortDirection=desc`;
  if (SEARCH_QUERY) {
    url += `&keywords=${encodeURIComponent(SEARCH_QUERY)}`;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
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
  console.log("  ANAC PVL → Supabase Sync — Bandi Attivi");
  console.log(`  ${today}`);
  console.log("═".repeat(70));
  console.log("  📡 Fonte: pubblicitalegale.anticorruzione.it (API REST)");
  console.log("  🚫 Nessun Playwright / browser necessario");
  if (SEARCH_QUERY) console.log(`  🔍 Filtro: "${SEARCH_QUERY}"`);
  if (MAX_CIGS < Infinity) console.log(`  📊 Limite: ${MAX_CIGS} CIG`);
  console.log("");

  // 1. Conta totale
  console.log("📡 Connessione PVL API...");
  const firstPage = await fetchPVLPage(0);
  const totalAvvisi = firstPage.totalElements || 0;
  const totalPages = firstPage.totalPages || 0;
  console.log(`✅ Connessione OK`);
  console.log(`📊 Totale avvisi disponibili: ${totalAvvisi.toLocaleString("it-IT")} (${totalPages} pagine)\n`);

  // 2. Scarica tutti gli avvisi paginando
  const allCigs = new Set();
  const allRecords = [];
  let totalAvvisiProcessed = 0;

  // Processa la prima pagina (già scaricata)
  for (const avviso of firstPage.content || []) {
    const extracted = extractFromPVL(avviso);
    for (const rec of extracted) {
      if (!allCigs.has(rec.cig)) {
        allCigs.add(rec.cig);
        allRecords.push(mapToSupabase(rec));
      }
    }
  }
  totalAvvisiProcessed += (firstPage.content || []).length;
  process.stdout.write(`  📄 Pagina 1/${totalPages} — ${allCigs.size} CIG ✓`);

  // Paginazione
  for (let p = 1; p < totalPages; p++) {
    if (allCigs.size >= MAX_CIGS) {
      console.log(`\n  📊 Limite ${MAX_CIGS} CIG raggiunto, fermo alla pagina ${p}.`);
      break;
    }

    try {
      const data = await fetchPVLPage(p);
      const content = data?.content || [];
      totalAvvisiProcessed += content.length;

      for (const avviso of content) {
        const extracted = extractFromPVL(avviso);
        for (const rec of extracted) {
          if (!allCigs.has(rec.cig) && allCigs.size < MAX_CIGS) {
            allCigs.add(rec.cig);
            allRecords.push(mapToSupabase(rec));
          }
        }
      }

      process.stdout.write(`\r  📄 Pagina ${p + 1}/${totalPages} — ${allCigs.size} CIG    `);

      if (content.length < PAGE_SIZE) break;

      // Pausa tra le pagine (rispetto rate limit informale)
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.error(`\n  ❌ Errore pagina ${p + 1}: ${e.message}`);
      // Continua con le pagine successive
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\n\n📥 Totale: ${totalAvvisiProcessed} avvisi processati → ${allCigs.size} CIG univoci`);

  // 3. Upsert su Supabase
  console.log("\n💾 Scrittura su Supabase...");
  let totalUpserted = 0;

  for (let i = 0; i < allRecords.length; i += 100) {
    const batch = allRecords.slice(i, i + 100);
    const { error } = await supabase
      .from("cig")
      .upsert(batch, { onConflict: "cig", ignoreDuplicates: false });

    if (error) {
      console.error(`  ❌ Errore batch ${Math.floor(i / 100) + 1}:`, error.message);
    } else {
      totalUpserted += batch.length;
      process.stdout.write(
        `\r  💾 ${totalUpserted}/${allRecords.length} bandi scritti...`
      );
    }
  }
  console.log(`\r  💾 ${totalUpserted}/${allRecords.length} bandi scritti ✓    `);

  // 4. Chiudi i bandi scaduti (in Supabase ma non più su PVL)
  console.log("\n🧹 Pulizia bandi scaduti...");

  // ⛑️ Safety check: se non abbiamo scaricato nulla, PVL è probabilmente
  // down. NON marcare tutto come "closed" altrimenti il sito resta vuoto.
  if (allCigs.size === 0) {
    console.log("  ⚠️  Nessun bando scaricato — pulizia SALTATA per sicurezza.");
    console.log("     (Se PVL è down, marcare tutto come 'closed' cancellerebbe il sito)");
  } else {
    // Supabase restituisce max 1000 righe — paginiamo per prenderli tutti
    let allActive = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data: batch, error: fetchErr } = await supabase
        .from("cig")
        .select("cig")
        .eq("stato", "active")
        .range(from, from + pageSize - 1);

      if (fetchErr) {
        console.error("  ❌ Errore lettura Supabase:", fetchErr.message);
        break;
      }
      if (!batch || batch.length === 0) break;
      allActive.push(...batch);
      from += batch.length;
      if (batch.length < pageSize) break;
    }

    if (allActive.length > 0) {
      const stale = allActive.filter((r) => !allCigs.has(r.cig)).map((r) => r.cig);

      if (stale.length > 0) {
        for (let i = 0; i < stale.length; i += 100) {
          const batch = stale.slice(i, i + 100);
          const { error: updateErr } = await supabase
            .from("cig")
            .update({ stato: "closed" })
            .in("cig", batch);

          if (updateErr) {
            console.error(`  ❌ Errore chiusura batch:`, updateErr.message);
          }
        }
        console.log(`  🗑️  ${stale.length} bandi non più attivi → stato "closed"`);
      } else {
        console.log("  ✅ Nessun bando scaduto da chiudere");
      }
    }
  }

  // 5. Riepilogo
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "═".repeat(70));
  console.log("  ✅ SINCRONIZZAZIONE COMPLETATA");
  console.log("═".repeat(70));
  console.log(`  📡 Fonte:               PVL API (no Playwright)`);
  console.log(`  📥 Avvisi processati:    ${totalAvvisiProcessed}`);
  console.log(`  🔗 CIG univoci:         ${allCigs.size}`);
  console.log(`  💾 Aggiornati Supabase:  ${totalUpserted}`);
  console.log(`  🆔 UUID inclusi:         sì (anac_id_avviso)`);
  console.log(`  📅 Scadenze incluse:     sì (data_scadenza_offerta)`);
  console.log(`  ⏱️  Tempo totale:         ${elapsed}s`);
  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("\n❌ Errore fatale:", err.message);
  process.exit(1);
});
