@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo LocalHub FINAL - Vue 3 / Tourism / Weather / Map
echo ================================================
echo.

py.exe -3 --version >nul 2>nul
if not errorlevel 1 goto use_py
python.exe --version >nul 2>nul
if not errorlevel 1 goto use_python
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "(Get-Command python.exe -ErrorAction SilentlyContinue).Source"`) do set "PY_CMD=%%P"
if defined PY_CMD goto found_python
goto no_python

:use_py
set "PY_CMD=py.exe -3"
goto found_python

:use_python
set "PY_CMD=python.exe"
goto found_python

:found_python
echo [1/4] Checking corrected weather file...
findstr /C:"ZoneInfo(" "backend\weather_service.py" >nul 2>nul
if not errorlevel 1 goto old_file
findstr /C:"from zoneinfo import ZoneInfo" "backend\weather_service.py" >nul 2>nul
if not errorlevel 1 goto old_file

echo [2/4] Removing old Python cache...
for /D /R "backend" %%D in (__pycache__) do @if exist "%%D" rmdir /S /Q "%%D" >nul 2>nul

echo [3/4] Running safety verification...
%PY_CMD% -m compileall -q backend
if errorlevel 1 goto failed
%PY_CMD% -m unittest discover -s backend\tests -q
if errorlevel 1 goto failed

echo [4/4] Starting LocalHub...
echo.
echo Open: http://127.0.0.1:8000
echo Keep this window open.
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000'"
cd backend
%PY_CMD% server.py
if errorlevel 1 goto run_failed
goto end

:old_file
echo.
echo ERROR: OLD ZoneInfo code detected.
echo You opened the wrong folder.
echo Use LOCALHUB_FIXED_20260715 only.
echo.
pause
exit /b 1

:no_python
echo.
echo ERROR: Python was not found.
echo.
pause
exit /b 1

:failed
echo.
echo ERROR: Safety verification failed.
echo.
pause
exit /b 1

:run_failed
echo.
echo ERROR: Server could not start.
echo Another program may already be using port 8000.
echo.
pause
exit /b 1

:end
pause
endlocal
