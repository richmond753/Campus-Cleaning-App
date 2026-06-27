@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"
if not exist .env copy .env.example .env

echo Checking MySQL (XAMPP)...
tasklist /FI "IMAGENAME eq mysqld.exe" 2>nul | find /I "mysqld.exe" >nul
if errorlevel 1 (
  echo Starting MySQL via XAMPP...
  start "" /B "C:\xampp\mysql\bin\mysqld.exe" --defaults-file=C:\xampp\mysql\bin\my.ini
  timeout /t 4 /nobreak >nul
)

call npm install
echo.
echo Starting CampusClean Connect...
node server.js
