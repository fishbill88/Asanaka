@echo off
REM Rotate the admin password now and show the new one. Pass -Show to only show the current one.
REM Runs vps\local.mjs; settings come from .local\deploy.local.json (never committed).
setlocal
pushd "%~dp0"
set "SUB=rotate-admin"
if /i "%~1"=="-Show" set "SUB=show-admin"
node vps\local.mjs %SUB%
set "RC=%ERRORLEVEL%"
popd
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause
exit /b %RC%
