from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from gitlab_bot.config import Settings
from gitlab_bot.subprocess_utils import run_command


@dataclass(slots=True)
class Worktree:
    path: Path


def clone_project(
    repo_url: str,
    settings: Settings,
    target_branch: str,
) -> Worktree:
    temp_dir = Path(tempfile.mkdtemp(prefix="gitlab-bot-"))
    effective_repo_url = _rewrite_repo_url_host(repo_url, settings.gitlab_url)
    auth_url = effective_repo_url.replace(
        "https://", f"https://oauth2:{settings.gitlab_token}@")
    auth_url = auth_url.replace(
        "http://", f"http://oauth2:{settings.gitlab_token}@")

    clone = run_command(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            target_branch,
            auth_url,
            str(temp_dir),
        ],
        cwd=temp_dir.parent,
    )
    if clone.returncode != 0:
        raise RuntimeError(f"git clone failed: {clone.stderr}")

    run_command(["git", "config", "user.name",
                settings.bot_commit_author_name], cwd=temp_dir)
    run_command(["git", "config", "user.email",
                settings.bot_commit_author_email], cwd=temp_dir)
    return Worktree(path=temp_dir)


def _rewrite_repo_url_host(repo_url: str, gitlab_url: str) -> str:
    repo = urlparse(repo_url)
    gitlab = urlparse(gitlab_url)

    if repo.hostname in {"localhost", "127.0.0.1"} and gitlab.netloc:
        return repo._replace(netloc=gitlab.netloc, scheme=gitlab.scheme or repo.scheme).geturl()

    return repo_url


def cleanup_worktree(worktree: Worktree) -> None:
    shutil.rmtree(worktree.path, ignore_errors=True)


def checkout_new_branch(worktree: Worktree, branch_name: str) -> None:
    result = run_command(
        ["git", "checkout", "-b", branch_name], cwd=worktree.path)
    if result.returncode != 0:
        raise RuntimeError(f"git checkout failed: {result.stderr}")


def get_changed_files(worktree: Worktree) -> list[str]:
    result = run_command(["git", "status", "--porcelain"], cwd=worktree.path)
    if result.returncode != 0:
        return []
    files: list[str] = []
    for line in result.stdout.splitlines():
        if len(line) > 3:
            files.append(line[3:])
    return files


def commit_and_push(worktree: Worktree, branch_name: str, message: str) -> None:
    add = run_command(["git", "add", "-A"], cwd=worktree.path)
    if add.returncode != 0:
        raise RuntimeError(f"git add failed: {add.stderr}")

    commit = run_command(["git", "commit", "-m", message], cwd=worktree.path)
    if commit.returncode != 0:
        raise RuntimeError(f"git commit failed: {commit.stderr}")

    push = run_command(
        ["git", "push", "origin", branch_name, "--force-with-lease"],
        cwd=worktree.path,
    )
    if push.returncode != 0:
        raise RuntimeError(f"git push failed: {push.stderr}")
