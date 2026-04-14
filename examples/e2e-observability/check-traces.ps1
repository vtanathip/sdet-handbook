param(
    [string]$BaseUrl = 'http://localhost:3001',
    [string]$RunId = '',
    [string]$Service = 'todo-api',
    [int]$ProbeCount = 5,
    [ValidateSet('direct', 'api')]
    [string]$ProbeMode = 'direct'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $root 'app\server'
$directProbeConfirmed = $false

function New-RunId {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
    return "pw-probe-$timestamp-$suffix"
}

function Get-AgentReceiverRow {
    param([string]$ServiceName)

    $raw = docker exec datadog-agent curl -sk https://127.0.0.1:5012/debug/vars
    if (-not $raw) {
        throw 'Datadog trace-agent debug endpoint returned no data.'
    }

    $payload = $raw | ConvertFrom-Json
    return $payload.receiver | Where-Object { $_.Service -eq $ServiceName } | Select-Object -First 1
}

function Get-ReceiverCount {
    param([string]$ServiceName)

    $row = Get-AgentReceiverRow -ServiceName $ServiceName
    if (-not $row) {
        return [pscustomobject]@{
            TracesReceived = 0
            SpansReceived = 0
            PayloadAccepted = 0
        }
    }

    return [pscustomobject]@{
        TracesReceived = [int]$row.TracesReceived
        SpansReceived = [int]$row.SpansReceived
        PayloadAccepted = [int]$row.PayloadAccepted
    }
}

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = New-RunId
}

$before = Get-ReceiverCount -ServiceName $Service

if ($ProbeMode -eq 'api') {
    $healthUrl = "$BaseUrl/health"
    $todosUrl = "$BaseUrl/api/todos"

    try {
        Invoke-WebRequest -Uri $healthUrl -Method Get -TimeoutSec 5 | Out-Null
    }
    catch {
        throw "Backend is not reachable at $healthUrl"
    }

    $headers = @{
        'x-e2e-run-id' = $RunId
        'x-e2e-source' = 'trace-check'
        'x-e2e-test-name' = 'trace-probe'
        'x-e2e-request-id' = [guid]::NewGuid().ToString('N')
    }

    for ($i = 1; $i -le $ProbeCount; $i++) {
        $headers['x-e2e-request-id'] = [guid]::NewGuid().ToString('N')
        Invoke-RestMethod -Uri $todosUrl -Method Get -Headers $headers -TimeoutSec 5 | Out-Null
    }
}
else {
    Push-Location $serverDir
    try {
        $env:DD_TRACE_AGENT_URL = 'http://127.0.0.1:8126'
        $env:DD_SERVICE = $Service
        $env:DD_ENV = 'perf-test'
        $env:DD_VERSION = '1.0.0'
        $env:DD_TRACE_DEBUG = 'true'
        $env:E2E_RUN_ID = $RunId

        $probeScript = @"
const tracer = require('dd-trace').init({
  service: process.env.DD_SERVICE,
  env: process.env.DD_ENV,
  version: process.env.DD_VERSION
});

for (let index = 0; index < ${ProbeCount}; index += 1) {
  tracer.trace('trace.check', span => {
    span.setTag('e2e.run_id', process.env.E2E_RUN_ID);
    span.setTag('e2e.source', 'trace-check');
    span.setTag('e2e.test_name', 'trace-probe');
    span.setTag('probe.index', index + 1);
  });
}

setTimeout(() => process.exit(0), 7000);
"@

        $probeOutput = node -e $probeScript 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw 'The local dd-trace probe failed.'
        }

        $directProbeConfirmed = $probeOutput -match 'Response from the agent:'
    }
    finally {
        Remove-Item Env:DD_TRACE_AGENT_URL -ErrorAction SilentlyContinue
        Remove-Item Env:DD_SERVICE -ErrorAction SilentlyContinue
        Remove-Item Env:DD_ENV -ErrorAction SilentlyContinue
        Remove-Item Env:DD_VERSION -ErrorAction SilentlyContinue
        Remove-Item Env:DD_TRACE_DEBUG -ErrorAction SilentlyContinue
        Remove-Item Env:E2E_RUN_ID -ErrorAction SilentlyContinue
        Pop-Location
    }
}

Start-Sleep -Seconds 2

$after = Get-ReceiverCount -ServiceName $Service

$traceDelta = $after.TracesReceived - $before.TracesReceived
$spanDelta = $after.SpansReceived - $before.SpansReceived
$payloadDelta = $after.PayloadAccepted - $before.PayloadAccepted

Write-Host "RunId: $RunId" -ForegroundColor Green
Write-Host "Probe mode: $ProbeMode" -ForegroundColor DarkGray
Write-Host "Datadog search: service:$Service @e2e.run_id:$RunId" -ForegroundColor Gray
Write-Host "Before: traces=$($before.TracesReceived) spans=$($before.SpansReceived) payloads=$($before.PayloadAccepted)"
Write-Host "After:  traces=$($after.TracesReceived) spans=$($after.SpansReceived) payloads=$($after.PayloadAccepted)"
Write-Host "Delta:  traces=$traceDelta spans=$spanDelta payloads=$payloadDelta"

if ($ProbeMode -eq 'direct') {
    if (-not $directProbeConfirmed) {
        throw 'Trace validation failed: dd-trace did not report a successful agent response.'
    }
}
elseif ($traceDelta -le 0 -or $spanDelta -le 0 -or $payloadDelta -le 0) {
    throw 'Trace validation failed: local Datadog Agent counters did not increase.'
}

Write-Host 'Trace validation passed.' -ForegroundColor Green
