"""
userdata.py
-----------
Builds the EC2 user-data (PowerShell) startup script for the Windows Server 2022
performance-testing host.

The script:
  1. Downloads the latest Datadog Agent MSI from the official Datadog CDN.
  2. Silently installs the agent with the provided API key and env tags.
  3. Injects DD_API_KEY, DD_PROFILING_ENABLED, and DD_ENV as persistent
     Machine-level environment variables.
  4. Creates the windows_performance_counters integration conf.yaml to
     monitor CPU, Memory, and Disk via PDH.
  5. Restarts the datadogagent Windows service.

The script is wrapped in <powershell>…</powershell> tags, which is required
by EC2Launch v2 on Windows Server 2022 to execute user-data as PowerShell.
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
Write-Host 'Setting Datadog environment variables...'
[Environment]::SetEnvironmentVariable('DD_API_KEY',            '{api_key}',  'Machine')
[Environment]::SetEnvironmentVariable('DD_PROFILING_ENABLED',  'true',       'Machine')
[Environment]::SetEnvironmentVariable('DD_ENV',                'perf-test',  'Machine')

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
Write-Host 'Startup script completed successfully.'
</powershell>
"""


def build_userdata(api_key: pulumi.Output) -> pulumi.Output:
    """
    Returns an Output[str] containing the full EC2 user-data PowerShell script.

    The Datadog API key is resolved at deploy time via pulumi.Output.all so
    it is never materialised as a plain string in the Pulumi state file.
    """
    return pulumi.Output.all(api_key).apply(
        lambda args: _SCRIPT_TEMPLATE.format(
            api_key=args[0],
            perf_conf=_PERF_CONF_YAML.strip(),
        )
    )
