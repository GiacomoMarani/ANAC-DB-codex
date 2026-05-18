import { Suspense } from "react"
import { GareListClient } from "./gare-list-client"
import Link from "next/link"
import { ArrowLeft, Search } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

export const metadata = {
  title: "Gare d'appalto pubbliche — ANAC Data Explorer",
  description: "Cerca tra migliaia di bandi pubblici italiani aggiornati ogni giorno. Filtra per tipo, importo e scadenza.",
}

export default function GarePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* ── Navbar ── */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Torna alla home
          </Link>
          <Link href="/ricerca-gare" className="text-sm font-medium text-primary hover:underline">
            Analisi avanzata →
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="border-b bg-card">
        <div className="container mx-auto px-4 py-12 md:py-16">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Search className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-wider">Banca dati ANAC</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Gare d&apos;appalto pubbliche
            </h1>
            <p className="text-lg text-muted-foreground">
              Cerca tra migliaia di bandi aggiornati ogni giorno.
              Filtra per tipo, importo e scadenza.
            </p>
          </div>
        </div>
      </section>

      {/* ── Main Content ── */}
      <main className="container mx-auto px-4 py-8">
        <Suspense fallback={
          <div className="space-y-4">
            <Skeleton className="h-11 w-full" />
            <div className="flex gap-3">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-10 w-48" />
            </div>
            <Skeleton className="h-6 w-48" />
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
          </div>
        }>
          <GareListClient />
        </Suspense>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>
            Dati provenienti da{" "}
            <a href="https://dati.anticorruzione.it/opendata/ocds_it" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              ANAC Open Data
            </a>
            {" "}— Autorità Nazionale Anticorruzione
          </p>
        </div>
      </footer>
    </div>
  )
}
