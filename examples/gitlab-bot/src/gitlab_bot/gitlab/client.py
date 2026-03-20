from __future__ import annotations

import gitlab

from gitlab_bot.config import Settings


def create_client(settings: Settings) -> gitlab.Gitlab:
    client = gitlab.Gitlab(url=settings.gitlab_url,
                           private_token=settings.gitlab_token)
    client.auth()
    return client
