/**
 * sync-grants-gov.mjs
 * Sincronizza grant federali USA da Grants.gov
 * API: https://api.grants.gov/v1/api/search2/ — no auth required
 *
 * Usage:
 *   node scripts/sync-grants-gov.mjs              # solo "posted" (open)
 *   node scripts/sync-grants-gov.mjs --forecasted # includi "forecasted"
 *   node scripts/sync-grants-gov.mjs --dry-run    # no DB write
 */

import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────

const API_URL    = "https://api.grants.gov/v1/api/search2/";
const PAGE_SIZE  = 100;
const UPSERT_BATCH = 200;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_DRY_RUN   = args.includes("--dry-run");
const INC_FORECAST = args.includes("--forecasted");

// ── Supabase ──────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Mapping ───────────────────────────────────────────────────────────────────

// grants.gov closeDate formato: "MM/DD/YYYY"
function parseGrantsGovDate(str) {
  if (!str) return null;
  const [m, d, y] = str.split("/");
  if (!y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function mapGrantsGovRecord(opp) {
  return {
    id:          `grants.gov:${opp.id}`,
    titolo:      opp.title?.trim() ?? null,
    ente:        opp.agency ?? opp.agencyCode ?? null,
    descrizione: null,
    scadenza:    parseGrantsGovDate(opp.closeDate),
    country:     "US",
    tender_type: "grant",
    importo_max: null, // non presente nel list endpoint
    settori:     opp.cfdaList?.join(", ") || null,
    source:      "grants.gov",
    link:        `https://www.grants.gov/search-results-detail/${opp.id}`,
    intl_created_at: opp.openDate ? new Date(parseGrantsGovDate(opp.openDate) ?? opp.openDate).toISOString().slice(0,10) : null,
    synced_at:   new Date().toISOString(),
  };
}

// ── Fetch page ────────────────────────────────────────────────────────────────

async function fetchPage(startRecordNum, status) {
  const body = {
    rows: PAGE_SIZE,
    startRecordNum,
    status,           // "posted" | "forecasted|posted"
    sortBy: "openDate|desc",
  };

  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.errorcode !== 0) throw new Error(`API error: ${d.msg}`);
  return d.data;
}

// ── Jitter ────────────────────────────────────────────────────────────────────

function jitter(min, max) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString("it-IT");
  const todayStr = new Date().toISOString().slice(0, 10);
  const status = INC_FORECAST ? "forecasted|posted" : "posted";

  console.log("═".repeat(70));
  console.log("  Grants.gov (USA) → Supabase Sync");
  console.log(`  ${today} — status: ${status}`);
  console.log("═".repeat(70));
  if (IS_DRY_RUN) console.log("  🧪 DRY RUN — nessuna scrittura su DB");
  console.log("");

  // Primo fetch per sapere il totale
  console.log("📡 Connessione a Grants.gov...");
  let firstPage;
  try {
    firstPage = await fetchPage(0, status);
  } catch (e) {
    console.error(`❌ Grants.gov non raggiungibile: ${e.message}`);
    process.exitCode = 0; return;
  }

  const totalAvailable = firstPage.hitCount ?? 0;
  console.log(`  ✅ Grants.gov online — ${totalAvailable.toLocaleString()} opportunità ${status}\n`);
  console.log("📡 Fetch & write...\n");

  let startRecord = 0;
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Processa la prima pagina già caricata
  let currentBatch = firstPage.oppHits ?? [];

  while (true) {
    totalFetched += currentBatch.length;

    // Filtra: escludi scaduti e senza titolo
    const valid = currentBatch.filter(opp => {
      if (!opp.title?.trim()) return false;
      const scad = parseGrantsGovDate(opp.closeDate);
      if (scad && scad < todayStr) return false;
      return true;
    });
    totalSkipped += currentBatch.length - valid.length;

    const records = valid.map(mapGrantsGovRecord);

    // Upsert
    if (!IS_DRY_RUN && records.length > 0) {
      for (let i = 0; i < records.length; i += UPSERT_BATCH) {
        const batch = records.slice(i, i + UPSERT_BATCH);
        const { error } = await supabase
          .from("intl_tenders")
          .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
        if (error) {
          console.error(`  ❌ Upsert error: ${error.message}`);
          totalErrors++;
        } else {
          totalUpserted += batch.length;
        }
      }
    }

    const pct = totalAvailable ? Math.round(totalFetched / totalAvailable * 100) : "?";
    process.stdout.write(`\r  📥 ${totalFetched}/${totalAvailable} (${pct}%) — salvati: ${totalUpserted}   `);

    // Fine?
    startRecord += currentBatch.length;
    if (currentBatch.length < PAGE_SIZE || startRecord >= totalAvailable) break;

    await jitter(300, 600);

    try {
      const nextPage = await fetchPage(startRecord, status);
      currentBatch = nextPage.oppHits ?? [];
    } catch (e) {
      console.error(`\n  ❌ Errore offset=${startRecord}: ${e.message}`);
      totalErrors++;
      break;
    }
  }

  // Cleanup scaduti
  if (!IS_DRY_RUN) {
    const { count } = await supabase
      .from("intl_tenders")
      .delete({ count: "exact" })
      .eq("source", "grants.gov")
      .lt("scadenza", todayStr)
      .not("scadenza", "is", null);
    if (count > 0) console.log(`\n  🧹 Rimossi ${count} grant scaduti`);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n" + "═".repeat(70));
  console.log("  ✅ SYNC GRANTS.GOV COMPLETATO");
  console.log("═".repeat(70));
  console.log(`  📥 Opportunità scaricate:  ${totalFetched}`);
  if (totalSkipped > 0) console.log(`  ⏭️  Scartate (scadute):    ${totalSkipped}`);
  if (!IS_DRY_RUN) console.log(`  💾 Salvate su DB:          ${totalUpserted}`);
  if (totalErrors > 0) console.log(`  ❌ Errori:                 ${totalErrors}`);
  console.log(`  ⏱️  Tempo:                  ${elapsed}s`);
  console.log("═".repeat(70));
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
