/**
 * fix-stato-active.mjs
 *
 * Ripristina tutti i bandi in Supabase a stato "active".
 * Da usare quando un sync fallito ha marcato tutto come "closed".
 *
 * USO:  node scripts/fix-stato-active.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, "..", ".env.local");
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
  } catch { /* .env.local non trovato */ }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // 1. Conta i bandi "closed"
  const { count: closedCount, error: countErr } = await supabase
    .from("cig")
    .select("id", { count: "exact", head: true })
    .eq("stato", "closed");

  if (countErr) {
    console.error("❌ Errore conteggio:", countErr.message);
    process.exit(1);
  }

  console.log(`📊 Bandi con stato "closed": ${closedCount}`);

  if (closedCount === 0) {
    console.log("✅ Nessun bando da correggere.");
    return;
  }

  // 2. Aggiorna in batch (Supabase limita a 1000 righe per update con filtro)
  let updated = 0;
  const BATCH = 1000;

  while (updated < closedCount) {
    const { data, error } = await supabase
      .from("cig")
      .update({ stato: "active" })
      .eq("stato", "closed")
      .select("id")
      .limit(BATCH);

    if (error) {
      console.error(`❌ Errore aggiornamento:`, error.message);
      break;
    }

    const batchSize = data?.length ?? 0;
    if (batchSize === 0) break;
    updated += batchSize;
    process.stdout.write(`\r  💾 ${updated}/${closedCount} bandi aggiornati a "active"...`);
  }

  console.log(`\r  💾 ${updated}/${closedCount} bandi aggiornati a "active" ✓    `);
  console.log("\n✅ Fix completato! I bandi dovrebbero ora apparire sul sito.");
}

main().catch(err => {
  console.error("❌ Errore fatale:", err.message);
  process.exit(1);
});
