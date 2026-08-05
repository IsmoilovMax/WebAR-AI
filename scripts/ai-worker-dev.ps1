# AI worker ni Docker siz mahalliy ishga tushirish (C: da ~4GB image kerak emas).
# Oldin: npm run infra:lite

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location "$root\services\ai-worker"

if (-not (Test-Path ".venv")) {
  python -m venv .venv
}

.\.venv\Scripts\Activate.ps1

pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -q -r requirements.txt

# Ildizdagi .env ni yuklash
$envFile = "$root\.env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
}

$env:GO2RTC_URL = if ($env:GO2RTC_URL) { $env:GO2RTC_URL } else { "http://localhost:1984" }
$env:MODELS_DIR = "$root\services\ai-worker\models"
$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql://acs:change-me-in-production@localhost:5432/acs" }
$env:REDIS_URL = if ($env:REDIS_URL) { $env:REDIS_URL } else { "redis://localhost:6379/0" }

Write-Host "AI worker: http://localhost:8000  GO2RTC=$($env:GO2RTC_URL)"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
