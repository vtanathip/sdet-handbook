"""
userdata.py
-----------
Builds the EC2 user-data (PowerShell) startup script for the Windows Server 2022
performance-testing host.

The script:
  1. Downloads and silently installs the Datadog Agent MSI.
  2. Writes the windows_performance_counters PDH conf.yaml.
  3. Sets Datadog + PostgreSQL environment variables at the Machine level.
  4. Installs Chocolatey, then Node.js LTS, Git, NSSM, and psql (postgresql).
  5. Clones the application repository and installs npm dependencies.
  6. Builds the React client (npm run build -w client).
  7. Runs the DB migration SQL via psql.
  8. Registers and starts the Node.js API server as a Windows service via NSSM.

All secrets (api_key, rds_password) are resolved at deploy time through
pulumi.Output.all so they are never materialised as plain-text strings.

The script is wrapped in <powershell>…</powershell> tags, required by
EC2Launch v2 on Windows Server 2022.
"""

import pulumi

# PDH counter paths for windows_performance_counters integration
_PERF_CONF_YAML = r"""init_config:

instances:
  - counterSpecifier: '\Processor(_Total)\% Processor Time'
    instanceName: cpu_total
    measurementName: cpu.percent_processor_time

  - counterSpecifier: '\Memory\Available MBytes'
    instanceName: memory
    measurementName: memory.available_mbytes

  - counterSpecifier: '\LogicalDisk(_Total)\% Free Space'
    instanceName: disk_total
    measurementName: disk.percent_free_space
"""

_SCRIPT_TEMPLATE = """\
<powershell>
$ErrorActionPreference = 'Stop'

# ── 1. Download Datadog Agent MSI ──────────────────────────────────────────
$msiUrl  = 'https://windows-agent.datadoghq.com/datadog-agent-7-latest.amd64.msi'
$msiPath = 'C:\\Windows\\Temp\\datadog-agent-latest.amd64.msi'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Write-Host 'Downloading Datadog Agent MSI...'
Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing

# ── 2. Silent install ──────────────────────────────────────────────────────
Write-Host 'Installing Datadog Agent...'
$installArgs = @(
    '/qn',
    '/log', 'C:\\Windows\\Temp\\datadog-install.log',
    "APIKEY={api_key}",
    'SITE=datadoghq.com',
    'TAGS="env:perf-test,project:ui-perf-test,team:qa-automation,costcenter:qe-dept"',
    'REBOOT=ReallySuppress'
)
$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $installArgs -Wait -PassThru
if ($proc.ExitCode -ne 0) {{
    throw "Datadog Agent installation failed with exit code $($proc.ExitCode)"
}}
Write-Host 'Datadog Agent installed successfully.'

# ── 3. Set persistent system-level environment variables ──────────────────
Write-Host 'Setting system environment variables...'
[Environment]::SetEnvironmentVariable('DD_API_KEY',            '{api_key}',    'Machine')
[Environment]::SetEnvironmentVariable('DD_PROFILING_ENABLED',  'true',         'Machine')
[Environment]::SetEnvironmentVariable('DD_ENV',                'perf-test',    'Machine')
[Environment]::SetEnvironmentVariable('DD_SERVICE',            'todo-api',     'Machine')
[Environment]::SetEnvironmentVariable('DD_VERSION',            '1.0.0',        'Machine')
[Environment]::SetEnvironmentVariable('PGHOST',                '{rds_host}',   'Machine')
[Environment]::SetEnvironmentVariable('PGPORT',                '5432',         'Machine')
[Environment]::SetEnvironmentVariable('PGDATABASE',            'todos',        'Machine')
[Environment]::SetEnvironmentVariable('PGUSER',                'todos',        'Machine')
[Environment]::SetEnvironmentVariable('PGPASSWORD',            '{rds_password}', 'Machine')
[Environment]::SetEnvironmentVariable('NODE_ENV',              'production',   'Machine')
[Environment]::SetEnvironmentVariable('PORT',                  '3001',         'Machine')

# ── 4. Create windows_performance_counters integration config ──────────────
$confDir = 'C:\\ProgramData\\Datadog\\conf.d\\windows_performance_counters.d'
if (-not (Test-Path $confDir)) {{
    New-Item -ItemType Directory -Path $confDir -Force | Out-Null
}}
$confYaml = @'
{perf_conf}
'@
$confYaml | Set-Content -Path "$confDir\\conf.yaml" -Encoding UTF8 -Force
Write-Host 'windows_performance_counters conf.yaml written.'

# ── 5. Restart Datadog Agent service ──────────────────────────────────────
Write-Host 'Restarting datadogagent service...'
Restart-Service -Name 'datadogagent' -Force
Write-Host 'Datadog Agent restarted.'

# ── 6. Install Chocolatey ──────────────────────────────────────────────────
Write-Host 'Installing Chocolatey...'
Set-ExecutionPolicy Bypass -Scope Process -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
$env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
Write-Host 'Chocolatey installed.'

# ── 7. Install runtime dependencies via Chocolatey ────────────────────────
Write-Host 'Installing Node.js LTS, Git, NSSM, and PostgreSQL client...'
choco install nodejs-lts git nssm postgresql --no-progress -y
# Refresh PATH so node/npm/git/psql are available in this session
$env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')
Write-Host 'Runtime dependencies installed.'

# ── 8. Clone application repository ───────────────────────────────────────
$appRoot = 'C:\\app'
if (Test-Path $appRoot) {{ Remove-Item -Recurse -Force $appRoot }}
Write-Host 'Cloning repository...'
git clone '{repo_url}' $appRoot
$appDir = Join-Path $appRoot 'examples\\e2e-realtime-monitoring\\app'
Write-Host "App directory: $appDir"

# ── 9. Install npm dependencies and build client ───────────────────────────
Write-Host 'Installing npm dependencies...'
Set-Location $appDir
npm install --workspaces
Write-Host 'Building React client...'
npm run build --workspace client
Write-Host 'Client build complete.'

# ── 10. Run database migration ────────────────────────────────────────────
Write-Host 'Running database migration...'
$migrationSql = Join-Path $appDir 'server\\migrations\\001_todos.sql'
$env:PGPASSWORD = '{rds_password}'
psql -h '{rds_host}' -U todos -d todos -f $migrationSql
Write-Host 'Database migration complete.'

# ── 11. Register Todo API as a Windows service via NSSM ───────────────────
Write-Host 'Registering TodoApp service with NSSM...'
$nodePath  = (Get-Command node).Source
$indexPath = Join-Path $appDir 'server\\index.js'
$logDir    = 'C:\\app\\logs'
if (-not (Test-Path $logDir)) {{ New-Item -ItemType Directory -Path $logDir -Force | Out-Null }}

nssm install TodoApp $nodePath $indexPath
nssm set TodoApp AppDirectory $appDir
nssm set TodoApp AppEnvironmentExtra `
    "DD_API_KEY={api_key}" `
    "DD_SERVICE=todo-api" `
    "DD_ENV=perf-test" `
    "DD_VERSION=1.0.0" `
    "DD_PROFILING_ENABLED=true" `
    "NODE_ENV=production" `
    "PORT=3001" `
    "PGHOST={rds_host}" `
    "PGPORT=5432" `
    "PGDATABASE=todos" `
    "PGUSER=todos" `
    "PGPASSWORD={rds_password}"
nssm set TodoApp AppStdout "$logDir\\stdout.log"
nssm set TodoApp AppStderr "$logDir\\stderr.log"
nssm set TodoApp AppRotateFiles 1
nssm set TodoApp Start SERVICE_AUTO_START

Write-Host 'Starting TodoApp service...'
nssm start TodoApp
Write-Host 'Startup script completed successfully.'
</powershell>
"""


def build_userdata(
    api_key: pulumi.Output,
    rds_host: pulumi.Output,
    rds_password: pulumi.Output,
    repo_url: str,
) -> pulumi.Output:
    """
    Returns an Output[str] containing the full EC2 user-data PowerShell script.

    All secret values are resolved at deploy time via pulumi.Output.all so
    they are never materialised as plain strings in the Pulumi state file.
    """
    return pulumi.Output.all(api_key, rds_host, rds_password).apply(
        lambda args: _SCRIPT_TEMPLATE.format(
            api_key=args[0],
            rds_host=args[1],
            rds_password=args[2],
            repo_url=repo_url,
            perf_conf=_PERF_CONF_YAML.strip(),
        )
    )
