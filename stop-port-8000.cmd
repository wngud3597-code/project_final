@echo off
setlocal EnableExtensions
echo Searching for a process listening on port 8000...
set "FOUND="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr LISTENING ^| findstr ":8000"') do (
  set "FOUND=1"
  echo Stopping PID %%P...
  taskkill /PID %%P /F
)

if not defined FOUND (
  echo Port 8000 is already free.
)

echo.
pause
endlocal
