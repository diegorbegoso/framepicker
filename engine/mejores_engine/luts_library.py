"""The LUTs the person loaded. Each one is copied into the app's data folder, so it stays in the
program and never has to be picked again; the photos' folders are not touched.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mejores_engine.luts import MAX_BYTES, Lut, parse_cube
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, PATH_NOT_ALLOWED, Dispatcher, RpcError
from mejores_engine.scan import Roots
from mejores_engine.store import Store

MAX_BATCH = 500


def _digest(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8"), usedforsecurity=False).hexdigest()


class LutLibrary:
    def __init__(self, store: Callable[[], Store]) -> None:
        self._store = store
        self._parsed: dict[str, Lut] = {}

    @property
    def folder(self) -> Path:
        folder = self._store().directory / "luts"
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def entries(self) -> list[dict[str, Any]]:
        with self._store().session() as conn:
            rows = conn.execute(
                "SELECT id, name, size FROM luts ORDER BY added_at, name"
            ).fetchall()
        return [{"id": str(r["id"]), "name": str(r["name"]), "size": int(r["size"])} for r in rows]

    @staticmethod
    def _read(source: Path) -> tuple[str, Lut]:
        """The text of a `.cube` file and its parsed LUT, or INVALID_PARAMS / NOT_FOUND."""
        if source.suffix.lower() != ".cube":
            raise RpcError(INVALID_PARAMS, "a LUT must be a .cube file")
        if not source.is_file():
            raise RpcError(NOT_FOUND, f"file not found: {source}")
        if source.stat().st_size > MAX_BYTES:
            raise RpcError(INVALID_PARAMS, "the LUT file is too large")
        text = source.read_text(encoding="utf-8", errors="replace")
        return text, parse_cube(text)  # refuses a bad file before anything is stored

    def _save(self, source: Path, text: str, lut: Lut) -> dict[str, Any]:
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

    def add(self, source: Path) -> dict[str, Any]:
        text, lut = self._read(source)
        return self._save(source, text, lut)

    def _known_contents(self) -> dict[str, str]:
        """SHA-1 of every LUT already stored, with its name, to recognise a repeated one."""
        known: dict[str, str] = {}
        with self._store().session() as conn:
            rows = conn.execute("SELECT name, filename FROM luts").fetchall()
        for row in rows:
            try:
                data = (self.folder / str(row["filename"])).read_bytes()
            except OSError:
                continue
            # The stored copy may use Windows line ends: compare the text, not the bytes.
            text = data.decode("utf-8", errors="replace").replace(chr(13) + chr(10), chr(10))
            known[_digest(text)] = str(row["name"])
        return known

    def add_many(self, sources: list[Path]) -> dict[str, Any]:
        """Load several LUTs; one that is broken or already there does not stop the others."""
        known = self._known_contents()
        added: list[dict[str, Any]] = []
        duplicates: list[dict[str, str]] = []
        failed: list[dict[str, str]] = []
        for source in sources:
            try:
                text, lut = self._read(source)
                digest = _digest(text)
                if digest in known:
                    duplicates.append({"path": str(source), "name": known[digest]})
                    continue
                entry = self._save(source, text, lut)
            except (RpcError, OSError) as exc:
                message = exc.message if isinstance(exc, RpcError) else str(exc)
                failed.append({"path": str(source), "message": message})
                continue
            known[digest] = entry["name"]
            added.append(entry)
        return {"added": added, "duplicates": duplicates, "failed": failed}

    def add_folder(self, folder: Path) -> dict[str, Any]:
        """Load every `.cube` file directly inside a folder."""
        if not folder.is_dir():
            raise RpcError(NOT_FOUND, f"folder not found: {folder}")
        files = sorted(
            (f for f in folder.iterdir() if f.is_file() and f.suffix.lower() == ".cube"),
            key=lambda f: f.name.lower(),
        )
        return self.add_many(files[:MAX_BATCH])

    def remove(self, lut_id: str) -> None:
        with self._store().session() as conn:
            row = conn.execute("SELECT filename FROM luts WHERE id = ?", (lut_id,)).fetchone()
            if row is None:
                raise RpcError(NOT_FOUND, f"LUT not found: {lut_id}")
            conn.execute("DELETE FROM luts WHERE id = ?", (lut_id,))
        (self.folder / str(row["filename"])).unlink(missing_ok=True)
        self._parsed.pop(lut_id, None)

    def find(self, lut_id: str) -> Lut | None:
        """The LUT, or None when it is no longer in the library (a correction may outlive it)."""
        try:
            return self.get(lut_id)
        except RpcError:
            return None

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
        return {"luts": library.entries()}

    def allowed(raw: Any) -> Path:
        if not isinstance(raw, str) or not raw:
            raise RpcError(INVALID_PARAMS, "a path must be a non-empty string")
        path = Path(raw)
        if not path.is_absolute() or not roots.is_allowed(path):
            raise RpcError(PATH_NOT_ALLOWED, f"path not allowed: {path}")
        return path

    @dispatcher.register("luts_add")
    def luts_add(params: dict[str, Any]) -> dict[str, Any]:
        return library.add(allowed(params.get("path")))

    @dispatcher.register("luts_add_many")
    def luts_add_many(params: dict[str, Any]) -> dict[str, Any]:
        raw = params.get("paths")
        if not isinstance(raw, list) or not raw or len(raw) > MAX_BATCH:
            raise RpcError(INVALID_PARAMS, f"paths must be a list of 1 to {MAX_BATCH} paths")
        return library.add_many([allowed(item) for item in raw])

    @dispatcher.register("luts_add_folder")
    def luts_add_folder(params: dict[str, Any]) -> dict[str, Any]:
        return library.add_folder(allowed(params.get("path")))

    @dispatcher.register("luts_remove")
    def luts_remove(params: dict[str, Any]) -> dict[str, Any]:
        lut_id = params.get("lut_id")
        if not isinstance(lut_id, str) or not lut_id:
            raise RpcError(INVALID_PARAMS, "lut_id must be a non-empty string")
        library.remove(lut_id)
        return {"lut_id": lut_id}
