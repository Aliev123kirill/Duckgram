param(
  [switch]$Build,
  [switch]$NoOpen,
  [switch]$Prod
)

# Duckgram — запуск сервера разработки или production-сборки
# Usage: .\scripts\start-duckgram.ps1          (dev server)
#        .\scripts\start-duckgram.ps1 -Build    (production build)
#        .\scripts\start-duckgram.ps1 -Prod     (production preview)

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $Root

# Проверяем установку зависимостей
if (!(Test-Path -LiteralPath "node_modules/.modules.yaml")) {
  Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
  pnpm install
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

if ($Prod) {
  Write-Host "🏗️  Building production..." -ForegroundColor Cyan
  pnpm build
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Write-Host "✅ Built! Run: npx vite preview --port 8080" -ForegroundColor Green
  npx vite preview --port 8080
} elseif ($Build) {
  Write-Host "🏗️  Building..." -ForegroundColor Cyan
  pnpm build
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Write-Host "✅ Build complete: dist/" -ForegroundColor Green
} else {
  Write-Host "🦆 Starting Duckgram dev server on :8080..." -ForegroundColor Cyan
  if (!$NoOpen) {
    Start-Process "http://localhost:8080/?test=1"
  }
  pnpm start
}
