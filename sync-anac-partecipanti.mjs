// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import os from "os";

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

const DATASET_URL = "https://dati.anticorruzione.it/opendata/download/dataset/partecipanti/filesystem/partecipanti_json.zip";
const TEMP_DIR = resolve(__dirname, "./tmp/partecipanti/");
const ZIP_PATH = resolve(__dirname, "./tmp/partecipanti.zip");

// -- CLI args --

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf("--" + name);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return null;
}

const hasFlag = (name) => args.includes("--" + name);

const LIMIT = getArg("limit") ? parseInt(getArg("limit"), 10) : Infinity;
const ENRICH = hasFlag("enrich");
const DRY_RUN = hasFlag("dry-run");

// -- Funzioni di utilità --

async function downloadWithRetry(url, dest, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`  Download tentativo ${attempt}/${retries}...`);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "it-IT,it;q=0.8,en-US;q=0.5,en;q=0.3",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1"
        },
        signal: AbortSignal.timeout(600000) // 10 minuti timeout
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      writeFileSync(dest, Buffer.from(arrayBuffer));
      console.log(`  Download completato. (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
      return;
    } catch (e) {
      if (attempt === retries) throw e;
      const wait = attempt * 5000;
      console.warn(`  [!] Fallito: ${e.message} -- attesa ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

function extractZip(zipPath, destDir) {
  console.log(`  Estrazione ZIP in ${destDir}...`);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const isWindows = os.platform() === 'win32';
  try {
    if (isWindows) {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
    } else {
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
    }
    console.log("  Estrazione completata.");
  } catch (err) {
    console.error("  Errore durante l'estrazione:", err.message);
    throw err;
  }
}

function sanitizeCodiceFiscale(cf) {
  if (!cf) return null;
  const sanitized = cf.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (sanitized.length < 11) return null;
  return sanitized;
}

// -- Main --

async function main() {
  const startTime = Date.now();

  console.log("======================================================================");
  console.log("  ANAC Partecipanti -> Supabase Sync");
  console.log("======================================================================");
  if (LIMIT < Infinity) console.log(`  Limite: ${LIMIT} record`);
  if (ENRICH) console.log("  Enrich: ATTIVO");
  if (DRY_RUN) console.log("  Dry-run: ATTIVO (nessuna scrittura su Supabase)");
  console.log("");

  const tmpBase = resolve(__dirname, "./tmp");
  if (!existsSync(tmpBase)) mkdirSync(tmpBase, { recursive: true });

  // 1. Download
  console.log("[1] Download dataset...");
  await downloadWithRetry(DATASET_URL, ZIP_PATH);

  // 2. Estrazione
  console.log("\n[2] Estrazione dataset...");
  extractZip(ZIP_PATH, TEMP_DIR);

  const files = readdirSync(TEMP_DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error("Nessun file JSON trovato nell'archivio estratto.");
  }

  // 3. Parse e mappa (streaming — il file può essere > 500 MB)
  console.log(`\n[3] Lettura file JSON e mapping (streaming)...`);
  const allRecords = [];

  for (const file of files) {
    console.log(`  Leggo ${file} (streaming riga per riga)...`);
    const filePath = resolve(TEMP_DIR, file);

    // Streaming line-by-line (NDJSON) — non caricare tutto in memoria
    const { createReadStream } = await import("fs");
    const { createInterface } = await import("readline");
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    let lineCount = 0;
    let count = 0;
    for await (const line of rl) {
      if (allRecords.length >= LIMIT) break;
      lineCount++;

      const trimmed = line.trim();
      if (!trimmed) continue;

      let rec;
      try {
        rec = JSON.parse(trimmed);
      } catch { continue; }

      const cig = rec.cig || rec.Cig || rec.CIG;
      if (!cig || String(cig).trim() === "") continue;

      const cf = rec.codiceFiscale || rec.codice_fiscale || rec.CodiceFiscale || rec.cf;
      const sanitizedCf = sanitizeCodiceFiscale(String(cf));
      if (!sanitizedCf) continue;

      allRecords.push({
        cig: String(cig).trim().substring(0, 50),
        codice_fiscale: sanitizedCf,
        denominazione: (rec.denominazione || rec.Denominazione) ? String(rec.denominazione || rec.Denominazione).substring(0, 1000) : null,
        tipo_soggetto: (rec.tipoSoggetto || rec.tipo_soggetto || rec.TipoSoggetto) ? String(rec.tipoSoggetto || rec.tipo_soggetto || rec.TipoSoggetto).substring(0, 200) : null,
        ruolo: (rec.ruolo || rec.Ruolo) ? String(rec.ruolo || rec.Ruolo).substring(0, 100) : null
      });

      count++;
      if (count % 100000 === 0) console.log(`    ... ${count} record validi (${lineCount} righe lette)`);
    }
    rl.close();
    console.log(`  Estratti ${count} record validi da ${lineCount} righe.`);
    if (allRecords.length >= LIMIT) break;
  }

  console.log(`  Totale record validi da importare: ${allRecords.length}`);

  if (allRecords.length === 0) {
    console.log("  Nessun record da importare. Esco.");
    return;
  }

  // 4. Enrich (opzionale)
  if (ENRICH) {
    console.log("\n[4] Arricchimento dati da tabella CIG...");
    const cigSet = new Set(allRecords.map(r => r.cig));
    const cigArray = Array.from(cigSet);
    
    const cigMap = new Map();
    let enrichedCount = 0;

    for (let i = 0; i < cigArray.length; i += 1000) {
      const batchCigs = cigArray.slice(i, i + 1000);
      const { data: cigData, error } = await supabase
        .from("cig")
        .select("cig, codice_cpv, descrizione_cpv, oggetto_gara, provincia")
        .in("cig", batchCigs);

      if (error) {
        console.error("  Errore fetch CIG per enrich:", error.message);
      } else if (cigData) {
        for (const c of cigData) {
          cigMap.set(c.cig, {
            codice_cpv: c.codice_cpv,
            descrizione_cpv: c.descrizione_cpv,
            oggetto_gara: c.oggetto_gara,
            provincia: c.provincia
          });
        }
      }
    }

    for (const r of allRecords) {
      const c = cigMap.get(r.cig);
      if (c) {
        if (c.codice_cpv !== undefined) r.codice_cpv = c.codice_cpv;
        if (c.descrizione_cpv !== undefined) r.descrizione_cpv = c.descrizione_cpv;
        if (c.oggetto_gara !== undefined) r.oggetto_gara = c.oggetto_gara;
        if (c.provincia !== undefined) r.provincia = c.provincia;
        enrichedCount++;
      }
    }
    console.log(`  Arricchiti ${enrichedCount} record.`);
  }

  // 5. Upsert su Supabase
  console.log("\n[5] Upsert su Supabase (partecipanti)...");
  if (DRY_RUN) {
    console.log("  DRY-RUN: Skip upsert.");
  } else {
    let totalUpserted = 0;
    
    for (let i = 0; i < allRecords.length; i += 100) {
      const batch = allRecords.slice(i, i + 100);
      
      const { error } = await supabase
        .from("partecipanti")
        .upsert(batch, { onConflict: "codice_fiscale,cig", ignoreDuplicates: false });

      if (error) {
        console.error(`  Errore upsert batch ${Math.floor(i / 100) + 1}:`, error.message);
      } else {
        totalUpserted += batch.length;
      }
      
      if ((i + batch.length) % 1000 === 0 || i + batch.length === allRecords.length) {
        process.stdout.write(`\r  Processati ${totalUpserted}/${allRecords.length}...`);
      }
    }
    console.log(`\r  ${totalUpserted}/${allRecords.length} record scritti OK.      `);
  }

  // Pulizia file temporanei
  try {
    if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
    if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH, { force: true });
  } catch (e) {
    console.error("  Errore durante la pulizia dei file temporanei:", e.message);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n======================================================================");
  console.log("  SINCRONIZZAZIONE COMPLETATA");
  console.log("======================================================================");
  console.log(`  Record estratti validi: ${allRecords.length}`);
  if (!DRY_RUN) console.log(`  Aggiornati Supabase:    ${allRecords.length}`);
  console.log(`  Tempo totale:           ${elapsed}s`);
  console.log("======================================================================");
}

main().catch(err => {
  console.error("\nErrore fatale:", err.message);
  process.exit(1);
});
