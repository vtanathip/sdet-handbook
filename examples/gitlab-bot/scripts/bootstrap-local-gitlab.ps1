param(
    [string]$ProjectName = 'gitlab-bot-test',
    [string]$Token = '',
    [int]$TimeoutSeconds = 900,
    [switch]$OpenBrowser,
    [switch]$TailLogs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Set-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    if (-not (Test-Path $Path)) {
        throw "Missing file: $Path"
    }

    $lines = Get-Content -Path $Path
    $pattern = "^$([regex]::Escape($Key))=.*$"
    $replacement = "$Key=$Value"

    if ($lines -match $pattern) {
        $updated = $lines -replace $pattern, $replacement
    }
    else {
        $updated = @($lines + $replacement)
    }

    Set-Content -Path $Path -Value $updated
}

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path $Path)) {
        return ''
    }

    $pattern = "^$([regex]::Escape($Key))=(.*)$"
    foreach ($line in Get-Content -Path $Path) {
        if ($line -match $pattern) {
            return $Matches[1]
        }
    }

    return ''
}

function Wait-GitLabHealthy {
    param(
        [string]$ReadinessUrl = 'http://localhost:8080/users/sign_in',
        [int]$TimeoutSeconds = 900
    )

    $startedAt = Get-Date
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $elapsedSeconds = [int]((Get-Date) - $startedAt).TotalSeconds
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $ReadinessUrl -Method Get -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "GitLab readiness endpoint reachable: $($response.StatusCode)" -ForegroundColor Green
                return
            }

            Write-Host "Waiting for GitLab... elapsed ${elapsedSeconds}s, HTTP $($response.StatusCode)" -ForegroundColor DarkYellow
        }
        catch {
            Write-Host "Waiting for GitLab... elapsed ${elapsedSeconds}s, last error: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
        Start-Sleep -Seconds 5
    }

    throw "GitLab did not become healthy within $TimeoutSeconds seconds."
}

$root = Split-Path -Path $PSScriptRoot -Parent
Set-Location $root

$envPath = Join-Path $root '.env'
$envExample = Join-Path $root '.env.example'

Write-Step 'Starting local GitLab container'
docker compose up -d gitlab
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to start GitLab container.'
}

Write-Step 'Waiting for GitLab health check'
Wait-GitLabHealthy -TimeoutSeconds $TimeoutSeconds

if (-not (Test-Path $envPath)) {
    Write-Step 'Creating .env from .env.example'
    Copy-Item -Path $envExample -Destination $envPath
}

Write-Step 'Reading initial root password (only needed first login)'
$initialPassword = docker compose exec -T gitlab grep 'Password:' /etc/gitlab/initial_root_password
if ($LASTEXITCODE -eq 0) {
    Write-Host $initialPassword -ForegroundColor Yellow
}

if ($OpenBrowser) {
    Write-Step 'Opening GitLab UI and Personal Access Token page'
    Start-Process 'http://localhost:8080'
    Start-Process 'http://localhost:8080/-/user_settings/personal_access_tokens'
}

Write-Step 'Provide Personal Access Token with api scope'
$tokenValue = $Token
if ([string]::IsNullOrWhiteSpace($tokenValue)) {
    $tokenValue = Get-EnvValue -Path $envPath -Key 'GITLAB_TOKEN'
}
if (-not [string]::IsNullOrWhiteSpace($tokenValue)) {
    Write-Host 'Using token from .env' -ForegroundColor DarkYellow
}
if ([string]::IsNullOrWhiteSpace($tokenValue)) {
    $tokenValue = Read-Host 'Paste PAT token'
}
if ([string]::IsNullOrWhiteSpace($tokenValue)) {
    throw 'Token cannot be empty.'
}

$apiBase = 'http://localhost:8080/api/v4'
$headers = @{ 'PRIVATE-TOKEN' = $tokenValue }

Write-Step 'Verifying token against GitLab API'
$me = Invoke-RestMethod -Method Get -Uri "$apiBase/user" -Headers $headers
Write-Host "Authenticated as: $($me.username)" -ForegroundColor Green

Write-Step 'Create or reuse project'
$existing = Invoke-RestMethod -Method Get -Uri "$apiBase/projects?owned=true&simple=true&search=$ProjectName" -Headers $headers
$project = $existing | Where-Object { $_.name -eq $ProjectName } | Select-Object -First 1

if (-not $project) {
    $project = Invoke-RestMethod -Method Post -Uri "$apiBase/projects" -Headers $headers -Body @{
        name                   = $ProjectName
        visibility             = 'private'
        initialize_with_readme = 'true'
    }
    Write-Host "Created project: $($project.path_with_namespace) (id=$($project.id))" -ForegroundColor Green
}
else {
    Write-Host "Using existing project: $($project.path_with_namespace) (id=$($project.id))" -ForegroundColor Green
}

Write-Step 'Updating .env values'
Set-EnvValue -Path $envPath -Key 'GITLAB_URL' -Value 'http://gitlab:8080'
Set-EnvValue -Path $envPath -Key 'GITLAB_TOKEN' -Value $tokenValue
Set-EnvValue -Path $envPath -Key 'PROJECT_IDS' -Value ([string]$project.id)

Write-Step 'Starting bot container with updated configuration'
docker compose up -d --force-recreate gitlab-bot
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to start gitlab-bot container.'
}

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "GitLab UI: http://localhost:8080"
Write-Host "Project ID in .env: $($project.id)"

if ($TailLogs) {
    Write-Step 'Streaming gitlab-bot logs (Ctrl+C to stop)'
    docker compose logs -f gitlab-bot
}
