from __future__ import annotations

import logging
import time
from pathlib import Path

from tenacity import retry, stop_after_attempt, wait_fixed

from gitlab_bot.config import Settings
from gitlab_bot.fixers import apply_auto_fixes
from gitlab_bot.git_ops import (
    checkout_new_branch,
    cleanup_worktree,
    clone_project,
    commit_and_push,
    get_changed_files,
)
from gitlab_bot.gitlab import create_client, open_or_update_merge_request
from gitlab_bot.models import ScanReport
from gitlab_bot.reporting.report_builder import build_markdown_report
from gitlab_bot.scanners import run_code_scans, run_dependency_scans
from gitlab_bot.state.store import StateStore

LOG = logging.getLogger("gitlab_bot")


def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    settings = Settings()
    state = StateStore.load(settings.state_file)
    client = create_client(settings)

    LOG.info("Starting bot for projects: %s", settings.parsed_project_ids())
    while True:
        for project_id in settings.parsed_project_ids():
            try:
                _process_project(client, settings, state, project_id)
            except Exception as exc:
                LOG.exception("Project %s failed: %s", project_id, exc)
        state.save()
        LOG.info("Polling cycle complete. Sleeping for %s seconds",
                 settings.poll_interval_seconds)
        time.sleep(settings.poll_interval_seconds)


@retry(stop=stop_after_attempt(3), wait=wait_fixed(3), reraise=True)
def _process_project(client, settings: Settings, state: StateStore, project_id: int) -> None:
    project = client.projects.get(project_id)
    latest = project.commits.list(ref_name=settings.target_branch, per_page=1)
    if not latest:
        LOG.info("Project %s has no commits on %s",
                 project_id, settings.target_branch)
        return

    latest_commit = latest[0].id
    current = state.get(project_id)
    if current.last_commit == latest_commit:
        LOG.debug("Project %s unchanged; skipping", project_id)
        return

    worktree = clone_project(project.http_url_to_repo,
                             settings, settings.target_branch)
    try:
        report = _scan_and_fix(worktree.path, settings)
        report_path = worktree.path / ".bot-reports" / "scan-report.md"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(build_markdown_report(report), encoding="utf-8")

        changed_files = get_changed_files(worktree)
        report.changed_files = changed_files

        if len(changed_files) > settings.max_files_changed:
            LOG.warning(
                "Project %s exceeded changed file limit (%s); skipping MR",
                project_id,
                settings.max_files_changed,
            )
            current.last_commit = latest_commit
            return

        signature = report.signature()
        if not report.has_findings and not changed_files:
            LOG.info("Project %s has no findings", project_id)
            current.last_commit = latest_commit
            current.last_signature = ""
            return

        if current.last_signature == signature and not changed_files:
            LOG.info(
                "Project %s findings unchanged; skipping duplicate MR", project_id)
            current.last_commit = latest_commit
            return

        branch_name = f"{settings.bot_branch_prefix}/{latest_commit[:8]}"
        checkout_new_branch(worktree, branch_name)

        if settings.dry_run:
            LOG.info(
                "Dry run enabled; skipping push and MR creation for project %s", project_id)
            current.last_commit = latest_commit
            current.last_signature = signature
            return

        commit_and_push(
            worktree,
            branch_name,
            message="chore(bot): automated dependency and code scan fixes",
        )

        description = (
            "Automated scan detected issues and prepared changes for human review.\n\n"
            "Report file: .bot-reports/scan-report.md"
        )
        mr_iid = open_or_update_merge_request(
            project=project,
            source_branch=branch_name,
            target_branch=settings.target_branch,
            title="chore(bot): dependency and code scan remediation",
            description=description,
        )
        LOG.info("Project %s opened/updated MR !%s", project_id, mr_iid)

        current.last_commit = latest_commit
        current.last_signature = signature
    finally:
        cleanup_worktree(worktree)


def _scan_and_fix(project_dir: Path, settings: Settings) -> ScanReport:
    report = ScanReport()

    dep_findings, dep_notes = run_dependency_scans(project_dir)
    code_findings, code_notes = run_code_scans(project_dir)
    report.findings.extend(dep_findings)
    report.findings.extend(code_findings)
    report.notes.extend(dep_notes)
    report.notes.extend(code_notes)

    fix_notes = apply_auto_fixes(project_dir, settings)
    report.notes.extend(fix_notes)

    return report


if __name__ == "__main__":
    run()
