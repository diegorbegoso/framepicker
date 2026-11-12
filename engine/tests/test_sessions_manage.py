"""Renaming sessions, the default name of a loose selection, and forgetting a big one."""

from __future__ import annotations

import json
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher
from mejores_engine.sessions import clean_label, default_label, forget
from mejores_engine.store import Store


class Day:
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

    def open(self, folder: Path, *, as_files: bool = False) -> str:
        paths = [str(p) for p in sorted(folder.iterdir())] if as_files else [str(folder)]
        self.ok("grant_roots", {"roots": [str(folder)]})
        session = self.ok("scan", {"paths": paths})["session_id"]
        job = self.ok("analyze", {"session_id": session, "eyes": False})["job_id"]
        while self.ok("job_status", {"job_id": job})["state"] == "running":
            time.sleep(0.02)
        self.ok("select", {"session_id": session})
        return str(session)

    def label(self, session_id: str) -> str:
        sessions = self.ok("sessions_list", {})["sessions"]
        return next(str(s["label"]) for s in sessions if s["id"] == session_id)


def make_folder(tmp_path: Path, name: str = "boda", count: int = 3) -> Path:
    folder = tmp_path / name
    folder.mkdir()
    rng = np.random.default_rng(7)
    for index in range(count):
        ok, data = cv2.imencode(".jpg", rng.integers(0, 256, (40, 60, 3), dtype=np.uint8))
        assert ok
        (folder / f"IMG_{index}.jpg").write_bytes(data.tobytes())
    return folder


def test_a_session_can_be_renamed_and_the_name_survives_a_restart(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    session = day.open(make_folder(tmp_path))
    assert day.label(session) == "boda"
    reply = day.ok("session_rename", {"session_id": session, "label": "  Boda   de Ana  y Luis "})
    assert reply == {"session_id": session, "label": "Boda de Ana y Luis"}
    assert Day(tmp_path / "data").label(session) == "Boda de Ana y Luis"


def test_a_name_must_be_text_of_a_sensible_length(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    session = day.open(make_folder(tmp_path))
    for bad in ("", "   ", "x" * 81, 5, None):
        reply = day.call("session_rename", {"session_id": session, "label": bad})
        assert reply["error"]["code"] == INVALID_PARAMS, bad
    assert day.call("session_rename", {"session_id": "nope", "label": "A"})["error"]["code"] == (
        NOT_FOUND
    )
    assert day.call("session_rename", {"label": "A"})["error"]["code"] == INVALID_PARAMS
    assert day.label(session) == "boda"
    assert clean_label("x" * 80) == "x" * 80


def test_loose_files_are_named_by_the_moment_they_were_picked(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    session = day.open(make_folder(tmp_path), as_files=True)
    label = day.label(session)
    assert re.fullmatch(r"Selección del \d{1,2} [a-z]{3}, \d{2}:\d{2}", label), label
    assert default_label(datetime(2026, 11, 12, 14, 32)) == "Selección del 12 nov, 14:32"
    assert default_label(datetime(2026, 1, 3, 9, 5)) == "Selección del 3 ene, 09:05"


def test_a_folder_session_is_still_named_after_its_folder(tmp_path: Path) -> None:
    day = Day(tmp_path / "data")
    assert day.label(day.open(make_folder(tmp_path, "Vasco 1 año"))) == "Vasco 1 año"


def fill(conn: sqlite3.Connection, session: str, photos: int) -> None:
    conn.execute(
        "INSERT INTO sessions (id, label, created_at) VALUES (?, ?, 'now')", (session, session)
    )
    bursts = []
    for b in range(photos // 2):
        burst = f"{session}-b{b}"
        bursts.append(burst)
        conn.execute(
            "INSERT INTO bursts (id, session_id, position) VALUES (?, ?, ?)", (burst, session, b)
        )
    for i in range(photos):
        photo = f"{session}-p{i}"
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES (?, ?, ?, 'raw', 1, 1)",
            (photo, session, f"C:/{session}/{i}.ARW"),
        )
        burst = bursts[i % len(bursts)]
        conn.execute("INSERT INTO burst_members VALUES (?, ?, ?)", (burst, photo, i))
        conn.execute("INSERT INTO selections VALUES (?, ?, 'auto', 1)", (burst, photo))
        conn.execute("INSERT INTO scores VALUES (?, 1, 1, 1, 0, 0, NULL, 'x', 'now')", (photo,))
        conn.execute("INSERT INTO photo_edits VALUES (?, '{}', 'now')", (photo,))
    conn.execute(
        "INSERT INTO organize_batches (id, session_id, folder_name, created_at) "
        "VALUES (?, ?, 'x', 'now')",
        (f"{session}-batch", session),
    )
    conn.execute(
        "INSERT INTO organize_moves VALUES (?, 0, ?, 'a', 'b')",
        (f"{session}-batch", f"{session}-p0"),
    )


def counts(conn: sqlite3.Connection, like: str) -> dict[str, int]:
    tables = {
        "photos": "SELECT count(*) FROM photos WHERE id LIKE ?",
        "bursts": "SELECT count(*) FROM bursts WHERE id LIKE ?",
        "members": "SELECT count(*) FROM burst_members WHERE photo_id LIKE ?",
        "selections": "SELECT count(*) FROM selections WHERE photo_id LIKE ?",
        "scores": "SELECT count(*) FROM scores WHERE photo_id LIKE ?",
        "edits": "SELECT count(*) FROM photo_edits WHERE photo_id LIKE ?",
        "moves": "SELECT count(*) FROM organize_moves WHERE batch_id LIKE ?",
    }
    return {
        name: int(conn.execute(sql, (f"{like}-%",)).fetchone()[0]) for name, sql in tables.items()
    }


def test_forgetting_removes_everything_of_one_session_and_nothing_of_another(
    tmp_path: Path,
) -> None:
    store = Store(tmp_path / "data")
    with store.session() as conn:
        fill(conn, "A", 40)
        fill(conn, "B", 40)
        before = counts(conn, "B")
        forget(conn, "A")
    with store.session() as conn:
        assert set(counts(conn, "A").values()) == {0}
        assert counts(conn, "B") == before
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 1
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_a_big_session_is_forgotten_quickly(tmp_path: Path) -> None:
    store = Store(tmp_path / "data")
    with store.session() as conn:
        fill(conn, "A", 3000)
        fill(conn, "B", 3000)
    started = time.perf_counter()
    with store.session() as conn:
        forget(conn, "A")
    assert (
        time.perf_counter() - started < 2.0
    )  # it took 3 s before the indexes and the bulk deletes


def test_the_indexes_that_make_deleting_fast_exist(tmp_path: Path) -> None:
    store = Store(tmp_path / "data")
    with store.session() as conn:
        names = {
            str(r["name"])
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
        }
    assert {"idx_selections_photo", "idx_members_photo", "idx_organize_session"} <= names


def test_forgetting_through_the_rpc_leaves_the_photos_alone(tmp_path: Path) -> None:
    folder = make_folder(tmp_path)
    day = Day(tmp_path / "data")
    session = day.open(folder)
    before = sorted(p.name for p in folder.iterdir())
    day.ok("session_forget", {"session_id": session})
    assert day.ok("sessions_list", {})["sessions"] == []
    assert sorted(p.name for p in folder.iterdir()) == before


def test_the_database_waits_for_a_busy_writer_instead_of_failing_quickly(tmp_path: Path) -> None:
    store = Store(tmp_path / "data")
    with store.session() as conn:
        timeout = conn.execute("PRAGMA busy_timeout").fetchone()[0]
    assert timeout >= 30000
