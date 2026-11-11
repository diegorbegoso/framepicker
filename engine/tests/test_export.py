from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from mejores_engine.app import build_dispatcher
from mejores_engine.export import plan
from mejores_engine.rpc import DEST_INSIDE_SOURCE, NOT_FOUND, PATH_NOT_ALLOWED, Dispatcher
from mejores_engine.store import Store


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path: Path, seed: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(hashlib.sha256(str(seed).encode()).digest() * (64 + seed))
    return path


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def ok(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    reply = call(dispatcher, method, params)
    assert "error" not in reply, reply
    return reply["result"]  # type: ignore[no-any-return]


class Setup:
    """A granted source and destination, one scanned session, and a chosen subset selected."""

    def __init__(self, tmp_path: Path, names: list[str], chosen: list[str]) -> None:
        self.source = tmp_path / "fuente"
        self.dest = tmp_path / "destino"
        self.dest.mkdir()
        for seed, name in enumerate(names):
            write(self.source / name, seed)
        data = tmp_path / "data"
        self.dispatcher = build_dispatcher(lambda: Store(data))
        ok(self.dispatcher, "grant_roots", {"roots": [str(self.source), str(self.dest)]})
        scanned = ok(self.dispatcher, "scan", {"paths": [str(self.source)]})
        self.session_id = scanned["session_id"]
        with Store(data).session() as conn:
            conn.execute(
                "INSERT INTO bursts (id, session_id, position) VALUES ('b', ?, 0)",
                (self.session_id,),
            )
            for position, photo in enumerate(scanned["photos"]):
                conn.execute(
                    "INSERT INTO burst_members (burst_id, photo_id, position) VALUES ('b', ?, ?)",
                    (photo["id"], position),
                )
                relative = Path(photo["path"]).relative_to(self.source).as_posix()
                conn.execute(
                    "INSERT INTO selections (burst_id, photo_id, source, selected) "
                    "VALUES ('b', ?, 'auto', ?)",
                    (photo["id"], int(relative in chosen)),
                )

    def export(self, dest: Path | None = None) -> dict[str, Any]:
        target = str(dest or self.dest)
        return call(self.dispatcher, "export", {"session_id": self.session_id, "dest": target})

    def finish(self) -> dict[str, Any]:
        job_id = self.export()["result"]["job_id"]
        deadline = time.monotonic() + 30
        while True:
            status = ok(self.dispatcher, "job_status", {"job_id": job_id})
            if status["state"] != "running":
                return status
            assert time.monotonic() < deadline
            time.sleep(0.02)

    def exported(self) -> list[str]:
        return sorted(path.name for path in self.dest.iterdir())


def test_selected_photos_are_copied_byte_for_byte(tmp_path: Path) -> None:
    names = ["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg", "IMG_4.jpg"]
    setup = Setup(tmp_path, names, ["IMG_1.jpg", "IMG_2.jpg", "IMG_4.jpg"])
    status = setup.finish()
    assert (status["state"], status["copied"], status["failed"]) == ("done", 3, 0)
    assert setup.exported() == ["IMG_1.jpg", "IMG_2.jpg", "IMG_4.jpg"]
    for name in setup.exported():
        assert sha(setup.dest / name) == sha(setup.source / name)


def test_taken_names_get_a_suffix_and_nothing_is_overwritten(tmp_path: Path) -> None:
    names = ["IMG_1.jpg", "a/IMG_2.jpg", "b/IMG_2.jpg"]
    setup = Setup(tmp_path, names, names)
    existing = write(setup.dest / "IMG_1.jpg", 99)
    before = sha(existing)
    status = setup.finish()
    assert status["copied"] == 3
    assert setup.exported() == ["IMG_1.jpg", "IMG_1_1.jpg", "IMG_2.jpg", "IMG_2_1.jpg"]
    assert sha(existing) == before
    assert sha(setup.dest / "IMG_1_1.jpg") == sha(setup.source / "IMG_1.jpg")
    copies = {sha(setup.dest / "IMG_2.jpg"), sha(setup.dest / "IMG_2_1.jpg")}
    assert copies == {sha(setup.source / "a/IMG_2.jpg"), sha(setup.source / "b/IMG_2.jpg")}


def test_destinations_inside_a_source_or_outside_the_roots_are_refused(tmp_path: Path) -> None:
    setup = Setup(tmp_path, ["IMG_1.jpg", "sub/IMG_2.jpg"], ["IMG_1.jpg"])
    inside = setup.source / "sub"
    for dest in (setup.source, inside):
        assert setup.export(dest)["error"]["code"] == DEST_INSIDE_SOURCE
    outside = tmp_path / "otra"
    outside.mkdir()
    assert setup.export(outside)["error"]["code"] == PATH_NOT_ALLOWED
    unknown = call(setup.dispatcher, "export", {"session_id": "nope", "dest": str(setup.dest)})
    assert unknown["error"]["code"] == NOT_FOUND
    assert setup.exported() == []
    assert sorted(p.name for p in inside.iterdir()) == ["IMG_2.jpg"]


def test_a_raw_sidecar_follows_its_photo_and_its_new_name(tmp_path: Path) -> None:
    setup = Setup(tmp_path, ["IMG_5.ARW"], ["IMG_5.ARW"])
    sidecar = write(setup.source / "IMG_5.XMP", 7)
    write(setup.dest / "IMG_5.ARW", 50)
    status = setup.finish()
    assert status["failed"] == 0
    assert setup.exported() == ["IMG_5.ARW", "IMG_5_1.ARW", "IMG_5_1.XMP"]
    assert sha(setup.dest / "IMG_5_1.XMP") == sha(sidecar)


def test_originals_are_untouched(tmp_path: Path) -> None:
    names = ["IMG_1.jpg", "IMG_2.jpg"]
    setup = Setup(tmp_path, names, names)
    before = {
        name: (os.stat(setup.source / name).st_size, os.stat(setup.source / name).st_mtime_ns)
        for name in names
    }
    hashes = {name: sha(setup.source / name) for name in names}
    assert setup.finish()["copied"] == 2
    for name in names:
        info = os.stat(setup.source / name)
        assert (info.st_size, info.st_mtime_ns) == before[name]
        assert sha(setup.source / name) == hashes[name]
    assert sorted(p.name for p in setup.source.iterdir()) == names


def test_nothing_selected_means_nothing_copied(tmp_path: Path) -> None:
    setup = Setup(tmp_path, ["IMG_1.jpg", "IMG_2.jpg"], [])
    status = setup.finish()
    assert (status["state"], status["copied"]) == ("done", 0)
    assert setup.exported() == []


def test_plan_reserves_names_case_insensitively(tmp_path: Path) -> None:
    source = tmp_path / "s"
    first = write(source / "x" / "Foto.JPG", 1)
    second = write(source / "y" / "foto.jpg", 2)
    dest = tmp_path / "d"
    dest.mkdir()
    targets = [target.name for _, target in plan([first, second], dest)]
    assert targets == ["Foto.JPG", "foto_1.jpg"]
