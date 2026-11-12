"""Loading several LUTs at once: partial success, duplicates, whole folders."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, PATH_NOT_ALLOWED, Dispatcher
from mejores_engine.store import Store


def cube_text(title: str, tint: float) -> str:
    lines = [f'TITLE "{title}"', "LUT_3D_SIZE 3"]
    for b in range(3):
        for g in range(3):
            for r in range(3):
                lines.append(f"{r / 2 * tint} {g / 2 * tint} {b / 2 * tint}")
    return "\n".join(lines) + "\n"


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def cube_files(folder: Path, names: list[str]) -> list[Path]:
    """One file per name, each with a different look so none counts as a repeat."""
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, name in enumerate(names):
        path = folder / name
        title = name.rsplit(".", 1)[0]
        path.write_text(cube_text(title, 1.0 / (index + 1)), encoding="utf-8")
        paths.append(path)
    return paths


def setup(tmp_path: Path) -> tuple[Dispatcher, Path]:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    folder = tmp_path / "Looks de boda"
    folder.mkdir()
    call(dispatcher, "grant_roots", {"roots": [str(folder)]})
    return dispatcher, folder


def test_several_luts_load_in_one_go(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    files = cube_files(tmp_path / "looks", ["Calido.cube", "Frio.cube", "Cine.cube"])
    call(dispatcher, "grant_roots", {"roots": [str(f) for f in files]})
    reply = call(dispatcher, "luts_add_many", {"paths": [str(f) for f in files]})["result"]
    assert [lut["name"] for lut in reply["added"]] == ["Calido", "Frio", "Cine"]
    assert reply["duplicates"] == [] and reply["failed"] == []
    listed = call(dispatcher, "luts_list", {})["result"]["luts"]
    assert sorted(lut["name"] for lut in listed) == ["Calido", "Cine", "Frio"]
    assert len({lut["id"] for lut in listed}) == 3


def test_a_broken_file_does_not_stop_the_others(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    good = cube_files(tmp_path / "looks", ["Uno.cube", "Dos.cube"])
    broken = tmp_path / "looks" / "roto.cube"
    broken.write_text("LUT_3D_SIZE 2\n", encoding="utf-8")
    wrong = tmp_path / "looks" / "nota.txt"
    wrong.write_text("hola", encoding="utf-8")
    missing = tmp_path / "looks" / "ausente.cube"
    paths = [good[0], broken, wrong, missing, good[1]]
    call(dispatcher, "grant_roots", {"roots": [str(tmp_path)]})
    reply = call(dispatcher, "luts_add_many", {"paths": [str(p) for p in paths]})["result"]
    assert [lut["name"] for lut in reply["added"]] == ["Uno", "Dos"]
    assert sorted(Path(f["path"]).name for f in reply["failed"]) == [
        "ausente.cube",
        "nota.txt",
        "roto.cube",
    ]
    assert all(f["message"] for f in reply["failed"])
    assert len(call(dispatcher, "luts_list", {})["result"]["luts"]) == 2


def test_the_same_look_twice_is_a_duplicate_even_under_another_file_name(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    first = cube_files(tmp_path / "a", ["Look.cube"])[0]
    copy = tmp_path / "b" / "otra copia.cube"
    copy.parent.mkdir()
    copy.write_text(first.read_text(encoding="utf-8"), encoding="utf-8")
    call(dispatcher, "grant_roots", {"roots": [str(tmp_path)]})
    one = call(dispatcher, "luts_add_many", {"paths": [str(first)]})["result"]
    assert len(one["added"]) == 1
    two = call(dispatcher, "luts_add_many", {"paths": [str(first), str(copy)]})["result"]
    assert two["added"] == []
    assert [d["name"] for d in two["duplicates"]] == ["Look", "Look"]
    assert len(call(dispatcher, "luts_list", {})["result"]["luts"]) == 1
    assert len(list((tmp_path / "data" / "luts").iterdir())) == 1  # nothing extra was copied


def test_a_repeat_inside_the_same_batch_is_caught_too(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    original = cube_files(tmp_path / "a", ["Look.cube"])[0]
    twin = tmp_path / "a" / "Look2.cube"
    twin.write_text(original.read_text(encoding="utf-8"), encoding="utf-8")
    call(dispatcher, "grant_roots", {"roots": [str(tmp_path)]})
    reply = call(dispatcher, "luts_add_many", {"paths": [str(original), str(twin)]})["result"]
    assert (len(reply["added"]), len(reply["duplicates"])) == (1, 1)


def test_a_whole_folder_loads_its_cube_files_and_ignores_the_rest(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    folder = tmp_path / "looks"
    cube_files(folder, ["B.cube", "a.CUBE", "C.cube"])
    (folder / "leeme.txt").write_text("x", encoding="utf-8")
    cube_files(folder / "dentro", ["Hundido.cube"])
    call(dispatcher, "grant_roots", {"roots": [str(folder)]})
    reply = call(dispatcher, "luts_add_folder", {"path": str(folder)})["result"]
    assert [lut["name"] for lut in reply["added"]] == ["a", "B", "C"]  # name order, no subfolders
    empty = tmp_path / "vacia"
    empty.mkdir()
    call(dispatcher, "grant_roots", {"roots": [str(empty)]})
    assert call(dispatcher, "luts_add_folder", {"path": str(empty)})["result"]["added"] == []


def test_the_batch_calls_check_their_input_and_the_granted_folders(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    stray = cube_files(tmp_path / "looks", ["Suelto.cube"])[0]
    denied = call(dispatcher, "luts_add_many", {"paths": [str(stray)]})
    assert denied["error"]["code"] == PATH_NOT_ALLOWED
    assert call(dispatcher, "luts_add_many", {"paths": []})["error"]["code"] == INVALID_PARAMS
    assert call(dispatcher, "luts_add_many", {"paths": "x"})["error"]["code"] == INVALID_PARAMS
    assert call(dispatcher, "luts_add_many", {"paths": [3]})["error"]["code"] == INVALID_PARAMS
    outside = call(dispatcher, "luts_add_folder", {"path": str(tmp_path)})
    assert outside["error"]["code"] == PATH_NOT_ALLOWED
    call(dispatcher, "grant_roots", {"roots": [str(tmp_path)]})
    gone = call(dispatcher, "luts_add_folder", {"path": str(tmp_path / "nada")})
    assert gone["error"]["code"] == NOT_FOUND
    assert call(dispatcher, "luts_list", {})["result"]["luts"] == []


def test_the_batch_survives_a_restart(tmp_path: Path) -> None:
    data = tmp_path / "data"
    files = cube_files(tmp_path / "looks", ["Uno.cube", "Dos.cube"])
    first = build_dispatcher(lambda: Store(data))
    call(first, "grant_roots", {"roots": [str(tmp_path)]})
    call(first, "luts_add_many", {"paths": [str(f) for f in files]})
    second = build_dispatcher(lambda: Store(data))
    assert len(call(second, "luts_list", {})["result"]["luts"]) == 2
    again = call(second, "luts_add_many", {"paths": [str(f) for f in files]})
    assert again["error"]["code"] == PATH_NOT_ALLOWED  # a new run starts with nothing granted


def test_a_lut_is_named_after_its_file_not_its_inner_title(tmp_path: Path) -> None:
    dispatcher, folder = setup(tmp_path)
    for index, name in enumerate(["Aurora.cube", "Dusk.cube"]):
        (folder / name).write_text(
            cube_text("Generated by Resolve", 0.9 - index / 5), encoding="utf-8"
        )
    reply = call(dispatcher, "luts_add_folder", {"path": str(folder)})["result"]
    assert [lut["name"] for lut in reply["added"]] == ["Aurora", "Dusk"]
    assert {lut["group"] for lut in reply["added"]} == {folder.name}


def test_reimporting_a_folder_renames_the_auto_named_ones_and_keeps_custom_names(
    tmp_path: Path,
) -> None:
    dispatcher, folder = setup(tmp_path)
    cube_files(folder, ["Calido.cube", "Frio.cube"])
    first = call(dispatcher, "luts_add_folder", {"path": str(folder)})["result"]["added"]
    ids = {lut["name"]: lut["id"] for lut in first}
    call(dispatcher, "luts_update", {"lut_id": ids["Frio"], "name": "Mi frío"})
    call(dispatcher, "luts_update", {"lut_id": ids["Calido"], "group": None})
    again = call(dispatcher, "luts_add_folder", {"path": str(folder)})["result"]
    assert again["added"] == []
    assert [d["renamed"] for d in again["duplicates"]] == [True, False]
    listed = {lut["id"]: lut for lut in call(dispatcher, "luts_list", {})["result"]["luts"]}
    assert listed[ids["Calido"]]["group"] == folder.name
    assert listed[ids["Frio"]]["name"] == "Mi frío"


def test_update_favorite_group_rename_and_remove(tmp_path: Path) -> None:
    dispatcher, folder = setup(tmp_path)
    cube_files(folder, ["A.cube", "B.cube"])
    added = call(dispatcher, "luts_add_folder", {"path": str(folder)})["result"]["added"]
    lut = call(dispatcher, "luts_update", {"lut_id": added[0]["id"], "favorite": True})["result"]
    assert lut["lut"]["favorite"] is True
    bad = call(dispatcher, "luts_update", {"lut_id": added[0]["id"], "name": "  "})
    assert bad["error"]["code"] == INVALID_PARAMS
    assert (
        call(dispatcher, "luts_update", {"lut_id": "x", "name": "n"})["error"]["code"] == NOT_FOUND
    )
    moved = call(dispatcher, "luts_group_rename", {"from": folder.name, "to": "Cine"})["result"]
    assert moved == {"moved": 2}
    assert {item["group"] for item in call(dispatcher, "luts_list", {})["result"]["luts"]} == {
        "Cine"
    }
    assert call(dispatcher, "luts_group_remove", {"group": "Cine"})["result"] == {"removed": 2}
    assert call(dispatcher, "luts_list", {})["result"]["luts"] == []
