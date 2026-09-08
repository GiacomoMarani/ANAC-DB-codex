// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * ANAC Superset Extractor Script
 *
 * This script runs in the browser console on dati.anticorruzione.it
 * It queries dataset 85 (AGGIUDICATARI_NO_ACCORDO_QUADRO) in batches
 * and sends the data to our ingest API.
 *
 * Usage: paste in ANAC browser console, or load via bookmarklet
 */

export const ANAC_EXTRACTOR_SCRIPT = `
(async function anacExtractor() {
  const INGEST_URL = '%%INGEST_URL%%';
  const API_KEY = '%%API_KEY%%';
  const BATCH_SIZE = 50000;
  const COLUMNS = [
    'cig', 'cod_cpv', 'oggetto_bando', 'importo_aggiudicazione',
    'data_aggiudicazione_definitiva', 'denominazione_partecipante',
    'cod_fisc_partecipante', 'provincia',
    'denominazione_amministrazione_appaltante',
    'oggetto_principale_contratto', 'sezione_regionale', 'settore',
    'importo_lotto', 'partecipante_ruolo', 'flag_pnrr_pnc'
  ];

  console.log('%c[ANAC Extractor] Avvio estrazione...', 'color: #2563eb; font-weight: bold; font-size: 14px');

  // Get CSRF token
  let csrfToken;
  try {
    const csrfRes = await fetch('/api/v1/security/csrf_token/', { credentials: 'include' });
    const csrf = await csrfRes.json();
    csrfToken = csrf.result;
    console.log('[ANAC Extractor] CSRF token ottenuto');
  } catch (e) {
    console.error('[ANAC Extractor] Errore CSRF:', e);
    return;
  }

  let offset = 0;
  let totalSent = 0;
  let batchNum = 0;
  let hasMore = true;
  const startTime = Date.now();

  while (hasMore) {
    batchNum++;
    console.log('[ANAC Extractor] Batch ' + batchNum + ' — offset ' + offset + ' (inviati: ' + totalSent + ')');

    // Query ANAC Superset
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
        row_offset: offset,
        order_desc: true,
        orderby: [['data_aggiudicazione_definitiva', false]]
      }],
      form_data: {
        datasource: '85__table',
        viz_type: 'table',
        result_format: 'json',
        result_type: 'full'
      },
      result_format: 'json',
      result_type: 'full'
    };

    let records;
    try {
      const res = await fetch('/api/v1/chart/data?form_data=%7B%7D', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        // Try refreshing CSRF token on 400/403
        if (res.status === 400 || res.status === 403) {
          console.warn('[ANAC Extractor] Rinnovo CSRF token...');
          const newCsrf = await fetch('/api/v1/security/csrf_token/', { credentials: 'include' }).then(r => r.json());
          csrfToken = newCsrf.result;
          // Retry same batch
          continue;
        }
        const errText = await res.text();
        console.error('[ANAC Extractor] Errore query batch ' + batchNum + ':', res.status, errText.substring(0, 200));
        // Wait and retry
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const data = await res.json();
      records = data.result?.[0]?.data || [];
    } catch (e) {
      console.error('[ANAC Extractor] Errore fetch batch ' + batchNum + ':', e);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    if (records.length === 0) {
      hasMore = false;
      console.log('%c[ANAC Extractor] Nessun altro record. Fine!', 'color: #16a34a; font-weight: bold');
      break;
    }

    // Send to ingest API
    try {
      const ingestRes = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records, apiKey: API_KEY })
      });

      if (!ingestRes.ok) {
        const errBody = await ingestRes.text();
        console.error('[ANAC Extractor] Errore ingest:', ingestRes.status, errBody.substring(0, 200));
        // Continue anyway — don't lose progress
      } else {
        const result = await ingestRes.json();
        console.log('[ANAC Extractor] Batch ' + batchNum + ': ' + result.inserted + ' inseriti');
      }
    } catch (e) {
      console.error('[ANAC Extractor] Errore invio batch ' + batchNum + ':', e);
    }

    totalSent += records.length;
    offset += BATCH_SIZE;

    // If we got fewer records than BATCH_SIZE, we're done
    if (records.length < BATCH_SIZE) {
      hasMore = false;
    }

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 1000));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('%c[ANAC Extractor] Completato! ' + totalSent + ' record in ' + elapsed + 's', 'color: #16a34a; font-weight: bold; font-size: 14px');
})();
`
