-- ============================================================================
-- ANAC-DB: Full-Text Search Migration per Supabase
-- ============================================================================
-- Esegui questo script nel Supabase SQL Editor per abilitare la ricerca
-- full-text con ranking di rilevanza, molto più veloce di ILIKE %word%.
--
-- ISTRUZIONI:
-- 1. Apri il Supabase Dashboard → SQL Editor
-- 2. Incolla questo script e premi "Run"
-- 3. La colonna search_vector verrà creata e popolata automaticamente
-- ============================================================================

-- 1. Aggiungere colonna tsvector
ALTER TABLE cig ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Popolare la colonna per tutti i record esistenti
UPDATE cig SET search_vector = 
  to_tsvector('italian', 
    coalesce(oggetto_gara, '') || ' ' || 
    coalesce(cig, '') || ' ' || 
    coalesce(descrizione_cpv, '') || ' ' ||
    coalesce(denominazione_amministrazione_appaltante, '')
  );

-- 3. Creare indice GIN per ricerca veloce
CREATE INDEX IF NOT EXISTS idx_cig_search_vector 
  ON cig USING GIN(search_vector);

-- 4. Trigger per aggiornamento automatico su INSERT/UPDATE
CREATE OR REPLACE FUNCTION cig_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('italian', 
    coalesce(NEW.oggetto_gara, '') || ' ' || 
    coalesce(NEW.cig, '') || ' ' || 
    coalesce(NEW.descrizione_cpv, '') || ' ' ||
    coalesce(NEW.denominazione_amministrazione_appaltante, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cig_search_vector_update ON cig;
CREATE TRIGGER trg_cig_search_vector_update
  BEFORE INSERT OR UPDATE ON cig
  FOR EACH ROW EXECUTE FUNCTION cig_search_vector_update();

-- 5. Funzione RPC per ricerca con ranking (opzionale, per uso futuro)
CREATE OR REPLACE FUNCTION search_cig(
  search_query text,
  result_limit int DEFAULT 20,
  result_offset int DEFAULT 0
)
RETURNS TABLE (
  id bigint,
  cig text,
  oggetto_gara text,
  importo_lotto numeric,
  stato text,
  provincia text,
  data_pubblicazione timestamptz,
  data_scadenza_offerta timestamptz,
  sezione_regionale text,
  oggetto_principale_contratto text,
  descrizione_cpv text,
  denominazione_amministrazione_appaltante text,
  anac_id_avviso text,
  esito text,
  rank real
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id, c.cig, c.oggetto_gara, c.importo_lotto,
    c.stato, c.provincia, c.data_pubblicazione,
    c.data_scadenza_offerta, c.sezione_regionale,
    c.oggetto_principale_contratto, c.descrizione_cpv,
    c.denominazione_amministrazione_appaltante, c.anac_id_avviso,
    c.esito,
    ts_rank(c.search_vector, plainto_tsquery('italian', search_query)) AS rank
  FROM cig c
  WHERE c.search_vector @@ plainto_tsquery('italian', search_query)
  ORDER BY rank DESC
  LIMIT result_limit OFFSET result_offset;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICA: testa la ricerca
-- ============================================================================
-- SELECT * FROM search_cig('servizi informatici', 10, 0);
