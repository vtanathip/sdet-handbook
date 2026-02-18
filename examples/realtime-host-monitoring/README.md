# Realtime Host Monitoring

A Docker-based host monitoring stack using OpenTelemetry, Prometheus, and Grafana.

## Architecture

```
┌─────────────────┐     ┌─────────────┐     ┌─────────────┐
│  OTel Collector │────▶│  Prometheus │────▶│   Grafana   │
│   (Host Metrics)│     │   (Storage) │     │   (UI)      │
└─────────────────┘     └─────────────┘     └─────────────┘
      :8889                  :9090              :3000
```

## Quick Start

```bash
docker-compose up -d
```

Open [http://localhost:3000](http://localhost:3000) (admin/admin) and navigate to **Host Metrics** dashboard.

## Services

| Service | Port | Description |
|---------|------|-------------|
| Grafana | 3000 | Visualization dashboard |
| Prometheus | 9090 | Metrics storage |
| OTel Collector | 8889 | Metrics endpoint |

## Metrics Collected

- **CPU**: Load average, CPU time
- **Memory**: Usage by state (used, cached, free)
- **Disk**: I/O bytes, operations
- **Filesystem**: Usage, inodes
- **Network**: I/O bytes, packets, errors

## Files

```
├── docker-compose.yaml          # Service definitions
├── otel-collector-config.yaml   # OTel host metrics config
├── prometheus-config.yaml       # Prometheus scrape config
└── grafana/provisioning/        # Auto-provisioned datasources & dashboards
```

## Cleanup

```bash
docker-compose down -v
```
