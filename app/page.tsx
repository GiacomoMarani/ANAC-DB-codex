import { Suspense } from "react"
import { CigDataProvider } from "@/components/cig-data-provider"
import { Button } from "@/components/ui/button"
import { Upload } from "lucide-react"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <img
                  src="/logo.jpg"
                  alt="Tender AI PRO"
                  className="h-10 w-10 rounded-sm object-contain"
                  loading="eager"
                />
                <h1 className="text-2xl font-bold tracking-tight">ANAC Data Explorer</h1>
              </div>
              <p className="text-muted-foreground mt-1">
                Consultazione dati CIG - Contratti Pubblici Italia
              </p>
            </div>
            <Button asChild>
              <Link href="/import">
                <Upload className="h-4 w-4 mr-2" />
                Importa dati
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Suspense fallback={
          <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <Skeleton className="h-40" />
            <Skeleton className="h-96" />
          </div>
        }>
          <CigDataProvider />
        </Suspense>
      </main>

      <footer className="border-t py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>
            Dati provenienti da{" "}
            <a 
              href="https://dati.anticorruzione.it/opendata/ocds_it" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              ANAC Open Data
            </a>
            {" "}- Autorita Nazionale Anticorruzione
          </p>
        </div>
      </footer>
    </div>
  )
}
