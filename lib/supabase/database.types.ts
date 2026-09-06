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
          denominazione_amministrazione_appaltante: string | null
          anac_id_avviso: string | null
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
          denominazione_amministrazione_appaltante?: string | null
          anac_id_avviso?: string | null
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
          denominazione_amministrazione_appaltante?: string | null
          anac_id_avviso?: string | null
          esito?: string | null
        }
        Relationships: []
      }
      ita_tenders: {
        Row: {
          id: number
          oggetto: string | null
          descrizione: string | null
          sources: string
          importo: number | null
          numero_gara: string | null
          stazione_appaltante: string | null
          tipo_procedura: string | null
          link_web: string | null
          is_rettifica: boolean
          data_scadenza: string | null
          luogo: string | null
          created_at: string | null
          scraped_at: string | null
          cig: string | null
          provincia: string | null
          data_pubblicazione: string | null
          codice_cpv: string | null
        }
        Insert: {
          id: number
          oggetto?: string | null
          descrizione?: string | null
          sources: string
          importo?: number | null
          numero_gara?: string | null
          stazione_appaltante?: string | null
          tipo_procedura?: string | null
          link_web?: string | null
          is_rettifica?: boolean
          data_scadenza?: string | null
          luogo?: string | null
          created_at?: string | null
          scraped_at?: string | null
          cig?: string | null
          provincia?: string | null
          data_pubblicazione?: string | null
          codice_cpv?: string | null
        }
        Update: {
          id?: number
          oggetto?: string | null
          descrizione?: string | null
          sources?: string
          importo?: number | null
          numero_gara?: string | null
          stazione_appaltante?: string | null
          tipo_procedura?: string | null
          link_web?: string | null
          is_rettifica?: boolean
          data_scadenza?: string | null
          luogo?: string | null
          created_at?: string | null
          scraped_at?: string | null
          cig?: string | null
          provincia?: string | null
          data_pubblicazione?: string | null
          codice_cpv?: string | null
        }
        Relationships: []
      }
      aggiudicatari: {
        Row: {
          id: number
          codice_fiscale: string
          denominazione: string | null
          tipo_soggetto: string | null
          cig: string
          importo_aggiudicazione: number | null
          data_aggiudicazione: string | null
          ruolo: string | null
          codice_cpv: string | null
          descrizione_cpv: string | null
          oggetto_gara: string | null
          provincia: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          codice_fiscale: string
          denominazione?: string | null
          tipo_soggetto?: string | null
          cig: string
          importo_aggiudicazione?: number | null
          data_aggiudicazione?: string | null
          ruolo?: string | null
          codice_cpv?: string | null
          descrizione_cpv?: string | null
          oggetto_gara?: string | null
          provincia?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          codice_fiscale?: string
          denominazione?: string | null
          tipo_soggetto?: string | null
          cig?: string
          importo_aggiudicazione?: number | null
          data_aggiudicazione?: string | null
          ruolo?: string | null
          codice_cpv?: string | null
          descrizione_cpv?: string | null
          oggetto_gara?: string | null
          provincia?: string | null
          created_at?: string | null
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
