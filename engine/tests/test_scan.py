from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, PATH_NOT_ALLOWED, Dispatcher
from mejores_engine.store import Store

RAW_NAMES = [
    "d.ARW",
    "e.cr2",
    "f.Cr3",
    "g.nef",
    "h.NRW",
    "i.dng",
    "j.raf",
    "k.ORF",
    "l.rw2",
    "m.pef",
    "n.SRW",
]


def touch(folder: Path, *names: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        (folder / name).write_bytes(b"x")


def make(tmp_path: Path) -> tuple[Dispatcher, Path]:
    data = tmp_path / "data"
    return build_dispatcher(lambda: Store(data)), data


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def session_count(data: Path) -> int:
    with Store(data).session() as conn:
        return int(conn.execute("SELECT count(*) AS n FROM sessions").fetchone()["n"])


def names(reply: dict[str, Any]) -> list[str]:
    return [Path(photo["path"]).name for photo in reply["result"]["photos"]]


def test_a_granted_folder_is_scanned_recursively_with_formats(tmp_path: Path) -> None:
    fotos = tmp_path / "fotos"
    touch(fotos, "a.jpg", "b.JPEG", "c.png", *RAW_NAMES)
    touch(fotos / "sub", "o.jpg")
    dispatcher, data = make(tmp_path)
    assert call(dispatcher, "grant_roots", {"roots": [str(fotos)]})["result"] == {"granted": 1}

    reply = call(dispatcher, "scan", {"paths": [str(fotos)]})
    formats = {Path(p["path"]).name: p["format"] for p in reply["result"]["photos"]}
    assert formats["a.jpg"] == "jpg"
    assert formats["b.JPEG"] == "jpg"
    assert formats["c.png"] == "png"
    assert formats["o.jpg"] == "jpg"
    assert all(formats[name] == "raw" for name in RAW_NAMES)
    assert len(formats) == 3 + len(RAW_NAMES) + 1
    assert session_count(data) == 1
    with Store(data).session() as conn:
        rows = conn.execute("SELECT count(*) AS n FROM photos").fetchone()["n"]
    assert rows == len(formats)


def test_recursion_can_be_turned_off(tmp_path: Path) -> None:
    fotos = tmp_path / "fotos"
    touch(fotos, "a.jpg")
    touch(fotos / "sub", "b.jpg")
    dispatcher, _ = make(tmp_path)
    call(dispatcher, "grant_roots", {"roots": [str(fotos)]})
    reply = call(dispatcher, "scan", {"paths": [str(fotos)], "recursive": False})
    assert names(reply) == ["a.jpg"]


def test_paths_outside_every_root_are_refused_without_a_session(tmp_path: Path) -> None:
    fotos = tmp_path / "fotos"
    touch(fotos, "a.jpg")
    touch(tmp_path / "fotos-privadas", "secret.jpg")
    touch(tmp_path / "otra", "b.jpg")
    dispatcher, data = make(tmp_path)
    call(dispatcher, "grant_roots", {"roots": [str(fotos)]})

    forbidden = [
        str(tmp_path / "otra"),
        str(fotos / ".." / "otra"),
        str(tmp_path / "fotos-privadas"),
        str(tmp_path / "fotos-privadas" / "secret.jpg"),
    ]
    for path in forbidden:
        reply = call(dispatcher, "scan", {"paths": [path]})
        assert reply["error"]["code"] == PATH_NOT_ALLOWED, path
    mixed = call(dispatcher, "scan", {"paths": [str(fotos), str(tmp_path / "otra")]})
    assert mixed["error"]["code"] == PATH_NOT_ALLOWED
    assert session_count(data) == 0


def test_unsupported_files_are_skipped_and_counted(tmp_path: Path) -> None:
    fotos = tmp_path / "fotos"
    touch(fotos, "a.jpg", "notes.txt", "a.xmp", "clip.mp4")
    dispatcher, _ = make(tmp_path)
    call(dispatcher, "grant_roots", {"roots": [str(fotos)]})
    reply = call(dispatcher, "scan", {"paths": [str(fotos)]})
    assert names(reply) == ["a.jpg"]
    assert reply["result"]["skipped"] == 3


def test_individual_files_are_taken_exactly(tmp_path: Path) -> None:
    fotos = tmp_path / "fotos"
    touch(fotos, "a.jpg", "b.jpg", "c.jpg")
    dispatcher, data = make(tmp_path)
    call(dispatcher, "grant_roots", {"roots": [str(fotos)]})
    reply = call(dispatcher, "scan", {"paths": [str(fotos / "a.jpg"), str(fotos / "c.jpg")]})
    assert names(reply) == ["a.jpg", "c.jpg"]
    with Store(data).session() as conn:
        label = conn.execute("SELECT label FROM sessions").fetchone()["label"]
    assert label == "Selección de archivos"


def test_files_are_listed_in_natural_order(tmp_path: Path) -> None:
    fotos = tmp_path / "fotos"
    touch(fotos, "IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg")
    dispatcher, _ = make(tmp_path)
    call(dispatcher, "grant_roots", {"roots": [str(fotos)]})
    reply = call(dispatcher, "scan", {"paths": [str(fotos)]})
    assert names(reply) == ["IMG_1.jpg", "IMG_2.jpg", "IMG_10.jpg"]


def test_bad_roots_are_rejected_and_nothing_is_granted(tmp_path: Path) -> None:
    fotos = tmp_path / "fotos"
    touch(fotos, "a.jpg")
    dispatcher, _ = make(tmp_path)

    relative = call(dispatcher, "grant_roots", {"roots": ["fotos"]})
    assert relative["error"]["code"] == INVALID_PARAMS
    missing = call(dispatcher, "grant_roots", {"roots": [str(tmp_path / "nope")]})
    assert missing["error"]["code"] == INVALID_PARAMS
    mixed = call(dispatcher, "grant_roots", {"roots": [str(fotos), str(tmp_path / "nope")]})
    assert mixed["error"]["code"] == INVALID_PARAMS

    reply = call(dispatcher, "scan", {"paths": [str(fotos)]})
    assert reply["error"]["code"] == PATH_NOT_ALLOWED
