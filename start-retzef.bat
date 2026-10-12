@echo off
setlocal
cd /d "%~dp0"
set "PORT=43123"
set "URL=http://localhost:%PORT%/"

where powershell >nul 2>&1
if errorlevel 1 goto fallback

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-retzef.ps1" -Port %PORT% -Root "%~dp0dist"
if "%ERRORLEVEL%"=="1" goto fallback
exit /b 0

:fallback
echo PowerShell did not start the server. Trying another way...
where npx >nul 2>&1
if errorlevel 1 goto python
start "" "%URL%"
npx --yes serve "%~dp0dist" -l %PORT%
exit /b 0

:python
where py >nul 2>&1
if errorlevel 1 goto python3
start "" "%URL%"
py -3 "%~dp0serve-retzef.py" %PORT% "%~dp0dist"
exit /b 0

:python3
where python >nul 2>&1
if errorlevel 1 goto failed
start "" "%URL%"
python "%~dp0serve-retzef.py" %PORT% "%~dp0dist"
exit /b 0

:failed
echo Could not start a server.
echo PowerShell is part of Windows. If it failed, install Node.js or Python and double-click this file again.
pause
exit /b 1
