# Stop PostgreSQL Docker container

Write-Host ""
Write-Host "Stopping PostgreSQL container..." -ForegroundColor Cyan

try {
    cmd /c "docker-compose down --remove-orphans"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Container stopped" -ForegroundColor Green
    }
    else {
        Write-Host "Failed to stop container" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "Failed to stop container" -ForegroundColor Red
    exit 1
}

Write-Host ""
