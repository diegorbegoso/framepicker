"""Automatic basic correction: suggest exposure, contrast, highlights and shadows (and, if asked,
white balance) for a photo, for one photo at a time or for whole groups of bursts.

Everything here is conservative on purpose. Photos of parties and stages are full of coloured light
and deep black that must not be "fixed", so each value is damped and capped, and the result only
fills in the sliders: the person always has the last word.
"""

from __future__ import annotations

import math
import sqlite3
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from mejores_engine import edits, features, sessions
from mejores_engine.adjust import Adjustments
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher, Emitter, RpcError
from mejores_engine.store import Store

ANALYSIS_PX = 800
TARGET_MEDIAN = 0.46  # where the middle of the picture should sit
MAX_PHOTOS = 20000
CANCEL_WAIT_S = 0.9


def _round(value: float) -> float:
    return round(float(value), 2)


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def suggest(bgr: NDArray[np.uint8], white_balance: bool = False) -> Adjustments:
    """The corrections that would even this picture out; a well exposed one gets almost none."""
    height, width = bgr.shape[:2]
    if max(height, width) > ANALYSIS_PX:
        scale = ANALYSIS_PX / max(height, width)
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        bgr = np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    rgb = bgr[:, :, ::-1].astype(np.float32) / 255.0
    luma = np.asarray(rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32), dtype=np.float32)
    p2, p50, p98 = (float(v) for v in np.percentile(luma, [2, 50, 98]))

    # Exposure: bring the middle towards the target, but never push the bright part into white.
    wanted = math.log2(TARGET_MEDIAN / max(p50, 0.02)) * 0.8
    if wanted > 0:
        room = math.log2(0.98 / max(p98, 0.05))
        wanted = max(0.0, min(wanted, room))
    exposure = _clip(wanted, -1.5, 1.5)
    if abs(exposure) < 0.1:
        exposure = 0.0
    gain = 2.0**exposure
    lit = np.clip(luma * gain, 0.0, 1.0)

    q2, q98 = (float(v) for v in np.percentile(lit, [2, 98]))
    spread = q98 - q2
    contrast = _clip((0.75 - spread) * 0.9, 0.0, 0.35) if spread < 0.75 else 0.0

    burnt = float(np.mean(luma * gain > 0.96))
    highlights = -min(0.6, max(0.0, burnt - 0.015) * 6.0)
    dark = float(np.mean(lit < 0.08))
    shadows = min(0.35, max(0.0, dark - 0.2) * 0.8)

    chroma = float(np.mean(rgb.max(axis=2) - rgb.min(axis=2)))
    saturation = min(0.15, (0.10 - chroma) * 3.0) if chroma < 0.10 else 0.0

    temperature = tint = 0.0
    if white_balance:
        spread_rgb = rgb.max(axis=2) - rgb.min(axis=2)
        mid = (luma > 0.15) & (luma < 0.85) & (spread_rgb < 0.35)
        if float(mid.mean()) > 0.05:
            red, green, blue = (float(rgb[:, :, i][mid].mean()) for i in range(3))
            temperature = _clip((blue - red) / (0.2 * (blue + red) + 1e-6) * 0.6, -0.4, 0.4)
            tint = _clip((1 - ((red + blue) / 2) / max(green, 1e-6)) / 0.15 * 0.6, -0.3, 0.3)

    return Adjustments(
        exposure=_round(exposure),
        contrast=_round(contrast),
        highlights=_round(highlights),
        shadows=_round(shadows),
        temperature=_round(temperature),
        tint=_round(tint),
        saturation=_round(saturation),
    )


def _with_look_of(old: Adjustments | None, new: Adjustments) -> Adjustments:
    """The new sliders, keeping the LUT the photo already had."""
    if old is None:
        return new
    return Adjustments(
        new.exposure,
        new.contrast,
        new.highlights,
        new.shadows,
        new.temperature,
        new.tint,
        new.saturation,
        old.lut_id,
        old.lut_strength,
    )


@dataclass(frozen=True)
class Source:
    photo_id: str
    path: Path
    fmt: str


@dataclass
class Group:
    """One burst: its reference photo decides the correction every target receives."""

    reference: Source
    targets: list[str]


def plan_groups(conn: sqlite3.Connection, session_id: str, photo_ids: list[str]) -> list[Group]:
    """Group the photos by burst, choosing for each burst the chosen photo (else the sharpest)."""
    rows = conn.execute(
        "SELECT p.id, p.path, p.format, m.burst_id, m.position, "
        "COALESCE(s.selected, 0) AS sel, COALESCE(sc.sharpness, 0) AS sharp "
        "FROM photos p LEFT JOIN burst_members m ON m.photo_id = p.id "
        "LEFT JOIN selections s ON s.burst_id = m.burst_id AND s.photo_id = p.id "
        "LEFT JOIN scores sc ON sc.photo_id = p.id WHERE p.session_id = ? "
        "ORDER BY m.burst_id, m.position, p.path",
        (session_id,),
    ).fetchall()
    wanted = set(photo_ids)
    bursts: dict[str, list[sqlite3.Row]] = {}
    groups: list[Group] = []
    for row in rows:
        if row["burst_id"] is None:
            if str(row["id"]) in wanted:  # not in any burst: it is its own reference
                source = Source(str(row["id"]), Path(str(row["path"])), str(row["format"]))
                groups.append(Group(source, [source.photo_id]))
            continue
        bursts.setdefault(str(row["burst_id"]), []).append(row)
    for members in bursts.values():
        targets = [str(r["id"]) for r in members if str(r["id"]) in wanted]
        if not targets:
            continue
        chosen = [r for r in members if r["sel"]]
        best = max(chosen or members, key=lambda r: float(r["sharp"]))
        groups.append(
            Group(Source(str(best["id"]), Path(str(best["path"])), str(best["format"])), targets)
        )
    return groups


def correction_for(source: Source, white_balance: bool) -> Adjustments:
    bgr, _w, _h = features.scaled_base(source.path, source.fmt, ANALYSIS_PX, False)
    return suggest(bgr, white_balance)


@dataclass
class AutoFixJob:
    id: str
    groups: list[Group]
    white_balance: bool
    kind: str = "autofix"
    state: str = "running"
    done: int = 0
    fixed: int = 0
    failed: int = 0
    errors: list[dict[str, str]] = field(default_factory=list)
    cancel_requested: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "done": self.done,
            "total": len(self.groups),
            "fixed": self.fixed,
            "failed": self.failed,
            "errors": list(self.errors),
        }


class AutoFixes:
    """Registry of automatic-correction jobs, keyed by job id."""

    def __init__(self, store: Callable[[], Store], emitter: Emitter) -> None:
        self._store = store
        self._emitter = emitter
        self._jobs: dict[str, AutoFixJob] = {}
        self._lock = threading.Lock()

    def find(self, job_id: str) -> AutoFixJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def start(self, session_id: str, photo_ids: list[str], white_balance: bool) -> str:
        with self._store().session() as conn:
            groups = plan_groups(conn, session_id, photo_ids)
        job = AutoFixJob(id=str(uuid.uuid4()), groups=groups, white_balance=white_balance)
        with self._lock:
            self._jobs[job.id] = job
        threading.Thread(
            target=self._run, args=(job, session_id), name=f"autofix-{job.id}", daemon=True
        ).start()
        return job.id

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self.find(job_id)
        if job is None:
            raise RpcError(NOT_FOUND, f"job not found: {job_id}")
        job.cancel_requested.set()
        job.finished.wait(CANCEL_WAIT_S)
        return {"state": job.state}

    def _progress(self, job: AutoFixJob) -> None:
        params = {"job_id": job.id, "kind": job.kind, "done": job.done, "total": len(job.groups)}
        self._emitter.notify("progress", params)

    def _run(self, job: AutoFixJob, session_id: str) -> None:
        try:
            self._progress(job)
            for group in job.groups:
                if job.cancel_requested.is_set():
                    job.state = "cancelled"
                    return
                try:
                    found = correction_for(group.reference, job.white_balance)
                    with self._store().session() as conn:  # this thread's own connection
                        before = edits.load_many(conn, group.targets)
                        edits.put(
                            conn,
                            {pid: _with_look_of(before.get(pid), found) for pid in group.targets},
                        )
                        sessions.touch(conn, session_id)
                    job.fixed += len(group.targets)
                except (OSError, RpcError) as exc:
                    job.failed += 1
                    job.errors.append({"path": str(group.reference.path), "message": str(exc)})
                job.done += 1
                self._progress(job)
            job.state = "done"
        except Exception as exc:  # noqa: BLE001 - a job thread must always report its end
            job.state = "failed"
            job.errors.append({"path": "", "message": f"{type(exc).__name__}: {exc}"})
        finally:
            self._emitter.notify(
                "job_done",
                {
                    "job_id": job.id,
                    "kind": job.kind,
                    "state": job.state,
                    "fixed": job.fixed,
                    "failed": job.failed,
                },
            )
            job.finished.set()


def register(dispatcher: Dispatcher, store: Callable[[], Store], runs: AutoFixes) -> None:
    def flag(params: dict[str, Any]) -> bool:
        value = params.get("white_balance", False)
        if not isinstance(value, bool):
            raise RpcError(INVALID_PARAMS, "white_balance must be true or false")
        return value

    @dispatcher.register("autofix_suggest")
    def autofix_suggest(params: dict[str, Any]) -> dict[str, Any]:
        photo_id = params.get("photo_id")
        if not isinstance(photo_id, str) or not photo_id:
            raise RpcError(INVALID_PARAMS, "photo_id must be a non-empty string")
        white_balance = flag(params)
        with store().session() as conn:
            row = conn.execute(
                "SELECT path, format FROM photos WHERE id = ?", (photo_id,)
            ).fetchone()
        if row is None:
            raise RpcError(NOT_FOUND, f"photo not found: {photo_id}")
        source = Source(photo_id, Path(str(row["path"])), str(row["format"]))
        return {"adjustments": correction_for(source, white_balance).as_dict()}

    @dispatcher.register("autofix_run")
    def autofix_run(params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("session_id")
        ids = params.get("photo_ids")
        if not isinstance(session_id, str) or not session_id:
            raise RpcError(INVALID_PARAMS, "session_id must be a non-empty string")
        if not isinstance(ids, list) or not ids or len(ids) > MAX_PHOTOS:
            raise RpcError(INVALID_PARAMS, "photo_ids must be a non-empty list of ids")
        if not all(isinstance(i, str) and i for i in ids):
            raise RpcError(INVALID_PARAMS, "photo_ids must be a non-empty list of ids")
        white_balance = flag(params)
        unique = list(dict.fromkeys(ids))
        with store().session() as conn:
            if (
                conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
                is None
            ):
                raise RpcError(NOT_FOUND, f"session not found: {session_id}")
            known = {
                str(r["id"])
                for r in conn.execute("SELECT id FROM photos WHERE session_id = ?", (session_id,))
            }
        missing = [i for i in unique if i not in known]
        if missing:
            raise RpcError(NOT_FOUND, f"photo not in this session: {missing[0]}")
        return {"job_id": runs.start(session_id, unique, white_balance)}
