# run-watchdog.ps1
# Finds a running Excel window and starts the freeze watchdog.
# Run start-excel.ps1 first — it saves .excel-session.json with the PID + hwnd.
#
# Usage:
#   .\run-watchdog.ps1
#   .\run-watchdog.ps1 -Threshold 1000 -Output ".\reports"

param(
    [uint]  $Threshold = 500,
    [string]$Output    = "."
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── 1. Resolve Excel PID + hwnd ───────────────────────────────────────────────
# Prefer the session file written by start-excel.ps1 (has the real COM hwnd).
# Fall back to scanning running processes if no session file exists.

$excelPid  = 0
$excelHwnd = 0L
$sessionFile = Join-Path $PSScriptRoot ".excel-session.json"

if (Test-Path $sessionFile) {
    $session  = Get-Content $sessionFile | ConvertFrom-Json
    $excelPid  = [int]$session.pid
    $excelHwnd = [long]$session.hwnd
    Write-Host "Loaded session: PID=$excelPid  HWND=$excelHwnd" -ForegroundColor Cyan

    # Verify the process is still running
    $excelProc = Get-Process -Id $excelPid -ErrorAction SilentlyContinue
    if (-not $excelProc) {
        Write-Warning "Session file PID=$excelPid no longer running. Falling back to process scan."
        $excelPid  = 0
        $excelHwnd = 0L
    }
}

if ($excelPid -eq 0) {
    $candidates = @(Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue |
                    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })

    if ($candidates.Count -eq 0) {
        Write-Error "No running Excel window found. Run .\start-excel.ps1 first."
        exit 1
    }

    if ($candidates.Count -eq 1) {
        $excelProc = $candidates[0]
    } else {
        Write-Host "Multiple Excel instances found:" -ForegroundColor Cyan
        for ($i = 0; $i -lt $candidates.Count; $i++) {
            Write-Host "  [$($i+1)] PID=$($candidates[$i].Id)  '$($candidates[$i].MainWindowTitle)'"
        }
        $choice = Read-Host "Select [1-$($candidates.Count)]"
        $idx = [int]$choice - 1
        if ($idx -lt 0 -or $idx -ge $candidates.Count) {
            Write-Error "Invalid selection."
            exit 1
        }
        $excelProc = $candidates[$idx]
    }
    $excelPid = $excelProc.Id
}

Write-Host "Watching Excel: PID=$excelPid" -ForegroundColor Green

# ── 2. Build watchdog ─────────────────────────────────────────────────────────
$projectDir = Join-Path $PSScriptRoot "ProcessWatchdog"
Write-Host "`nBuilding ProcessWatchdog..." -ForegroundColor Cyan
dotnet build "$projectDir\ProcessWatchdog.csproj" -c Debug --nologo -v quiet
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed. Fix errors above and try again."
    exit 1
}
Write-Host "Build OK" -ForegroundColor Green

# ── 3. Run the watchdog ───────────────────────────────────────────────────────
Write-Host "`nStarting watchdog (threshold=${Threshold}ms, output='$Output')..." -ForegroundColor Cyan
Write-Host "Run a macro in Excel, then press Ctrl+C here to generate the report.`n" -ForegroundColor Yellow

$hwndArg = if ($excelHwnd -ne 0L) { @("--hwnd", $excelHwnd) } else { @() }
dotnet run --project "$projectDir\ProcessWatchdog.csproj" --no-build -- --threshold $Threshold --output $Output --pid $excelPid @hwndArg
$watchdogExit = $LASTEXITCODE

# ── 4. Result ─────────────────────────────────────────────────────────────────
switch ($watchdogExit) {
    0 { Write-Host "`nSign-off result: PASS"                             -ForegroundColor Green  }
    1 { Write-Host "`nSign-off result: CAUTION (minor freezes detected)" -ForegroundColor Yellow }
    2 { Write-Host "`nSign-off result: FAIL (severe freeze >= 3s)"       -ForegroundColor Red    }
    default { Write-Host "`nWatchdog exited with code $watchdogExit"     -ForegroundColor Gray   }
}

exit $watchdogExit
