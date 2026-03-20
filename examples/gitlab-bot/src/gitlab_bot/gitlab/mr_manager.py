from __future__ import annotations

from gitlab.v4.objects import Project


def open_or_update_merge_request(
    project: Project,
    source_branch: str,
    target_branch: str,
    title: str,
    description: str,
) -> int:
    existing = project.mergerequests.list(
        state="opened",
        source_branch=source_branch,
        target_branch=target_branch,
    )
    if existing:
        mr = existing[0]
        mr.title = title
        mr.description = description
        mr.save()
        return int(mr.iid)

    created = project.mergerequests.create(
        {
            "source_branch": source_branch,
            "target_branch": target_branch,
            "title": title,
            "description": description,
            "remove_source_branch": True,
        }
    )
    return int(created.iid)
