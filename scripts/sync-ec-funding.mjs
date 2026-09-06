// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * sync-ec-funding.mjs
 * Sincronizza call/topic dal portale EU Funding & Tenders (Horizon Europe, LIFE, Digital Europe, ecc.)
 * Dati via: https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/grantsTenders.json
 * Nessuna API key richiesta.
 *
 * Usage:
 *   node scripts/sync-ec-funding.mjs            # solo OPEN
 *   node scripts/sync-ec-funding.mjs --all      # OPEN + FORTHCOMING
 *   node scripts/sync-ec-funding.mjs --dry-run  # no DB write
 */

import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────

const DATA_URL   = "https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/grantsTenders.json";
const UPSERT_BATCH = 200;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");
const INC_ALL    = args.includes("--all"); // includi anche FORTHCOMING

// ── Supabase ──────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Mapping ───────────────────────────────────────────────────────────────────

// Converte Unix timestamp ms → YYYY-MM-DD
function tsToDate(ms) {
  if (!ms) return null;
  try { return new Date(ms).toISOString().slice(0, 10); }
  catch { return null; }
}

function mapECRecord(item) {
  // deadlineDatesLong: array di timestamp — prendiamo l'ultimo (più lontano)
  const deadlines = Array.isArray(item.deadlineDatesLong)
    ? item.deadlineDatesLong.filter(Boolean)
    : [];
  const scadenza = deadlines.length > 0
    ? tsToDate(Math.max(...deadlines))
    : null;

  const pubblicazione = tsToDate(item.publicationDateLong ?? item.plannedOpeningDateLong);

  // Link al portale
  const link = item.links?.find(l => l.service === "topic" || l.service === "call")?.href
    ?? (item.identifier
        ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${item.identifier}`
        : null);

  // Programma EU come "ente"
  const ente = [item.frameworkProgramme, item.programmeDivision].filter(Boolean).join(" / ") || null;

  // Keywords → settori
  const settori = item.keywords?.join(", ") || null;

  // Status: OPEN, FORTHCOMING, CLOSED
  const status = item.status ?? "";

  return {
    id:             `ec-funding:${item.ccm2Id ?? item.identifier}`,
    titolo:         item.title ?? null,
    ente,
    descrizione:    null,
    scadenza,
    country:        "EU",
    tender_type:    "grant",
    importo_max:    null,
    settori,
    source:         "ec.europa.eu",
    link,
    intl_created_at: pubblicazione ? new Date(pubblicazione).toISOString() : null,
    synced_at:      new Date().toISOString(),
    // Non salvato ma usato per il filtro
    _status:        status,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString("it-IT");
  const todayStr = new Date().toISOString().slice(0, 10);

  console.log("═".repeat(70));
  console.log("  EU Funding & Tenders Portal → Supabase Sync");
  console.log(`  ${today}${INC_ALL ? " — OPEN + FORTHCOMING" : " — solo OPEN"}`);
  console.log("═".repeat(70));
  if (IS_DRY_RUN) console.log("  🧪 DRY RUN — nessuna scrittura su DB");
  console.log("");

  // Download JSON completo (~5MB)
  console.log("📡 Download grantsTenders.json...");
  let rawItems;
  try {
    const r = await fetch(DATA_URL, { signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    rawItems = d.fundingData?.GrantTenderObj;
    if (!Array.isArray(rawItems)) throw new Error("Struttura JSON inattesa");
    console.log(`  ✅ Scaricati ${rawItems.length.toLocaleString()} topic/call\n`);
  } catch (e) {
    console.error(`❌ Download fallito: ${e.message}`);
    process.exitCode = 0; return;
  }

  // Filtra: status.abbreviation oppure, se tutti Closed, usa scadenza futura come proxy
  const todayMs = Date.now();

  const allowedAbbreviations = INC_ALL
    ? ["Open", "Forthcoming", "open", "forthcoming"]
    : ["Open", "open"];

  // Prima proviamo il filtro per status
  let filtered = rawItems.filter(item => {
    const abbr = item.status?.abbreviation ?? item.status;
    return allowedAbbreviations.includes(abbr);
  });

  // Se nessun risultato con status (tutto "Closed"), usa scadenza futura
  if (filtered.length === 0) {
    console.log("  ℹ️  Status non discriminante — filtro per scadenza futura\n");
    filtered = rawItems.filter(item => {
      const deadlines = Array.isArray(item.deadlineDatesLong)
        ? item.deadlineDatesLong.filter(Boolean)
        : [];
      if (deadlines.length === 0) {
        // Senza scadenza: includi se la data di apertura è recente (< 1 anno fa)
        const open = item.plannedOpeningDateLong ?? item.publicationDateLong;
        return open && (todayMs - open) < 365 * 24 * 3600 * 1000;
      }
      return Math.max(...deadlines) > todayMs;
    });
  }
  console.log(`  📊 Con scadenza futura/recente: ${filtered.length.toLocaleString()}\n`);

  // Mappa
  const records = filtered
    .map(mapECRecord)
    .filter(r => {
      // Rimuovi _status dal record prima di salvare
      delete r._status;
      // Escludi senza titolo
      if (!r.titolo?.trim()) return false;
      // Escludi con scadenza passata
      if (r.scadenza && r.scadenza < todayStr) return false;
      return true;
    });

  console.log(`  ✅ Record validi da salvare: ${records.length}\n`);
  console.log("📡 Upsert su Supabase...");

  let totalUpserted = 0;
  let totalErrors = 0;

  if (!IS_DRY_RUN) {
    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      const batch = records.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase
        .from("intl_tenders")
        .upsert(batch, { onConflict: "id", ignoreDuplicates: true });
      if (error) {
        console.error(`  ❌ Upsert error: ${error.message}`);
        totalErrors++;
      } else {
        totalUpserted += batch.length;
      }
      const pct = Math.round((i + batch.length) / records.length * 100);
      process.stdout.write(`\r  💾 ${i + batch.length}/${records.length} (${pct}%)   `);
    }
  }

  // Cleanup scaduti
  if (!IS_DRY_RUN) {
    const { count } = await supabase
      .from("intl_tenders")
      .delete({ count: "exact" })
      .eq("source", "ec.europa.eu")
      .lt("scadenza", todayStr)
      .not("scadenza", "is", null);
    if (count > 0) console.log(`\n  🧹 Rimossi ${count} topic EC scaduti`);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n" + "═".repeat(70));
  console.log("  ✅ SYNC EU FUNDING COMPLETATO");
  console.log("═".repeat(70));
  console.log(`  📥 Topic scaricati (totale):  ${rawItems.length}`);
  console.log(`  🎯 Filtrati (scadenza futura): ${filtered.length}`);
  console.log(`  ✅ Record validi:              ${records.length}`);
  if (!IS_DRY_RUN) console.log(`  💾 Salvati su DB:              ${totalUpserted}`);
  if (totalErrors > 0) console.log(`  ❌ Errori:                     ${totalErrors}`);
  console.log(`  ⏱️  Tempo:                      ${elapsed}s`);
  console.log("═".repeat(70));
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
