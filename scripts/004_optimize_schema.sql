-- Schema ottimizzato con soli campi necessari per la consultazione

-- Drop della tabella esistente
DROP TABLE IF EXISTS cig;

-- Creazione tabella con i soli campi richiesti
CREATE TABLE cig (
  id BIGSERIAL PRIMARY KEY,
  cig VARCHAR(50) NOT NULL UNIQUE,
  oggetto_gara VARCHAR(4000),
  importo_lotto NUMERIC(15,2),
  oggetto_principale_contratto VARCHAR(500),
  stato VARCHAR(100),
  provincia VARCHAR(100),
  data_pubblicazione DATE,
  data_scadenza_offerta DATE,
  sezione_regionale VARCHAR(100),
  descrizione_cpv VARCHAR(1000),
  esito VARCHAR(100)
);

-- Indici ottimizzati per le query principali
CREATE INDEX idx_cig_code ON cig(cig);
CREATE INDEX idx_cig_stato ON cig(stato);
CREATE INDEX idx_cig_provincia ON cig(provincia);
CREATE INDEX idx_cig_data_pub ON cig(data_pubblicazione DESC NULLS LAST);
CREATE INDEX idx_cig_importo ON cig(importo_lotto DESC NULLS LAST);
CREATE INDEX idx_cig_descrizione_cpv ON cig USING GIN(to_tsvector('italian', coalesce(descrizione_cpv, '')));
CREATE INDEX idx_cig_oggetto_gara ON cig USING GIN(to_tsvector('italian', coalesce(oggetto_gara, '')));

-- Abilitazione RLS
ALTER TABLE cig ENABLE ROW LEVEL SECURITY;

-- Policy: accesso pubblico in lettura
DROP POLICY IF EXISTS "Allow public read" ON cig;
CREATE POLICY "Allow public read"
  ON cig
  FOR SELECT
  USING (true);

-- Policy: inserimento/aggiornamento per utenti autenticati
DROP POLICY IF EXISTS "Allow insert" ON cig;
CREATE POLICY "Allow insert"
  ON cig
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update" ON cig;
CREATE POLICY "Allow update"
  ON cig
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Commenti sulla tabella
COMMENT ON TABLE cig IS 'Tabella CIG ottimizzata con solo campi essenziali per consultazione ANAC';
COMMENT ON COLUMN cig.cig IS 'Codice Identificativo Gara - chiave univoca';
COMMENT ON COLUMN cig.oggetto_principale_contratto IS 'Tipo: Lavori, Servizi, Forniture';
