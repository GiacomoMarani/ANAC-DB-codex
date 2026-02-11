-- Drop existing table and recreate with minimal schema (11 fields only)
DROP TABLE IF EXISTS cig CASCADE;

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

-- Create indexes for common queries
CREATE INDEX idx_cig_stato ON cig(stato);
CREATE INDEX idx_cig_provincia ON cig(provincia);
CREATE INDEX idx_cig_data_pubblicazione ON cig(data_pubblicazione DESC);
CREATE INDEX idx_cig_oggetto_gara ON cig USING GIN(to_tsvector('italian', oggetto_gara));

-- Enable RLS
ALTER TABLE cig ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access
CREATE POLICY "Allow public read access"
  ON cig
  FOR SELECT
  USING (true);

-- Policy: Allow insert/update for authenticated users (admin/service role can bypass RLS)
CREATE POLICY "Allow insert"
  ON cig
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update"
  ON cig
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
