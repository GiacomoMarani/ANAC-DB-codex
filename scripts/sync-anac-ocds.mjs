/**
 * sync-anac-ocds.mjs — ANAC OCDS Bulk Sync → Supabase (GitHub Actions)
 *
 * Replica la logica di lib/services/anacSync.ts in un formato standalone
 * eseguibile da GitHub Actions senza dipendenze Next.js/Vercel.
 *
 * Scarica i file mensili OCDS (~748 MB) da dati.anticorruzione.it,
 * estrae i bandi attivi via streaming JSON parser, e li inserisce in
 * Supabase nelle tabelle `cig` e `aggiudicatari`.
 *
 * USAGE:
 *   node scripts/sync-anac-ocds.mjs                → ultimo mese disponibile
 *   node scripts/sync-anac-ocds.mjs --months 3     → ultimi 3 mesi
 *   node scripts/sync-anac-ocds.mjs --month 2026-07 → mese specifico
 *   node scripts/sync-anac-ocds.mjs --dry-run      → no DB write
 *
 * SCHEDULING:
 *   GitHub Actions: .github/workflows/sync-anac-ocds.yml (daily 03:00 UTC)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
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
    // .env.local not found — CI uses env vars directly
  }
}

loadEnv();

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ANAC_BASE = "https://dati.anticorruzione.it";
const BULK_BASE = `${ANAC_BASE}/opendata/download/dataset/ocds/filesystem/bulk`;

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024; // 8 MB rolling buffer

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Connection": "keep-alive",
};

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const IS_DRY_RUN = hasFlag("dry-run");
const SPECIFIC_MONTH = getArg("month");
const MONTHS_COUNT = getArg("months") ? parseInt(getArg("months"), 10) : 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function trunc(value, max) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  return s ? s.substring(0, max) : null;
}

function parseAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  const n = Number(String(value).replace(/\s+/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}

/**
 * Returns "YYYY-MM" for the most recent N months.
 * Starts from last month since the current month's bulk is published ~5th of next month.
 */
function getRecentMonths(count = 1) {
  const months = [];
  const now = new Date();
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

// ── Business logic: is active tender? ────────────────────────────────────────

function isActiveTender(release) {
  const status = release.tender?.status;
  if (status && status !== "active") return false;

  // Check expiry date
  const endDate = release.tender?.tenderPeriod?.endDate;
  if (endDate) {
    const expiry = new Date(endDate);
    if (!isNaN(expiry.getTime()) && expiry < new Date()) return false;
  }

  return true;
}

// ── OCDS → CIG mapping ──────────────────────────────────────────────────────

function mapOcds(release) {
  const t = release.tender ?? {};
  const cig = trunc(t.id ?? release.ocid, 50);
  if (!cig) return null;

  const cpvId = trunc(t.items?.[0]?.classification?.id, 20);
  const cpvDesc = trunc(t.items?.[0]?.classification?.description, 1000);

  return {
    cig,
    oggetto_gara:                 trunc(t.title, 4000),
    importo_lotto:                parseAmount(t.value?.amount),
    oggetto_principale_contratto: trunc(t.mainProcurementCategory, 500),
    stato:                        trunc(t.status, 100),
    provincia:                    trunc(t.procuringEntity?.address?.region ?? t.procuringEntity?.address?.locality, 100),
    data_pubblicazione:           trunc(t.tenderPeriod?.startDate, 50),
    data_scadenza_offerta:        trunc(t.tenderPeriod?.endDate, 50),
    sezione_regionale:            trunc(t.procuringEntity?.address?.region, 100),
    descrizione_cpv:              cpvDesc ?? cpvId,
    esito:                        trunc(release.awards?.[0]?.status, 100),
  };
}

// ── OCDS → Aggiudicatari mapping ─────────────────────────────────────────────

function extractAggiudicatari(release) {
  const results = [];
  const t = release.tender ?? {};
  const cig = trunc(t.id ?? release.ocid, 50);
  if (!cig) return results;

  const cpvId = trunc(t.items?.[0]?.classification?.id, 20);
  const cpvDesc = trunc(t.items?.[0]?.classification?.description, 1000);
  const oggetto = trunc(t.title, 4000);
  const provincia = trunc(
    t.procuringEntity?.address?.region ?? t.procuringEntity?.address?.locality,
    100
  );

  for (const award of release.awards ?? []) {
    const awardStatus = award.status?.toLowerCase();
    if (awardStatus === "unsuccessful" || awardStatus === "cancelled") continue;

    const awardDate = trunc(award.date, 50);
    const awardAmount = parseAmount(award.value?.amount);

    for (const supplier of award.suppliers ?? []) {
      const cf = trunc(supplier.identifier?.id ?? supplier.id, 16);
      if (!cf) continue;

      const cfClean = cf.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (cfClean.length < 11) continue;

      results.push({
        codice_fiscale: cfClean,
        denominazione: trunc(supplier.identifier?.legalName ?? supplier.name, 1000),
        tipo_soggetto: null,
        cig,
        importo_aggiudicazione: awardAmount,
        data_aggiudicazione: awardDate,
        ruolo: trunc(supplier.roles?.[0], 100),
        codice_cpv: cpvId,
        descrizione_cpv: cpvDesc,
        oggetto_gara: oggetto,
        provincia,
      });
    }
  }

  return results;
}

// ── Streaming OCDS Release Package parser ────────────────────────────────────

async function* streamReleases(res) {
  if (!res.body) throw new Error("Response body è null — streaming non supportato");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let foundReleases = false;
  let depth = 0;
  let inObj = false;
  let objStart = 0;
  let inString = false;
  let escaped = false;
  const SEARCH_TOKENS = ['"releases": [', '"releases":[', '"releases" : ['];
  let SEARCH_TOKEN = '"releases": [';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: !done });

      if (!foundReleases) {
        let bestIdx = -1;
        for (const tok of SEARCH_TOKENS) {
          const idx = buffer.indexOf(tok);
          if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) {
            bestIdx = idx;
            SEARCH_TOKEN = tok;
          }
        }
        if (bestIdx === -1) {
          const keep = Math.max(0, buffer.length - 30);
          buffer = buffer.slice(keep);
          continue;
        }
        buffer = buffer.slice(bestIdx + SEARCH_TOKEN.length);
        foundReleases = true;
        inObj = false;
        depth = 0;
        inString = false;
        escaped = false;
      }

      let i = 0;
      while (i < buffer.length) {
        const ch = buffer[i];

        if (escaped) { escaped = false; i++; continue; }
        if (inString) {
          if (ch === "\\") { escaped = true; i++; continue; }
          if (ch === '"') inString = false;
          i++; continue;
        }
        if (ch === '"') { inString = true; i++; continue; }

        if (!inObj) {
          if (ch === "{") { inObj = true; depth = 1; objStart = i; }
          else if (ch === "]") break;
          i++; continue;
        }

        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const jsonStr = buffer.slice(objStart, i + 1);
            try {
              yield JSON.parse(jsonStr);
            } catch { /* skip malformed */ }
            buffer = buffer.slice(i + 1);
            i = 0;
            inObj = false;
            depth = 0;
            continue;
          }
        }
        i++;
      }

      if (!inObj) {
        buffer = "";
      } else if (buffer.length > MAX_BUFFER_BYTES && objStart > 0) {
        buffer = buffer.slice(objStart);
        objStart = 0;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ── Fetch with retry ─────────────────────────────────────────────────────────

async function fetchWithRetry(url) {
  let lastError = new Error("Unknown fetch error");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(300_000), // 5 min
        redirect: "follow",
      });
      if (res.ok) return res;
      if (res.status === 404) throw new Error(`HTTP 404: ${url}`);
      if (res.status === 403) throw new Error(`HTTP 403: ${url}`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes("404") || lastError.message.includes("403")) throw lastError;
    }
    if (attempt < MAX_RETRIES - 1) await sleep(1000 * Math.pow(2, attempt));
  }
  throw lastError;
}

// ── Upsert batches ───────────────────────────────────────────────────────────

async function upsertCigBatch(records, stats) {
  if (IS_DRY_RUN || !records.length) return;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("cig").upsert(chunk, { onConflict: "cig" });
    if (error) {
      stats.errors += chunk.length;
      if (stats.errorMessages.length < 10) {
        stats.errorMessages.push(`CIG upsert: ${error.message}`);
      }
    } else {
      stats.imported += chunk.length;
    }
    if (i + BATCH_SIZE < records.length) await sleep(120);
  }
}

async function upsertAggiudicatariBatch(records, stats) {
  if (IS_DRY_RUN || !records.length) return;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("aggiudicatari")
      .upsert(chunk, { onConflict: "codice_fiscale,cig" });
    if (error) {
      // Non-fatal: aggiudicatari table might not exist yet
      if (stats.aggiudicatariErrors === 0 && stats.errorMessages.length < 10) {
        stats.errorMessages.push(`Aggiudicatari upsert: ${error.message}`);
      }
      stats.aggiudicatariErrors++;
    } else {
      stats.aggiudicatariImported += chunk.length;
    }
    if (i + BATCH_SIZE < records.length) await sleep(120);
  }
}

// ── Sync a single month ──────────────────────────────────────────────────────

async function syncMonth(yearMonth) {
  const [year, month] = yearMonth.split("-");
  const url = `${BULK_BASE}/${year}/${month.padStart(2, "0")}.json`;
  const startedAt = Date.now();

  const stats = {
    month: yearMonth,
    fetched: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
    aggiudicatariImported: 0,
    aggiudicatariErrors: 0,
  };

  // HEAD check
  log(`  📡 Checking ${url}...`);
  const head = await fetch(url, {
    method: "HEAD",
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (!head.ok) {
    // Try fallback to previous month
    const [y, m] = yearMonth.split("-").map(Number);
    const prev = new Date(y, m - 2, 1);
    const fallback = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    log(`  ⚠️ Mese ${yearMonth} non disponibile (HTTP ${head.status}), provo ${fallback}...`);
    return syncMonth(fallback);
  }

  log(`  ✅ File disponibile — avvio streaming...`);

  const res = await fetchWithRetry(url);
  const cigBatch = [];
  const awardBatch = [];

  const flush = async () => {
    if (cigBatch.length) {
      await upsertCigBatch(cigBatch, stats);
      cigBatch.length = 0;
    }
    if (awardBatch.length) {
      await upsertAggiudicatariBatch(awardBatch, stats);
      awardBatch.length = 0;
    }
  };

  try {
    for await (const release of streamReleases(res)) {
      stats.fetched++;

      // Extract aggiudicatari from ALL releases
      const awards = extractAggiudicatari(release);
      if (awards.length > 0) {
        awardBatch.push(...awards);
        if (awardBatch.length >= BATCH_SIZE) {
          await upsertAggiudicatariBatch(awardBatch, stats);
          awardBatch.length = 0;
        }
      }

      // CIG: only active tenders
      if (!isActiveTender(release)) {
        stats.skipped++;
        continue;
      }

      const record = mapOcds(release);
      if (!record) { stats.skipped++; continue; }

      cigBatch.push(record);
      if (cigBatch.length >= BATCH_SIZE) await flush();

      // Progress log every 10K records
      if (stats.fetched % 10000 === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        log(`     ${stats.fetched.toLocaleString()} releases | ${stats.imported} CIG importati | ${stats.aggiudicatariImported} aggiudicatari | ${elapsed.toFixed(0)}s`);
      }
    }
    await flush();
  } catch (err) {
    stats.errors++;
    stats.errorMessages.push(`Stream error: ${err.message}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`  📊 Mese ${yearMonth}: ${stats.fetched.toLocaleString()} releases, ${stats.imported} CIG, ${stats.aggiudicatariImported} aggiudicatari, ${stats.skipped} scartati (${elapsed}s)`);

  return stats;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  log("═══════════════════════════════════════════════════════════");
  log("  ANAC OCDS Bulk Sync (GitHub Actions)");
  log(`  Dry run: ${IS_DRY_RUN}`);
  log("═══════════════════════════════════════════════════════════");

  const months = SPECIFIC_MONTH ? [SPECIFIC_MONTH] : getRecentMonths(MONTHS_COUNT);
  log(`\n📅 Mesi da sincronizzare: ${months.join(", ")}\n`);

  let totalImported = 0;
  let totalAggiudicatari = 0;
  let totalErrors = 0;

  for (const month of months) {
    log(`\n🔄 Sync mese: ${month}`);
    log("─".repeat(50));

    try {
      const result = await syncMonth(month);
      totalImported += result.imported;
      totalAggiudicatari += result.aggiudicatariImported;
      totalErrors += result.errors;

      if (result.errorMessages.length > 0) {
        for (const msg of result.errorMessages) {
          log(`  ⚠️ ${msg}`);
        }
      }
    } catch (err) {
      log(`  ❌ Errore fatale per ${month}: ${err.message}`);
      totalErrors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log("");
  log("═══════════════════════════════════════════════════════════");
  log("  ✅ SYNC ANAC OCDS COMPLETATO");
  log("═══════════════════════════════════════════════════════════");
  log(`  ⏱️  Tempo totale:       ${elapsed}s`);
  log(`  📅 Mesi processati:    ${months.length}`);
  log(`  💾 CIG importati:      ${totalImported}`);
  log(`  👤 Aggiudicatari:      ${totalAggiudicatari}`);
  if (totalErrors > 0) log(`  ❌ Errori:             ${totalErrors}`);
  log("═══════════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
