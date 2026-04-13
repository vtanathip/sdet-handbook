# Infrastructure as Code - Pulumi Setup

This directory contains the Infrastructure as Code (IaC) for deploying the Todo application to AWS with monitoring.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AWS Account                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────┐         ┌───────────────────┐   │
│  │  EC2 (Windows)   │         │  RDS PostgreSQL   │   │
│  │  c5.xlarge       │────────▶│  db.t3.medium     │   │
│  │  - Node.js       │         │  - todos DB       │   │
│  │  - Todo App      │  Port   │  - Secure VPC     │   │
│  │  - Datadog Agent │  5432   │  - Encrypted      │   │
│  └──────────────────┘         └───────────────────┘   │
│         │                                              │
│         │ VPC / Subnets / Security Groups              │
│         │                                              │
│  ┌──────▼──────────┐                                   │
│  │  Datadog Cloud  │ Monitoring & Profiling            │
│  └─────────────────┘                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Python 3.9+ with UV package manager
- AWS CLI configured with access keys
- Pulumi CLI installed (or will be installed via UV)
- Datadog API key

### 1. Setup Virtual Environment

```powershell
cd infra
uv sync
.\.venv-pulumi\Scripts\Activate.ps1
```

### 2. Configure Pulumi Stack

```powershell
# Initialize or select stack
pulumi stack select dev
# or if first time: pulumi stack init dev

# Set required secrets
pulumi config set --secret dd-api-key "YOUR_DATADOG_API_KEY"
pulumi config set --secret rds-password "YOUR_SECURE_RDS_PASSWORD"

# By default, the stack now generates a fresh EC2 key pair for the Windows host.
# Optional overrides:
# pulumi config set ec2-public-key "$(Get-Content $HOME/.ssh/id_ed25519.pub -Raw)"
# pulumi config set ec2-key-pair-name "your-existing-keypair-name"

# Optional: override default repository
pulumi config set repo-url "https://github.com/vtanathip/sdet-ai-handbook.git"
```

### 3. Preview Deployment

```powershell
pulumi preview
```

This shows what resources will be created without making changes.

### 4. Deploy

```powershell
pulumi up
```

Pulumi will create:
- VPC with public/private subnets across AZs
- Security groups for EC2 and RDS
- EC2 key pair for Windows RDP access (auto-generated unless overridden)
- RDS PostgreSQL instance
- EC2 Windows Server 2022 instance
- All networking and IAM resources

### 5. Access Application

Once deployment completes, get the IP:

```powershell
pulumi stack output instance_public_ip
pulumi stack output ec2_key_pair_name

# When the stack auto-generates the key pair, save the private key locally
# so you can use AWS Console -> Get password for the Administrator account.
pulumi stack output ec2_private_key_pem --show-secrets | Set-Content -Path .\perf-test-app-host.pem -NoNewline

# Quick check: the file should start with BEGIN RSA PRIVATE KEY
Get-Content .\perf-test-app-host.pem -Head 2
```

Open `http://<IP>:3001` in your browser.

For RDP on Windows instances, `ec2_key_pair_name` is the AWS key pair name you
use with **Get password** in the EC2 console to decrypt the initial
`Administrator` password. If the stack generated the key pair, use the saved
`perf-test-app-host.pem` file in the **Get password** dialog.

## File Structure

| File | Purpose |
|------|---------|
| `__main__.py` | Pulumi entry point - orchestrates all resources |
| `config.py` | Configuration loader and shared constants |
| `networking.py` | VPC, subnets, security groups |
| `database.py` | RDS PostgreSQL setup |
| `compute.py` | EC2 instance provisioning |
| `iam.py` | EC2 IAM role, instance profile, SSM policy |
| `storage.py` | S3 artifact bucket for deployment artifacts |
| `userdata.py` | Windows startup script (app deployment) |
| `Pulumi.yaml` | Project metadata |
| `.gitignore` | Excludes secrets and artifacts |
| `pyproject.toml` | Python dependencies (Pulumi + AWS provider) |

## Environment Variables on EC2

The startup script sets these at the Machine level:

```powershell
DD_API_KEY                  # Datadog authentication
DD_SERVICE=todo-api         # Service name in Datadog
DD_ENV=perf-test            # Environment tag
DD_VERSION=1.0.0            # Version tag
DD_PROFILING_ENABLED=true   # Enable continuous profiling

PGHOST                      # RDS endpoint (auto-set)
PGPORT=5432
PGDATABASE=todos
PGUSER=todos
PGPASSWORD                  # From rds-password secret
NODE_ENV=production
PORT=3001
```

## Database Setup

The startup script automatically:
1. Installs PostgreSQL client via Chocolatey
2. Clones the application repository
3. Runs migrations: `001_todos.sql`
4. Creates todos table with auto-timestamps

## Datadog Integration

The Todo API includes dd-trace instrumentation:
- **APM Tracing** - Every API request traced
- **Continuous Profiling** - CPU, Heap, Wall-clock
- **Runtime Metrics** - Memory, GC, event loop
- **Log Injection** - Trace IDs in logs

## Cleanup

To destroy all AWS resources:

```powershell
pulumi destroy
```

This removes:
- EC2 instances
- RDS database
- VPC and networking
- Security groups
- All tags and metadata

**Warning**: This cannot be undone!

## Debugging the VM

### Quick Access via SSM (recommended)

The instance has the SSM agent and `AmazonSSMManagedInstanceCore` policy
attached, so you can open a remote PowerShell session without RDP:

```powershell
# Get the instance ID from Pulumi outputs
$ip = pulumi stack output instance_public_ip

# Find the instance ID by public IP (or use the AWS Console)
$instanceId = aws ec2 describe-instances `
  --filters "Name=ip-address,Values=$ip" `
  --query "Reservations[0].Instances[0].InstanceId" --output text

# Start an interactive session
aws ssm start-session --target $instanceId
```

Once connected, run the debugging commands below.

### Access via RDP

```powershell
# 1. Save the private key (if not done already)
pulumi stack output ec2_private_key_pem --show-secrets | Set-Content -Path .\perf-test-app-host.pem -NoNewline

# 2. Get the public IP
pulumi stack output instance_public_ip

# 3. In the AWS Console → EC2 → select instance → "Get password"
#    Upload perf-test-app-host.pem to decrypt the Administrator password.

# 4. RDP to <IP>:3389 with Administrator / <decrypted password>
```

### Datadog Agent Health

Run these on the VM (via SSM or RDP):

```powershell
# Agent overall status — look for windows_performance_counters section
& "C:\Program Files\Datadog\Datadog Agent\bin\agent.exe" status

# Validate check configuration only (no data collection)
& "C:\Program Files\Datadog\Datadog Agent\bin\agent.exe" configcheck

# Show just the windows_performance_counters check status
& "C:\Program Files\Datadog\Datadog Agent\bin\agent.exe" check windows_performance_counters

# Restart the agent after config changes
Restart-Service datadogagent -Force
Get-Service datadogagent   # confirm Running
```

### Bootstrap Log

The EC2 user-data startup script writes a full transcript:

```powershell
Get-Content C:\Windows\Temp\todo-bootstrap.log -Tail 100
```

### Datadog Config Files

```powershell
# Main agent config
Get-Content "C:\ProgramData\Datadog\datadog.yaml"

# windows_performance_counters check config (the one we fixed)
Get-Content "C:\ProgramData\Datadog\conf.d\windows_performance_counters.d\conf.yaml"

# Agent install log
Get-Content "C:\Windows\Temp\datadog-install.log" -Tail 50
```

### Application Health

```powershell
# Check if the Todo API is responding
Invoke-WebRequest -Uri http://localhost:3001/api/todos -UseBasicParsing

# Check the NSSM service
nssm status TodoApp

# App logs
Get-Content C:\app\logs\stdout.log -Tail 50
Get-Content C:\app\logs\stderr.log -Tail 50
```

## Troubleshooting

### AWS Credentials Not Found
```powershell
aws configure
# Enter AWS Access Key ID and Secret Access Key
```

### Pulumi Not Found
```powershell
.\.venv-pulumi\Scripts\Activate.ps1
uv sync
```

### Stack Already Exists
```powershell
pulumi stack select dev
# or list all: pulumi stack ls
```

### Secrets Not Set
```powershell
pulumi config
# Shows which secrets are missing
```

## More Information

- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [AWS Pulumi Provider](https://www.pulumi.com/registry/packages/aws/)
- [dd-trace Node.js](https://docs.datadoghq.com/tracing/trace_collection/dd_libraries/nodejs/)
