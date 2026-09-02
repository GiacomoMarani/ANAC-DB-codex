/**
 * Quick script to create cato_tenders table in Supabase.
 * Run: node scripts/create-cato-table.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
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
} catch { /* ignore */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const supabase = createClient(url, key, {
  db: { schema: "public" },
});

// We'll create the table step by step using individual SQL statements via the REST SQL endpoint
// Since Supabase cloud doesn't expose a raw SQL endpoint to service_role keys,
// we'll use a workaround: create an RPC function first, then use it

async function main() {
  console.log("Testing Supabase connection...");

  // Test connection
  const { data: test, error: testErr } = await supabase.from("cig").select("id").limit(1);
  if (testErr) {
    console.error("Connection error:", testErr.message);
  } else {
    console.log("✅ Connection OK. cig table has data:", test.length > 0);
  }

  // Check if cato_tenders already exists
  const { data: existing, error: existErr } = await supabase.from("cato_tenders").select("id").limit(1);
  if (!existErr) {
    console.log("✅ cato_tenders table already exists!");
    return;
  }

  console.log("ℹ️  cato_tenders table does not exist yet.");
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Per creare la tabella, esegui lo SQL seguente nel");
  console.log("  Supabase Dashboard → SQL Editor:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("  File: scripts/create-cato-table.sql");
  console.log("");
  console.log("  Oppure apri:");
  console.log(`  ${url.replace('.supabase.co', '.supabase.co')}/project/gfbbqvtjnmigatrplnhc/sql/new`);
  console.log("");
}

main().catch(console.error);
