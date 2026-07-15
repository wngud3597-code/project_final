@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo LocalHub FINAL verification
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
echo [1/5] Checking Python...
%PY_CMD% --version
if errorlevel 1 goto failed

echo [2/5] Checking for old ZoneInfo code...
findstr /C:"ZoneInfo(" "backend\weather_service.py" >nul 2>nul
if not errorlevel 1 goto old_file
findstr /C:"from zoneinfo import ZoneInfo" "backend\weather_service.py" >nul 2>nul
if not errorlevel 1 goto old_file
echo PASS: No old ZoneInfo code found.

echo [3/5] Compiling Python files...
%PY_CMD% -m compileall -q backend
if errorlevel 1 goto failed

echo [4/5] Running all tests...
%PY_CMD% -m unittest discover -s backend\tests -v
if errorlevel 1 goto failed

echo [5/5] Checking required frontend files...
if not exist "frontend\index.html" goto missing_file
if not exist "frontend\app.js" goto missing_file
if not exist "frontend\styles.css" goto missing_file
if not exist "backend\chat_service.py" goto missing_file

echo.
echo ================================================
echo PASS: This is the corrected LocalHub project.
echo Folder: %CD%
echo ================================================
echo.
pause
exit /b 0

:old_file
echo.
echo ERROR: OLD weather_service.py detected.
echo You are not using the corrected project.
echo Use the folder named LOCALHUB_FIXED_20260715.
echo.
pause
exit /b 1

:missing_file
echo.
echo ERROR: Required frontend files are missing.
echo Extract the ZIP again into a new empty folder.
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
echo ERROR: Verification failed. Read the error above.
echo.
pause
exit /b 1
