"""
__main__.py
-----------
Pulumi entry point for the Performance Testing Environment stack.

Orchestration order:
  1. Load shared config (API key, RDS password, repo URL, common tags) — config.py
  2. Provision VPC / Subnets / IGW / SG                               — networking.py
  3. Provision RDS PostgreSQL instance                                  — database.py
  4. Build Windows PowerShell user-data script                         — userdata.py
  5. Provision EC2 c5.xlarge Windows Server 2022 host                  — compute.py
  6. Export outputs for GitLab CI consumption

GitLab CI usage example:
    script:
      - INSTANCE_IP=$(pulumi stack output instance_public_ip)
      - RDS_ENDPOINT=$(pulumi stack output rds_endpoint)
      - DD_HOST=$(pulumi stack output datadog_hostname)
"""

import pulumi

from config import common_tags, dd_api_key, rds_password, repo_url
from compute import create_instance
from database import create_database
from networking import create_network
from userdata import build_userdata

# ── 1. Provision networking layer ──────────────────────────────────────────
network = create_network(common_tags)

# ── 2. Provision RDS PostgreSQL instance ───────────────────────────────────
ec2_sg_id = network["security_group"].id
db = create_database(network, ec2_sg_id, rds_password, common_tags)

# ── 3. Build startup script (Output-aware, secrets never plaintext) ────────
userdata_script = build_userdata(
    api_key=dd_api_key,
    rds_host=db["rds"].address,
    rds_password=rds_password,
    repo_url=repo_url,
)

# ── 4. Provision compute layer ─────────────────────────────────────────────
instance = create_instance(network, userdata_script, common_tags)

# ── 5. Stack outputs ───────────────────────────────────────────────────────
# Public IP — used by GitLab CI to route test traffic to the host
pulumi.export("instance_public_ip", instance.public_ip)

# RDS endpoint — connection host for the PostgreSQL database
pulumi.export("rds_endpoint", db["rds"].endpoint)

# Private DNS hostname — EC2Launch v2 registers this as the Windows computer
# name, which the Datadog Agent reports as the host identifier in the
# Datadog Infrastructure list.
pulumi.export("datadog_hostname", instance.private_dns)
