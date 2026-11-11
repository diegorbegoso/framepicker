"""Sessions that are remembered: picking the same photos again, the recent list, forgetting."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher
from mejores_engine.store import Store

NEUTRAL = {
    "exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0, "temperature": 0,
    "tint": 0, "saturation": 0, "lut_id": None, "lut_strength": 1,
}  # fmt: skip


class Day:
    """A run of the program: a dispatcher over a data folder that survives between runs."""

    def __init__(self, data: Path) -> None:
        self.data = data
        self.dispatcher: Dispatcher = build_dispatcher(lambda: Store(data))

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        reply: dict[str, Any] = json.loads(self.dispatcher.handle_line(line) or "")
        return reply

    def ok(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        reply = self.call(method, params)
        assert "error" not in reply, reply
        return reply["result"]  # type: ignore[no-any-return]

    def open(self, folder: Path) -> dict[str, Any]:
        """What the home screen does: grant, scan, analyse unless resumed, select."""
        self.ok("grant_roots", {"roots": [str(folder)]})
        scanned = self.ok("scan", {"paths": [str(folder)]})
        if not scanned["resumed"]:
            job = self.ok("analyze", {"session_id": scanned["session_id"], "eyes": False})["job_id"]
            while self.ok("job_status", {"job_id": job})["state"] == "running":
                time.sleep(0.02)
        selected = self.ok("select", {"session_id": scanned["session_id"]})
        return {**scanned, **selected}


def make_folder(tmp_path: Path, name: str = "boda", count: int = 4) -> Path:
    folder = tmp_path / name
    folder.mkdir()
    rng = np.random.default_rng(len(name))
    for index in range(count):
        ok, data = cv2.imencode(".jpg", rng.integers(0, 256, (60, 80, 3), dtype=np.uint8))
        assert ok
        (folder / f"IMG_{index}.jpg").write_bytes(data.tobytes())
    return folder


def photo_ids(opened: dict[str, Any]) -> list[str]:
    return [p["id"] for b in opened["bursts"] for p in b["photos"]]


def test_picking_the_same_folder_again_returns_to_the_same_session(tmp_path: Path) -> None:
    folder = make_folder(tmp_path)
    day = Day(tmp_path / "data")
    first = day.open(folder)
    assert first["resumed"] is False
    burst = first["bursts"][0]
    day.ok("confirm_burst", {"burst_id": burst["id"]})
    pick = burst["photos"][0]["id"]
    day.ok("set_pick", {"burst_id": burst["id"], "photo_id": pick, "selected": True})
    ids = photo_ids(first)
    day.ok(
        "edits_set",
        {
            "session_id": first["session_id"],
            "photo_ids": ids[:1],
            "adjustments": {**NEUTRAL, "exposure": 1},
        },
    )

    tomorrow = Day(tmp_path / "data")  # the program was closed and opened again
    again = tomorrow.open(folder)
    assert again["resumed"] is True
    assert again["session_id"] == first["session_id"]
    assert photo_ids(again) == ids
    assert {p["id"] for p in again["photos"]} == set(ids)
    assert all(p["source"] == "user" for p in again["bursts"][0]["photos"])
    assert next(p for p in again["bursts"][0]["photos"] if p["id"] == pick)["selected"] is True
    edits = tomorrow.ok("edits_get", {"session_id": again["session_id"]})["edits"]
    assert edits[ids[0]]["exposure"] == 1


def test_a_folder_with_other_photos_is_a_new_session_and_the_old_one_stays(tmp_path: Path) -> None:
    folder = make_folder(tmp_path)
    day = Day(tmp_path / "data")
    first = day.open(folder)
    ok, data = cv2.imencode(".jpg", np.zeros((60, 80, 3), dtype=np.uint8))
    assert ok
    (folder / "IMG_NEW.jpg").write_bytes(data.tobytes())
    second = day.open(folder)
    assert second["resumed"] is False
    assert second["session_id"] != first["session_id"]
    ids = [s["id"] for s in day.ok("sessions_list", {})["sessions"]]
    assert set(ids) == {first["session_id"], second["session_id"]}


def test_a_session_that_never_got_bursts_is_not_resumed(tmp_path: Path) -> None:
    folder = make_folder(tmp_path)
    day = Day(tmp_path / "data")
    day.ok("grant_roots", {"roots": [str(folder)]})
    abandoned = day.ok("scan", {"paths": [str(folder)]})  # analysis never ran
    assert day.ok("sessions_list", {})["sessions"] == []
    again = day.ok("scan", {"paths": [str(folder)]})
    assert again["resumed"] is False
    assert again["session_id"] != abandoned["session_id"]


def test_the_recent_list_counts_what_was_done_and_puts_the_latest_first(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    old = day.open(make_folder(tmp_path, "vieja"))
    new = day.open(make_folder(tmp_path, "nueva", count=3))
    burst = new["bursts"][0]
    day.ok("confirm_burst", {"burst_id": burst["id"]})
    listed = day.ok("sessions_list", {})["sessions"]
    assert [s["id"] for s in listed] == [new["session_id"], old["session_id"]]
    top = listed[0]
    assert (top["label"], top["photos"], top["available"]) == ("nueva", 3, True)
    assert top["bursts"] == len(new["bursts"])
    assert top["reviewed"] == 1
    assert top["picked"] == sum(p["selected"] for b in new["bursts"] for p in b["photos"])
    assert top["folder"].endswith("nueva")
    assert top["edited"] == 0


def test_a_session_whose_photos_are_gone_is_listed_as_unavailable(tmp_path: Path) -> None:
    folder = make_folder(tmp_path)
    day = Day(tmp_path / "data")
    day.open(folder)
    for file in folder.iterdir():
        file.unlink()
    assert day.ok("sessions_list", {})["sessions"][0]["available"] is False


def test_the_list_keeps_only_the_last_ten(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    for index in range(12):
        day.open(make_folder(tmp_path, f"carpeta{index}", count=1))
    assert len(day.ok("sessions_list", {})["sessions"]) == 10


def test_the_last_burst_looked_at_is_remembered_and_comes_back_with_select(tmp_path: Path) -> None:
    folder = make_folder(tmp_path, count=6)
    day = Day(tmp_path / "data")
    opened = day.open(folder)
    assert opened["last_burst_id"] is None
    target = opened["bursts"][-1]["id"]
    day.ok("session_touch", {"session_id": opened["session_id"], "burst_id": target})
    assert Day(tmp_path / "data").open(folder)["last_burst_id"] == target
    assert day.ok("sessions_list", {})["sessions"][0]["last_burst_id"] == target


def test_touch_validates_its_input(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    opened = day.open(make_folder(tmp_path))
    assert day.call("session_touch", {})["error"]["code"] == INVALID_PARAMS
    assert day.call("session_touch", {"session_id": "nope"})["error"]["code"] == NOT_FOUND
    bad = day.call("session_touch", {"session_id": opened["session_id"], "burst_id": "nope"})
    assert bad["error"]["code"] == NOT_FOUND
    wrong = day.call("session_touch", {"session_id": opened["session_id"], "burst_id": 3})
    assert wrong["error"]["code"] == INVALID_PARAMS


def test_choosing_and_correcting_move_a_session_to_the_top(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    first = day.open(make_folder(tmp_path, "primera"))
    day.open(make_folder(tmp_path, "segunda"))
    time.sleep(0.01)
    burst = first["bursts"][0]
    day.ok(
        "set_pick",
        {"burst_id": burst["id"], "photo_id": burst["photos"][0]["id"], "selected": True},
    )
    assert day.ok("sessions_list", {})["sessions"][0]["id"] == first["session_id"]


def test_forgetting_removes_the_session_and_leaves_the_photos_alone(tmp_path: Path) -> None:
    folder = make_folder(tmp_path)
    day = Day(tmp_path / "data")
    opened = day.open(folder)
    before = sorted(p.name for p in folder.iterdir())
    forgot = day.ok("session_forget", {"session_id": opened["session_id"]})
    assert forgot == {"session_id": opened["session_id"]}
    assert day.ok("sessions_list", {})["sessions"] == []
    assert sorted(p.name for p in folder.iterdir()) == before
    with Store(tmp_path / "data").session() as conn:
        assert conn.execute("SELECT count(*) FROM photos").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM bursts").fetchone()[0] == 0
    assert day.open(folder)["resumed"] is False  # starts clean
    assert day.call("session_forget", {"session_id": "nope"})["error"]["code"] == NOT_FOUND
    assert day.call("session_forget", {})["error"]["code"] == INVALID_PARAMS


def test_migration_six_keeps_old_sessions_working(tmp_path: Path) -> None:
    data = tmp_path / "data"
    folder = make_folder(tmp_path)
    opened = Day(data).open(folder)
    with Store(data).session() as conn:
        conn.execute("DROP INDEX idx_sessions_source_key")
        conn.execute("ALTER TABLE sessions DROP COLUMN source_key")
        conn.execute("ALTER TABLE sessions DROP COLUMN updated_at")
        conn.execute("ALTER TABLE sessions DROP COLUMN last_burst_id")
        conn.execute("DELETE FROM schema_migrations WHERE version = '0006'")
    reopened = Day(data)  # runs 0006 on a database that already holds a session
    listed = reopened.ok("sessions_list", {})["sessions"]
    assert [s["id"] for s in listed] == [opened["session_id"]]
    # Old sessions have no fingerprint, so picking the folder again starts a new one.
    assert reopened.open(folder)["resumed"] is False
