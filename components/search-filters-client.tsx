"use client"

import React, { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Search, X, Filter, Loader2 } from "lucide-react"

interface SearchFiltersProps {
  filterOptions: {
    province: string[]
    anni: number[]
  }
  currentFilters: {
    q?: string
    provincia?: string
    stato?: string
    tipo_contratto?: string
    anno?: string
    importo_min?: string
    importo_max?: string
  }
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  onFilterChange: (updates: Record<string, string | undefined>) => void
  onClearFilters: () => void
  isPending: boolean
}

const STATI = ["ATTIVO", "CANCELLATO", "CONCLUSO"]
const TIPI_CONTRATTO = ["LAVORI", "SERVIZI", "FORNITURE"]

export function SearchFilters({ 
  filterOptions, 
  currentFilters, 
  onSearchChange,
  onSearchSubmit,
  onFilterChange,
  onClearFilters,
  isPending 
}: SearchFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(currentFilters.importo_min || currentFilters.importo_max || currentFilters.tipo_contratto)
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    onSearchSubmit()
  }

  const hasFilters = Boolean(
    currentFilters.q ||
    currentFilters.provincia ||
    currentFilters.stato ||
    currentFilters.tipo_contratto ||
    currentFilters.anno ||
    currentFilters.importo_min ||
    currentFilters.importo_max
  )

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cerca per CIG o oggetto gara..."
              value={currentFilters.q || ""}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cerca"}
          </Button>
        </form>

        <div className="flex flex-wrap gap-3">
          <Select
            value={currentFilters.provincia || "all"}
            onValueChange={(value) => onFilterChange({ provincia: value === "all" ? undefined : value })}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Provincia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le province</SelectItem>
              {filterOptions.province.map((prov) => (
                <SelectItem key={prov} value={prov}>
                  {prov}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={currentFilters.stato || "all"}
            onValueChange={(value) => onFilterChange({ stato: value === "all" ? undefined : value })}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Stato" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              {STATI.map((stato) => (
                <SelectItem key={stato} value={stato}>
                  {stato}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={currentFilters.anno || "all"}
            onValueChange={(value) => onFilterChange({ anno: value === "all" ? undefined : value })}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Anno" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli anni</SelectItem>
              {filterOptions.anni.map((anno) => (
                <SelectItem key={anno} value={String(anno)}>
                  {anno}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filtri avanzati
          </Button>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="gap-2">
              <X className="h-4 w-4" />
              Pulisci filtri
            </Button>
          )}

          {isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Caricamento...
            </div>
          )}
        </div>

        {showAdvanced && (
          <div className="flex flex-wrap gap-3 pt-2 border-t">
            <Select
              value={currentFilters.tipo_contratto || "all"}
              onValueChange={(value) => onFilterChange({ tipo_contratto: value === "all" ? undefined : value })}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tipo contratto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tipi</SelectItem>
                {TIPI_CONTRATTO.map((tipo) => (
                  <SelectItem key={tipo} value={tipo}>
                    {tipo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Importo:</span>
              <Input
                type="number"
                placeholder="Min"
                value={currentFilters.importo_min || ""}
                onChange={(e) => onFilterChange({ importo_min: e.target.value || undefined })}
                className="w-[120px]"
              />
              <span className="text-muted-foreground">-</span>
              <Input
                type="number"
                placeholder="Max"
                value={currentFilters.importo_max || ""}
                onChange={(e) => onFilterChange({ importo_max: e.target.value || undefined })}
                className="w-[120px]"
              />
              <span className="text-sm text-muted-foreground">EUR</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
