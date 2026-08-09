@echo off
title Sam Cloud IDE - Project Runner
color 0A
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ============================================
echo   Starting project in: %CD%
echo ============================================
echo.

:: 1. Verify Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please download it from https://nodejs.org
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo [OK] Node %%v
for /f "delims=" %%v in ('npm -v') do echo [OK] npm  %%v
echo.

:: 2. Ensure package.json exists
if not exist "package.json" (
    echo [ERROR] package.json not found in %CD%
    pause
    exit /b 1
)

:: 3. Fast check for node_modules
if exist "node_modules\" (
    echo [OK] node_modules exists. Skipping full re-install...
) else (
    echo [INSTALL] Installing dependencies... This may take 2-3 minutes.
    echo.
    call npm install --loglevel=info --fetch-timeout=600000
)

if errorlevel 1 (
    echo.
    echo [WARN] npm install encountered an error. Retrying with --legacy-peer-deps...
    call npm install --legacy-peer-deps
)

echo.
echo ============================================
echo   [DONE] Dependencies ready!
echo ============================================
echo.

:: 4. Auto-detect start command (Vite / React / Node)
if exist "vite.config.ts" (
    echo [STARTING] Launching Vite Dev Server...
    call npm run dev
) else if exist "vite.config.js" (
    echo [STARTING] Launching Vite Dev Server...
    call npm run dev
) else (
    echo [STARTING] Starting server via npm start...
    call npm start
)

echo.
echo [STOPPED] Server process ended.
pause
