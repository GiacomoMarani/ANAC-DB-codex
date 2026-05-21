---
name: sync-anac-supabase
description: >-
  Sincronizza i bandi in corso da ANAC (dati.anticorruzione.it) verso il
  database Supabase del progetto Tender AI DB. Usa Playwright per scaricare
  i dati dalla dashboard ANAC Superset, poi upserta su Supabase e chiude
  i bandi non più attivi. Invocare quando l'utente chiede di aggiornare,
  sincronizzare o refreshare i dati ANAC nel database.
---

# Sync ANAC → Supabase

## Overview

Questa skill esegue lo script `sync-anac.mjs` presente nella root del progetto
**Tender AI DB** per sincronizzare i bandi in corso dall'ANAC verso Supabase.

Lo script:
1. Avvia Playwright (Chromium headless)
2. Si connette alla dashboard ANAC Superset (datasource 81)
3. Scarica tutti i bandi in corso paginando a blocchi di 500
4. Upserta i record su Supabase (tabella `cig`, chiave `cig`)
5. Marca come `closed` i bandi non più presenti su ANAC

## Prerequisites

- **Node.js** installato e disponibile nel PATH
- **Playwright** installato (`npx playwright install chromium`)
- File `.env.local` nella root del progetto con:
  - `NEXT_PUBLIC_SUPABASE_URL` — URL del progetto Supabase
  - `SUPABASE_SERVICE_ROLE_KEY` — Service role key di Supabase
- Connessione internet (accede a `dati.anticorruzione.it`)

## Quick Start

### Sync completo (tutti i bandi in corso)

```bash
node sync-anac.mjs
```

### Sync limitato (test con pochi record)

```bash
node sync-anac.mjs --limit 50
```

### Sync con filtro testuale

```bash
node sync-anac.mjs --query "scuola"
```

## Workflow

Quando l'utente chiede di aggiornare i dati ANAC, segui questi passi:

### 1. Verifica prerequisiti

Controlla che il file `.env.local` esista nella root del progetto e contenga
`NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

```bash
# Verifica che le variabili siano presenti
Select-String -Path ".env.local" -Pattern "NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY"
```

### 2. Esegui la sincronizzazione

Lancia lo script dalla root del progetto. Il comando può richiedere
diversi minuti (5-15 min per un sync completo di ~9000 bandi).

```bash
node sync-anac.mjs
```

> [!IMPORTANT]
> Lo script deve essere eseguito dalla directory root del progetto
> (`ANAC-DB-codex-main`). NON usare `cd`, specifica il `Cwd` corretto.

### 3. Verifica il risultato

L'output dello script mostra un riepilogo finale con:
- Numero di bandi scaricati da ANAC
- Numero di bandi aggiornati su Supabase
- Numero di bandi chiusi (non più attivi)
- Tempo totale

### 4. Verifica su Supabase (opzionale)

Puoi verificare il conteggio dei bandi attivi con una query API:

```bash
node -e "
const {createClient}=require('@supabase/supabase-js');
const fs=require('fs');
const env=fs.readFileSync('.env.local','utf-8');
const url=env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim();
const key=env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
const sb=createClient(url,key);
sb.from('cig').select('cig',{count:'exact',head:true}).eq('stato','active')
  .then(({count})=>console.log('Bandi attivi su Supabase:',count));
"
```

## Scheduling

Per mantenere i dati aggiornati, lo script dovrebbe essere schedulato:

### Windows Task Scheduler
- **Programma:** `node`
- **Argomenti:** `sync-anac.mjs`
- **Inizio in:** `C:\...\ANAC-DB-codex-main`
- **Frequenza:** ogni 6 ore

### Linux/Mac (crontab)
```cron
0 */6 * * * cd /path/to/ANAC-DB-codex-main && node sync-anac.mjs >> sync.log 2>&1
```

## Common Mistakes

1. **Errore "CSRF token vuoto"**: ANAC potrebbe bloccare richieste troppo
   frequenti (WAF). Aspettare qualche minuto e riprovare.

2. **Errore "WAF block — risposta non-JSON"**: Il firewall di ANAC ha bloccato
   la richiesta. Aspettare 5-10 minuti prima di riprovare.

3. **Timeout durante il download**: La dashboard ANAC può essere lenta.
   Lo script gestisce timeout di 60s per pagina. Se persiste, provare
   con `--limit 100` per un test ridotto.

4. **Playwright non installato**: Eseguire `npx playwright install chromium`
   prima del primo utilizzo.
