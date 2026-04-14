#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Starts a local Datadog Agent container for APM trace ingestion.

.DESCRIPTION
    Runs the Datadog Agent as a Docker container exposing port 8126 for APM traces.
    Required so that dd-trace (server) can ship spans to Datadog when running locally.

.PARAMETER ApiKey
    Datadog API key. Falls back to $env:DD_API_KEY if not provided.

.EXAMPLE
    .\start-datadog-agent.ps1
    .\start-datadog-agent.ps1 -ApiKey "your-api-key-here"
#>

param(
    [string]$ApiKey = $env:DD_API_KEY
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Validate API key ──────────────────────────────────────────────────────────
if (-not $ApiKey) {
    Write-Error @"
DD_API_KEY is not set. Provide it via:
  - Environment variable : `$env:DD_API_KEY = 'your-key'
  - Script parameter     : .\start-datadog-agent.ps1 -ApiKey 'your-key'
"@
    exit 1
}

# ── Constants ─────────────────────────────────────────────────────────────────
$ContainerName = 'datadog-agent'
$AgentImage    = 'datadog/agent:latest'
$ApmPort       = 8126
$DdSite        = 'ap1.datadoghq.com'

# Docker Compose prefixes network names with the project folder name.
# Detect the actual todo-network name dynamically.
$DockerNetwork = docker network ls --format '{{.Name}}' 2>$null |
    Where-Object { $_ -match 'todo-network' } |
    Select-Object -First 1
if (-not $DockerNetwork) {
    Write-Warning "No 'todo-network' found. Agent will run without a shared network (traces still reach 127.0.0.1:8126)."
    $DockerNetwork = $null
}

# ── Remove stale container if present ────────────────────────────────────────
$existing = docker ps -a --filter "name=^${ContainerName}$" --format '{{.Names}}' 2>$null
if ($existing -eq $ContainerName) {
    Write-Host "Removing existing '$ContainerName' container..." -ForegroundColor Yellow
    docker rm -f $ContainerName | Out-Null
}

# ── Start agent ───────────────────────────────────────────────────────────────
Write-Host "Starting Datadog Agent (site: $DdSite, APM port: $ApmPort)..." -ForegroundColor Cyan

$runArgs = @(
    'run', '-d',
    '--name', $ContainerName,
    '-e', "DD_API_KEY=$ApiKey",
    '-e', "DD_SITE=$DdSite",
    '-e', 'DD_HOSTNAME=local-dev',
    '-e', 'DD_APM_ENABLED=true',
    '-e', 'DD_APM_NON_LOCAL_TRAFFIC=true',
    '-e', 'DD_LOGS_ENABLED=false',
    '-e', 'DD_PROCESS_AGENT_ENABLED=false',
    '-e', 'DD_ENV=perf-test',
    '-e', "DD_APM_DD_URL=https://trace.agent.${DdSite}",
    '-p', "${ApmPort}:${ApmPort}"
)
if ($DockerNetwork) {
    Write-Host "  Joining network: $DockerNetwork" -ForegroundColor DarkGray
    $runArgs += '--network', $DockerNetwork
}
$runArgs += $AgentImage

& docker @runArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start Datadog Agent container."
    exit 1
}

# ── Wait for agent to be ready ────────────────────────────────────────────────
Write-Host "Waiting for APM endpoint to become ready..." -ForegroundColor Cyan
$maxWait  = 30   # seconds
$interval = 2
$elapsed  = 0
$ready    = $false

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:${ApmPort}/info" -TimeoutSec 2 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # not ready yet
    }
    Write-Host "  ... still waiting ($elapsed/${maxWait}s)"
}

if ($ready) {
    Write-Host ""
    Write-Host "Datadog Agent is ready." -ForegroundColor Green
    Write-Host "  APM intake : http://127.0.0.1:${ApmPort}"
    Write-Host ""
    Write-Host "Container logs:" -ForegroundColor DarkGray
    docker logs $ContainerName --tail 10
} else {
    Write-Warning "Agent did not become ready within ${maxWait}s. Check logs:"
    docker logs $ContainerName --tail 20
    exit 1
}
