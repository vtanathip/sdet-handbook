"""
__main__.py
-----------
Pulumi entry point for the Performance Testing Environment stack.

Orchestration order:
  1. Load shared config (API key, RDS password, common tags)          — config.py
  2. Provision VPC / Subnets / IGW / SG                               — networking.py
  3. Provision RDS PostgreSQL instance                                 — database.py
  4. Provision S3 artifact bucket                                      — storage.py
  5. Provision IAM instance profile (EC2 → S3 read)                    — iam.py
  6. Build Windows PowerShell user-data script                         — userdata.py
  7. Provision EC2 c5.xlarge Windows Server 2022 host                  — compute.py
  8. Export outputs

Usage example:
    script:
      - INSTANCE_IP=$(pulumi stack output instance_public_ip)
      - RDS_ENDPOINT=$(pulumi stack output rds_endpoint)
      - DD_HOST=$(pulumi stack output datadog_hostname)
      - S3_BUCKET=$(pulumi stack output artifact_s3_bucket)
"""

import pulumi
import pulumi_aws as aws

from config import (
    artifact_s3_key,
    common_tags,
    dd_api_key,
    dd_site,
    ec2_key_pair_name,
    ec2_public_key,
    rds_password,
)
from compute import create_generated_key_pair, create_instance, create_key_pair
from database import create_database
from iam import create_instance_profile
from networking import create_network
from storage import create_artifact_bucket
from userdata import build_userdata

# ── 1. Provision networking layer ──────────────────────────────────────────
network = create_network(common_tags)

# ── 2. Provision RDS PostgreSQL instance ───────────────────────────────────
ec2_sg_id = network["security_group"].id
db = create_database(network, ec2_sg_id, rds_password, common_tags)

# ── 3. Provision S3 artifact bucket + IAM instance profile ─────────────────
bucket = create_artifact_bucket(common_tags)
instance_profile = create_instance_profile(bucket.arn, common_tags)

# ── 4. Build startup script (Output-aware, secrets never plaintext) ────────
aws_region = aws.get_region().name
userdata_script = build_userdata(
    api_key=dd_api_key,
    rds_host=db["rds"].address,
    rds_password=rds_password,
    s3_bucket=bucket.bucket,
    s3_key=artifact_s3_key,
    dd_site=dd_site,
    region=aws_region,
)

# ── 5. Provision compute layer ─────────────────────────────────────────────
resolved_key_name = ec2_key_pair_name
generated_private_key_pem = None
if ec2_public_key:
    if ec2_key_pair_name:
        raise ValueError(
            "Set either ec2-public-key or ec2-key-pair-name, not both."
        )
    key_pair = create_key_pair(ec2_public_key, common_tags)
    resolved_key_name = key_pair.key_name
elif not ec2_key_pair_name:
    generated_key_pair, generated_private_key_pem = create_generated_key_pair(
        common_tags)
    resolved_key_name = generated_key_pair.key_name

instance = create_instance(
    network,
    userdata_script,
    common_tags,
    key_name=resolved_key_name,
    iam_instance_profile=instance_profile.name,
)

# ── 6. Stack outputs ───────────────────────────────────────────────────────
# Public IP — used by CI to route test traffic to the host
pulumi.export("instance_public_ip", instance.public_ip)

# RDS endpoint — connection host for the PostgreSQL database
pulumi.export("rds_endpoint", db["rds"].endpoint)

# Private DNS hostname — EC2Launch v2 registers this as the Windows computer
# name, which the Datadog Agent reports as the host identifier in the
# Datadog Infrastructure list.
pulumi.export("datadog_hostname", instance.private_dns)

# S3 bucket name — used by build-artifact.ps1 to upload the ZIP
pulumi.export("artifact_s3_bucket", bucket.bucket)

# Effective EC2 key pair name attached to the Windows instance. This is used
# by AWS to encrypt the initial Administrator password for RDP access.
pulumi.export("ec2_key_pair_name", resolved_key_name)

# When the stack auto-generates the key pair, export the private key as a
# secret output so it can be saved locally and used to decrypt the initial RDP password.
if generated_private_key_pem is not None:
    pulumi.export("ec2_private_key_pem",
                  pulumi.Output.secret(generated_private_key_pem))
