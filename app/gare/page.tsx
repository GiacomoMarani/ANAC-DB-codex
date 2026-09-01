import { Suspense } from "react"
import { GareListClient } from "./gare-list-client"
import { SiteNav } from "@/components/site-nav"
import { Skeleton } from "@/components/ui/skeleton"

export const metadata = {
  title: "Gare d'appalto pubbliche — Tender AI DB",
  description:
    "Cerca e analizza bandi pubblici italiani da ANAC e TED Europa. Filtra per tipo, importo e scadenza. Analisi AI integrata.",
}

const SOURCES = [
  { label: "ANAC", sublabel: "Bandi in corso" },
  { label: "TED", sublabel: "Europa" },
  { label: "18+", sublabel: "Fonti regionali" },
] as const

export default function GarePage() {
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <SiteNav variant="gare" />

      <section className="relative border-b border-border overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 0% 0%, oklch(0.52 0.22 255 / 0.10) 0%, transparent 70%)",
          }}
        />

        <div className="container mx-auto px-4 sm:px-6 py-10 sm:py-14 md:py-20">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 md:gap-12 items-center">
            <div className="space-y-5 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2" aria-label="Dati aggiornati in tempo reale">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="text-[10px] tracking-[0.2em] uppercase text-primary font-semibold">
                  Aggiornamento in tempo reale
                </span>
              </div>

              <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] text-foreground">
                Gare d&apos;appalto<br className="hidden sm:block" /> pubbliche
              </h1>

              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-[52ch]">
                Migliaia di bandi da{" "}
                <span className="text-foreground font-semibold">ANAC</span>{" "}
                e{" "}
                <span className="text-foreground font-semibold">TED Europa</span>.
                Filtra, analizza, esporta.
              </p>
            </div>

            <div className="flex md:flex-col gap-3 md:gap-2 shrink-0">
              {SOURCES.map((s) => (
                <div
                  key={s.sublabel}
                  className="
                    flex-1 md:flex-none
                    flex flex-col items-center md:items-end
                    gap-0.5
                    px-4 py-3 md:py-2.5
                    rounded-lg border border-border
                    bg-card/50
                    min-w-[80px]
                  "
                >
                  <span className="text-xl md:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {s.label}
                  </span>
                  <span className="text-[10px] tracking-[0.12em] uppercase text-muted-foreground font-medium">
                    {s.sublabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 flex-1">
        <Suspense
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-11 w-full" />
              <div className="flex gap-3">
                <Skeleton className="h-10 w-44" />
                <Skeleton className="h-10 w-44" />
                <Skeleton className="h-10 w-44" />
              </div>
              <Skeleton className="h-5 w-40" />
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-48 w-full rounded-xl" />
              ))}
            </div>
          }
        >
          <GareListClient />
        </Suspense>
      </main>

      <footer className="border-t border-border py-7 mt-auto">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground font-medium tracking-wide">
              Tender AI DB
            </span>
            <p className="text-xs text-muted-foreground text-center">
              Dati da{" "}
              <a
                href="https://dati.anticorruzione.it"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline underline-offset-2"
              >
                ANAC
              </a>
              {" · "}
              <a
                href="https://ted.europa.eu"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline underline-offset-2"
              >
                TED Europa
              </a>
            </p>
            <span className="text-[10px] text-muted-foreground/50 tracking-[0.12em] uppercase">
              Vocabolario CPV 2008
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}