from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(slots=True)
class ProjectState:
    last_commit: str = ""
    last_signature: str = ""


@dataclass(slots=True)
class StateStore:
    path: Path
    projects: dict[str, ProjectState] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> StateStore:
        if not path.exists():
            return cls(path=path)
        raw = json.loads(path.read_text(encoding="utf-8"))
        projects: dict[str, ProjectState] = {}
        for key, value in raw.get("projects", {}).items():
            projects[key] = ProjectState(
                last_commit=value.get("last_commit", ""),
                last_signature=value.get("last_signature", ""),
            )
        return cls(path=path, projects=projects)

    def get(self, project_id: int) -> ProjectState:
        key = str(project_id)
        if key not in self.projects:
            self.projects[key] = ProjectState()
        return self.projects[key]

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "projects": {
                key: {
                    "last_commit": value.last_commit,
                    "last_signature": value.last_signature,
                }
                for key, value in self.projects.items()
            }
        }
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
