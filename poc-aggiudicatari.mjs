// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * poc-aggiudicatari.mjs — PoC: ANAC Aggiudicatari Gap Analysis
 *
 * USA SOLO FILE GIÀ PRESENTI SU DISCO — zero download necessari.
 *
 * Fonti:
 *   - tmp/aggiudicazioni_enrichment.csv  (136 MB, 4.84M CIG → importo, data)
 *   - tmp/partecipanti/partecipanti_json.json (1.5 GB, 8.3M record → CF, CIG, ruolo)
 *
 * Il dataset "partecipanti" contiene TUTTI gli operatori economici che hanno
 * partecipato a ogni gara (vincitori + non vincitori). Joinando con le
 * aggiudicazioni, otteniamo i "partecipanti a gare aggiudicate" — un superset
 * degli aggiudicatari che copre lo stesso bisogno per il profiling.
 *
 * Uso:
 *   node poc-aggiudicatari.mjs            # Run completo (~5-10 min)
 *   node poc-aggiudicatari.mjs --fresh    # Ricrea DB da zero
 */

import Database from "better-sqlite3";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, "tmp");
const DB_PATH = resolve(TMP, "anac_poc.sqlite");
const REPORT_PATH = resolve(TMP, "poc-aggiudicatari-report.md");

// ── File già su disco ───────────────────────────────────────────────

const ENRICHMENT_CSV    = resolve(TMP, "aggiudicazioni_enrichment.csv");
const PARTECIPANTI_JSON = resolve(TMP, "partecipanti", "partecipanti_json.json");

// ── SCP/MIT config ──────────────────────────────────────────────────

const SCP_BASE = "https://dati.mit.gov.it/catalog/api/3/action/datastore_search";
const SCP_POST = "1f08fc66-0b04-4c1c-a398-cdb17f3ea8f4";
const SCP_PRE  = "6b3c2eac-d619-444b-8d1e-cbec4ece7e18";

const FRESH = process.argv.includes("--fresh");

// ── Helpers ─────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString("it-IT");
const pct = (n, d) => d > 0 ? (100 * n / d).toFixed(1) : "0.0";

function elapsed(t0) {
  const s = (Date.now() - t0) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)} min`;
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 1: SQLite setup
// ═══════════════════════════════════════════════════════════════════

function step1_db() {
  console.log("\n══ STEP 1: SQLite Setup ═════════════════════════════");
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });

  if (FRESH && existsSync(DB_PATH)) {
    rmSync(DB_PATH);
    if (existsSync(DB_PATH + "-wal")) rmSync(DB_PATH + "-wal");
    if (existsSync(DB_PATH + "-shm")) rmSync(DB_PATH + "-shm");
    console.log("  → Removed old DB (--fresh)");
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -200000");   // 200 MB cache
  db.pragma("temp_store = MEMORY");
  db.pragma("mmap_size = 2147483648"); // 2 GB mmap

  console.log(`  ✓ DB: ${DB_PATH}`);
  return db;
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 2: Create tables
// ═══════════════════════════════════════════════════════════════════

function step2_tables(db) {
  console.log("\n══ STEP 2: Create Tables ════════════════════════════");
  db.exec(`
    DROP TABLE IF EXISTS aggiudicazioni;
    DROP TABLE IF EXISTS partecipanti;

    -- CIG → importo, data (dal CSV enrichment, 4.84M record)
    CREATE TABLE aggiudicazioni (
      cig      TEXT PRIMARY KEY,
      importo  REAL,
      data_agg TEXT
    );

    -- CIG → CF, denominazione, ruolo (dal NDJSON partecipanti, 8.3M record)
    -- Include TUTTI i partecipanti (vincitori + perdenti)
    CREATE TABLE partecipanti (
      cig              TEXT NOT NULL,
      codice_fiscale   TEXT NOT NULL,
      denominazione    TEXT,
      tipo_soggetto    TEXT,
      ruolo            TEXT,
      PRIMARY KEY (codice_fiscale, cig)
    );
    CREATE INDEX idx_part_cig ON partecipanti(cig);
    CREATE INDEX idx_part_cf  ON partecipanti(codice_fiscale);
  `);
  console.log("  ✓ Tables created");
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 3: Load enrichment CSV (aggiudicazioni: cig|importo|data)
// ═══════════════════════════════════════════════════════════════════

async function step3_enrichment(db) {
  console.log("\n══ STEP 3: Load Aggiudicazioni (CSV, su disco) ═════");
  if (!existsSync(ENRICHMENT_CSV)) {
    console.error("  ✗ File mancante:", ENRICHMENT_CSV);
    process.exit(1);
  }
  const sz = statSync(ENRICHMENT_CSV).size;
  console.log(`  File: ${(sz / 1048576).toFixed(1)} MB`);
  const t0 = Date.now();

  const insert = db.prepare(
    "INSERT OR REPLACE INTO aggiudicazioni(cig, importo, data_agg) VALUES (?,?,?)"
  );
  const flush = db.transaction((rows) => {
    for (const r of rows) insert.run(r.cig, r.importo, r.data);
  });

  const rl = createInterface({
    input: createReadStream(ENRICHMENT_CSV, "utf-8"),
    crlfDelay: Infinity,
  });

  let batch = [], loaded = 0;
  const BATCH = 50000;

  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    const [cig, imp, data] = t.split("|");
    if (!cig) continue;
    batch.push({
      cig,
      importo: imp && imp !== "0" && imp !== "null" ? parseFloat(imp) : null,
      data: data && data !== "null" ? data : null,
    });
    if (batch.length >= BATCH) {
      flush(batch); loaded += batch.length; batch = [];
      process.stdout.write(`\r  ${(loaded / 1000).toFixed(0)}K …`);
    }
  }
  if (batch.length) { flush(batch); loaded += batch.length; }
  console.log(`\r  ✓ ${fmt(loaded)} aggiudicazioni in ${elapsed(t0)}          `);
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 4: Load partecipanti NDJSON (già su disco, 1.5 GB)
// ═══════════════════════════════════════════════════════════════════

async function step4_partecipanti(db) {
  console.log("\n══ STEP 4: Load Partecipanti (NDJSON, su disco) ════");
  if (!existsSync(PARTECIPANTI_JSON)) {
    console.error("  ✗ File mancante:", PARTECIPANTI_JSON);
    process.exit(1);
  }
  const sz = statSync(PARTECIPANTI_JSON).size;
  console.log(`  File: ${(sz / 1048576).toFixed(0)} MB (${(sz / 1073741824).toFixed(1)} GB)`);
  const t0 = Date.now();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO partecipanti(cig, codice_fiscale, denominazione, tipo_soggetto, ruolo)
    VALUES (?,?,?,?,?)
  `);
  const flush = db.transaction((rows) => {
    for (const r of rows) insert.run(r.cig, r.cf, r.denom, r.tipo, r.ruolo);
  });

  const rl = createInterface({
    input: createReadStream(PARTECIPANTI_JSON, "utf-8"),
    crlfDelay: Infinity,
  });

  let batch = [], loaded = 0, skip = 0;
  const BATCH = 50000;

  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      const cig = r.cig?.trim();
      if (!cig) { skip++; continue; }
      const cf = (r.codice_fiscale || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (!cf) { skip++; continue; }

      batch.push({
        cig, cf,
        denom: (r.denominazione || "").substring(0, 1000) || null,
        tipo:  (r.tipo_soggetto || "").substring(0, 200) || null,
        ruolo: (r.ruolo || "").substring(0, 100) || null,
      });

      if (batch.length >= BATCH) {
        flush(batch); loaded += batch.length; batch = [];
        process.stdout.write(`\r  ${(loaded / 1000).toFixed(0)}K / ~8.300K …`);
      }
    } catch { skip++; }
  }
  if (batch.length) { flush(batch); loaded += batch.length; }
  console.log(`\r  ✓ ${fmt(loaded)} partecipanti in ${elapsed(t0)} (${skip} skipped)          `);
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 5: Gap Analysis
// ═══════════════════════════════════════════════════════════════════

function step5_analysis(db) {
  console.log("\n══ STEP 5: Gap Analysis ═════════════════════════════");
  const R = {};
  const q = (sql) => db.prepare(sql).get();
  const qa = (sql) => db.prepare(sql).all();

  // 1. Totals
  console.log("\n  [1] Record totali …");
  R.n_part = q("SELECT COUNT(*) n FROM partecipanti").n;
  R.n_agz  = q("SELECT COUNT(*) n FROM aggiudicazioni").n;
  R.n_cf   = q("SELECT COUNT(DISTINCT codice_fiscale) n FROM partecipanti").n;
  R.cig_part = q("SELECT COUNT(DISTINCT cig) n FROM partecipanti").n;
  R.cig_agz  = q("SELECT COUNT(DISTINCT cig) n FROM aggiudicazioni").n;
  console.log(`    Partecipanti:   ${fmt(R.n_part)} record, ${fmt(R.n_cf)} CF unici, ${fmt(R.cig_part)} CIG unici`);
  console.log(`    Aggiudicazioni: ${fmt(R.n_agz)} record, ${fmt(R.cig_agz)} CIG unici`);

  // 2. CIG overlap
  console.log("\n  [2] CIG overlap (partecipanti ⋈ aggiudicazioni) …");
  R.cig_both = q(
    "SELECT COUNT(DISTINCT p.cig) n FROM partecipanti p INNER JOIN aggiudicazioni z ON p.cig=z.cig"
  ).n;
  R.cig_only_part = q(
    "SELECT COUNT(DISTINCT p.cig) n FROM partecipanti p LEFT JOIN aggiudicazioni z ON p.cig=z.cig WHERE z.cig IS NULL"
  ).n;
  R.cig_only_agz = q(
    "SELECT COUNT(DISTINCT z.cig) n FROM aggiudicazioni z LEFT JOIN partecipanti p ON z.cig=p.cig WHERE p.cig IS NULL"
  ).n;
  console.log(`    In entrambi:         ${fmt(R.cig_both)}`);
  console.log(`    Solo partecipanti:   ${fmt(R.cig_only_part)} (gare senza esito/importo)`);
  console.log(`    Solo aggiudicazioni: ${fmt(R.cig_only_agz)} (esiti senza partecipanti noti)`);

  // 3. "Aggiudicatari ricostruiti": partecipanti il cui CIG ha un'aggiudicazione
  console.log("\n  [3] Aggiudicatari ricostruiti (partecipanti a gare aggiudicate) …");
  R.ricostruiti = q(`
    SELECT COUNT(*) total,
           COUNT(DISTINCT p.codice_fiscale) cf_unici,
           COUNT(DISTINCT p.cig) cig_unici
    FROM partecipanti p
    INNER JOIN aggiudicazioni z ON p.cig=z.cig
    WHERE z.importo IS NOT NULL
  `);
  console.log(`    Record:   ${fmt(R.ricostruiti.total)} (partecipanti × CIG aggiudicati)`);
  console.log(`    CF unici: ${fmt(R.ricostruiti.cf_unici)}`);
  console.log(`    CIG unici: ${fmt(R.ricostruiti.cig_unici)}`);

  // 4. Completeness after JOIN
  console.log("\n  [4] Completezza dati dopo JOIN …");
  R.join = q(`
    SELECT COUNT(*) total,
           SUM(CASE WHEN z.importo IS NOT NULL THEN 1 ELSE 0 END) con_imp,
           SUM(CASE WHEN z.data_agg IS NOT NULL THEN 1 ELSE 0 END) con_data,
           SUM(CASE WHEN z.importo IS NOT NULL AND z.data_agg IS NOT NULL THEN 1 ELSE 0 END) con_both
    FROM partecipanti p
    LEFT JOIN aggiudicazioni z ON p.cig=z.cig
  `);
  const j = R.join;
  console.log(`    Total JOIN rows: ${fmt(j.total)}`);
  console.log(`    Con importo:     ${fmt(j.con_imp)} (${pct(j.con_imp, j.total)}%)`);
  console.log(`    Con data:        ${fmt(j.con_data)} (${pct(j.con_data, j.total)}%)`);
  console.log(`    Con entrambi:    ${fmt(j.con_both)} (${pct(j.con_both, j.total)}%)`);

  // 5. P.IVA vs CF type
  console.log("\n  [5] Tipologia codice fiscale …");
  R.cf_types = qa(`
    SELECT CASE
      WHEN LENGTH(codice_fiscale)=11 AND codice_fiscale GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN 'P.IVA (11 cifre)'
      WHEN LENGTH(codice_fiscale)=16 THEN 'CF (16 car.)'
      ELSE 'Altro (' || LENGTH(codice_fiscale) || ' car.)'
    END tipo,
    COUNT(DISTINCT codice_fiscale) cf_unici,
    COUNT(*) recs
    FROM partecipanti GROUP BY 1 ORDER BY 3 DESC
  `);
  for (const r of R.cf_types) console.log(`    ${r.tipo}: ${fmt(r.cf_unici)} CF, ${fmt(r.recs)} recs`);

  // 6. Coverage by year
  console.log("\n  [6] Copertura per anno …");
  R.by_year = qa(`
    SELECT CAST(SUBSTR(z.data_agg, 1, 4) AS INTEGER) anno,
           COUNT(DISTINCT z.cig) cig_data,
           COUNT(DISTINCT p.cig) cig_part,
           COUNT(DISTINCT p.codice_fiscale) cf_unici,
           CAST(AVG(z.importo) AS INTEGER) imp_avg
    FROM aggiudicazioni z
    LEFT JOIN partecipanti p ON z.cig=p.cig
    WHERE z.data_agg IS NOT NULL AND LENGTH(z.data_agg)>=4
    GROUP BY 1 ORDER BY 1
  `);
  console.log("    Anno  | CIG  | con partecipanti | CF unici | Importo medio");
  for (const r of R.by_year)
    console.log(`    ${r.anno}  | ${fmt(r.cig_data).padStart(8)} | ${fmt(r.cig_part).padStart(16)} | ${fmt(r.cf_unici).padStart(8)} | €${fmt(r.imp_avg)}`);

  // 7. Gap 2024-2026
  console.log("\n  [7] Gap 2024–2026 …");
  R.gap = qa(`
    SELECT CAST(SUBSTR(z.data_agg, 1, 4) AS INTEGER) anno,
           COUNT(*) aggiudicazioni,
           SUM(CASE WHEN p.cig IS NOT NULL THEN 1 ELSE 0 END) con_part,
           ROUND(100.0 * SUM(CASE WHEN p.cig IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) pct_match
    FROM aggiudicazioni z
    LEFT JOIN partecipanti p ON z.cig=p.cig
    WHERE CAST(SUBSTR(z.data_agg, 1, 4) AS INTEGER) >= 2024
    GROUP BY 1 ORDER BY 1
  `);
  for (const r of R.gap)
    console.log(`    ${r.anno}: ${fmt(r.aggiudicazioni)} aggiudicazioni, ${fmt(r.con_part)} con partecipanti (${r.pct_match}%)`);

  // 8. Confronto con Supabase attuale
  console.log("\n  [8] Confronto Supabase …");
  R.supabase = { records: 38988, cf: 17605 };
  console.log(`    Supabase oggi:  ${fmt(R.supabase.records)} aggiudicatari, ${fmt(R.supabase.cf)} CF unici`);
  console.log(`    PoC (part.):    ${fmt(R.ricostruiti.total)} record, ${fmt(R.ricostruiti.cf_unici)} CF unici`);
  console.log(`    Moltiplicatore: ${(R.ricostruiti.total / R.supabase.records).toFixed(0)}× record, ${(R.ricostruiti.cf_unici / R.supabase.cf).toFixed(0)}× CF`);

  // 9. Storage
  console.log("\n  [9] Storage …");
  const dbSize = existsSync(DB_PATH) ? statSync(DB_PATH).size : 0;
  R.storage_bytes = dbSize;
  R.storage_mb = Math.round(dbSize / 1048576);
  console.log(`    SQLite DB: ${R.storage_mb} MB`);

  // 10. Ruolo distribution for aggiudicatari ricostruiti
  console.log("\n  [10] Distribuzione ruoli (partecipanti a gare aggiudicate) …");
  R.ruoli = qa(`
    SELECT COALESCE(p.ruolo, 'NULL') ruolo, COUNT(*) n
    FROM partecipanti p INNER JOIN aggiudicazioni z ON p.cig=z.cig
    WHERE z.importo IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `);
  for (const r of R.ruoli) console.log(`    ${fmt(r.n).padStart(10)} | ${r.ruolo}`);

  // Top aziende for SCP comparison
  R.top_aziende = qa(`
    SELECT p.codice_fiscale, p.denominazione,
           COUNT(DISTINCT p.cig) gare,
           CAST(COALESCE(SUM(z.importo),0) AS INTEGER) importo_tot
    FROM partecipanti p
    INNER JOIN aggiudicazioni z ON p.cig=z.cig
    WHERE LENGTH(p.codice_fiscale)=11
      AND p.codice_fiscale GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
      AND z.importo IS NOT NULL
    GROUP BY p.codice_fiscale, p.denominazione
    ORDER BY gare DESC LIMIT 10
  `);

  return R;
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 6: SCP/MIT comparison
// ═══════════════════════════════════════════════════════════════════

async function step6_scp(topAziende) {
  console.log("\n══ STEP 6: SCP/MIT Live Comparison ══════════════════");
  const results = [];

  for (const row of topAziende) {
    const piva = row.codice_fiscale;
    let scpN = 0, scpImp = 0;
    try {
      for (const rid of [SCP_POST, SCP_PRE]) {
        const flt = JSON.stringify({ cf_aggiudicatario: piva });
        const url = `${SCP_BASE}?resource_id=${rid}&filters=${encodeURIComponent(flt)}&limit=500`;
        const res = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "ANAC-DB-Codex/1.0" },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.success && d.result?.records) {
            scpN += d.result.records.length;
            for (const r of d.result.records)
              if (r.imp_di_aggiudicazione && parseFloat(r.imp_di_aggiudicazione) > 0) scpImp++;
          }
        }
      }
    } catch (e) { console.warn(`  ⚠ ${piva}: ${e.message}`); }

    const anacG = row.gare;
    results.push({
      piva, denom: (row.denominazione || "?").substring(0, 40),
      anac: anacG, scp: scpN, scp_imp: scpImp, delta: anacG - scpN,
    });
    console.log(`  ${piva} ${(row.denominazione || "").substring(0, 30).padEnd(32)} ANAC=${String(anacG).padStart(5)} SCP=${String(scpN).padStart(5)} Δ=${anacG - scpN}`);
    await sleep(500);
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 7: Generate Report
// ═══════════════════════════════════════════════════════════════════

function step7_report(R, scp) {
  console.log("\n══ STEP 7: Generate Report ══════════════════════════");
  const j = R.join;
  const pgEstMB = Math.round(R.storage_bytes / 1048576 * 2.5);

  const md = `# PoC Aggiudicatari — Gap Analysis Report

> Generato: ${new Date().toISOString().replace("T", " ").substring(0, 19)}
> Fonti: file locali (zero download). Partecipanti ANAC + Aggiudicazioni ANAC.

---

## 1. Volumi Dataset ANAC

| Metrica | Valore |
|---------|--------|
| Partecipanti (chi partecipa) | **${fmt(R.n_part)}** record |
| Aggiudicazioni (importo/data) | **${fmt(R.n_agz)}** CIG |
| CF/P.IVA unici (partecipanti) | **${fmt(R.n_cf)}** |
| CIG unici (partecipanti) | ${fmt(R.cig_part)} |
| CIG unici (aggiudicazioni) | ${fmt(R.cig_agz)} |

### "Aggiudicatari ricostruiti" (partecipanti a gare con importo)

| Metrica | Valore |
|---------|--------|
| Record (partecipante × CIG aggiudicato) | **${fmt(R.ricostruiti.total)}** |
| CF/P.IVA unici | **${fmt(R.ricostruiti.cf_unici)}** |
| CIG unici | **${fmt(R.ricostruiti.cig_unici)}** |

### Confronto con Supabase attuale

| | Supabase oggi | PoC completo | × |
|---|---:|---:|---:|
| Record | 38.988 | **${fmt(R.ricostruiti.total)}** | **${(R.ricostruiti.total / 38988).toFixed(0)}×** |
| CF/P.IVA unici | ~17.605 | **${fmt(R.ricostruiti.cf_unici)}** | **${(R.ricostruiti.cf_unici / 17605).toFixed(0)}×** |

---

## 2. Overlap CIG tra i due dataset

\`\`\`
          PARTECIPANTI                    AGGIUDICAZIONI
          (chi partecipa)                 (quanto/quando)
          ┌───────────────────────────────────────────────┐
          │                                               │
 Solo P.  │        CIG in ENTRAMBI        │  Solo Agg.    
 ${String(fmt(R.cig_only_part)).padStart(8)}  │     ${String(fmt(R.cig_both)).padStart(10)}               │  ${fmt(R.cig_only_agz)}
          │                                               │
          └───────────────────────────────────────────────┘
\`\`\`

| Categoria | CIG |
|-----------|-----|
| ✅ In entrambi | **${fmt(R.cig_both)}** |
| ⚠️ Solo partecipanti | ${fmt(R.cig_only_part)} |
| ⚠️ Solo aggiudicazioni | ${fmt(R.cig_only_agz)} |

---

## 3. Completezza dopo JOIN

| Campo | Records | % |
|-------|---------|---|
| Totale righe | ${fmt(j.total)} | 100% |
| Con importo | ${fmt(j.con_imp)} | ${pct(j.con_imp, j.total)}% |
| Con data | ${fmt(j.con_data)} | ${pct(j.con_data, j.total)}% |
| **Con entrambi** | **${fmt(j.con_both)}** | **${pct(j.con_both, j.total)}%** |

---

## 4. Tipi di Codice Fiscale

| Tipo | CF unici | Records |
|------|----------|---------|
${R.cf_types.map((r) => `| ${r.tipo} | ${fmt(r.cf_unici)} | ${fmt(r.recs)} |`).join("\n")}

---

## 5. Copertura per Anno

| Anno | CIG con data | CIG con partecipanti | CF unici | Importo medio |
|------|-------------|---------------------|----------|---------------|
${R.by_year.map((r) => `| ${r.anno} | ${fmt(r.cig_data)} | ${fmt(r.cig_part)} | ${fmt(r.cf_unici)} | €${fmt(r.imp_avg)} |`).join("\n")}

---

## 6. Gap 2024–2026 (zona critica)

| Anno | Aggiudicazioni | Con partecipanti | Match % |
|------|---------------|-----------------|---------|
${R.gap.map((r) => `| ${r.anno} | ${fmt(r.aggiudicazioni)} | ${fmt(r.con_part)} | **${r.pct_match}%** |`).join("\n")}

> **Nota**: SCP/MIT è quasi vuoto dal 2024 (D.Lgs. 36/2023). Solo ANAC copre il 2024–2026.

---

## 7. Distribuzione Ruoli (gare aggiudicate)

| Ruolo | Records |
|-------|---------|
${R.ruoli.map((r) => `| ${r.ruolo} | ${fmt(r.n)} |`).join("\n")}

---

## 8. Confronto SCP/MIT (Top 10 P.IVA per volume)

| P.IVA | Denominazione | ANAC gare | SCP/MIT gare | Δ |
|-------|---------------|-----------|-------------|---|
${scp.map((r) => `| ${r.piva} | ${r.denom} | ${r.anac} | ${r.scp} | ${r.delta > 0 ? "+" : ""}${r.delta} |`).join("\n")}

---

## 9. Storage

| DB | Dimensione |
|-----|-----------|
| SQLite PoC | **${R.storage_mb} MB** |
| Stima PostgreSQL/Supabase | **~${pgEstMB} MB** (con indici) |
| Supabase Free Tier disponibile | ~187 MB |

---

## 10. Raccomandazioni

### A. Usare il dataset PARTECIPANTI, non solo AGGIUDICATARI

Il dataset \`partecipanti\` (8.3M record) è un **superset** del dataset \`aggiudicatari\`.
Joinando con \`aggiudicazioni\` si ottengono tutti i dati necessari per il profiling:
- CF/P.IVA → CIG aggiudicati → importo + data
- Ruolo (mandataria, mandante, monosoggettivo)
- Bonus: si può calcolare il **tasso di successo** reale (gare vinte / gare partecipate)

### B. Strategia per Supabase

| Strategia | Storage stimato | Note |
|-----------|----------------|------|
| Tabella denormalizzata pre-joinata (solo gare aggiudicate, solo P.IVA 11 cifre) | ~${Math.round(pgEstMB * 0.15)} MB | ✅ Entra nel Free Tier |
| Tutto con filtro ultimi 5 anni | ~${Math.round(pgEstMB * 0.4)} MB | ✅ Probabile Free Tier |
| Dataset completo | ~${pgEstMB} MB | ❌ Serve Pro (\\$25/mese) |

### C. Workflow

1. **Una tantum**: caricare tabella denormalizzata pre-joinata su Supabase
2. **Mensile**: scaricare delta partecipanti + delta aggiudicazioni, JOIN, upsert
3. **Live**: SCP/MIT come fallback per 2016–2023 (senza storage)
`;

  writeFileSync(REPORT_PATH, md, "utf-8");
  console.log(`  ✓ Report: ${REPORT_PATH}`);
  return md;
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║  PoC ANAC Aggiudicatari — Gap Analysis (no download) ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`  Fonti: file già su disco`);
  console.log(`  - ${ENRICHMENT_CSV}`);
  console.log(`  - ${PARTECIPANTI_JSON}`);

  // Verify files exist
  for (const f of [ENRICHMENT_CSV, PARTECIPANTI_JSON]) {
    if (!existsSync(f)) {
      console.error(`\n✗ File mancante: ${f}`);
      process.exit(1);
    }
  }

  const db = step1_db();
  try {
    step2_tables(db);
    await step3_enrichment(db);
    await step4_partecipanti(db);
    const R = step5_analysis(db);
    const scp = await step6_scp(R.top_aziende);
    step7_report(R, scp);
  } finally {
    db.close();
  }

  console.log(`\n╔═══════════════════════════════════════════════════════╗`);
  console.log(`║  ✓ Completato in ${elapsed(t0).padEnd(38)}║`);
  console.log(`║  DB:     tmp/anac_poc.sqlite                          ║`);
  console.log(`║  Report: tmp/poc-aggiudicatari-report.md              ║`);
  console.log(`╚═══════════════════════════════════════════════════════╝`);
}

main().catch((err) => {
  console.error("\n✗ Errore fatale:", err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
