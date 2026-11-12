"""The corrections kept for each photo, and the RPCs that read and change them.

Corrections are only stored: the originals are never touched, and the preview and the export
apply them on the fly.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from mejores_engine import adjust, sessions
from mejores_engine.adjust import Adjustments
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher, RpcError
from mejores_engine.store import Store

MAX_PHOTOS = 20000


def load_many(conn: sqlite3.Connection, photo_ids: list[str]) -> dict[str, Adjustments]:
    """The corrections of those photos that have some; the rest are simply absent."""
    found: dict[str, Adjustments] = {}
    for start in range(0, len(photo_ids), 500):
        chunk = photo_ids[start : start + 500]
        marks = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT photo_id, params_json FROM photo_edits WHERE photo_id IN ({marks})",  # noqa: S608
            chunk,
        ).fetchall()
        for row in rows:
            found[str(row["photo_id"])] = adjust.parse(json.loads(row["params_json"]))
    return found


def put(conn: sqlite3.Connection, entries: dict[str, Adjustments | None]) -> None:
    """Set the corrections of many photos at once; `None` or all-neutral removes them."""
    now = datetime.now(UTC).isoformat()
    for photo_id, adjustments in entries.items():
        if adjustments is None or adjustments.is_identity:
            conn.execute("DELETE FROM photo_edits WHERE photo_id = ?", (photo_id,))
            continue
        conn.execute(
            "INSERT INTO photo_edits (photo_id, params_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT (photo_id) DO UPDATE SET params_json = excluded.params_json, "
            "updated_at = excluded.updated_at",
            (photo_id, json.dumps(adjustments.as_dict()), now),
        )


def load_session(conn: sqlite3.Connection, session_id: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        "SELECT e.photo_id, e.params_json FROM photo_edits e "
        "JOIN photos p ON p.id = e.photo_id WHERE p.session_id = ?",
        (session_id,),
    ).fetchall()
    return {str(r["photo_id"]): adjust.validate(json.loads(r["params_json"])) for r in rows}


def _photo_ids(conn: sqlite3.Connection, params: dict[str, Any]) -> tuple[str, list[str]]:
    session_id = params.get("session_id")
    ids = params.get("photo_ids")
    if not isinstance(session_id, str) or not session_id:
        raise RpcError(INVALID_PARAMS, "session_id must be a non-empty string")
    if not isinstance(ids, list) or not ids or len(ids) > MAX_PHOTOS:
        raise RpcError(INVALID_PARAMS, "photo_ids must be a non-empty list of ids")
    if not all(isinstance(i, str) and i for i in ids):
        raise RpcError(INVALID_PARAMS, "photo_ids must be a non-empty list of ids")
    unique = list(dict.fromkeys(ids))
    known = {
        str(r["id"])
        for r in conn.execute("SELECT id FROM photos WHERE session_id = ?", (session_id,))
    }
    missing = [i for i in unique if i not in known]
    if missing:
        raise RpcError(NOT_FOUND, f"photo not in this session: {missing[0]}")
    return session_id, unique


def register(dispatcher: Dispatcher, store: Callable[[], Store]) -> None:
    @dispatcher.register("edits_get")
    def edits_get(params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            raise RpcError(INVALID_PARAMS, "session_id must be a non-empty string")
        with store().session() as conn:
            return {"edits": load_session(conn, session_id)}

    @dispatcher.register("edits_set")
    def edits_set(params: dict[str, Any]) -> dict[str, Any]:
        clean = adjust.validate(params.get("adjustments"))
        with store().session() as conn:
            session_id, ids = _photo_ids(conn, params)
            sessions.touch(conn, session_id)
            now = datetime.now(UTC).isoformat()
            for photo_id in ids:
                if adjust.parse(clean).is_identity:
                    conn.execute("DELETE FROM photo_edits WHERE photo_id = ?", (photo_id,))
                    continue
                conn.execute(
                    "INSERT INTO photo_edits (photo_id, params_json, updated_at) VALUES (?, ?, ?) "
                    "ON CONFLICT (photo_id) DO UPDATE SET params_json = excluded.params_json, "
                    "updated_at = excluded.updated_at",
                    (photo_id, json.dumps(clean), now),
                )
        return {"photo_ids": ids, "adjustments": clean}

    @dispatcher.register("edits_put")
    def edits_put(params: dict[str, Any]) -> dict[str, Any]:
        """Each photo gets its own corrections (or none): how an "undo" puts many photos back."""
        raw = params.get("entries")
        if not isinstance(raw, dict) or not raw or len(raw) > MAX_PHOTOS:
            raise RpcError(INVALID_PARAMS, "entries must map photo ids to corrections or null")
        entries = {
            str(photo_id): None if value is None else adjust.parse(value)
            for photo_id, value in raw.items()
        }
        with store().session() as conn:
            session_id, _ids = _photo_ids(conn, {**params, "photo_ids": list(entries)})
            sessions.touch(conn, session_id)
            put(conn, entries)
        return {"photo_ids": list(entries)}

    @dispatcher.register("edits_reset")
    def edits_reset(params: dict[str, Any]) -> dict[str, Any]:
        with store().session() as conn:
            session_id, ids = _photo_ids(conn, params)
            sessions.touch(conn, session_id)
            for photo_id in ids:
                conn.execute("DELETE FROM photo_edits WHERE photo_id = ?", (photo_id,))
        return {"photo_ids": ids}
