import { Card, CardContent } from "@/components/ui/card"
import { FileText, CheckCircle, Euro } from "lucide-react"

interface StatsCardsProps {
  stats: {
    total: number
    active: number
  }
  totalImporto?: number
  filteredCount?: number
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)} Mld`
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} Mln`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)} K`
  }
  return value.toFixed(2)
}

export function StatsCards({ stats, totalImporto = 0, filteredCount }: StatsCardsProps) {
  const showFiltered = filteredCount !== undefined && filteredCount !== stats.total

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-lg">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {showFiltered ? "Risultati filtrati" : "CIG Totali"}
              </p>
              <p className="text-2xl font-bold">
                {showFiltered 
                  ? filteredCount.toLocaleString("it-IT")
                  : stats.total.toLocaleString("it-IT")
                }
              </p>
              {showFiltered && (
                <p className="text-xs text-muted-foreground">
                  su {stats.total.toLocaleString("it-IT")} totali
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">CIG Attivi (totali)</p>
              <p className="text-2xl font-bold">{stats.active.toLocaleString("it-IT")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 rounded-lg">
              <Euro className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Importo (pagina)</p>
              <p className="text-2xl font-bold">{formatCurrency(totalImporto)} EUR</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
