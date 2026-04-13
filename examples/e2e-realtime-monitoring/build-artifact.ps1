<#
.SYNOPSIS
  Builds the Todo app monorepo and uploads a deployment ZIP to S3.

.DESCRIPTION
  Three stages:
    1. Build  — npm install + npm run build for client and server workspaces.
    2. Stage  — Copy production artifacts into a clean staging directory that
                mirrors the layout expected by the EC2 bootstrap script:
                  server/dist/       — compiled server JS
                  server/node_modules/ — production-only node_modules
                  server/package.json
                  server/migrations/  — SQL migration files
                  client/dist/        — Vite-built React SPA
    3. Package — ZIP the staging directory and (optionally) upload it to the
                 S3 bucket created by the Pulumi stack.

  Prerequisites:
    - Node.js (npm) installed locally.
    - AWS CLI configured with credentials that can write to the artifact bucket.
    - Pulumi CLI available if -StackName is used to resolve the bucket name.

.PARAMETER StackName
  Pulumi stack name used to look up the artifact_s3_bucket output.
  Defaults to "dev".

.PARAMETER SkipUpload
  When set, the ZIP is created locally but NOT uploaded to S3.

.EXAMPLE
  .\build-artifact.ps1
  # Builds, zips, and uploads to the S3 bucket from the "dev" stack.

.EXAMPLE
  .\build-artifact.ps1 -StackName prod
  # Uses the "prod" stack's bucket.

.EXAMPLE
  .\build-artifact.ps1 -SkipUpload
  # Build and ZIP only; no S3 upload.
#>
param(
    [string] $StackName = 'dev',
    [switch] $SkipUpload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot          # examples/e2e-realtime-monitoring
$appDir = Join-Path $projectRoot 'app'
$stageDir = Join-Path $projectRoot '.artifact-stage'
$zipPath = Join-Path $projectRoot 'app-artifact.zip'

# ── Stage 1: Build ─────────────────────────────────────────────────────────
Write-Host '=== Stage 1: Build ===' -ForegroundColor Cyan
Push-Location $appDir
try {
    Write-Host 'Installing dependencies...'
    npm install --workspaces
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }

    Write-Host 'Building client...'
    npm run build --workspace client
    if ($LASTEXITCODE -ne 0) { throw "client build failed (exit $LASTEXITCODE)" }

    Write-Host 'Building server...'
    npm run build --workspace server
    if ($LASTEXITCODE -ne 0) { throw "server build failed (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

# ── Stage 2: Stage production artifacts ────────────────────────────────────
Write-Host '=== Stage 2: Stage ===' -ForegroundColor Cyan
if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
New-Item -ItemType Directory -Path $stageDir | Out-Null

# server/dist
$serverDist = Join-Path $appDir 'server\dist'
if (-not (Test-Path $serverDist)) { throw "Server dist not found at $serverDist" }
$destServerDist = Join-Path $stageDir 'server\dist'
Copy-Item -Path $serverDist -Destination $destServerDist -Recurse

# server/package.json (needed for production npm install on EC2 if ever needed)
Copy-Item -Path (Join-Path $appDir 'server\package.json') -Destination (Join-Path $stageDir 'server\package.json')

# server/migrations
$migrationsSrc = Join-Path $appDir 'server\migrations'
if (Test-Path $migrationsSrc) {
    Copy-Item -Path $migrationsSrc -Destination (Join-Path $stageDir 'server\migrations') -Recurse
}

# server/node_modules — production only
Write-Host 'Installing server production dependencies...'
Push-Location (Join-Path $stageDir 'server')
try {
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "server production install failed (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

# client/dist
$clientDist = Join-Path $appDir 'client\dist'
if (-not (Test-Path $clientDist)) { throw "Client dist not found at $clientDist" }
$destClientDist = Join-Path $stageDir 'client\dist'
New-Item -ItemType Directory -Path (Join-Path $stageDir 'client') -Force | Out-Null
Copy-Item -Path $clientDist -Destination $destClientDist -Recurse

# ── Stage 3: Package & Upload ─────────────────────────────────────────────
Write-Host '=== Stage 3: Package ===' -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "Artifact created: $zipPath ($zipSize MB)"

# Cleanup staging directory
Remove-Item -Recurse -Force $stageDir

if ($SkipUpload) {
    Write-Host 'Upload skipped (-SkipUpload).' -ForegroundColor Yellow
    return
}

# Resolve S3 bucket name and AWS region from Pulumi stack
Write-Host "Resolving stack outputs from Pulumi stack '$StackName'..."
Push-Location (Join-Path $projectRoot 'infra')
try {
    $bucket = pulumi stack output artifact_s3_bucket --stack $StackName 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Failed to get artifact_s3_bucket from stack '$StackName': $bucket" }

    $awsRegion = pulumi config get aws:region --stack $StackName 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Failed to get aws:region from stack '$StackName': $awsRegion" }
}
finally {
    Pop-Location
}

# Resolve S3 key from Pulumi config (fallback to default)
$s3Key = 'app-artifact.zip'
try {
    Push-Location (Join-Path $projectRoot 'infra')
    $configKey = pulumi config get artifact-s3-key --stack $StackName 2>&1
    if ($LASTEXITCODE -eq 0 -and $configKey) { $s3Key = $configKey }
}
catch {
    # Use default
}
finally {
    Pop-Location
}

Write-Host "Uploading to s3://$bucket/$s3Key (region: $awsRegion)..."
aws s3 cp $zipPath "s3://$bucket/$s3Key" --region $awsRegion --no-progress
if ($LASTEXITCODE -ne 0) { throw "S3 upload failed (exit $LASTEXITCODE)" }

Write-Host "Artifact uploaded successfully to s3://$bucket/$s3Key" -ForegroundColor Green
