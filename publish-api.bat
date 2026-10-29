@echo off
REM Install or refresh the API's public HTTPS address, with no password (every deploy does this too).
REM Runs vps\local.mjs; settings come from .local\deploy.local.json (never committed).
setlocal
pushd "%~dp0"
set "SUB=publish"

node vps\local.mjs %SUB%
set "RC=%ERRORLEVEL%"
popd
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause
exit /b %RC%
