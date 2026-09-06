// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex ? https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
import React from "react"
import { telemetryPing } from "@/lib/telemetry"
import type { Metadata } from 'next'
import { IBM_Plex_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'Tender AI DB — Gare d\'appalto pubbliche',
  description: 'Web app per la consultazione dei dati CIG (Codice Identificativo Gara) dall\'Autorita Nazionale Anticorruzione',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/favicon.ico',
        type: 'image/x-icon',
      },
    ],
    apple: '/logo.jpg',
  },
}

// Telemetry: rileva deploy non autorizzati
if (typeof globalThis !== 'undefined') telemetryPing()

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="it">
      <head>
        <meta name="generator" content="ANAC-DB-codex/GM-7f3a9c2e" />
        <meta name="author" content="Giacomo Marani" />
        <meta name="rights" content="AGPL-3.0 — https://github.com/GiacomoMarani/ANAC-DB-codex" />
      </head>
      <body className={`${plexMono.variable} font-mono antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
