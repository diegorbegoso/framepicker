"""The `export` RPC: validates the destination and the options, then starts the job."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from mejores_engine import export, export_image
from mejores_engine.luts_library import LutLibrary
from mejores_engine.rpc import (
    DEST_INSIDE_SOURCE,
    INVALID_PARAMS,
    NOT_FOUND,
    PATH_NOT_ALLOWED,
    Dispatcher,
    RpcError,
)
from mejores_engine.scan import Roots
from mejores_engine.store import Store


def register(
    dispatcher: Dispatcher,
    store: Callable[[], Store],
    roots: Roots,
    exports: export.Exports,
    library: LutLibrary,
) -> None:
    @dispatcher.register("export")
    def export_selection(params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("session_id")
        raw_dest = params.get("dest")
        if not isinstance(session_id, str) or not session_id:
            raise RpcError(INVALID_PARAMS, "session_id must be a non-empty string")
        if not isinstance(raw_dest, str) or not raw_dest:
            raise RpcError(INVALID_PARAMS, "dest must be a non-empty string")
        options = export_image.parse(params["options"]) if "options" in params else None
        photo_ids = params.get("photo_ids")
        if photo_ids is not None and (
            not isinstance(photo_ids, list)
            or not photo_ids
            or not all(isinstance(i, str) and i for i in photo_ids)
        ):
            raise RpcError(INVALID_PARAMS, "photo_ids must be a non-empty list of ids")
        dest = Path(raw_dest)
        with store().session() as conn:
            if (
                conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
                is None
            ):
                raise RpcError(NOT_FOUND, f"session not found: {session_id}")
            folders = export.source_folders(conn, session_id)
            if photo_ids is not None:
                known = {
                    str(r["id"])
                    for r in conn.execute(
                        "SELECT id FROM photos WHERE session_id = ?", (session_id,)
                    )
                }
                missing = [i for i in photo_ids if i not in known]
                if missing:
                    raise RpcError(NOT_FOUND, f"photo not in this session: {missing[0]}")
        if not dest.is_absolute() or not roots.is_allowed(dest):
            raise RpcError(PATH_NOT_ALLOWED, f"destination not allowed: {dest}")
        if any(export.is_same_or_inside(dest, folder) for folder in folders):
            raise RpcError(DEST_INSIDE_SOURCE, "the destination is inside a source folder")
        return {"job_id": exports.start(session_id, dest, options, photo_ids, library.find)}
