# Local Development Setup with Docker

This guide will help you run the Todo app locally using Docker for PostgreSQL.

## Prerequisites

- **Docker Desktop** installed and running
  - Download from: https://www.docker.com/products/docker-desktop
  - Available for Windows, Mac, and Linux

## Quick Start

### 1. Start the Database

```powershell
cd c:\Users\tanathip\Documents\Repository\sdet-ai-handbook\examples\e2e-realtime-monitoring
powershell -ExecutionPolicy Bypass -File .\start-db.ps1
```

This will:
- ✅ Check Docker installation
- ✅ Start PostgreSQL container on port 5432
- ✅ Auto-run migrations
- ✅ Set environment variables for the local session

### 2. Start the Backend (in a new terminal)

```powershell
cd c:\Users\tanathip\Documents\Repository\sdet-ai-handbook\examples\e2e-realtime-monitoring\app
npm run dev:server
```

### 3. Start the Frontend (in another new terminal)

```powershell
cd c:\Users\tanathip\Documents\Repository\sdet-ai-handbook\examples\e2e-realtime-monitoring\app
npm run dev:client
```

Open http://localhost:5173/ in your browser.

## Database Details

- **Host**: localhost
- **Port**: 5432
- **Database**: todos
- **User**: todos
- **Password**: todos
- **Container Name**: todos-db

## Useful Commands

### View logs
```powershell
docker-compose logs postgres
```

### Connect to database directly
```powershell
docker exec -it todos-db psql -U todos -d todos
```

### Reset database (delete all data)
```powershell
docker-compose down -v
```

Then run `.\start-db.ps1` again to recreate it.

### Stop the database
```powershell
.\stop-db.ps1
```

## Environment Variables

The `start-db.ps1` script automatically sets these for the current session:
- `PGHOST=localhost`
- `PGPORT=5432`
- `PGDATABASE=todos`
- `PGUSER=todos`
- `PGPASSWORD=todos`

To persist them permanently in PowerShell, add to your profile:
```powershell
$env:PGHOST = "localhost"
$env:PGPORT = "5432"
$env:PGDATABASE = "todos"
$env:PGUSER = "todos"
$env:PGPASSWORD = "todos"
```

## Troubleshooting

### "Docker is not installed"
- Install Docker Desktop from https://www.docker.com/products/docker-desktop
- Restart your terminal after installation

### Port 5432 already in use
- Stop the existing container: `docker-compose down`
- Or change the port in `docker-compose.yml`: `"5433:5432"` (external port change only)

### Database connection errors
- Check container status: `docker-compose ps`
- View logs: `docker-compose logs postgres`
- Ensure database is healthy: `docker exec todos-db pg_isready -U todos`

### Data persistence
- Database data is stored in Docker volume `postgres_data`
- Data persists when you stop/start the container
- Data is only deleted when running `docker-compose down -v`
