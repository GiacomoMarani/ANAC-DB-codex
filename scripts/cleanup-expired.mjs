// cleanup-expired.mjs — Conta e cancella bandi scaduti dal DB
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, "..", ".env.local"), "utf-8");
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
loadEnv();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const today = new Date().toISOString();
const DRY = process.argv.includes("--dry-run");

async function main() {
  console.log("=== PULIZIA BANDI SCADUTI ===");
  console.log("Data odierna:", today.split("T")[0]);
  console.log("Dry run:", DRY);
  console.log("");

  // ── CIG ──
  const { count: cigTotal } = await sb.from("cig").select("*", { count: "exact", head: true });
  const { count: cigExpiredDate } = await sb.from("cig").select("*", { count: "exact", head: true })
    .lt("data_scadenza_offerta", today).not("data_scadenza_offerta", "is", null);
  const { count: cigTerminal } = await sb.from("cig").select("*", { count: "exact", head: true })
    .or("stato.ilike.%CONCLUS%,stato.ilike.%AGGIUDICA%,stato.ilike.%ANNULLA%,stato.ilike.%REVOCAT%,stato.ilike.%INTERROTT%");

  console.log("=== CIG ===");
  console.log("  Totale:            ", cigTotal);
  console.log("  Scaduti (data):    ", cigExpiredDate);
  console.log("  Stato terminale:   ", cigTerminal);
  const cigToDel = (cigExpiredDate || 0) + (cigTerminal || 0);
  console.log("  → Da eliminare:    ", `~${cigToDel} (possibili overlap)`);
  console.log("");

  // ── ITA_TENDERS ──
  const { count: itaTotal } = await sb.from("ita_tenders").select("*", { count: "exact", head: true });
  const { count: itaExpired } = await sb.from("ita_tenders").select("*", { count: "exact", head: true })
    .lt("data_scadenza", today).not("data_scadenza", "is", null);

  console.log("=== ITA_TENDERS ===");
  console.log("  Totale:            ", itaTotal);
  console.log("  Scaduti (data):    ", itaExpired);
  console.log("  → Da eliminare:    ", itaExpired);
  console.log("");

  if (DRY) {
    console.log("⏸  Dry run — nessuna modifica. Rimuovi --dry-run per eseguire la pulizia.");
    return;
  }

  // ── DELETE CIG scaduti per data ──
  console.log("🗑  Eliminazione CIG scaduti per data...");
  const { error: e1, count: d1 } = await sb.from("cig")
    .delete({ count: "exact" })
    .lt("data_scadenza_offerta", today)
    .not("data_scadenza_offerta", "is", null);
  if (e1) console.error("  ❌", e1.message);
  else console.log(`  ✅ Eliminati: ${d1}`);

  // ── DELETE CIG con stato terminale ──
  console.log("🗑  Eliminazione CIG con stato terminale...");
  const { error: e2, count: d2 } = await sb.from("cig")
    .delete({ count: "exact" })
    .or("stato.ilike.%CONCLUS%,stato.ilike.%AGGIUDICA%,stato.ilike.%ANNULLA%,stato.ilike.%REVOCAT%,stato.ilike.%INTERROTT%");
  if (e2) console.error("  ❌", e2.message);
  else console.log(`  ✅ Eliminati: ${d2}`);

  // ── DELETE ita_tenders scaduti ──
  console.log("🗑  Eliminazione ita_tenders scaduti...");
  const { error: e3, count: d3 } = await sb.from("ita_tenders")
    .delete({ count: "exact" })
    .lt("data_scadenza", today)
    .not("data_scadenza", "is", null);
  if (e3) console.error("  ❌", e3.message);
  else console.log(`  ✅ Eliminati: ${d3}`);

  // ── Riepilogo post-pulizia ──
  const { count: cigAfter } = await sb.from("cig").select("*", { count: "exact", head: true });
  const { count: itaAfter } = await sb.from("ita_tenders").select("*", { count: "exact", head: true });

  console.log("");
  console.log("=== RIEPILOGO ===");
  console.log(`  CIG:          ${cigTotal} → ${cigAfter}`);
  console.log(`  ita_tenders:  ${itaTotal} → ${itaAfter}`);
  console.log("✅ Pulizia completata.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
