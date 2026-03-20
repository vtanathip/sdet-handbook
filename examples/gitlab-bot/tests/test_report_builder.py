from gitlab_bot.models import Finding, ScanReport, Severity
from gitlab_bot.reporting.report_builder import build_markdown_report


def test_build_markdown_report_contains_findings() -> None:
    report = ScanReport(
        findings=[
            Finding(
                scanner="ruff",
                title="E501 line too long",
                severity=Severity.LOW,
                details="Example",
                file_path="src/example.py",
                line=10,
                fixable=True,
            )
        ],
        changed_files=["src/example.py"],
    )

    markdown = build_markdown_report(report)

    assert "Automated Scan Report" in markdown
    assert "Total findings: 1" in markdown
    assert "src/example.py" in markdown
