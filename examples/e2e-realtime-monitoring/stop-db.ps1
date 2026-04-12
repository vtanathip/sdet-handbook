# Stop PostgreSQL Docker container

Write-Host ""
Write-Host "Stopping PostgreSQL container..." -ForegroundColor Cyan

try {
    docker-compose down
    Write-Host "Container stopped" -ForegroundColor Green
} catch {
    Write-Host "Failed to stop container" -ForegroundColor Red
    exit 1
}

Write-Host ""
