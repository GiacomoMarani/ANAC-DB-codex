---
name: anac-db-qa-tester
description: >-
  Systematic QA testing skill for the ANAC-DB-codex (Tender AI DB)
  web application. Tests all pages, API endpoints, Supabase data integrity,
  data source connectivity, and cron/action status. Use when asked to test,
  verify, audit, or check the deployed site at tender-ai-db.vercel.app,
  or when debugging issues with the application's data pipeline.
---

# ANAC-DB-codex QA Testing Skill

## Overview
Structured end-to-end testing workflow for the ANAC-DB-codex public procurement
intelligence platform. Covers UI pages, API endpoints, multi-source data
integrity, Supabase tables, and background sync/cron actions.

## Dependencies
- **browser-tester** subagent (or Playwright MCP): for visual page testing
- **Supabase MCP** (optional): for direct database verification
- **Vercel MCP** (optional): for deployment status checks

## Quick Start

Trigger phrase: "Testa il sito", "Verifica il deploy", "QA check", "audit del sito"

```
Test the ANAC-DB-codex site at https://tender-ai-db.vercel.app/
Follow the QA Testing Workflow below.
```

## Workflow

### Phase 1: API Health Check (5 min)
Verify all API endpoints respond correctly. Use `curl` or HTTP client tools.

#### 1.1 GET endpoints (expect 200)
Test each endpoint and record status code:

| Endpoint | Expected | Notes |
|----------|----------|-------|
| `/api/stats` | 200 | Returns `{total, active, anni, cpv}` |
| `/api/cig` | 200 | Returns paginated CIG data |
| `/api/cig?q=cybersecurity` | 200 | Keyword search |
| `/api/cig?q=BCDA141184` | 200 | CIG exact lookup |
| `/api/tenders` | 200 | Multi-source aggregated tenders |
| `/api/tenders?source=ted` | 200 | TED-only results |
| `/api/tenders?source=ita` | 200 | ITA regional results |
| `/api/tenders/widget?cpv=72` | 200 | get-cato.com widget proxy |
| `/api/anac-data` | 200 | Returns `{buckets:[]}` if no cache |

#### 1.2 POST endpoints (expect 405 on GET, verify with POST)
```bash
# Profiling — test with a known valid P.IVA
curl -X POST https://tender-ai-db.vercel.app/api/profiling \
  -H "Content-Type: application/json" \
  -d '{"partita_iva": "02313821007"}'
# Expected: 200 with profile data (CONSIP S.P.A.)

# Profiling — test with invalid P.IVA
curl -X POST https://tender-ai-db.vercel.app/api/profiling \
  -H "Content-Type: application/json" \
  -d '{"partita_iva": "12345678901"}'
# Expected: 400 "Partita IVA non valida"

# Edge analyze — test with company URL
curl -X POST https://tender-ai-db.vercel.app/api/edge/analyze-site \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.accenture.com/it-it"}'
# Expected: 200 with {success, company, keywords, cpv_ids}
```

#### 1.3 Protected/Sync endpoints
| Endpoint | Expected | Notes |
|----------|----------|-------|
| `/api/sync` | 500 or 401 | 500 = ANAC WAF blocking; 401 = auth required |
| `/api/sync/preview` | 403 | Auth required (CRON_SECRET) |
| `/api/sync/test` | 403 | Auth required |
| `/api/cron/sync-anac-pvl` | 401 or timeout | Requires CRON_SECRET bearer token |
| `/api/anac-csrf` | 503 | ANAC WAF blocks CSRF extraction |
| `/api/anac-session` | 404 | No session stored (expected) |

#### 1.4 Verify API Response Quality
For `/api/stats`, check:
- [ ] `total` > 0 (current: ~9700)
- [ ] `active` > 0 and < total
- [ ] `anni` contains current year
- [ ] `cpv` is non-empty array

For `/api/tenders`, check:
- [ ] `items` is array with length > 0
- [ ] `total` > 0 (current: ~31000+)
- [ ] `sources` array shows counts for ted, ita, intl
- [ ] Each item has `id`, `oggetto`, `data_scadenza`

For `/api/cig`, check:
- [ ] `data` is array with length > 0
- [ ] `count` > 0
- [ ] `totalPages` > 0
- [ ] `pageImporto` is number >= 0

### Phase 2: Page-by-Page Browser Testing (15 min)
Use Playwright or browser subagent to test each page.

#### 2.1 Home Page (`/`)
- [ ] Navigate to `/` — should redirect to `/gare`
- [ ] Screenshot: verify layout renders

#### 2.2 Gare Page (`/gare`)
- [ ] Page loads with tender listing
- [ ] Stats cards show: Total CIGs, Active, Value
- [ ] Search bar works (type "cybersecurity", verify filtered results)
- [ ] Source filter tabs work (All, ANAC, TED, ITA, INTL, regional)
- [ ] Pagination: click next page, verify new results
- [ ] Tender card shows: title, CIG, amount, deadline, source badge
- [ ] Click tender → opens detail dialog or external link
- [ ] Console: 0 errors expected
- [ ] Network: all `/api/cig` and `/api/tenders` return 200
- [ ] **Known Issue**: Check for `[object Object]` in location fields

#### 2.3 Profilazione Page (`/profilazione`)
- [ ] P.IVA input field renders
- [ ] Button disabled until valid P.IVA entered
- [ ] Enter `00488410010` (TIM S.P.A.) → Analizza
- [ ] Profile loads: company name, total tenders, volume, CPV map
- [ ] CPV Strategy Map shows divisions with percentages
- [ ] Matching tenders section loads automatically
- [ ] Console: 0 errors
- [ ] Network: `/api/profiling` POST returns 200
- [ ] Network: `/api/profiling/match` POST returns 200
- [ ] Verify `tasso_successo` (success rate) displays correctly
- [ ] Verify `gare_partecipate` vs `gare_vinte` shown

#### 2.4 Ricerca Gare Page (`/ricerca-gare`)
- [ ] URL input form renders
- [ ] Enter company URL (e.g., `https://www.accenture.com/it-it`)
- [ ] Analysis starts with progress indicators
- [ ] Results show: company name, sector, keywords, CPV codes
- [ ] Matching tenders displayed (first 3 visible, rest locked)
- [ ] Console: 0 errors
- [ ] Network: `/api/edge/analyze-site` POST returns 200
- [ ] **Known Issue**: Lead capture form ("Ricevi il report") discards data

#### 2.5 Codici CPV Page (`/codici-cpv`)
- [ ] Page loads with CPV codes (9,454 total)
- [ ] Card view: search for "informatica" → filtered results
- [ ] Tree view: expand hierarchy levels
- [ ] Search for CPV code "72210000" → exact match
- [ ] Click code → detail modal with translations
- [ ] Division filter works
- [ ] Console: 0 errors

#### 2.6 Import Page (`/import`)
- [ ] Page loads with sync options (1, 3, 6, 12 months)
- [ ] File upload dropzone renders
- [ ] Click sync button → shows progress/error
- [ ] **Known Issue**: `/api/sync` returns 500 (ANAC WAF)
- [ ] **Known Issue**: Large files crash browser (OOM)
- [ ] Console: check for errors after sync attempt

### Phase 3: Data Source Verification (5 min)
Verify each data source returns data:

| Source | Test Method | Expected |
|--------|-------------|----------|
| Supabase `cig` | `GET /api/cig` | data.length > 0 |
| Supabase `ita_tenders` | `GET /api/tenders?source=ita` | items with source "ita" |
| Supabase `intl_tenders` | `GET /api/tenders?source=intl` | items with source "intl" |
| TED Europa | `GET /api/tenders?source=ted` | items with source "ted" |
| ANAC PVL | `GET /api/cig?stato=active` | active tenders present |
| MIT SCP | `POST /api/profiling` with P.IVA | sources.scp_mit > 0 |
| EU VIES | `POST /api/profiling` with P.IVA | profile.ragione_sociale not null |
| get-cato.com | `GET /api/tenders/widget?cpv=72` | items.length > 0 |

### Phase 4: Cron/Action Status (2 min)
- [ ] Check Vercel deployment status (Vercel MCP or dashboard)
- [ ] Verify `vercel.json` cron schedule matches expected sync frequency
- [ ] Check if recent cron runs succeeded (Vercel logs)

### Phase 5: Supabase Data Integrity (5 min)
If Supabase MCP is available:
```sql
-- Total CIG records
SELECT COUNT(*) FROM cig;

-- Active vs closed
SELECT stato, COUNT(*) FROM cig GROUP BY stato;

-- Aggiudicatari count
SELECT COUNT(*) FROM aggiudicatari;

-- Partecipanti count
SELECT COUNT(*) FROM partecipanti;

-- ITA tenders count
SELECT COUNT(*) FROM ita_tenders;

-- Check for stale data (last sync)
SELECT MAX(data_pubblicazione) FROM cig;

-- Telemetry health
SELECT * FROM telemetry_pings ORDER BY received_at DESC LIMIT 5;
```

### Phase 6: Report Generation
After all phases, generate a QA report artifact with:
1. Executive summary (pass/fail counts)
2. Bug list with severity, description, root cause, fix suggestion
3. API status table
4. Data source health table
5. Page-by-page test results
6. Priority fix recommendations

## Known Issues & Patterns

### ANAC WAF Blocking
The ANAC website (`dati.anticorruzione.it`) uses F5 BIG-IP WAF with JA3/JA4
TLS fingerprinting. Server-to-server requests from Vercel's serverless IPs
are consistently blocked with HTTP 403. This affects:
- `/api/sync` (bulk OCDS download)
- `/api/anac-csrf` (CSRF token extraction)
- `/api/anac-proxy` (Superset chart queries)
- `/api/sync/scan`, `/api/sync/test`, `/api/sync/preview`

The application mitigates this by:
1. Using ANAC PVL REST API as primary sync source
2. Storing data locally in Supabase for fast queries
3. Offering Tampermonkey userscript relay as manual bypass

### Test P.IVA Numbers
Use these known Italian VAT numbers for testing profiling:
- `02313821007` — CONSIP S.P.A. (large public buyer)
- `00488410010` — TIM S.P.A. (large IT company)
- `97735020584` — INPS (social security)

### Supabase Tables Schema
| Table | Key Field | Records |
|-------|-----------|---------|
| `cig` | `cig` (unique) | ~9,700 |
| `ita_tenders` | `id` | ~67,000 |
| `intl_tenders` | `id` | varies |
| `aggiudicatari` | `codice_fiscale, cig` | varies |
| `partecipanti` | `codice_fiscale, cig` | varies |
| `telemetry_pings` | `id` | audit log |

## Rate Limiting
- **TED Europa API**: No documented rate limit, but use 1 req/sec as safe default
- **get-cato.com**: Risk of 429 if burst-querying 30 pages in parallel
- **ANAC PVL API**: 200ms delay between pages enforced in sync code
- **MIT SCP CKAN**: 15s timeout per request, sequential queries
- **EU VIES**: 1 req/sec recommended

## Common Mistakes
1. **Forgetting to test POST endpoints**: `/api/profiling`, `/api/import`,
   `/api/edge/analyze-site` only accept POST requests. GET returns 405.
2. **Expecting `/api/sync` to work**: ANAC WAF blocks this consistently from
   serverless environments. Use `/api/cron/sync-anac-pvl` instead.
3. **Not checking console errors**: Many React hydration warnings or API
   failures only appear in the browser console, not in the visible UI.
