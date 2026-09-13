// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * Estrae aggiudicatari dalla API ANAC e li carica in Turso.
 * 
 * Fase 1: Usa CDP per ottenere i cookie dal browser Chrome aperto su ANAC
 * Fase 2: Scarica batch da 10K dalla API Superset con quei cookie
 * Fase 3: Inserisce direttamente in Turso (nessun Vercel)
 *
 * Uso: node scripts/extract-and-load.cjs
 * Prerequisito: Chrome aperto su dati.anticorruzione.it
 */

const http = require('http');
const https = require('https');
const { createClient } = require('@libsql/client');

const TURSO_URL = 'libsql://anac-storico-giacomomarani.aws-eu-west-1.turso.io';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg4Nzk5NjMsImlkIjoiMDFhMDgxODgtYzUwMS03ODA3LWEwOTYtZjU2NjJmNWEwNjU0Iiwia2lkIjoidnJWV2tBSXAyV1hlNDBVSVVXNWpoVEFHV05DeWlpdUpkOGp0dDUwSGo0byIsInJpZCI6ImMwMWRmMjlkLWJiNjgtNDRiMS1hZTk2LTkyMjA3NTUxMTY4YiJ9.rmIByA-OQhnDAP2zCLFjrLULPw5Gt9CbhV3hAbq5UBE-1HB2KoFx0PX-vTIvyD2r9Wkny8AuVfJX9gkUI7C2DQ';
const BATCH_SIZE = 10000;
const CDP_PORT = 9222; // Chrome DevTools port

const COLUMNS = [
  'cig', 'cod_cpv', 'oggetto_bando', 'importo_aggiudicazione',
  'data_aggiudicazione_definitiva', 'denominazione_partecipante',
  'cod_fisc_partecipante', 'provincia',
  'denominazione_amministrazione_appaltante', 'oggetto_principale_contratto',
  'sezione_regionale', 'settore', 'importo_lotto',
  'partecipante_ruolo', 'flag_pnrr_pnc'
];

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// ── HTTP helpers ──────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const postData = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    };
    const req = mod.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Get cookies from Chrome via CDP ──────────────────
async function getChromeSession() {
  // Get list of debuggable pages
  const pages = await httpGet(`http://localhost:${CDP_PORT}/json`);
  const anacPage = pages.find(p => p.url && p.url.includes('anticorruzione'));
  if (!anacPage) throw new Error('No ANAC page found in Chrome. Open dati.anticorruzione.it first.');

  // Connect via WebSocket to get cookies
  const WebSocket = require('ws');
  const ws = new WebSocket(anacPage.webSocketDebuggerUrl);
  
  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Network.getCookies',
        params: { urls: ['https://dati.anticorruzione.it'] }
      }));
    });
    ws.on('message', (msg) => {
      const resp = JSON.parse(msg);
      if (resp.id === 1) {
        const cookies = resp.result.cookies;
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        // Get CSRF by evaluating in page
        ws.send(JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            expression: `fetch('/api/v1/security/csrf_token/',{credentials:'include'}).then(r=>r.json()).then(d=>d.result)`,
            awaitPromise: true,
            returnByValue: true
          }
        }));
      }
      if (resp.id === 2) {
        const csrfToken = resp.result?.result?.value;
        // Get cookies again (may have been refreshed by CSRF call)
        ws.send(JSON.stringify({
          id: 3,
          method: 'Network.getCookies',
          params: { urls: ['https://dati.anticorruzione.it'] }
        }));
      }
      if (resp.id === 3) {
        const cookies = resp.result.cookies;
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        ws.close();
        // Get csrf from earlier response
        resolve({ cookieStr, ws: null });
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('CDP timeout')), 10000);
  });
}

// ── Fetch batch from ANAC API ────────────────────────
async function fetchBatch(offset, cookieStr, csrfToken) {
  const payload = {
    datasource: { id: 85, type: 'table' },
    force: false,
    queries: [{
      time_range: 'No filter',
      filters: [],
      extras: { having: '', where: '' },
      columns: COLUMNS,
      metrics: [],
      row_limit: BATCH_SIZE,
      row_offset: offset
    }],
    form_data: { datasource: '85__table', viz_type: 'table', result_format: 'json', result_type: 'full' },
    result_format: 'json',
    result_type: 'full'
  };

  const res = await httpPost(
    'https://dati.anticorruzione.it/api/v1/chart/data?form_data=%7B%7D',
    payload,
    { 'Cookie': cookieStr, 'X-CSRFToken': csrfToken, 'Referer': 'https://dati.anticorruzione.it/' }
  );
  
  if (res.status !== 200) {
    return { records: [], status: res.status, error: typeof res.data === 'string' ? res.data.substring(0, 200) : JSON.stringify(res.data).substring(0, 200) };
  }
  
  const records = res.data?.result?.[0]?.data || [];
  return { records, status: 200 };
}

// ── Insert into Turso ────────────────────────────────
async function insertBatch(records) {
  const valid = records.filter(r => r.cig && r.cod_fisc_partecipante);
  if (valid.length === 0) return 0;

  const CHUNK = 50;
  const COLS = 15;
  let inserted = 0;

  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => `(${Array(COLS).fill('?').join(',')})`).join(',');
    const args = chunk.flatMap(r => {
      let dataAgg = null;
      if (r.data_aggiudicazione_definitiva) {
        dataAgg = typeof r.data_aggiudicazione_definitiva === 'number'
          ? new Date(r.data_aggiudicazione_definitiva).toISOString().split('T')[0]
          : String(r.data_aggiudicazione_definitiva);
      }
      return [
        r.cig, r.cod_fisc_partecipante,
        r.denominazione_partecipante || null, r.cod_cpv || null,
        r.oggetto_bando || null, r.importo_aggiudicazione ?? null,
        dataAgg, r.provincia || null,
        r.denominazione_amministrazione_appaltante || null,
        r.oggetto_principale_contratto || null,
        r.sezione_regionale || null, r.settore || null,
        r.importo_lotto ?? null, r.partecipante_ruolo || null,
        r.flag_pnrr_pnc || null,
      ];
    });

    await client.execute({
      sql: `INSERT OR REPLACE INTO aggiudicatari_storico
            (cig, cod_fisc, denominazione, cod_cpv, oggetto_bando,
             importo_aggiudicazione, data_aggiudicazione, provincia,
             stazione_appaltante, tipo_contratto, sezione_regionale,
             settore, importo_lotto, ruolo, flag_pnrr)
            VALUES ${placeholders}`,
      args,
    });
    inserted += chunk.length;
  }
  return inserted;
}

// ── Main ─────────────────────────────────────────────
async function main() {
  console.log('🔗 Connessione a Chrome via CDP...');
  
  // Instead of CDP, use a simpler approach:
  // 1. Get cookies and CSRF from browser via DevTools evaluate
  // 2. Use them for direct HTTPS requests
  
  // For simplicity, get session from environment or prompt
  const cookieStr = process.env.ANAC_COOKIES;
  const csrfToken = process.env.ANAC_CSRF;
  
  if (!cookieStr || !csrfToken) {
    console.log('\n⚠️  Devi fornire i cookie e CSRF token del browser ANAC.');
    console.log('   Apri la console del browser su dati.anticorruzione.it e esegui:\n');
    console.log('   // 1. Ottieni CSRF token:');
    console.log('   const csrf = await fetch("/api/v1/security/csrf_token/",{credentials:"include"}).then(r=>r.json());');
    console.log('   console.log("CSRF:", csrf.result);\n');
    console.log('   // 2. Ottieni cookies:');
    console.log('   console.log("COOKIES:", document.cookie);\n');
    console.log('   Poi lancia:');
    console.log('   set ANAC_COOKIES="session=xxx; ..."');
    console.log('   set ANAC_CSRF="xxx"');
    console.log('   node scripts/extract-and-load.cjs\n');
    
    // Try CDP approach
    try {
      console.log('🔄 Provo via CDP (Chrome deve avere --remote-debugging-port=9222)...\n');
      await getChromeSession();
    } catch(e) {
      console.log('❌ CDP non disponibile:', e.message);
      console.log('\n   Avvia Chrome con: chrome.exe --remote-debugging-port=9222');
    }
    return;
  }

  console.log('📡 Inizio estrazione da ANAC...');
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Turso: ${TURSO_URL}\n`);

  let offset = 0;
  let totalInserted = 0;
  let batchNum = 0;
  const startTime = Date.now();

  while (true) {
    batchNum++;
    console.log(`📦 Batch ${batchNum} — offset ${offset}...`);
    
    const { records, status, error } = await fetchBatch(offset, cookieStr, csrfToken);
    
    if (status !== 200) {
      console.error(`❌ ANAC errore ${status}: ${error}`);
      if (status === 400 || status === 403) {
        console.log('   Token scaduto? Rigenera CSRF e rilancia.');
      }
      break;
    }

    if (records.length === 0) {
      console.log('✅ Nessun altro record, estrazione completata!');
      break;
    }

    const inserted = await insertBatch(records);
    totalInserted += inserted;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (totalInserted / (elapsed || 1)).toFixed(0);
    const eta = records.length === BATCH_SIZE 
      ? `ETA: ${((10872557 - offset) / (rate || 1) / 60).toFixed(0)} min`
      : 'ultimo batch';
    
    console.log(`   ✅ ${inserted}/${records.length} inseriti → totale: ${totalInserted} (${elapsed}s, ${rate} rec/s, ${eta})`);
    
    if (records.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
    
    // Small delay
    await new Promise(r => setTimeout(r, 500));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 Completato! ${totalInserted} record inseriti in ${elapsed}s`);
}

main().catch(console.error);
