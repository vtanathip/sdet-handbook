# Local Database Setup Script for Todo App
# Sets up PostgreSQL with todos database and runs migrations

param(
    [string]$DbHost = "localhost",
    [string]$DbPort = "5432",
    [string]$DbName = "todos",
    [string]$DbUser = "todos",
    [string]$DbPassword = "todos"
)

Write-Host "Checking for PostgreSQL installation..." -ForegroundColor Cyan

$psqlPath = Get-Command psql -ErrorAction SilentlyContinue

if (-not $psqlPath) {
    Write-Host "PostgreSQL is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install PostgreSQL from: https://www.postgresql.org/download/windows/"
    exit 1
}

Write-Host "PostgreSQL found" -ForegroundColor Green

Write-Host ""
Write-Host "Setting environment variables..." -ForegroundColor Cyan

$env:PGHOST = $DbHost
$env:PGPORT = $DbPort
$env:PGDATABASE = $DbName
$env:PGUSER = $DbUser
$env:PGPASSWORD = $DbPassword

Write-Host "Environment variables configured" -ForegroundColor Green

Write-Host ""
Write-Host "Checking database..." -ForegroundColor Cyan

$dbExists = psql -h $DbHost -U postgres -l 2>$null | Select-String $DbName

if ($dbExists) {
    Write-Host "Database already exists" -ForegroundColor Green
}
else {
    Write-Host "Creating database and user..." -ForegroundColor Cyan
    
    $sqlCommands = "CREATE USER $DbUser WITH PASSWORD '$DbPassword';" + [char]13 + [char]10
    $sqlCommands += "ALTER USER $DbUser CREATEDB;" + [char]13 + [char]10
    $sqlCommands += "CREATE DATABASE $DbName OWNER $DbUser;"
    
    try {
        $sqlCommands | psql -h $DbHost -U postgres 2>&1 | Out-Null
        Write-Host "Database created successfully" -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to create database" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Running migrations..." -ForegroundColor Cyan

$migrationFile = Join-Path $PSScriptRoot "app\server\migrations\001_todos.sql"

if (-not (Test-Path $migrationFile)) {
    Write-Host "Migration file not found" -ForegroundColor Red
    exit 1
}

try {
    Get-Content $migrationFile | psql -h $DbHost -U $DbUser -d $DbName 2>&1 | Out-Null
    Write-Host "Migrations completed" -ForegroundColor Green
}
catch {
    Write-Host "Failed to run migrations" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Environment variables are set in this session." -ForegroundColor Yellow
Write-Host ""
Write-Host "To make them permanent, add this to your PowerShell profile:" -ForegroundColor Gray
Write-Host "`$env:PGHOST = `"localhost`"" -ForegroundColor Gray
Write-Host "`$env:PGPORT = `"5432`"" -ForegroundColor Gray
Write-Host "`$env:PGDATABASE = `"todos`"" -ForegroundColor Gray
Write-Host "`$env:PGUSER = `"todos`"" -ForegroundColor Gray
Write-Host "`$env:PGPASSWORD = `"todos`"" -ForegroundColor Gray
Write-Host ""
Write-Host "You can now run: npm run dev:server and npm run dev:client" -ForegroundColor Green
