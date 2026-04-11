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
# Set via: pulumi config set repo-url <GIT_CLONE_URL>
# Defaults to the sdet-handbook repository used in development.
repo_url: str = _cfg.get("repo-url") or "https://github.com/vtanathip/sdet-ai-handbook.git"

# ---------------------------------------------------------------------------
# Common resource tags applied to every AWS resource in this stack
# ---------------------------------------------------------------------------
common_tags: dict[str, str] = {
    "Project": "UI-Perf-Test",
    "Team": "QA-Automation",
    "CostCenter": "QE-Dept",
}
