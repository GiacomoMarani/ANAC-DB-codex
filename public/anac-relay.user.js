// ==UserScript==
// @name         ANAC Relay — DB Codex
// @namespace    https://anac-db-codex.vercel.app
// @version      2.1
// @description  Relay automatico: recupera i bandi ANAC in corso e li invia all'app. Zero azioni manuali dopo l'installazione.
// @author       ANAC-DB-Codex
// @match        https://dati.anticorruzione.it/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @run-at       document-idle
// @connect      localhost
// @connect      anac-db-codex.vercel.app
// @connect      dati.anticorruzione.it
// ==/UserScript==

;(function () {
  'use strict'

  // ── Configurazione ────────────────────────────────────────────────────────
  // L'URL dell'app viene letto da localStorage (impostato dalla UI) oppure
  // usa il default Vercel. Puoi cambiarlo anche in GM_setValue:
  //   GM_setValue('anacAppUrl', 'http://localhost:3000')
  const APP_URL = (
    GM_getValue('anacAppUrl', null) ||
    localStorage.getItem('anacRelayAppUrl') ||
    'https://anac-db-codex.vercel.app'
  ).replace(/\/$/, '')

  const POLL_MS    = 3_000    // polling ogni 3 secondi
  const LOG_PREFIX = '[ANAC-RELAY]'

  let _csrf    = null
  let _lastKey = null
  let _running = true
  let _errors  = 0

  log(`Avviato → app: ${APP_URL}`)

  // ── Utilities ──────────────────────────────────────────────────────────────

  function log(...args) {
    console.log(LOG_PREFIX, ...args)
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args)
  }

  // fetch cross-origin tramite GM_xmlhttpRequest (bypassa CORS)
  function gmFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method:  opts.method || 'GET',
        url,
        headers: opts.headers || {},
        data:    opts.body || undefined,
        timeout: opts.timeout || 15_000,
        onload:  res => resolve({
          ok:     res.status >= 200 && res.status < 300,
          status: res.status,
          json:   () => JSON.parse(res.responseText),
          text:   () => res.responseText,
        }),
        onerror:   err => reject(new Error(`Network error: ${JSON.stringify(err)}`)),
        ontimeout: ()  => reject(new Error('Timeout')),
      })
    })
  }

  // fetch same-origin su ANAC (tramite browser nativo — cookies inclusi)
  async function anacFetch(path, opts = {}) {
    const res = await fetch(`https://dati.anticorruzione.it${path}`, {
      credentials: 'include',
      ...opts,
    })
    return res
  }

  // ── CSRF ───────────────────────────────────────────────────────────────────

  async function getCsrf() {
    if (_csrf) return _csrf
    const res  = await anacFetch('/api/v1/security/csrf_token/', {
      headers: { Accept: 'application/json' },
    })
    const data = await res.json()
    _csrf = data.result
    log('CSRF ottenuto:', _csrf?.substring(0, 15) + '…')
    return _csrf
  }

  // ── Query ANAC ─────────────────────────────────────────────────────────────

  async function queryANAC(params) {
    const csrf = await getCsrf()

    // Colonne verificate dall'ispezione DevTools sul datasource appalti."05_all" (id:88)
    const cols = [
      'cig',
      'oggetto_bando',
      'importo_lotto',
      'denominazione_amministrazione_appaltante',
      'data_pubblicazione',
      'oggetto_principale_contratto',
      'tipo_scelta_contraente',
      'sezione_regionale',
      'cod_cpv',
      'flag_pnrr_pnc',
      'data_scadenza_offerta',
    ]

    const filters = []
    if (params.q) {
      filters.push({ col: 'oggetto_bando', op: 'LIKE', val: `%${params.q.toUpperCase()}%` })
    }
    if (params.tipo) {
      const tipoMap = { goods: 'FORNITURE', services: 'SERVIZI', works: 'LAVORI' }
      filters.push({
        col: 'oggetto_principale_contratto',
        op:  '==',
        val: tipoMap[params.tipo?.toLowerCase()] ?? params.tipo?.toUpperCase(),
      })
    }

    const pageSize  = params.pageSize || 10
    const rowOffset = (params.page || 0) * pageSize

    const payload = {
      // datasource verificato da DevTools: appalti."05_all" (bandi in corso)
      datasource:  { id: 88, type: 'table' },
      force:       false,
      queries:     [{
        time_range:   'No filter',
        filters,
        extras:       { time_range_endpoints: ['inclusive', 'exclusive'], having: '', having_druid: [], where: '' },
        applied_time_extras: {},
        columns:      cols,
        metrics:      [],
        orderby:      [['data_pubblicazione', false]],
        annotation_layers: [],
        row_limit:    pageSize,
        row_offset:   rowOffset,
        order_desc:   true,
        url_params:   {},
        custom_params: {},
        custom_form_data: {},
        groupby:      [],
      }],
      form_data: {
        datasource:   '88__table',
        viz_type:     'table',
        query_mode:   'raw',
        all_columns:  cols,
        groupby:      [],
        metrics:      [],
        row_limit:    pageSize,
        order_desc:   true,
        result_format: 'json',
        result_type:  'full',
      },
      result_format: 'json',
      result_type:   'full',
    }

    const res = await anacFetch('/api/v1/chart/data', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept:         'application/json',
        'X-CSRFToken':  csrf,
        Referer:        'https://dati.anticorruzione.it/superset/dashboard/appalti/',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        _csrf = null   // invalida CSRF
      }
      warn(`ANAC HTTP ${res.status}`)
      return null
    }

    const data = await res.json()
    const r0   = data?.result?.[0]
    if (r0?.error) {
      warn('Errore Dremio:', r0.error)
      return null
    }

    return { rows: r0?.data || [], total: r0?.rowcount || 0 }
  }

  // ── Invia dati all'app ─────────────────────────────────────────────────────

  async function sendToApp(key, rows, total) {
    await gmFetch(`${APP_URL}/api/anac-data`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key, rows, total, rowcount: total }),
    })
  }

  // ── Leggi richiesta corrente dall'app ──────────────────────────────────────

  async function fetchRequest() {
    try {
      const res = await gmFetch(`${APP_URL}/api/anac-request`)
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  // ── Loop principale ────────────────────────────────────────────────────────

  async function loop() {
    log(`▶ Loop avviato. App: ${APP_URL}`)
    while (_running) {
      try {
        const req = await fetchRequest()
        log(`Poll → req=${req ? req.key : 'nessuna'}, lastKey=${_lastKey}`)

        if (req && req.key && req.key !== _lastKey) {
          log('✦ Nuova richiesta:', req.key, 'params:', JSON.stringify(req.params || {}))
          _lastKey = req.key

          const result = await queryANAC(req.params || {})
          if (result) {
            await sendToApp(req.key, result.rows, result.total)
            log(`✓ Inviati ${result.rows.length} bandi (tot: ${result.total})`)
            _errors = 0
          } else {
            warn('✗ Query ANAC fallita')
            _errors++
            if (_errors >= 3) {
              _csrf = null   // reset CSRF dopo 3 errori consecutivi
              _errors = 0
            }
          }
        }
      } catch (err) {
        warn('Errore loop:', err.message)
      }

      await new Promise(r => setTimeout(r, POLL_MS))
    }
    log('Fermato.')
  }

  // ── Indicatore visivo ──────────────────────────────────────────────────────

  function addIndicator() {
    const div = document.createElement('div')
    div.id    = 'anac-relay-indicator'
    div.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:99999',
      'background:#1e293b', 'color:#34d399', 'font-family:monospace',
      'font-size:12px', 'padding:6px 12px', 'border-radius:20px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)', 'cursor:pointer',
      'user-select:none', 'display:flex', 'align-items:center', 'gap:6px',
    ].join(';')
    div.innerHTML = '<span style="animation:pulse 2s infinite">●</span> ANAC Relay attivo'
    div.title     = `Invia dati a: ${APP_URL}\nClicca per fermare`

    div.addEventListener('click', () => {
      _running = false
      div.style.color = '#f87171'
      div.innerHTML   = '● ANAC Relay fermato — ricarica per riavviare'
    })

    const style = document.createElement('style')
    style.textContent = `@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`
    document.head.appendChild(style)
    document.body.appendChild(div)
  }

  // ── Avvio ──────────────────────────────────────────────────────────────────

  // Esponi controlli globali per debug
  window._anacRelay = {
    stop:    () => { _running = false; log('Fermato manualmente') },
    restart: () => { _running = true; loop() },
    setApp:  (url) => { GM_setValue('anacAppUrl', url); log('App URL aggiornato:', url) },
    status:  () => ({ running: _running, lastKey: _lastKey, appUrl: APP_URL }),
  }

  if (document.body) {
    addIndicator()
    loop()
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      addIndicator()
      loop()
    })
  }
})()
