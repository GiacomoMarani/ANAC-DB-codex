// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex � https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * lib/hooks/use-anac-tenders.ts
 *
 * Hook React client-side per interrogare BDNCP ANAC in tempo reale.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ARCHITETTURA: Playwright Auto-Fetch (Soluzione automatica)     ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║                                                                  ║
 * ║  FLUSSO AUTOMATICO:                                             ║
 * ║  1. Hook chiama POST /api/anac-fetch-now {key, params}          ║
 * ║  2. Il server avvia Playwright (Chromium headless)              ║
 * ║  3. Playwright naviga su ANAC, ottiene CSRF, fa la query        ║
 * ║  4. I risultati vengono salvati in /api/anac-data               ║
 * ║  5. Hook polling su /api/anac-data?key= ogni 3s                 ║
 * ║  6. Quando i dati arrivano: mostra i bandi, stato "Live"        ║
 * ║                                                                  ║
 * ║  FALLBACK (se Playwright non disponibile / errore):             ║
 * ║  Mostra istruzioni per il console script manuale                ║
 * ║  (Soluzione 3 originale)                                        ║
 * ║                                                                  ║
 * ║  PERCHÉ PLAYWRIGHT BYPASSA IL WAF:                              ║
 * ║  Usa il vero motore Chromium → TLS fingerprint (JA3/JA4)        ║
 * ║  identico a Chrome reale → il WAF non può distinguerlo          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { AnacFetchParams }                       from "@/lib/sources/anac"
import type { NormalizedTender }                      from "@/lib/sources/types"

// ── Chiave deterministica per i params ───────────────────────────────────────

export function anacParamsKey(p: AnacFetchParams): string {
  const parts = [
    `p${p.page     ?? 0}`,
    `ps${p.pageSize ?? 10}`,
    p.q        ? `q=${encodeURIComponent(p.q).slice(0, 30)}`  : "",
    p.tipo     ? `t=${p.tipo}`      : "",
    p.importo  ? `i=${p.importo}`   : "",
    p.provincia ? `pr=${p.provincia}` : "",
    p.inCorso  ? "ic=1"             : "",
  ].filter(Boolean)
  return parts.join("|")
}

// ── Stato dell'hook ───────────────────────────────────────────────────────────

export interface AnacTendersState {
  items:         NormalizedTender[]
  total:         number
  isLoading:     boolean
  error:         string | null
  isLive:        boolean
  /** Quanti secondi fa i dati sono stati ricevuti */
  dataAge?:      number
  /** Se true, Playwright non è disponibile — mostra istruzioni manuali */
  needsManual:   boolean
  currentKey:    string
}

// ── Lettura dal data store ────────────────────────────────────────────────────

const DATA_MAX_AGE = 9 * 60  // considera stale dopo 9 minuti

async function readDataStore(
  key: string,
): Promise<{ items: NormalizedTender[]; total: number; age: number } | null> {
  try {
    const res = await fetch(`/api/anac-data?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(4_000),
    })
    if (res.status === 404) return null
    if (!res.ok)            return null

    const data = await res.json() as {
      items?:  NormalizedTender[]
      total?:  number
      age?:    number
      stale?:  boolean
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

// ── Trigger Playwright fetch ──────────────────────────────────────────────────

async function triggerPlaywrightFetch(
  key: string,
  params: AnacFetchParams,
): Promise<{ ok: boolean; queued?: boolean; fallback?: boolean }> {
  try {
    const res = await fetch("/api/anac-fetch-now", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ key, params }),
      signal:  AbortSignal.timeout(60_000),   // Playwright può richiedere fino a 60s
    })

    if (res.status === 202) return { ok: true, queued: true }   // già in volo

    const data = await res.json() as {
      ok?:       boolean
      queued?:   boolean
      fallback?: boolean
      error?:    string
    }

    if (!res.ok) {
      console.warn("[ANAC-HOOK] Playwright fetch failed:", data.error)
      return { ok: false, fallback: data.fallback ?? true }
    }

    return { ok: true }
  } catch (err) {
    console.warn("[ANAC-HOOK] Trigger error:", err)
    return { ok: false, fallback: true }
  }
}

// ── Hook principale ───────────────────────────────────────────────────────────

const POLL_INTERVAL = 3_000

export function useAnacTenders(
  params: AnacFetchParams,
): AnacTendersState & { refetch: () => void } {

  const key = anacParamsKey(params)

  const [state, setState] = useState<AnacTendersState>({
    items:       [],
    total:       0,
    isLoading:   params.pageSize !== 0,
    error:       null,
    isLive:      false,
    needsManual: false,
    currentKey:  key,
  })

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // ── Fetch completo (trigger + polling) ─────────────────────────────────────
  const doFetch = useCallback(async (k: string, p: AnacFetchParams) => {
    if (!mountedRef.current) return

    stopPolling()
    setState(s => ({
      ...s,
      isLoading:   true,
      error:       null,
      isLive:      false,
      needsManual: false,
      currentKey:  k,
    }))

    // 1. Controlla se ci sono già dati freschi nel store
    const cached = await readDataStore(k)
    if (cached && cached.age <= DATA_MAX_AGE) {
      if (!mountedRef.current) return
      stopPolling()
      setState(s => ({
        ...s,
        items:      cached.items,
        total:      cached.total,
        isLoading:  false,
        isLive:     true,
        dataAge:    cached.age,
        currentKey: k,
      }))
      return
    }

    // 2. Trigger Playwright fetch asincrono
    const trigger = await triggerPlaywrightFetch(k, p)
    if (!mountedRef.current) return

    if (trigger.fallback) {
      // Playwright non disponibile — mostra istruzioni manuali
      setState(s => ({
        ...s,
        isLoading:   false,
        needsManual: true,
        error:       null,
        currentKey:  k,
      }))

      // Pubblica i params per il console script manuale
      fetch("/api/anac-request", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ key: k, params: p }),
      }).catch(() => {/* non bloccante */})

      // Polling in attesa che il console script invii i dati
      pollRef.current = setInterval(async () => {
        const data = await readDataStore(k)
        if (data && mountedRef.current) {
          stopPolling()
          setState(s => ({
            ...s,
            items:       data.items,
            total:       data.total,
            isLoading:   false,
            isLive:      true,
            needsManual: false,
            dataAge:     data.age,
            currentKey:  k,
          }))
        }
      }, POLL_INTERVAL)

      return
    }

    // 3. Playwright triggerato — polling per i risultati
    pollRef.current = setInterval(async () => {
      const data = await readDataStore(k)
      if (data && mountedRef.current) {
        stopPolling()
        setState(s => ({
          ...s,
          items:      data.items,
          total:      data.total,
          isLoading:  false,
          isLive:     true,
          needsManual: false,
          dataAge:    data.age,
          currentKey: k,
        }))
      }
    }, POLL_INTERVAL)

    // Timeout: 90s senza dati
    setTimeout(() => {
      if (!pollRef.current) return   // già risolto
      stopPolling()
      if (!mountedRef.current) return
      setState(s => ({
        ...s,
        isLoading:   false,
        needsManual: true,   // fallback al console script
        error:       "Timeout automatico — usa il relay manuale come alternativa.",
        currentKey:  k,
      }))
    }, 90_000)

  }, [stopPolling])

  // ── Effect: nuovi params ────────────────────────────────────────────────────
  const prevKeyRef = useRef<string>("")

  useEffect(() => {
    if (params.pageSize === 0) { stopPolling(); return }
    if (key === prevKeyRef.current) return
    prevKeyRef.current = key
    doFetch(key, params)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, params.pageSize])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])

  const refetch = useCallback(() => {
    setState(s => ({ ...s, items: [], total: 0, isLive: false, error: null, needsManual: false }))
    doFetch(key, params)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, params, doFetch])

  return { ...state, refetch }
}
