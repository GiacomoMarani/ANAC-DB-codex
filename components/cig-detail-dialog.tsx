"use client"

import React from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ExternalLink } from "lucide-react"

interface CigRecord {
  id: number
  cig: string
  oggetto_gara?: string | null
  importo_lotto: number | null
  oggetto_principale_contratto: string | null
  stato: string | null
  provincia: string | null
  data_pubblicazione: string | null
  data_scadenza_offerta?: string | null
  sezione_regionale?: string | null
  descrizione_cpv?: string | null
  esito?: string | null
  [key: string]: unknown
}

interface CigDetailDialogProps {
  cig: CigRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-"
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value)
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-"
  return new Date(dateString).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm col-span-2 font-medium">{value || "-"}</dd>
    </div>
  )
}

export function CigDetailDialog({ cig, open, onOpenChange }: CigDetailDialogProps) {
  if (!cig) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono">{cig.cig}</span>
            <Badge variant={cig.stato === "ATTIVO" ? "default" : cig.stato === "CANCELLATO" ? "destructive" : "secondary"}>
              {cig.stato || "N/D"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <h3 className="font-semibold mb-2">Oggetto della Gara</h3>
            <p className="text-sm text-muted-foreground">{cig.oggetto_gara || "-"}</p>
          </div>

          <Separator />

          <div>
            <h3 className="font-semibold mb-3">Informazioni Generali</h3>
            <dl className="divide-y">
              <DetailRow label="Importo Lotto" value={formatCurrency(cig.importo_lotto)} />
              <DetailRow label="Tipo Contratto" value={cig.oggetto_principale_contratto} />
              <DetailRow label="Provincia" value={cig.provincia} />
              <DetailRow label="Sezione Regionale" value={cig.sezione_regionale} />
              <DetailRow label="Classificazione CPV" value={cig.descrizione_cpv} />
            </dl>
          </div>

          <Separator />

          <div>
            <h3 className="font-semibold mb-3">Date</h3>
            <dl className="divide-y">
              <DetailRow label="Pubblicazione" value={formatDate(cig.data_pubblicazione)} />
              <DetailRow label="Scadenza Offerta" value={formatDate(cig.data_scadenza_offerta)} />
            </dl>
          </div>

          <Separator />

          {cig.esito && (
            <>
              <Separator />
              <div>
                <h3 className="font-semibold mb-3">Esito</h3>
                <Badge variant={cig.esito === "AGGIUDICATA" ? "default" : "secondary"}>
                  {cig.esito}
                </Badge>
                <p className="text-xs text-muted-foreground mt-2">
                  Comunicato il {formatDate(cig.data_comunicazione_esito)}
                </p>
              </div>
            </>
          )}

          <Separator />

          <div className="flex justify-end">
            <a
              href={`https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=${cig.cig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              Visualizza su ANAC
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
