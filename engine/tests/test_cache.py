from __future__ import annotations

import json
import os
import shutil
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest

from mejores_engine import features, store
from mejores_engine.app import build_dispatcher
from mejores_engine.features import Features
from mejores_engine.rpc import DECODE_FAILED, Dispatcher, RpcError
from mejores_engine.store import EXPECTED_TABLES, Store

FIXED = Features(
    width=10,
    height=10,
    exif_time=None,
    dhash="00000000000000ff",
    sharpness=5.0,
    mean_luma=118.0,
    clip_hi=0.0,
    clip_lo=0.0,
    exposure=1.0,
)


class CountingExtractor:
    """Records every path it is asked to analyse; fails on names in `broken`."""

    def __init__(self, broken: tuple[str, ...] = ()) -> None:
        self.calls: list[tuple[str, bool]] = []
        self.broken = broken
        self.lock = threading.Lock()

    def __call__(self, path: Path, fmt: str, eyes: bool = False) -> Features:
        with self.lock:
            self.calls.append((path.name, eyes))
        if path.name in self.broken:
            raise RpcError(DECODE_FAILED, f"cannot decode {path.name}")
        return FIXED


def make_files(folder: Path, names: list[str]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        (folder / name).write_bytes(b"jpeg-ish")


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    assert "error" not in reply, reply
    return reply["result"]  # type: ignore[no-any-return]


def run_analysis(
    data: Path, folder: Path, extractor: Callable[..., Features], eyes: bool = True
) -> dict[str, Any]:
    dispatcher = build_dispatcher(
        lambda: Store(data),
        executor_factory=lambda: ThreadPoolExecutor(max_workers=2),
        extractor=extractor,
    )
    call(dispatcher, "grant_roots", {"roots": [str(folder)]})
    session_id = call(dispatcher, "scan", {"paths": [str(folder)]})["session_id"]
    job_id = call(dispatcher, "analyze", {"session_id": session_id, "eyes": eyes})["job_id"]
    deadline = time.monotonic() + 30
    while True:
        status = call(dispatcher, "job_status", {"job_id": job_id})
        if status["state"] != "running":
            return status
        assert time.monotonic() < deadline
        time.sleep(0.02)


def test_unchanged_files_are_served_from_the_cache(tmp_path: Path) -> None:
    folder, data = tmp_path / "fotos", tmp_path / "data"
    make_files(folder, ["a.jpg", "b.jpg", "c.jpg"])
    first = CountingExtractor()
    status = run_analysis(data, folder, first)
    assert (status["computed"], status["cached"]) == (3, 0)
    second = CountingExtractor()
    status = run_analysis(data, folder, second)
    assert (status["state"], status["computed"], status["cached"]) == ("done", 0, 3)
    assert second.calls == []
    with Store(data).session() as conn:
        dhashes = conn.execute("SELECT count(*) AS n FROM photos WHERE dhash IS NOT NULL")
        assert dhashes.fetchone()["n"] == 6


def test_the_eyes_flag_reaches_the_extractor(tmp_path: Path) -> None:
    folder, data = tmp_path / "fotos", tmp_path / "data"
    make_files(folder, ["a.jpg"])
    extractor = CountingExtractor()
    run_analysis(data, folder, extractor, eyes=True)
    run_analysis(data, folder, extractor, eyes=False)
    assert extractor.calls == [("a.jpg", True), ("a.jpg", False)]


def test_a_touched_file_is_the_only_one_recomputed(tmp_path: Path) -> None:
    folder, data = tmp_path / "fotos", tmp_path / "data"
    make_files(folder, ["a.jpg", "b.jpg", "c.jpg"])
    run_analysis(data, folder, CountingExtractor())
    info = os.stat(folder / "b.jpg")
    os.utime(folder / "b.jpg", ns=(info.st_atime_ns, info.st_mtime_ns + 5_000_000_000))
    again = CountingExtractor()
    status = run_analysis(data, folder, again)
    assert (status["computed"], status["cached"]) == (1, 2)
    assert again.calls == [("b.jpg", True)]


def test_a_new_features_version_or_eyes_flag_misses_everything(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder, data = tmp_path / "fotos", tmp_path / "data"
    make_files(folder, ["a.jpg", "b.jpg"])
    run_analysis(data, folder, CountingExtractor(), eyes=True)
    other_eyes = run_analysis(data, folder, CountingExtractor(), eyes=False)
    assert (other_eyes["computed"], other_eyes["cached"]) == (2, 0)
    monkeypatch.setattr(features, "FEATURES_VERSION", "2")
    new_version = run_analysis(data, folder, CountingExtractor(), eyes=True)
    assert (new_version["computed"], new_version["cached"]) == (2, 0)
    with Store(data).session() as conn:
        versions = {
            row["engine_version"] for row in conn.execute("SELECT engine_version FROM scores")
        }
    assert "2" in versions


def test_a_failed_photo_is_never_cached(tmp_path: Path) -> None:
    folder, data = tmp_path / "fotos", tmp_path / "data"
    make_files(folder, ["a.jpg", "bad.jpg"])
    status = run_analysis(data, folder, CountingExtractor(broken=("bad.jpg",)))
    assert (status["computed"], status["failed"]) == (1, 1)
    with Store(data).session() as conn:
        paths = [Path(row["path"]).name for row in conn.execute("SELECT path FROM feature_cache")]
    assert paths == ["a.jpg"]
    retry = CountingExtractor(broken=("bad.jpg",))
    status = run_analysis(data, folder, retry)
    assert (status["cached"], status["failed"]) == (1, 1)
    assert retry.calls == [("bad.jpg", True)]


def test_migration_0002_upgrades_a_database_with_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    only_first = tmp_path / "migrations_0001"
    only_first.mkdir()
    shutil.copy(store.MIGRATIONS_DIR / "0001_init.sql", only_first / "0001_init.sql")
    real_dir = store.MIGRATIONS_DIR
    data = tmp_path / "data"

    monkeypatch.setattr(store, "MIGRATIONS_DIR", only_first)
    old = Store(data)
    assert old.applied_versions() == ["0001"]
    with old.session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES ('p', 's', 'a.jpg', 'jpg', 1, 1)"
        )
        tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master")}
    assert "feature_cache" not in tables

    monkeypatch.setattr(store, "MIGRATIONS_DIR", real_dir)
    upgraded = Store(data)
    assert upgraded.applied_versions() == ["0001", "0002", "0003", "0004", "0005"]
    with upgraded.session() as conn:
        tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master")}
        assert conn.execute("SELECT count(*) AS n FROM sessions").fetchone()["n"] == 1
        assert conn.execute("SELECT count(*) AS n FROM photos").fetchone()["n"] == 1
    assert set(EXPECTED_TABLES) <= tables
