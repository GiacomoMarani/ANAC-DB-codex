"use client"

import useSWR from "swr"
import { useSearchParams, useRouter } from "next/navigation"
import { useState, useCallback, useTransition, useDeferredValue, useMemo } from "react"
import { CigTable } from "./cig-table"
import { SearchFilters } from "./search-filters-client"
import { StatsCards } from "./stats-cards"
import { Skeleton } from "@/components/ui/skeleton"

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface Stats {
  total: number
  active: number
  anni: number[]
}

interface CigData {
  data: Array<{
    id: number
    cig: string
    oggetto_gara: string | null
    importo_lotto: number | null
    stato: string | null
    provincia: string | null
    data_pubblicazione: string | null
    data_scadenza_offerta: string | null
    sezione_regionale: string | null
    oggetto_principale_contratto: string | null
    descrizione_cpv: string | null
    esito: string | null
    [key: string]: unknown
  }>
  count: number
  totalPages: number
  pageImporto: number
}

export function CigDataProvider() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  
  // Local state for instant UI updates
  const [localSearch, setLocalSearch] = useState(searchParams.get("q") || "")
  const deferredSearch = useDeferredValue(localSearch)
  
  // Build query string from search params
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    
    // Use deferred search for smoother typing
    if (deferredSearch) params.set("q", deferredSearch)
    
    const provincia = searchParams.get("provincia")
    const stato = searchParams.get("stato")
    const tipo_contratto = searchParams.get("tipo_contratto")
    const anno = searchParams.get("anno")
    const cpv = searchParams.get("cpv")
    const importo_min = searchParams.get("importo_min")
    const importo_max = searchParams.get("importo_max")
    const page = searchParams.get("page")
    
    if (provincia) params.set("provincia", provincia)
    if (stato) params.set("stato", stato)
    if (tipo_contratto) params.set("tipo_contratto", tipo_contratto)
    if (anno) params.set("anno", anno)
    if (cpv) params.set("cpv", cpv)
    if (importo_min) params.set("importo_min", importo_min)
    if (importo_max) params.set("importo_max", importo_max)
    if (page) params.set("page", page)
    
    return params.toString()
  }, [searchParams, deferredSearch])

  // Fetch stats (cached globally)
  const { data: stats, isLoading: statsLoading } = useSWR<Stats>(
    "/api/stats",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  )

  // Fetch CIG data based on filters
  const { data: cigData, isLoading: dataLoading } = useSWR<CigData>(
    `/api/cig?${queryString}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  )

  const currentPage = Number(searchParams.get("page")) || 1

  const updateFilters = useCallback((updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("page") // Reset page on filter change
    
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    }
    
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }, [router, searchParams])

  const clearFilters = useCallback(() => {
    setLocalSearch("")
    startTransition(() => {
      router.push("/", { scroll: false })
    })
  }, [router])

  const handleSearchChange = useCallback((value: string) => {
    setLocalSearch(value)
  }, [])

  const handleSearchSubmit = useCallback(() => {
    updateFilters({ q: localSearch || undefined })
  }, [localSearch, updateFilters])

  const filterOptions = useMemo(() => ({
    province: [
      "AGRIGENTO", "ALESSANDRIA", "ANCONA", "AOSTA", "AREZZO", "ASCOLI PICENO",
      "ASTI", "AVELLINO", "BARI", "BARLETTA-ANDRIA-TRANI", "BELLUNO", "BENEVENTO",
      "BERGAMO", "BIELLA", "BOLOGNA", "BOLZANO", "BRESCIA", "BRINDISI", "CAGLIARI",
      "CALTANISSETTA", "CAMPOBASSO", "CASERTA", "CATANIA", "CATANZARO", "CHIETI",
      "COMO", "COSENZA", "CREMONA", "CROTONE", "CUNEO", "ENNA", "FERMO", "FERRARA",
      "FIRENZE", "FOGGIA", "FORLI-CESENA", "FROSINONE", "GENOVA", "GORIZIA",
      "GROSSETO", "IMPERIA", "ISERNIA", "LA SPEZIA", "L'AQUILA", "LATINA", "LECCE",
      "LECCO", "LIVORNO", "LODI", "LUCCA", "MACERATA", "MANTOVA", "MASSA-CARRARA",
      "MATERA", "MESSINA", "MILANO", "MODENA", "MONZA E BRIANZA", "NAPOLI", "NOVARA",
      "NUORO", "ORISTANO", "PADOVA", "PALERMO", "PARMA", "PAVIA", "PERUGIA",
      "PESARO E URBINO", "PESCARA", "PIACENZA", "PISA", "PISTOIA", "PORDENONE",
      "POTENZA", "PRATO", "RAGUSA", "RAVENNA", "REGGIO CALABRIA", "REGGIO EMILIA",
      "RIETI", "RIMINI", "ROMA", "ROVIGO", "SALERNO", "SASSARI", "SAVONA", "SIENA",
      "SIRACUSA", "SONDRIO", "SUD SARDEGNA", "TARANTO", "TERAMO", "TERNI", "TORINO",
      "TRAPANI", "TRENTO", "TREVISO", "TRIESTE", "UDINE", "VARESE", "VENEZIA",
      "VERBANO-CUSIO-OSSOLA", "VERCELLI", "VERONA", "VIBO VALENTIA", "VICENZA", "VITERBO"
    ],
    anni: stats?.anni || []
  }), [stats?.anni])

  const currentFilters = useMemo(() => ({
    q: localSearch,
    provincia: searchParams.get("provincia") || undefined,
    stato: searchParams.get("stato") || undefined,
    tipo_contratto: searchParams.get("tipo_contratto") || undefined,
    anno: searchParams.get("anno") || undefined,
    cpv: searchParams.get("cpv") || undefined,
    importo_min: searchParams.get("importo_min") || undefined,
    importo_max: searchParams.get("importo_max") || undefined,
  }), [searchParams, localSearch])

  return (
    <div className="space-y-8">
      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <StatsCards 
          stats={{ total: stats?.total || 0, active: stats?.active || 0 }} 
          totalImporto={cigData?.pageImporto || 0}
          filteredCount={cigData?.count}
        />
      )}

      <SearchFilters 
        filterOptions={filterOptions}
        currentFilters={currentFilters}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        onFilterChange={updateFilters}
        onClearFilters={clearFilters}
        isPending={isPending || dataLoading}
      />

      {dataLoading && !cigData ? (
        <Skeleton className="h-96" />
      ) : (
        <CigTable 
          data={cigData?.data || []} 
          totalCount={cigData?.count || 0}
          currentPage={currentPage}
          totalPages={cigData?.totalPages || 0}
        />
      )}
    </div>
  )
}
