@echo off
cd /d C:\Users\UTENTE\Desktop\DEV\ANAC-DB-codex-main

echo ══════════════════════════════════════════════════════════
echo   ANAC Sync Completo — %date% %time%
echo ══════════════════════════════════════════════════════════

echo.
echo [1/2] Sync bandi da ANAC (Superset)...
node sync-anac.mjs
if %ERRORLEVEL% NEQ 0 (
  echo ⚠️  sync-anac.mjs terminato con errore (codice %ERRORLEVEL%) — continuo con UUID sync
)

echo.
echo [2/2] Sync UUID da PVL (pubblicitalegale)...
node sync-anac-uuid.mjs
if %ERRORLEVEL% NEQ 0 (
  echo ⚠️  sync-anac-uuid.mjs terminato con errore (codice %ERRORLEVEL%)
)

echo.
echo ══════════════════════════════════════════════════════════
echo   Sync completato — %date% %time%
echo ══════════════════════════════════════════════════════════
