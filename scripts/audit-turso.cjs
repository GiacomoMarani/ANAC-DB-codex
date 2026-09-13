const { createClient } = require('@libsql/client');
const c = createClient({
  url: 'libsql://anac-storico-giacomomarani.aws-eu-west-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg4Nzk5NjMsImlkIjoiMDFhMDgxODgtYzUwMS03ODA3LWEwOTYtZjU2NjJmNWEwNjU0Iiwia2lkIjoidnJWV2tBSXAyV1hlNDBVSVVXNWpoVEFHV05DeWlpdUpkOGp0dDUwSGo0byIsInJpZCI6ImMwMWRmMjlkLWJiNjgtNDRiMS1hZTk2LTkyMjA3NTUxMTY4YiJ9.rmIByA-OQhnDAP2zCLFjrLULPw5Gt9CbhV3hAbq5UBE-1HB2KoFx0PX-vTIvyD2r9Wkny8AuVfJX9gkUI7C2DQ'
});

async function audit() {
  // 1. Totale
  const t = await c.execute('SELECT COUNT(*) as cnt FROM aggiudicatari_storico');
  console.log('=== TOTALE RECORD ===');
  console.log(t.rows[0].cnt);

  // 2. Campione
  const s = await c.execute('SELECT * FROM aggiudicatari_storico LIMIT 5');
  console.log('\n=== CAMPIONE (5 record) ===');
  s.rows.forEach(r => console.log(JSON.stringify(r, null, 2)));

  // 3. Null check
  const n = await c.execute(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN cig IS NULL OR cig='' THEN 1 ELSE 0 END) as null_cig,
      SUM(CASE WHEN cod_fisc IS NULL OR cod_fisc='' THEN 1 ELSE 0 END) as null_cf,
      SUM(CASE WHEN denominazione IS NULL OR denominazione='' THEN 1 ELSE 0 END) as null_den,
      SUM(CASE WHEN cod_cpv IS NULL OR cod_cpv='' THEN 1 ELSE 0 END) as null_cpv,
      SUM(CASE WHEN importo_aggiudicazione IS NULL THEN 1 ELSE 0 END) as null_importo,
      SUM(CASE WHEN data_aggiudicazione IS NULL OR data_aggiudicazione='' THEN 1 ELSE 0 END) as null_data,
      SUM(CASE WHEN provincia IS NULL OR provincia='' THEN 1 ELSE 0 END) as null_prov,
      SUM(CASE WHEN stazione_appaltante IS NULL OR stazione_appaltante='' THEN 1 ELSE 0 END) as null_sa
    FROM aggiudicatari_storico
  `);
  console.log('\n=== NULL/EMPTY CHECK ===');
  const row = n.rows[0];
  console.log(`Totale: ${row.total}`);
  console.log(`CIG null/vuoti: ${row.null_cig} (${(row.null_cig/row.total*100).toFixed(1)}%)`);
  console.log(`Cod.Fisc null/vuoti: ${row.null_cf} (${(row.null_cf/row.total*100).toFixed(1)}%)`);
  console.log(`Denominazione null/vuote: ${row.null_den} (${(row.null_den/row.total*100).toFixed(1)}%)`);
  console.log(`CPV null/vuoti: ${row.null_cpv} (${(row.null_cpv/row.total*100).toFixed(1)}%)`);
  console.log(`Importo null: ${row.null_importo} (${(row.null_importo/row.total*100).toFixed(1)}%)`);
  console.log(`Data agg. null/vuota: ${row.null_data} (${(row.null_data/row.total*100).toFixed(1)}%)`);
  console.log(`Provincia null/vuota: ${row.null_prov} (${(row.null_prov/row.total*100).toFixed(1)}%)`);
  console.log(`Staz.appaltante null/vuota: ${row.null_sa} (${(row.null_sa/row.total*100).toFixed(1)}%)`);

  // 4. Unique values
  const u = await c.execute(`
    SELECT COUNT(DISTINCT cig) as distinct_cig, 
           COUNT(DISTINCT cod_fisc) as distinct_cf
    FROM aggiudicatari_storico
  `);
  console.log('\n=== VALORI UNICI ===');
  console.log(`CIG distinti: ${u.rows[0].distinct_cig}`);
  console.log(`Cod.Fisc distinti: ${u.rows[0].distinct_cf}`);

  // 5. Importi
  const i = await c.execute(`
    SELECT MIN(importo_aggiudicazione) as min_imp, 
           MAX(importo_aggiudicazione) as max_imp, 
           AVG(importo_aggiudicazione) as avg_imp
    FROM aggiudicatari_storico 
    WHERE importo_aggiudicazione IS NOT NULL AND importo_aggiudicazione > 0
  `);
  console.log('\n=== IMPORTI ===');
  console.log(`Min: €${Number(i.rows[0].min_imp).toLocaleString('it-IT')}`);
  console.log(`Max: €${Number(i.rows[0].max_imp).toLocaleString('it-IT')}`);
  console.log(`Media: €${Number(i.rows[0].avg_imp).toLocaleString('it-IT', {maximumFractionDigits:0})}`);

  // 6. Date
  const d = await c.execute(`
    SELECT data_aggiudicazione, COUNT(*) as cnt 
    FROM aggiudicatari_storico 
    WHERE data_aggiudicazione IS NOT NULL 
    GROUP BY data_aggiudicazione 
    ORDER BY cnt DESC LIMIT 10
  `);
  console.log('\n=== TOP 10 DATE AGGIUDICAZIONE ===');
  d.rows.forEach(r => console.log(`${r.data_aggiudicazione}: ${r.cnt} record`));

  // 7. Date format check (should be YYYY-MM-DD)
  const bad = await c.execute(`
    SELECT data_aggiudicazione, COUNT(*) as cnt
    FROM aggiudicatari_storico 
    WHERE data_aggiudicazione IS NOT NULL 
      AND data_aggiudicazione NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    LIMIT 10
  `);
  console.log('\n=== DATE FORMATO ERRATO ===');
  console.log(bad.rows.length > 0 ? bad.rows : 'Nessuna — tutte in formato YYYY-MM-DD ✅');

  // 8. Top stazioni appaltanti
  const sa = await c.execute(`
    SELECT stazione_appaltante, COUNT(*) as cnt 
    FROM aggiudicatari_storico 
    WHERE stazione_appaltante IS NOT NULL 
    GROUP BY stazione_appaltante 
    ORDER BY cnt DESC LIMIT 5
  `);
  console.log('\n=== TOP 5 STAZIONI APPALTANTI ===');
  sa.rows.forEach(r => console.log(`${r.stazione_appaltante}: ${r.cnt}`));

  // 9. Top province
  const p = await c.execute(`
    SELECT provincia, COUNT(*) as cnt 
    FROM aggiudicatari_storico 
    WHERE provincia IS NOT NULL 
    GROUP BY provincia 
    ORDER BY cnt DESC LIMIT 10
  `);
  console.log('\n=== TOP 10 PROVINCE ===');
  p.rows.forEach(r => console.log(`${r.provincia}: ${r.cnt}`));
}

audit().catch(console.error);
