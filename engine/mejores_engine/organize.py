"""Organise a folder in place: the chosen photos stay, the rest move into a subfolder.

This is the one place that moves files inside a folder the person picked, and it is deliberately
narrow: it only moves (never deletes, never overwrites), only photos of the session and their
`.xmp` sidecars, only into a subfolder next to each photo, and it records every move so that the
whole thing can be undone. A RAW and a JPEG with the same name travel together: if either of them
was chosen, both stay.
"""

from __future__ import annotations

import contextlib
import os
import re
import sqlite3
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mejores_engine.export import sidecar_of
from mejores_engine.rpc import (
    INVALID_PARAMS,
    NOT_FOUND,
    PATH_NOT_ALLOWED,
    Dispatcher,
    RpcError,
)
from mejores_engine.scan import Roots
from mejores_engine.store import Store

DEFAULT_FOLDER = "No elegidas"
_FORBIDDEN = re.compile(r'[\\/:*?"<>|]')


@dataclass
class Move:
    photo_id: str | None  # None for a sidecar
    source: Path
    dest: Path


@dataclass
class Plan:
    moves: list[Move] = field(default_factory=list)
    kept: int = 0  # chosen photos, which stay
    kept_paired: int = 0  # not chosen, but sharing a name with a chosen one
    already: int = 0  # already inside the subfolder
    folders: list[Path] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        photos = [m for m in self.moves if m.photo_id is not None]
        return {
            "to_move": len(photos),
            "sidecars": len(self.moves) - len(photos),
            "kept": self.kept,
            "kept_paired": self.kept_paired,
            "already": self.already,
            "folders": [str(folder) for folder in self.folders],
        }


def clean_folder_name(value: Any) -> str:
    if value is None:
        return DEFAULT_FOLDER
    if not isinstance(value, str):
        raise RpcError(INVALID_PARAMS, "folder_name must be text")
    name = value.strip()
    if not name or len(name) > 60 or name in (".", "..") or _FORBIDDEN.search(name):
        raise RpcError(INVALID_PARAMS, "folder_name is not a valid folder name")
    if name.endswith("."):
        raise RpcError(INVALID_PARAMS, "folder_name is not a valid folder name")
    return name


def _key(path: Path) -> tuple[str, str]:
    return (os.path.normcase(str(path.parent)), path.stem.lower())


def _free(folder: Path, name: str, taken: set[str]) -> str:
    stem, suffix = os.path.splitext(name)
    counter = 0
    while True:
        candidate = name if counter == 0 else f"{stem}_{counter}{suffix}"
        if candidate.lower() not in taken and not (folder / candidate).exists():
            taken.add(candidate.lower())
            return candidate
        counter += 1


def make_plan(conn: sqlite3.Connection, session_id: str, folder_name: str) -> Plan:
    rows = conn.execute(
        "SELECT p.id, p.path, COALESCE(s.selected, 0) AS selected FROM photos p "
        "JOIN burst_members m ON m.photo_id = p.id "
        "JOIN bursts b ON b.id = m.burst_id AND b.session_id = ? "
        "LEFT JOIN selections s ON s.burst_id = m.burst_id AND s.photo_id = p.id "
        "WHERE p.session_id = ? ORDER BY p.path",
        (session_id, session_id),
    ).fetchall()
    chosen_units = {_key(Path(str(r["path"]))) for r in rows if r["selected"]}
    plan = Plan(kept=sum(1 for r in rows if r["selected"]))
    taken: dict[Path, set[str]] = {}
    for row in rows:
        source = Path(str(row["path"]))
        if row["selected"]:
            continue
        if source.parent.name.lower() == folder_name.lower():
            plan.already += 1
            continue
        if _key(source) in chosen_units:
            plan.kept_paired += 1
            continue
        target_dir = source.parent / folder_name
        used = taken.setdefault(target_dir, set())
        if target_dir not in plan.folders:
            plan.folders.append(target_dir)
        name = _free(target_dir, source.name, used)
        plan.moves.append(Move(str(row["id"]), source, target_dir / name))
        sidecar = sidecar_of(source)
        if sidecar is not None:
            side_name = _free(target_dir, f"{Path(name).stem}{sidecar.suffix}", used)
            plan.moves.append(Move(None, sidecar, target_dir / side_name))
    return plan


def _require_session(conn: sqlite3.Connection, session_id: str) -> None:
    if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
        raise RpcError(NOT_FOUND, f"session not found: {session_id}")


def _check_roots(plan: Plan, roots: Roots) -> None:
    for move in plan.moves:
        if not roots.is_allowed(move.source) or not roots.is_allowed(move.dest.parent):
            raise RpcError(PATH_NOT_ALLOWED, f"path not allowed: {move.source.parent}")


def apply(
    conn: sqlite3.Connection, session_id: str, folder_name: str, roots: Roots
) -> dict[str, Any]:
    """Move the photos that were not chosen. Nothing is deleted or replaced."""
    _require_session(conn, session_id)
    plan = make_plan(conn, session_id, folder_name)
    _check_roots(plan, roots)
    batch_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO organize_batches (id, session_id, folder_name, created_at) "
        "VALUES (?, ?, ?, ?)",
        (batch_id, session_id, folder_name, datetime.now(UTC).isoformat()),
    )
    conn.commit()
    moved = failed = 0
    errors: list[dict[str, str]] = []
    for move in plan.moves:
        try:
            if not move.source.is_file():
                raise FileNotFoundError(f"{move.source.name} is no longer there")
            move.dest.parent.mkdir(parents=True, exist_ok=True)
            if move.dest.exists():
                raise FileExistsError(f"{move.dest.name} already exists")
            os.replace(move.source, move.dest)
        except OSError as exc:
            failed += 1
            errors.append({"path": str(move.source), "message": str(exc)})
            continue
        conn.execute(
            "INSERT INTO organize_moves (batch_id, position, photo_id, source, dest) "
            "VALUES (?, ?, ?, ?, ?)",
            (batch_id, moved, move.photo_id, str(move.source), str(move.dest)),
        )
        if move.photo_id is not None:
            conn.execute("UPDATE photos SET path = ? WHERE id = ?", (str(move.dest), move.photo_id))
        conn.commit()  # a file is never moved without its record reaching the disk
        moved += 1
    return {"batch_id": batch_id, "moved": moved, "failed": failed, "errors": errors}


def undo(conn: sqlite3.Connection, batch_id: str) -> dict[str, Any]:
    """Put every file of a batch back where it was; whatever cannot go back is left and counted."""
    batch = conn.execute(
        "SELECT undone_at FROM organize_batches WHERE id = ?", (batch_id,)
    ).fetchone()
    if batch is None:
        raise RpcError(NOT_FOUND, f"batch not found: {batch_id}")
    if batch["undone_at"] is not None:
        raise RpcError(INVALID_PARAMS, "that organisation was already undone")
    moves = conn.execute(
        "SELECT photo_id, source, dest FROM organize_moves WHERE batch_id = ? "
        "ORDER BY position DESC",
        (batch_id,),
    ).fetchall()
    restored = skipped = 0
    folders: set[Path] = set()
    for row in moves:
        source, dest = Path(str(row["source"])), Path(str(row["dest"]))
        folders.add(dest.parent)
        if not dest.is_file() or source.exists():
            skipped += 1
            continue
        try:
            os.replace(dest, source)
        except OSError:
            skipped += 1
            continue
        if row["photo_id"] is not None:
            conn.execute("UPDATE photos SET path = ? WHERE id = ?", (str(source), row["photo_id"]))
        restored += 1
    for folder in folders:
        with contextlib.suppress(OSError):
            folder.rmdir()  # only works on an empty folder
    conn.execute(
        "UPDATE organize_batches SET undone_at = ? WHERE id = ?",
        (datetime.now(UTC).isoformat(), batch_id),
    )
    return {"batch_id": batch_id, "restored": restored, "skipped": skipped}


def register(dispatcher: Dispatcher, store: Callable[[], Store], roots: Roots) -> None:
    def params_of(params: dict[str, Any]) -> tuple[str, str]:
        session_id = params.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            raise RpcError(INVALID_PARAMS, "session_id must be a non-empty string")
        return session_id, clean_folder_name(params.get("folder_name"))

    @dispatcher.register("organize_preview")
    def organize_preview(params: dict[str, Any]) -> dict[str, Any]:
        session_id, folder_name = params_of(params)
        with store().session() as conn:
            _require_session(conn, session_id)
            return make_plan(conn, session_id, folder_name).summary()

    @dispatcher.register("organize_apply")
    def organize_apply(params: dict[str, Any]) -> dict[str, Any]:
        session_id, folder_name = params_of(params)
        with store().session() as conn:
            return apply(conn, session_id, folder_name, roots)

    @dispatcher.register("organize_undo")
    def organize_undo(params: dict[str, Any]) -> dict[str, Any]:
        batch_id = params.get("batch_id")
        if not isinstance(batch_id, str) or not batch_id:
            raise RpcError(INVALID_PARAMS, "batch_id must be a non-empty string")
        with store().session() as conn:
            return undo(conn, batch_id)
