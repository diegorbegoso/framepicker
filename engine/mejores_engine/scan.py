"""Granted roots and folder scanning. The engine only reads folders the person picked."""

from __future__ import annotations

import os
import re
from collections.abc import Iterable
from pathlib import Path

from mejores_engine.rpc import INVALID_PARAMS, RpcError

SUPPORTED: dict[str, str] = {
    ".jpg": "jpg",
    ".jpeg": "jpg",
    ".png": "png",
    ".arw": "raw",
    ".cr2": "raw",
    ".cr3": "raw",
    ".nef": "raw",
    ".nrw": "raw",
    ".dng": "raw",
    ".raf": "raw",
    ".orf": "raw",
    ".rw2": "raw",
    ".pef": "raw",
    ".srw": "raw",
}

_DIGITS = re.compile(r"(\d+)")


def format_of(path: Path) -> str | None:
    """The stored format for a supported file, or None when the extension is not supported."""
    return SUPPORTED.get(path.suffix.lower())


def _canonical(path: Path) -> Path:
    """Absolute, symlink-free, case-normalised form used for every containment check."""
    return Path(os.path.normcase(path.resolve()))


def natural_key(path: Path) -> list[tuple[int, str]]:
    """Sort key that compares digit runs as numbers, so IMG_2 sorts before IMG_10."""
    key: list[tuple[int, str]] = []
    for chunk in _DIGITS.split(str(path).lower()):
        if chunk.isdigit():
            key.append((int(chunk), ""))
        else:
            key.append((0, chunk))
    return key


class Roots:
    """The folders the person granted through the native dialog. Held in memory only."""

    def __init__(self) -> None:
        self._roots: list[Path] = []

    def grant(self, paths: list[str]) -> int:
        """Grant every path or none: each must be an absolute path that exists."""
        clean: list[Path] = []
        for raw in paths:
            if not raw:
                raise RpcError(INVALID_PARAMS, "every root must be a non-empty string")
            path = Path(raw)
            if not path.is_absolute():
                raise RpcError(INVALID_PARAMS, f"root must be an absolute path: {raw}")
            if not path.exists():
                raise RpcError(INVALID_PARAMS, f"root does not exist: {raw}")
            clean.append(_canonical(path))
        for root in clean:
            if root not in self._roots:
                self._roots.append(root)
        return len(clean)

    def is_allowed(self, path: Path) -> bool:
        target = _canonical(path)
        return any(target.is_relative_to(root) for root in self._roots)


def _is_inside(path: Path, folder: Path) -> bool:
    return _canonical(path).is_relative_to(_canonical(folder))


def _walk(folder: Path, recursive: bool) -> Iterable[Path]:
    if not recursive:
        yield from folder.iterdir()
        return
    for current, dirs, files in os.walk(folder, followlinks=False):
        dirs.sort()
        for name in files:
            yield Path(current) / name


def collect(paths: list[Path], recursive: bool) -> tuple[list[Path], int]:
    """Supported files under `paths` in natural order, plus how many files were skipped.

    Folders are walked (into subfolders unless `recursive` is false); loose files are taken as
    given. A symbolic link that points outside the folder being walked is ignored.
    """
    found: dict[Path, Path] = {}
    skipped = 0

    def consider(candidate: Path) -> None:
        nonlocal skipped
        if format_of(candidate) is None:
            skipped += 1
            return
        found.setdefault(_canonical(candidate), candidate)

    for path in paths:
        if path.is_dir():
            for entry in _walk(path, recursive):
                if entry.is_symlink() and not _is_inside(entry, path):
                    continue
                if entry.is_file():
                    consider(entry)
        elif path.is_file():
            consider(path)
    return sorted(found.values(), key=natural_key), skipped
