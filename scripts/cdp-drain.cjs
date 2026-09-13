/**
 * Drena record dal browser ANAC via CDP e li inserisce in Turso.
 * Legge 500 record alla volta da window.__allRecords usando chrome-devtools-mcp.
 *
 * Uso: node scripts/cdp-drain.cjs
 */
const http = require('http');
const { createClient } = require('@libsql/client');

const TURSO_URL = 'libsql://anac-storico-giacomomarani.aws-eu-west-1.turso.io';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg4Nzk5NjMsImlkIjoiMDFhMDgxODgtYzUwMS03ODA3LWEwOTYtZjU2NjJmNWEwNjU0Iiwia2lkIjoidnJWV2tBSXAyV1hlNDBVSVVXNWpoVEFHV05DeWlpdUpkOGp0dDUwSGo0byIsInJpZCI6ImMwMWRmMjlkLWJiNjgtNDRiMS1hZTk2LTkyMjA3NTUxMTY4YiJ9.rmIByA-OQhnDAP2zCLFjrLULPw5Gt9CbhV3hAbq5UBE-1HB2KoFx0PX-vTIvyD2r9Wkny8AuVfJX9gkUI7C2DQ';
const CDP_PORT = 9222;
const DRAIN_CHUNK = 500;

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });
}

async function cdpEval(wsUrl, expr) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: false } }));
    });
    ws.on('message', msg => {
      const resp = JSON.parse(msg);
      if (resp.id === 1) { ws.close(); resolve(resp.result?.result?.value); }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);
  });
}

async function insertRecords(records) {
  const valid = records.filter(r => r.cig && r.cod_fisc_partecipante);
  if (valid.length === 0) return 0;
  const CHUNK = 50, COLS = 15;
  let inserted = 0;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const ph = chunk.map(() => `(${Array(COLS).fill('?').join(',')})`).join(',');
    const args = chunk.flatMap(r => {
      let d = null;
      if (r.data_aggiudicazione_definitiva) d = typeof r.data_aggiudicazione_definitiva === 'number' ? new Date(r.data_aggiudicazione_definitiva).toISOString().split('T')[0] : String(r.data_aggiudicazione_definitiva);
      return [r.cig,r.cod_fisc_partecipante,r.denominazione_partecipante||null,r.cod_cpv||null,r.oggetto_bando||null,r.importo_aggiudicazione??null,d,r.provincia||null,r.denominazione_amministrazione_appaltante||null,r.oggetto_principale_contratto||null,r.sezione_regionale||null,r.settore||null,r.importo_lotto??null,r.partecipante_ruolo||null,r.flag_pnrr_pnc||null];
    });
    await client.execute({ sql: `INSERT OR REPLACE INTO aggiudicatari_storico (cig,cod_fisc,denominazione,cod_cpv,oggetto_bando,importo_aggiudicazione,data_aggiudicazione,provincia,stazione_appaltante,tipo_contratto,sezione_regionale,settore,importo_lotto,ruolo,flag_pnrr) VALUES ${ph}`, args });
    inserted += chunk.length;
  }
  return inserted;
}

async function main() {
  // Find ANAC page via CDP
  console.log('🔗 Connessione Chrome CDP...');
  let pages;
  try { pages = await httpGet(`http://localhost:${CDP_PORT}/json`); } 
  catch(e) { console.error('❌ Chrome non raggiungibile. Serve --remote-debugging-port=9222'); return; }
  
  const anacPage = pages.find(p => p.url && p.url.includes('anticorruzione'));
  if (!anacPage) { console.error('❌ Nessuna pagina ANAC aperta'); return; }
  
  console.log('✅ Pagina ANAC trovata:', anacPage.url.substring(0, 60));
  const wsUrl = anacPage.webSocketDebuggerUrl;
  
  let totalInserted = 0;
  const startTime = Date.now();
  
  while (true) {
    // Check status
    const statusData = await cdpEval(wsUrl, `JSON.stringify({count: window.__allRecords ? window.__allRecords.length : 0, status: window.__extractStatus || 'unknown'})`);
    const status = JSON.parse(statusData);
    
    if (status.count === 0 && status.status === 'done') {
      console.log('✅ Tutti i record drenati e inseriti!');
      break;
    }
    
    if (status.count === 0) {
      console.log(`⏳ Buffer vuoto, estrazione: ${status.status}. Attendo...`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    
    // Drain a chunk
    const chunkData = await cdpEval(wsUrl, `JSON.stringify(window.__allRecords.splice(0, ${DRAIN_CHUNK}))`);
    const records = JSON.parse(chunkData);
    
    if (records.length > 0) {
      const inserted = await insertRecords(records);
      totalInserted += inserted;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (totalInserted / (elapsed || 1)).toFixed(0);
      console.log(`+${inserted} → ${totalInserted} (buffer: ${status.count - records.length}, ${elapsed}s, ${rate} rec/s)`);
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 Completato! ${totalInserted} record in ${elapsed}s`);
}

main().catch(console.error);
