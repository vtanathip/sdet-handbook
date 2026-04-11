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

# ---------------------------------------------------------------------------
# Common resource tags applied to every AWS resource in this stack
# ---------------------------------------------------------------------------
common_tags: dict[str, str] = {
    "Project": "UI-Perf-Test",
    "Team": "QA-Automation",
    "CostCenter": "QE-Dept",
}
