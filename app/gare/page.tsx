import { Suspense } from "react"
import { GareListClient } from "./gare-list-client"
import Link from "next/link"
import Image from "next/image"
import { Skeleton } from "@/components/ui/skeleton"

export const metadata = {
  title: "Gare d'appalto pubbliche — Tender AI DB",
  description: "Cerca e analizza bandi pubblici italiani da ANAC, TED Europa e CATO. Filtra per tipo, importo e scadenza. Analisi AI integrata.",
}

export default function GarePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* ── Navbar ── */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/gare" className="flex items-center gap-3 group">
            <div className="relative h-9 w-9 rounded-lg overflow-hidden shadow-sm ring-1 ring-black/5">
              <Image
                src="/logo.jpg"
                alt="Tender AI DB"
                fill
                className="object-cover"
                priority
              />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight leading-none group-hover:text-primary transition-colors">
                Tender AI DB
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                Motore di ricerca gare
              </span>
            </div>
          </Link>
          <Link href="/ricerca-gare" className="text-sm font-medium text-primary hover:underline">
            Analisi avanzata →
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="border-b bg-gradient-to-b from-card to-background">
        <div className="container mx-auto px-4 py-10 md:py-14">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                Aggiornamento in tempo reale
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
              Gare d&apos;appalto pubbliche
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed">
              Cerca tra migliaia di bandi da <strong>ANAC</strong>, <strong>TED Europa</strong> e <strong>CATO</strong>.
              {" "}Filtra per tipo, importo e scadenza. Analizza con l&apos;AI.
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
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="relative h-6 w-6 rounded overflow-hidden">
                <Image src="/logo.jpg" alt="Tender AI DB" fill className="object-cover" />
              </div>
              <span className="font-medium text-foreground/70">Tender AI DB</span>
            </div>
            <p className="text-center">
              Dati da{" "}
              <a href="https://dati.anticorruzione.it" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ANAC</a>
              {" · "}
              <a href="https://ted.europa.eu" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">TED Europa</a>
              {" · "}
              <a href="https://www.get-cato.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">CATO</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
