-- ═══════════════════════════════════════════════════════════════════════════════
-- CATO Tenders table — run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create table
CREATE TABLE IF NOT EXISTS cato_tenders (
  id                  BIGINT PRIMARY KEY,          -- CATO original ID
  oggetto             TEXT,                        -- tender title/subject
  descrizione         TEXT,                        -- description
  sources             TEXT NOT NULL,               -- sub-source (sintel, sardegna, etc.)
  importo             NUMERIC,                    -- tender value in EUR
  numero_gara         TEXT,                        -- tender number
  stazione_appaltante TEXT,                        -- contracting authority
  tipo_procedura      TEXT,                        -- procedure type
  link_web            TEXT,                        -- link to original source
  is_rettifica        BOOLEAN DEFAULT false,       -- is a correction/amendment
  data_scadenza       TIMESTAMPTZ,                -- submission deadline
  luogo               TEXT,                        -- location (raw)
  created_at          TIMESTAMPTZ DEFAULT now(),   -- when first indexed by CATO
  scraped_at          TIMESTAMPTZ DEFAULT now(),   -- when we scraped it
  cig                 TEXT,                        -- CIG code
  provincia           TEXT,                        -- province/region (parsed)
  data_pubblicazione  TIMESTAMPTZ,                -- publication date
  codice_cpv          TEXT                         -- CPV codes (comma-separated)
);

-- 2. Add full-text search column
ALTER TABLE cato_tenders
  ADD COLUMN IF NOT EXISTS fts TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('italian', coalesce(oggetto, '') || ' ' || coalesce(descrizione, ''))
  ) STORED;

-- 3. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_cato_sources     ON cato_tenders (sources);
CREATE INDEX IF NOT EXISTS idx_cato_scadenza    ON cato_tenders (data_scadenza);
CREATE INDEX IF NOT EXISTS idx_cato_importo     ON cato_tenders (importo);
CREATE INDEX IF NOT EXISTS idx_cato_created     ON cato_tenders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cato_pubblicaz   ON cato_tenders (data_pubblicazione DESC);
CREATE INDEX IF NOT EXISTS idx_cato_fts         ON cato_tenders USING GIN (fts);

-- 4. Enable RLS (Row Level Security) — allow read from anon key
ALTER TABLE cato_tenders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cato_tenders_read" ON cato_tenders
  FOR SELECT USING (true);

CREATE POLICY "cato_tenders_service_write" ON cato_tenders
  FOR ALL USING (true) WITH CHECK (true);

-- 5. Comment
COMMENT ON TABLE cato_tenders IS
  'CATO (get-cato.com) tenders scraped via scripts/sync-cato.mjs. '
  'Indexed by sources (sub-platform) for instant filtering.';
