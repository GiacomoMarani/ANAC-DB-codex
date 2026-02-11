"use client"

import React from "react"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useState, useTransition } from "react"
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
import { Search, X, Filter } from "lucide-react"

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
}

const STATI = ["ATTIVO", "CANCELLATO", "CONCLUSO"]
const TIPI_CONTRATTO = ["LAVORI", "SERVIZI", "FORNITURE"]

export function SearchFilters({ filterOptions, currentFilters }: SearchFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(currentFilters.importo_min || currentFilters.importo_max || currentFilters.tipo_contratto)
  )

  const [localSearch, setLocalSearch] = useState(currentFilters.q || "")

  const updateFilters = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString())
      
      // Reset page when filters change
      params.delete("page")

      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }

      startTransition(() => {
        router.push(`?${params.toString()}`)
      })
    },
    [router, searchParams]
  )

  const clearFilters = useCallback(() => {
    setLocalSearch("")
    startTransition(() => {
      router.push("/")
    })
  }, [router])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilters({ q: localSearch || undefined })
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
              placeholder="Cerca per CIG, oggetto gara o ente appaltante..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={isPending}>
            Cerca
          </Button>
        </form>

        <div className="flex flex-wrap gap-3">
          <Select
            value={currentFilters.provincia || "all"}
            onValueChange={(value) => updateFilters({ provincia: value === "all" ? undefined : value })}
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
            onValueChange={(value) => updateFilters({ stato: value === "all" ? undefined : value })}
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
            onValueChange={(value) => updateFilters({ anno: value === "all" ? undefined : value })}
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
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-2">
              <X className="h-4 w-4" />
              Pulisci filtri
            </Button>
          )}
        </div>

        {showAdvanced && (
          <div className="flex flex-wrap gap-3 pt-2 border-t">
            <Select
              value={currentFilters.tipo_contratto || "all"}
              onValueChange={(value) => updateFilters({ tipo_contratto: value === "all" ? undefined : value })}
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
                onChange={(e) => updateFilters({ importo_min: e.target.value || undefined })}
                className="w-[120px]"
              />
              <span className="text-muted-foreground">-</span>
              <Input
                type="number"
                placeholder="Max"
                value={currentFilters.importo_max || ""}
                onChange={(e) => updateFilters({ importo_max: e.target.value || undefined })}
                className="w-[120px]"
              />
              <span className="text-sm text-muted-foreground">EUR</span>
            </div>
          </div>
        )}

        {isPending && (
          <div className="text-sm text-muted-foreground">Caricamento...</div>
        )}
      </CardContent>
    </Card>
  )
}
