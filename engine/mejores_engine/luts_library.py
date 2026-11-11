"""The LUTs the person loaded. Each one is copied into the app's data folder, so it stays in the
program and never has to be picked again; the photos' folders are not touched.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mejores_engine.luts import MAX_BYTES, Lut, parse_cube
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, PATH_NOT_ALLOWED, Dispatcher, RpcError
from mejores_engine.scan import Roots
from mejores_engine.store import Store


class LutLibrary:
    def __init__(self, store: Callable[[], Store]) -> None:
        self._store = store
        self._parsed: dict[str, Lut] = {}

    @property
    def folder(self) -> Path:
        folder = self._store().directory / "luts"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def list(self) -> list[dict[str, Any]]:
        with self._store().session() as conn:
            rows = conn.execute(
                "SELECT id, name, size FROM luts ORDER BY added_at, name"
            ).fetchall()
        return [{"id": str(r["id"]), "name": str(r["name"]), "size": int(r["size"])} for r in rows]

    def add(self, source: Path) -> dict[str, Any]:
        if source.suffix.lower() != ".cube":
            raise RpcError(INVALID_PARAMS, "a LUT must be a .cube file")
        if not source.is_file():
            raise RpcError(NOT_FOUND, f"file not found: {source}")
        if source.stat().st_size > MAX_BYTES:
            raise RpcError(INVALID_PARAMS, "the LUT file is too large")
        text = source.read_text(encoding="utf-8", errors="replace")
        lut = parse_cube(text)  # refuses a bad file before anything is stored
        lut_id = str(uuid.uuid4())
        filename = f"{lut_id}.cube"
        (self.folder / filename).write_text(text, encoding="utf-8")
        name = lut.title if lut.title != "LUT" else source.stem
        with self._store().session() as conn:
            conn.execute(
                "INSERT INTO luts (id, name, size, filename, added_at) VALUES (?, ?, ?, ?, ?)",
                (lut_id, name, lut.size, filename, datetime.now(UTC).isoformat()),
            )
        self._parsed[lut_id] = lut
        return {"id": lut_id, "name": name, "size": lut.size}

    def remove(self, lut_id: str) -> None:
        with self._store().session() as conn:
            row = conn.execute("SELECT filename FROM luts WHERE id = ?", (lut_id,)).fetchone()
            if row is None:
                raise RpcError(NOT_FOUND, f"LUT not found: {lut_id}")
            conn.execute("DELETE FROM luts WHERE id = ?", (lut_id,))
        (self.folder / str(row["filename"])).unlink(missing_ok=True)
        self._parsed.pop(lut_id, None)

    def get(self, lut_id: str) -> Lut:
        cached = self._parsed.get(lut_id)
        if cached is not None:
            return cached
        with self._store().session() as conn:
            row = conn.execute("SELECT filename FROM luts WHERE id = ?", (lut_id,)).fetchone()
        if row is None:
            raise RpcError(NOT_FOUND, f"LUT not found: {lut_id}")
        lut = parse_cube((self.folder / str(row["filename"])).read_text(encoding="utf-8"))
        self._parsed[lut_id] = lut
        return lut


def register(dispatcher: Dispatcher, library: LutLibrary, roots: Roots) -> None:
    @dispatcher.register("luts_list")
    def luts_list(_params: dict[str, Any]) -> dict[str, Any]:
        return {"luts": library.list()}

    @dispatcher.register("luts_add")
    def luts_add(params: dict[str, Any]) -> dict[str, Any]:
        raw = params.get("path")
        if not isinstance(raw, str) or not raw:
            raise RpcError(INVALID_PARAMS, "path must be a non-empty string")
        path = Path(raw)
        if not path.is_absolute() or not roots.is_allowed(path):
            raise RpcError(PATH_NOT_ALLOWED, f"path not allowed: {path}")
        return library.add(path)

    @dispatcher.register("luts_remove")
    def luts_remove(params: dict[str, Any]) -> dict[str, Any]:
        lut_id = params.get("lut_id")
        if not isinstance(lut_id, str) or not lut_id:
            raise RpcError(INVALID_PARAMS, "lut_id must be a non-empty string")
        library.remove(lut_id)
        return {"lut_id": lut_id}
