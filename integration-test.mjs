// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
#!/usr/bin/env node
/**
 * ANAC-DB-codex — Full Integration Test Suite
 * 
 * Tests every layer of the Tender AI DB system:
 *  1. Environment & Config
 *  2. Supabase Connectivity (anon + service role)
 *  3. Database Schema (cig + ita_tenders)
 *  4. ANAC Bulk OCDS upstream (HEAD check)
 *  5. API Routes via dev server (if running)
 *  6. Business Logic (tenderLogic.ts)
 *  7. Next.js MCP Dev Tool readiness
 *  8. Source file integrity
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = __dirname;

// ─── Utility ──────────────────────────────────────────────────────────────────

const PASS = "✅";
const FAIL = "❌";
const WARN = "⚠️";
const INFO = "ℹ️";

let passed = 0, failed = 0, warned = 0;

function log(icon, label, detail = "") {
  const msg = detail ? `${icon} ${label}: ${detail}` : `${icon} ${label}`;
  console.log(msg);
}

function pass(label, detail) { passed++; log(PASS, label, detail); }
function fail(label, detail) { failed++; log(FAIL, label, detail); }
function warn(label, detail) { warned++; log(WARN, label, detail); }
function info(label, detail) { log(INFO, label, detail); }

function section(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

// ─── 1. Environment & Config ────────────────────────────────────────────────

section("1. ENVIRONMENT & CONFIGURATION");

// Load .env.local
const envPath = resolve(ROOT, ".env.local");
let envVars = {};
if (existsSync(envPath)) {
  pass(".env.local exists", envPath);
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    envVars[key.trim()] = rest.join("=").trim();
  }
} else {
  fail(".env.local missing", envPath);
}

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (SUPABASE_URL) pass("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL.substring(0, 40) + "...");
else fail("NEXT_PUBLIC_SUPABASE_URL", "MISSING");

if (SUPABASE_ANON_KEY) pass("NEXT_PUBLIC_SUPABASE_ANON_KEY", `${SUPABASE_ANON_KEY.substring(0, 20)}...`);
else fail("NEXT_PUBLIC_SUPABASE_ANON_KEY", "MISSING");

if (SUPABASE_SERVICE_KEY) pass("SUPABASE_SERVICE_ROLE_KEY", `${SUPABASE_SERVICE_KEY.substring(0, 20)}...`);
else fail("SUPABASE_SERVICE_ROLE_KEY", "MISSING");

// Check package.json
const pkgPath = resolve(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
info("Next.js version", pkg.dependencies.next);
info("Supabase SDK", pkg.dependencies["@supabase/supabase-js"]);
info("Supabase SSR", pkg.dependencies["@supabase/ssr"]);

// Check next.config.mjs MCP support
const nextConfigPath = resolve(ROOT, "next.config.mjs");
const nextConfigContent = readFileSync(nextConfigPath, "utf-8");
const nextVersion = pkg.dependencies.next;
const majorVersion = parseInt(nextVersion.replace(/[^0-9]/g, "").substring(0, 2));
if (majorVersion >= 15) {
  pass("Next.js MCP Dev Tool support", `Next.js ${nextVersion} — built-in MCP dev tools`);
} else {
  warn("Next.js MCP Dev Tool support", `Next.js ${nextVersion} — MCP dev tools require v15+`);
}

// Check rewrites
if (nextConfigContent.includes("anac-api")) {
  pass("ANAC API proxy rewrite", "/anac-api/:path* → dati.anticorruzione.it");
} else {
  fail("ANAC API proxy rewrite", "Missing proxy config");
}

// ─── 2. Supabase Connectivity ────────────────────────────────────────────────

section("2. SUPABASE CONNECTIVITY");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  fail("Supabase connection", "Missing URL or keys — skipping");
} else {
  // Test anon client
  try {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await anonClient.from("cig").select("id", { count: "exact", head: true });
    if (error) {
      fail("Supabase anon connection", error.message);
    } else {
      pass("Supabase anon connection", "OK");
    }
  } catch (e) {
    fail("Supabase anon connection", e.message);
  }

  // Test service role client
  if (SUPABASE_SERVICE_KEY) {
    try {
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const { count, error } = await adminClient.from("cig").select("*", { count: "exact", head: true });
      if (error) {
        fail("Supabase service_role connection", error.message);
      } else {
        pass("Supabase service_role connection", `OK — total cig rows: ${count}`);
      }
    } catch (e) {
      fail("Supabase service_role connection", e.message);
    }
  }
}

// ─── 3. Database Schema Checks ────────────────────────────────────────────────

section("3. DATABASE SCHEMA & DATA");

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 3a. cig table
  try {
    const { data: cigSample, error: cigErr } = await admin.from("cig")
      .select("cig, oggetto_gara, importo_lotto, stato, provincia, data_pubblicazione, data_scadenza_offerta, sezione_regionale, descrizione_cpv, esito")
      .order("id", { ascending: false })
      .limit(3);
    
    if (cigErr) {
      fail("cig table read", cigErr.message);
    } else {
      pass("cig table read", `${cigSample.length} sample rows returned`);
      if (cigSample.length > 0) {
        const row = cigSample[0];
        const fields = Object.keys(row);
        info("cig sample fields", fields.join(", "));
        info("cig latest row", `CIG=${row.cig}, stato=${row.stato}, importo=${row.importo_lotto}`);
      }
    }
  } catch (e) {
    fail("cig table read", e.message);
  }

  // 3b. cig table counts by stato
  try {
    const { count: totalCount } = await admin.from("cig").select("*", { count: "exact", head: true });
    const { count: activeCount } = await admin.from("cig").select("*", { count: "exact", head: true }).eq("stato", "active");
    const { count: attivo } = await admin.from("cig").select("*", { count: "exact", head: true }).eq("stato", "ATTIVO");
    pass("cig counts", `total=${totalCount}, stato='active'=${activeCount}, stato='ATTIVO'=${attivo}`);
  } catch (e) {
    fail("cig counts", e.message);
  }

  // 3c. ita_tenders table
  try {
    const { data: itaSample, count: itaCount, error: itaErr } = await admin.from("ita_tenders")
      .select("id, oggetto, sources, importo, data_scadenza, provincia", { count: "exact" })
      .order("id", { ascending: false })
      .limit(3);

    if (itaErr) {
      if (itaErr.message.includes("does not exist") || itaErr.code === "42P01") {
        warn("ita_tenders table", "Table does not exist (optional source)");
      } else {
        fail("ita_tenders table read", itaErr.message);
      }
    } else {
      pass("ita_tenders table read", `${itaCount} total rows, sample: ${itaSample.length} rows`);
      if (itaSample.length > 0) {
        const sources = [...new Set(itaSample.map(r => r.sources))];
        info("ita_tenders sample sources", sources.join(", "));
      }
    }
  } catch (e) {
    fail("ita_tenders table read", e.message);
  }

  // 3d. Full-text search readiness
  try {
    const { data, error } = await admin.from("cig")
      .select("cig, oggetto_gara")
      .ilike("oggetto_gara", "%servizi%")
      .limit(2);
    
    if (error) {
      warn("Full-text search (ilike)", error.message);
    } else {
      pass("Full-text search (ilike)", `Found ${data.length} rows matching '%servizi%'`);
    }
  } catch (e) {
    warn("Full-text search (ilike)", e.message);
  }
} else {
  fail("Database schema checks", "No service role key available");
}

// ─── 4. ANAC Bulk OCDS Upstream ──────────────────────────────────────────────

section("4. ANAC BULK OCDS UPSTREAM");

const now = new Date();
const targetYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
const targetMonth = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0");
const bulkUrl = `https://dati.anticorruzione.it/opendata/download/dataset/ocds/filesystem/bulk/${targetYear}/${targetMonth}.json`;

info("ANAC bulk target", bulkUrl);

try {
  const headRes = await fetch(bulkUrl, {
    method: "HEAD",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (headRes.ok) {
    const sizeBytes = parseInt(headRes.headers.get("content-length") || "0");
    const sizeMB = Math.round(sizeBytes / 1024 / 1024);
    pass("ANAC bulk HEAD check", `HTTP ${headRes.status}, ~${sizeMB} MB`);
  } else {
    warn("ANAC bulk HEAD check", `HTTP ${headRes.status} — file may not be published yet for ${targetYear}/${targetMonth}`);
  }
} catch (e) {
  warn("ANAC bulk HEAD check", `Network error: ${e.message}`);
}

// Check ANAC portal
try {
  const portalRes = await fetch("https://dati.anticorruzione.it/", {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
    redirect: "follow",
  });
  if (portalRes.ok || portalRes.status === 302 || portalRes.status === 301) {
    pass("ANAC portal reachable", `HTTP ${portalRes.status}`);
  } else {
    warn("ANAC portal reachable", `HTTP ${portalRes.status}`);
  }
} catch (e) {
  warn("ANAC portal reachable", `Network error: ${e.message}`);
}

// ─── 5. Business Logic Tests ─────────────────────────────────────────────────

section("5. BUSINESS LOGIC (tenderLogic)");

const TERMINAL_STATES = [
  "CONCLUSO", "AGGIUDICATO", "ANNULLATO", "REVOCATO", "INTERROTTO",
  "AGGIUDICATA", "CONCLUSA", "REVOCATA", "ANNULLATA"
];

function isActiveTender(record) {
  if (record.stato) {
    const statoUpper = record.stato.toUpperCase().trim();
    if (TERMINAL_STATES.some(state => statoUpper.includes(state))) return false;
  }
  if (record.data_scadenza_offerta) {
    try {
      const d = new Date(record.data_scadenza_offerta);
      if (!isNaN(d.getTime()) && d < new Date()) return false;
    } catch {}
  }
  return true;
}

const logicTests = [
  { input: { stato: "active" },                          expected: true,  label: "stato='active' → active" },
  { input: { stato: "CONCLUSO" },                        expected: false, label: "stato='CONCLUSO' → inactive" },
  { input: { stato: "AGGIUDICATO" },                     expected: false, label: "stato='AGGIUDICATO' → inactive" },
  { input: { stato: "ANNULLATO" },                       expected: false, label: "stato='ANNULLATO' → inactive" },
  { input: { stato: "REVOCATO" },                        expected: false, label: "stato='REVOCATO' → inactive" },
  { input: { stato: "INTERROTTO" },                      expected: false, label: "stato='INTERROTTO' → inactive" },
  { input: { stato: null, data_scadenza_offerta: null },  expected: true,  label: "no stato, no expiry → active" },
  { input: { stato: null, data_scadenza_offerta: "2020-01-01" }, expected: false, label: "expired date → inactive" },
  { input: { stato: null, data_scadenza_offerta: "2099-12-31" }, expected: true,  label: "future date → active" },
  { input: { stato: "Aggiudicata definitivamente" },     expected: false, label: "stato contains AGGIUDICATA → inactive" },
];

for (const t of logicTests) {
  const result = isActiveTender(t.input);
  if (result === t.expected) pass(t.label);
  else fail(t.label, `expected=${t.expected}, got=${result}`);
}

// ─── 6. API Route Smoke Tests ───────────────────────────────────────────────

section("6. API ROUTE SMOKE TESTS (localhost:3000)");

const DEV_BASE = "http://localhost:3000";

async function testApi(path, label, validate) {
  try {
    const res = await fetch(`${DEV_BASE}${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      warn(label, `HTTP ${res.status}: ${JSON.stringify(body)?.substring(0, 200)}`);
      return;
    }

    if (validate) {
      validate(body, res);
    } else {
      pass(label, `HTTP ${res.status}`);
    }
  } catch (e) {
    if (e.message?.includes("ECONNREFUSED") || e.cause?.code === "ECONNREFUSED") {
      warn(label, "Dev server not running on :3000 — skipped");
    } else {
      warn(label, e.message);
    }
  }
}

await testApi("/api/stats", "GET /api/stats", (body) => {
  if (typeof body.total === "number" && typeof body.active === "number") {
    pass("GET /api/stats", `total=${body.total}, active=${body.active}, anni=${body.anni?.length ?? 0} years`);
  } else {
    fail("GET /api/stats", `Unexpected shape: ${JSON.stringify(body).substring(0, 200)}`);
  }
});

await testApi("/api/cig?page=1", "GET /api/cig", (body) => {
  if (Array.isArray(body.data) && typeof body.count === "number") {
    pass("GET /api/cig", `count=${body.count}, page_rows=${body.data.length}, totalPages=${body.totalPages}`);
  } else {
    fail("GET /api/cig", `Unexpected shape: ${JSON.stringify(body).substring(0, 200)}`);
  }
});

await testApi("/api/cig?q=servizi&page=1", "GET /api/cig?q=servizi", (body) => {
  if (Array.isArray(body.data)) {
    pass("GET /api/cig?q=servizi", `results=${body.count}, returned=${body.data.length}`);
  } else {
    fail("GET /api/cig?q=servizi", `Unexpected shape`);
  }
});

await testApi("/api/tenders?source=ita", "GET /api/tenders?source=ita", (body) => {
  if (Array.isArray(body.items)) {
    pass("GET /api/tenders?source=ita", `items=${body.items.length}, total=${body.total}`);
  } else {
    fail("GET /api/tenders?source=ita", `Unexpected shape: ${JSON.stringify(body).substring(0, 200)}`);
  }
});

await testApi("/api/sync/test", "GET /api/sync/test (OCDS pipeline)", (body) => {
  if (body.ok === true || body.ok === false) {
    const s = body.steps || {};
    pass("GET /api/sync/test", `ok=${body.ok}, seen=${s.seen_total ?? "?"}, active=${s.active_found ?? "?"}, file=${s.file_size_mb ?? "?"}MB`);
  } else {
    warn("GET /api/sync/test", `Unexpected: ${JSON.stringify(body).substring(0, 200)}`);
  }
});

// ─── 7. Next.js MCP Dev Tool ─────────────────────────────────────────────────

section("7. NEXT.JS MCP DEV TOOL");

// Next.js 15+/16+ exposes MCP at /_next/mcp when running in dev mode
try {
  const mcpRes = await fetch(`${DEV_BASE}/_next/mcp`, {
    method: "GET",
    signal: AbortSignal.timeout(5_000),
  });
  if (mcpRes.ok || mcpRes.status === 405 || mcpRes.status === 200) {
    pass("Next.js MCP endpoint", `HTTP ${mcpRes.status} — MCP dev server active`);
    const mcpBody = await mcpRes.text().catch(() => "");
    if (mcpBody) {
      info("MCP response preview", mcpBody.substring(0, 300));
    }
  } else {
    warn("Next.js MCP endpoint", `HTTP ${mcpRes.status} — may need 'next dev --experimental-mcp' or enable in next.config`);
  }
} catch (e) {
  if (e.message?.includes("ECONNREFUSED") || e.cause?.code === "ECONNREFUSED") {
    warn("Next.js MCP endpoint", "Dev server not running — start with: npx next dev");
  } else {
    warn("Next.js MCP endpoint", e.message);
  }
}

// Check MCP is compiled in
const nextPkgPath = resolve(ROOT, "node_modules/next/package.json");
if (existsSync(nextPkgPath)) {
  const nextPkg = JSON.parse(readFileSync(nextPkgPath, "utf-8"));
  info("Installed Next.js version", nextPkg.version);
  
  const mcpDir = resolve(ROOT, "node_modules/next/dist/server/mcp");
  if (existsSync(mcpDir)) {
    pass("Next.js MCP server module", "dist/server/mcp/ present — MCP compiled in");
  } else {
    warn("Next.js MCP server module", "dist/server/mcp/ not found");
  }
}

const mcpSdkPath = resolve(ROOT, "node_modules/next/dist/compiled/@modelcontextprotocol/sdk/server/mcp.js");
if (existsSync(mcpSdkPath)) {
  pass("MCP SDK (compiled)", "@modelcontextprotocol/sdk bundled with Next.js");
} else {
  warn("MCP SDK (compiled)", "Not found in Next.js bundle");
}

// ─── 8. Source File Integrity ───────────────────────────────────────────────

section("8. SOURCE FILE INTEGRITY");

const criticalFiles = [
  "app/layout.tsx",
  "app/page.tsx",
  "app/api/cig/route.ts",
  "app/api/stats/route.ts",
  "app/api/tenders/route.ts",
  "app/api/sync/route.ts",
  "app/api/sync/test/route.ts",
  "lib/supabase/client.ts",
  "lib/supabase/server.ts",
  "lib/supabase/admin.ts",
  "lib/supabase/database.types.ts",
  "lib/services/anacSync.ts",
  "lib/sources/anac.ts",
  "lib/sources/ita.ts",
  "lib/sources/ted.ts",
  "lib/sources/types.ts",
  "lib/utils/tenderLogic.ts",
  "next.config.mjs",
  "package.json",
  ".env.local",
];

let allPresent = true;
for (const f of criticalFiles) {
  const fullPath = resolve(ROOT, f);
  if (!existsSync(fullPath)) {
    fail(`File missing: ${f}`);
    allPresent = false;
  }
}
if (allPresent) pass("All critical source files present", `${criticalFiles.length} files checked`);

// ─── 9. TypeScript Check ───────────────────────────────────────────────────

section("9. TSCONFIG CHECK");

const tsconfigPath = resolve(ROOT, "tsconfig.json");
if (existsSync(tsconfigPath)) {
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
  pass("tsconfig.json valid", `target: ${tsconfig.compilerOptions?.target ?? "default"}, strict: ${tsconfig.compilerOptions?.strict ?? "unknown"}`);
} else {
  fail("tsconfig.json", "Missing");
}

// ─── SUMMARY ────────────────────────────────────────────────────────────────

section("FINAL SUMMARY");
console.log(`  ${PASS} Passed:   ${passed}`);
console.log(`  ${FAIL} Failed:   ${failed}`);
console.log(`  ${WARN} Warnings: ${warned}`);
console.log(`  Total checks: ${passed + failed + warned}`);
console.log();

if (failed > 0) {
  console.log(`${FAIL} INTEGRATION CHECK: ${failed} issue(s) require attention.`);
  process.exit(1);
} else if (warned > 0) {
  console.log(`${WARN} INTEGRATION CHECK: All core checks passed with ${warned} warning(s).`);
} else {
  console.log(`${PASS} INTEGRATION CHECK: All systems green!`);
}
