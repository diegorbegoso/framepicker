from __future__ import annotations

import json
import pickle
import threading
import time
from collections.abc import Callable
from concurrent.futures import Executor, ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from mejores_engine import features
from mejores_engine.app import build_dispatcher
from mejores_engine.features import Features
from mejores_engine.rpc import (
    DECODE_FAILED,
    INVALID_PARAMS,
    NOT_FOUND,
    Dispatcher,
    Emitter,
    RpcError,
)
from mejores_engine.store import Store

FIXED = Features(
    width=640,
    height=480,
    exif_time="2026-11-04T13:47:39",
    dhash="00000000000000ff",
    sharpness=100.0,
    mean_luma=118.0,
    clip_hi=0.0,
    clip_lo=0.0,
    exposure=1.0,
)


class ListEmitter(Emitter):
    """Keeps every notification with the monotonic time it arrived."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.events: list[tuple[float, str, dict[str, Any]]] = []

    def send_line(self, line: str) -> None:
        return None

    def notify(self, method: str, params: dict[str, Any]) -> None:
        with self.lock:
            self.events.append((time.monotonic(), method, dict(params)))

    def of(self, method: str) -> list[tuple[float, dict[str, Any]]]:
        with self.lock:
            return [(at, params) for at, name, params in self.events if name == method]


def sleeping_extractor(seconds: float, fail_on: str | None = None) -> Callable[..., Features]:
    def extract(path: Path, fmt: str) -> Features:
        time.sleep(seconds)
        if fail_on is not None and path.name == fail_on:
            raise RpcError(DECODE_FAILED, f"cannot decode {path.name}")
        return FIXED

    return extract


def threads(workers: int = 4) -> Callable[[], Executor]:
    return lambda: ThreadPoolExecutor(max_workers=workers)


def make_session(data: Path, paths: list[str]) -> None:
    with Store(data).session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        for index, path in enumerate(paths):
            conn.execute(
                "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
                "VALUES (?, 's', ?, 'jpg', 1, 1)",
                (f"p{index}", path),
            )


def setup(
    tmp_path: Path,
    count: int,
    extractor: Callable[..., Features],
    executor_factory: Callable[[], Executor] | None = None,
    paths: list[str] | None = None,
) -> tuple[Dispatcher, ListEmitter, Path]:
    data = tmp_path / "data"
    make_session(data, paths or [str(tmp_path / f"IMG_{i}.jpg") for i in range(count)])
    emitter = ListEmitter()
    dispatcher = build_dispatcher(
        lambda: Store(data),
        emitter=emitter,
        executor_factory=executor_factory or threads(),
        extractor=extractor,
    )
    return dispatcher, emitter, data


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def wait_until_finished(dispatcher: Dispatcher, job_id: str, timeout: float = 30.0) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = call(dispatcher, "job_status", {"job_id": job_id})["result"]
        if status["state"] != "running":
            return status
        time.sleep(0.02)
    raise AssertionError("job did not finish in time")


def stored_hashes(data: Path) -> list[Any]:
    with Store(data).session() as conn:
        return [row["dhash"] for row in conn.execute("SELECT dhash FROM photos ORDER BY id")]


def test_forty_photos_are_analysed_and_the_last_progress_is_complete(tmp_path: Path) -> None:
    dispatcher, emitter, data = setup(tmp_path, 40, sleeping_extractor(0.0))
    job_id = call(dispatcher, "analyze", {"session_id": "s"})["result"]["job_id"]
    status = wait_until_finished(dispatcher, job_id)
    assert status["state"] == "done"
    assert status["computed"] == 40
    assert all(value == FIXED.dhash for value in stored_hashes(data))
    assert len(stored_hashes(data)) == 40
    last = emitter.of("progress")[-1][1]
    assert last == {"job_id": job_id, "kind": "analyze", "done": 40, "total": 40}
    done = emitter.of("job_done")
    assert done[-1][1]["state"] == "done"
    assert done[-1][1]["cached"] == 0
    with Store(data).session() as conn:
        assert conn.execute("SELECT count(*) AS n FROM scores").fetchone()["n"] == 40


def test_a_slow_photo_still_gets_a_heartbeat(tmp_path: Path) -> None:
    dispatcher, emitter, _ = setup(tmp_path, 1, sleeping_extractor(2.5))
    job_id = call(dispatcher, "analyze", {"session_id": "s"})["result"]["job_id"]
    wait_until_finished(dispatcher, job_id)
    times = [at for at, _ in emitter.of("progress")]
    assert len(times) >= 3
    gaps = [later - earlier for earlier, later in zip(times, times[1:], strict=False)]
    assert max(gaps) <= 1.2


def test_cancel_stops_the_job_quickly(tmp_path: Path) -> None:
    dispatcher, emitter, _ = setup(tmp_path, 50, sleeping_extractor(0.2), threads(2))
    job_id = call(dispatcher, "analyze", {"session_id": "s"})["result"]["job_id"]
    time.sleep(0.3)
    asked = time.monotonic()
    reply = call(dispatcher, "cancel", {"job_id": job_id})
    status = call(dispatcher, "job_status", {"job_id": job_id})["result"]
    elapsed = time.monotonic() - asked
    assert reply["result"]["state"] == "cancelled"
    assert status["state"] == "cancelled"
    assert elapsed < 1.0
    assert status["done"] < 50
    assert emitter.of("job_done")[-1][1]["state"] == "cancelled"


def test_one_undecodable_photo_does_not_abort_the_job(tmp_path: Path) -> None:
    paths = [str(tmp_path / name) for name in ("a.jpg", "bad.jpg", "c.jpg")]
    dispatcher, _, data = setup(tmp_path, 3, sleeping_extractor(0.0, "bad.jpg"), paths=paths)
    job_id = call(dispatcher, "analyze", {"session_id": "s"})["result"]["job_id"]
    status = wait_until_finished(dispatcher, job_id)
    assert status["state"] == "done"
    assert status["failed"] == 1
    assert status["computed"] == 2
    assert [error["path"] for error in status["errors"]] == [paths[1]]
    assert stored_hashes(data) == [FIXED.dhash, None, FIXED.dhash]


def test_real_jpegs_with_a_real_process_pool(tmp_path: Path) -> None:
    paths = []
    rng = np.random.default_rng(3)
    for index in range(3):
        path = tmp_path / f"real_{index}.jpg"
        pixels = rng.integers(0, 256, size=(90, 120, 3), dtype=np.uint8)
        assert cv2.imwrite(str(path), pixels)
        paths.append(str(path))
    dispatcher, _, data = setup(
        tmp_path,
        3,
        features.extract,
        lambda: ProcessPoolExecutor(max_workers=2),
        paths=paths,
    )
    job_id = call(dispatcher, "analyze", {"session_id": "s"})["result"]["job_id"]
    status = wait_until_finished(dispatcher, job_id, timeout=120.0)
    assert status["state"] == "done", status
    hashes = stored_hashes(data)
    assert len(hashes) == 3
    assert all(isinstance(value, str) and len(value) == 16 for value in hashes)


def test_duplicate_and_unknown_requests_are_refused(tmp_path: Path) -> None:
    dispatcher, _, _ = setup(tmp_path, 10, sleeping_extractor(0.2), threads(1))
    job_id = call(dispatcher, "analyze", {"session_id": "s"})["result"]["job_id"]
    again = call(dispatcher, "analyze", {"session_id": "s"})
    assert again["error"]["code"] == INVALID_PARAMS
    assert again["error"]["message"] == "job already running"
    assert call(dispatcher, "analyze", {"session_id": "nope"})["error"]["code"] == NOT_FOUND
    assert call(dispatcher, "job_status", {"job_id": "nope"})["error"]["code"] == NOT_FOUND
    assert call(dispatcher, "cancel", {"job_id": "nope"})["error"]["code"] == NOT_FOUND
    call(dispatcher, "cancel", {"job_id": job_id})


def test_rpc_errors_survive_pickling_across_processes() -> None:
    restored = pickle.loads(pickle.dumps(RpcError(DECODE_FAILED, "cannot decode x", {"a": 1})))
    assert isinstance(restored, RpcError)
    assert (restored.code, restored.message, restored.data) == (
        DECODE_FAILED,
        "cannot decode x",
        {"a": 1},
    )
