@echo off
title Install BM INTEL Daily 8:00 PM IST Background Agent
echo ====================================================================
echo  Installing Dedicated 8:00 PM IST Senior BM Signal Editor Agent
echo ====================================================================
echo.
set "SCRIPT_PATH=%~dp0scripts\fetch-intel.js"
schtasks /Create /TN "BM_Intel_Daily_8PM_Agent" /TR "node \"%SCRIPT_PATH%\"" /SC DAILY /ST 20:00 /F
if %errorlevel%==0 (
  echo.
  echo [SUCCESS] Your dedicated agent "BM_Intel_Daily_8PM_Agent" is now
  echo scheduled to run automatically every day at 8:00 PM IST!
  echo.
  echo To remove it anytime, run:
  echo   schtasks /Delete /TN "BM_Intel_Daily_8PM_Agent" /F
) else (
  echo.
  echo [INFO] Could not register Windows Task automatically. You can right-click
  echo this file and choose "Run as Administrator" or use the built-in scheduler
  echo inside server.js / GitHub Actions cloud cron.
)
echo.
pause
