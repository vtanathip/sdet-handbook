from __future__ import annotations

from pathlib import Path

from gitlab_bot.config import Settings
from gitlab_bot.subprocess_utils import run_command


def apply_auto_fixes(project_dir: Path, settings: Settings) -> list[str]:
    notes: list[str] = []

    if settings.auto_fix_ruff:
        ruff_fix = run_command(
            ["ruff", "check", ".", "--fix"], cwd=project_dir)
        if ruff_fix.returncode not in (0, 1):
            notes.append(f"Ruff auto-fix failed: {ruff_fix.stderr.strip()}")

    if settings.auto_fix_dependencies and (project_dir / "pyproject.toml").exists():
        dep_fix = run_command(["uv", "lock", "--upgrade"], cwd=project_dir)
        if dep_fix.returncode != 0:
            notes.append(
                f"Dependency upgrade failed: {dep_fix.stderr.strip()}")

    return notes
