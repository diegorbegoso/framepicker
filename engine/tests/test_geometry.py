"""Turn, mirror, straighten and crop; the preview and export that use them; straighten_suggest."""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from mejores_engine import geometry
from mejores_engine.adjust import Adjustments, apply
from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher
from mejores_engine.store import Store
from mejores_engine.straighten import suggest

Image = NDArray[np.uint8]


def white(width: int, height: int) -> Image:
    return np.full((height, width, 3), 255, dtype=np.uint8)


def marked() -> Image:
    """120x80 picture: top-left quarter red, the rest dark grey."""
    image = np.full((80, 120, 3), 40, dtype=np.uint8)
    image[:40, :60] = (0, 0, 255)
    return image


def test_quarter_turns_are_clockwise() -> None:
    turned = geometry.apply(marked(), 1, False, 0.0, None)
    assert turned.shape[:2] == (120, 80)
    assert tuple(turned[5, 75]) == (0, 0, 255)  # the top-left corner moved to the top-right
    assert geometry.apply(marked(), 2, False, 0.0, None).shape[:2] == (80, 120)
    assert tuple(geometry.apply(marked(), 2, False, 0.0, None)[75, 115]) == (0, 0, 255)


def test_a_mirror_swaps_left_and_right() -> None:
    mirrored = geometry.apply(marked(), 0, True, 0.0, None)
    assert tuple(mirrored[5, 115]) == (0, 0, 255) and tuple(mirrored[5, 5]) == (40, 40, 40)


def test_a_crop_without_an_angle_is_an_exact_cut() -> None:
    image = marked()
    cut = geometry.apply(image, 0, False, 0.0, [0.25, 0.5, 0.75, 1.0])
    assert cut.shape[:2] == (40, 60)
    assert np.array_equal(cut, image[40:80, 30:90])


@pytest.mark.parametrize("angle", [-30.0, -7.5, 2.0, 12.0, 45.0])
@pytest.mark.parametrize("shape", [(300, 200), (200, 300), (250, 250)])
def test_a_straightened_canvas_never_shows_an_empty_corner(
    angle: float, shape: tuple[int, int]
) -> None:
    width, height = shape
    black_frame = white(width, height)
    black_frame[:, :3] = 0  # a black edge all round would reveal any leak of the border
    black_frame[:, -3:] = 0
    black_frame[:3] = 0
    black_frame[-3:] = 0
    inside = np.full((height, width, 3), 255, dtype=np.uint8)
    out = geometry.apply(inside, 0, False, angle, None)
    expected = geometry.output_size(width, height, angle, None)
    assert out.shape[1] - expected[0] == 0 and out.shape[0] - expected[1] == 0
    assert int(out.min()) >= 250  # no border pixel, no empty corner
    del black_frame


def test_the_canvas_follows_the_inscribed_rectangle_formula() -> None:
    k = geometry.fit_factor(300, 200, 10.0)
    theta = math.radians(10)
    assert k == pytest.approx(1 / (math.cos(theta) + 1.5 * math.sin(theta)))
    assert geometry.output_size(300, 200, 10.0, None) == (round(300 * k), round(200 * k))
    assert geometry.fit_factor(300, 200, 0.0) == 1.0
    assert geometry.fit_factor(100, 100, 45.0) == pytest.approx(1 / math.sqrt(2))


def test_a_positive_angle_turns_the_picture_clockwise() -> None:
    image = np.full((200, 200, 3), 40, dtype=np.uint8)
    cv2.line(image, (10, 100), (190, 100), (255, 255, 255), 3)  # a level line
    out = geometry.apply(image, 0, False, 10.0, None)
    ys, xs = np.nonzero(out[:, :, 0] > 200)
    slope = np.polyfit(xs, ys, 1)[0]
    assert slope > 0.1  # it now falls to the right, as when turned clockwise


def test_crop_is_measured_on_the_straightened_canvas() -> None:
    size = geometry.output_size(300, 200, 6.0, [0.0, 0.0, 0.5, 0.5])
    full = geometry.output_size(300, 200, 6.0, None)
    assert size == (round(full[0] / 2), round(full[1] / 2))
    out = geometry.apply(scene(300, 200), 0, False, 6.0, [0.0, 0.0, 0.5, 0.5])
    assert out.shape[1] == size[0] and out.shape[0] == size[1]


def scene(width: int, height: int) -> Image:
    rng = np.random.default_rng(1)
    return np.asarray(rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8))


def test_geometry_is_part_of_the_adjustments() -> None:
    assert not Adjustments(rotate=1).is_identity
    assert not Adjustments(crop=[0, 0, 0.5, 1]).is_identity
    assert Adjustments(aspect="3:2").is_identity  # only a memory for the editor
    out = apply(marked(), Adjustments(rotate=1, exposure=0.5))
    assert out.shape[:2] == (120, 80)


def lines_picture(tilt: float, size: int = 600) -> Image:
    """Dark picture with long white lines: three level ones and two upright ones, turned by tilt."""
    image = np.full((size, size, 3), 30, dtype=np.uint8)
    for y in (150, 300, 450):
        cv2.line(image, (40, y), (size - 40, y), (230, 230, 230), 4)
    for x in (150, 450):
        cv2.line(image, (x, 40), (x, size - 40), (230, 230, 230), 4)
    matrix = cv2.getRotationMatrix2D((size / 2, size / 2), -tilt, 1.0)
    return np.asarray(cv2.warpAffine(image, matrix, (size, size)), dtype=np.uint8)


@pytest.mark.parametrize("tilt", [-8.0, -3.0, 3.0, 8.0])
def test_it_suggests_the_angle_that_levels_the_lines(tilt: float) -> None:
    suggestion = suggest(lines_picture(tilt))
    assert suggestion is not None
    assert suggestion == pytest.approx(-tilt, abs=1.0)


def test_it_says_nothing_when_there_are_no_straight_lines() -> None:
    rng = np.random.default_rng(2)
    noise = np.asarray(rng.integers(0, 255, size=(400, 400, 3), dtype=np.uint8))
    assert suggest(noise) is None
    assert suggest(np.full((300, 300, 3), 128, dtype=np.uint8)) is None


class Shoot:
    def __init__(self, tmp_path: Path) -> None:
        self.folder = tmp_path / "fotos"
        self.folder.mkdir()
        ok, data = cv2.imencode(".jpg", lines_picture(5.0))
        assert ok
        (self.folder / "a.jpg").write_bytes(data.tobytes())
        self.dispatcher: Dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
        (tmp_path / "out").mkdir()
        self.call("grant_roots", {"roots": [str(self.folder), str(tmp_path / "out")]})
        scanned = self.call("scan", {"paths": [str(self.folder)]})["result"]
        self.session_id = scanned["session_id"]
        self.photo_id = scanned["photos"][0]["id"]

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        reply: dict[str, Any] = json.loads(self.dispatcher.handle_line(line) or "")
        return reply


def test_the_preview_reports_the_size_of_the_cropped_photo(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path)
    plain = shoot.call("preview", {"photo_id": shoot.photo_id, "max_px": 300})["result"]
    assert (plain["width"], plain["source_width"]) == (300, 600)
    edit = {"crop": [0.0, 0.0, 0.5, 1.0], "rotate": 0}
    shoot.call("edits_set", {"session_id": shoot.session_id, "photo_ids": [shoot.photo_id],
                             "adjustments": edit})  # fmt: skip
    cropped = shoot.call("preview", {"photo_id": shoot.photo_id, "max_px": 300, "edited": True})
    result = cropped["result"]
    assert (result["width"], result["height"]) == (150, 300)
    assert (result["source_width"], result["source_height"]) == (300, 600)
    saved = shoot.call("edits_get", {"session_id": shoot.session_id})["result"]["edits"]
    assert saved[shoot.photo_id]["crop"] == [0.0, 0.0, 0.5, 1.0]
    assert saved[shoot.photo_id]["whites"] == 0  # the complete schema comes back


def test_the_export_measures_the_long_edge_on_the_cropped_photo(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path)
    edit = {"crop": [0.0, 0.0, 1.0, 0.5]}
    shoot.call(
        "edits_set",
        {"session_id": shoot.session_id, "photo_ids": [shoot.photo_id], "adjustments": edit},
    )
    out = tmp_path / "out"
    options = {
        "format": "jpg", "long_edge": 320, "quality": 90, "apply_edits": True,
        "name_pattern": "{name}",
    }  # fmt: skip
    reply = shoot.call(
        "export",
        {
            "session_id": shoot.session_id,
            "dest": str(out),
            "options": options,
            "photo_ids": [shoot.photo_id],
        },
    )
    assert "result" in reply, reply
    for _ in range(300):
        status = shoot.call("job_status", {"job_id": reply["result"]["job_id"]})["result"]
        if status["state"] != "running":
            break
        time.sleep(0.05)
    assert status["state"] == "done", status
    files = list(out.rglob("*.jpg"))
    assert len(files) == 1
    shape = cv2.imdecode(np.fromfile(files[0], dtype=np.uint8), cv2.IMREAD_COLOR).shape
    assert (shape[1], shape[0]) == (320, 160)


def test_straighten_suggest_reads_the_photo_and_validates(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path)
    reply = shoot.call("straighten_suggest", {"photo_id": shoot.photo_id})["result"]
    assert reply["found"] is True and reply["angle"] == pytest.approx(-5.0, abs=1.0)
    assert shoot.call("straighten_suggest", {"photo_id": "x"})["error"]["code"] == NOT_FOUND
    assert shoot.call("straighten_suggest", {})["error"]["code"] == INVALID_PARAMS


@pytest.mark.parametrize(
    "bad",
    [
        {"rotate": 4}, {"rotate": 1.5}, {"flip": 1}, {"angle": 50}, {"crop": [0, 0, 1]},
        {"crop": [0.5, 0, 0.5, 1]}, {"crop": [0, 0, 1, 2]}, {"aspect": ""}, {"aspect": 3},
    ],
)  # fmt: skip
def test_bad_geometry_is_refused(bad: dict[str, Any]) -> None:
    from mejores_engine.adjust import validate
    from mejores_engine.rpc import RpcError

    with pytest.raises(RpcError):
        validate(bad)
