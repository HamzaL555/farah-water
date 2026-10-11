#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Stops the daily maintenance loop started by start-maintenance.ps1.
#>
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*maintenance-loop*' -or $_.CommandLine -like '*start-maintenance*' } |
  ForEach-Object {
    Write-Host "Durdurulur: PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }

# start-maintenance.ps1 launches itself hidden; catch that too.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*tools\start-maintenance.ps1*' } |
  ForEach-Object {
    Write-Host "Durdurulur: PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }

Remove-Item (Join-Path $logDir 'maintenance.pid') -Force -ErrorAction SilentlyContinue
Write-Host "Baxim dayandirildi."
