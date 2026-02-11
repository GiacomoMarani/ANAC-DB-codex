-- Fix column lengths to accommodate ANAC data
-- Increase VARCHAR limits for fields that may have long values

-- Alter column lengths to TEXT where needed for longer values
ALTER TABLE cig ALTER COLUMN numero_gara TYPE VARCHAR(500);
ALTER TABLE cig ALTER COLUMN provincia TYPE VARCHAR(255);
ALTER TABLE cig ALTER COLUMN sezione_regionale TYPE VARCHAR(255);
ALTER TABLE cig ALTER COLUMN tipo_scelta_contraente TYPE TEXT;
ALTER TABLE cig ALTER COLUMN modalita_realizzazione TYPE TEXT;
ALTER TABLE cig ALTER COLUMN cf_amministrazione_appaltante TYPE VARCHAR(100);
ALTER TABLE cig ALTER COLUMN cod_cpv TYPE VARCHAR(50);
ALTER TABLE cig ALTER COLUMN cod_esito TYPE VARCHAR(50);
ALTER TABLE cig ALTER COLUMN esito TYPE TEXT;
ALTER TABLE cig ALTER COLUMN settore TYPE TEXT;

-- Recreate index on esito if needed
DROP INDEX IF EXISTS idx_esito;
