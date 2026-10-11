#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Registers the daily maintenance as a Windows scheduled task.

.DESCRIPTION
  Installs a task that runs tools\daily-maintenance.ps1 every night at 03:15.
  It runs whether or not anyone is logged on, so the backup happens even when
  the computer is sitting idle or locked.

  Run this once. Run tools\uninstall-maintenance.ps1 to remove it.
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'Farah Daily Maintenance',
  [string]$At = '03:15',
  [int]$Keep = 30
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'tools\daily-maintenance.ps1'
$logDir = Join-Path $root 'logs'

if (-not (Test-Path $script)) { throw "Script not found: $script" }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'maintenance.log'

# Remove any previous registration so this is safe to re-run.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Köhnə qeyd silindi."
}

# Highest privileges: writing to the project folder and the database both need
# it, and the task must run unattended.
$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Keep $Keep" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $At

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 10)

# Run as the current user, and whether or not they are logged on.
$principal = New-ScheduledTaskPrincipal `
  -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType S4U `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Farah: gunluk baza ehtiyati, yoxlamasi ve limit merkezi' `
  -Force | Out-Null

Write-Host ""
Write-Host "Qeyd edildi: $TaskName"
Write-Host "  saat     : her gecə $At"
Write-Host "  saxlanır : $Keep ehtiyat"
Write-Host "  jurnal   : $log"
Write-Host ""
Write-Host "Yoxlamaq üçün:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'   # indi bir dəfə işə sal"
Write-Host ""
