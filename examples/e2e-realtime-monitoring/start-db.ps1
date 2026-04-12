# Start PostgreSQL in Docker and set environment variables
# This script requires Docker to be installed

Write-Host ""
Write-Host "Starting PostgreSQL Docker container..." -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed
$dockerPath = Get-Command docker -ErrorAction SilentlyContinue

if (-not $dockerPath) {
    Write-Host "Docker is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Docker Desktop from: https://www.docker.com/products/docker-desktop"
    exit 1
}

Write-Host "Docker found" -ForegroundColor Green

# Check if Docker daemon is running
Write-Host "Checking Docker daemon..." -ForegroundColor Cyan

$dockerCheck = docker info 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker daemon is not running" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please start Docker Desktop and try again"
    exit 1
}

Write-Host "Docker daemon is running" -ForegroundColor Green
Write-Host ""

# Start the container
Write-Host "Starting container with: docker-compose up -d" -ForegroundColor Cyan

try {
    $output = docker-compose up -d 2>&1
    Write-Host "Container started" -ForegroundColor Green
}
catch {
    Write-Host "Failed to start container" -ForegroundColor Red
    Write-Host $_ -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Waiting for database to be ready..." -ForegroundColor Cyan

# Wait for database to be healthy
$maxAttempts = 30
$attempt = 0

while ($attempt -lt $maxAttempts) {
    $health = docker-compose ps --services --filter "status=running" 2>$null | Select-String "postgres"
    
    if ($health) {
        $ready = docker exec todos-db pg_isready -U todos -d todos 2>$null
        if ($ready -match "accepting") {
            break
        }
    }
    
    Start-Sleep -Seconds 1
    $attempt++
    Write-Host "." -NoNewline -ForegroundColor Cyan
}

Write-Host ""
Write-Host ""

if ($attempt -eq $maxAttempts) {
    Write-Host "Database failed to become ready" -ForegroundColor Red
    exit 1
}

Write-Host "Database is ready!" -ForegroundColor Green
Write-Host ""

# Set environment variables
Write-Host "Setting environment variables..." -ForegroundColor Cyan

$env:PGHOST = "localhost"
$env:PGPORT = "5432"
$env:PGDATABASE = "todos"
$env:PGUSER = "todos"
$env:PGPASSWORD = "todos"

Write-Host "Environment variables set:" -ForegroundColor Green
Write-Host "  PGHOST=localhost"
Write-Host "  PGPORT=5432"
Write-Host "  PGDATABASE=todos"
Write-Host "  PGUSER=todos"
Write-Host "  PGPASSWORD=todos"
Write-Host ""

Write-Host "Ready to run the app!" -ForegroundColor Green
Write-Host ""
Write-Host "In a new terminal, run:" -ForegroundColor Yellow
Write-Host "  cd app"
Write-Host "  npm run dev:server" -ForegroundColor Gray
Write-Host ""
Write-Host "In another terminal, run:" -ForegroundColor Yellow
Write-Host "  cd app"
Write-Host "  npm run dev:client" -ForegroundColor Gray
Write-Host ""
