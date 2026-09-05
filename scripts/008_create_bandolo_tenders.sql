-- ═══════════════════════════════════════════════════════════════════════════════
-- Bandolo Tenders table — run this in the Supabase SQL Editor
-- Aggrega bandi da 1.096 fonti istituzionali (IT, EU, US, UK, INTL)
-- inclusi incentivi.gov.it, invitalia.it, ted.europa.eu
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create table
CREATE TABLE IF NOT EXISTS bandolo_tenders (
  id                 INTEGER PRIMARY KEY,          -- Bandolo original ID
  slug               TEXT,                         -- URL-safe slug
  titolo             TEXT,                         -- tender title
  ente               TEXT,                         -- issuing entity
  descrizione        TEXT,                         -- full description (not truncated)
  scadenza           DATE,                         -- submission deadline
  country            VARCHAR(10),                  -- IT, EU, US, UK, DE, FR, ES, INTL
  tender_type        VARCHAR(50),                  -- grant, concorso, bando
  regione_richiesta  TEXT,                         -- region requirement
  importo_max        NUMERIC,                     -- max funding amount EUR
  dimensione_impresa TEXT,                         -- enterprise size (PMI, Startup, etc.)
  settori            TEXT,                         -- sectors (comma-separated)
  destinatari        TEXT,                         -- target audience
  come_candidarsi    TEXT,                         -- how to apply
  source             TEXT NOT NULL,                -- sub-source key (incentivi.gov.it, invitalia.it, etc.)
  link               TEXT,                         -- official source URL
  bandolo_created_at TIMESTAMPTZ,                 -- when Bandolo indexed it
  synced_at          TIMESTAMPTZ DEFAULT now()    -- when we synced it
);

-- 2. Add full-text search column (Italian config)
ALTER TABLE bandolo_tenders
  ADD COLUMN IF NOT EXISTS fts TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('italian',
      coalesce(titolo, '') || ' ' ||
      coalesce(descrizione, '') || ' ' ||
      coalesce(ente, ''))
  ) STORED;

-- 3. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_bandolo_country    ON bandolo_tenders (country);
CREATE INDEX IF NOT EXISTS idx_bandolo_source     ON bandolo_tenders (source);
CREATE INDEX IF NOT EXISTS idx_bandolo_scadenza   ON bandolo_tenders (scadenza);
CREATE INDEX IF NOT EXISTS idx_bandolo_importo    ON bandolo_tenders (importo_max);
CREATE INDEX IF NOT EXISTS idx_bandolo_type       ON bandolo_tenders (tender_type);
CREATE INDEX IF NOT EXISTS idx_bandolo_synced     ON bandolo_tenders (synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_bandolo_fts        ON bandolo_tenders USING GIN (fts);

-- 4. Enable RLS (Row Level Security) — allow read from anon key
ALTER TABLE bandolo_tenders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bandolo_read" ON bandolo_tenders
  FOR SELECT USING (true);

CREATE POLICY "bandolo_write" ON bandolo_tenders
  FOR ALL USING (true) WITH CHECK (true);

-- 5. Comment
COMMENT ON TABLE bandolo_tenders IS
  'Bandi da Bandolo (getbandolo.com) — aggrega incentivi.gov.it, invitalia.it, '
  'TED Europa e 1.096 altre fonti istituzionali. Sync via scripts/sync-bandolo.mjs';
