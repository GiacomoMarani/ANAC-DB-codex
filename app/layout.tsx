import React from "react"
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="it">
      <body className={`${plexMono.variable} font-mono antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
