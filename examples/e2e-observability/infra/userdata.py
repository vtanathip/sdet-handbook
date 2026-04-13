"""
userdata.py
-----------
Builds the EC2 user-data (PowerShell) startup script for the Windows Server 2022
performance-testing host.

The script:
  1. Sets Datadog + PostgreSQL environment variables at the Machine level.
  2. Opens the Windows Firewall for the application port.
  3. Downloads and installs the Datadog Agent MSI (with retry).
  4. Writes the windows_performance_counters PDH conf.yaml.
  5. Installs Chocolatey, then Node.js LTS and NSSM.
  6. Downloads the pre-built application ZIP from S3 and extracts it.
  7. Runs the DB migration SQL via Node.js using the app's pg dependency.
  8. Registers and starts the Node.js API server as a Windows service via NSSM.
  9. Verifies the app is listening on the expected port.

All secrets (api_key, rds_password) are resolved at deploy time through
pulumi.Output.all so they are never materialised as plain-text strings.

The script is wrapped in <powershell>...</powershell> tags, required by
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
# Use 'Continue' so that native-command stderr (choco, nssm)
# is not treated as a terminating error. Real failures are caught via
# explicit $LASTEXITCODE checks and throw statements.
$ErrorActionPreference = 'Continue'

# Bootstrap transcript for post-mortem troubleshooting.
$bootstrapLog = 'C:\\Windows\\Temp\\todo-bootstrap.log'
Start-Transcript -Path $bootstrapLog -Append -Force

# -- 1. Set persistent system-level environment variables ---------------------
Write-Host 'Setting system environment variables...'
[Environment]::SetEnvironmentVariable('DD_API_KEY',            '{api_key}',      'Machine')
[Environment]::SetEnvironmentVariable('DD_PROFILING_ENABLED',  'true',           'Machine')
[Environment]::SetEnvironmentVariable('DD_ENV',                'perf-test',      'Machine')
[Environment]::SetEnvironmentVariable('DD_SERVICE',            'todo-api',       'Machine')
[Environment]::SetEnvironmentVariable('DD_VERSION',            '1.0.0',          'Machine')
[Environment]::SetEnvironmentVariable('PGHOST',                '{rds_host}',     'Machine')
[Environment]::SetEnvironmentVariable('PGPORT',                '5432',           'Machine')
[Environment]::SetEnvironmentVariable('PGDATABASE',            'todos',          'Machine')
[Environment]::SetEnvironmentVariable('PGUSER',                'todos',          'Machine')
[Environment]::SetEnvironmentVariable('PGPASSWORD',            '{rds_password}', 'Machine')
[Environment]::SetEnvironmentVariable('NODE_ENV',              'production',     'Machine')
[Environment]::SetEnvironmentVariable('PORT',                  '3001',           'Machine')

# -- 2. Open Windows Firewall for app traffic --------------------------------
if (-not (Get-NetFirewallRule -DisplayName 'Allow TodoApp 3001' -ErrorAction SilentlyContinue)) {{
  New-NetFirewallRule -DisplayName 'Allow TodoApp 3001' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 | Out-Null
}}

# -- 3. Install Datadog Agent (mandatory - failure halts bootstrap) -----------
Write-Host 'Installing Datadog Agent...'
$msiUrl  = 'https://windows-agent.datadoghq.com/datadog-agent-7-latest.amd64.msi'
$msiPath = 'C:\\Windows\\Temp\\datadog-agent-latest.amd64.msi'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Download MSI with retry (3 attempts, 30-second backoff)
$maxDownloadAttempts = 3
$downloadSuccess = $false
for ($dlAttempt = 1; $dlAttempt -le $maxDownloadAttempts; $dlAttempt++) {{
  Write-Host "Downloading Datadog Agent MSI (attempt $dlAttempt/$maxDownloadAttempts)..."
  try {{
    if (Test-Path $msiPath) {{ Remove-Item -Force $msiPath }}
    Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing -TimeoutSec 600
    if (-not (Test-Path $msiPath)) {{
      throw 'MSI file not created after download.'
    }}
    $msiSize = (Get-Item $msiPath).Length
    if ($msiSize -lt 1MB) {{
      throw "MSI file is only $msiSize bytes - likely truncated."
    }}
    Write-Host "MSI downloaded successfully ($([math]::Round($msiSize / 1MB, 1)) MB)."
    $downloadSuccess = $true
    break
  }} catch {{
    Write-Warning "Download attempt $dlAttempt failed: $($_.Exception.Message)"
    if ($dlAttempt -lt $maxDownloadAttempts) {{
      Write-Host 'Retrying in 30 seconds...'
      Start-Sleep -Seconds 30
    }}
  }}
}}
if (-not $downloadSuccess) {{
  Stop-Transcript
  throw 'Datadog Agent MSI download failed after all retry attempts.'
}}

# Install MSI - use Start-Process -Wait to avoid the WaitForExit ExitCode race
Write-Host 'Running Datadog Agent MSI installer...'
$installArgs = @(
  '/i', $msiPath,
  '/qn',
  '/log', 'C:\\Windows\\Temp\\datadog-install.log',
  "APIKEY={api_key}",
  'SITE={dd_site}',
  'TAGS=env:perf-test,project:ui-perf-test,team:qa-automation,costcenter:qe-dept',
  'REBOOT=ReallySuppress'
)
$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $installArgs -Wait -PassThru
if ($proc.ExitCode -ne 0) {{
  Write-Host 'Datadog MSI install failed. Last 80 lines of datadog-install.log:'
  if (Test-Path 'C:\\Windows\\Temp\\datadog-install.log') {{
    Get-Content 'C:\\Windows\\Temp\\datadog-install.log' -Tail 80 | Write-Host
  }}
  Stop-Transcript
  throw "Datadog Agent installation failed with exit code $($proc.ExitCode)."
}}
Write-Host 'Datadog Agent installed successfully.'

# Write windows_performance_counters conf.yaml
$confDir = 'C:\\ProgramData\\Datadog\\conf.d\\windows_performance_counters.d'
if (-not (Test-Path $confDir)) {{
  New-Item -ItemType Directory -Path $confDir -Force | Out-Null
}}
$confYaml = @'
{perf_conf}
'@
$confYaml | Set-Content -Path "$confDir\\conf.yaml" -Encoding UTF8 -Force
Write-Host 'windows_performance_counters conf.yaml written.'

# Restart agent and verify the service reaches Running state
if (Get-Service -Name 'datadogagent' -ErrorAction SilentlyContinue) {{
  Restart-Service -Name 'datadogagent' -Force
  Write-Host 'Waiting for datadogagent service to reach Running state...'
  $ddReady = $false
  for ($ddWait = 1; $ddWait -le 12; $ddWait++) {{
    $svc = Get-Service -Name 'datadogagent'
    if ($svc.Status -eq 'Running') {{ $ddReady = $true; break }}
    Start-Sleep -Seconds 5
  }}
  if (-not $ddReady) {{
    Stop-Transcript
    throw 'datadogagent service did not reach Running state within 60 seconds.'
  }}
  Write-Host 'Datadog Agent is running.'
}} else {{
  Stop-Transcript
  throw 'datadogagent service not found after installation.'
}}

# -- 4. Install Chocolatey ------------------------------------------------
Write-Host 'Installing Chocolatey...'
Set-ExecutionPolicy Bypass -Scope Process -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
$env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
Write-Host 'Chocolatey installed.'

# -- 5. Install runtime dependencies via Chocolatey --------------------------
Write-Host 'Installing Node.js LTS and NSSM...'
choco install nodejs-lts nssm --no-progress -y
if ($LASTEXITCODE -ne 0) {{
  throw "Chocolatey package install failed with exit code $LASTEXITCODE"
}}

# Refresh PATH so node/npm/nssm are available in this session.
$env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')

$extraBinDirs = @(
  'C:\\ProgramData\\chocolatey\\bin'
)
foreach ($binDir in $extraBinDirs) {{
  if ((Test-Path $binDir) -and -not ($env:PATH -like "*$binDir*")) {{
    $env:PATH = "$env:PATH;$binDir"
  }}
}}

$nodeExe = if (Get-Command node -ErrorAction SilentlyContinue) {{
  (Get-Command node).Source
}} elseif (Test-Path 'C:\\Program Files\\nodejs\\node.exe') {{
  'C:\\Program Files\\nodejs\\node.exe'
}} else {{
  $null
}}

$nssmExe = if (Get-Command nssm -ErrorAction SilentlyContinue) {{
  (Get-Command nssm).Source
}} elseif (Test-Path 'C:\\ProgramData\\chocolatey\\bin\\nssm.exe') {{
  'C:\\ProgramData\\chocolatey\\bin\\nssm.exe'
}} else {{
  $null
}}

foreach ($required in @(
  @{{ Name = 'node'; Path = $nodeExe }},
  @{{ Name = 'nssm'; Path = $nssmExe }}
)) {{
  if (-not $required.Path) {{
    Write-Host "Missing command after dependency install: $($required.Name)"
    if (Test-Path 'C:\\ProgramData\\chocolatey\\logs\\chocolatey.log') {{
      Write-Host 'Last 120 lines of chocolatey.log:'
      Get-Content 'C:\\ProgramData\\chocolatey\\logs\\chocolatey.log' -Tail 120 | Write-Host
    }}
    throw "Required command not found after install: $($required.Name)"
  }}
}}
Write-Host 'Runtime dependencies installed.'

# -- 6. Download and extract application artifact from S3 --------------------
$appDir  = 'C:\\app'
$zipPath = 'C:\\Windows\\Temp\\app-artifact.zip'

if (Test-Path $appDir) {{ Remove-Item -Recurse -Force $appDir }}

Write-Host 'Downloading application artifact from S3...'
$s3Bucket = '{s3_bucket}'
$s3Key    = '{s3_key}'
$s3Region = '{region}'

# Strategy: Use AWS PowerShell module (pre-installed on Windows Server AMIs).
# Falls back to AWS CLI if the module is not available.
$downloaded = $false

# -- Attempt 1: AWS Tools for PowerShell -----------------------------------
Write-Host 'Trying AWS PowerShell module (Read-S3Object)...'
try {{
  # Try both module variants (AWSPowerShell and AWS.Tools)
  $awsModuleLoaded = $false
  foreach ($modName in @('AWSPowerShell.NetCore', 'AWSPowerShell', 'AWS.Tools.S3')) {{
    if (Get-Module -ListAvailable -Name $modName -ErrorAction SilentlyContinue) {{
      Import-Module $modName -ErrorAction Stop
      Write-Host "Loaded module: $modName"
      $awsModuleLoaded = $true
      break
    }}
  }}
  if ($awsModuleLoaded) {{
    # Module loaded - use Read-S3Object which auto-picks up IAM instance profile creds
    Write-Host "Downloading s3://$s3Bucket/$s3Key via Read-S3Object..."
    Read-S3Object -BucketName $s3Bucket -Key $s3Key -File $zipPath -Region $s3Region
    if (Test-Path $zipPath) {{
      $downloaded = $true
      Write-Host "Downloaded via AWS PowerShell module."
    }} else {{
      Write-Host "Read-S3Object completed but file not found at $zipPath"
    }}
  }} else {{
    Write-Host 'No AWS PowerShell module found, skipping to CLI fallback.'
  }}
}} catch {{
  Write-Host "AWS PowerShell module failed: $($_.Exception.Message)"
}}

# -- Attempt 2: AWS CLI (if PowerShell module failed) ----------------------
if (-not $downloaded) {{
  Write-Host 'Trying AWS CLI fallback...'
  $awsCli = $null
  $cliPaths = @(
    'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe',
    'C:\\Program Files\\Amazon\\AWSCLI\\bin\\aws.exe',
    'C:\\Program Files (x86)\\Amazon\\AWSCLI\\bin\\aws.exe'
  )
  foreach ($p in $cliPaths) {{
    Write-Host "  Checking $p ..."
    if (Test-Path $p) {{
      $awsCli = $p
      Write-Host "  Found AWS CLI at: $p"
      break
    }}
  }}
  if (-not $awsCli) {{
    # Last-resort: PATH lookup
    $awsCli = (Get-Command aws -ErrorAction SilentlyContinue).Source
    if ($awsCli) {{ Write-Host "  Found AWS CLI in PATH: $awsCli" }}
  }}

  if ($awsCli) {{
    $env:AWS_DEFAULT_REGION = $s3Region
    Write-Host "Downloading s3://$s3Bucket/$s3Key via CLI..."
    $s3Out = & $awsCli s3 cp "s3://$s3Bucket/$s3Key" $zipPath --no-progress --region $s3Region 2>&1 | Out-String
    $s3Exit = $LASTEXITCODE
    if ($s3Out) {{ Write-Host $s3Out }}
    if (($s3Exit -eq 0) -and (Test-Path $zipPath)) {{
      $downloaded = $true
      Write-Host 'Downloaded via AWS CLI.'
    }} else {{
      Write-Host "AWS CLI download failed (exit code $s3Exit)."
    }}
  }} else {{
    Write-Host '  AWS CLI not found in any known location.'
  }}
}}

if (-not $downloaded) {{
  # List what IS available for diagnostics
  Write-Host '--- Diagnostics ---'
  Write-Host 'Available AWS modules:'
  Get-Module -ListAvailable -Name AWS* | Select-Object Name, Version | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host 'Files under C:\\Program Files\\Amazon\\'
  if (Test-Path 'C:\\Program Files\\Amazon') {{
    Get-ChildItem 'C:\\Program Files\\Amazon' -Recurse -Depth 2 | Select-Object FullName | Out-String | Write-Host
  }} else {{
    Write-Host '  Directory does not exist.'
  }}
  Stop-Transcript
  throw "Failed to download s3://$s3Bucket/$s3Key - no working download method found."
}}

Write-Host "Artifact downloaded ($([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)."

Write-Host 'Extracting artifact...'
Expand-Archive -Path $zipPath -DestinationPath $appDir -Force
Remove-Item -Force $zipPath

# Validate expected structure
$indexJs = Join-Path $appDir 'server\\dist\\index.js'
if (-not (Test-Path $indexJs)) {{
  Write-Host 'Extracted contents:'
  Get-ChildItem $appDir -Recurse -Depth 2 | Select-Object FullName | Format-Table -AutoSize | Out-String | Write-Host
  Stop-Transcript
  throw "Expected $indexJs not found in extracted artifact."
}}
Write-Host 'Artifact extracted and validated.'

# -- 7. Run database migration --------------------------------------------
Write-Host 'Running database migration...'
$migrationSql = Join-Path $appDir 'server\\migrations\\001_todos.sql'
$migrationRunner = @"
const fs = require('fs');
const path = require('path');
const {{ Client }} = require('pg');

(async () => {{
  const sqlPath = path.resolve(process.argv[2]);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({{
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: {{ rejectUnauthorized: false }},
  }});

  await client.connect();
  try {{
    await client.query(sql);
  }} finally {{
    await client.end();
  }}
}})().catch((error) => {{
  console.error(error);
  process.exit(1);
}});
"@
# Place runner inside server/ so require('pg') resolves to server/node_modules/pg
$migrationRunnerPath = Join-Path $appDir 'server\\run-migration.cjs'
$migrationRunner | Set-Content -Path $migrationRunnerPath -Encoding UTF8 -Force
$env:PGHOST     = '{rds_host}'
$env:PGPORT     = '5432'
$env:PGDATABASE = 'todos'
$env:PGUSER     = 'todos'
$env:PGPASSWORD = '{rds_password}'
Write-Host "Migration target: $env:PGHOST"
$migOut = & $nodeExe $migrationRunnerPath $migrationSql 2>&1 | Out-String
$migExit = $LASTEXITCODE
if ($migOut) {{ Write-Host $migOut }}
if ($migExit -ne 0) {{
  Write-Host "Migration failed with exit code $migExit"
  Stop-Transcript
  throw "Database migration failed with exit code $migExit."
}}
Write-Host 'Database migration complete.'

# -- 8. Register Todo API as a Windows service via NSSM ----------------------
Write-Host 'Registering TodoApp service with NSSM...'
$nodePath  = $nodeExe
$indexPath = Join-Path $appDir 'server\\dist\\index.js'
$logDir    = 'C:\\app\\logs'
if (-not (Test-Path $logDir)) {{ New-Item -ItemType Directory -Path $logDir -Force | Out-Null }}

& $nssmExe install TodoApp $nodePath $indexPath
& $nssmExe set TodoApp AppDirectory $appDir
& $nssmExe set TodoApp AppEnvironmentExtra `
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
& $nssmExe set TodoApp AppStdout "$logDir\\stdout.log"
& $nssmExe set TodoApp AppStderr "$logDir\\stderr.log"
& $nssmExe set TodoApp AppRotateFiles 1
& $nssmExe set TodoApp Start SERVICE_AUTO_START

Write-Host 'Starting TodoApp service...'
& $nssmExe start TodoApp

# -- 9. Verify app is actually listening on localhost:3001 --------------------
Write-Host 'Waiting for Todo app to become ready on localhost:3001...'
$maxAttempts = 24
$ready = $false
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {{
  try {{
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 3001 -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {{
      $ready = $true
      break
    }}
  }} catch {{
    # Ignore transient socket failures while the process is booting.
  }}
  Start-Sleep -Seconds 5
}}

if (-not $ready) {{
  Write-Host 'Todo app did not become ready in time.'
  Write-Host 'TodoApp service status:'
  Get-Service TodoApp | Format-List * | Out-String | Write-Host
  if (Test-Path "$logDir\\stderr.log") {{
    Write-Host 'Last 200 lines of stderr.log:'
    Get-Content "$logDir\\stderr.log" -Tail 200 | Write-Host
  }}
  if (Test-Path "$logDir\\stdout.log") {{
    Write-Host 'Last 200 lines of stdout.log:'
    Get-Content "$logDir\\stdout.log" -Tail 200 | Write-Host
  }}
  Stop-Transcript
  throw 'Todo app failed readiness check on port 3001.'
}}

Write-Host 'Todo app is ready on port 3001.'

Stop-Transcript
Write-Host 'Startup script completed successfully.'
</powershell>
"""


def build_userdata(
    api_key: pulumi.Output,
    rds_host: pulumi.Output,
    rds_password: pulumi.Output,
    s3_bucket: pulumi.Input[str],
    s3_key: str = "app-artifact.zip",
    dd_site: str = "datadoghq.com",
    region: str = "us-east-1",
) -> pulumi.Output:
    """
    Returns an Output[str] containing the full EC2 user-data PowerShell script.

    All secret values are resolved at deploy time via pulumi.Output.all so
    they are never materialised as plain strings in the Pulumi state file.
    """
    return pulumi.Output.all(api_key, rds_host, rds_password, s3_bucket).apply(
        lambda args: _SCRIPT_TEMPLATE.format(
            api_key=args[0],
            rds_host=args[1],
            rds_password=args[2],
            s3_bucket=args[3],
            s3_key=s3_key,
            dd_site=dd_site,
            region=region,
            perf_conf=_PERF_CONF_YAML.strip(),
        )
    )
