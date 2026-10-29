@echo off
REM Deploy the API to the VPS (rebuilds the api container; the database is untouched).
REM Runs vps\local.mjs; settings come from .local\deploy.local.json (never committed).
setlocal
pushd "%~dp0"
set "SUB=deploy"

node vps\local.mjs %SUB%
set "RC=%ERRORLEVEL%"
popd
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause
exit /b %RC%
