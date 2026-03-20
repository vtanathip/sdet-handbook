from gitlab_bot.gitlab.client import create_client
from gitlab_bot.gitlab.mr_manager import open_or_update_merge_request

__all__ = ["create_client", "open_or_update_merge_request"]
