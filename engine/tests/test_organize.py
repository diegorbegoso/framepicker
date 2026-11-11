"""Organise in place: chosen photos stay, the rest move into a subfolder, and it can be undone."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, PATH_NOT_ALLOWED, Dispatcher
from mejores_engine.store import Store


def snapshot(folder: Path) -> dict[str, str]:
    """Every file under a folder with its hash: proof that nothing was lost or changed."""
    return {
        str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(folder.rglob("*"))
        if p.is_file()
    }


class Shoot:
    """A granted folder with files, one scanned session, and a chosen subset selected."""

    def __init__(
        self, tmp_path: Path, files: list[str], chosen: list[str], grant: bool = True
    ) -> None:
        self.folder = tmp_path / "boda"
        for seed, name in enumerate(files):
            path = self.folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(hashlib.sha256(str(seed).encode()).digest() * 50)
        self.data = tmp_path / "data"
        self.dispatcher: Dispatcher = build_dispatcher(lambda: Store(self.data))
        if grant:
            self.ok("grant_roots", {"roots": [str(self.folder)]})
        scanned = self.ok("scan", {"paths": [str(self.folder)]}) if grant else self._scan_anyway()
        self.session_id = scanned["session_id"]
        with Store(self.data).session() as conn:
            conn.execute(
                "INSERT INTO bursts (id, session_id, position) VALUES ('b', ?, 0)",
                (self.session_id,),
            )
            for position, photo in enumerate(scanned["photos"]):
                relative = Path(photo["path"]).relative_to(self.folder).as_posix()
                conn.execute(
                    "INSERT INTO burst_members VALUES ('b', ?, ?)", (photo["id"], position)
                )
                conn.execute(
                    "INSERT INTO selections VALUES ('b', ?, 'auto', ?)",
                    (photo["id"], int(relative in chosen)),
                )

    def _scan_anyway(self) -> dict[str, Any]:
        self.ok("grant_roots", {"roots": [str(self.folder)]})
        return self.ok("scan", {"paths": [str(self.folder)]})

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        reply: dict[str, Any] = json.loads(self.dispatcher.handle_line(line) or "")
        return reply

    def ok(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        reply = self.call(method, params)
        assert "error" not in reply, reply
        return reply["result"]  # type: ignore[no-any-return]

    def organize(self, **extra: Any) -> dict[str, Any]:
        return self.ok("organize_apply", {"session_id": self.session_id, **extra})

    def paths(self) -> dict[str, str]:
        with Store(self.data).session() as conn:
            rows = conn.execute("SELECT id, path FROM photos").fetchall()
        return {str(r["id"]): str(r["path"]) for r in rows}


FILES = ["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg", "IMG_4.jpg"]


def test_the_chosen_stay_and_the_rest_move_to_a_subfolder(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES, ["IMG_2.jpg", "IMG_4.jpg"])
    before = snapshot(shoot.folder)
    result = shoot.organize()
    assert (result["moved"], result["failed"]) == (2, 0)
    assert sorted(p.name for p in shoot.folder.iterdir() if p.is_file()) == [
        "IMG_2.jpg",
        "IMG_4.jpg",
    ]
    moved = shoot.folder / "No elegidas"
    assert sorted(p.name for p in moved.iterdir()) == ["IMG_1.jpg", "IMG_3.jpg"]
    # Nothing lost, nothing changed: the same bytes, only in other places.
    after = snapshot(shoot.folder)
    assert sorted(after.values()) == sorted(before.values())


def test_the_preview_changes_nothing_and_counts_what_would_happen(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES, ["IMG_1.jpg"])
    before = snapshot(shoot.folder)
    summary = shoot.ok("organize_preview", {"session_id": shoot.session_id})
    assert (summary["to_move"], summary["kept"]) == (3, 1)
    assert summary["folders"] == [str(shoot.folder / "No elegidas")]
    assert snapshot(shoot.folder) == before
    assert not (shoot.folder / "No elegidas").exists()


def test_a_sidecar_travels_with_its_photo(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, ["A.jpg", "A.xmp", "B.jpg", "B.xmp"], ["B.jpg"])
    shoot.organize()
    assert sorted(p.name for p in (shoot.folder / "No elegidas").iterdir()) == ["A.jpg", "A.xmp"]
    assert sorted(p.name for p in shoot.folder.iterdir() if p.is_file()) == ["B.jpg", "B.xmp"]


def test_a_raw_and_jpeg_pair_stays_together_when_either_is_chosen(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, ["P1.ARW", "P1.jpg", "P2.ARW", "P2.jpg"], ["P1.jpg"])
    summary = shoot.ok("organize_preview", {"session_id": shoot.session_id})
    assert (summary["to_move"], summary["kept_paired"]) == (2, 1)
    shoot.organize()
    kept = sorted(p.name for p in shoot.folder.iterdir() if p.is_file())
    assert kept == ["P1.ARW", "P1.jpg"]


def test_nothing_is_overwritten_when_the_subfolder_already_has_the_name(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES[:2], ["IMG_2.jpg"], grant=True)
    existing = shoot.folder / "No elegidas" / "IMG_1.jpg"
    existing.parent.mkdir()
    existing.write_bytes(b"do not touch")
    shoot.organize()
    assert existing.read_bytes() == b"do not touch"
    assert (shoot.folder / "No elegidas" / "IMG_1_1.jpg").is_file()


def test_the_database_follows_the_files(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES[:2], ["IMG_2.jpg"])
    shoot.organize()
    paths = sorted(Path(p).relative_to(shoot.folder).as_posix() for p in shoot.paths().values())
    assert paths == ["IMG_2.jpg", "No elegidas/IMG_1.jpg"]
    # An export afterwards still finds the chosen photo where it is.
    dest = tmp_path / "salida"
    dest.mkdir()
    shoot.ok("grant_roots", {"roots": [str(dest)]})
    job = shoot.ok("export", {"session_id": shoot.session_id, "dest": str(dest)})["job_id"]
    assert job


def test_undo_puts_everything_back_and_removes_the_empty_subfolder(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, ["A.jpg", "A.xmp", "B.jpg", "C.jpg"], ["B.jpg"])
    before = snapshot(shoot.folder)
    batch = shoot.organize()["batch_id"]
    undone = shoot.ok("organize_undo", {"batch_id": batch})
    assert (undone["restored"], undone["skipped"]) == (3, 0)
    assert snapshot(shoot.folder) == before
    assert not (shoot.folder / "No elegidas").exists()
    assert sorted(Path(p).name for p in shoot.paths().values()) == ["A.jpg", "B.jpg", "C.jpg"]
    again = shoot.call("organize_undo", {"batch_id": batch})
    assert again["error"]["code"] == INVALID_PARAMS


def test_undo_leaves_a_file_it_cannot_restore_and_never_overwrites(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, ["A.jpg", "B.jpg"], ["B.jpg"])
    batch = shoot.organize()["batch_id"]
    (shoot.folder / "A.jpg").write_bytes(b"new file with the old name")
    undone = shoot.ok("organize_undo", {"batch_id": batch})
    assert (undone["restored"], undone["skipped"]) == (0, 1)
    assert (shoot.folder / "A.jpg").read_bytes() == b"new file with the old name"
    assert (shoot.folder / "No elegidas" / "A.jpg").is_file()


def test_a_file_that_vanished_is_reported_and_the_rest_still_move(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES[:3], ["IMG_3.jpg"])
    (shoot.folder / "IMG_1.jpg").unlink()
    result = shoot.organize()
    assert (result["moved"], result["failed"]) == (1, 1)
    assert result["errors"][0]["path"].endswith("IMG_1.jpg")
    assert (shoot.folder / "No elegidas" / "IMG_2.jpg").is_file()


def test_photos_in_subfolders_get_a_subfolder_each_and_the_organised_ones_are_skipped(
    tmp_path: Path,
) -> None:
    files = ["a/X.jpg", "a/Y.jpg", "b/Z.jpg", "b/No elegidas/old.jpg"]
    shoot = Shoot(tmp_path, files, ["a/X.jpg"])
    summary = shoot.ok("organize_preview", {"session_id": shoot.session_id})
    assert (summary["to_move"], summary["already"]) == (2, 1)
    shoot.organize()
    assert (shoot.folder / "a" / "No elegidas" / "Y.jpg").is_file()
    assert (shoot.folder / "b" / "No elegidas" / "Z.jpg").is_file()
    assert (shoot.folder / "b" / "No elegidas" / "old.jpg").is_file()
    assert not (shoot.folder / "b" / "No elegidas" / "No elegidas").exists()


def test_a_custom_folder_name_is_used_and_validated(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES[:2], ["IMG_1.jpg"])
    for bad in ("", "  ", "..", "a/b", "x:y", "fin.", "n" * 61, 5):
        reply = shoot.call("organize_apply", {"session_id": shoot.session_id, "folder_name": bad})
        assert reply["error"]["code"] == INVALID_PARAMS, bad
    assert snapshot(shoot.folder).keys() == {"IMG_1.jpg", "IMG_2.jpg"}
    shoot.organize(folder_name="Descartes")
    assert (shoot.folder / "Descartes" / "IMG_2.jpg").is_file()


def test_everything_stays_when_all_are_chosen(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES[:2], FILES[:2])
    result = shoot.organize()
    assert result["moved"] == 0
    assert not (shoot.folder / "No elegidas").exists()


def test_photos_outside_the_granted_folders_are_refused_before_anything_moves(
    tmp_path: Path,
) -> None:
    shoot = Shoot(tmp_path, FILES[:2], ["IMG_1.jpg"])
    other = build_dispatcher(lambda: Store(shoot.data))  # a new run: nothing granted yet
    line = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "organize_apply",
            "params": {"session_id": shoot.session_id},
        }
    )
    reply = json.loads(other.handle_line(line) or "")
    assert reply["error"]["code"] == PATH_NOT_ALLOWED
    assert sorted(p.name for p in shoot.folder.iterdir()) == ["IMG_1.jpg", "IMG_2.jpg"]


def test_unknown_session_and_batch_are_not_found(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, FILES[:1], FILES[:1])
    assert shoot.call("organize_apply", {"session_id": "nope"})["error"]["code"] == NOT_FOUND
    assert shoot.call("organize_preview", {"session_id": "nope"})["error"]["code"] == NOT_FOUND
    assert shoot.call("organize_undo", {"batch_id": "nope"})["error"]["code"] == NOT_FOUND


@pytest.mark.parametrize("method", ["organize_preview", "organize_apply"])
def test_session_id_is_required(tmp_path: Path, method: str) -> None:
    shoot = Shoot(tmp_path, FILES[:1], FILES[:1])
    assert shoot.call(method, {})["error"]["code"] == INVALID_PARAMS


def test_with_unicode_names_and_folders(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path, ["Niño año.jpg", "Camión.jpg"], ["Camión.jpg"])
    shoot.organize(folder_name="Descartadas ñ")
    assert (shoot.folder / "Descartadas ñ" / "Niño año.jpg").is_file()
