-- Optimize indexes for common queries
-- Drop existing indexes that may not be optimal
DROP INDEX IF EXISTS idx_cig_data_pubblicazione;
DROP INDEX IF EXISTS idx_cig_stato;
DROP INDEX IF EXISTS idx_cig_anno;

-- Create optimized composite index for the main query (ORDER BY data_pubblicazione DESC)
CREATE INDEX IF NOT EXISTS idx_cig_data_pub_desc ON cig (data_pubblicazione DESC NULLS LAST);

-- Create composite index for filtered queries
CREATE INDEX IF NOT EXISTS idx_cig_stato_data ON cig (stato, data_pubblicazione DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_cig_anno_data ON cig (anno_pubblicazione, data_pubblicazione DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_cig_provincia_data ON cig (provincia, data_pubblicazione DESC NULLS LAST);

-- Analyze the table to update statistics for query planner
ANALYZE cig;
