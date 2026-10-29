@echo off
REM Create or update the accounts listed in .secrets/users.local.json (passwords go over SSH on stdin).
REM Runs vps\local.mjs; settings come from .local\deploy.local.json (never committed).
setlocal
pushd "%~dp0"
set "SUB=seed-users"

node vps\local.mjs %SUB%
set "RC=%ERRORLEVEL%"
popd
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause
exit /b %RC%
