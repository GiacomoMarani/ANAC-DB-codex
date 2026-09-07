// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

import { createClient } from "@supabase/supabase-js";
import { createWriteStream, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// -- Carica .env.local --

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

// -- Config --

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ZIP_URL = "https://dati.anticorruzione.it/opendata/download/dataset/aggiudicatari/filesystem/aggiudicatari_json.zip";
const TMP_DIR = resolve(__dirname, "tmp");
const ZIP_PATH = resolve(TMP_DIR, "aggiudicatari.zip");
const EXTRACT_DIR = resolve(TMP_DIR, "aggiudicatari");

// -- CLI args --

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf("--" + name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes("--" + name);
}

const LIMIT = getArg("limit") ? parseInt(getArg("limit"), 10) : Infinity;
const ENRICH = hasFlag("enrich");
const DRY_RUN = hasFlag("dry-run");

// -- Download con retry --

async function downloadFile(url, dest, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[+] Download ${url} (Tentativo ${attempt}/${retries})...`);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        }
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const fileStream = createWriteStream(dest);
      if (res.body.pipeTo) {
         // Se fetch res.body è un Web ReadableStream, usiamo un trucco per scriverlo su disco
         const reader = res.body.getReader();
         while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            fileStream.write(value);
         }
         fileStream.end();
      } else {
         throw new Error("res.body non è leggibile");
      }
      
      console.log(`[+] Download completato in ${dest}`);
      return;
    } catch (e) {
      if (attempt === retries) throw e;
      const wait = attempt * 2000;
      console.warn(`  [!] Errore download: ${e.message}. Riprovo tra ${wait/1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// -- Main --

async function main() {
  const startTime = Date.now();

  console.log("======================================================================");
  console.log("  ANAC Aggiudicatari -> Supabase Sync");
  console.log("======================================================================");
  if (LIMIT < Infinity) console.log("  Limite: " + LIMIT + " records");
  if (ENRICH) console.log("  Enrichment CIG attivato");
  if (DRY_RUN) console.log("  Dry-run: i dati non verranno scritti sul DB");
  console.log("");

  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

  // 1. Download
  console.log("\n[1] Scaricamento dati...");
  await downloadFile(ZIP_URL, ZIP_PATH);

  // 2. Estrazione
  console.log("\n[2] Estrazione ZIP...");
  if (!existsSync(EXTRACT_DIR)) mkdirSync(EXTRACT_DIR, { recursive: true });
  
  try {
    const cmd = `powershell -command "Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${EXTRACT_DIR}' -Force"`;
    await execAsync(cmd);
    console.log("  Estrazione completata");
  } catch (err) {
    console.error("  Errore estrazione ZIP:", err.message);
    process.exit(1);
  }

  // Trova il file JSON
  let jsonFile = null;
  const files = readdirSync(EXTRACT_DIR);
  for (const f of files) {
    if (f.endsWith(".json")) {
      jsonFile = join(EXTRACT_DIR, f);
      break;
    }
  }

  if (!jsonFile) {
    console.error("Nessun file JSON trovato nello zip.");
    process.exit(1);
  }

  // 3. Lettura e parsing
  console.log("\n[3] Lettura JSON...");
  const stats = statSync(jsonFile);
  console.log(`  File: ${jsonFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  
  let records = [];
  try {
    const content = readFileSync(jsonFile, "utf-8");
    // ANAC usa NDJSON (JSON Lines): un oggetto JSON per riga
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch { /* skip malformed lines */ }
    }
    console.log(`  Trovati ${records.length} records nel JSON (formato NDJSON)`);
  } catch (err) {
    console.error("Errore lettura file:", err.message);
    process.exit(1);
  }

  // 4. Elaborazione
  console.log("\n[4] Elaborazione records...");
  let processed = 0;
  const validRecords = [];
  const cigSet = new Set();

  for (const rec of records) {
    if (processed >= LIMIT) break;
    processed++;

    if (!rec.cig) continue;

    let cf = rec.codice_fiscale || "";
    cf = cf.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (cf.length < 11) continue;

    const importo = parseFloat(rec.importo_aggiudicazione);
    const parsedImporto = isNaN(importo) ? null : importo;

    const mapped = {
      cig: String(rec.cig).trim().substring(0, 50),
      codice_fiscale: cf,
      denominazione: rec.denominazione ? String(rec.denominazione).substring(0, 1000) : null,
      tipo_soggetto: rec.tipo_soggetto ? String(rec.tipo_soggetto).substring(0, 200) : null,
      ruolo: rec.ruolo ? String(rec.ruolo).substring(0, 100) : null,
      importo_aggiudicazione: parsedImporto
    };

    validRecords.push(mapped);
    cigSet.add(rec.cig);
  }

  console.log(`  Records validi: ${validRecords.length}`);

  // 5. Enrichment (Opzionale)
  if (ENRICH && validRecords.length > 0) {
    console.log("\n[5] Enrichment CIG...");
    const cigArray = Array.from(cigSet);
    const cigCache = new Map();
    
    // Batch lookup 
    let lookups = 0;
    for (let i = 0; i < cigArray.length; i += 500) {
      const batchCigs = cigArray.slice(i, i + 500);
      const { data, error } = await supabase
        .from("cig")
        .select("cig, codice_cpv, descrizione_cpv, oggetto_gara, provincia")
        .in("cig", batchCigs);
        
      if (error) {
         console.warn(`  Errore lookup batch ${i}: ${error.message}`);
         continue;
      }
      
      if (data) {
        for (const row of data) {
          cigCache.set(row.cig, row);
        }
        lookups += data.length;
      }
      
      process.stdout.write(`\r  Lookups: ${lookups}/${cigArray.length}...`);
    }
    console.log(`\n  Enrichment terminato. ${lookups} CIG trovati.`);

    for (const rec of validRecords) {
      const cigData = cigCache.get(rec.cig);
      if (cigData) {
        rec.codice_cpv = cigData.codice_cpv || null;
        rec.descrizione_cpv = cigData.descrizione_cpv || null;
        rec.oggetto_gara = cigData.oggetto_gara || null;
        rec.provincia = cigData.provincia || null;
      }
    }
  } else {
    console.log("\n[5] Enrichment CIG ignorato.");
  }

  // 6. Upsert
  console.log("\n[6] Upsert su Supabase...");
  let totalUpserted = 0;
  let totalErrors = 0;

  if (DRY_RUN) {
    console.log("  [Dry-run] Nessun record scritto sul DB.");
  } else {
    for (let i = 0; i < validRecords.length; i += 100) {
      const batch = validRecords.slice(i, i + 100);
      const { error } = await supabase
        .from("aggiudicatari")
        .upsert(batch, { onConflict: "codice_fiscale,cig" });

      if (error) {
        console.error(`  Errore upsert batch ${Math.floor(i/100)+1}: ${error.message}`);
        totalErrors += batch.length;
      } else {
        totalUpserted += batch.length;
      }

      if ((i + batch.length) % 1000 === 0 || i + batch.length === validRecords.length) {
        process.stdout.write(`\r  Processati: ${totalUpserted + totalErrors}/${validRecords.length}`);
      }
    }
    console.log(""); // newline
  }

  // 7. Cleanup
  console.log("\n[7] Pulizia file temporanei...");
  try {
    if (existsSync(ZIP_PATH)) unlinkSync(ZIP_PATH);
    const files = readdirSync(EXTRACT_DIR);
    for (const f of files) {
      unlinkSync(join(EXTRACT_DIR, f));
    }
  } catch(e) {
    console.warn("  Impossibile eliminare alcuni file temporanei: ", e.message);
  }

  // 8. Riepilogo
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n======================================================================");
  console.log("  SINCRONIZZAZIONE COMPLETATA");
  console.log("======================================================================");
  console.log("  Records validi/elaborati:  " + validRecords.length);
  if (!DRY_RUN) {
    console.log("  Upsert con successo:       " + totalUpserted);
    console.log("  Errori upsert:             " + totalErrors);
  }
  console.log("  Tempo totale:              " + elapsed + "s");
  console.log("======================================================================");
}

main().catch(err => {
  console.error("\nErrore fatale:", err.message);
  process.exit(1);
});
