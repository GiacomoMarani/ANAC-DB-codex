/**
 * sync-anac.mjs
 *
 * Sincronizza i bandi in corso da ANAC → Supabase.
 *
 * LOGICA:
 *   1. Playwright scarica TUTTI i bandi in corso da ANAC (datasource 81)
 *   2. Upsert su Supabase (per CIG, no duplicati)
 *   3. I bandi in Supabase che NON sono più su ANAC → marcati "closed"
 *      → Supabase riflette sempre e solo i bandi attivi
 *
 * USO:
 *   node sync-anac.mjs                   → sync completo
 *   node sync-anac.mjs --limit 50        → solo i primi 50 (test)
 *   node sync-anac.mjs --query "scuola"  → solo bandi con "scuola"
 *
 * SCHEDULAZIONE (Windows Task Scheduler):
 *   Programma: node
 *   Argomenti: sync-anac.mjs
 *   Inizio in: C:\...\ANAC-DB-codex-main
 *   Frequenza: ogni 6 ore
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Carica .env.local ─────────────────────────────────────────────────────────

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

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ANAC_BASE = "https://dati.anticorruzione.it";
const ANAC_DASHBOARD = `${ANAC_BASE}/superset/dashboard/appalti/`;
const ANAC_CSRF_URL = `${ANAC_BASE}/api/v1/security/csrf_token/`;
const ANAC_CHART_URL = `${ANAC_BASE}/api/v1/chart/data`;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const PAGE_SIZE = 500;
const MAX_ROWS = getArg("limit") ? parseInt(getArg("limit"), 10) : Infinity;
const SEARCH_QUERY = getArg("query") || null;

// ── ANAC columns ──────────────────────────────────────────────────────────────

const ANAC_COLUMNS = [
  "cig",
  "oggetto_bando",
  "importo_lotto",
  "denominazione_amministrazione_appaltante",
  "data_pubblicazione",
  "oggetto_principale_contratto",
  "tipo_scelta_contraente",
  "sezione_regionale",
  "cod_cpv",
  "provincia",
];

// ── Mapping ───────────────────────────────────────────────────────────────────

/** Tronca stringhe lunghe per rientrare nel limite varchar(4000) di Supabase */
function trunc(val, max = 3990) {
  if (!val || typeof val !== "string") return val || null;
  return val.length > max ? val.slice(0, max) + "…" : val;
}

function mapToSupabase(row) {
  const tsMs = typeof row.data_pubblicazione === "number" ? row.data_pubblicazione : null;
  const dataPub = tsMs ? new Date(tsMs).toISOString().split("T")[0] : null;

  const scadMs = typeof row.data_scadenza_offerta === "number" ? row.data_scadenza_offerta : null;
  const dataScad = scadMs ? new Date(scadMs).toISOString().split("T")[0] : (typeof row.data_scadenza_offerta === "string" ? row.data_scadenza_offerta.split("T")[0] : null);

  return {
    cig: row.cig,
    oggetto_gara: trunc(row.oggetto_bando),
    importo_lotto: typeof row.importo_lotto === "number" ? row.importo_lotto : null,
    oggetto_principale_contratto: trunc(row.oggetto_principale_contratto),
    stato: "active",
    provincia: trunc(row.provincia),
    data_pubblicazione: dataPub,
    data_scadenza_offerta: dataScad,
    sezione_regionale: trunc(row.sezione_regionale),
    descrizione_cpv: trunc(row.cod_cpv),
    denominazione_amministrazione_appaltante: trunc(row.denominazione_amministrazione_appaltante),
    esito: null,
  };
}

// ── Build Superset payload ────────────────────────────────────────────────────

function buildPayload(offset, limit) {
  const filters = [];
  if (SEARCH_QUERY) {
    filters.push({
      col: "oggetto_bando",
      op: "LIKE",
      val: `%${SEARCH_QUERY.toUpperCase()}%`,
    });
  }

  return {
    datasource: { id: 81, type: "table" },
    force: false,
    queries: [
      {
        time_range: "No filter",
        filters,
        extras: {
          time_range_endpoints: ["inclusive", "exclusive"],
          having: "",
          having_druid: [],
          where: "",
        },
        applied_time_extras: {},
        columns: ANAC_COLUMNS,
        metrics: [],
        orderby: [["data_pubblicazione", false]],
        annotation_layers: [],
        row_limit: limit,
        row_offset: offset,
        order_desc: true,
        url_params: {},
        custom_params: {},
        custom_form_data: {},
        groupby: [],
      },
    ],
    form_data: {
      datasource: "81__table",
      viz_type: "table",
      query_mode: "raw",
      all_columns: ANAC_COLUMNS,
      groupby: [],
      metrics: [],
      row_limit: limit,
      order_desc: true,
      result_format: "json",
      result_type: "full",
    },
    result_format: "json",
    result_type: "full",
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString("it-IT");

  console.log("═".repeat(70));
  console.log("  ANAC → Supabase Sync — Bandi in Corso");
  console.log(`  ${today}`);
  console.log("═".repeat(70));
  if (SEARCH_QUERY) console.log(`  🔍 Filtro: "${SEARCH_QUERY}"`);
  if (MAX_ROWS < Infinity) console.log(`  📊 Limite: ${MAX_ROWS} bandi`);
  console.log("");

  // 1. Avvia Playwright
  console.log("🚀 Avvio Chromium headless...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    locale: "it-IT",
    timezoneId: "Europe/Rome",
  });

  try {
    // 2. Sessione ANAC (con retry per WAF/cloud IP)
    console.log("📡 Connessione ad ANAC...");
    const page = await context.newPage();

    let csrf = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(ANAC_BASE + "/", {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(2000 + attempt * 1000);
        await page.goto(ANAC_DASHBOARD, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(3000 + attempt * 1000);
        console.log("✅ Sessione ANAC stabilita");

        // 3. CSRF token
        const csrfRes = await page.request.get(ANAC_CSRF_URL, {
          headers: { Accept: "application/json" },
        });

        const csrfText = await csrfRes.text();
        if (!csrfText || csrfText.trim().length === 0) {
          throw new Error("Risposta CSRF vuota — probabile blocco WAF");
        }

        let csrfBody;
        try {
          csrfBody = JSON.parse(csrfText);
        } catch {
          throw new Error(`Risposta CSRF non è JSON valido: ${csrfText.slice(0, 200)}`);
        }

        csrf = csrfBody.result;
        if (!csrf) throw new Error("CSRF token vuoto nel JSON");
        console.log("🔑 CSRF ottenuto");
        break; // successo!
      } catch (e) {
        console.warn(`  ⚠️ Tentativo ${attempt}/3 fallito: ${e.message}`);
        if (attempt === 3) {
          throw new Error(
            `Impossibile connettersi ad ANAC dopo 3 tentativi. ` +
            `Possibile blocco WAF per IP cloud. Ultimo errore: ${e.message}`
          );
        }
        console.log(`  ⏳ Attesa ${attempt * 5}s prima del prossimo tentativo...`);
        await page.waitForTimeout(attempt * 5000);
      }
    }

    // 4. Scarica tutti i bandi paginando
    const allCigs = new Set();     // CIG scaricati da ANAC in questo sync
    const allRecords = [];         // record da upsertare
    let totalFetched = 0;
    let offset = 0;
    let pageNum = 0;

    while (totalFetched < MAX_ROWS) {
      const limit = Math.min(PAGE_SIZE, MAX_ROWS - totalFetched);
      pageNum++;

      process.stdout.write(`  📄 Pagina ${pageNum} (offset: ${offset})...`);

      const payload = buildPayload(offset, limit);
      const res = await page.request.post(ANAC_CHART_URL, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": csrf,
          Referer: ANAC_DASHBOARD,
          Origin: ANAC_BASE,
        },
        data: JSON.stringify(payload),
        timeout: 60_000,
      });

      if (!res.ok()) {
        const text = await res.text();
        console.error(`\n❌ HTTP ${res.status()}: ${text.slice(0, 300)}`);
        break;
      }

      const contentType = res.headers()["content-type"] || "";
      if (!contentType.includes("json")) {
        console.error("\n❌ WAF block — risposta non-JSON. Riprova più tardi.");
        break;
      }

      const data = await res.json();
      const result = data?.result?.[0];

      if (result?.error) {
        console.error("\n❌ Errore Dremio:", result.error);
        break;
      }

      const rows = result?.data || [];

      if (rows.length === 0) {
        console.log(" fine dati.");
        break;
      }

      const records = rows.filter((r) => r.cig).map(mapToSupabase);
      for (const r of records) allCigs.add(r.cig);
      allRecords.push(...records);
      totalFetched += rows.length;
      offset += rows.length;

      console.log(` ${rows.length} bandi ✓`);

      if (rows.length < limit) break;

      // Pausa tra le pagine
      await page.waitForTimeout(800);
    }

    await page.close();

    console.log(`\n📥 Totale scaricati da ANAC: ${totalFetched} bandi`);

    // 5. Upsert su Supabase
    console.log("\n💾 Scrittura su Supabase...");
    let totalUpserted = 0;

    for (let i = 0; i < allRecords.length; i += 100) {
      const batch = allRecords.slice(i, i + 100);
      const { error } = await supabase
        .from("cig")
        .upsert(batch, { onConflict: "cig", ignoreDuplicates: false });

      if (error) {
        console.error(`  ❌ Errore batch ${Math.floor(i / 100) + 1}:`, error.message);
      } else {
        totalUpserted += batch.length;
        process.stdout.write(
          `\r  💾 ${totalUpserted}/${allRecords.length} bandi scritti...`
        );
      }
    }
    console.log(`\r  💾 ${totalUpserted}/${allRecords.length} bandi scritti ✓    `);

    // 6. Chiudi i bandi scaduti (in Supabase ma non più su ANAC)
    console.log("\n🧹 Pulizia bandi scaduti...");
    const { data: existing, error: fetchErr } = await supabase
      .from("cig")
      .select("cig")
      .eq("stato", "active");

    if (fetchErr) {
      console.error("  ❌ Errore lettura Supabase:", fetchErr.message);
    } else if (existing) {
      const stale = existing.filter((r) => !allCigs.has(r.cig)).map((r) => r.cig);

      if (stale.length > 0) {
        // Aggiorna in batch da 100
        for (let i = 0; i < stale.length; i += 100) {
          const batch = stale.slice(i, i + 100);
          const { error: updateErr } = await supabase
            .from("cig")
            .update({ stato: "closed" })
            .in("cig", batch);

          if (updateErr) {
            console.error(`  ❌ Errore chiusura batch:`, updateErr.message);
          }
        }
        console.log(`  🗑️  ${stale.length} bandi non più attivi → stato "closed"`);
      } else {
        console.log("  ✅ Nessun bando scaduto da chiudere");
      }
    }

    // 7. Riepilogo
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n" + "═".repeat(70));
    console.log("  ✅ SINCRONIZZAZIONE COMPLETATA");
    console.log("═".repeat(70));
    console.log(`  📥 Scaricati da ANAC:    ${totalFetched}`);
    console.log(`  💾 Aggiornati Supabase:  ${totalUpserted}`);
    console.log(`  ⏱️  Tempo totale:         ${elapsed}s`);
    console.log("═".repeat(70));
  } catch (err) {
    console.error("\n❌ Errore fatale:", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
