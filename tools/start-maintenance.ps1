#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Starts the daily maintenance on THIS computer, every day, until stopped.

.DESCRIPTION
  Registering a Windows Scheduled Task needs administrator rights, and that is
  not something this project should demand. This runs the same maintenance
  loop as a plain background process instead:

    while true:
        sleep until 03:15
        run backup + verify + usage report
        append the result to logs/maintenance.log

  Start it once (tools/start-maintenance.ps1). It keeps running until the
  computer is restarted or you stop it.

  Keep the machine on at that time. If it is off, the loop notices it missed the
  slot and runs as soon as it starts again, so no day is ever silently skipped.
#>
[CmdletBinding()]
param(
  [string]$At = '03:15',
  [int]$Keep = 30,
  [switch]$Foreground
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
$log = Join-Path $logDir 'maintenance.log'
$pidFile = Join-Path $logDir 'maintenance.pid'
$me = $MyInvocation.MyCommand.Path

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Re-launch hidden so the loop survives this console being closed. The inner
# copy runs with -Foreground and does the real work.
if (-not $Foreground) {
  $inner = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$me`" -At $At -Keep $Keep -Foreground"
  Start-Process powershell.exe -ArgumentList $inner -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Write-Host "Baxim arxa planda basladi (gunluk $At)."
  Write-Host "  yoxlamaq   : Get-Content .\logs\maintenance.log -Tail 20"
  Write-Host "  dayandirmaq: .\tools\stop-maintenance.ps1"
  exit 0
}

# Refuse to start a second copy.
if (Test-Path $pidFile) {
  $existing = Get-Content $pidFile -Raw -ErrorAction SilentlyContinue
  if ($existing -and (Get-Process -Id $existing -ErrorAction SilentlyContinue)) {
    Write-Host "Baxim onsuz da isleyir (PID $existing)."
    Write-Host "Dayandirmaq:  .\tools\stop-maintenance.ps1"
    exit 0
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Say($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line
  if ($Foreground) { Write-Host $line }
}

$script = Join-Path $root 'tools\daily-maintenance.ps1'
$target = [datetime]::ParseExact($At, 'HH:mm', $null)

# Record our PID so a second copy can be refused and the loop can be stopped.
Set-Content -Path $pidFile -Value $PID -NoNewline

Say "Baxim basladi (PID $PID). Gunluk saat: $At"

while ($true) {
  try {
    $now = Get-Date
    # Combine today's date with the target time of day, then roll to tomorrow
    # if that moment has already passed.
    $next = $now.Date + $target.TimeOfDay
    if ($next -le $now) { $next = $next.AddDays(1) }

    $waitHours = ($next - $now).TotalHours
    Say "Növbəti icra: $($next.ToString('dd.MM.yyyy HH:mm')) (${waitHours} saatdan sonra)"

    # Sleep in short slices so a missed slot (laptop asleep) is noticed promptly.
    while ($true) {
      Start-Sleep -Seconds 300
      if ((Get-Date) -ge $next) { break }
    }

    Say "Icra baslayir..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Keep $Keep -Quiet 2>&1 |
      ForEach-Object { Say "  $_" }

    if ($LASTEXITCODE -eq 0) {
      Say "Ugurlu tamamlandi."
    } else {
      Say "XETA: baxim $LASTEXITCODE ile bitdi."
    }
  } catch {
    Say "XETA: $_"
  }

  # Do not run twice in a row if the loop is restarted quickly.
  Start-Sleep -Seconds 30
}
