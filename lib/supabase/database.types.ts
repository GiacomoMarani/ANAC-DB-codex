export type Database = {
  public: {
    Tables: {
      cig: {
        Row: {
          id: number
          cig: string
          oggetto_gara: string | null
          importo_lotto: number | null
          oggetto_principale_contratto: string | null
          stato: string | null
          provincia: string | null
          data_pubblicazione: string | null
          data_scadenza_offerta: string | null
          sezione_regionale: string | null
          descrizione_cpv: string | null
          esito: string | null
        }
        Insert: {
          id?: number
          cig: string
          oggetto_gara?: string | null
          importo_lotto?: number | null
          oggetto_principale_contratto?: string | null
          stato?: string | null
          provincia?: string | null
          data_pubblicazione?: string | null
          data_scadenza_offerta?: string | null
          sezione_regionale?: string | null
          descrizione_cpv?: string | null
          esito?: string | null
        }
        Update: {
          id?: number
          cig?: string
          oggetto_gara?: string | null
          importo_lotto?: number | null
          oggetto_principale_contratto?: string | null
          stato?: string | null
          provincia?: string | null
          data_pubblicazione?: string | null
          data_scadenza_offerta?: string | null
          sezione_regionale?: string | null
          descrizione_cpv?: string | null
          esito?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
