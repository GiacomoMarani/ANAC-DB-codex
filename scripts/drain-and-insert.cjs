/**
 * Drena i record accumulati nel browser ANAC (window.__allRecords)
 * e li inserisce in Turso. Chiamato periodicamente.
 *
 * Uso: node scripts/drain-and-insert.cjs
 */
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

const TURSO_URL = 'libsql://anac-storico-giacomomarani.aws-eu-west-1.turso.io';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg4Nzk5NjMsImlkIjoiMDFhMDgxODgtYzUwMS03ODA3LWEwOTYtZjU2NjJmNWEwNjU0Iiwia2lkIjoidnJWV2tBSXAyV1hlNDBVSVVXNWpoVEFHV05DeWlpdUpkOGp0dDUwSGo0byIsInJpZCI6ImMwMWRmMjlkLWJiNjgtNDRiMS1hZTk2LTkyMjA3NTUxMTY4YiJ9.rmIByA-OQhnDAP2zCLFjrLULPw5Gt9CbhV3hAbq5UBE-1HB2KoFx0PX-vTIvyD2r9Wkny8AuVfJX9gkUI7C2DQ';
const DRAIN_SIZE = 50000; // drain 50K at a time

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const DATA_DIR = path.join(__dirname, '..', 'tmp', 'anac-batches');
fs.mkdirSync(DATA_DIR, { recursive: true });

async function insertRecords(records) {
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
      return [r.cig, r.cod_fisc_partecipante, r.denominazione_partecipante||null, r.cod_cpv||null, r.oggetto_bando||null, r.importo_aggiudicazione??null, dataAgg, r.provincia||null, r.denominazione_amministrazione_appaltante||null, r.oggetto_principale_contratto||null, r.sezione_regionale||null, r.settore||null, r.importo_lotto??null, r.partecipante_ruolo||null, r.flag_pnrr_pnc||null];
    });
    await client.execute({
      sql: `INSERT OR REPLACE INTO aggiudicatari_storico (cig,cod_fisc,denominazione,cod_cpv,oggetto_bando,importo_aggiudicazione,data_aggiudicazione,provincia,stazione_appaltante,tipo_contratto,sezione_regionale,settore,importo_lotto,ruolo,flag_pnrr) VALUES ${placeholders}`,
      args,
    });
    inserted += chunk.length;
  }
  return inserted;
}

async function loadFromFiles() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) { console.log('No files to load'); return; }
  console.log(`Loading ${files.length} files from ${DATA_DIR}`);
  let total = 0;
  const start = Date.now();
  for (const file of files) {
    const records = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    const inserted = await insertRecords(records);
    total += inserted;
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`[${file}] +${inserted} → ${total} (${elapsed}s, ${(total/(elapsed||1)).toFixed(0)} rec/s)`);
  }
  console.log(`\n✅ Done: ${total} records in ${((Date.now()-start)/1000).toFixed(1)}s`);
}

if (process.argv[2] === 'load') {
  loadFromFiles().catch(console.error);
} else {
  console.log('Usage:');
  console.log('  node scripts/drain-and-insert.cjs load   # load from JSON files in tmp/anac-batches/');
}
