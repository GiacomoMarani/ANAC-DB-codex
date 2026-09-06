/**
 * sync-boamp.mjs
 * Sincronizza i bandi di gara francesi da BOAMP (boamp.fr)
 * via API OpenDataSoft DILA — https://boamp-datadila.opendatasoft.com
 *
 * Usage:
 *   node scripts/sync-boamp.mjs              # incrementale (ultimi 7 giorni)
 *   node scripts/sync-boamp.mjs --full       # tutti i bandi attivi
 *   node scripts/sync-boamp.mjs --days 30    # ultimi N giorni
 *   node scripts/sync-boamp.mjs --dry-run    # no DB write
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const BOAMP_BASE = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const PAGE_SIZE  = 100; // max OpenDataSoft
const UPSERT_BATCH = 200;
const STATE_FILE = ".boamp-sync-state.json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_FULL    = args.includes("--full");
const IS_DRY_RUN = args.includes("--dry-run");
const DAYS_ARG   = args.indexOf("--days");
const DAYS       = DAYS_ARG >= 0 ? parseInt(args[DAYS_ARG + 1]) : (IS_FULL ? null : 7);

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

// ── Mapping ───────────────────────────────────────────────────────────────────

function mapBoampRecord(rec) {
  // Estrai importo da campo montant (es. "150000 EUR" o numero)
  let importo = null;
  if (rec.montant) {
    const num = parseFloat(String(rec.montant).replace(/[^0-9.]/g, ""));
    if (!isNaN(num)) importo = num;
  }

  // Scadenza: datelimitereponse è ISO con timezone
  const scadenza = rec.datelimitereponse
    ? rec.datelimitereponse.slice(0, 10)
    : null;

  // Pubblicazione: dateparution è YYYY-MM-DD
  const pubblicazione = rec.dateparution ?? null;

  // Link ufficiale
  const link = rec.url_avis
    ?? (rec.idweb ? `https://www.boamp.fr/pages/avis/?q=idweb:${rec.idweb}` : null);

  // CPV / settori
  const settori = rec.descripteur_libelle
    ? (Array.isArray(rec.descripteur_libelle)
        ? rec.descripteur_libelle.join(", ")
        : rec.descripteur_libelle)
    : null;

  return {
    id:             `boamp:${rec.idweb ?? rec.id}`,
    titolo:         rec.objet ?? null,
    ente:           rec.nomacheteur ?? null,
    descrizione:    rec.donnees?.description ?? null,
    scadenza,
    country:        "FR",
    tender_type:    "grant",
    importo_max:    importo,
    settori,
    source:         "boamp",
    link,
    intl_created_at: pubblicazione ? new Date(pubblicazione).toISOString() : null,
    synced_at:      new Date().toISOString(),
  };
}

// ── Health check ──────────────────────────────────────────────────────────────

async function healthCheck() {
  try {
    const r = await fetch(`${BOAMP_BASE}?limit=1`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      console.error(`❌ BOAMP API errore HTTP ${r.status}`);
      return false;
    }
    const d = await r.json();
    console.log(`  ✅ BOAMP API online — ${d.total_count?.toLocaleString()} record totali\n`);
    return true;
  } catch (e) {
    console.error(`❌ BOAMP API non raggiungibile: ${e.message}`);
    return false;
  }
}

// ── Fetch page ────────────────────────────────────────────────────────────────

async function fetchPage(offset, dateFrom) {
  const today = new Date().toISOString().slice(0, 10);

  // Filtro: solo bandi con scadenza futura
  // OpenDataSoft v2.1: usa date'YYYY-MM-DD' oppure "YYYY-MM-DDTHH:mm:ssZ"
  const clauses = [`datelimitereponse > "${today}T00:00:00Z"`];
  if (dateFrom) {
    clauses.push(`dateparution >= "${dateFrom}"`);
  }
  const where = clauses.join(" AND ");

  const params = new URLSearchParams({
    limit:    String(PAGE_SIZE),
    offset:   String(offset),
    order_by: "dateparution DESC",
    where,
    select:   "idweb,id,objet,nomacheteur,datelimitereponse,dateparution,url_avis,descripteur_libelle,descripteur_code,donnees",
  });

  const r = await fetch(`${BOAMP_BASE}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  return await r.json();
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
  console.log("  BOAMP → Supabase Sync");
  console.log(`  ${today}${IS_FULL ? " — FULL SYNC" : ` — ultimi ${DAYS ?? "?"} giorni`}`);
  console.log("═".repeat(70));
  if (IS_DRY_RUN) console.log("  🧪 DRY RUN — nessuna scrittura su DB");
  console.log("");

  // Health check
  console.log("🏥 Health check BOAMP...");
  const alive = await healthCheck();
  if (!alive) { process.exitCode = 0; return; }

  // Data di partenza per il filtro
  let dateFrom = null;
  if (!IS_FULL && DAYS) {
    const d = new Date();
    d.setDate(d.getDate() - DAYS);
    dateFrom = d.toISOString().slice(0, 10);
    console.log(`  📅 Bandi pubblicati dal: ${dateFrom}\n`);
  }

  // Fetch & upsert
  let offset = 0;
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalAvailable = null;

  console.log("📡 Fetch & write...\n");

  while (true) {
    let data;
    try {
      data = await fetchPage(offset, dateFrom);
    } catch (e) {
      console.error(`  ❌ Errore pagina offset=${offset}: ${e.message}`);
      totalErrors++;
      break;
    }

    if (totalAvailable === null) {
      totalAvailable = data.total_count ?? 0;
      console.log(`  📊 Bandi attivi trovati: ${totalAvailable.toLocaleString()}\n`);
    }

    const records = (data.results ?? []).map(mapBoampRecord);
    totalFetched += records.length;

    // Filtra spurii
    const today = new Date().toISOString().slice(0, 10);
    const valid = records.filter(r =>
      r.titolo && r.titolo.trim().length > 5 &&
      (!r.scadenza || r.scadenza >= today)
    );
    totalSkipped += records.length - valid.length;

    // Upsert
    if (!IS_DRY_RUN && valid.length > 0) {
      for (let i = 0; i < valid.length; i += UPSERT_BATCH) {
        const batch = valid.slice(i, i + UPSERT_BATCH);
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

    const progress = totalAvailable
      ? ` (${Math.round((offset + records.length) / totalAvailable * 100)}%)`
      : "";
    process.stdout.write(`\r  📥 ${offset + records.length}/${totalAvailable}${progress} — salvati: ${totalUpserted}   `);

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;

    await jitter(200, 500);
  }

  // Cleanup scaduti nel DB
  if (!IS_DRY_RUN) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { count } = await supabase
      .from("intl_tenders")
      .delete({ count: "exact" })
      .eq("source", "boamp")
      .lt("scadenza", todayStr)
      .not("scadenza", "is", null);
    if (count > 0) console.log(`\n  🧹 Rimossi ${count} bandi BOAMP scaduti`);
  }

  // Salva stato
  saveState({ ...state, boamp: { lastSyncedAt: new Date().toISOString(), totalUpserted } });

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n" + "═".repeat(70));
  console.log("  ✅ SYNC BOAMP COMPLETATO");
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
