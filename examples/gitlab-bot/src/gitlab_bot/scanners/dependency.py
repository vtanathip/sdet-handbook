from __future__ import annotations

import json
import tempfile
from pathlib import Path

from gitlab_bot.models import Finding, Severity
from gitlab_bot.subprocess_utils import run_command


def run_dependency_scans(project_dir: Path) -> tuple[list[Finding], list[str]]:
    findings: list[Finding] = []
    notes: list[str] = []

    requirements_files = list(project_dir.glob("requirements*.txt"))
    for req in requirements_files:
        result = run_command(
            ["pip-audit", "-r", req.name, "-f", "json"], cwd=project_dir)
        if result.returncode not in (0, 1):
            notes.append(
                f"pip-audit failed for {req.name}: {result.stderr.strip()}")
            continue
        findings.extend(_parse_pip_audit(result.stdout, source=req.name))

    pyproject = project_dir / "pyproject.toml"
    if pyproject.exists():
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as handle:
            export_path = Path(handle.name)
        export = run_command(
            ["uv", "export", "--format",
                "requirements-txt", "-o", str(export_path)],
            cwd=project_dir,
        )
        if export.returncode == 0:
            audit = run_command(
                ["pip-audit", "-r", str(export_path), "-f", "json"],
                cwd=project_dir,
            )
            if audit.returncode in (0, 1):
                findings.extend(_parse_pip_audit(
                    audit.stdout, source="pyproject.toml"))
            else:
                notes.append(
                    f"pip-audit failed for pyproject.toml export: {audit.stderr.strip()}")
        else:
            notes.append(f"uv export failed: {export.stderr.strip()}")
        export_path.unlink(missing_ok=True)

    outdated = run_command(["uv", "tree", "--outdated"], cwd=project_dir)
    if outdated.returncode == 0 and outdated.stdout.strip():
        for line in outdated.stdout.splitlines():
            findings.append(
                Finding(
                    scanner="dependency-outdated",
                    title="Outdated dependency",
                    severity=Severity.LOW,
                    details=line.strip(),
                    fixable=True,
                )
            )
    elif outdated.returncode != 0:
        notes.append(
            f"Outdated dependency scan unavailable: {outdated.stderr.strip()}")

    return findings, notes


def _parse_pip_audit(raw: str, source: str) -> list[Finding]:
    findings: list[Finding] = []
    if not raw.strip():
        return findings
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return findings

    dependencies = payload.get("dependencies", [])
    for dep in dependencies:
        name = dep.get("name", "unknown")
        version = dep.get("version", "unknown")
        vulns = dep.get("vulns", [])
        for vuln in vulns:
            alias = ", ".join(vuln.get("aliases", []))
            fix_versions = ", ".join(vuln.get("fix_versions", []))
            details = (
                f"{name} {version} has {vuln.get('id', 'unknown')} ({alias}). "
                f"Fix versions: {fix_versions or 'n/a'}"
            )
            findings.append(
                Finding(
                    scanner="pip-audit",
                    title=f"Vulnerable dependency in {source}",
                    severity=Severity.HIGH,
                    details=details,
                    fixable=bool(vuln.get("fix_versions")),
                )
            )
    return findings
