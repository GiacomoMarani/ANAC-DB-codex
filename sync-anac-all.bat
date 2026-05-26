@echo off
cd /d C:\Users\UTENTE\Desktop\DEV\ANAC-DB-codex-main

echo ══════════════════════════════════════════════════════════
echo   ANAC Sync Completo — %date% %time%
echo ══════════════════════════════════════════════════════════

echo.
echo [1/2] Sync bandi da ANAC (Superset)...
call node sync-anac.mjs
echo     → sync-anac.mjs terminato (codice: %ERRORLEVEL%)

echo.
echo [2/2] Sync UUID da PVL (pubblicitalegale)...
call node sync-anac-uuid.mjs
echo     → sync-anac-uuid.mjs terminato (codice: %ERRORLEVEL%)

echo.
echo ══════════════════════════════════════════════════════════
echo   Sync completato — %date% %time%
echo ══════════════════════════════════════════════════════════
