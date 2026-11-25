@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js blev ikke fundet. Denne app kraever Node.js 24 eller nyere.
  pause
  exit /b 1
)
node.exe --disable-warning=ExperimentalWarning src\server\server.mjs
if errorlevel 1 (
  echo.
  echo Appen kunne ikke starte. Se fejlbeskeden ovenfor.
  pause
)
