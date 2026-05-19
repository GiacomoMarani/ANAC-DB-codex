/**
 * lib/hooks/use-anac-tenders.ts
 *
 * Hook React client-side per interrogare BDNCP ANAC in tempo reale.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ARCHITETTURA: Console Script Relay (Soluzione 3)               ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║                                                                  ║
 * ║  Il WAF F5 di ANAC blocca le chiamate server-to-server.          ║
 * ║  CORS blocca le chiamate browser cross-origin da localhost.      ║
 * ║                                                                  ║
 * ║  SOLUZIONE: il console script su dati.anticorruzione.it fa        ║
 * ║  le chiamate API (same-origin) e invia i dati JSON all'app.     ║
 * ║                                                                  ║
 * ║  FLUSSO:                                                         ║
 * ║  1. L'hook pubblica la "richiesta" corrente (filtri + pagina)   ║
 * ║     in /api/anac-request (GET-polling dal console script).       ║
 * ║  2. Il console script (sempre in esecuzione su ANAC) legge la   ║
 * ║     richiesta ogni 2s, fa la query ANAC, invia i dati a          ║
 * ║     POST /api/anac-data.                                         ║
 * ║  3. L'hook legge i dati da GET /api/anac-data?key=...            ║
 * ║                                                                  ║
 * ║  SEMPLIFICATO (per il primo avvio):                              ║
 * ║  Il console script viene eseguito manualmente ONCE dall'utente   ║
 * ║  e rimane in loop, aggiornando i dati ogni volta che l'hook      ║
 * ║  cambia i parametri.                                             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { AnacFetchParams }                       from "@/lib/sources/anac"
import type { NormalizedTender }                      from "@/lib/sources/types"

// ── Chiave deterministica per i params ───────────────────────────────────────

export function anacParamsKey(p: AnacFetchParams): string {
  const parts = [
    `p${p.page ?? 0}`,
    `ps${p.pageSize ?? 10}`,
    p.q        ? `q=${encodeURIComponent(p.q).slice(0, 30)}`  : "",
    p.tipo     ? `t=${p.tipo}`     : "",
    p.importo  ? `i=${p.importo}`  : "",
    p.provincia ? `pr=${p.provincia}` : "",
    p.inCorso  ? "ic=1" : "",
  ].filter(Boolean)
  return parts.join("|")
}

// ── Stato dell'hook ───────────────────────────────────────────────────────────

export interface AnacTendersState {
  items:      NormalizedTender[]
  total:      number
  isLoading:  boolean
  error:      string | null
  isLive:     boolean
  /** Quanti secondi fa i dati sono stati ricevuti dal console script */
  dataAge?:   number
  /** La chiave params corrente — usata dal console script per sapere cosa fetchare */
  currentKey: string
}

// ── Polling del data-store ────────────────────────────────────────────────────

const POLL_INTERVAL = 3_000   // ogni 3s controlla se ci sono dati freschi
const DATA_MAX_AGE  = 9 * 60  // considera stale i dati > 9 minuti

async function fetchCachedData(
  key: string,
): Promise<{ items: NormalizedTender[]; total: number; age: number } | null> {
  try {
    const res = await fetch(`/api/anac-data?key=${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json" },
      signal:  AbortSignal.timeout(4_000),
    })
    if (res.status === 404) return null   // nessun dato per questa key
    if (!res.ok)            return null

    const data = await res.json() as {
      items?:   NormalizedTender[]
      total?:   number
      age?:     number
      stale?:   boolean
    }

    if (data.stale || !data.items?.length) return null

    return {
      items: data.items,
      total: data.total ?? data.items.length,
      age:   data.age   ?? 0,
    }
  } catch {
    return null
  }
}

// ── Hook principale ───────────────────────────────────────────────────────────

export function useAnacTenders(
  params: AnacFetchParams,
): AnacTendersState & { refetch: () => void } {

  const key = anacParamsKey(params)

  const [state, setState] = useState<AnacTendersState>({
    items:      [],
    total:      0,
    isLoading:  params.pageSize !== 0,
    error:      null,
    isLive:     false,
    currentKey: key,
  })

  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const checkData = useCallback(async (k: string, isRetry = false) => {
    if (!mountedRef.current) return

    const cached = await fetchCachedData(k)

    if (!mountedRef.current) return

    if (cached && cached.age <= DATA_MAX_AGE) {
      // Dati trovati e freschi
      stopPolling()
      setState(s => ({
        ...s,
        items:      cached.items,
        total:      cached.total,
        isLoading:  false,
        error:      null,
        isLive:     true,
        dataAge:    cached.age,
        currentKey: k,
      }))
    } else if (isRetry) {
      // Siamo in polling — nessun dato ancora, mantieni lo spinner
      if (!state.isLive) {
        setState(s => ({
          ...s,
          isLoading:  true,
          error:      null,
          currentKey: k,
        }))
      }
    }
  }, [state.isLive, stopPolling])

  const startPolling = useCallback((k: string, p: AnacFetchParams) => {
    stopPolling()
    setState(s => ({ ...s, isLoading: true, error: null, isLive: false, currentKey: k }))

    // Pubblica i params correnti così il console script sa cosa fetchare
    fetch("/api/anac-request", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ key: k, params: p }),
    }).catch(() => {/* non bloccante */})

    // Check immediato
    checkData(k, false)

    // Poi polling ogni 3s
    pollRef.current = setInterval(() => checkData(k, true), POLL_INTERVAL)

    // Timeout dopo 90s senza dati
    setTimeout(() => {
      if (pollRef.current) {
        stopPolling()
        setState(s => {
          if (!s.isLive) {
            return {
              ...s,
              isLoading: false,
              error:     "Nessun dato ricevuto in 90 secondi. Esegui il console script su dati.anticorruzione.it.",
              currentKey: k,
            }
          }
          return s
        })
      }
    }, 90_000)
  }, [checkData, stopPolling])

  // Quando i params cambiano — reset e riparti
  const prevKeyRef = useRef<string>("")

  useEffect(() => {
    if (params.pageSize === 0) {
      stopPolling()
      return
    }

    if (key === prevKeyRef.current) return
    prevKeyRef.current = key

    startPolling(key, params)
  }, [key, params.pageSize, startPolling, stopPolling])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])

  const refetch = useCallback(() => {
    setState(s => ({ ...s, items: [], total: 0, isLive: false, error: null }))
    startPolling(key, params)
  }, [key, params, startPolling])

  return { ...state, refetch }
}
