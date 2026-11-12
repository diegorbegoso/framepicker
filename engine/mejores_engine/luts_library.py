"""The LUTs the person loaded. Each one is copied into the app's data folder, so it stays in the
program and never has to be picked again; the photos' folders are not touched.

A LUT is named after its file (the `TITLE` inside the file is often the same in every file of a
generator), and one imported from a folder is kept in a group named like that folder.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mejores_engine.luts import MAX_BYTES, Lut, parse_cube
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, RpcError
from mejores_engine.store import Store

MAX_BATCH = 500
MAX_NAME = 80
MAX_GROUP = 60


def _digest(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def clean_name(value: Any, limit: int = MAX_NAME, *, what: str = "name") -> str:
    if not isinstance(value, str):
        raise RpcError(INVALID_PARAMS, f"{what} must be text")
    text = " ".join(value.split())
    if not text or len(text) > limit:
        raise RpcError(INVALID_PARAMS, f"{what} must be 1 to {limit} characters")
    return text


def clean_group(value: Any) -> str | None:
    """A group name, or None for "no group" (null or an empty string)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return clean_name(value, MAX_GROUP, what="group")


@dataclass
class Known:
    """A LUT already in the library, found by its content."""

    lut_id: str
    name: str
    source_name: str | None
    group: str | None


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
                "SELECT id, name, size, group_name, favorite FROM luts ORDER BY added_at, name"
            ).fetchall()
        return [
            {
                "id": str(r["id"]),
                "name": str(r["name"]),
                "size": int(r["size"]),
                "group": r["group_name"],
                "favorite": bool(r["favorite"]),
            }
            for r in rows
        ]

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

    def _save(self, source: Path, text: str, lut: Lut, group: str | None) -> dict[str, Any]:
        lut_id = str(uuid.uuid4())
        filename = f"{lut_id}.cube"
        (self.folder / filename).write_text(text, encoding="utf-8")
        name = source.stem[:MAX_NAME] or "LUT"
        with self._store().session() as conn:
            conn.execute(
                "INSERT INTO luts (id, name, size, filename, added_at, group_name, source_name) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (lut_id, name, lut.size, filename, datetime.now(UTC).isoformat(), group, name),
            )
        self._parsed[lut_id] = lut
        return {"id": lut_id, "name": name, "size": lut.size, "group": group, "favorite": False}

    def add(self, source: Path, group: str | None = None) -> dict[str, Any]:
        text, lut = self._read(source)
        return self._save(source, text, lut, group)

    def _known_contents(self) -> dict[str, Known]:
        """SHA-1 of every LUT already stored, to recognise a repeated one."""
        known: dict[str, Known] = {}
        with self._store().session() as conn:
            rows = conn.execute(
                "SELECT id, name, source_name, group_name, filename FROM luts"
            ).fetchall()
        for row in rows:
            try:
                data = (self.folder / str(row["filename"])).read_bytes()
            except OSError:
                continue
            # The stored copy may use Windows line ends: compare the text, not the bytes.
            text = data.decode("utf-8", errors="replace").replace(chr(13) + chr(10), chr(10))
            known[_digest(text)] = Known(
                str(row["id"]), str(row["name"]), row["source_name"], row["group_name"]
            )
        return known

    def _refresh(self, found: Known, source: Path, group: str | None) -> bool:
        """Give a repeated LUT the name of its file and the group it came in, unless the person
        already chose a name of their own. Returns whether anything changed."""
        auto_named = found.source_name is None or found.name == found.source_name
        name = source.stem[:MAX_NAME] or found.name
        new_name = name if auto_named else found.name
        new_group = group if group is not None else found.group
        if (new_name, new_group) == (found.name, found.group):
            return False
        with self._store().session() as conn:
            conn.execute(
                "UPDATE luts SET name = ?, group_name = ?, source_name = ? WHERE id = ?",
                (new_name, new_group, name, found.lut_id),
            )
        found.name, found.group, found.source_name = new_name, new_group, name
        return True

    def add_many(self, sources: list[Path], group: str | None = None) -> dict[str, Any]:
        """Load several LUTs; one that is broken or already there does not stop the others."""
        known = self._known_contents()
        added: list[dict[str, Any]] = []
        duplicates: list[dict[str, Any]] = []
        failed: list[dict[str, str]] = []
        seen: set[str] = set()  # LUTs named by this very call: a second copy must not rename them
        for source in sources:
            try:
                text, lut = self._read(source)
                digest = _digest(text)
                if digest in known:
                    found = known[digest]
                    renamed = found.lut_id not in seen and self._refresh(found, source, group)
                    seen.add(found.lut_id)
                    duplicates.append(
                        {"path": str(source), "name": known[digest].name, "renamed": renamed}
                    )
                    continue
                entry = self._save(source, text, lut, group)
            except (RpcError, OSError) as exc:
                message = exc.message if isinstance(exc, RpcError) else str(exc)
                failed.append({"path": str(source), "message": message})
                continue
            known[digest] = Known(entry["id"], entry["name"], entry["name"], group)
            seen.add(entry["id"])
            added.append(entry)
        return {"added": added, "duplicates": duplicates, "failed": failed}

    def add_folder(self, folder: Path) -> dict[str, Any]:
        """Load every `.cube` file directly inside a folder, as a group named like the folder."""
        if not folder.is_dir():
            raise RpcError(NOT_FOUND, f"folder not found: {folder}")
        files = sorted(
            (f for f in folder.iterdir() if f.is_file() and f.suffix.lower() == ".cube"),
            key=lambda f: f.name.lower(),
        )
        return self.add_many(files[:MAX_BATCH], clean_group(folder.name))

    def update(self, lut_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        sets: list[str] = []
        values: list[Any] = []
        if "name" in changes:
            sets.append("name = ?")
            values.append(clean_name(changes["name"]))
        if "group" in changes:
            sets.append("group_name = ?")
            values.append(clean_group(changes["group"]))
        if "favorite" in changes:
            if not isinstance(changes["favorite"], bool):
                raise RpcError(INVALID_PARAMS, "favorite must be true or false")
            sets.append("favorite = ?")
            values.append(int(changes["favorite"]))
        if not sets:
            raise RpcError(INVALID_PARAMS, "nothing to change: give name, group or favorite")
        with self._store().session() as conn:
            if conn.execute("SELECT 1 FROM luts WHERE id = ?", (lut_id,)).fetchone() is None:
                raise RpcError(NOT_FOUND, f"LUT not found: {lut_id}")
            conn.execute(f"UPDATE luts SET {', '.join(sets)} WHERE id = ?", [*values, lut_id])  # noqa: S608
        return next(entry for entry in self.entries() if entry["id"] == lut_id)

    def rename_group(self, old: str, new: Any) -> int:
        target = clean_group(new)
        with self._store().session() as conn:
            moved = conn.execute(
                "UPDATE luts SET group_name = ? WHERE group_name = ?", (target, old)
            )
        return int(moved.rowcount)

    def remove_group(self, group: str) -> int:
        with self._store().session() as conn:
            rows = conn.execute(
                "SELECT id, filename FROM luts WHERE group_name = ?", (group,)
            ).fetchall()
            conn.execute("DELETE FROM luts WHERE group_name = ?", (group,))
        for row in rows:
            (self.folder / str(row["filename"])).unlink(missing_ok=True)
            self._parsed.pop(str(row["id"]), None)
        return len(rows)

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
