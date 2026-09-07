// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * enrich-aggiudicatari.mjs
 *
 * Strategia:
 *   1. Carica il CSV preprocessato (cig|importo|data) in un Map in memoria
 *   2. Pagina la tabella aggiudicatari via REST API (service role key)
 *   3. Per ogni batch di CIG, cerca nel Map e fa UPDATE Supabase
 *
 * Prerequisiti: aver eseguito lo step di estrazione CSV:
 *   node -e "..." (vedi README)
 *   oppure il file tmp/aggiudicazioni_enrichment.csv esiste già
 *
 * Uso:  node enrich-aggiudicatari.mjs [--limit N] [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
  } catch { /* ignore */ }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;
const DRY_RUN = args.includes("--dry-run");

const CSV_FILE = resolve(__dirname, "tmp/aggiudicazioni_enrichment.csv");

async function main() {
  console.log("======================================================================");
  console.log("  Enrichment Aggiudicatari — via CSV lookup + REST paginato");
  console.log("======================================================================");
  if (LIMIT < Infinity) console.log(`  Limite: ${LIMIT}`);
  if (DRY_RUN) console.log("  Dry-run: ATTIVO");

  // ── Step 1: Carica il CSV in un Map ──────────────────────────────
  console.log("\n[1] Caricamento CSV aggiudicazioni in memoria...");
  const csvContent = readFileSync(CSV_FILE, "utf-8");
  const csvLines = csvContent.split("\n");
  const lookup = new Map(); // cig → { importo, data }
  let csvLoaded = 0;
  for (const line of csvLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [cig, importo, data] = trimmed.split("|");
    if (!cig) continue;
    // Mantieni solo il primo match per CIG (dedup)
    if (!lookup.has(cig)) {
      lookup.set(cig, {
        importo: importo && importo !== "0" ? parseFloat(importo) : null,
        data: data || null,
      });
      csvLoaded++;
    }
  }
  console.log(`  ${csvLoaded} CIG distinti caricati dal CSV.`);
  console.log(`  Memoria: ~${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB`);

  // ── Step 2: Pagina la tabella aggiudicatari via REST API ─────────
  console.log("\n[2] Paginazione tabella aggiudicatari via REST...");
  let offset = 0;
  const PAGE = 1000;
  let totalRows = 0;
  let updateOk = 0;
  let updateErr = 0;
  let skipped = 0;
  let enriched = 0;
  const startTime = Date.now();

  while (enriched < LIMIT) {
    // Usa REST API diretta — senza filtro is.null (lento), controlliamo localmente
    const url = `${SUPABASE_URL}/rest/v1/aggiudicatari?select=cig,importo_aggiudicazione&order=cig&offset=${offset}&limit=${PAGE}`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!resp.ok) {
      console.error(`  REST error: ${resp.status} ${await resp.text()}`);
      break;
    }

    const rows = await resp.json();
    if (!rows || rows.length === 0) break;
    totalRows += rows.length;

    // Trova i CIG che hanno match nel CSV e non sono già arricchiti
    const toUpdate = [];
    for (const row of rows) {
      if (row.importo_aggiudicazione != null) { skipped++; continue; } // già arricchito
      const match = lookup.get(row.cig);
      if (match && (match.importo != null || match.data)) {
        toUpdate.push({ cig: row.cig, ...match });
      } else {
        skipped++;
      }
    }

    // Esegui UPDATE per ogni match
    if (!DRY_RUN) {
      for (const rec of toUpdate) {
        if (enriched >= LIMIT) break;
        const { error } = await supabase
          .from("aggiudicatari")
          .update({
            importo_aggiudicazione: rec.importo,
            data_aggiudicazione: rec.data,
          })
          .eq("cig", rec.cig);

        if (error) updateErr++;
        else updateOk++;
        enriched++;
      }
    } else {
      enriched += toUpdate.length;
      updateOk += toUpdate.length;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  Rows: ${totalRows} | Updated: ${updateOk} | Skipped: ${skipped} | Err: ${updateErr} | ${elapsed}s`);

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n======================================================================`);
  console.log(`  ENRICHMENT COMPLETATO`);
  console.log(`======================================================================`);
  console.log(`  Righe aggiudicatari lette:    ${totalRows}`);
  console.log(`  CIG con match nel CSV:        ${updateOk + updateErr}`);
  console.log(`  CIG senza match (skip):       ${skipped}`);
  console.log(`  UPDATE OK:                    ${updateOk}`);
  console.log(`  UPDATE errori:                ${updateErr}`);
  console.log(`  Tempo:                        ${elapsed}s`);
  console.log(`======================================================================`);
}

main().catch(err => { console.error("Errore fatale:", err.message); process.exit(1); });
