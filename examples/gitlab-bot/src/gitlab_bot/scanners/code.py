from __future__ import annotations

import json
from pathlib import Path

from gitlab_bot.models import Finding, Severity
from gitlab_bot.subprocess_utils import run_command


def run_code_scans(project_dir: Path) -> tuple[list[Finding], list[str]]:
    findings: list[Finding] = []
    notes: list[str] = []

    bandit = run_command(["bandit", "-r", ".", "-f", "json"], cwd=project_dir)
    if bandit.returncode in (0, 1):
        findings.extend(_parse_bandit(bandit.stdout))
    else:
        notes.append(f"Bandit scan failed: {bandit.stderr.strip()}")

    ruff = run_command(
        ["ruff", "check", ".", "--output-format", "json"], cwd=project_dir)
    if ruff.returncode in (0, 1):
        findings.extend(_parse_ruff(ruff.stdout))
    else:
        notes.append(f"Ruff scan failed: {ruff.stderr.strip()}")

    return findings, notes


def _parse_bandit(raw: str) -> list[Finding]:
    findings: list[Finding] = []
    if not raw.strip():
        return findings
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return findings

    for item in payload.get("results", []):
        severity = _bandit_severity(item.get("issue_severity", "LOW"))
        findings.append(
            Finding(
                scanner="bandit",
                title=item.get("test_name", "Bandit issue"),
                severity=severity,
                details=item.get("issue_text", ""),
                file_path=item.get("filename"),
                line=item.get("line_number"),
                fixable=False,
            )
        )
    return findings


def _parse_ruff(raw: str) -> list[Finding]:
    findings: list[Finding] = []
    if not raw.strip():
        return findings
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return findings

    for item in payload:
        location = item.get("location", {})
        findings.append(
            Finding(
                scanner="ruff",
                title=f"{item.get('code', 'RUFF')}: {item.get('message', 'Lint issue')}",
                severity=Severity.LOW,
                details=item.get("message", ""),
                file_path=item.get("filename"),
                line=location.get("row"),
                fixable=bool(item.get("fix")),
            )
        )
    return findings


def _bandit_severity(value: str) -> Severity:
    normalized = value.upper()
    if normalized == "CRITICAL":
        return Severity.CRITICAL
    if normalized == "HIGH":
        return Severity.HIGH
    if normalized == "MEDIUM":
        return Severity.MEDIUM
    return Severity.LOW
