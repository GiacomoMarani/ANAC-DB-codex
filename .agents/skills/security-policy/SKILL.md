---
name: security-policy
description: >-
  Policy di sicurezza e protezione anti-copia per ANAC-DB-codex.
  Usare SEMPRE quando si crea un nuovo file sorgente (.ts, .tsx, .mjs),
  quando si crea una nuova API route, quando si modifica la telemetria,
  o quando si discute di licenze, watermark e rilevamento copie.
  Attivare automaticamente per ogni nuovo file creato nel progetto.
---

# Security Policy — ANAC-DB-codex

Questa skill definisce le regole di sicurezza e protezione anti-copia che
**devono essere applicate a ogni sviluppo futuro** su questo progetto.

---

## 1. Licenza AGPL-3.0

Il progetto è sotto **GNU Affero General Public License v3.0**.

- Il file `LICENSE` nella root contiene il testo completo
- **Copyright**: Giacomo Marani (`ing.giacomo.marani@gmail.com`)
- **Foro competente**: Pisa, Italia
- Chiunque usi il codice come servizio web **deve** pubblicare il sorgente modificato

---

## 2. Header Copyright — OBBLIGATORIO su ogni file

Ogni file sorgente creato o modificato **DEVE** avere questo header come prime 4 righe:

```
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
```

### Regole:
- **Nuovi file** `.ts`, `.tsx`, `.mjs`: inserire l'header PRIMA di qualsiasi import
- **File SQL**: usare `--` come prefisso di commento invece di `//`
- **File YAML/YML**: usare `#` come prefisso di commento
- **NON** aggiungere l'header a file di terze parti (es. `components/ui/` da shadcn)
- **NON** aggiungere l'header a file di configurazione (`next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`)

---

## 3. Watermark UUID

Il watermark univoco del progetto è:

```
GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
```

Questo UUID:
- È presente nell'header di ogni file sorgente
- È nel `<meta name="generator">` dell'HTML (`app/layout.tsx`)
- È inviato dalla telemetria passiva
- È cercato dallo script `detect-copies.mjs`
- **NON deve essere cambiato MAI** — è l'identificativo univoco del progetto

---

## 4. Meta tag HTML

Il file `app/layout.tsx` contiene questi meta tag nel `<head>`:

```html
<meta name="generator" content="ANAC-DB-codex/GM-7f3a9c2e" />
<meta name="author" content="Giacomo Marani" />
<meta name="rights" content="AGPL-3.0 — https://github.com/GiacomoMarani/ANAC-DB-codex" />
```

- **NON rimuovere** questi tag
- Se si modifica il `<head>`, assicurarsi che restino presenti

---

## 5. Telemetria Passiva

### Come funziona
- File: `lib/telemetry.ts`
- Al primo caricamento in produzione, fa un POST silenzioso a Supabase
- Scrive nella tabella `telemetry_pings` con: watermark, hostname, version
- Fire-and-forget, nessun impatto su performance

### Env vars su Vercel
- `TELEMETRY_ENDPOINT` = `https://gfbbqvtjnmigatrplnhc.supabase.co/rest/v1/telemetry_pings`
- Usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` per l'autenticazione

### Tabella Supabase
```sql
telemetry_pings (
  id          BIGINT PRIMARY KEY (auto),
  watermark   TEXT NOT NULL,
  hostname    TEXT NOT NULL,
  version     TEXT,
  received_at TIMESTAMPTZ DEFAULT now()
)
```

### Monitoraggio
Per controllare deploy non autorizzati:
```sql
SELECT * FROM telemetry_pings
WHERE hostname NOT IN ('tender-ai-db.vercel.app', 'localhost')
ORDER BY received_at DESC;
```

---

## 6. Script Detect-Copies

- File: `scripts/detect-copies.mjs`
- Comando: `npm run detect-copies`
- Cerca su GitHub Code Search il watermark e nomi unici del progetto
- Segnala qualsiasi repo (non il nostro) che contenga codice copiato

### Stringhe cercate:
1. Il watermark UUID
2. `ANAC-DB-codex` (nome progetto)
3. `fetchItaFromDB` (funzione unica)
4. `ITA_SOURCE_MAP` (costante unica)
5. `sync-ita.mjs` (script unico)
6. `intl_created_at` (colonna DB unica)

---

## 7. Google Alerts

Impostare alert su [google.com/alerts](https://www.google.com/alerts) per:
- `"GM-ANAC-7f3a9c2e"` — il watermark abbreviato
- `"ANAC-DB-codex"` — il nome progetto

---

## 8. Checklist per nuovi sviluppi

Quando crei un nuovo file sorgente:
- [ ] Aggiungi l'header copyright (sezione 2)
- [ ] Verifica che il watermark UUID sia corretto
- [ ] Se è una API route, assicurati che la telemetria funzioni

Quando crei un nuovo script di sync:
- [ ] Header copyright
- [ ] Se scrive in una nuova tabella, aggiungi la tabella allo script detect-copies

Quando modifichi `layout.tsx`:
- [ ] Verifica che i meta tag (sezione 4) siano ancora presenti
- [ ] Verifica che `telemetryPing()` sia ancora chiamato

---

## 9. Infrastruttura attuale

| Servizio | ID / URL |
|----------|----------|
| Supabase Project | `gfbbqvtjnmigatrplnhc` |
| Supabase URL | `https://gfbbqvtjnmigatrplnhc.supabase.co` |
| Vercel Project | `prj_hvvSNfz9nXyt0keHB043IgAj009Y` |
| Vercel App | `tender-ai-db` |
| GitHub Repo | `GiacomoMarani/ANAC-DB-codex` |
| Email contatto | `ing.giacomo.marani@gmail.com` |
| Foro competente | Pisa, Italia |
