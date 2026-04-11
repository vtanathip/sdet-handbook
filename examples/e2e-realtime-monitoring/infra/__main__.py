"""
__main__.py
-----------
Pulumi entry point for the Performance Testing Environment stack.

Orchestration order:
  1. Load shared config (API key, common tags)          — config.py
  2. Build Windows PowerShell user-data script          — userdata.py
  3. Provision VPC / Subnet / IGW / SG                  — networking.py
  4. Provision EC2 c5.xlarge Windows Server 2022 host   — compute.py
  5. Export outputs for GitLab CI consumption

GitLab CI usage example:
    script:
      - INSTANCE_IP=$(pulumi stack output instance_public_ip)
      - DD_HOST=$(pulumi stack output datadog_hostname)
"""

import pulumi

from config import common_tags, dd_api_key
from compute import create_instance
from networking import create_network
from userdata import build_userdata

# ── 1. Build startup script (Output-aware, secret never plaintext) ─────────
userdata_script = build_userdata(dd_api_key)

# ── 2. Provision networking layer ──────────────────────────────────────────
network = create_network(common_tags)

# ── 3. Provision compute layer ─────────────────────────────────────────────
instance = create_instance(network, userdata_script, common_tags)

# ── 4. Stack outputs ───────────────────────────────────────────────────────
# Public IP — used by GitLab CI to route test traffic to the host
pulumi.export("instance_public_ip", instance.public_ip)

# Private DNS hostname — EC2Launch v2 registers this as the Windows computer
# name, which the Datadog Agent reports as the host identifier in the
# Datadog Infrastructure list.
pulumi.export("datadog_hostname", instance.private_dns)
