"""Export: copy the chosen photos (and their .xmp sidecars) to a destination folder, or save them
again in another format, size and colour (see `export_image.py`).

Originals are only ever opened for reading. Every file goes to `<target>.part` first and is renamed
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

from mejores_engine import edits, export_image
from mejores_engine.adjust import Adjustments
from mejores_engine.luts import Lut
from mejores_engine.rpc import NOT_FOUND, Emitter, RpcError
from mejores_engine.store import Store

CANCEL_WAIT_S = 0.9

LutResolver = Callable[[str], Lut | None]


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


def plan(photos: list[Path], dest: Path, taken: set[str] | None = None) -> list[tuple[Path, Path]]:
    """(source, target) pairs. A taken name gets `_1`, `_2`… before the extension."""
    used = taken if taken is not None else set()
    pairs: list[tuple[Path, Path]] = []

    def free(name: str) -> bool:
        return name.lower() not in used and not (dest / name).exists()

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
        used.add(name.lower())
        pairs.append((photo, dest / name))
        if sidecar is not None and side_name is not None:
            used.add(side_name.lower())
            pairs.append((sidecar, dest / side_name))
    return pairs


def session_photos(
    conn: sqlite3.Connection, session_id: str, photo_ids: list[str] | None
) -> list[tuple[str, Path]]:
    """(id, path) of the chosen photos, or of exactly `photo_ids`, in the session's order."""
    if photo_ids is None:
        rows = conn.execute(
            "SELECT p.id, p.path FROM selections s JOIN bursts b ON b.id = s.burst_id "
            "JOIN burst_members m ON m.burst_id = s.burst_id AND m.photo_id = s.photo_id "
            "JOIN photos p ON p.id = s.photo_id "
            "WHERE b.session_id = ? AND s.selected = 1 ORDER BY b.position, m.position",
            (session_id,),
        ).fetchall()
        return [(str(row["id"]), Path(str(row["path"]))) for row in rows]
    wanted = set(photo_ids)
    rows = conn.execute(
        "SELECT p.id, p.path FROM photos p LEFT JOIN burst_members m ON m.photo_id = p.id "
        "LEFT JOIN bursts b ON b.id = m.burst_id WHERE p.session_id = ? "
        "ORDER BY COALESCE(b.position, 1000000000), COALESCE(m.position, 0), p.path",
        (session_id,),
    ).fetchall()
    return [(str(r["id"]), Path(str(r["path"]))) for r in rows if str(r["id"]) in wanted]


def source_folders(conn: sqlite3.Connection, session_id: str) -> set[Path]:
    rows = conn.execute("SELECT path FROM photos WHERE session_id = ?", (session_id,))
    return {Path(str(row["path"])).parent for row in rows}


@dataclass
class Render:
    """How one file is made when it is not a plain copy."""

    options: export_image.ExportOptions
    adjustments: Adjustments | None
    lut: Lut | None


@dataclass
class ExportJob:
    id: str
    pairs: list[tuple[Path, Path]]
    renders: dict[int, Render] = field(default_factory=dict)  # by position in `pairs`
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


def build_job(
    conn: sqlite3.Connection,
    session_id: str,
    dest: Path,
    options: export_image.ExportOptions | None,
    photo_ids: list[str] | None,
    resolve_lut: LutResolver,
) -> ExportJob:
    """Decide, photo by photo, whether it is copied as it is or saved again."""
    photos = session_photos(conn, session_id, photo_ids)
    carried: dict[str, Adjustments] = {}
    if options is not None and options.apply_edits:
        carried = {
            pid: adj
            for pid, adj in edits.load_many(conn, [pid for pid, _ in photos]).items()
            if not adj.is_identity
        }
    again: list[tuple[str, Path]] = []
    plain: list[Path] = []
    for photo_id, path in photos:
        if options is not None and (options.re_encodes or photo_id in carried):
            again.append((photo_id, path))
        else:
            plain.append(path)
    taken: set[str] = set()
    pairs: list[tuple[Path, Path]] = []
    renders: dict[int, Render] = {}
    if options is not None and again:
        named = export_image.target_names([path for _, path in again], dest, options, taken)
        for (photo_id, _), pair in zip(again, named, strict=True):
            adj = carried.get(photo_id)
            lut = resolve_lut(adj.lut_id) if adj and adj.lut_id else None
            renders[len(pairs)] = Render(options, adj, lut)
            pairs.append(pair)
    pairs.extend(plan(plain, dest, taken))
    return ExportJob(id=str(uuid.uuid4()), pairs=pairs, renders=renders)


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

    def start(
        self,
        session_id: str,
        dest: Path,
        options: export_image.ExportOptions | None = None,
        photo_ids: list[str] | None = None,
        resolve_lut: LutResolver = lambda _id: None,
    ) -> str:
        with self._store().session() as conn:
            job = build_job(conn, session_id, dest, options, photo_ids, resolve_lut)
        if job.pairs:
            dest.mkdir(parents=True, exist_ok=True)
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
            for index, (source, target) in enumerate(job.pairs):
                if job.cancel_requested.is_set():
                    job.state = "cancelled"
                    return
                try:
                    render = job.renders.get(index)
                    if render is not None:
                        export_image.render_one(
                            source, target, render.options, render.adjustments, render.lut
                        )
                    else:
                        copy_one(source, target)
                    job.copied += 1
                except (OSError, RpcError) as exc:
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
