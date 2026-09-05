/**
 * sync-contracts-finder.mjs
 * Sincronizza bandi di appalto UK da Contracts Finder (GOV.UK)
 * via API OCDS (Open Contracting Data Standard) — nessuna auth richiesta
 *
 * Usage:
 *   node scripts/sync-contracts-finder.mjs              # ultimi 7 giorni
 *   node scripts/sync-contracts-finder.mjs --full       # ultimi 90 giorni
 *   node scripts/sync-contracts-finder.mjs --days 30    # ultimi N giorni
 *   node scripts/sync-contracts-finder.mjs --dry-run    # no DB write
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const CF_BASE    = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search";
const PAGE_SIZE  = 100; // max Contracts Finder
const UPSERT_BATCH = 200;
const STATE_FILE = ".cf-sync-state.json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_FULL    = args.includes("--full");
const IS_DRY_RUN = args.includes("--dry-run");
const DAYS_ARG   = args.indexOf("--days");
const DAYS       = DAYS_ARG >= 0 ? parseInt(args[DAYS_ARG + 1]) : (IS_FULL ? 90 : 7);

// ── Supabase ──────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ─────────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Mapping OCDS → bandolo_tenders ───────────────────────────────────────────

function mapOcdsRelease(release) {
  const tender = release.tender ?? {};
  const buyer  = release.buyer ?? {};

  // Scadenza: tenderPeriod.endDate (ISO con timezone)
  const scadenzaRaw = tender.tenderPeriod?.endDate ?? null;
  const scadenza = scadenzaRaw ? scadenzaRaw.slice(0, 10) : null;

  // Pubblicazione: date del release
  const pubblicazione = release.date ? release.date.slice(0, 10) : null;

  // Importo
  const importo = tender.value?.amount ?? null;

  // Link: primo documento o URL costruito dall'ID
  const docUrl = tender.documents?.[0]?.url ?? null;
  const noticeId = release.ocid?.replace("ocds-b5fd17-", "");
  const link = docUrl ?? (noticeId
    ? `https://www.contractsfinder.service.gov.uk/Notice/${noticeId}`
    : null);

  // CPV → settori
  const cpv = tender.classification?.description ?? tender.classification?.id ?? null;

  // Filtra: esclude scaduti e senza titolo
  const titolo = tender.title ?? null;

  return {
    id:             `cf:${release.ocid}`,
    titolo,
    ente:           buyer.name ?? null,
    descrizione:    tender.description ?? null,
    scadenza,
    country:        "GB",
    tender_type:    "grant",
    importo_max:    importo != null ? Number(importo) : null,
    settori:        cpv,
    source:         "contracts-finder",
    link,
    bandolo_created_at: pubblicazione ? new Date(pubblicazione).toISOString() : null,
    synced_at:      new Date().toISOString(),
  };
}

// ── Health check ──────────────────────────────────────────────────────────────

async function healthCheck() {
  try {
    const r = await fetch(`${CF_BASE}?size=1`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      console.error(`❌ Contracts Finder API errore HTTP ${r.status}`);
      return false;
    }
    console.log(`  ✅ Contracts Finder API online\n`);
    return true;
  } catch (e) {
    console.error(`❌ Contracts Finder non raggiungibile: ${e.message}`);
    return false;
  }
}

// ── Fetch page ────────────────────────────────────────────────────────────────

async function fetchPage(publishedFrom, publishedTo, page, retries = 3) {
  const params = new URLSearchParams({
    publishedFrom: `${publishedFrom}T00:00:00`,
    publishedTo:   `${publishedTo}T23:59:59`,
    size:          String(PAGE_SIZE),
    page:          String(page),
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = await fetch(`${CF_BASE}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (r.status === 429) {
      const wait = attempt * 30_000; // 30s, 60s, 90s
      console.warn(`\n  ⚠️ Rate limit (429) pagina ${page} — attendo ${wait/1000}s...`);
      await new Promise(res => setTimeout(res, wait));
      continue;
    }

    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }
  throw new Error("Max retry superato (429 persistente)");
}

// ── Jitter ────────────────────────────────────────────────────────────────────

function jitter(min, max) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString("it-IT");
  const state = loadState();

  console.log("═".repeat(70));
  console.log("  Contracts Finder (UK) → Supabase Sync");
  console.log(`  ${today} — ultimi ${DAYS} giorni`);
  console.log("═".repeat(70));
  if (IS_DRY_RUN) console.log("  🧪 DRY RUN — nessuna scrittura su DB");
  console.log("");

  // Health check
  console.log("🏥 Health check Contracts Finder...");
  const alive = await healthCheck();
  if (!alive) { process.exitCode = 0; return; }

  // Range date
  const toDate   = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - DAYS);
  const publishedFrom = fromDate.toISOString().slice(0, 10);
  const publishedTo   = toDate.toISOString().slice(0, 10);
  console.log(`  📅 Dal ${publishedFrom} al ${publishedTo}\n`);

  // Fetch & upsert pagina per pagina
  let page = 1;
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  console.log("📡 Fetch & write...\n");

  while (true) {
    let data;
    try {
      data = await fetchPage(publishedFrom, publishedTo, page);
    } catch (e) {
      console.error(`  ❌ Errore pagina ${page}: ${e.message}`);
      totalErrors++;
      break;
    }

    const releases = data.releases ?? [];
    if (releases.length === 0) break;

    const records = releases.map(mapOcdsRelease);
    totalFetched += records.length;

    // Filtra: solo bandi con titolo e scadenza futura (o senza scadenza)
    const valid = records.filter(r =>
      r.titolo && r.titolo.trim().length > 5 &&
      (!r.scadenza || r.scadenza >= todayStr)
    );
    totalSkipped += records.length - valid.length;

    // Upsert
    if (!IS_DRY_RUN && valid.length > 0) {
      for (let i = 0; i < valid.length; i += UPSERT_BATCH) {
        const batch = valid.slice(i, i + UPSERT_BATCH);
        const { error } = await supabase
          .from("bandolo_tenders")
          .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
        if (error) {
          console.error(`  ❌ Upsert error: ${error.message}`);
          totalErrors++;
        } else {
          totalUpserted += batch.length;
        }
      }
    }

    process.stdout.write(`\r  📥 Pagina ${page} — ${totalFetched} fetch, ${totalUpserted} salvati   `);

    if (releases.length < PAGE_SIZE) break;
    page++;
    await jitter(300, 700);
  }

  // Cleanup scaduti
  if (!IS_DRY_RUN) {
    const { count } = await supabase
      .from("bandolo_tenders")
      .delete({ count: "exact" })
      .eq("source", "contracts-finder")
      .lt("scadenza", todayStr)
      .not("scadenza", "is", null);
    if (count > 0) console.log(`\n  🧹 Rimossi ${count} bandi CF scaduti`);
  }

  // Salva stato
  saveState({ ...state, cf: { lastSyncedAt: new Date().toISOString(), totalUpserted } });

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n" + "═".repeat(70));
  console.log("  ✅ SYNC CONTRACTS FINDER COMPLETATO");
  console.log("═".repeat(70));
  console.log(`  📥 Bandi scaricati:    ${totalFetched}`);
  if (totalSkipped > 0) console.log(`  ⏭️  Scartati:           ${totalSkipped}`);
  if (!IS_DRY_RUN) console.log(`  💾 Salvati su DB:      ${totalUpserted}`);
  if (totalErrors > 0) console.log(`  ❌ Errori:             ${totalErrors}`);
  console.log(`  ⏱️  Tempo:              ${elapsed}s`);
  console.log("═".repeat(70));
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
