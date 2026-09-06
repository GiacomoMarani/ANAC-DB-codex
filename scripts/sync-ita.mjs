// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * sync-ita.mjs — Scrape all ITA tenders → Supabase
 *
 * The ITA API (get-cato.com/api/tenders) returns only 10 items per page
 * with no way to increase page size or filter by source server-side.
 * This script scrapes ALL pages and stores tenders in a dedicated Supabase
 * table `ita_tenders`, enabling instant SQL-based filtering.
 *
 * USAGE:
 *   node scripts/sync-ita.mjs                    → incremental (first 50 pages)
 *   node scripts/sync-ita.mjs --full             → full sync (all ~6700 pages)
 *   node scripts/sync-ita.mjs --pages 100        → custom page count
 *   node scripts/sync-ita.mjs --full --dry-run   → don't write to DB
 *
 * SCHEDULING (Windows Task Scheduler):
 *   Programma: node
 *   Argomenti: scripts/sync-ita.mjs
 *   Inizio in: C:\...\ANAC-DB-codex
 *   Frequenza: ogni 6 ore (incremental)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env.local ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnv() {
  try {
    const envPath = resolve(ROOT, ".env.local");
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
    // .env.local not found
  }
}

loadEnv();

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ITA_BASE = "https://www.get-cato.com/api/tenders";
const ITA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
  "Referer": "https://www.get-cato.com/gare",
};

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const IS_FULL    = hasFlag("full");
const IS_DRY_RUN = hasFlag("dry-run");
const CUSTOM_PAGES = getArg("pages") ? parseInt(getArg("pages"), 10) : null;

// Incremental: 50 pages (500 items, covers recent additions)
// Full: all pages (determined dynamically from API response `total`)
const MAX_PAGES = CUSTOM_PAGES ?? (IS_FULL ? Infinity : 50);

const PARALLEL    = 10;    // concurrent requests
const BATCH_SIZE  = 100;   // records per Supabase upsert
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;  // ms base delay for exponential backoff

// State file for resume support
const STATE_FILE = resolve(ROOT, "scripts/.sync-ita-state.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

/**
 * Fetch a single ITA page with retries and exponential backoff.
 */
async function fetchItaPage(page, signal) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = `${ITA_BASE}?p=${page}`;
      const res = await fetch(url, {
        headers: ITA_HEADERS,
        signal,
      });
      if (res.status === 502 || res.status === 503 || res.status === 429) {
        // Rate limited or server overloaded — back off
        const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
        log(`  ⚠️ Page ${page}: HTTP ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      return {
        items: data.items ?? data.data ?? [],
        total: data.total ?? 0,
      };
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (attempt === MAX_RETRIES) {
        log(`  ❌ Page ${page}: failed after ${MAX_RETRIES} attempts: ${err.message}`);
        return { items: [], total: 0, error: err.message };
      }
      const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
      log(`  ⚠️ Page ${page}: ${err.message}, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

/**
 * Map a raw ITA item to the ita_tenders table schema.
 */
function mapItaItem(item) {
  const info = item.extracted_main_info ?? {};

  // Parse dates safely
  const parseDate = (raw) => {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  // CIG extraction (same logic as ita.ts)
  const isRealCig = (s) => typeof s === "string" && /^[A-Za-z0-9]{10}$/.test(s);
  const lotCig = info.cig?.[0]?.cig;
  const cig = isRealCig(lotCig) ? lotCig : (item.numero_gara ?? item.cig ?? null);

  // Location
  const { comune, regione, provincia: provRaw } = info.ubicazione ?? {};
  const provincia =
    (comune && regione ? `${comune}, ${regione}` : (comune || regione)) ??
    item.luogo ??
    provRaw ??
    null;

  // Importo
  const importoRaw = item.importo ?? info.importi?.importo_base ?? info.importi?.importo_complessivo ?? 0;
  const importo = parseFloat(String(importoRaw)) || null;

  return {
    id:                  item.id,
    oggetto:             item.oggetto ?? info.oggetto ?? null,
    descrizione:         item.descrizione ?? null,
    sources:             item.sources ?? item.source ?? "unknown",
    importo,
    numero_gara:         item.numero_gara ?? null,
    stazione_appaltante: info.stazione_appaltante ?? info.dati_stazione_appaltante?.nome ?? item.stazione_appaltante ?? null,
    tipo_procedura:      info.procedura?.tipo_procedura ?? item.tipo_procedura ?? null,
    link_web:            item.link_web ?? null,
    is_rettifica:        item.is_rettifica ?? false,
    data_scadenza:       parseDate(item.data_scadenza ?? info.date?.termine_presentazione_offerte),
    luogo:               item.luogo ?? null,
    created_at:          parseDate(item.created_at),
    cig,
    provincia,
    data_pubblicazione:  parseDate(info.date?.pubblicazione ?? item.created_at),
    codice_cpv:          info.procedura?.codice_cpv?.map(c => c.codice).join(", ") ??
                         item.cpv_codes?.join(", ") ?? null,
    scraped_at:          new Date().toISOString(),
  };
}

// ── State management (resume support) ────────────────────────────────────────

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return { lastPage: 0, lastRun: null };
}

function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

// ── Upsert to Supabase ──────────────────────────────────────────────────────

async function upsertBatch(records, stats) {
  if (IS_DRY_RUN || records.length === 0) return;

  // Split into chunks
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("ita_tenders")
      .upsert(chunk, { onConflict: "id" });

    if (error) {
      stats.errors++;
      stats.errorMessages.push(`Supabase upsert: ${error.message}`);
      log(`  ❌ Upsert error: ${error.message}`);
    } else {
      stats.upserted += chunk.length;
    }
  }
}

// ── Main sync ────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  log("═══════════════════════════════════════════════════════════");
  log(`  ITA Sync — ${IS_FULL ? "FULL" : "INCREMENTAL"} mode`);
  log(`  Max pages: ${MAX_PAGES === Infinity ? "ALL" : MAX_PAGES}`);
  log(`  Dry run: ${IS_DRY_RUN}`);
  log(`  Parallel: ${PARALLEL}`);
  log("═══════════════════════════════════════════════════════════");

  const stats = {
    pagesScanned: 0,
    itemsFetched: 0,
    upserted: 0,
    errors: 0,
    errorMessages: [],
    sourceCounts: {},
  };

  // Determine total pages from first request
  const firstPage = await fetchItaPage(0);
  if (!firstPage || firstPage.items.length === 0) {
    log("❌ Cannot fetch ITA API — aborting.");
    process.exit(1);
  }

  const totalItems = firstPage.total;
  const totalPages = Math.ceil(totalItems / 10);
  const pagesToScan = Math.min(MAX_PAGES, totalPages);

  log(`📊 ITA total: ${totalItems} tenders across ${totalPages} pages`);
  log(`📄 Will scan: ${pagesToScan} pages (${pagesToScan * 10} items max)`);
  log("");

  // Process first page
  const firstMapped = firstPage.items.map(mapItaItem);
  stats.pagesScanned++;
  stats.itemsFetched += firstPage.items.length;
  for (const item of firstMapped) {
    stats.sourceCounts[item.sources] = (stats.sourceCounts[item.sources] || 0) + 1;
  }
  await upsertBatch(firstMapped, stats);

  // Process remaining pages in parallel batches
  let currentPage = 1;
  const controller = new AbortController();

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    log("\n⚠️ Interrupted! Saving state...");
    saveState({ lastPage: currentPage, lastRun: new Date().toISOString() });
    controller.abort();
    printStats(stats, startTime);
    process.exit(0);
  });

  while (currentPage < pagesToScan) {
    // Build batch of pages to fetch in parallel
    const batchPages = [];
    for (let i = 0; i < PARALLEL && currentPage < pagesToScan; i++, currentPage++) {
      batchPages.push(currentPage);
    }

    // Fetch batch in parallel
    const results = await Promise.all(
      batchPages.map(p => fetchItaPage(p, controller.signal))
    );

    // Process results
    const allMapped = [];
    let emptyCount = 0;

    for (const result of results) {
      if (!result || result.items.length === 0) {
        emptyCount++;
        continue;
      }
      stats.pagesScanned++;
      stats.itemsFetched += result.items.length;
      const mapped = result.items.map(mapItaItem);
      for (const item of mapped) {
        stats.sourceCounts[item.sources] = (stats.sourceCounts[item.sources] || 0) + 1;
      }
      allMapped.push(...mapped);
    }

    // Upsert batch
    await upsertBatch(allMapped, stats);

    // Progress log every 100 pages
    if (currentPage % 100 < PARALLEL) {
      const elapsed = (Date.now() - startTime) / 1000;
      const pagesPerSec = stats.pagesScanned / elapsed;
      const remaining = pagesToScan - currentPage;
      const eta = remaining / pagesPerSec;
      log(`  📄 Page ${currentPage}/${pagesToScan} | ${stats.itemsFetched} items | ${stats.upserted} upserted | ${pagesPerSec.toFixed(1)} p/s | ETA ${formatTime(eta)}`);
    }

    // If all pages in this batch were empty, we've hit the end
    if (emptyCount === batchPages.length) {
      log(`  ⏹ All pages empty at page ${currentPage} — end of data`);
      break;
    }

    // Small delay between batches to be polite
    await sleep(100);
  }

  // Save state
  saveState({ lastPage: currentPage, lastRun: new Date().toISOString() });

  printStats(stats, startTime);
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function printStats(stats, startTime) {
  const elapsed = (Date.now() - startTime) / 1000;

  log("");
  log("═══════════════════════════════════════════════════════════");
  log("  SYNC COMPLETE");
  log("═══════════════════════════════════════════════════════════");
  log(`  ⏱ Duration:     ${formatTime(elapsed)}`);
  log(`  📄 Pages:        ${stats.pagesScanned}`);
  log(`  📦 Items:        ${stats.itemsFetched}`);
  log(`  💾 Upserted:     ${stats.upserted}`);
  log(`  ❌ Errors:       ${stats.errors}`);
  log("");
  log("  📊 Sources distribution:");

  const sorted = Object.entries(stats.sourceCounts)
    .sort((a, b) => b[1] - a[1]);
  for (const [source, count] of sorted) {
    log(`     ${source.padEnd(20)} ${count}`);
  }

  if (stats.errorMessages.length > 0) {
    log("");
    log("  ❌ Error messages:");
    for (const msg of stats.errorMessages.slice(0, 10)) {
      log(`     ${msg}`);
    }
    if (stats.errorMessages.length > 10) {
      log(`     ... and ${stats.errorMessages.length - 10} more`);
    }
  }

  log("═══════════════════════════════════════════════════════════");
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
