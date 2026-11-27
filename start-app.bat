@echo off
title BM Daily Intel — HDFC Bank Panchkula (8:00 PM IST Desk)
cd /d "%~dp0"
echo Starting BM Daily Intel local server...
start "" http://localhost:8080
node server.js
pause
