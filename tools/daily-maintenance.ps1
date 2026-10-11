#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Runs the daily maintenance for the Farah system: backup, verify, report.

.DESCRIPTION
  This is the safeguard that matters. The application host can disappear at any
  time - the free hosting plans can pause or terminate a project without notice -
  but the database and a fresh backup survive. Running this on a schedule means
  there is always a recent, verified copy of the data.

  It fails loudly: if the backup cannot be written, or is older than expected,
  the exit code is non-zero and Windows Task Scheduler will show it as failed.

.PARAMETER Keep
  How many days of backups to retain. Older ones are deleted.

.PARAMETER Quiet
  Suppress the console summary (used when running from Task Scheduler).
#>
[CmdletBinding()]
param(
  [int]$Keep = 30,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'node'

function Write-Step($msg) {
  if (-not $Quiet) { Write-Host "  $msg" }
}

Write-Host ""
Write-Host "FARAH - gunluk baxim  $(Get-Date -Format 'dd.MM.yyyy HH:mm')"
Write-Host "--------------------------------------------------"

# ---- 1. backup ------------------------------------------------------------
Write-Host ""
Write-Host "[1/3] Ehtiyat yaradilir..."
Push-Location "$root\backend"
try {
  $out = & $node scripts/backup-data.js --keep $Keep 2>&1
  $ok = $LASTEXITCODE -eq 0
  if (-not $ok) {
    Write-Host "  EHTIYAT ALINMADI!"
    $out | Select-Object -Last 5 | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
  $out | Where-Object { $_ -match 'sətir ehtiyatlandı|JSON   :|SQL    :' } | ForEach-Object { Write-Step $_ }
} finally {
  Pop-Location
}

# ---- 2. verify the newest backup is readable ------------------------------
Write-Host ""
Write-Host "[2/3] Ehtiyat yoxlanilir..."
$backupDir = "$root\backups"
$newest = Get-ChildItem "$backupDir\farah-*.json" -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $newest) {
  Write-Host "  EHTIYAT FAYLI YOXDUR!"
  exit 1
}

$ageHours = ((Get-Date) - $newest.LastWriteTime).TotalHours
Write-Step "ən yeni: $($newest.Name)  ($([math]::Round($ageHours,1)) saat əvvəl)"

try {
  $json = Get-Content $newest.FullName -Raw | ConvertFrom-Json
  $rows = ($json.tables.PSObject.Properties | ForEach-Object { $_.Value.Count } | Measure-Object -Sum).Sum
  $users = $json.tables.user.Count
  Write-Step "oxuna bilir: $rows sətir, $users istifadəçi"
  if ($rows -le 0) {
    Write-Host "  EHTIYAT BOŞDUR!"
    exit 1
  }
} catch {
  Write-Host "  EHTIYAT OXUNMADI: $_"
  exit 1
}

if ($ageHours -gt 48) {
  Write-Host "  XEBARDARLIQ: ehtiyat 48 saatdan kokurdur. Task Scheduler islemir?"
  exit 1
}

# ---- 3. usage against the free-tier limits -------------------------------
Write-Host ""
Write-Host "[3/3] Istifade / limit merkezleri..."
Push-Location "$root\backend"
try {
  $usage = & $node scripts/usage-report.js 2>&1 | Where-Object { $_ -match 'istifadə   :|qalan      :' }
  $usage | ForEach-Object { Write-Step ($_ -replace '^\s+', '') }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "TAMAM. Ehtiyat: $($newest.Name)"
Write-Host ""
exit 0
