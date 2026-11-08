@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo MTaxi Control - prueba local segura
echo ==========================================
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: No se encuentra Node.js.
  echo Instala la version LTS desde https://nodejs.org/ y vuelve a abrir este archivo.
  pause
  exit /b 1
)
echo.
node --version
set LOCAL_PREVIEW=true
set PORT=3000
set HOST=127.0.0.1
echo.
echo Abriendo MTaxi Control en http://localhost:3000
echo Esta prueba solo escucha en tu ordenador. No esta publicada en Internet.
echo Los datos de sincronizacion de prueba se guardan en data\local-records.json
echo Para detenerla, vuelve a esta ventana y pulsa Ctrl+C.
echo.
start "" "http://localhost:3000"
node server.mjs
pause
