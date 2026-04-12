param(
    [ValidateSet('local', 'ec2', 'all')]
    [string]$Target = 'local',
    [string]$Ec2BaseUrl = '',
    [switch]$SkipTests,
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root 'app'
$statePath = Join-Path $root '.e2e-flow-state.json'
$logDir = Join-Path $root '.e2e-logs'

function Write-Info {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Cyan
    )

    if (-not $Silent) {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Get-ShellPath {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }

    $powershell = Get-Command powershell -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }

    throw 'No PowerShell executable found (pwsh or powershell).'
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

function Wait-ForUrl {
    param(
        [string]$Url,
        [string]$Name,
        [int]$MaxAttempts = 40
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            $requestParams = @{
                Uri        = $Url
                Method     = 'Get'
                TimeoutSec = 5
            }

            # Windows PowerShell 5.1 may prompt for script parsing without this flag.
            if ($PSVersionTable.PSVersion.Major -lt 6) {
                $requestParams.UseBasicParsing = $true
            }

            Invoke-WebRequest @requestParams | Out-Null
            Write-Host "$Name is ready: $Url" -ForegroundColor Green
            return
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }

    throw "$Name did not become ready in time: $Url"
}

if (($Target -eq 'ec2' -or $Target -eq 'all') -and [string]::IsNullOrWhiteSpace($Ec2BaseUrl)) {
    throw 'Ec2BaseUrl is required when Target is ec2 or all.'
}

$shell = Get-ShellPath
$serverPid = $null
$clientPid = $null

$requiresLocalStack = $Target -ne 'ec2'

if ($requiresLocalStack) {
    Write-Info ''
    Write-Info 'Starting database...'
    & (Join-Path $root 'start-db.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "start-db.ps1 failed with exit code $LASTEXITCODE"
    }

    Write-Info ''
    Write-Info 'Cleaning stale listeners on ports 3001 and 5173...'
    Stop-ListenersOnPort -Port 3001
    Stop-ListenersOnPort -Port 5173

    Write-Info ''
    Write-Info 'Starting backend and frontend...'

    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $escapedAppDir = $appDir.Replace("'", "''")
    $serverCommand = @"
`$env:PGHOST='localhost'; `$env:PGPORT='5432'; `$env:PGDATABASE='todos'; `$env:PGUSER='todos'; `$env:PGPASSWORD='todos'; Set-Location '$escapedAppDir'; npm run dev:server
"@

    if ($Silent) {
        $serverStdOutPath = Join-Path $logDir 'server.stdout.log'
        $serverStdErrPath = Join-Path $logDir 'server.stderr.log'
        $serverProc = Start-Process -FilePath $shell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $serverCommand -RedirectStandardOutput $serverStdOutPath -RedirectStandardError $serverStdErrPath -PassThru -WindowStyle Hidden
    }
    else {
        $serverProc = Start-Process -FilePath $shell -ArgumentList '-NoExit', '-Command', $serverCommand -PassThru
    }
    $serverPid = $serverProc.Id

    $clientCommand = "Set-Location '$escapedAppDir'; npm run dev:client"
    if ($Silent) {
        $clientStdOutPath = Join-Path $logDir 'client.stdout.log'
        $clientStdErrPath = Join-Path $logDir 'client.stderr.log'
        $clientProc = Start-Process -FilePath $shell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $clientCommand -RedirectStandardOutput $clientStdOutPath -RedirectStandardError $clientStdErrPath -PassThru -WindowStyle Hidden
    }
    else {
        $clientProc = Start-Process -FilePath $shell -ArgumentList '-NoExit', '-Command', $clientCommand -PassThru
    }
    $clientPid = $clientProc.Id

    Write-Info "Backend PID: $serverPid" -Color Gray
    Write-Info "Frontend PID: $clientPid" -Color Gray

    Write-Info ''
    Write-Info 'Waiting for services to be ready...'
    Wait-ForUrl -Url 'http://localhost:3001/health' -Name 'Backend'
    Wait-ForUrl -Url 'http://localhost:5173' -Name 'Frontend'
}

$state = [ordered]@{
    target      = $Target
    startedAt   = (Get-Date).ToString('o')
    backendPid  = $serverPid
    frontendPid = $clientPid
    ec2BaseUrl  = $Ec2BaseUrl
}
$state | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8

if ($SkipTests) {
    Write-Host ''
    Write-Host 'Services are up. Tests were skipped.' -ForegroundColor Green
    Write-Host 'Run tests manually from app/: npm run test:e2e' -ForegroundColor Gray
    if ($Silent) {
        Write-Host "Silent logs: $logDir" -ForegroundColor Gray
    }
    Write-Host "Use stop-e2e.ps1 to clean up." -ForegroundColor Gray
    exit 0
}

if (-not $Silent) {
    Write-Host ''
    Write-Host 'Running Playwright e2e tests...' -ForegroundColor Cyan
}
Push-Location $appDir
try {
    $playwrightReporterArgs = @()
    if ($Silent) {
        $playwrightReporterArgs = @('--', '--reporter=dot')
    }

    if ($Target -eq 'local') {
        npm run test:e2e @playwrightReporterArgs
    }
    elseif ($Target -eq 'ec2') {
        $env:EC2_BASE_URL = $Ec2BaseUrl
        npm run test:e2e:ec2 @playwrightReporterArgs
    }
    else {
        $env:EC2_BASE_URL = $Ec2BaseUrl
        npm run test:e2e:all @playwrightReporterArgs
    }

    if ($LASTEXITCODE -ne 0) {
        throw "E2E tests failed with exit code $LASTEXITCODE"
    }

    Write-Host ''
    Write-Host 'E2E flow completed successfully.' -ForegroundColor Green
}
finally {
    Pop-Location
    if ($Silent) {
        Write-Host "Silent logs: $logDir" -ForegroundColor Gray
    }
    Write-Host "Use stop-e2e.ps1 to stop services and database." -ForegroundColor Gray
}
