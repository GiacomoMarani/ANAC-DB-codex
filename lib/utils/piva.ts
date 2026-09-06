// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.it>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * Utility per la validazione della Partita IVA italiana.
 */

export interface CpvAnalysis {
  code: string;
  description: string;
  count: number;
  total_value: number;
  percentage: number;
}

export interface CpvDivision {
  division: string;
  label: string;
  count: number;
  percentage: number;
}

export interface ProfilingResponse {
  profile: {
    partita_iva: string;
    ragione_sociale: string | null;
    sede: string | null;
    regione: string | null;
    
    totale_gare: number;
    gare_vinte: number;
    importo_totale: number;
    importo_medio: number;
    prima_gara: string | null;
    ultima_gara: string | null;
    
    cpv_codes: CpvAnalysis[];
    cpv_divisions: CpvDivision[];
    
    province: Array<{
      name: string;
      count: number;
    }>;
    
    tipi_contratto: Array<{
      tipo: string;
      count: number;
      percentage: number;
    }>;
  };
}

/**
 * Rimuove spazi, trattini e caratteri non numerici dalla Partita IVA
 * @param piva Partita IVA grezza
 * @returns Partita IVA formattata (solo numeri)
 */
export function formatPartitaIva(piva: string): string {
  if (!piva) return "";
  return piva.replace(/\D/g, "");
}

/**
 * Valida il formato e il checksum (algoritmo di Luhn modificato) di una Partita IVA italiana
 * L'algoritmo calcola:
 * 1. Somma cifre in posizioni dispari
 * 2. Per cifre in posizioni pari: raddoppia, se >= 10 sottrai 9, e somma
 * 3. Aggiunge 11esima cifra
 * 4. Valido se % 10 === 0
 * @param piva Partita IVA da validare
 * @returns true se valida, false altrimenti
 */
export function isValidPartitaIva(piva: string): boolean {
  const formatted = formatPartitaIva(piva);
  
  if (formatted.length !== 11) {
    return false;
  }

  // Verifica che siano tutti numeri
  if (!/^[0-9]{11}$/.test(formatted)) {
    return false;
  }

  let sum = 0;
  // Calcolo sui primi 10 caratteri
  for (let i = 0; i < 10; i++) {
    const digit = parseInt(formatted[i], 10);
    // Nota: i Ã¨ 0-indexed. Le posizioni dispari per l'algoritmo corrispondono agli indici pari (0, 2, 4...)
    if (i % 2 === 0) {
      sum += digit;
    } else {
      // Posizioni pari per l'algoritmo, indici dispari (1, 3, 5...)
      const doubled = digit * 2;
      sum += doubled >= 10 ? doubled - 9 : doubled;
    }
  }

  const checkDigit = parseInt(formatted[10], 10);
  return (sum + checkDigit) % 10 === 0;
}
