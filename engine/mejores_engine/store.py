"""The local SQLite store and its forward-only migration runner."""

from __future__ import annotations

import os
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from mejores_engine.rpc import STORE_TOO_NEW, RpcError

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")

EXPECTED_TABLES = (
    "settings",
    "sessions",
    "photos",
    "scores",
    "bursts",
    "burst_members",
    "selections",
    "schema_migrations",
    "feature_cache",
    "luts",
    "organize_batches",
    "organize_moves",
)


def data_dir() -> Path:
    """Where the engine keeps its database and caches. MT_DATA_DIR overrides the default."""
    override = os.environ.get("MT_DATA_DIR")
    if override:
        return Path(override)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "MejoresTomas"
    return Path.home() / ".mejores-tomas"


def migration_files() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = _MIGRATION_NAME.match(path.name)
        if match is None:
            raise ValueError(f"bad migration file name: {path.name}")
        found.append((match.group(1), path))
    return found


class Store:
    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory if directory is not None else data_dir()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "mejores.sqlite3"
        with self.session() as conn:
            self._migrate(conn)

    def _open(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @contextmanager
    def session(self) -> Iterator[sqlite3.Connection]:
        """A short-lived connection. Commits on success, rolls back on error, always closes."""
        conn = self._open()
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def applied_versions(self) -> list[str]:
        with self.session() as conn:
            rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        return [str(row["version"]) for row in rows]

    def _migrate(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        conn.commit()
        known = migration_files()
        known_versions = {version for version, _ in known}
        applied = {
            str(row["version"])
            for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
        }
        unknown = sorted(applied - known_versions)
        if unknown:
            raise RpcError(
                STORE_TOO_NEW,
                "the database was written by a newer version of Mejores Tomas",
                {"versions": unknown},
            )
        for version, path in known:
            if version in applied:
                continue
            script = (
                "BEGIN;\n"
                + path.read_text(encoding="utf-8")
                + "\nINSERT INTO schema_migrations (version, applied_at) "
                f"VALUES ('{version}', datetime('now'));\nCOMMIT;\n"
            )
            conn.executescript(script)
