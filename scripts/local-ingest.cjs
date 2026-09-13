// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * Scarica TUTTI gli aggiudicatari dal browser ANAC in batch da 10K,
 * salva ogni batch come JSON locale, poi li carica in Turso.
 *
 * Fase 1: Il browser scarica → salva in window.__anacBatches[]
 * Fase 2: Questo script legge i batch dal browser via CDP e li inserisce in Turso
 *
 * Uso: node scripts/local-ingest.cjs
 */

const { createClient } = require('@libsql/client');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TURSO_URL = 'libsql://anac-storico-giacomomarani.aws-eu-west-1.turso.io';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg4Nzk5NjMsImlkIjoiMDFhMDgxODgtYzUwMS03ODA3LWEwOTYtZjU2NjJmNWEwNjU0Iiwia2lkIjoidnJWV2tBSXAyV1hlNDBVSVVXNWpoVEFHV05DeWlpdUpkOGp0dDUwSGo0byIsInJpZCI6ImMwMWRmMjlkLWJiNjgtNDRiMS1hZTk2LTkyMjA3NTUxMTY4YiJ9.rmIByA-OQhnDAP2zCLFjrLULPw5Gt9CbhV3hAbq5UBE-1HB2KoFx0PX-vTIvyD2r9Wkny8AuVfJX9gkUI7C2DQ';

const BATCH_SIZE = 10000;
const DATA_DIR = path.join(__dirname, '..', 'tmp', 'anac-batches');

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

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
        if (typeof r.data_aggiudicazione_definitiva === 'number') {
          dataAgg = new Date(r.data_aggiudicazione_definitiva).toISOString().split('T')[0];
        } else {
          dataAgg = String(r.data_aggiudicazione_definitiva);
        }
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

async function loadFromFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('Nessun file batch trovato in', DATA_DIR);
    return;
  }

  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  console.log(`Trovati ${files.length} file batch da caricare`);
  let total = 0;
  const start = Date.now();

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const inserted = await insertBatch(records);
    total += inserted;
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const rate = (total / (elapsed || 1)).toFixed(0);
    console.log(`[${file}] +${inserted} → totale: ${total} (${elapsed}s, ${rate} rec/s)`);
  }

  console.log(`\n✅ Caricamento completato: ${total} record in ${((Date.now()-start)/1000).toFixed(1)}s`);
}

// Mode: load from local JSON files
if (process.argv[2] === 'load') {
  loadFromFiles().catch(console.error);
}
// Mode: HTTP server to receive from browser
else {
  const PORT = 3333;
  let totalInserted = 0;
  const startTime = Date.now();

  // Ensure data dir exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET') {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, totalInserted, elapsed: `${elapsed}s` }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { records, batchNum } = JSON.parse(body);
          // Save to file
          const filename = `batch_${String(batchNum||0).padStart(5,'0')}.json`;
          fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(records));
          // Insert into Turso
          const inserted = await insertBatch(records);
          totalInserted += inserted;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const rate = (totalInserted / (elapsed || 1)).toFixed(0);
          console.log(`[batch ${batchNum}] +${inserted} → totale: ${totalInserted} (${elapsed}s, ${rate} rec/s)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, inserted, totalInserted }));
        } catch (err) {
          console.error('[ingest] ERROR:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Local ingest server su http://localhost:${PORT}`);
    console.log(`   Turso: ${TURSO_URL}`);
    console.log(`   Batch salvati in: ${DATA_DIR}`);
    console.log(`   Per ricaricare da file: node scripts/local-ingest.cjs load\n`);
  });
}
