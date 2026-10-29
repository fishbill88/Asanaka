@echo off
REM One time: put the API on its public HTTPS address. Asks for your sudo password; restarts Caddy (~1 second for every site on the box).
REM Runs vps\local.mjs; settings come from .local\deploy.local.json (never committed).
setlocal
pushd "%~dp0"
set "SUB=host-setup"

node vps\local.mjs %SUB%
set "RC=%ERRORLEVEL%"
popd
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause
exit /b %RC%
