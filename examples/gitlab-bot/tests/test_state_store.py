from pathlib import Path

from gitlab_bot.state.store import StateStore


def test_state_store_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "state.json"

    store = StateStore.load(path)
    project_state = store.get(123)
    project_state.last_commit = "abc"
    project_state.last_signature = "sig"
    store.save()

    loaded = StateStore.load(path)
    assert loaded.get(123).last_commit == "abc"
    assert loaded.get(123).last_signature == "sig"
