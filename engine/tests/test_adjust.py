"""Basic corrections: each control moves the picture the way its name says."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from mejores_engine.adjust import KEYS, Adjustments, apply, parse, validate
from mejores_engine.app import build_dispatcher
from mejores_engine.luts import parse_cube
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher, RpcError
from mejores_engine.store import Store


def flat(b: int, g: int, r: int, size: int = 8) -> NDArray[np.uint8]:
    return np.full((size, size, 3), (b, g, r), dtype=np.uint8)


def pixel(image: NDArray[np.uint8]) -> tuple[int, int, int]:
    b, g, r = (int(v) for v in image[0, 0])
    return b, g, r


def gradient() -> NDArray[np.uint8]:
    ramp = np.linspace(0, 255, 64, dtype=np.uint8)
    return np.dstack([np.tile(ramp, (4, 1))] * 3)


def test_no_correction_returns_the_same_picture() -> None:
    image = gradient()
    assert Adjustments().is_identity
    assert np.array_equal(apply(image, Adjustments()), image)


def test_a_correction_with_every_control_at_zero_but_a_lut_strength_is_still_identity() -> None:
    assert Adjustments(lut_strength=0.3).is_identity
    assert not Adjustments(lut_id="x").is_identity


def test_exposure_brightens_and_darkens_by_stops() -> None:
    mid = flat(100, 100, 100)
    assert pixel(apply(mid, Adjustments(exposure=1))) == (200, 200, 200)
    assert pixel(apply(mid, Adjustments(exposure=-1))) == (50, 50, 50)
    assert pixel(apply(flat(200, 200, 200), Adjustments(exposure=2))) == (255, 255, 255)


def test_temperature_warms_by_lifting_red_and_lowering_blue() -> None:
    b, g, r = pixel(apply(flat(100, 100, 100), Adjustments(temperature=1)))
    assert r > 100 > b
    assert g == 100
    b, g, r = pixel(apply(flat(100, 100, 100), Adjustments(temperature=-1)))
    assert b > 100 > r


def test_tint_moves_green_against_magenta() -> None:
    _, g, _ = pixel(apply(flat(100, 100, 100), Adjustments(tint=1)))
    assert g < 100
    _, g, _ = pixel(apply(flat(100, 100, 100), Adjustments(tint=-1)))
    assert g > 100


def test_contrast_spreads_the_tones_around_the_middle() -> None:
    dark, light = flat(80, 80, 80), flat(180, 180, 180)
    more = Adjustments(contrast=0.5)
    assert pixel(apply(dark, more))[0] < 80
    assert pixel(apply(light, more))[0] > 180
    less = Adjustments(contrast=-0.5)
    assert pixel(apply(dark, less))[0] > 80
    assert pixel(apply(light, less))[0] < 180


def test_highlights_only_move_the_bright_tones_and_shadows_only_the_dark_ones() -> None:
    dark, light = flat(40, 40, 40), flat(230, 230, 230)
    assert pixel(apply(light, Adjustments(highlights=-1)))[0] < 230
    assert pixel(apply(dark, Adjustments(highlights=-1)))[0] == 40
    assert pixel(apply(dark, Adjustments(shadows=1)))[0] > 40
    assert pixel(apply(light, Adjustments(shadows=1)))[0] == 230


def test_saturation_down_to_the_minimum_is_grey_and_up_adds_colour() -> None:
    colour = flat(60, 120, 200)
    b, g, r = pixel(apply(colour, Adjustments(saturation=-1)))
    assert abs(b - g) <= 1 and abs(g - r) <= 1
    b2, _, r2 = pixel(apply(colour, Adjustments(saturation=0.5)))
    assert (r2 - b2) > (200 - 60)


def lut(tint: float) -> Any:
    lines = ["LUT_3D_SIZE 3"]
    for b in range(3):
        for g in range(3):
            for r in range(3):
                lines.append(f"{r / 2 * tint} {g / 2 * tint} {b / 2 * tint}")
    return parse_cube("\n".join(lines))


def test_the_lut_strength_mixes_between_the_picture_and_the_graded_one() -> None:
    image = flat(200, 200, 200)
    half_dark = lut(0.5)
    full = pixel(apply(image, Adjustments(lut_id="x", lut_strength=1), half_dark))[0]
    none = pixel(apply(image, Adjustments(lut_id="x", lut_strength=0), half_dark))[0]
    half = pixel(apply(image, Adjustments(lut_id="x", lut_strength=0.5), half_dark))[0]
    assert abs(full - 100) <= 2
    assert none == 200
    assert abs(half - 150) <= 2


def test_a_missing_lut_leaves_the_other_corrections_working() -> None:
    result = apply(flat(100, 100, 100), Adjustments(exposure=1, lut_id="gone"), None)
    assert pixel(result) == (200, 200, 200)


def test_a_tall_picture_is_the_same_whole_or_in_bands() -> None:
    rng = np.random.default_rng(2)
    image = rng.integers(0, 256, size=(700, 30, 3), dtype=np.uint8)  # more rows than one band
    adj = Adjustments(exposure=0.4, contrast=0.2, highlights=-0.3, shadows=0.3, saturation=0.2)
    whole = apply(image, adj)
    assert np.array_equal(whole[:100], apply(image[:100], adj))
    assert np.array_equal(whole[600:], apply(image[600:], adj))


def good(**changes: Any) -> dict[str, Any]:
    return {**Adjustments().as_dict(), **changes}


def test_validate_accepts_the_defaults_and_rebuilds_the_same_values() -> None:
    assert set(good()) == set(KEYS)
    assert parse(validate(good(exposure=1.5, lut_id="abc"))).exposure == 1.5


@pytest.mark.parametrize(
    "bad",
    [
        good(exposure=3),
        good(contrast=-1.5),
        good(saturation=True),
        good(tint="1"),
        good(lut_strength=2),
        good(lut_id=""),
        good(lut_id=4),
        {"exposure": 0},
        "nope",
    ],
)
def test_bad_adjustments_are_refused(bad: Any) -> None:
    with pytest.raises(RpcError) as caught:
        validate(bad)
    assert caught.value.code == INVALID_PARAMS


class Photos:
    """A scanned session with two photos, to try the edits RPCs on."""

    def __init__(self, tmp_path: Path) -> None:
        import cv2

        self.folder = tmp_path / "fotos"
        self.folder.mkdir()
        for name in ("a.png", "b.png"):
            assert cv2.imwrite(str(self.folder / name), flat(90, 90, 90, 16))
        self.data = tmp_path / "data"
        self.dispatcher: Dispatcher = build_dispatcher(lambda: Store(self.data))
        self.call("grant_roots", {"roots": [str(self.folder)]})
        scanned = self.call("scan", {"paths": [str(self.folder)]})["result"]
        self.session_id = scanned["session_id"]
        self.ids = [p["id"] for p in scanned["photos"]]

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        reply: dict[str, Any] = json.loads(self.dispatcher.handle_line(line) or "")
        return reply

    def set(self, ids: list[str], **changes: Any) -> dict[str, Any]:
        params = {"session_id": self.session_id, "photo_ids": ids, "adjustments": good(**changes)}
        return self.call("edits_set", params)

    def stored(self) -> dict[str, Any]:
        reply = self.call("edits_get", {"session_id": self.session_id})
        return dict(reply["result"]["edits"])


def test_corrections_are_stored_per_photo_and_come_back(tmp_path: Path) -> None:
    photos = Photos(tmp_path)
    assert photos.stored() == {}
    assert "result" in photos.set(photos.ids, exposure=1, contrast=0.3)
    stored = photos.stored()
    assert set(stored) == set(photos.ids)
    assert stored[photos.ids[0]]["exposure"] == 1
    photos.set(photos.ids[:1], exposure=-0.5)
    assert photos.stored()[photos.ids[0]]["exposure"] == -0.5
    assert photos.stored()[photos.ids[1]]["exposure"] == 1


def test_setting_all_zero_clears_a_photos_corrections(tmp_path: Path) -> None:
    photos = Photos(tmp_path)
    photos.set(photos.ids, exposure=1)
    photos.set(photos.ids[:1])
    assert set(photos.stored()) == {photos.ids[1]}


def test_reset_removes_corrections(tmp_path: Path) -> None:
    photos = Photos(tmp_path)
    photos.set(photos.ids, saturation=0.4)
    reply = photos.call("edits_reset", {"session_id": photos.session_id, "photo_ids": photos.ids})
    assert reply["result"]["photo_ids"] == photos.ids
    assert photos.stored() == {}


def test_edits_only_reach_photos_of_the_session_and_validate_their_input(tmp_path: Path) -> None:
    photos = Photos(tmp_path)
    assert photos.set(["nope"], exposure=1)["error"]["code"] == NOT_FOUND
    assert photos.set([], exposure=1)["error"]["code"] == INVALID_PARAMS
    assert photos.set(photos.ids, exposure=9)["error"]["code"] == INVALID_PARAMS
    params = {"session_id": "other", "photo_ids": photos.ids, "adjustments": good(exposure=1)}
    assert photos.call("edits_set", params)["error"]["code"] == NOT_FOUND
    assert photos.call("edits_get", {})["error"]["code"] == INVALID_PARAMS
    assert photos.stored() == {}


def test_corrections_survive_a_restart_and_follow_the_photo_when_deleted(tmp_path: Path) -> None:
    photos = Photos(tmp_path)
    photos.set(photos.ids, exposure=1)
    again = build_dispatcher(lambda: Store(photos.data))
    line = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "edits_get",
            "params": {"session_id": photos.session_id},
        }
    )
    assert set(json.loads(again.handle_line(line) or "")["result"]["edits"]) == set(photos.ids)
    with Store(photos.data).session() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (photos.session_id,))
        assert conn.execute("SELECT count(*) FROM photo_edits").fetchone()[0] == 0


def test_migration_five_adds_the_table_to_a_database_with_data(tmp_path: Path) -> None:
    store = Store(tmp_path / "data")
    with store.session() as conn:
        conn.execute("INSERT INTO settings (key, value) VALUES ('per_burst', '2')")
        conn.execute("DROP TABLE photo_edits")
        conn.execute("DELETE FROM schema_migrations WHERE version = '0005'")
    reopened = Store(tmp_path / "data")
    with reopened.session() as conn:
        assert (
            conn.execute("SELECT value FROM settings WHERE key = 'per_burst'").fetchone()[0] == "2"
        )
        assert conn.execute("SELECT count(*) FROM photo_edits").fetchone()[0] == 0
    assert "0005" in reopened.applied_versions()
