from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from mejores_engine import settings
from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, STORE_TOO_NEW, RpcError
from mejores_engine.store import EXPECTED_TABLES, Store, adopt_legacy_dir, data_dir


def table_names(store: Store) -> set[str]:
    with store.session() as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {str(row["name"]) for row in rows}


def test_fresh_store_creates_every_expected_table(tmp_path: Path) -> None:
    store = Store(tmp_path)
    assert set(EXPECTED_TABLES) <= table_names(store)


def test_reopening_applies_nothing_and_keeps_data(tmp_path: Path) -> None:
    first = Store(tmp_path)
    with first.session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s1', 'x', 'now')")
    versions = first.applied_versions()
    second = Store(tmp_path)
    assert second.applied_versions() == versions
    with second.session() as conn:
        assert conn.execute("SELECT count(*) AS n FROM sessions").fetchone()["n"] == 1


def test_a_database_from_a_newer_build_is_refused(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with store.session() as conn:
        conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES ('9999', 'now')")
    with pytest.raises(RpcError) as caught:
        Store(tmp_path)
    assert caught.value.code == STORE_TOO_NEW


def test_foreign_keys_are_enforced(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with pytest.raises(sqlite3.IntegrityError), store.session() as conn:
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES ('p', 'missing', 'a.jpg', 'jpg', 1, 1)"
        )


def test_deleting_a_session_cascades_to_its_photos(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with store.session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES ('p', 's', 'a.jpg', 'jpg', 1, 1)"
        )
        conn.execute("DELETE FROM sessions WHERE id = 's'")
        assert conn.execute("SELECT count(*) AS n FROM photos").fetchone()["n"] == 0


def test_data_dir_honours_the_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("MT_DATA_DIR", str(tmp_path / "custom"))
    assert data_dir() == tmp_path / "custom"


def test_theme_defaults_to_light_and_persists_dark(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path))
    first = json.loads(
        dispatcher.handle_line('{"jsonrpc":"2.0","id":1,"method":"settings_get"}') or ""
    )
    assert first["result"]["theme"] == "light"
    set_line = (
        '{"jsonrpc":"2.0","id":2,"method":"settings_set","params":{"key":"theme","value":"dark"}}'
    )
    assert json.loads(dispatcher.handle_line(set_line) or "")["result"]["value"] == "dark"
    reopened = build_dispatcher(lambda: Store(tmp_path))
    again = json.loads(
        reopened.handle_line('{"jsonrpc":"2.0","id":3,"method":"settings_get"}') or ""
    )
    assert again["result"]["theme"] == "dark"


def test_invalid_theme_is_rejected_and_not_stored(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with pytest.raises(RpcError) as caught, store.session() as conn:
        settings.set_value(conn, "theme", "blue")
    assert caught.value.code == INVALID_PARAMS
    with store.session() as conn:
        assert settings.get_all(conn)["theme"] == "light"


def test_the_old_data_folder_moves_to_the_new_name_once(tmp_path: Path) -> None:
    old, new = tmp_path / "MejoresTomas", tmp_path / "Framepicker"
    old.mkdir()
    (old / "mejores.sqlite3").write_bytes(b"data")
    assert adopt_legacy_dir(new, old) == new
    assert (new / "mejores.sqlite3").read_bytes() == b"data"
    assert not old.exists()


def test_a_new_data_folder_is_never_replaced_by_the_old_one(tmp_path: Path) -> None:
    old, new = tmp_path / "MejoresTomas", tmp_path / "Framepicker"
    old.mkdir()
    new.mkdir()
    assert adopt_legacy_dir(new, old) == new
    assert old.is_dir()
    assert adopt_legacy_dir(tmp_path / "Otra", tmp_path / "Nada") == tmp_path / "Otra"
