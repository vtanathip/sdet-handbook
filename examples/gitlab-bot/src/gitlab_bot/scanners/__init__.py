from gitlab_bot.scanners.code import run_code_scans
from gitlab_bot.scanners.dependency import run_dependency_scans

__all__ = ["run_code_scans", "run_dependency_scans"]
