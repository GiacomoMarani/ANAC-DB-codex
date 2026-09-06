// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * sync-rss-feeds.mjs
 * Script generico per sincronizzare bandi da feed RSS/Atom pubblici.
 * Ogni feed è configurato con source, country, e opzionale filtro di rilevanza.
 *
 * Usage:
 *   node scripts/sync-rss-feeds.mjs            # tutti i feed
 *   node scripts/sync-rss-feeds.mjs --dry-run  # no DB write
 *   node scripts/sync-rss-feeds.mjs --feed lazioeuropa.it  # solo un feed
 */

import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");
const FEED_FILTER = args.indexOf("--feed") >= 0 ? args[args.indexOf("--feed") + 1] : null;

// ── Feed configurati ──────────────────────────────────────────────────────────

const FEEDS = [
  {
    id:      "lazioeuropa.it",
    url:     "https://www.lazioeuropa.it/bandi/feed/",
    source:  "lazioeuropa.it",
    country: "IT",
    // Esclude item che NON contengono parole chiave di bandi (solo notizie)
    filter:  null, // tutti gli item sono bandi per questo feed
  },
  {
    id:      "fondazioneconilsud.it",
    url:     "https://www.fondazioneconilsud.it/category/bandi/feed/",
    source:  "fondazioneconilsud.it",
    country: "IT",
    filter:  null,
  },
  {
    id:      "regione.basilicata.it",
    url:     "https://www.regione.basilicata.it/feed/?post_type=avvisi-e-bandi",
    source:  "regione.basilicata.it",
    country: "IT",
    // Escludi concorsi di lavoro
    filter:  (title) => !/concorso\s+pubblico|assunzione|selezione\s+pubblica/i.test(title),
  },
];

// ── Supabase ──────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Parser RSS/Atom ───────────────────────────────────────────────────────────

function stripCdata(s) {
  return s?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? null;
}

function stripHtml(s) {
  return s?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? stripCdata(stripHtml(m[1])) : null;
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]+${attr}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

// Parsa una data RSS (RFC 822) → YYYY-MM-DD
function parseRssDate(str) {
  if (!str) return null;
  try {
    return new Date(str).toISOString().slice(0, 10);
  } catch { return null; }
}

// Cerca la data di scadenza nella descrizione HTML (pattern italiani)
function extractScadenza(description) {
  if (!description) return null;
  // Pattern: "scadenza: 15/10/2026", "entro il 31.12.2026", "fino al 01-10-2026"
  const patterns = [
    /scadenz[ae][:\s]+(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/i,
    /entro\s+(?:il\s+)?(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/i,
    /fino\s+al\s+(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/i,
    /(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/,
  ];
  for (const pat of patterns) {
    const m = description.match(pat);
    if (m) {
      const [d, mo, y] = m[1].replace(/\./g, "/").split("/");
      if (y && y.length === 4) {
        return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
    }
  }
  return null;
}

function parseItems(xmlText) {
  // Supporta sia <item> (RSS 2.0) che <entry> (Atom)
  const isAtom = xmlText.includes("<entry>");
  const tag = isAtom ? "entry" : "item";
  const items = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    const xml = m[1];
    const title = extractTag(xml, "title");
    const link =
      extractTag(xml, "link") ||
      extractAttr(xml, "link", "href") ||
      extractTag(xml, "guid");
    const description =
      extractTag(xml, "description") ||
      extractTag(xml, "content") ||
      extractTag(xml, "summary");
    const pubDate =
      extractTag(xml, "pubDate") ||
      extractTag(xml, "published") ||
      extractTag(xml, "updated") ||
      extractTag(xml, "dc:date");
    const guid = extractTag(xml, "guid") || link;
    items.push({ title, link, description, pubDate, guid });
  }
  return items;
}

// ── Mapping item → intl_tenders ───────────────────────────────────────────

function mapRssItem(item, feed) {
  const pubblicazione = parseRssDate(item.pubDate);
  const scadenza = extractScadenza(item.description);

  // ID deterministico dal guid
  const safeId = (item.guid || item.link || item.title || "")
    .replace(/[^a-zA-Z0-9_\-:.]/g, "-")
    .slice(0, 120);

  return {
    id:          `${feed.source}:${safeId}`,
    titolo:      item.title?.slice(0, 500) ?? null,
    ente:        null,
    descrizione: item.description?.slice(0, 2000) ?? null,
    scadenza,
    country:     feed.country,
    tender_type: "grant",
    importo_max: null,
    settori:     null,
    source:      feed.source,
    link:        item.link ?? null,
    intl_created_at: pubblicazione ? new Date(pubblicazione).toISOString() : null,
    synced_at:   new Date().toISOString(),
  };
}

// ── Sync singolo feed ─────────────────────────────────────────────────────────

async function syncFeed(feed) {
  console.log(`\n  📡 ${feed.id}`);

  let xmlText;
  try {
    const r = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (TenderAI/1.0)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.log(`    ❌ HTTP ${r.status} — skip`);
      return { fetched: 0, saved: 0, skipped: 0, errors: 1 };
    }
    xmlText = await r.text();
  } catch (e) {
    console.log(`    ❌ ${e.message} — skip`);
    return { fetched: 0, saved: 0, skipped: 0, errors: 1 };
  }

  const items = parseItems(xmlText);
  console.log(`    📥 ${items.length} item trovati`);

  const todayStr = new Date().toISOString().slice(0, 10);
  let saved = 0, skipped = 0;

  const records = [];
  for (const item of items) {
    if (!item.title?.trim() || item.title.trim().length < 5) { skipped++; continue; }
    // Applica filtro custom
    if (feed.filter && !feed.filter(item.title)) {
      console.log(`    ⏭️  Filtrato: ${item.title.slice(0, 60)}`);
      skipped++; continue;
    }
    const rec = mapRssItem(item, feed);
    // Escludi scaduti con data certa
    if (rec.scadenza && rec.scadenza < todayStr) { skipped++; continue; }
    records.push(rec);
  }

  if (!IS_DRY_RUN && records.length > 0) {
    const { error } = await supabase
      .from("intl_tenders")
      .upsert(records, { onConflict: "id", ignoreDuplicates: false });
    if (error) {
      console.log(`    ❌ Upsert error: ${error.message}`);
      return { fetched: items.length, saved: 0, skipped, errors: 1 };
    }
    saved = records.length;
  } else {
    saved = records.length;
  }

  console.log(`    ✅ ${saved} salvati, ${skipped} scartati`);
  return { fetched: items.length, saved, skipped, errors: 0 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString("it-IT");

  console.log("═".repeat(70));
  console.log("  Fonti RSS italiane → Supabase Sync");
  console.log(`  ${today}${IS_DRY_RUN ? " — DRY RUN" : ""}`);
  console.log("═".repeat(70));

  const activeFeedsFull = FEED_FILTER
    ? FEEDS.filter(f => f.id.includes(FEED_FILTER))
    : FEEDS;

  if (activeFeedsFull.length === 0) {
    console.error(`❌ Nessun feed corrisponde a: ${FEED_FILTER}`);
    process.exit(1);
  }

  let totalFetched = 0, totalSaved = 0, totalSkipped = 0, totalErrors = 0;

  for (const feed of activeFeedsFull) {
    const res = await syncFeed(feed);
    totalFetched += res.fetched;
    totalSaved   += res.saved;
    totalSkipped += res.skipped;
    totalErrors  += res.errors;
    // Pausa cortesia tra feed
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "═".repeat(70));
  console.log("  ✅ SYNC RSS COMPLETATO");
  console.log("═".repeat(70));
  console.log(`  📡 Feed processati:    ${activeFeedsFull.length}`);
  console.log(`  📥 Item scaricati:     ${totalFetched}`);
  if (totalSkipped > 0) console.log(`  ⏭️  Scartati:           ${totalSkipped}`);
  if (!IS_DRY_RUN) console.log(`  💾 Salvati su DB:      ${totalSaved}`);
  if (totalErrors > 0) console.log(`  ❌ Feed in errore:     ${totalErrors}`);
  console.log(`  ⏱️  Tempo:              ${elapsed}s`);
  console.log("═".repeat(70));
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
