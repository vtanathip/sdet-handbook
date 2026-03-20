from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime

from gitlab_bot.models import ScanReport


def build_markdown_report(report: ScanReport) -> str:
    lines: list[str] = []
    lines.append("# Automated Scan Report")
    lines.append("")
    lines.append(f"Generated: {datetime.now(UTC).isoformat()}")
    lines.append(f"Total findings: {len(report.findings)}")
    lines.append("")

    if report.findings:
        counts = Counter(f.severity for f in report.findings)
        lines.append("## Severity Summary")
        lines.append("")
        for severity in sorted(counts.keys()):
            lines.append(f"- {severity}: {counts[severity]}")
        lines.append("")

        lines.append("## Findings")
        lines.append("")
        for item in report.findings:
            location = ""
            if item.file_path:
                location = f" ({item.file_path}:{item.line or 1})"
            lines.append(f"- [{item.scanner}] **{item.title}**{location}")
            lines.append(f"  - Severity: {item.severity}")
            lines.append(f"  - Fixable: {item.fixable}")
            lines.append(f"  - Details: {item.details}")
    else:
        lines.append("No findings were detected.")

    if report.changed_files:
        lines.append("")
        lines.append("## Auto-Fix Changes")
        lines.append("")
        for changed in sorted(report.changed_files):
            lines.append(f"- {changed}")

    if report.notes:
        lines.append("")
        lines.append("## Notes")
        lines.append("")
        for note in report.notes:
            lines.append(f"- {note}")

    lines.append("")
    lines.append("Please review all automated changes before merge.")
    lines.append("")
    return "\n".join(lines)
