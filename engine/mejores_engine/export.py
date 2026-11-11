"""Export: copy the chosen photos (and their .xmp sidecars) to a destination folder.

Originals are only ever opened for reading. Every copy goes to `<target>.part` first and is renamed
into place, and the plan picks names that are free, so nothing that already exists is overwritten.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mejores_engine.rpc import NOT_FOUND, Emitter, RpcError
from mejores_engine.store import Store

CANCEL_WAIT_S = 0.9


def canonical(path: Path) -> Path:
    return Path(os.path.normcase(path.resolve()))


def is_same_or_inside(path: Path, folder: Path) -> bool:
    return canonical(path).is_relative_to(canonical(folder))


def sidecar_of(photo: Path) -> Path | None:
    """`<stem>.xmp` beside the photo, matched without regard to letter case."""
    wanted = f"{photo.stem}.xmp".lower()
    try:
        for entry in photo.parent.iterdir():
            if entry.name.lower() == wanted and entry.is_file():
                return entry
    except OSError:
        return None
    return None


def plan(photos: list[Path], dest: Path) -> list[tuple[Path, Path]]:
    """(source, target) pairs. A taken name gets `_1`, `_2`… before the extension."""
    taken: set[str] = set()
    pairs: list[tuple[Path, Path]] = []

    def free(name: str) -> bool:
        return name.lower() not in taken and not (dest / name).exists()

    for photo in photos:
        sidecar = sidecar_of(photo)
        counter = 0
        while True:
            stem = photo.stem if counter == 0 else f"{photo.stem}_{counter}"
            name = f"{stem}{photo.suffix}"
            side_name = f"{stem}{sidecar.suffix}" if sidecar else None
            if free(name) and (side_name is None or free(side_name)):
                break
            counter += 1
        taken.add(name.lower())
        pairs.append((photo, dest / name))
        if sidecar is not None and side_name is not None:
            taken.add(side_name.lower())
            pairs.append((sidecar, dest / side_name))
    return pairs


def selected_paths(conn: sqlite3.Connection, session_id: str) -> list[Path]:
    rows = conn.execute(
        "SELECT p.path FROM selections s JOIN bursts b ON b.id = s.burst_id "
        "JOIN burst_members m ON m.burst_id = s.burst_id AND m.photo_id = s.photo_id "
        "JOIN photos p ON p.id = s.photo_id "
        "WHERE b.session_id = ? AND s.selected = 1 ORDER BY b.position, m.position",
        (session_id,),
    ).fetchall()
    return [Path(str(row["path"])) for row in rows]


def source_folders(conn: sqlite3.Connection, session_id: str) -> set[Path]:
    rows = conn.execute("SELECT path FROM photos WHERE session_id = ?", (session_id,))
    return {Path(str(row["path"])).parent for row in rows}


@dataclass
class ExportJob:
    id: str
    pairs: list[tuple[Path, Path]]
    kind: str = "export"
    state: str = "running"
    done: int = 0
    copied: int = 0
    failed: int = 0
    errors: list[dict[str, str]] = field(default_factory=list)
    cancel_requested: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "done": self.done,
            "total": len(self.pairs),
            "copied": self.copied,
            "failed": self.failed,
            "errors": list(self.errors),
        }


def copy_one(source: Path, target: Path) -> None:
    """Copy through a `.part` file; refuses to replace anything that appeared meanwhile."""
    part = target.with_name(target.name + ".part")
    try:
        shutil.copyfile(source, part)
        if target.exists():
            raise FileExistsError(f"{target.name} appeared during the export")
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)


class Exports:
    """Registry of export jobs, keyed by job id."""

    def __init__(self, store: Callable[[], Store], emitter: Emitter) -> None:
        self._store = store
        self._emitter = emitter
        self._jobs: dict[str, ExportJob] = {}
        self._lock = threading.Lock()

    def find(self, job_id: str) -> ExportJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def get(self, job_id: str) -> ExportJob:
        job = self.find(job_id)
        if job is None:
            raise RpcError(NOT_FOUND, f"job not found: {job_id}")
        return job

    def start(self, session_id: str, dest: Path) -> str:
        with self._store().session() as conn:
            photos = selected_paths(conn, session_id)
        if photos:
            dest.mkdir(parents=True, exist_ok=True)
        job = ExportJob(id=str(uuid.uuid4()), pairs=plan(photos, dest))
        with self._lock:
            self._jobs[job.id] = job
        threading.Thread(target=self.run, args=(job,), name=f"export-{job.id}", daemon=True).start()
        return job.id

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        job.cancel_requested.set()
        job.finished.wait(CANCEL_WAIT_S)
        return {"state": job.state}

    def _progress(self, job: ExportJob) -> None:
        params = {"job_id": job.id, "kind": job.kind, "done": job.done, "total": len(job.pairs)}
        self._emitter.notify("progress", params)

    def run(self, job: ExportJob) -> None:
        try:
            self._progress(job)
            for source, target in job.pairs:
                if job.cancel_requested.is_set():
                    job.state = "cancelled"
                    return
                try:
                    copy_one(source, target)
                    job.copied += 1
                except OSError as exc:
                    job.failed += 1
                    job.errors.append({"path": str(source), "message": str(exc)})
                job.done += 1
                self._progress(job)
            job.state = "done"
        except Exception as exc:  # noqa: BLE001 - an export thread must always report its end
            job.state = "failed"
            job.errors.append({"path": "", "message": f"{type(exc).__name__}: {exc}"})
        finally:
            self._emitter.notify(
                "job_done",
                {
                    "job_id": job.id,
                    "kind": job.kind,
                    "state": job.state,
                    "copied": job.copied,
                    "failed": job.failed,
                },
            )
            job.finished.set()
