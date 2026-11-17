@echo off
chcp 65001 >nul
rem Bấm đúp file này để chạy web. Không cần mở terminal hay cd.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi bam dup lai file nay.
  pause
  exit /b 1
)
if not exist ".env" copy ".env.example" ".env" >nul
set OPEN_BROWSER=1
node server.js
pause
