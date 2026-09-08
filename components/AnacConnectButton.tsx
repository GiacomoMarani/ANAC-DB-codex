// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
"use client"

/**
 * components/AnacConnectButton.tsx
 *
 * Bottone per connettere/disconnettere il relay ANAC Superset.
 * Quando connesso, il profiling ottiene dati live con CPV, oggetto gara,
 * stazione appaltante e provincia direttamente da ANAC.
 */

import { useState, useEffect, useCallback } from "react"
import {
  ExternalLink, Wifi, WifiOff, Copy, Check, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"

const ANAC_URL = "https://dati.anticorruzione.it/superset/dashboard/appalti/"

/**
 * Hook per gestire lo stato del relay ANAC via postMessage.
 */
export function useAnacRelay() {
  const [connected, setConnected] = useState(false)
  const [anacWindow, setAnacWindow] = useState<Window | null>(null)
  const [pendingCallbacks] = useState(
    () => new Map<string, (data: unknown) => void>()
  )

  // Ascolta messaggi dal relay
  useEffect(() => {
    function handleMessage(ev: MessageEvent) {
      const msg = ev.data
      if (!msg || typeof msg !== "object") return

      if (msg.type === "anac-profiling-ready") {
        setConnected(true)
      }
      if (msg.type === "anac-profiling-pong") {
        // relay vivo
      }
      if (msg.type === "anac-profiling-result" && msg.id) {
        const cb = pendingCallbacks.get(msg.id)
        if (cb) {
          pendingCallbacks.delete(msg.id)
          cb(msg.data)
        }
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [pendingCallbacks])

  // Controlla periodicamente se la finestra è stata chiusa
  useEffect(() => {
    if (!anacWindow) return
    const interval = setInterval(() => {
      if (anacWindow.closed) {
        setConnected(false)
        setAnacWindow(null)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [anacWindow])

  const connect = useCallback(() => {
    if (anacWindow && !anacWindow.closed) {
      anacWindow.focus()
      return
    }
    const w = window.open(
      ANAC_URL,
      "anac-relay",
      "width=900,height=600,menubar=no,toolbar=no,location=yes,status=no"
    )
    if (w) setAnacWindow(w)
  }, [anacWindow])

  const disconnect = useCallback(() => {
    if (anacWindow && !anacWindow.closed) {
      anacWindow.close()
    }
    setAnacWindow(null)
    setConnected(false)
  }, [anacWindow])

  const query = useCallback(
    async (piva: string): Promise<{
      rows: Array<Record<string, unknown>>
      total: number
      error?: string
    }> => {
      if (!connected || !anacWindow || anacWindow.closed) {
        throw new Error("ANAC relay non connesso")
      }

      const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingCallbacks.delete(id)
          reject(new Error("ANAC query timeout (15s)"))
        }, 15_000)

        pendingCallbacks.set(id, (data) => {
          clearTimeout(timer)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          resolve(data as any)
        })

        anacWindow.postMessage(
          { type: "anac-profiling-query", piva, id },
          "*"
        )
      })
    },
    [connected, anacWindow, pendingCallbacks]
  )

  return { connected, connect, disconnect, query }
}

/**
 * Componente bottone + popover con istruzioni per il bookmarklet.
 */
export function AnacConnectButton({
  connected,
  onConnect,
  onDisconnect,
}: {
  connected: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  const [scriptCopied, setScriptCopied] = useState(false)
  const [open, setOpen] = useState(false)

  const bookmarkletScript = `javascript:void(fetch('${typeof window !== "undefined" ? window.location.origin : ""}/api/anac-relay-script').then(r=>r.text()).then(eval))`

  const handleCopyScript = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletScript)
      setScriptCopied(true)
      setTimeout(() => setScriptCopied(false), 2000)
    } catch {
      // fallback
    }
  }, [bookmarkletScript])

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          ANAC Live
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-rose-500"
          onClick={onDisconnect}
        >
          <WifiOff className="h-3 w-3 mr-1" />
          Disconnetti
        </Button>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
        >
          <Wifi className="h-3.5 w-3.5" />
          Connetti ANAC Live
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end">
        <div className="p-4 space-y-3">
          <div>
            <h4 className="text-sm font-semibold mb-1">
              🔗 Connessione diretta ANAC
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Collegati alla banca dati ANAC per ottenere dati completi:
              CPV, oggetto gara, stazione appaltante e provincia.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Passo 1: Apri ANAC
            </p>
            <Button
              size="sm"
              className="w-full h-9 text-xs gap-2"
              onClick={() => {
                onConnect()
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Apri Dashboard ANAC
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Passo 2: Incolla nella console (F12)
            </p>
            <div className="relative">
              <pre className="text-[10px] font-mono bg-muted/50 border rounded-lg p-2.5 pr-10 overflow-x-auto whitespace-pre-wrap break-all max-h-[80px] text-muted-foreground">
                {bookmarkletScript}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-1.5 right-1.5 h-7 w-7 p-0"
                onClick={handleCopyScript}
              >
                {scriptCopied
                  ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                  : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Premi <kbd className="px-1 py-0.5 rounded bg-muted border text-[9px] font-mono">F12</kbd> sulla
              pagina ANAC → tab <strong>Console</strong> → incolla → <kbd className="px-1 py-0.5 rounded bg-muted border text-[9px] font-mono">Invio</kbd>
            </p>
          </div>

          <div className="pt-1 border-t">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              In attesa di connessione dal relay ANAC...
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
