@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ==================================================
echo LocalHub Netlify safe deploy
echo ==================================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 goto no_node
for /f "tokens=1 delims=." %%V in ('node.exe -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 18 goto old_node

echo [1/5] Checking required deployment files...
if not exist "netlify.toml" goto missing_file
if not exist "netlify\functions\api.mjs" goto missing_file
if not exist "frontend\index.html" goto missing_file
if not exist "frontend\app.js" goto missing_file
if not exist "frontend\styles.css" goto missing_file
if not exist "scripts\verify-netlify.mjs" goto missing_file
for %%F in (data\*.json) do set /a DATA_COUNT+=1
if not "%DATA_COUNT%"=="7" goto bad_data

echo [2/5] Checking JavaScript syntax...
node.exe --check "frontend\app.js"
if errorlevel 1 goto verify_failed
node.exe --check "frontend\loader.js"
if errorlevel 1 goto verify_failed
node.exe --check "netlify\functions\api.mjs"
if errorlevel 1 goto verify_failed

echo [3/5] Testing Netlify API and 6,518 tourism items...
node.exe "scripts\verify-netlify.mjs"
if errorlevel 1 goto verify_failed

echo [4/5] Preflight passed.
if /I "%~1"=="verify" (
  echo.
  echo PASS: Ready for Netlify deployment.
  exit /b 0
)

echo.
echo Choose deployment type:
echo   1. Preview deploy - safe test URL (recommended)
echo   2. Production deploy - replaces the public site
echo   3. Cancel
echo.
choice /C 123 /N /M "Select 1, 2, or 3: "
if errorlevel 3 goto cancelled
if errorlevel 2 goto confirm_production
goto preview

:preview
echo.
echo [5/5] Starting preview deployment...
call npx.cmd --yes netlify-cli@latest deploy
if errorlevel 1 goto deploy_failed
goto deployed

:confirm_production
echo.
echo WARNING: This replaces the currently published production site.
set /p "CONFIRM=Type DEPLOY to continue: "
if /I not "%CONFIRM%"=="DEPLOY" goto cancelled
echo [5/5] Starting production deployment...
call npx.cmd --yes netlify-cli@latest deploy --prod
if errorlevel 1 goto deploy_failed
goto deployed

:deployed
echo.
echo ==================================================
echo Deployment completed.
echo Open the URL printed above and verify /api/health.
echo ==================================================
echo.
pause
exit /b 0

:no_node
echo ERROR: Node.js 18.14 or newer is required.
echo Download: https://nodejs.org/
goto failed

:old_node
echo ERROR: Node.js 18.14 or newer is required. Current major: %NODE_MAJOR%
goto failed

:missing_file
echo ERROR: A required deployment file is missing.
goto failed

:bad_data
echo ERROR: Expected 7 tourism JSON files, found %DATA_COUNT%.
goto failed

:verify_failed
echo ERROR: Pre-deployment verification failed. Nothing was deployed.
goto failed

:deploy_failed
echo ERROR: Netlify deployment failed. The existing production site was not changed by a preview deploy.
echo Check your internet connection and Netlify login, then retry.
goto failed

:cancelled
echo Deployment cancelled. No site was changed.
exit /b 0

:failed
echo.
pause
exit /b 1
