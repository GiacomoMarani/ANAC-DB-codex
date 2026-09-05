-- 009_create_aggiudicatari.sql
--
-- Tabella per gli aggiudicatari di gare pubbliche.
-- Fonte: ANAC Open Data OCDS (dataset "awards").
-- Ogni riga lega un operatore economico (codice_fiscale) a un CIG aggiudicato.
--
-- Questa tabella è il collegamento chiave per la Profilazione Rapida:
--   P.IVA → aggiudicatari.codice_fiscale → cig → CPV reali dell'azienda

CREATE TABLE IF NOT EXISTS aggiudicatari (
  id              BIGSERIAL PRIMARY KEY,
  codice_fiscale  VARCHAR(16)   NOT NULL,           -- CF/P.IVA dell'operatore economico
  denominazione   VARCHAR(1000),                     -- Ragione sociale
  tipo_soggetto   VARCHAR(200),                      -- "Impresa singola", "RTI", "Consorzio" ecc.
  cig             VARCHAR(50)   NOT NULL,            -- CIG della gara aggiudicata
  importo_aggiudicazione NUMERIC(18,2),              -- Importo effettivo di aggiudicazione
  data_aggiudicazione    DATE,                       -- Data dell'award
  ruolo           VARCHAR(100),                      -- "mandataria", "mandante", "singola"
  codice_cpv      VARCHAR(20),                       -- CPV dalla gara (denormalizzato per query rapide)
  descrizione_cpv VARCHAR(1000),                     -- Descrizione CPV dalla gara
  oggetto_gara    VARCHAR(4000),                     -- Titolo della gara (denormalizzato)
  provincia       VARCHAR(100),                      -- Provincia della gara (denormalizzato)
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- Indice primario: lookup per P.IVA/CF → lista gare vinte
CREATE INDEX IF NOT EXISTS idx_aggiudicatari_cf
  ON aggiudicatari (codice_fiscale);

-- Indice per join con tabella cig
CREATE INDEX IF NOT EXISTS idx_aggiudicatari_cig
  ON aggiudicatari (cig);

-- Indice per ricerche per denominazione
CREATE INDEX IF NOT EXISTS idx_aggiudicatari_denominazione
  ON aggiudicatari USING gin (to_tsvector('italian', denominazione));

-- Indice per CPV
CREATE INDEX IF NOT EXISTS idx_aggiudicatari_cpv
  ON aggiudicatari (codice_cpv);

-- Unique constraint per evitare duplicati nello stesso award
CREATE UNIQUE INDEX IF NOT EXISTS idx_aggiudicatari_cf_cig_unique
  ON aggiudicatari (codice_fiscale, cig);

-- RLS: accesso pubblico in lettura (dati ANAC sono open data)
ALTER TABLE aggiudicatari ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accesso pubblico in lettura aggiudicatari"
  ON aggiudicatari
  FOR SELECT
  USING (true);

CREATE POLICY "Solo service role per inserimento aggiudicatari"
  ON aggiudicatari
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Solo service role per aggiornamento aggiudicatari"
  ON aggiudicatari
  FOR UPDATE
  USING (true);
