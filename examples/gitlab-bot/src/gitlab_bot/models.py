from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class Severity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass(slots=True)
class Finding:
    scanner: str
    title: str
    severity: Severity
    details: str
    file_path: str | None = None
    line: int | None = None
    fixable: bool = False


@dataclass(slots=True)
class ScanReport:
    findings: list[Finding] = field(default_factory=list)
    changed_files: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def has_findings(self) -> bool:
        return bool(self.findings)

    def signature(self) -> str:
        def sort_key(item: Finding) -> tuple[str, str, str, int]:
            return (item.scanner, item.title, item.file_path or "", item.line or 0)

        parts = [
            f"{f.scanner}:{f.severity}:{f.title}:{f.file_path or ''}:{f.line or 0}"
            for f in sorted(self.findings, key=sort_key)
        ]
        return "|".join(parts)
