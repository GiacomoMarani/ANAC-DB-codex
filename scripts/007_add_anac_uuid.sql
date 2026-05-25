-- Aggiunge il campo UUID del bando su pubblicitalegale.anticorruzione.it
-- Questo permette di generare link diretti al bando ANAC (es. /bandi/{uuid})
ALTER TABLE cig ADD COLUMN IF NOT EXISTS anac_id_avviso VARCHAR(100);
