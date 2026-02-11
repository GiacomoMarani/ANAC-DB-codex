-- ANAC CIG Database Schema
-- Schema for storing public procurement data from ANAC (Autorita Nazionale Anticorruzione)

-- Main table for CIG (Codice Identificativo Gara) records
CREATE TABLE IF NOT EXISTS cig (
  id SERIAL PRIMARY KEY,
  cig VARCHAR(20) UNIQUE NOT NULL,
  cig_accordo_quadro VARCHAR(20),
  numero_gara VARCHAR(255),
  
  -- Gara (Tender) details
  oggetto_gara TEXT,
  importo_complessivo_gara DECIMAL(18, 2),
  n_lotti_componenti VARCHAR(50),
  
  -- Lotto (Lot) details
  oggetto_lotto TEXT,
  importo_lotto DECIMAL(18, 2),
  oggetto_principale_contratto VARCHAR(100),
  
  -- Status and sector
  stato VARCHAR(50),
  settore VARCHAR(100),
  
  -- Location
  luogo_istat VARCHAR(20),
  provincia VARCHAR(100),
  
  -- Dates
  data_pubblicazione DATE,
  data_scadenza_offerta DATE,
  data_ultimo_perfezionamento DATE,
  data_cancellazione DATE,
  
  -- Contract type
  cod_tipo_scelta_contraente VARCHAR(10),
  tipo_scelta_contraente VARCHAR(255),
  cod_modalita_realizzazione VARCHAR(10),
  modalita_realizzazione VARCHAR(255),
  
  -- Contracting authority (Stazione Appaltante)
  codice_ausa VARCHAR(20),
  cf_amministrazione_appaltante VARCHAR(20),
  denominazione_amministrazione_appaltante TEXT,
  sezione_regionale VARCHAR(100),
  
  -- Cost center
  id_centro_costo VARCHAR(100),
  denominazione_centro_costo TEXT,
  
  -- Publication period
  anno_pubblicazione INTEGER,
  mese_pubblicazione VARCHAR(10),
  
  -- CPV Classification
  cod_cpv VARCHAR(20),
  descrizione_cpv TEXT,
  flag_prevalente INTEGER,
  
  -- Cancellation
  cod_motivo_cancellazione VARCHAR(10),
  motivo_cancellazione TEXT,
  
  -- Special procedures
  cod_modalita_indizione_speciali VARCHAR(10),
  modalita_indizione_speciali TEXT,
  cod_modalita_indizione_servizi VARCHAR(10),
  modalita_indizione_servizi TEXT,
  
  -- Duration and urgency
  durata_prevista INTEGER,
  cod_strumento_svolgimento VARCHAR(10),
  strumento_svolgimento TEXT,
  flag_urgenza INTEGER,
  cod_motivo_urgenza DECIMAL(5, 1),
  motivo_urgenza TEXT,
  
  -- Delegation
  flag_delega INTEGER,
  funzioni_delegate TEXT,
  cf_sa_delegante VARCHAR(20),
  denominazione_sa_delegante TEXT,
  cf_sa_delegata VARCHAR(20),
  denominazione_sa_delegata TEXT,
  
  -- Security and other
  importo_sicurezza DECIMAL(18, 2),
  tipo_appalto_riservato TEXT,
  cui_programma VARCHAR(100),
  flag_prev_ripetizioni INTEGER,
  
  -- Linked contracts
  cod_ipotesi_collegamento VARCHAR(10),
  ipotesi_collegamento TEXT,
  cig_collegamento VARCHAR(20),
  
  -- Outcome
  cod_esito DECIMAL(5, 1),
  esito VARCHAR(100),
  data_comunicazione_esito DATE,
  
  -- PNRR/PNC flag
  flag_pnrr_pnc INTEGER,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common query patterns
CREATE INDEX idx_cig_data_pubblicazione ON cig(data_pubblicazione);
CREATE INDEX idx_cig_anno_mese ON cig(anno_pubblicazione, mese_pubblicazione);
CREATE INDEX idx_cig_provincia ON cig(provincia);
CREATE INDEX idx_cig_stato ON cig(stato);
CREATE INDEX idx_cig_importo_lotto ON cig(importo_lotto);
CREATE INDEX idx_cig_tipo_scelta_contraente ON cig(tipo_scelta_contraente);
CREATE INDEX idx_cig_oggetto_principale ON cig(oggetto_principale_contratto);
CREATE INDEX idx_cig_cf_amministrazione ON cig(cf_amministrazione_appaltante);
CREATE INDEX idx_cig_cod_cpv ON cig(cod_cpv);
CREATE INDEX idx_cig_esito ON cig(esito);

-- Full text search index for gara and lotto objects
CREATE INDEX idx_cig_oggetto_gara_fts ON cig USING gin(to_tsvector('italian', coalesce(oggetto_gara, '')));
CREATE INDEX idx_cig_oggetto_lotto_fts ON cig USING gin(to_tsvector('italian', coalesce(oggetto_lotto, '')));

-- Enable Row Level Security
ALTER TABLE cig ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access
CREATE POLICY "Allow public read access" ON cig
  FOR SELECT
  USING (true);

-- Create policy to allow authenticated users to insert/update
CREATE POLICY "Allow authenticated insert" ON cig
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON cig
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_cig_updated_at
  BEFORE UPDATE ON cig
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE cig IS 'Tabella principale per i dati CIG (Codice Identificativo Gara) dell''ANAC';
COMMENT ON COLUMN cig.cig IS 'Codice Identificativo Gara univoco';
COMMENT ON COLUMN cig.cig_accordo_quadro IS 'CIG dell''accordo quadro di riferimento';
COMMENT ON COLUMN cig.oggetto_gara IS 'Descrizione dell''oggetto della gara';
COMMENT ON COLUMN cig.importo_complessivo_gara IS 'Importo complessivo della gara in EUR';
COMMENT ON COLUMN cig.cod_cpv IS 'Codice CPV (Common Procurement Vocabulary)';
COMMENT ON COLUMN cig.flag_pnrr_pnc IS 'Flag PNRR/PNC (Piano Nazionale Ripresa e Resilienza)';

