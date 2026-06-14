@echo off
cd /d "%~dp0outputs\three-player-mahjong-prototype"
echo Anmika Rocket server check...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
  echo.
  echo Server is already running.
  echo PC URL: http://127.0.0.1:5173/
  echo LAN URL: http://192.168.10.107:5173/
  echo.
  pause
  exit /b 0
)
set "NODE_EXE=node"
if exist "C:\Users\h1320\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe" set "NODE_EXE=C:\Users\h1320\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe"
"%NODE_EXE%" static-server.mjs
pause
