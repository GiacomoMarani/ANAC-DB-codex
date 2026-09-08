// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/anac-profiling-relay.ts
 *
 * Script relay per profiling via ANAC Superset API.
 *
 * Due modalità:
 * A) BOOKMARKLET: l'utente incolla lo script nella console ANAC
 *    → comunica via postMessage con la nostra pagina
 * B) POLLING: compatibilità con il pattern esistente (localhost polling)
 *
 * Usa il dataset AGGIUDICATARI_NO_ACCORDO_QUADRO (id: 85)
 * che è pre-joinato e filtrabile per cod_fisc_partecipante (P.IVA).
 *
 * Campi disponibili: cig, cod_cpv, oggetto_bando, importo_aggiudicazione,
 * data_aggiudicazione_definitiva, denominazione_partecipante,
 * denominazione_amministrazione_appaltante, provincia,
 * oggetto_principale_contratto, partecipante_ruolo, importo_lotto,
 * sezione_regionale, settore, flag_pnrr_pnc
 */

/** Origine della nostra app (per postMessage targetOrigin) */
const APP_ORIGINS = [
  'https://tender-ai-db.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
];

/** Colonne estratte dal dataset AGGIUDICATARI (id: 85) */
const PROFILING_COLUMNS = [
  'cig',
  'cod_cpv',
  'oggetto_bando',
  'importo_aggiudicazione',
  'data_aggiudicazione_definitiva',
  'denominazione_partecipante',
  'denominazione_amministrazione_appaltante',
  'provincia',
  'oggetto_principale_contratto',
  'partecipante_ruolo',
  'importo_lotto',
  'sezione_regionale',
  'settore',
  'flag_pnrr_pnc',
];

/**
 * Script minificato per bookmarklet / console paste.
 * Incollare nella console del browser su dati.anticorruzione.it
 *
 * Comunica via postMessage con window.opener (la nostra pagina).
 * Se non c'è opener, fallback a polling HTTP su localhost:3000.
 */
export const ANAC_PROFILING_RELAY_MINI = `javascript:void((async()=>{const O=['https://tender-ai-db.vercel.app','http://localhost:3000','http://localhost:3001'];const COLS=['cig','cod_cpv','oggetto_bando','importo_aggiudicazione','data_aggiudicazione_definitiva','denominazione_partecipante','denominazione_amministrazione_appaltante','provincia','oggetto_principale_contratto','partecipante_ruolo','importo_lotto','sezione_regionale','settore','flag_pnrr_pnc'];let _csrf=null;async function csrf(){if(_csrf)return _csrf;const r=await fetch('/api/v1/security/csrf_token/',{headers:{Accept:'application/json'},credentials:'include'});const j=await r.json();_csrf=j.result;return _csrf;}async function queryPIVA(piva){const tok=await csrf();const p={datasource:{id:85,type:'table'},force:false,queries:[{time_range:'No filter',filters:[{col:'cod_fisc_partecipante',op:'IN',val:[piva]}],extras:{time_range_endpoints:['inclusive','exclusive'],having:'',where:''},columns:COLS,row_limit:1000,order_desc:true,orderby:[['data_aggiudicazione_definitiva',false]]}],form_data:{datasource:'85__table',viz_type:'table'},result_format:'json',result_type:'full'};const r=await fetch('/api/v1/chart/data',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Accept:'application/json','X-CSRFToken':tok,Referer:'https://dati.anticorruzione.it/superset/dashboard/appalti/'},body:JSON.stringify(p)});if(!r.ok){if(r.status===401||r.status===403)_csrf=null;return null;}const d=await r.json();const r0=d?.result?.[0];if(r0?.error)return null;return{rows:r0?.data||[],total:r0?.rowcount||0};}function reply(src,id,data){try{for(const o of O){src.postMessage({type:'anac-profiling-result',id,data},'*');}console.log('[ANAC-PROFILING] Inviati',data?.rows?.length||0,'record');}catch(e){console.warn('[ANAC-PROFILING] postMessage error:',e.message);}}window.addEventListener('message',async(ev)=>{if(!O.some(o=>ev.origin===o||ev.origin.includes('localhost')||ev.origin.includes('vercel.app')))return;const msg=ev.data;if(msg?.type==='anac-profiling-query'&&msg?.piva){console.log('[ANAC-PROFILING] Query per P.IVA:',msg.piva);try{const result=await queryPIVA(msg.piva);reply(ev.source,msg.id,result||{rows:[],total:0});}catch(e){console.error('[ANAC-PROFILING] Errore:',e);reply(ev.source,msg.id,{rows:[],total:0,error:e.message});}}if(msg?.type==='anac-profiling-ping'){ev.source.postMessage({type:'anac-profiling-pong'},'*');}});if(window.opener){for(const o of O){window.opener.postMessage({type:'anac-profiling-ready'},'*');}}console.log('%c[ANAC-PROFILING] Relay attivo ✅','color:#10b981;font-weight:bold');console.log('In ascolto per richieste profiling via postMessage...');})())`;

/**
 * Versione leggibile dello script relay per profiling.
 */
export const ANAC_PROFILING_RELAY_READABLE = `
// ═══════════════════════════════════════════════════════════════════
// ANAC Profiling Relay — query per P.IVA via Superset API
// Incolla nella console di dati.anticorruzione.it/superset/dashboard/appalti/
// ═══════════════════════════════════════════════════════════════════

(async () => {
  const ORIGINS = [
    'https://tender-ai-db.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  const COLS = [
    'cig', 'cod_cpv', 'oggetto_bando', 'importo_aggiudicazione',
    'data_aggiudicazione_definitiva', 'denominazione_partecipante',
    'denominazione_amministrazione_appaltante', 'provincia',
    'oggetto_principale_contratto', 'partecipante_ruolo',
    'importo_lotto', 'sezione_regionale', 'settore', 'flag_pnrr_pnc'
  ];

  let _csrf = null;

  // ── CSRF Token ────────────────────────────────────────────────
  async function getCsrf() {
    if (_csrf) return _csrf;
    const res = await fetch('/api/v1/security/csrf_token/', {
      headers: { Accept: 'application/json' },
      credentials: 'include'
    });
    const { result } = await res.json();
    _csrf = result;
    console.log('[ANAC-PROFILING] CSRF:', result.substring(0, 20) + '...');
    return _csrf;
  }

  // ── Query per P.IVA ───────────────────────────────────────────
  async function queryPIVA(piva) {
    const token = await getCsrf();

    const payload = {
      datasource: { id: 85, type: 'table' },
      force: false,
      queries: [{
        time_range: 'No filter',
        filters: [{ col: 'cod_fisc_partecipante', op: 'IN', val: [piva] }],
        extras: {
          time_range_endpoints: ['inclusive', 'exclusive'],
          having: '', where: ''
        },
        columns: COLS,
        row_limit: 1000,
        order_desc: true,
        orderby: [['data_aggiudicazione_definitiva', false]]
      }],
      form_data: { datasource: '85__table', viz_type: 'table' },
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
      if (res.status === 401 || res.status === 403) _csrf = null;
      console.warn('[ANAC-PROFILING] HTTP:', res.status);
      return null;
    }

    const data = await res.json();
    const r0 = data?.result?.[0];
    if (r0?.error) {
      console.warn('[ANAC-PROFILING] Dremio error:', r0.error);
      return null;
    }

    return { rows: r0?.data || [], total: r0?.rowcount || 0 };
  }

  // ── postMessage listener ──────────────────────────────────────
  window.addEventListener('message', async (ev) => {
    // Verifica origine
    const validOrigin = ORIGINS.some(o => ev.origin === o) 
      || ev.origin.includes('localhost')
      || ev.origin.includes('vercel.app');
    if (!validOrigin) return;

    const msg = ev.data;

    // Query profiling per P.IVA
    if (msg?.type === 'anac-profiling-query' && msg?.piva) {
      console.log('[ANAC-PROFILING] Query P.IVA:', msg.piva);
      try {
        const result = await queryPIVA(msg.piva);
        ev.source.postMessage({
          type: 'anac-profiling-result',
          id: msg.id,
          data: result || { rows: [], total: 0 }
        }, '*');
        console.log('%c[ANAC-PROFILING] ✓ ' + (result?.rows?.length || 0) + ' record', 'color: #6366f1;');
      } catch (e) {
        console.error('[ANAC-PROFILING] Errore:', e);
        ev.source.postMessage({
          type: 'anac-profiling-result',
          id: msg.id,
          data: { rows: [], total: 0, error: e.message }
        }, '*');
      }
    }

    // Ping/pong per verificare che il relay sia attivo
    if (msg?.type === 'anac-profiling-ping') {
      ev.source.postMessage({ type: 'anac-profiling-pong' }, '*');
    }
  });

  // ── Notifica opener che il relay è pronto ─────────────────────
  if (window.opener) {
    window.opener.postMessage({ type: 'anac-profiling-ready' }, '*');
  }

  console.log('%c[ANAC-PROFILING] Relay attivo ✅', 'color: #10b981; font-weight: bold;');
  console.log('In ascolto per richieste profiling via postMessage...');
  console.log('Ferma con: window.removeEventListener("message", ...)');
})();
`.trim();
