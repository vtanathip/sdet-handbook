param(
    [switch]$KeepDatabase
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$statePath = Join-Path $root '.e2e-flow-state.json'

function Stop-ProcessIfRunning {
    param([Nullable[int]]$ProcessId)

    if (-not $ProcessId) { return }

    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $ProcessId -Force
            Write-Host "Stopped process $ProcessId" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "Could not stop process $ProcessId" -ForegroundColor Red
    }
}

function Stop-ListenersOnPort {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique

    if (-not $connections) { return }

    foreach ($procId in $connections) {
        if ($procId -gt 0) {
            try {
                Stop-Process -Id $procId -Force -ErrorAction Stop
                Write-Host "Stopped process $procId on port $Port" -ForegroundColor Yellow
            }
            catch {
                Write-Host "Could not stop process $procId on port $Port" -ForegroundColor Red
            }
        }
    }
}

Write-Host ''
Write-Host 'Stopping e2e application processes...' -ForegroundColor Cyan

if (Test-Path $statePath) {
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    Stop-ProcessIfRunning -ProcessId $state.backendPid
    Stop-ProcessIfRunning -ProcessId $state.frontendPid

    Remove-Item $statePath -Force
    Write-Host 'Removed flow state file.' -ForegroundColor Gray
}
else {
    Write-Host 'No state file found. Falling back to port-based cleanup.' -ForegroundColor Gray
}

Stop-ListenersOnPort -Port 3001
Stop-ListenersOnPort -Port 5173

if (-not $KeepDatabase) {
    Write-Host ''
    Write-Host 'Stopping database container...' -ForegroundColor Cyan
    & (Join-Path $root 'stop-db.ps1')
}
else {
    Write-Host ''
    Write-Host 'Database left running (KeepDatabase set).' -ForegroundColor Gray
}

Write-Host ''
Write-Host 'E2E flow stopped.' -ForegroundColor Green
