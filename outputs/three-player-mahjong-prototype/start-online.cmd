@echo off
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "C:\Users\h1320\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe" set "NODE_EXE=C:\Users\h1320\AppData\Local\OpenAI\Codex\bin\5b9024f90663758b\node.exe"
"%NODE_EXE%" static-server.mjs
pause
