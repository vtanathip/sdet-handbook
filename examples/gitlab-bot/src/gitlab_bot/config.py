from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gitlab_url: str = Field(alias="GITLAB_URL")
    gitlab_token: str = Field(alias="GITLAB_TOKEN")
    project_ids: str = Field(alias="PROJECT_IDS")

    target_branch: str = Field(default="main", alias="TARGET_BRANCH")
    poll_interval_seconds: int = Field(
        default=900, alias="POLL_INTERVAL_SECONDS")
    bot_branch_prefix: str = Field(
        default="bot/scan", alias="BOT_BRANCH_PREFIX")

    bot_commit_author_name: str = Field(
        default="GitLab Security Bot",
        alias="BOT_COMMIT_AUTHOR_NAME",
    )
    bot_commit_author_email: str = Field(
        default="gitlab-bot@example.com",
        alias="BOT_COMMIT_AUTHOR_EMAIL",
    )

    auto_fix_ruff: bool = Field(default=True, alias="AUTO_FIX_RUFF")
    auto_fix_dependencies: bool = Field(
        default=False, alias="AUTO_FIX_DEPENDENCIES")
    max_files_changed: int = Field(default=200, alias="MAX_FILES_CHANGED")

    state_file: Path = Field(default=Path(
        "/data/state.json"), alias="STATE_FILE")
    dry_run: bool = Field(default=False, alias="DRY_RUN")

    def parsed_project_ids(self) -> list[int]:
        ids = [item.strip()
               for item in self.project_ids.split(",") if item.strip()]
        return [int(item) for item in ids]
