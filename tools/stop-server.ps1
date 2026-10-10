# Farah — stop the local server stack
#   .\tools\stop-server.ps1

$root = Split-Path -Parent $PSScriptRoot

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "    tunnel stopped" -ForegroundColor Green

# Only stop the node process that is serving this backend.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*src\main.ts*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                   Write-Host "    backend stopped (pid $($_.ProcessId))" -ForegroundColor Green }

docker compose -f "$root\docker-compose.yml" stop db 2>&1 | Out-Null
Write-Host "    database stopped (data is kept in the farah_pgdata volume)" -ForegroundColor Green

Write-Host ""
Write-Host "  Restart everything with .\tools\start-server.ps1" -ForegroundColor DarkGray
