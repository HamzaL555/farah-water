# Farah — one-click server start (Windows PowerShell)
#
#   .\tools\start-server.ps1
#
# Starts, in order:
#   1. PostgreSQL (Docker)
#   2. Backend (Express on port 4000)
#   3. Cloudflare quick tunnel -> public HTTPS URL
#
# Stop everything:  .\tools\stop-server.ps1
#
# NOTE: the quick-tunnel URL CHANGES every time this script runs.
# If the APK was built for an older URL you must update
# mobile\src\services\types.ts and rebuild the APK.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    $m" -ForegroundColor Yellow }

# ---- 1. database ----------------------------------------------------------
Info "PostgreSQL (Docker)"
docker compose -f "$root\docker-compose.yml" up -d db 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Warn "docker compose failed - is Docker Desktop running?" }
else { Ok "container starting (may take ~10s)" }

# ---- 2. backend -----------------------------------------------------------
Info "Backend on :4000"
$already = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if ($already) {
  Ok "already listening (pid $($already[0].OwningProcess))"
} else {
  $out = "$root\tools\backend.log"
  Start-Process -FilePath "node.exe" `
    -ArgumentList "node_modules\tsx\dist\cli.mjs", "src\main.ts" `
    -WorkingDirectory "$root\backend" `
    -RedirectStandardOutput $out -RedirectStandardError "$root\tools\backend.err" `
    -WindowStyle Hidden
  Ok "started, log: $out"
}

# wait for health
Info "Waiting for API..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/health" -TimeoutSec 3
    if ($r.data.status -eq 'ok') { $ready = $true; break }
  } catch { }
}
if ($ready) { Ok "API healthy" } else { Warn "API did not become healthy - check tools\backend.err" }

# ---- 3. public tunnel -----------------------------------------------------
Info "Public tunnel"
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item "$root\tools\tunnel.err" -ErrorAction SilentlyContinue
Start-Process -FilePath "$root\tools\cloudflared.exe" `
  -ArgumentList "tunnel", "--url", "http://localhost:4000", "--no-autoupdate" `
  -RedirectStandardOutput "$root\tools\tunnel.log" `
  -RedirectStandardError "$root\tools\tunnel.err" `
  -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 2
  $raw = ""
  try { $raw = Get-Content "$root\tools\tunnel.err" -Raw -ErrorAction SilentlyContinue } catch { }
  if ($raw) {
    $m = [regex]::Match($raw, "https://[a-z0-9\-]+\.trycloudflare\.com")
    if ($m.Success) { $url = $m.Value; break }
  }
}

Write-Host ""
if ($url) {
  $url | Out-File -Encoding ascii "$root\tools\public-url.txt"
  Write-Host "  PUBLIC URL : $url" -ForegroundColor Green
  Write-Host "  API        : $url/api/v1/health" -ForegroundColor Green
  Write-Host ""
  Write-Host "  If this URL differs from the one in the APK, rebuild:" -ForegroundColor Yellow
  Write-Host "    mobile\src\services\types.ts  ->  API_BASE_URL = '$url/api/v1'" -ForegroundColor Yellow
  Write-Host "    cd mobile; npm.cmd run build:apk:release" -ForegroundColor Yellow
} else {
  Warn "tunnel URL not detected yet - see tools\tunnel.err"
}
Write-Host ""
Write-Host "  Keep this window open. Stop with .\tools\stop-server.ps1" -ForegroundColor DarkGray
