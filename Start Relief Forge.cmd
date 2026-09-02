@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing Relief Forge dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Check the error above, then press any key to close.
    pause >nul
    exit /b 1
  )
)

echo Starting Relief Forge at http://127.0.0.1:4173
echo Keep this window open while using the app. Press Ctrl+C here to stop it.
call npm run dev
