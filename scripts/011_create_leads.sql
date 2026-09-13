-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
-- Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
-- Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

-- Create leads table for capturing report requests from /ricerca-gare
CREATE TABLE IF NOT EXISTS leads (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome        TEXT,
  cognome     TEXT,
  email       TEXT NOT NULL,
  tender_id   TEXT,
  source      TEXT DEFAULT 'ricerca-gare',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index on email for deduplication queries
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email);

-- Index on created_at for chronological listing
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);

-- RLS: allow service role to insert (API route uses admin client)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert leads"
  ON leads
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can read leads"
  ON leads
  FOR SELECT
  TO service_role
  USING (true);
