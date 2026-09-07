-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
-- Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
-- Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

-- 010_create_partecipanti.sql
--
-- Tabella per i partecipanti (bidders) alle gare pubbliche.
-- Fonte: ANAC Open Data (dataset "Partecipanti") e OCDS bulk (tender.tenderers[]).
-- Ogni riga lega un operatore economico (codice_fiscale) a un CIG a cui ha partecipato.
--
-- Questa tabella complementa `aggiudicatari`: permette di calcolare il
-- tasso di successo (gare vinte / gare partecipate) nella Profilazione Rapida.

CREATE TABLE IF NOT EXISTS partecipanti (
  id                BIGSERIAL PRIMARY KEY,
  codice_fiscale    VARCHAR(16)   NOT NULL,            -- CF/P.IVA dell'operatore economico
  denominazione     VARCHAR(1000),                      -- Ragione sociale
  tipo_soggetto     VARCHAR(200),                       -- "Impresa singola", "RTI mandataria", "Consorzio" ecc.
  cig               VARCHAR(50)   NOT NULL,             -- CIG della gara a cui ha partecipato
  ruolo             VARCHAR(100),                       -- "mandataria", "mandante", "singola", "capogruppo"
  id_aggiudicazione VARCHAR(100),                       -- Collegamento logico all'aggiudicazione
  codice_cpv        VARCHAR(20),                        -- CPV dalla gara (denormalizzato per query rapide)
  descrizione_cpv   VARCHAR(1000),                      -- Descrizione CPV dalla gara
  oggetto_gara      VARCHAR(4000),                      -- Titolo della gara (denormalizzato)
  provincia         VARCHAR(100),                       -- Provincia della gara (denormalizzato)
  created_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- Indice primario: lookup per P.IVA/CF → lista gare a cui ha partecipato
CREATE INDEX IF NOT EXISTS idx_partecipanti_cf
  ON partecipanti (codice_fiscale);

-- Indice per join con tabella cig
CREATE INDEX IF NOT EXISTS idx_partecipanti_cig
  ON partecipanti (cig);

-- Indice per ricerche per denominazione
CREATE INDEX IF NOT EXISTS idx_partecipanti_denominazione
  ON partecipanti USING gin (to_tsvector('italian', denominazione));

-- Indice per CPV
CREATE INDEX IF NOT EXISTS idx_partecipanti_cpv
  ON partecipanti (codice_cpv);

-- Unique constraint per evitare duplicati dello stesso partecipante nella stessa gara
CREATE UNIQUE INDEX IF NOT EXISTS idx_partecipanti_cf_cig_unique
  ON partecipanti (codice_fiscale, cig);

-- RLS: accesso pubblico in lettura (dati ANAC sono open data)
ALTER TABLE partecipanti ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Accesso pubblico in lettura partecipanti"
  ON partecipanti
  FOR SELECT
  USING (true);

CREATE POLICY "Solo service role per inserimento partecipanti"
  ON partecipanti
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Solo service role per aggiornamento partecipanti"
  ON partecipanti
  FOR UPDATE
  USING (true);
