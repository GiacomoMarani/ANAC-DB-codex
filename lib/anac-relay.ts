// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/anac-relay.ts
 *
 * Client-side bridge per comunicare con il relay ANAC via postMessage.
 *
 * Uso:
 *   const relay = AnacRelay.getInstance();
 *   relay.connect();                       // apre popup ANAC
 *   const data = await relay.query(piva);  // query P.IVA
 *   relay.isConnected();                   // stato
 */

export interface AnacProfilingRecord {
  cig: string;
  cod_cpv: string | null;
  oggetto_bando: string | null;
  importo_aggiudicazione: number | null;
  data_aggiudicazione_definitiva: string | null;
  denominazione_partecipante: string | null;
  denominazione_amministrazione_appaltante: string | null;
  provincia: string | null;
  oggetto_principale_contratto: string | null;
  partecipante_ruolo: string | null;
  importo_lotto: number | null;
  sezione_regionale: string | null;
  settore: string | null;
  flag_pnrr_pnc: string | null;
}

export interface AnacQueryResult {
  rows: AnacProfilingRecord[];
  total: number;
  error?: string;
}

type QueryCallback = (result: AnacQueryResult) => void;

const ANAC_DASHBOARD_URL =
  'https://dati.anticorruzione.it/superset/dashboard/appalti/';

/** Timeout per una query (ms) */
const QUERY_TIMEOUT = 15_000;

/** Intervallo ping per verificare che il relay sia vivo (ms) */
const PING_INTERVAL = 30_000;

/**
 * Singleton bridge per comunicare con la finestra ANAC relay.
 *
 * Pattern:
 * 1. connect() → apre popup ANAC
 * 2. L'utente incolla il bookmarklet nella console
 * 3. Il bookmarklet manda postMessage("anac-profiling-ready")
 * 4. query(piva) manda postMessage("anac-profiling-query")
 * 5. Il bookmarklet risponde con postMessage("anac-profiling-result")
 */
export class AnacRelay {
  private static instance: AnacRelay | null = null;

  private anacWindow: Window | null = null;
  private connected = false;
  private pendingQueries = new Map<string, QueryCallback>();
  private listeners: Array<(connected: boolean) => void> = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleMessage);
    }
  }

  static getInstance(): AnacRelay {
    if (!AnacRelay.instance) {
      AnacRelay.instance = new AnacRelay();
    }
    return AnacRelay.instance;
  }

  /** Apre la finestra ANAC Superset in un popup */
  connect(): void {
    // Se c'è già una finestra aperta e non è chiusa, prova a riattivarla
    if (this.anacWindow && !this.anacWindow.closed) {
      this.anacWindow.focus();
      return;
    }

    this.anacWindow = window.open(
      ANAC_DASHBOARD_URL,
      'anac-relay',
      'width=800,height=600,menubar=no,toolbar=no,location=yes,status=no'
    );

    if (!this.anacWindow) {
      console.warn(
        '[AnacRelay] Popup bloccato dal browser. Disabilita il blocco popup per dati.anticorruzione.it'
      );
    }
  }

  /** Disconnetti e chiudi la finestra ANAC */
  disconnect(): void {
    if (this.anacWindow && !this.anacWindow.closed) {
      this.anacWindow.close();
    }
    this.anacWindow = null;
    this.setConnected(false);
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Stato di connessione */
  isConnected(): boolean {
    // Controlla anche che la finestra sia ancora aperta
    if (this.connected && this.anacWindow?.closed) {
      this.setConnected(false);
    }
    return this.connected;
  }

  /** Registra un listener per cambi di stato */
  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /**
   * Query ANAC per P.IVA/CF.
   * Ritorna i record di aggiudicazione completi (CPV, oggetto, SA, provincia).
   * Rejects se non connesso o timeout.
   */
  async query(piva: string): Promise<AnacQueryResult> {
    if (!this.isConnected()) {
      throw new Error('ANAC relay non connesso');
    }

    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<AnacQueryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingQueries.delete(id);
        reject(new Error('ANAC query timeout'));
      }, QUERY_TIMEOUT);

      this.pendingQueries.set(id, (result) => {
        clearTimeout(timer);
        this.pendingQueries.delete(id);
        resolve(result);
      });

      // Invia la richiesta al relay
      this.anacWindow?.postMessage(
        { type: 'anac-profiling-query', piva, id },
        '*'
      );
    });
  }

  /** Genera il testo del bookmarklet da mostrare all'utente */
  getBookmarkletCode(): string {
    // Importa dalla versione mini del relay script
    // In produzione questo sarà generato dal build
    return `javascript:void(fetch('${window.location.origin}/api/anac-relay-script').then(r=>r.text()).then(eval))`;
  }

  /** Cleanup */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.handleMessage);
    }
    this.disconnect();
    AnacRelay.instance = null;
  }

  // ── Private ───────────────────────────────────────────────────

  private handleMessage = (ev: MessageEvent): void => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'anac-profiling-ready':
        console.log('[AnacRelay] Relay ANAC connesso ✅');
        this.setConnected(true);
        this.startPingLoop();
        break;

      case 'anac-profiling-result': {
        const cb = this.pendingQueries.get(msg.id);
        if (cb) {
          cb(msg.data as AnacQueryResult);
        }
        break;
      }

      case 'anac-profiling-pong':
        // Relay è ancora vivo
        break;
    }
  };

  private setConnected(value: boolean): void {
    if (this.connected !== value) {
      this.connected = value;
      for (const cb of this.listeners) {
        try { cb(value); } catch { /* ignore */ }
      }
    }
  }

  private startPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);

    this.pingTimer = setInterval(() => {
      if (this.anacWindow?.closed) {
        this.setConnected(false);
        if (this.pingTimer) clearInterval(this.pingTimer);
        return;
      }
      // Ping il relay per verificare che sia ancora attivo
      this.anacWindow?.postMessage({ type: 'anac-profiling-ping' }, '*');
    }, PING_INTERVAL);
  }
}
