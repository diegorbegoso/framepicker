"""Background analysis jobs: a thread pool extracts features, one thread writes them.

The serve loop answers one request at a time, so a job runs on its own thread and reports through
the shared Emitter. Pool workers only compute; the job thread is the only one touching SQLite, and
it does so through its own connection.

The workers are threads, not processes. The work is OpenCV, NumPy and libraw, which release the GIL
(6 threads measured at 8x one thread), and a process pool has to start six more copies of the
300 MB frozen engine for every analysis. In the packaged Windows app those copies stalled at start,
so the installed analysis sat at 0 of N photos.
"""

from __future__ import annotations

import inspect
import json
import os
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Executor, Future, ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mejores_engine import features as features_module
from mejores_engine.features import Features, extract
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Emitter, RpcError
from mejores_engine.store import Store

Extractor = Callable[..., Features]  # (path, fmt) or (path, fmt, eyes=...)
CacheKey = tuple[str, int, int, str, int]
ExecutorFactory = Callable[[], Executor]

COMMIT_EVERY = 20
MIN_PROGRESS_GAP_S = 0.25
HEARTBEAT_S = 1.0
POLL_S = 0.05
CANCEL_WAIT_S = 0.9


def default_executor() -> Executor:
    return ThreadPoolExecutor(max_workers=min(os.cpu_count() or 1, 6), thread_name_prefix="analyze")


@dataclass(frozen=True)
class PhotoRef:
    id: str
    path: str
    format: str


@dataclass
class Job:
    id: str
    session_id: str
    photos: list[PhotoRef]
    eyes: bool
    kind: str = "analyze"
    state: str = "running"
    done: int = 0
    computed: int = 0
    cached: int = 0
    failed: int = 0
    errors: list[dict[str, str]] = field(default_factory=list)
    cancel_requested: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)

    @property
    def total(self) -> int:
        return len(self.photos)

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "done": self.done,
            "total": self.total,
            "computed": self.computed,
            "cached": self.cached,
            "failed": self.failed,
            "errors": list(self.errors),
        }


class Jobs:
    """Registry of analysis jobs, keyed by job id."""

    def __init__(
        self,
        store: Callable[[], Store],
        emitter: Emitter,
        executor_factory: ExecutorFactory | None = None,
        extractor: Extractor | None = None,
    ) -> None:
        self._store = store
        self._emitter = emitter
        self._executor_factory = executor_factory or default_executor
        self._extractor: Extractor = extractor or extract
        self._passes_eyes = "eyes" in inspect.signature(self._extractor).parameters
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise RpcError(NOT_FOUND, f"job not found: {job_id}")
        return job

    def start(self, session_id: str, eyes: bool) -> str:
        with self._store().session() as conn:
            if (
                conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
                is None
            ):
                raise RpcError(NOT_FOUND, f"session not found: {session_id}")
            rows = conn.execute(
                "SELECT id, path, format FROM photos WHERE session_id = ? ORDER BY rowid",
                (session_id,),
            ).fetchall()
        photos = [PhotoRef(str(r["id"]), str(r["path"]), str(r["format"])) for r in rows]
        with self._lock:
            for other in self._jobs.values():
                if other.session_id == session_id and other.state == "running":
                    raise RpcError(INVALID_PARAMS, "job already running")
            job = Job(id=str(uuid.uuid4()), session_id=session_id, photos=photos, eyes=eyes)
            self._jobs[job.id] = job
        threading.Thread(target=self._run, args=(job,), name=f"job-{job.id}", daemon=True).start()
        return job.id

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        job.cancel_requested.set()
        job.finished.wait(CANCEL_WAIT_S)
        return {"state": job.state}

    def _progress(self, job: Job) -> None:
        self._emitter.notify(
            "progress",
            {"job_id": job.id, "kind": job.kind, "done": job.done, "total": job.total},
        )

    def _run(self, job: Job) -> None:
        try:
            self._work(job)
        except Exception as exc:  # noqa: BLE001 - a job thread must always report its end
            job.state = "failed"
            job.errors.append({"path": "", "message": f"{type(exc).__name__}: {exc}"})
        finally:
            self._progress(job)
            self._emitter.notify(
                "job_done",
                {
                    "job_id": job.id,
                    "kind": job.kind,
                    "state": job.state,
                    "computed": job.computed,
                    "cached": job.cached,
                    "failed": job.failed,
                },
            )
            job.finished.set()

    def _work(self, job: Job) -> None:
        self._progress(job)
        last_sent = time.monotonic()
        last_done = job.done
        executor = self._executor_factory()
        cancelled = False
        try:
            with self._store().session() as conn:
                futures: dict[Future[Features], tuple[PhotoRef, CacheKey | None]] = {}
                for photo in job.photos:
                    key = _cache_key(photo, job.eyes)
                    hit = _cache_get(conn, key)
                    if hit is not None:
                        _store_features(conn, photo, hit)
                        job.cached += 1
                        job.done += 1
                        continue
                    kwargs: dict[str, Any] = {"eyes": job.eyes} if self._passes_eyes else {}
                    future = executor.submit(
                        self._extractor, Path(photo.path), photo.format, **kwargs
                    )
                    futures[future] = (photo, key)
                pending: set[Future[Features]] = set(futures)
                since_commit = 0
                while pending:
                    if job.cancel_requested.is_set():
                        cancelled = True
                        break
                    finished, pending = wait(pending, timeout=POLL_S, return_when=FIRST_COMPLETED)
                    for future in finished:
                        self._record(conn, job, *futures[future], future)
                        job.done += 1
                        since_commit += 1
                        if since_commit >= COMMIT_EVERY:
                            conn.commit()
                            since_commit = 0
                    now = time.monotonic()
                    changed = job.done != last_done and now - last_sent >= MIN_PROGRESS_GAP_S
                    if changed or now - last_sent >= HEARTBEAT_S:
                        self._progress(job)
                        last_sent = now
                        last_done = job.done
        finally:
            executor.shutdown(wait=not cancelled, cancel_futures=cancelled)
        job.state = "cancelled" if cancelled else "done"

    def _record(
        self,
        conn: sqlite3.Connection,
        job: Job,
        photo: PhotoRef,
        key: CacheKey | None,
        future: Future[Features],
    ) -> None:
        try:
            result = future.result()
        except RpcError as exc:
            job.failed += 1
            job.errors.append({"path": photo.path, "message": exc.message})
            return
        except Exception as exc:  # noqa: BLE001 - one bad photo never aborts the job
            job.failed += 1
            job.errors.append({"path": photo.path, "message": f"{type(exc).__name__}: {exc}"})
            return
        _store_features(conn, photo, result)
        if key is not None:
            conn.execute(
                "INSERT OR REPLACE INTO feature_cache (path, size_bytes, mtime_ns, "
                "features_version, eyes, features_json) VALUES (?, ?, ?, ?, ?, ?)",
                (*key, json.dumps(asdict(result))),
            )
        job.computed += 1


def _cache_key(photo: PhotoRef, eyes: bool) -> CacheKey | None:
    """The cache key from the file as it is now; None when the file cannot be read."""
    try:
        info = os.stat(photo.path)
    except OSError:
        return None
    version = features_module.FEATURES_VERSION
    return (photo.path, info.st_size, info.st_mtime_ns, version, int(eyes))


def _cache_get(conn: sqlite3.Connection, key: CacheKey | None) -> Features | None:
    if key is None:
        return None
    row = conn.execute(
        "SELECT features_json FROM feature_cache WHERE path = ? AND size_bytes = ? "
        "AND mtime_ns = ? AND features_version = ? AND eyes = ?",
        key,
    ).fetchone()
    if row is None:
        return None
    try:
        return Features(**json.loads(row["features_json"]))
    except (TypeError, ValueError):
        return None


def _store_features(conn: sqlite3.Connection, photo: PhotoRef, result: Features) -> None:
    conn.execute(
        "UPDATE photos SET width = ?, height = ?, exif_time = ?, dhash = ? WHERE id = ?",
        (result.width, result.height, result.exif_time, result.dhash, photo.id),
    )
    conn.execute(
        "INSERT OR REPLACE INTO scores (photo_id, sharpness, exposure, mean_luma, clip_hi, "
        "clip_lo, eyes_open, engine_version, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            photo.id,
            result.sharpness,
            result.exposure,
            result.mean_luma,
            result.clip_hi,
            result.clip_lo,
            result.eyes_open,
            features_module.FEATURES_VERSION,
            datetime.now(UTC).isoformat(),
        ),
    )
