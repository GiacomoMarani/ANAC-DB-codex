"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { RefreshCw, Upload, FileJson, CheckCircle2, AlertCircle } from "lucide-react"
import Link from "next/link"
import { isActiveTender } from "@/lib/utils/tenderLogic"
import { SiteNav } from "@/components/site-nav"

interface SyncResult {
  totalImported: number
  totalSkipped: number
  totalErrors: number
  results: Array<{
    month: string
    source?: string
    imported: number
    skipped: number
    errors: number
    errorMessages?: string[]
  }>
}

interface ImportResult {
  total: number
  imported: number
  errors: number
  errorMessages: string[]
}

export default function ImportPage() {
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncMonths, setSyncMonths] = useState(3)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return

    const file = acceptedFiles[0]
    setIsUploading(true)
    setProgress(0)
    setResult(null)
    setError(null)

    try {
      const text = await file.text()
      const lines = text.trim().split("\n")
      
      // Parse JSON Lines format (each line is a JSON object)
      const records: Record<string, unknown>[] = []
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line)
            if (isActiveTender(parsed)) {
              records.push(parsed)
            }
          } catch {
            console.error("Failed to parse line:", line.substring(0, 100))
          }
        }
      }

      if (records.length === 0) {
        setError("Nessun record valido trovato nel file")
        setIsUploading(false)
        return
      }

      // Process in very small batches to avoid timeouts
      const batchSize = 20
      let imported = 0
      let errors = 0
      const errorMessages: string[] = []

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize)
        
        try {
          const response = await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ records: batch }),
          })

          const data = await response.json()

          if (response.ok) {
            imported += data.imported
            errors += data.errors
            if (data.errorMessages) {
              errorMessages.push(...data.errorMessages.slice(0, 5))
            }
          } else {
            errors += batch.length
            errorMessages.push(data.error || "Errore sconosciuto")
          }
        } catch (fetchError) {
          errors += batch.length
          errorMessages.push(`Network error: ${fetchError instanceof Error ? fetchError.message : "unknown"}`)
        }

        setProgress(Math.round(((i + batch.length) / records.length) * 100))
        
        // Add delay between batches to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      setResult({
        total: records.length,
        imported,
        errors,
        errorMessages: errorMessages.slice(0, 10),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante l'importazione")
    } finally {
      setIsUploading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/json": [".json"],
    },
    multiple: false,
    disabled: isUploading,
  })

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncResult(null)
    setSyncError(null)
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: getRecentMonthsList(syncMonths) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Errore sincronizzazione")
      setSyncResult(data)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Errore sconosciuto")
    } finally {
      setIsSyncing(false)
    }
  }

  function getRecentMonthsList(count: number): string[] {
    const months: string[] = []
    const now = new Date()
    // Start from last month — ANAC publishes each month's file on the 2nd of the next month
    for (let i = 1; i <= count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
    }
    return months
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteNav variant="gare" />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Link href="/gare" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Torna alla consultazione
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Importa Dati ANAC</CardTitle>
            <CardDescription>
              Carica un file JSON scaricato dal dataset ANAC. Il file deve essere in formato JSON Lines 
              (un oggetto JSON per riga).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
                ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
                ${isUploading ? "pointer-events-none opacity-50" : ""}
              `}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-4">
                {isDragActive ? (
                  <>
                    <Upload className="h-12 w-12 text-primary" />
                    <p className="text-lg font-medium">Rilascia il file qui</p>
                  </>
                ) : (
                  <>
                    <FileJson className="h-12 w-12 text-muted-foreground" />
                    <div>
                      <p className="text-lg font-medium">Trascina qui il file JSON</p>
                      <p className="text-sm text-muted-foreground mt-1">oppure clicca per selezionarlo</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {isUploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Importazione in corso...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Errore</p>
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 bg-primary/10 text-primary rounded-lg">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Importazione completata</p>
                    <p className="text-sm">
                      {result.imported} record importati su {result.total} totali
                      {result.errors > 0 && ` (${result.errors} errori)`}
                    </p>
                  </div>
                </div>

                {result.errorMessages.length > 0 && (
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="font-medium text-sm mb-2">Primi errori riscontrati:</p>
                    <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">
                      {result.errorMessages.map((msg, i) => (
                        <li key={i}>{msg}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button asChild className="w-full">
                  <Link href="/gare">Vai alla consultazione</Link>
                </Button>
              </div>
            )}

            <div className="text-xs text-muted-foreground space-y-2">
              <p className="font-medium">Formato supportato:</p>
              <p>
                File JSON Lines (.json) con un oggetto CIG per riga, come scaricato da{" "}
                <a 
                  href="https://dati.anticorruzione.it/opendata/ocds_it" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  dati.anticorruzione.it
                </a>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ANAC API Sync Card */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Sincronizza da API ANAC
            </CardTitle>
            <CardDescription>
              Scarica automaticamente i dati aggiornati dal portale ufficiale ANAC (solo gare attive).
              Il cron job giornaliero aggiorna il mese corrente ogni notte alle 03:00 UTC.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium whitespace-nowrap">Mesi da sincronizzare:</label>
              <select
                className="border rounded px-2 py-1 text-sm bg-background"
                value={syncMonths}
                onChange={(e) => setSyncMonths(Number(e.target.value))}
                disabled={isSyncing}
              >
                <option value={1}>Mese corrente</option>
                <option value={3}>Ultimi 3 mesi</option>
                <option value={6}>Ultimi 6 mesi</option>
                <option value={12}>Ultimo anno</option>
              </select>
            </div>

            <Button
              onClick={handleSync}
              disabled={isSyncing}
              className="w-full"
              variant="outline"
            >
              {isSyncing ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Sincronizzazione in corso...</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" />Avvia Sincronizzazione</>  
              )}
            </Button>

            {syncError && (
              <div className="flex items-start gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Errore</p>
                  <p className="text-sm">{syncError}</p>
                </div>
              </div>
            )}

            {syncResult && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-primary/10 text-primary rounded-lg">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Sincronizzazione completata</p>
                    <p className="text-sm">
                      {syncResult.totalImported} importati · {syncResult.totalSkipped} scartati · {syncResult.totalErrors} errori
                    </p>
                  </div>
                </div>
                <div className="bg-muted rounded-lg p-3 text-xs space-y-2">
                  {syncResult.results.map((r) => (
                    <div key={r.month}>
                      <div className="flex justify-between text-muted-foreground">
                        <span className="font-mono">{r.month}</span>
                        <span>✅ {r.imported} · ⏭ {r.skipped} · ❌ {r.errors}</span>
                      </div>
                      {r.errorMessages && r.errorMessages.length > 0 && (
                        <ul className="mt-1 pl-3 text-destructive space-y-0.5">
                          {r.errorMessages.map((msg, i) => (
                            <li key={i} className="break-all">⚠ {msg}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                <Button asChild className="w-full">
                  <Link href="/gare">Vai alla consultazione</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}

