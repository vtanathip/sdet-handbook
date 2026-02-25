# Windows Exporter Download and Run Script
# Reference: https://github.com/prometheus-community/windows_exporter

$ErrorActionPreference = "Stop"

# Configuration
$version = "0.25.1"
$downloadUrl = "https://github.com/prometheus-community/windows_exporter/releases/download/v$version/windows_exporter-$version-amd64.exe"
$exePath = "$PSScriptRoot\windows_exporter.exe"

# Download if not exists
if (-not (Test-Path $exePath)) {
    Write-Host "Downloading Windows Exporter v$version..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $downloadUrl -OutFile $exePath -UseBasicParsing
    Write-Host "Download complete!" -ForegroundColor Green
}
else {
    Write-Host "Windows Exporter already exists at $exePath" -ForegroundColor Yellow
}

# Run Windows Exporter
Write-Host "Starting Windows Exporter on http://localhost:9182/metrics" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

& $exePath --collectors.enabled "cpu,cs,logical_disk,memory,net,os,process,system,tcp,thermalzone"
