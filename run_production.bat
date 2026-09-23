@echo off
setlocal
if not exist .env (
  echo Missing .env. Copy .env.example to .env and set production secrets.
  exit /b 1
)
docker compose up --build -d
if errorlevel 1 exit /b 1
echo JAL-DRISHTI is available at the configured APP_PORT.
