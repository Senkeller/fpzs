@echo off
title Invoice Print Helper - Portable
cd /d "%~dp0"
echo.
echo   Invoice Print Helper - Portable Launcher
echo   ----------------------------------------
echo.

if exist "%~dp0runtime\node.exe" (
  echo   Using bundled Node.js runtime ...
  "%~dp0runtime\node.exe" portable-server.js
  goto done
)

where node >nul 2>&1
if %errorlevel%==0 (
  echo   Using system Node.js ...
  node portable-server.js
  goto done
)

if exist "%~dp0dist\InvoiceHelper.exe" (
  echo   Node.js not found. Launching standalone exe instead ...
  "%~dp0dist\InvoiceHelper.exe"
  goto done
)

echo   [ERROR] Node.js was not found on this computer.
echo.
echo   Options:
echo     1. Run:  node build-exe.js   to build dist\InvoiceHelper.exe
echo     2. Install Node.js from https://nodejs.org and run this file again
echo.

:done
echo.
echo   Server stopped. Press any key to close this window.
pause >nul
