import Link from "next/link"
import Image from "next/image"

interface SiteNavProps {
  variant?: "gare" | "cpv" | "profilazione"
}

export function SiteNav({ variant = "gare" }: SiteNavProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="container mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <Link href="/gare" className="flex items-center gap-3 group shrink-0">
          <div className="relative h-7 w-7 rounded-lg overflow-hidden ring-1 ring-black/10 shrink-0">
            <Image src="/logo.jpg" alt="Tender AI DB" fill className="object-cover" priority />
          </div>
          <div className="flex items-baseline gap-2 leading-none">
            <span className="text-sm font-bold tracking-[0.07em] uppercase text-foreground group-hover:text-primary transition-colors duration-150">
              Tender AI DB
            </span>
            <span className="hidden sm:inline text-[10px] tracking-[0.18em] uppercase text-muted-foreground/70 font-medium">
              Bandi Pubblici
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {variant !== "gare" && (
            <Link
              href="/gare"
              className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors duration-150 whitespace-nowrap"
            >
              Gare
            </Link>
          )}
          {variant !== "cpv" && (
            <Link
              href="/codici-cpv"
              className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors duration-150 whitespace-nowrap"
            >
              Codici CPV
            </Link>
          )}
          {variant !== "profilazione" && (
            <Link
              href="/profilazione"
              className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors duration-150 whitespace-nowrap"
            >
              Profilazione
            </Link>
          )}
          <Link
            href="/ricerca-gare"
            className="px-3 py-1.5 rounded-md text-xs font-medium text-primary border border-primary/30 hover:bg-primary/10 hover:border-primary/60 transition-all duration-150 whitespace-nowrap"
          >
            Analisi avanzata
          </Link>
        </nav>
      </div>
    </header>
  )
}