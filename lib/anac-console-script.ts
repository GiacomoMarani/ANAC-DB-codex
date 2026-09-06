// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/anac-console-script.ts
 *
 * Script da eseguire nella console del browser su dati.anticorruzione.it.
 *
 * COME FUNZIONA:
 * 1. Ottiene il CSRF token da ANAC (same-origin)
 * 2. Fa polling su http://localhost:3000/api/anac-request ogni 2s
 *    per leggere i parametri correnti (pagina, filtri)
 * 3. Quando i params cambiano, fa fetch /api/v1/chart/data su ANAC (same-origin)
 * 4. Invia i risultati a http://localhost:3000/api/anac-data
 *
 * QUESTO SCRIPT VIENE ESEGUITO UNA VOLTA E RIMANE ATTIVO.
 * Aggiorna automaticamente i dati ogni volta che l'utente cambia filtri/pagina.
 *
 * Versione: mini (1 riga) per copia-incolla veloce
 * e versione leggibile per debug.
 */

/** Script minificato da copiare nella console ANAC — 1 sola riga */
export const ANAC_CONSOLE_SCRIPT_MINI = `(async()=>{const APP='http://localhost:3000';let _csrf=null,_key=null,_running=true;async function csrf(){if(_csrf)return _csrf;const r=await fetch('/api/v1/security/csrf_token/',{headers:{Accept:'application/json'},credentials:'include'});const j=await r.json();_csrf=j.result;return _csrf;}async function query(params){const tok=await csrf();const cols=["cig","oggetto_bando","importo_lotto","denominazione_amministrazione_appaltante","data_pubblicazione","oggetto_principale_contratto","tipo_scelta_contraente","sezione_regionale","cod_cpv","flag_pnrr_pnc","provincia"];const filters=[];if(params.q)filters.push({col:"oggetto_bando",op:"LIKE",val:"%"+params.q.toUpperCase()+"%"});if(params.tipo){const m={goods:"FORNITURE",services:"SERVIZI",works:"LAVORI"};filters.push({col:"oggetto_principale_contratto",op:"==",val:m[params.tipo.toLowerCase()]||params.tipo.toUpperCase()});}const payload={datasource:{id:81,type:"table"},force:false,queries:[{time_range:"No filter",filters,extras:{time_range_endpoints:["inclusive","exclusive"],having:"",having_druid:[],where:""},applied_time_extras:{},columns,metrics:[],orderby:[["data_pubblicazione",false]],annotation_layers:[],row_limit:params.pageSize||10,row_offset:(params.page||0)*(params.pageSize||10),order_desc:true,url_params:{},custom_params:{},custom_form_data:{},groupby:[]}],form_data:{datasource:"81__table",viz_type:"table",query_mode:"raw",all_columns:columns,groupby:[],metrics:[],row_limit:params.pageSize||10,order_desc:true,result_format:"json",result_type:"full"},result_format:"json",result_type:"full"};const res=await fetch('/api/v1/chart/data',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRFToken':tok,Referer:'https://dati.anticorruzione.it/superset/dashboard/appalti/'},body:JSON.stringify(payload)});if(!res.ok){if(res.status===401||res.status===403)_csrf=null;return null;}const d=await res.json();const r0=d?.result?.[0];if(r0?.error)return null;return{rows:r0?.data||[],total:r0?.rowcount||0};}async function send(key,rows,total){await fetch(APP+'/api/anac-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,rows,total,rowcount:total})}).catch(()=>{});}async function loop(){console.log('[ANAC-RELAY] Avviato. Polling richieste da '+APP);while(_running){try{const r=await fetch(APP+'/api/anac-request').catch(()=>null);if(r&&r.ok){const req=await r.json();if(req.key&&req.key!==_key){console.log('[ANAC-RELAY] Nuova richiesta:',req.key);_key=req.key;const result=await query(req.params);if(result){await send(req.key,result.rows,result.total);console.log('[ANAC-RELAY] Inviati',result.rows.length,'bandi per key:',req.key);}else{console.warn('[ANAC-RELAY] Query fallita per key:',req.key);}}}}catch(e){console.warn('[ANAC-RELAY] Errore:',e.message);}await new Promise(r=>setTimeout(r,2000));}console.log('[ANAC-RELAY] Fermato.');}window._anacRelay={stop:()=>{_running=false;},restart:()=>{_running=true;loop();}};loop();})();`

/** Versione leggibile per debug e documentazione */
export const ANAC_CONSOLE_SCRIPT_READABLE = `
// ═══════════════════════════════════════════════════════════════
// ANAC Data Relay — esegui questo script su dati.anticorruzione.it
// Premi F12 → Console → incolla e premi Invio
// ═══════════════════════════════════════════════════════════════

(async () => {
  const APP = 'http://localhost:3000';
  let _csrf = null, _key = null, _running = true;

  // ── Ottieni CSRF token (same-origin su ANAC) ──────────────────
  async function getCsrf() {
    if (_csrf) return _csrf;
    const res = await fetch('/api/v1/security/csrf_token/', {
      headers: { Accept: 'application/json' },
      credentials: 'include'
    });
    const { result } = await res.json();
    _csrf = result;
    console.log('[ANAC-RELAY] CSRF ottenuto:', result.substring(0, 20) + '...');
    return _csrf;
  }

  // ── Chiama ANAC chart/data con i params richiesti ─────────────
  async function queryAnac(params) {
    const token = await getCsrf();
    const cols = [
      'cig', 'oggetto_bando', 'importo_lotto',
      'denominazione_amministrazione_appaltante', 'data_pubblicazione',
      'oggetto_principale_contratto', 'tipo_scelta_contraente',
      'sezione_regionale', 'cod_cpv', 'flag_pnrr_pnc', 'provincia'
    ];

    const filters = [];
    if (params.q)
      filters.push({ col: 'oggetto_bando', op: 'LIKE', val: '%' + params.q.toUpperCase() + '%' });
    if (params.tipo) {
      const m = { goods: 'FORNITURE', services: 'SERVIZI', works: 'LAVORI' };
      filters.push({ col: 'oggetto_principale_contratto', op: '==', val: m[params.tipo.toLowerCase()] || params.tipo.toUpperCase() });
    }
    if (params.importoGte) filters.push({ col: 'importo_lotto', op: '>=', val: params.importoGte });
    if (params.importoLte) filters.push({ col: 'importo_lotto', op: '<=', val: params.importoLte });

    const pageSize  = params.pageSize || 10;
    const rowOffset = (params.page || 0) * pageSize;

    const payload = {
      datasource: { id: 81, type: 'table' },
      force: false,
      queries: [{
        time_range: 'No filter',
        filters,
        extras: { time_range_endpoints: ['inclusive', 'exclusive'], having: '', having_druid: [], where: '' },
        applied_time_extras: {},
        columns: cols,
        metrics: [],
        orderby: [['data_pubblicazione', false]],
        annotation_layers: [],
        row_limit: pageSize,
        row_offset: rowOffset,
        order_desc: true,
        url_params: {}, custom_params: {}, custom_form_data: {}, groupby: []
      }],
      form_data: {
        datasource: '81__table', viz_type: 'table', query_mode: 'raw',
        all_columns: cols, groupby: [], metrics: [],
        row_limit: pageSize, order_desc: true, result_format: 'json', result_type: 'full'
      },
      result_format: 'json',
      result_type: 'full'
    };

    const res = await fetch('/api/v1/chart/data', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRFToken': token,
        Referer: 'https://dati.anticorruzione.it/superset/dashboard/appalti/'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) _csrf = null; // CSRF scaduto
      console.warn('[ANAC-RELAY] chart/data HTTP:', res.status);
      return null;
    }

    const data  = await res.json();
    const r0    = data?.result?.[0];
    if (r0?.error) { console.warn('[ANAC-RELAY] Dremio error:', r0.error); return null; }

    return { rows: r0?.data || [], total: r0?.rowcount || 0 };
  }

  // ── Invia i dati all'app ─────────────────────────────────────
  async function sendToApp(key, rows, total) {
    try {
      await fetch(APP + '/api/anac-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, rows, total, rowcount: total })
      });
    } catch (e) {
      console.warn('[ANAC-RELAY] sendToApp error:', e.message);
    }
  }

  // ── Loop principale ──────────────────────────────────────────
  async function loop() {
    console.log('%c[ANAC-RELAY] Avviato ✅', 'color: #10b981; font-weight: bold;');
    console.log('Polling richieste da', APP, 'ogni 2s...');
    console.log('Ferma con: window._anacRelay.stop()');

    while (_running) {
      try {
        const reqRes = await fetch(APP + '/api/anac-request').catch(() => null);
        if (reqRes && reqRes.ok) {
          const req = await reqRes.json();

          if (req.key && req.key !== _key) {
            console.log('[ANAC-RELAY] Nuova richiesta, key:', req.key, 'params:', req.params);
            _key = req.key;

            const result = await queryAnac(req.params);
            if (result) {
              await sendToApp(req.key, result.rows, result.total);
              console.log('%c[ANAC-RELAY] ✓ ' + result.rows.length + ' bandi inviati', 'color: #6366f1;');
            }
          }
        }
      } catch (e) {
        console.warn('[ANAC-RELAY] Loop error:', e.message);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('%c[ANAC-RELAY] Fermato.', 'color: #ef4444;');
  }

  // Esponi controlli globali
  window._anacRelay = {
    stop:    () => { _running = false; },
    restart: () => { _running = true; loop(); },
    status:  () => ({ running: _running, lastKey: _key })
  };

  loop();
})();
`.trim()
