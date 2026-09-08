-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
-- Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
-- Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

CREATE TABLE IF NOT EXISTS aggiudicatari_storico (
  cig TEXT NOT NULL,
  cod_fisc TEXT NOT NULL,
  denominazione TEXT,
  cod_cpv TEXT,
  oggetto_bando TEXT,
  importo_aggiudicazione REAL,
  data_aggiudicazione TEXT,
  provincia TEXT,
  stazione_appaltante TEXT,
  tipo_contratto TEXT,
  sezione_regionale TEXT,
  settore TEXT,
  importo_lotto REAL,
  ruolo TEXT,
  flag_pnrr TEXT,
  PRIMARY KEY (cig, cod_fisc)
);

CREATE INDEX IF NOT EXISTS idx_cod_fisc ON aggiudicatari_storico(cod_fisc);
CREATE INDEX IF NOT EXISTS idx_cod_cpv ON aggiudicatari_storico(cod_cpv);
CREATE INDEX IF NOT EXISTS idx_provincia ON aggiudicatari_storico(provincia);
CREATE INDEX IF NOT EXISTS idx_data ON aggiudicatari_storico(data_aggiudicazione);
