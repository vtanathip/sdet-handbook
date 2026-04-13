"""
config.py
---------
Centralised configuration reader and shared constants.

Usage:
    from config import dd_api_key, common_tags
"""

import pulumi

_cfg = pulumi.Config()

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------
# Set via: pulumi config set --secret dd-api-key <YOUR_DD_API_KEY>
dd_api_key: pulumi.Output = _cfg.require_secret("dd-api-key")

# Set via: pulumi config set --secret rds-password <YOUR_DB_PASSWORD>
rds_password: pulumi.Output = _cfg.require_secret("rds-password")

# ---------------------------------------------------------------------------
# Application settings
# ---------------------------------------------------------------------------
# Set via: pulumi config set artifact-s3-key <OBJECT_KEY>
# Defaults to "app-artifact.zip", matching the output of build-artifact.ps1.
artifact_s3_key: str = _cfg.get("artifact-s3-key") or "app-artifact.zip"

# Set via: pulumi config set dd-site <SITE>
# Defaults to "datadoghq.com" (US1).  Use "ap1.datadoghq.com" for AP1, etc.
dd_site: str = _cfg.get("dd-site") or "datadoghq.com"

# Optional EC2 key pair settings for Windows RDP password retrieval.
# Either supply an existing AWS key pair name, or provide a public key so
# Pulumi can create and manage an AWS EC2 key pair for the instance.
ec2_key_pair_name: str | None = _cfg.get("ec2-key-pair-name")
ec2_public_key: str | None = _cfg.get("ec2-public-key")

# ---------------------------------------------------------------------------
# Common resource tags applied to every AWS resource in this stack
# ---------------------------------------------------------------------------
common_tags: dict[str, str] = {
    "Project": "UI-Perf-Test",
    "Team": "QA-Automation",
    "CostCenter": "QE-Dept",
}
