"use client"

import { useRouter, useSearchParams } from "next/navigation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronLeft, ChevronRight, ExternalLink, FileText } from "lucide-react"
import { useState } from "react"
import { CigDetailDialog } from "./cig-detail-dialog"

interface CigRecord {
  id: number
  cig: string
  oggetto_gara: string | null
  importo_lotto: number | null
  stato: string | null
  provincia: string | null
  data_pubblicazione: string | null
  data_scadenza_offerta: string | null
  oggetto_principale_contratto: string | null
  descrizione_cpv: string | null
  esito: string | null
  [key: string]: unknown
}

interface CigTableProps {
  data: CigRecord[]
  totalCount: number
  currentPage: number
  totalPages: number
}

function formatCurrency(value: number | null): string {
  if (value === null) return "-"
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value)
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "-"
  return new Date(dateString).toLocaleDateString("it-IT")
}

function getStatoBadgeVariant(stato: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (stato) {
    case "ATTIVO":
      return "default"
    case "CONCLUSO":
      return "secondary"
    case "CANCELLATO":
      return "destructive"
    default:
      return "outline"
  }
}

export function CigTable({ data, totalCount, currentPage, totalPages }: CigTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedCig, setSelectedCig] = useState<CigRecord | null>(null)

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    router.push(`?${params.toString()}`)
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Nessun CIG trovato</p>
            <p className="text-sm mt-1">
              Prova a modificare i filtri di ricerca o importa nuovi dati
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">
            Risultati ({totalCount.toLocaleString("it-IT")} CIG)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">CIG</TableHead>
                  <TableHead className="min-w-[300px]">Oggetto Gara</TableHead>
                  <TableHead className="text-right">Importo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Provincia</TableHead>
                  <TableHead>Pubblicazione</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow 
                    key={row.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedCig(row)}
                  >
                    <TableCell className="font-mono text-sm">
                      <a
                        href={`https://dati.anticorruzione.it/superset/dashboard/dettaglio_cig/?cig=${row.cig}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.cig}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[400px] truncate" title={row.oggetto_gara || ""}>
                        {row.oggetto_gara || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(row.importo_lotto)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatoBadgeVariant(row.stato)}>
                        {row.stato || "N/D"}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.provincia || "-"}</TableCell>
                    <TableCell>{formatDate(row.data_pubblicazione)}</TableCell>
                    <TableCell>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedCig(row)
                        }}
                      >
                        Dettagli
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Pagina {currentPage} di {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Precedente
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  Successiva
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CigDetailDialog 
        cig={selectedCig} 
        open={!!selectedCig} 
        onOpenChange={(open) => !open && setSelectedCig(null)} 
      />
    </>
  )
}
