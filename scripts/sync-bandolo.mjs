/**
 * sync-bandolo.mjs — Sync Bandolo public tenders → Supabase
 *
 * Bandolo (getbandolo.com) aggregates 29.425+ tenders from 1.096 institutional
 * sources including incentivi.gov.it, invitalia.it, ted.europa.eu.
 * Their public API requires no authentication.
 *
 * USAGE:
 *   node scripts/sync-bandolo.mjs                     → incremental (resume)
 *   node scripts/sync-bandolo.mjs --full              → full sync (all tenders)
 *   node scripts/sync-bandolo.mjs --country IT        → only Italian tenders
 *   node scripts/sync-bandolo.mjs --country EU        → only European tenders
 *   node scripts/sync-bandolo.mjs --limit 200         → max 200 tenders (test)
 *   node scripts/sync-bandolo.mjs --dry-run           → log only, no DB write
 *
 * ARCHITECTURE:
 *   Each page of 50 tenders is fetched from the list API, then each tender's
 *   detail is fetched individually (the list endpoint lacks source, descrizione,
 *   link, settori). Records are upserted to Supabase immediately after each
 *   page, so progress is never lost on network errors.
 *
 * SCHEDULING (Windows Task Scheduler):
 *   Programma: node
 *   Argomenti: scripts/sync-bandolo.mjs --full
 *   Inizio in: C:\...\ANAC-DB-codex
 *   Frequenza: ogni 12 ore
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

const BANDOLO_BASE = "https://api.getbandolo.com/api";
const BANDOLO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://getbandolo.com/",
};

const PER_PAGE = 50; // Bandolo API max (per_page=100 returns 422)
const UPSERT_BATCH_SIZE = 50;
const STATE_FILE = resolve(ROOT, ".bandolo-sync-state.json");

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const IS_FULL      = hasFlag("full");
const IS_DRY_RUN   = hasFlag("dry-run");
const COUNTRY      = getArg("country");  // IT, EU, US, UK, etc.
const MAX_LIMIT    = getArg("limit") ? parseInt(getArg("limit"), 10) : Infinity;

// ── State management ─────────────────────────────────────────────────────────

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return { lastSyncedPage: 0, lastSyncedAt: null };
}

function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn(`  ⚠️ Could not save state: ${e.message}`);
  }
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

/** Random delay between min and max ms */
function jitter(minMs = 300, maxMs = 500) {
  return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

/** Fetch with retry and exponential backoff */
async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: BANDOLO_HEADERS,
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429) {
        const waitMs = attempt * 5000;
        console.warn(`\n  ⚠️ Rate limited (429) — waiting ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (e) {
      if (attempt === retries) throw e;
      const waitMs = attempt * 2000;
      console.warn(`\n  ⚠️ Attempt ${attempt}/${retries} failed: ${e.message} — waiting ${waitMs / 1000}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

// ── Map Bandolo tender to Supabase row ───────────────────────────────────────

function mapToSupabase(tender) {
  return {
    id:                 tender.id,
    slug:               tender.slug || null,
    titolo:             tender.titolo || null,
    ente:               tender.ente || null,
    descrizione:        tender.descrizione || null,
    scadenza:           tender.scadenza || null,
    country:            tender.country || null,
    tender_type:        tender.tender_type || null,
    regione_richiesta:  tender.regione_richiesta || null,
    importo_max:        tender.importo_max != null ? Number(tender.importo_max) : null,
    dimensione_impresa: tender.dimensione_impresa || null,
    settori:            tender.settori || null,
    destinatari:        tender.destinatari || null,
    come_candidarsi:    tender.come_candidarsi || null,
    source:             tender.source || "unknown",
    link:               tender.link || null,
    bandolo_created_at: tender.created_at || null,
    synced_at:          new Date().toISOString(),
  };
}

// ── Fetch tender detail (full description) ───────────────────────────────────

async function fetchTenderDetail(id) {
  try {
    const data = await fetchWithRetry(`${BANDOLO_BASE}/public/tenders/${id}`);
    return data;
  } catch (e) {
    console.warn(`  ⚠️ Detail #${id}: ${e.message}`);
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString("it-IT");
  const state = loadState();

  console.log("═".repeat(70));
  console.log("  Bandolo → Supabase Sync");
  console.log(`  ${today}`);
  console.log("═".repeat(70));
  if (COUNTRY)      console.log(`  🌍 Paese: ${COUNTRY}`);
  if (IS_FULL)      console.log(`  🔄 Modalità: FULL SYNC`);
  if (IS_DRY_RUN)   console.log(`  🧪 Modalità: DRY RUN (no DB write)`);
  if (MAX_LIMIT < Infinity) console.log(`  📊 Limite: ${MAX_LIMIT} bandi`);
  if (!IS_FULL && state.lastSyncedAt) console.log(`  📌 Ultimo sync: ${state.lastSyncedAt}`);
  console.log("");

  // ── Health check ──────────────────────────────────────────────────────────

  console.log("🏥 Health check API Bandolo...");
  try {
    const healthRes = await fetch(`${BANDOLO_BASE}/public/tenders?page=1&per_page=1`, {
      headers: BANDOLO_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });

    const vercelError = healthRes.headers.get("x-vercel-error");
    const status = healthRes.status;

    if (status === 402) {
      console.error(`\n  ❌ API Bandolo non disponibile (HTTP ${status})`);
      if (vercelError) console.error(`     Vercel error: ${vercelError}`);
      console.error("     Probabilmente deployment disabilitato o piano scaduto.");
      console.error("     Il sync riprenderà automaticamente quando l'API torna online.\n");
      console.log("═".repeat(70));
      process.exitCode = 0; return; // uscita pulita, non fa fallire i job schedulati
    }

    if (status === 429) {
      console.warn("  ⚠️ Rate limited (429) — attendo 60s prima di riprovare...");
      await new Promise(r => setTimeout(r, 60_000));
    } else if (!healthRes.ok) {
      const body = await healthRes.text().catch(() => "");
      console.error(`\n  ❌ API Bandolo errore HTTP ${status}: ${body.slice(0, 200)}`);
      if (vercelError) console.error(`     Vercel error: ${vercelError}`);
      console.error("     Riproverò al prossimo ciclo schedulato.\n");
      console.log("═".repeat(70));
      process.exitCode = 0; return;
    } else {
      const data = await healthRes.json();
      const total = data.total ?? "?";
      console.log(`  ✅ API online — ${total} bandi disponibili\n`);
    }
  } catch (e) {
    console.error(`\n  ❌ API Bandolo non raggiungibile: ${e.message}`);
    console.error("     Riproverò al prossimo ciclo schedulato.\n");
    console.log("═".repeat(70));
    process.exitCode = 0; return;
  }

  // ── Incremental fetch + upsert (page by page) ───────────────────────────

  let page = IS_FULL ? 1 : (state.lastSyncedPage ?? 1);
  if (page > 1 && !IS_FULL) console.log(`  ▶ Ripresa da pagina ${page}\n`);

  let totalFetched = 0;
  let totalUpserted = 0;
  let totalAvailable = 0;
  let totalErrors = 0;
  let totalSkipped = 0;  // bandi scaduti scartati
  let consecutivePageErrors = 0;
  const sourceCounts = {};
  const countryCounts = {};

  console.log("📡 Fetch & write page-by-page...\n");

  while (totalFetched < MAX_LIMIT) {
    // Build URL with filters
    let url = `${BANDOLO_BASE}/public/tenders?page=${page}&per_page=${PER_PAGE}`;
    if (COUNTRY) url += `&country=${COUNTRY}`;

    process.stdout.write(`  p${page} `);

    // ── Fetch page list ──
    let tenders;
    try {
      const data = await fetchWithRetry(url);
      tenders = data.tenders || data.items || data.data || [];
      totalAvailable = data.total || totalAvailable;
      consecutivePageErrors = 0;
    } catch (e) {
      console.error(`❌ list: ${e.message}`);
      consecutivePageErrors++;
      if (consecutivePageErrors >= 5) {
        console.error("\n  🛑 5 errori consecutivi — stop.");
        break;
      }
      console.log(`  ⏳ 10s...`);
      await new Promise(r => setTimeout(r, 10_000));
      continue; // retry same page
    }

    if (tenders.length === 0) {
      console.log("fine.");
      break;
    }

    // ── Fetch details in batches of 20 (parallel, fast) ──
    const DETAIL_BATCH = 20;
    const tendersToFetch = tenders.slice(0, MAX_LIMIT - totalFetched);
    const pageRecordsRaw = [];

    for (let i = 0; i < tendersToFetch.length; i += DETAIL_BATCH) {
      const batch = tendersToFetch.slice(i, i + DETAIL_BATCH);
      const details = await Promise.all(
        batch.map(t => fetchTenderDetail(t.id).then(d => d || t))
      );
      for (const detail of details) {
        const record = mapToSupabase(detail);
        pageRecordsRaw.push(record);
      }
      if (i + DETAIL_BATCH < tendersToFetch.length) {
        await jitter(50, 150);
      }
    }

    // ── Filtra: solo bandi/grant attivi (no concorsi/job, no scaduti) ──
    const todayStr = new Date().toISOString().slice(0, 10);
    const pageRecords = pageRecordsRaw.filter(r => {
      // Escludi concorsi/job posting (fuori scope Tender AI DB)
      if (r.tender_type === "concorso") return false;
      // Escludi bandi scaduti
      if (r.scadenza && r.scadenza < todayStr) return false;
      // Escludi titoli spurii
      if (!r.titolo || r.titolo.includes("{{") || r.titolo.trim().length < 5) return false;
      return true;
    });
    const skipped = pageRecordsRaw.length - pageRecords.length;
    totalSkipped += skipped;

    for (const record of pageRecords) {
      sourceCounts[record.source] = (sourceCounts[record.source] || 0) + 1;
      countryCounts[record.country] = (countryCounts[record.country] || 0) + 1;
    }

    totalFetched += pageRecordsRaw.length;

    // ── Upsert this page's records immediately ──
    let pageUpserted = 0;
    if (!IS_DRY_RUN && pageRecords.length > 0) {
      for (let i = 0; i < pageRecords.length; i += UPSERT_BATCH_SIZE) {
        const batch = pageRecords.slice(i, i + UPSERT_BATCH_SIZE);
        try {
          const { error } = await supabase
            .from("bandolo_tenders")
            .upsert(batch, { onConflict: "id", ignoreDuplicates: false });

          if (error) {
            totalErrors++;
            if (totalErrors <= 5) console.error(`\n  ❌ upsert p${page}: ${error.message}`);
          } else {
            totalUpserted += batch.length;
            pageUpserted += batch.length;
          }
        } catch (e) {
          totalErrors++;
          if (totalErrors <= 5) console.error(`\n  ❌ upsert p${page}: ${e.message}`);
        }
      }
    }

    const pct = totalAvailable > 0 ? ` ${Math.round(totalFetched / totalAvailable * 100)}%` : "";
    const dbInfo = IS_DRY_RUN ? "dry" : `+${pageUpserted}→DB(${totalUpserted})`;
    console.log(`${pageRecords.length} ok ${dbInfo} | ${totalFetched}/${totalAvailable}${pct}`);

    // Save checkpoint after each page
    if (!IS_DRY_RUN) {
      saveState({
        lastSyncedPage: page,
        lastSyncedAt: new Date().toISOString(),
        totalRecords: totalUpserted,
        country: COUNTRY || "ALL",
      });
    }

    // Check if we've reached the last page
    const totalPages = Math.ceil(totalAvailable / PER_PAGE);
    if (page >= totalPages || tenders.length < PER_PAGE) {
      console.log("\n  ✅ Tutte le pagine scaricate.");
      break;
    }

    page++;
    await jitter(100, 300); // short pause between pages
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const elapsedMin = (parseFloat(elapsed) / 60).toFixed(1);
  console.log("\n" + "═".repeat(70));
  console.log("  ✅ SYNC COMPLETATO");
  console.log("═".repeat(70));
  console.log(`  📥 Bandi scaricati:       ${totalFetched}`);
  if (totalSkipped > 0) console.log(`  ⏭️  Scaduti scartati:      ${totalSkipped}`);
  if (!IS_DRY_RUN) console.log(`  💾 Bandi attivi su DB:    ${totalUpserted}`);
  console.log(`  📊 Totale disponibili:    ${totalAvailable}`);
  if (totalErrors > 0) console.log(`  ❌ Errori:                ${totalErrors}`);
  console.log(`  ⏱️  Tempo totale:          ${elapsed}s (${elapsedMin}min)`);
  console.log("");

  // Top sources
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  console.log("  📌 Top fonti:");
  for (const [src, count] of topSources) {
    console.log(`     ${src}: ${count}`);
  }

  // Countries
  console.log("\n  🌍 Per paese:");
  for (const [country, count] of Object.entries(countryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${country}: ${count}`);
  }

  // ── Cleanup: rimuovi bandi scaduti dal DB ──────────────────────────────

  if (!IS_DRY_RUN) {
    const today = new Date().toISOString().slice(0, 10);
    const { count, error: delError } = await supabase
      .from("bandolo_tenders")
      .delete({ count: "exact" })
      .lt("scadenza", today)
      .not("scadenza", "is", null);

    if (delError) {
      console.log(`  ⚠️ Errore cleanup scaduti: ${delError.message}`);
    } else if (count > 0) {
      console.log(`  🧹 Cleanup: rimossi ${count} bandi scaduti dal DB`);
    }
  }

  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
