@echo off
setlocal

rem VibeCheck one-click launcher.
rem Assumes Node.js, VS Code, and Claude Code CLI (already logged in) are installed on this PC.
rem This script does not install any of those.
rem
rem Use package.bat to build a distributable zip for another PC - see docs/architecture.md
rem for exactly what it includes/excludes (it intentionally ships the real .env, by design).
rem This file is written in plain ASCII only (no Korean text, no em-dashes/smart quotes)
rem because non-ASCII bytes in a .bat file can silently break cmd.exe's parser depending
rem on the active console codepage, causing the window to flash and close instantly with
rem no visible error - confirmed as the actual cause of an earlier version of this script.

cd /d "%~dp0"

if not exist ".env" (
  echo [VibeCheck] .env not found, creating it from .env.example
  copy /y ".env.example" ".env" >nul
  echo [VibeCheck] To enable LLM grading, open .env and set OPENAI_API_KEY.
  echo [VibeCheck] It's fine to leave it empty - the app still runs, and the dashboard
  echo [VibeCheck] will show a banner saying only tests/efficiency are measured.
)

if not exist "node_modules" (
  echo [VibeCheck] Installing dependencies, first run only, may take a few minutes...
  call npm install
  if errorlevel 1 (
    echo [VibeCheck] npm install failed. Make sure Node.js is installed and on PATH.
    pause
    exit /b 1
  )
)

echo [VibeCheck] Applying database schema...
call npx prisma migrate deploy
if errorlevel 1 (
  echo [VibeCheck] prisma migrate deploy failed.
  pause
  exit /b 1
)

echo [VibeCheck] Starting the server in a new window...
start "VibeCheck Server" cmd /k "npm run dev -- -p 3000"

echo [VibeCheck] Waiting for the server to respond...
powershell -NoProfile -Command ^
  "$ok = $false;" ^
  "for ($i = 0; $i -lt 60; $i++) {" ^
  "  try { Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true; break }" ^
  "  catch { Start-Sleep -Seconds 1 }" ^
  "}" ^
  "if ($ok) { Start-Process 'http://localhost:3000' } else { Write-Host '[VibeCheck] Server did not respond within 60s - check the VibeCheck Server window for errors.' }"

echo [VibeCheck] Done. You can close this window - the server keeps running in the "VibeCheck Server" window.
pause
endlocal
