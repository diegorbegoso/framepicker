"""Sessions remembered between visits: the list on the home screen, resuming one, forgetting one.

A session is what the person did with a set of photos: the bursts, what they chose, what they
confirmed, the corrections. All of it already lives in the database; this module lets the
interface find it again.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher, RpcError
from mejores_engine.store import Store

RECENT_LIMIT = 10


def source_key(files: Iterable[Path]) -> str:
    """A fingerprint of the exact set of photos: the same folder picked again gives the same one."""
    names = sorted(os.path.normcase(str(file)) for file in files)
    return hashlib.sha1("\n".join(names).encode("utf-8"), usedforsecurity=False).hexdigest()


def find_resumable(conn: sqlite3.Connection, key: str) -> str | None:
    """The most recent session of these photos that already has bursts to go back to."""
    row = conn.execute(
        "SELECT s.id FROM sessions s WHERE s.source_key = ? "
        "AND EXISTS (SELECT 1 FROM bursts b WHERE b.session_id = s.id) "
        "ORDER BY COALESCE(s.updated_at, s.created_at) DESC LIMIT 1",
        (key,),
    ).fetchone()
    return str(row["id"]) if row else None


def photos_of(conn: sqlite3.Connection, session_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, path, format, size_bytes FROM photos WHERE session_id = ? ORDER BY path",
        (session_id,),
    ).fetchall()
    return [
        {
            "id": str(r["id"]),
            "path": str(r["path"]),
            "format": str(r["format"]),
            "size_bytes": int(r["size_bytes"]),
        }
        for r in rows
    ]


def now() -> str:
    return datetime.now(UTC).isoformat()


def touch(conn: sqlite3.Connection, session_id: str) -> None:
    conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now(), session_id))


def touch_burst(conn: sqlite3.Connection, burst_id: str) -> None:
    conn.execute(
        "UPDATE sessions SET updated_at = ? "
        "WHERE id = (SELECT session_id FROM bursts WHERE id = ?)",
        (now(), burst_id),
    )


def last_burst(conn: sqlite3.Connection, session_id: str) -> str | None:
    """The burst the person was looking at last, if it still exists."""
    row = conn.execute(
        "SELECT b.id FROM sessions s JOIN bursts b ON b.id = s.last_burst_id "
        "WHERE s.id = ? AND b.session_id = s.id",
        (session_id,),
    ).fetchone()
    return str(row["id"]) if row else None


def recent(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT s.id, s.label, s.last_burst_id, COALESCE(s.updated_at, s.created_at) AS seen, "
        "(SELECT count(*) FROM photos p WHERE p.session_id = s.id) AS photos, "
        "(SELECT count(*) FROM bursts b WHERE b.session_id = s.id) AS bursts, "
        "(SELECT count(*) FROM selections x JOIN bursts b ON b.id = x.burst_id "
        " WHERE b.session_id = s.id AND x.selected = 1) AS picked, "
        "(SELECT count(DISTINCT x.burst_id) FROM selections x JOIN bursts b ON b.id = x.burst_id "
        " WHERE b.session_id = s.id AND x.source = 'user') AS reviewed, "
        "(SELECT count(*) FROM photo_edits e JOIN photos p ON p.id = e.photo_id "
        " WHERE p.session_id = s.id) AS edited, "
        "(SELECT min(p.path) FROM photos p WHERE p.session_id = s.id) AS first_path "
        "FROM sessions s WHERE EXISTS (SELECT 1 FROM bursts b WHERE b.session_id = s.id) "
        "ORDER BY seen DESC LIMIT ?",
        (RECENT_LIMIT,),
    ).fetchall()
    result = []
    for row in rows:
        first = Path(str(row["first_path"])) if row["first_path"] else None
        result.append(
            {
                "id": str(row["id"]),
                "label": str(row["label"]),
                "folder": str(first.parent) if first else "",
                "photos": int(row["photos"]),
                "bursts": int(row["bursts"]),
                "picked": int(row["picked"]),
                "reviewed": int(row["reviewed"]),
                "edited": int(row["edited"]),
                "updated_at": str(row["seen"]),
                "last_burst_id": row["last_burst_id"],
                "available": bool(first and first.exists()),
            }
        )
    return result


def _session_id(params: dict[str, Any]) -> str:
    session_id = params.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        raise RpcError(INVALID_PARAMS, "session_id must be a non-empty string")
    return session_id


def _require(conn: sqlite3.Connection, session_id: str) -> None:
    if conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
        raise RpcError(NOT_FOUND, f"session not found: {session_id}")


def register(dispatcher: Dispatcher, store: Callable[[], Store]) -> None:
    @dispatcher.register("sessions_list")
    def sessions_list(_params: dict[str, Any]) -> dict[str, Any]:
        with store().session() as conn:
            return {"sessions": recent(conn)}

    @dispatcher.register("session_touch")
    def session_touch(params: dict[str, Any]) -> dict[str, Any]:
        session_id = _session_id(params)
        burst_id = params.get("burst_id")
        if burst_id is not None and (not isinstance(burst_id, str) or not burst_id):
            raise RpcError(INVALID_PARAMS, "burst_id must be a burst id")
        with store().session() as conn:
            _require(conn, session_id)
            if burst_id is not None:
                known = conn.execute(
                    "SELECT 1 FROM bursts WHERE id = ? AND session_id = ?", (burst_id, session_id)
                ).fetchone()
                if known is None:
                    raise RpcError(NOT_FOUND, f"burst not found: {burst_id}")
                conn.execute(
                    "UPDATE sessions SET last_burst_id = ? WHERE id = ?", (burst_id, session_id)
                )
            touch(conn, session_id)
        return {"session_id": session_id}

    @dispatcher.register("session_forget")
    def session_forget(params: dict[str, Any]) -> dict[str, Any]:
        session_id = _session_id(params)
        with store().session() as conn:
            _require(conn, session_id)
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))  # rows only
        return {"session_id": session_id}
