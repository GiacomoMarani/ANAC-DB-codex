-- Ottimizzazione schema: rimozione campi non essenziali
-- Manteniamo solo i campi richiesti per migliorare performance

-- 1. Backup della tabella esistente (opzionale, commentato)
-- CREATE TABLE cig_backup AS SELECT * FROM cig;

-- 2. Drop della tabella esistente
DROP TABLE IF EXISTS cig;

-- 3. Creazione nuova tabella ottimizzata con solo campi essenziali
CREATE TABLE cig (
  id BIGSERIAL PRIMARY KEY,
  
  -- Identificativi
  cig VARCHAR(20) NOT NULL UNIQUE,
  numero_gara VARCHAR(50),
  
  -- Descrizione e importo
  oggetto_lotto TEXT,
  importo_lotto DECIMAL(18, 2),
  oggetto_principale_contratto VARCHAR(10), -- L (Lavori), S (Servizi), F (Forniture)
  
  -- Stato e classificazione
  stato VARCHAR(50),
  settore VARCHAR(100),
  
  -- Localizzazione
  luogo_istat VARCHAR(20),
  provincia VARCHAR(100),
  sezione_regionale VARCHAR(100),
  
  -- Date
  data_pubblicazione DATE,
  data_scadenza_offerta DATE,
  data_ultimo_perfezionamento DATE,
  data_comunicazione_esito DATE,
  
  -- Modalità gara
  tipo_scelta_contraente VARCHAR(255),
  modalita_realizzazione VARCHAR(255),
  
  -- Stazione appaltante
  cf_amministrazione_appaltante VARCHAR(20),
  denominazione_amministrazione_appaltante TEXT,
  denominazione_centro_costo TEXT,
  
  -- Classificazione CPV
  cod_cpv VARCHAR(20),
  
  -- Esito
  cod_esito VARCHAR(10),
  esito VARCHAR(255),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Creazione indici ottimizzati
CREATE INDEX idx_cig_code ON cig(cig);
CREATE INDEX idx_cig_stato ON cig(stato);
CREATE INDEX idx_cig_provincia ON cig(provincia);
CREATE INDEX idx_cig_data_pub ON cig(data_pubblicazione DESC NULLS LAST);
CREATE INDEX idx_cig_importo ON cig(importo_lotto DESC NULLS LAST);
CREATE INDEX idx_cig_cod_cpv ON cig(cod_cpv);
CREATE INDEX idx_cig_cf_pa ON cig(cf_amministrazione_appaltante);

-- Indice composito per query comuni
CREATE INDEX idx_cig_stato_data ON cig(stato, data_pubblicazione DESC NULLS LAST);
CREATE INDEX idx_cig_provincia_stato ON cig(provincia, stato);

-- 5. Abilitazione RLS
ALTER TABLE cig ENABLE ROW LEVEL SECURITY;

-- 6. Policy per accesso pubblico in lettura
DROP POLICY IF EXISTS "Allow public read" ON cig;
CREATE POLICY "Allow public read" ON cig FOR SELECT USING (true);

-- 7. Policy per inserimento/aggiornamento pubblico
DROP POLICY IF EXISTS "Allow public insert" ON cig;
CREATE POLICY "Allow public insert" ON cig FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update" ON cig;
CREATE POLICY "Allow public update" ON cig FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete" ON cig;
CREATE POLICY "Allow public delete" ON cig FOR DELETE USING (true);

-- 8. Commenti sulla tabella
COMMENT ON TABLE cig IS 'Tabella CIG ottimizzata con solo campi essenziali per consultazione ANAC';
COMMENT ON COLUMN cig.cig IS 'Codice Identificativo Gara - chiave univoca';
COMMENT ON COLUMN cig.cod_cpv IS 'Common Procurement Vocabulary - codice classificazione europea';
COMMENT ON COLUMN cig.oggetto_principale_contratto IS 'Tipo: L=Lavori, S=Servizi, F=Forniture';
