# Realtime Host Monitoring

A Docker-based host monitoring stack using OpenTelemetry, Prometheus, and Grafana with native Windows process monitoring.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         YOUR WINDOWS PC                             │
│                                                                     │
│  ┌──────────────────────┐      ┌──────────────────────────────────┐ │
│  │   Windows Exporter   │      │         Docker Desktop           │ │
│  │   (native Windows)   │      │                                  │ │
│  │                      │      │  ┌────────────────────────────┐  │ │
│  │  Monitors:           │      │  │     OTel Collector         │  │ │
│  │  - All Windows       │      │  │     (Docker/WSL2 metrics)  │  │ │
│  │    processes         │      │  │     :8889                  │  │ │
│  │                      │      │  └─────────────┬──────────────┘  │ │
│  │  :9182               │      │                │                  │ │
│  └──────────┬───────────┘      │  ┌─────────────▼──────────────┐  │ │
│             │                  │  │        Prometheus          │  │ │
│             └──────────────────┼──►        :9090               │  │ │
│                                │  └─────────────┬──────────────┘  │ │
│                                │                │                  │ │
│                                │  ┌─────────────▼──────────────┐  │ │
│                                │  │         Grafana            │  │ │
│                                │  │         :3000              │  │ │
│                                │  └────────────────────────────┘  │ │
│                                └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start the Docker stack

```bash
docker-compose up -d
```

### 2. Install Windows Exporter (for native Windows process monitoring)

```powershell
# Download
$url = "https://github.com/prometheus-community/windows_exporter/releases/download/v0.25.1/windows_exporter-0.25.1-amd64.exe"
Invoke-WebRequest -Uri $url -OutFile "$env:LOCALAPPDATA\windows_exporter.exe"

# Run (foreground)
& "$env:LOCALAPPDATA\windows_exporter.exe" --collectors.enabled=cpu,cs,logical_disk,memory,net,os,process,system

# Or install as Windows service (persistent)
sc.exe create windows_exporter binPath= "$env:LOCALAPPDATA\windows_exporter.exe --collectors.enabled=cpu,cs,logical_disk,memory,net,os,process,system" start= auto
sc.exe start windows_exporter
```

### 3. Access Grafana

Open [http://localhost:3000](http://localhost:3000) (admin/admin)

## Dashboards

| Dashboard | Description |
|-----------|-------------|
| **Host Metrics** | Docker/WSL2 VM system metrics (CPU load, memory, disk, network) |
| **Windows Processes** | Native Windows process monitoring (CPU, memory, I/O per process) |

## Services

| Service | Port | Description |
|---------|------|-------------|
| Grafana | 3000 | Visualization dashboards |
| Prometheus | 9090 | Metrics storage & querying |
| OTel Collector | 8889 | Docker/WSL2 host metrics |
| Windows Exporter | 9182 | Native Windows metrics |

## Metrics Collected

### Docker/WSL2 Metrics (OTel Collector)

- **CPU**: Load average, CPU time per process
- **Memory**: Usage by state, per-process memory
- **Disk**: I/O bytes, operations
- **Filesystem**: Usage, inodes
- **Network**: I/O bytes, packets, errors
- **Processes**: Per-process CPU, memory, disk I/O, threads

### Windows Metrics (Windows Exporter)

- **windows_process_cpu_time_total**: CPU time per process
- **windows_process_working_set_bytes**: Memory per process
- **windows_process_io_bytes_total**: Disk I/O per process
- **windows_process_thread_count**: Threads per process
- **windows_process_handles**: Handle count per process

## Example Prometheus Queries

```promql
# Top 10 Windows processes by CPU
topk(10, sum by (process) (rate(windows_process_cpu_time_total{process!~"Idle|_Total"}[1m])))

# Top 10 Windows processes by memory
topk(10, windows_process_working_set_bytes{process!~"_Total"})

# Docker/WSL2 CPU load
system_cpu_load_average_1m_ratio

# Per-process memory in Docker
process_memory_usage_bytes
```

## Files

```
├── docker-compose.yaml                              # Service definitions
├── otel-collector-config.yaml                       # OTel host metrics config
├── prometheus-config.yaml                           # Prometheus scrape config
└── grafana/provisioning/
    ├── dashboards/
    │   ├── dashboards.yaml                          # Dashboard provisioning
    │   ├── host-metrics.json                        # Docker/WSL2 metrics dashboard
    │   └── windows-processes.json                   # Windows process dashboard
    └── datasources/
        └── datasources.yaml                         # Prometheus datasource
```

## Cleanup

```bash
# Stop Docker stack
docker-compose down -v

# Stop Windows Exporter service (if installed)
sc.exe stop windows_exporter
sc.exe delete windows_exporter
```
