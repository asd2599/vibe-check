@echo off
setlocal

rem Builds a distributable zip of this project for another PC.
rem By design this INCLUDES the real .env (with the real OPENAI_API_KEY) so the other PC
rem can unzip and run start.bat with zero setup - see docs/architecture.md for why this
rem tradeoff was chosen over per-PC keys or a relay proxy. Set a spending limit on this key
rem at platform.openai.com before handing out the zip.
rem
rem Uses an explicit allow-list (copy exactly what's needed) instead of "copy everything
rem except node_modules/.next/etc" - this project's root has accumulated stray debris over
rem time (a literal file named "nul" from an old redirection mistake, a directory with an
rem invisible control character in its name, an old workspaces/ folder predating the
rem external-RUN_WORKSPACES_DIR convention) that broke a mirror-and-exclude robocopy (exit
rem code 9, confirmed by testing). An allow-list sidesteps all current AND future debris.
rem
rem ASCII-only, see start.bat's header comment for why.

cd /d "%~dp0"

set "PROJECT_NAME=VibeCheck"
set "STAGE_DIR=%TEMP%\vibecheck-package-staging"
set "OUT_ZIP=%USERPROFILE%\Desktop\VibeCheck-package.zip"
set "DEST=%STAGE_DIR%\%PROJECT_NAME%"

if exist "%STAGE_DIR%" rmdir /s /q "%STAGE_DIR%"
mkdir "%DEST%"

echo [VibeCheck] Copying project files...

for %%F in (CLAUDE.md .env .env.example .gitignore eslint.config.mjs next.config.ts next-env.d.ts package.json package-lock.json postcss.config.mjs prisma.config.ts start.bat package.bat tsconfig.json) do (
  if exist "%%F" copy /y "%%F" "%DEST%\" >nul
)

robocopy "docs" "%DEST%\docs" /E /NFL /NDL /NJH /NJS /NP >nul
robocopy "problems" "%DEST%\problems" /E /NFL /NDL /NJH /NJS /NP >nul
robocopy "public" "%DEST%\public" /E /NFL /NDL /NJH /NJS /NP >nul
robocopy "src" "%DEST%\src" /E /NFL /NDL /NJH /NJS /NP >nul
robocopy "prisma" "%DEST%\prisma" /E /XF dev.db /NFL /NDL /NJH /NJS /NP >nul
if exist ".claude" robocopy ".claude" "%DEST%\.claude" /E /NFL /NDL /NJH /NJS /NP >nul
if exist "scripts" robocopy "scripts" "%DEST%\scripts" /E /NFL /NDL /NJH /NJS /NP >nul

if exist "%OUT_ZIP%" del /f /q "%OUT_ZIP%"

echo [VibeCheck] Compressing to %OUT_ZIP% ...
powershell -NoProfile -Command ^
  "Compress-Archive -Path '%DEST%' -DestinationPath '%OUT_ZIP%' -CompressionLevel Optimal"
if errorlevel 1 (
  echo [VibeCheck] Compress-Archive failed.
  pause
  exit /b 1
)

rmdir /s /q "%STAGE_DIR%"

echo [VibeCheck] Done: %OUT_ZIP%
echo [VibeCheck] Reminder: this zip contains your real OPENAI_API_KEY. Set a spending
echo [VibeCheck] limit on it at platform.openai.com before sharing this file.
pause
endlocal
