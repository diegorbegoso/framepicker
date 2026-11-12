"""LUTs: the .cube parser, trilinear application and the library that keeps them between runs."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from mejores_engine.adjust import Adjustments
from mejores_engine.app import build_dispatcher
from mejores_engine.features import preview_image
from mejores_engine.luts import apply, parse_cube
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, PATH_NOT_ALLOWED, Dispatcher
from mejores_engine.store import Store


def cube_text(
    size: int = 3, title: str = "Identity", tint: tuple[float, float, float] = (1, 1, 1)
) -> str:
    """An identity LUT, optionally scaled per channel, in .cube order (red changes fastest)."""
    lines = [f'TITLE "{title}"', f"LUT_3D_SIZE {size}"]
    top = size - 1
    for b in range(size):
        for g in range(size):
            for r in range(size):
                lines.append(f"{r / top * tint[0]} {g / top * tint[1]} {b / top * tint[2]}")
    return "\n".join(lines) + "\n"


def photo() -> NDArray[np.uint8]:
    rng = np.random.default_rng(3)
    return rng.integers(0, 256, size=(40, 60, 3), dtype=np.uint8)


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def test_an_identity_lut_leaves_the_image_unchanged() -> None:
    image = photo()
    result = apply(image, parse_cube(cube_text(size=17)))
    assert np.abs(result.astype(int) - image.astype(int)).max() <= 1


def test_a_lut_changes_channels_in_the_right_order() -> None:
    image = np.full((4, 4, 3), (200, 100, 50), dtype=np.uint8)  # BGR
    halved_red = apply(image, parse_cube(cube_text(tint=(0.5, 1, 1))))
    b, g, r = (int(halved_red[0, 0, i]) for i in range(3))
    assert (b, g) == (200, 100)
    assert abs(r - 25) <= 1


def test_a_domain_other_than_zero_to_one_is_honoured() -> None:
    text = cube_text(size=2).replace(
        "LUT_3D_SIZE 2", "LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 0.5 0.5 0.5"
    )
    lut = parse_cube(text)
    image = np.full((2, 2, 3), 128, dtype=np.uint8)  # above 0.5 clamps to the top of the table
    assert apply(image, lut)[0, 0].tolist() == [255, 255, 255]


@pytest.mark.parametrize(
    "text",
    [
        "LUT_1D_SIZE 4\n0 0 0\n",
        "LUT_3D_SIZE 2\n0 0 0\n",
        "LUT_3D_SIZE 1\n0 0 0\n",
        "LUT_3D_SIZE 2\n" + "a b c\n" * 8,
        "LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n" + "0 0 0\n" * 8,
        "",
    ],
)
def test_a_bad_cube_file_is_refused_with_a_clear_error(text: str) -> None:
    from mejores_engine.rpc import RpcError

    with pytest.raises(RpcError) as caught:
        parse_cube(text)
    assert caught.value.code == INVALID_PARAMS


def test_a_big_image_is_processed_in_chunks_with_the_same_result() -> None:
    rng = np.random.default_rng(5)
    image = rng.integers(0, 256, size=(600, 700, 3), dtype=np.uint8)  # > one chunk of pixels
    lut = parse_cube(cube_text(size=5, tint=(0.8, 1, 0.6)))
    whole = apply(image, lut)
    top = apply(image[:300], lut)
    assert np.array_equal(whole[:300], top)


def test_the_library_keeps_a_lut_between_runs(tmp_path: Path) -> None:
    data = tmp_path / "data"
    source = tmp_path / "Mi Look.cube"
    source.write_text(cube_text(title="Cálido"), encoding="utf-8")

    first = build_dispatcher(lambda: Store(data))
    assert call(first, "grant_roots", {"roots": [str(source)]})["result"]["granted"] == 1
    added = call(first, "luts_add", {"path": str(source)})["result"]
    assert (added["name"], added["size"]) == ("Mi Look", 3)

    second = build_dispatcher(lambda: Store(data))  # a new run of the program
    listed = call(second, "luts_list", {})["result"]["luts"]
    assert [lut["id"] for lut in listed] == [added["id"]]
    assert (data / "luts" / f"{added['id']}.cube").is_file()

    removed = call(second, "luts_remove", {"lut_id": added["id"]})
    assert removed["result"] == {"lut_id": added["id"]}
    assert call(second, "luts_list", {})["result"]["luts"] == []
    assert not (data / "luts" / f"{added['id']}.cube").exists()
    assert call(second, "luts_remove", {"lut_id": added["id"]})["error"]["code"] == NOT_FOUND


def test_adding_a_lut_needs_a_granted_valid_cube_file(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    stray = tmp_path / "stray.cube"
    stray.write_text(cube_text(), encoding="utf-8")
    assert call(dispatcher, "luts_add", {"path": str(stray)})["error"]["code"] == PATH_NOT_ALLOWED
    broken = tmp_path / "broken.cube"
    broken.write_text("LUT_3D_SIZE 2\n", encoding="utf-8")
    call(dispatcher, "grant_roots", {"roots": [str(tmp_path)]})
    assert call(dispatcher, "luts_add", {"path": str(broken)})["error"]["code"] == INVALID_PARAMS
    wrong = tmp_path / "look.txt"
    wrong.write_text(cube_text(), encoding="utf-8")
    assert call(dispatcher, "luts_add", {"path": str(wrong)})["error"]["code"] == INVALID_PARAMS
    assert call(dispatcher, "luts_list", {})["result"]["luts"] == []


def test_preview_shows_the_photo_through_the_lut_of_its_corrections(tmp_path: Path) -> None:
    data = tmp_path / "data"
    dispatcher = build_dispatcher(lambda: Store(data))
    source = tmp_path / "dark.cube"
    source.write_text(cube_text(tint=(0.5, 0.5, 0.5)), encoding="utf-8")
    image_path = tmp_path / "grey.png"
    assert cv2.imwrite(str(image_path), np.full((20, 20, 3), 200, dtype=np.uint8))
    call(dispatcher, "grant_roots", {"roots": [str(tmp_path)]})
    lut_id = call(dispatcher, "luts_add", {"path": str(source)})["result"]["id"]
    scanned = call(dispatcher, "scan", {"paths": [str(tmp_path)]})["result"]
    photo_id = next(p["id"] for p in scanned["photos"] if p["path"].endswith("grey.png"))
    corrections = {
        "exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0, "temperature": 0,
        "tint": 0, "saturation": 0, "lut_id": lut_id, "lut_strength": 1,
    }  # fmt: skip
    call(
        dispatcher,
        "edits_set",
        {"session_id": scanned["session_id"], "photo_ids": [photo_id], "adjustments": corrections},
    )

    plain = call(dispatcher, "preview", {"photo_id": photo_id})["result"]["data_url"]
    graded = call(dispatcher, "preview", {"photo_id": photo_id, "edited": True})["result"][
        "data_url"
    ]
    assert plain != graded
    bad = call(dispatcher, "preview", {"photo_id": photo_id, "edited": "yes"})
    assert bad["error"]["code"] == INVALID_PARAMS
    # A LUT removed from the library after the correction was made must not break the preview.
    call(dispatcher, "luts_remove", {"lut_id": lut_id})
    still = call(dispatcher, "preview", {"photo_id": photo_id, "edited": True})
    assert "result" in still


def test_preview_image_applies_the_lut_after_scaling(tmp_path: Path) -> None:
    path = tmp_path / "big.png"
    assert cv2.imwrite(str(path), np.full((400, 800, 3), 200, dtype=np.uint8))
    lut = parse_cube(cube_text(tint=(0.5, 0.5, 0.5)))
    graded = preview_image(path, "png", max_px=100, adjustments=Adjustments(lut_id="x"), lut=lut)
    assert (graded.width, graded.height) == (100, 50)


def test_migration_three_adds_the_table_to_a_database_that_has_data(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store = Store(data)
    with store.session() as conn:
        conn.execute("INSERT INTO settings (key, value) VALUES ('per_burst', '2')")
        conn.execute("DROP TABLE luts")
        conn.execute("DELETE FROM schema_migrations WHERE version = '0003'")
    reopened = Store(data)  # runs 0003 on a database that already holds rows
    with reopened.session() as conn:
        assert (
            conn.execute("SELECT value FROM settings WHERE key = 'per_burst'").fetchone()["value"]
            == "2"
        )
        conn.execute(
            "INSERT INTO luts (id, name, size, filename, added_at) "
            "VALUES ('a', 'n', 3, 'a.cube', 'now')"
        )
    assert "0003" in reopened.applied_versions()
    assert sqlite3.connect(reopened.path).execute("SELECT count(*) FROM luts").fetchone()[0] == 1
