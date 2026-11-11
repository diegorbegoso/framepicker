"""The RPC method registry and the command line entry point. Later steps add methods here."""

from __future__ import annotations

import importlib
import io
import os
import sys
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mejores_engine import __version__, export, features, grouping, scoring, settings
from mejores_engine.analyze import ExecutorFactory, Extractor, Jobs
from mejores_engine.rpc import (
    DEST_INSIDE_SOURCE,
    INVALID_PARAMS,
    NOT_FOUND,
    PATH_NOT_ALLOWED,
    Dispatcher,
    Emitter,
    NullEmitter,
    RpcError,
    serve,
)
from mejores_engine.scan import Roots, collect, format_of
from mejores_engine.store import Store

FILES_LABEL = "Selección de archivos"


def _string_list(params: dict[str, Any], key: str) -> list[str]:
    value = params.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise RpcError(INVALID_PARAMS, f"{key} must be a list of strings")
    return list(value)


def _string_param(params: dict[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str) or not value:
        raise RpcError(INVALID_PARAMS, f"{key} must be a non-empty string")
    return value


MODEL_SIZE = 3758596


def _imports(module: str) -> bool:
    try:
        importlib.import_module(module)
    except Exception:  # noqa: BLE001 - selftest reports, it never raises
        return False
    return True


def selftest() -> dict[str, bool]:
    """Six checks a packaged engine must pass: data files present, libraries import, model loads."""
    from mejores_engine import eyes, store

    model = eyes.MODEL_PATH
    checks = {
        "migrations_present": (store.MIGRATIONS_DIR / "0001_init.sql").is_file(),
        "model_present": model.is_file() and model.stat().st_size == MODEL_SIZE,
        "rawpy_ok": _imports("rawpy"),
        "cv2_ok": _imports("cv2"),
        "mediapipe_ok": _imports("mediapipe"),
        "landmarker_loads": False,
    }
    if checks["model_present"] and checks["mediapipe_ok"]:
        try:
            import numpy as np

            eyes.score(np.full((64, 64, 3), 128, dtype=np.uint8))
            checks["landmarker_loads"] = True
        except Exception:  # noqa: BLE001 - a broken model is a failed check, not a crash
            checks["landmarker_loads"] = False
    return checks


def build_dispatcher(
    store_factory: Callable[[], Store] = Store,
    emitter: Emitter | None = None,
    executor_factory: ExecutorFactory | None = None,
    extractor: Extractor = features.extract,
) -> Dispatcher:
    dispatcher = Dispatcher()
    holder: list[Store] = []
    roots = Roots()

    def store() -> Store:
        if not holder:
            holder.append(store_factory())
        return holder[0]

    sink = emitter or NullEmitter()
    jobs = Jobs(store, sink, executor_factory, extractor)
    exports = export.Exports(store, sink)

    @dispatcher.register("analyze")
    def analyze(params: dict[str, Any]) -> dict[str, Any]:
        session_id = _string_param(params, "session_id")
        eyes = params.get("eyes", True)
        if not isinstance(eyes, bool):
            raise RpcError(INVALID_PARAMS, "eyes must be true or false")
        return {"job_id": jobs.start(session_id, eyes)}

    @dispatcher.register("cancel")
    def cancel(params: dict[str, Any]) -> dict[str, Any]:
        job_id = _string_param(params, "job_id")
        return exports.cancel(job_id) if exports.find(job_id) else jobs.cancel(job_id)

    @dispatcher.register("job_status")
    def job_status(params: dict[str, Any]) -> dict[str, Any]:
        job_id = _string_param(params, "job_id")
        found = exports.find(job_id)
        return found.status() if found else jobs.get(job_id).status()

    @dispatcher.register("export")
    def export_selection(params: dict[str, Any]) -> dict[str, Any]:
        session_id = _string_param(params, "session_id")
        dest = Path(_string_param(params, "dest"))
        with store().session() as conn:
            if (
                conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
                is None
            ):
                raise RpcError(NOT_FOUND, f"session not found: {session_id}")
            folders = export.source_folders(conn, session_id)
        if not dest.is_absolute() or not roots.is_allowed(dest):
            raise RpcError(PATH_NOT_ALLOWED, f"destination not allowed: {dest}")
        if any(export.is_same_or_inside(dest, folder) for folder in folders):
            raise RpcError(DEST_INSIDE_SOURCE, "the destination is inside a source folder")
        return {"job_id": exports.start(session_id, dest)}

    @dispatcher.register("selftest")
    def run_selftest(_params: dict[str, Any]) -> dict[str, bool]:
        return selftest()

    @dispatcher.register("ping")
    def ping(_params: dict[str, Any]) -> dict[str, Any]:
        return {"pong": True, "version": __version__}

    @dispatcher.register("version")
    def version(_params: dict[str, Any]) -> dict[str, Any]:
        return {"version": __version__}

    @dispatcher.register("settings_get")
    def settings_get(_params: dict[str, Any]) -> dict[str, Any]:
        with store().session() as conn:
            return settings.get_all(conn)

    @dispatcher.register("settings_set")
    def settings_set(params: dict[str, Any]) -> dict[str, Any]:
        key = params.get("key")
        if not isinstance(key, str) or "value" not in params:
            raise RpcError(INVALID_PARAMS, "settings_set needs key and value")
        with store().session() as conn:
            clean = settings.set_value(conn, key, params["value"])
        return {"key": key, "value": clean}

    @dispatcher.register("grant_roots")
    def grant_roots(params: dict[str, Any]) -> dict[str, Any]:
        return {"granted": roots.grant(_string_list(params, "roots"))}

    @dispatcher.register("scan")
    def scan(params: dict[str, Any]) -> dict[str, Any]:
        raw_paths = _string_list(params, "paths")
        if not raw_paths:
            raise RpcError(INVALID_PARAMS, "paths must not be empty")
        recursive = params.get("recursive", True)
        if not isinstance(recursive, bool):
            raise RpcError(INVALID_PARAMS, "recursive must be true or false")
        paths = [Path(raw) for raw in raw_paths]
        for path in paths:
            if not path.is_absolute() or not roots.is_allowed(path):
                raise RpcError(PATH_NOT_ALLOWED, f"path not allowed: {path}")
        for path in paths:
            if not path.exists():
                raise RpcError(NOT_FOUND, f"path not found: {path}")
        files, skipped = collect(paths, recursive)
        folders = [path for path in paths if path.is_dir()]
        label = folders[0].name if folders else FILES_LABEL
        session_id = str(uuid.uuid4())
        photos: list[dict[str, Any]] = []
        with store().session() as conn:
            conn.execute(
                "INSERT INTO sessions (id, label, created_at) VALUES (?, ?, ?)",
                (session_id, label, datetime.now(UTC).isoformat()),
            )
            for file in files:
                info = os.stat(file)
                photo = {
                    "id": str(uuid.uuid4()),
                    "path": str(file),
                    "format": format_of(file),
                    "size_bytes": info.st_size,
                }
                conn.execute(
                    "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        photo["id"],
                        session_id,
                        photo["path"],
                        photo["format"],
                        info.st_size,
                        info.st_mtime_ns,
                    ),
                )
                photos.append(photo)
        return {"session_id": session_id, "photos": photos, "skipped": skipped}

    @dispatcher.register("preview")
    def preview(params: dict[str, Any]) -> dict[str, Any]:
        photo_id = params.get("photo_id")
        if not isinstance(photo_id, str):
            raise RpcError(INVALID_PARAMS, "photo_id must be a string")
        max_px = params.get("max_px", 960)
        if isinstance(max_px, bool) or not isinstance(max_px, int) or not 16 <= max_px <= 8192:
            raise RpcError(INVALID_PARAMS, "max_px must be an integer from 16 to 8192")
        with store().session() as conn:
            row = conn.execute(
                "SELECT path, format FROM photos WHERE id = ?", (photo_id,)
            ).fetchone()
        if row is None:
            raise RpcError(NOT_FOUND, f"photo not found: {photo_id}")
        url = features.preview_data_url(Path(row["path"]), str(row["format"]), max_px)
        return {"data_url": url}

    @dispatcher.register("bursts")
    def bursts(params: dict[str, Any]) -> dict[str, Any]:
        session_id = _string_param(params, "session_id")
        with store().session() as conn:
            exists = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if exists is None:
                raise RpcError(NOT_FOUND, f"session not found: {session_id}")
            current = settings.get_all(conn)
            built = grouping.rebuild(
                conn, session_id, float(current["time_gap_s"]), int(current["hamming_max"])
            )
        return {"bursts": built}

    @dispatcher.register("select")
    def select(params: dict[str, Any]) -> dict[str, Any]:
        session_id = _string_param(params, "session_id")
        with store().session() as conn:
            exists = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if exists is None:
                raise RpcError(NOT_FOUND, f"session not found: {session_id}")
            chosen = scoring.select_session(conn, session_id, settings.get_all(conn))
        return {"bursts": chosen}

    @dispatcher.register("set_pick")
    def set_pick(params: dict[str, Any]) -> dict[str, Any]:
        burst_id = _string_param(params, "burst_id")
        photo_id = _string_param(params, "photo_id")
        selected = params.get("selected")
        if not isinstance(selected, bool):
            raise RpcError(INVALID_PARAMS, "selected must be true or false")
        with store().session() as conn:
            scoring.set_pick(conn, burst_id, photo_id, selected)
        return {"burst_id": burst_id, "photo_id": photo_id, "selected": selected, "source": "user"}

    return dispatcher


def use_utf8_stdio() -> None:
    """Speak UTF-8 on stdio, as the shell does.

    Windows opens pipes with the ANSI code page (cp1252 on a Spanish system), which turns "AÑO"
    into mojibake and breaks every path that has an accent or an eñe.
    """
    for stream, errors in (
        (sys.stdin, "replace"),
        (sys.stdout, "backslashreplace"),
        (sys.stderr, "replace"),
    ):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors=errors)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args == ["--version"]:
        print(f"mejores-engine {__version__}")
        return 0
    if args:
        print("unknown arguments: " + " ".join(args), file=sys.stderr)
        return 2
    use_utf8_stdio()
    emitter = Emitter(sys.stdout)
    serve(build_dispatcher(emitter=emitter), sys.stdin, emitter)
    return 0
