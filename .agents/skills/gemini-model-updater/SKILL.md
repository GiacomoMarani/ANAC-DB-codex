---
name: gemini-model-updater
description: >-
  Mantiene aggiornata la configurazione dei modelli Gemini nelle chiamate API.
  Consulta la documentazione ufficiale Google AI per identificare i modelli più
  recenti con Free Tier, verifica disponibilità e grounding, e aggiorna i file
  sorgente del progetto. Attivare quando l'utente chiede di aggiornare i modelli,
  verificare la disponibilità free tier, o quando un modello restituisce errori
  di deprecazione (404/shutdown).
---

# Gemini Model Updater

## Overview

Skill di manutenzione che mantiene aggiornata la chain dei modelli Gemini nei
progetti. Consulta la documentazione ufficiale Google AI, verifica il Free Tier,
e aggiorna i file sorgente con i modelli corretti.

## Vincoli Chiave (da verificare ad ogni esecuzione)

> [!CAUTION]
> **Google Search Grounding** sul Free Tier è disponibile SOLO per la famiglia
> `gemini-2.5-*`. I modelli 3.x richiedono il Paid Tier per il grounding.
> Questo vincolo determina l'architettura a doppia chain.

> [!WARNING]
> Le quote sono **per-progetto** (Google Cloud Project), non per API key.
> Più chiavi nello stesso progetto condividono la stessa pool di quota.

> [!WARNING]
> Google depreca e spegne modelli regolarmente. Controllare SEMPRE la pagina
> deprecazioni prima di aggiornare.

## Workflow

### 1. Consultare la Documentazione Ufficiale

Leggere queste pagine nell'ordine indicato:

1. **Pagina Modelli**: `https://ai.google.dev/gemini-api/docs/models`
   - Elenco completo dei modelli disponibili con Model ID
   - Identificare i modelli **Stable** (non Preview) della famiglia Flash

2. **Pagina Deprecazioni**: `https://ai.google.dev/gemini-api/docs/deprecations`
   - Verificare quali modelli sono stati spenti o in fase di shutdown
   - Rimuovere IMMEDIATAMENTE modelli spenti dalla chain

3. **Pagina Pricing**: `https://ai.google.dev/gemini-api/docs/pricing`
   - Per ogni modello candidato verificare la colonna **Free Tier**
   - Annotare RPM, RPD, TPM per il Free Tier
   - Verificare supporto **Google Search Grounding** su Free Tier

4. **Pagina Rate Limits**: `https://ai.google.dev/gemini-api/docs/rate-limits`
   - Confermare i limiti attuali del Free Tier
   - Verificare eventuali limiti condivisi tra modelli

### 2. Compilare la Tabella Modelli

Creare una tabella con tutti i modelli Flash text-only (no Image, Live, TTS,
Transcribe) ordinati per generazione (più recente prima):

```markdown
| Model ID              | Free Tier | RPM | RPD   | TPM       | Grounding Free | Status  |
|-----------------------|-----------|-----|-------|-----------|----------------|---------|
| gemini-X.Y-flash      | ✅/❌     | N   | N     | N         | ✅/❌          | Stable  |
```

### 3. Costruire le Chain

Costruire DUE chain separate:

#### Chain Streaming (FALLBACK_MODELS)
Per la generazione di testo senza grounding. Priorità: modelli più capaci
(generazione più alta) → più leggeri (quota più alta).

Regole:
- Solo modelli con Free Tier = ✅
- Solo modelli con Status = Stable (no Preview)
- Il `DEFAULT_MODEL` è sempre il primo della chain
- Massimo 5 modelli nella chain (troppi allungano i tempi di fallback)
- Preferire modelli `-lite` in fondo (quota RPM spesso doppia)

#### Chain Grounding (GROUNDING_MODELS)
Per le chiamate con Google Search Grounding. Usata dalla funzione
`analyzeWithStreamingAndGrounding()`.

Regole:
- Solo modelli con Grounding Free = ✅
- Ad oggi (2026-09) solo la famiglia `gemini-2.5-*` supporta grounding free
- Verificare ad ogni aggiornamento se Google ha esteso il grounding free ai 3.x

### 4. Aggiornare i File Sorgente

Cercare nel progetto i file che contengono la configurazione dei modelli:

```bash
# Trova tutti i file con definizioni di modelli Gemini
grep -r "gemini-[0-9]" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .
```

File tipici da aggiornare:
- `lib/ai/gemini-client.ts` — `DEFAULT_MODEL`, `FALLBACK_MODELS`, `GROUNDING_MODELS`
- `app/gare/gare-list-client.tsx` — eventuali riferimenti inline
- API routes (`api/edge/analyze-site`) — modelli server-side

Per ogni file:
1. Aggiornare i Model ID
2. Aggiornare la tabella RPM/RPD/TPM nei commenti JSDoc
3. Aggiornare la data "Last updated" nei commenti
4. Rimuovere modelli deprecati/spenti

### 5. Verificare la Build

```bash
# Next.js (ANAC-DB-codex)
node node_modules\next\dist\bin\next build

# Express (Tender AI Render)
node server/server.js  # verify no import errors
```

### 6. Documentare il Cambiamento

Aggiornare il commento "Last updated" nel file con la data attuale e la fonte:
```typescript
// Last updated: YYYY-MM-DD from https://ai.google.dev/gemini-api/docs/models
```

## Common Mistakes

1. **Usare modelli 3.x per grounding free** — il grounding su free tier è solo
   per 2.5-*. Usare 3.x causa errore silenzioso (risposta senza fonti).

2. **Dimenticare modelli spenti** — Google spegne modelli vecchi senza preavviso
   lungo. Controllare SEMPRE `/docs/deprecations` prima di aggiornare.

3. **Confondere quote per-key vs per-progetto** — le quote sono per Google Cloud
   Project, non per API key. Avere 10 chiavi non dà 10x la quota.

4. **Inserire modelli Preview** nella chain di produzione — i Preview possono
   cambiare comportamento o essere rimossi senza preavviso. Usare solo Stable.
