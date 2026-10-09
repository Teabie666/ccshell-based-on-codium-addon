@echo off
rem Development launcher: double-click in Explorer to build and start ccshell.
rem Extra arguments are passed through, e.g.  run-dev.cmd C:\path\to\project
cd /d "%~dp0"
call npm run build --silent
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
rem Shells started from a VS Code-family extension host leak this variable.
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." %*
