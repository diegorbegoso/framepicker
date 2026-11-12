"""Whites, blacks, vibrance, clarity, sharpening, vignette, curves and the colour mixer."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from mejores_engine import adjust, curves, hslmix
from mejores_engine.adjust import Adjustments, apply, parse, validate
from mejores_engine.rpc import INVALID_PARAMS, RpcError

Image = NDArray[np.uint8]


def grey(level: int, size: int = 64) -> Image:
    return np.full((size, size, 3), level, dtype=np.uint8)


def ramp(width: int = 256, height: int = 8) -> Image:
    row = np.arange(width, dtype=np.uint8) if width <= 256 else np.linspace(0, 255, width)
    return np.tile(np.asarray(row, dtype=np.uint8)[None, :, None], (height, 1, 3))


def scene(size: int = 120, seed: int = 3) -> Image:
    rng = np.random.default_rng(seed)
    base = rng.integers(40, 200, size=(size // 8, size // 8, 3), dtype=np.uint8)
    return np.asarray(cv2.resize(base, (size, size), interpolation=cv2.INTER_CUBIC), dtype=np.uint8)


def colour(b: int, g: int, r: int) -> Image:
    out = np.zeros((32, 32, 3), dtype=np.uint8)
    out[:] = (b, g, r)
    return out


def mean(image: Image) -> float:
    return float(image.mean())


def test_a_neutral_set_returns_the_very_same_picture() -> None:
    image = scene()
    assert apply(image, Adjustments()) is image
    assert Adjustments().is_identity


@pytest.mark.parametrize("name", ["whites", "blacks", "vibrance", "clarity", "sharpen", "vignette"])
def test_each_new_slider_changes_the_picture_and_never_the_original(name: str) -> None:
    image = scene()
    before = image.copy()
    out = apply(image, replace(Adjustments(), **{name: 0.6}))
    assert not np.array_equal(out, image)
    assert np.array_equal(image, before)
    assert not Adjustments(**{name: 0.6}).is_identity


def test_whites_brighten_the_top_and_blacks_lift_the_bottom() -> None:
    light, dark = grey(200), grey(30)
    assert mean(apply(light, Adjustments(whites=0.8))) > mean(light)
    assert mean(apply(light, Adjustments(whites=-0.8))) < mean(light)
    assert mean(apply(dark, Adjustments(blacks=0.8))) > mean(dark)
    assert mean(apply(dark, Adjustments(blacks=-0.8))) <= mean(dark)


def test_vibrance_lifts_dull_colours_more_than_vivid_ones() -> None:
    dull, vivid = colour(150, 120, 110), colour(230, 40, 20)

    def spread(image: Image) -> float:
        return float(image.astype(int).max(axis=2).mean() - image.astype(int).min(axis=2).mean())

    gain_dull = spread(apply(dull, Adjustments(vibrance=0.8))) / spread(dull)
    gain_vivid = spread(apply(vivid, Adjustments(vibrance=0.8))) / spread(vivid)
    assert gain_dull > gain_vivid


def test_clarity_adds_contrast_to_texture_and_leaves_flat_areas_alone() -> None:
    flat = grey(128)
    assert np.abs(apply(flat, Adjustments(clarity=1.0)).astype(int) - 128).max() <= 1
    checker = np.tile(np.array([[100, 140], [140, 100]], dtype=np.uint8), (32, 32))
    textured = np.repeat(checker[:, :, None], 3, axis=2)
    assert apply(textured, Adjustments(clarity=1.0)).std() > textured.std()


def test_sharpening_raises_the_edge_contrast_of_a_soft_picture() -> None:
    sharp = np.zeros((80, 80, 3), dtype=np.uint8)
    sharp[:, 40:] = 200
    soft = np.asarray(cv2.GaussianBlur(sharp, (0, 0), 2.0), dtype=np.uint8)
    out = apply(soft, Adjustments(sharpen=1.0))
    assert (
        np.abs(np.diff(out[40, :, 0].astype(int))).max()
        > np.abs(np.diff(soft[40, :, 0].astype(int))).max()
    )


def test_vignette_darkens_the_corners_not_the_centre() -> None:
    flat = grey(150, 100)
    out = apply(flat, Adjustments(vignette=-1.0))
    assert out[50, 50, 0] == 150
    assert out[0, 0, 0] < 120
    lighter = apply(flat, Adjustments(vignette=1.0))
    assert lighter[0, 0, 0] > 150


def test_a_vignette_looks_the_same_whatever_band_the_rows_fall_in() -> None:
    image = scene(300)
    whole = apply(image, Adjustments(vignette=-0.7))
    assert whole.shape == image.shape
    assert np.array_equal(whole[:, :150], whole[:, :150])
    assert whole[0, 0, 0] < whole[150, 150, 0]


def test_a_picture_big_enough_to_use_several_bands_matches_a_one_band_run(monkeypatch: Any) -> None:
    image = scene(300)
    adj = Adjustments(exposure=0.4, whites=0.3, vibrance=0.5, vignette=-0.5)
    banded = apply(image, adj)
    monkeypatch.setattr(adjust, "BAND_ROWS", 10_000)
    assert np.array_equal(apply(image, adj), banded)


def test_clarity_and_sharpen_look_alike_at_preview_and_full_size() -> None:
    big = scene(800)
    small = np.asarray(cv2.resize(big, (200, 200), interpolation=cv2.INTER_AREA), dtype=np.uint8)
    adj = Adjustments(clarity=0.8, sharpen=0.5)
    full_then_down = cv2.resize(apply(big, adj), (200, 200), interpolation=cv2.INTER_AREA)
    down_then_apply = apply(small, adj)
    assert (
        np.abs(full_then_down.astype(int) - down_then_apply.astype(int)).mean()
        < np.abs(down_then_apply.astype(int) - small.astype(int)).mean()
    )


class TestCurves:
    def test_a_curve_without_points_or_on_the_diagonal_does_nothing(self) -> None:
        image = scene()
        assert (
            apply(image, Adjustments(curves={**curves.neutral(), "master": [[0, 0], [1, 1]]}))
            is image
        )
        assert apply(image, Adjustments(curves=curves.neutral())) is image

    def test_the_master_curve_lifts_the_mid_tones(self) -> None:
        lifted = Adjustments(curves={**curves.neutral(), "master": [[0, 0], [0.5, 0.7], [1, 1]]})
        assert mean(apply(grey(128), lifted)) > 160

    def test_a_curve_is_monotone_when_its_points_are(self) -> None:
        points = [[0, 0.1], [0.3, 0.25], [0.6, 0.9], [1, 0.95]]
        table = curves.table(points)
        assert np.all(np.diff(table) >= -1e-6)
        assert abs(table[0] - 0.1) < 1e-3 and abs(table[-1] - 0.95) < 1e-3

    def test_a_channel_curve_changes_only_that_channel(self) -> None:
        red_up = Adjustments(curves={**curves.neutral(), "r": [[0, 0], [0.5, 0.8], [1, 1]]})
        out = apply(grey(128), red_up)
        assert out[0, 0, 2] > 190 and out[0, 0, 0] == 128 and out[0, 0, 1] == 128

    def test_a_negative_slope_inverts(self) -> None:
        inverted = Adjustments(curves={**curves.neutral(), "master": [[0, 1], [1, 0]]})
        assert abs(int(apply(grey(60), inverted)[0, 0, 0]) - 195) <= 2


class TestColourMixer:
    def mix(self, **colours: list[float]) -> Adjustments:
        return Adjustments(hsl={**hslmix.neutral(), **colours})

    def test_it_moves_only_the_chosen_colour(self) -> None:
        green, red = colour(40, 200, 40), colour(40, 40, 200)
        down = self.mix(green=[0, -1, 0])
        assert (
            apply(green, down).astype(int).std(axis=2).mean() < green.astype(int).std(axis=2).mean()
        )
        assert np.abs(apply(red, down).astype(int) - red.astype(int)).max() <= 2

    def test_brightness_and_hue_move_the_colour(self) -> None:
        blue = colour(200, 60, 40)
        assert mean(apply(blue, self.mix(blue=[0, 0, -1]))) < mean(blue)
        shifted = apply(blue, self.mix(blue=[1, 0, 0]))
        assert not np.array_equal(shifted, blue)

    def test_neighbouring_colours_hand_over_smoothly(self) -> None:
        table = hslmix.deltas(hslmix.clean({"red": [0, 1, 0]}) or {})
        saturation = table[:, 1]
        assert saturation[0] == pytest.approx(1.0) and saturation[30] == pytest.approx(0.0)
        assert 0 < saturation[15] < 1 and saturation[345] > 0  # red wraps round past 359


class TestSchema:
    def test_old_corrections_load_with_neutral_new_fields(self) -> None:
        old = {"exposure": 0.5, "contrast": 0, "highlights": 0, "shadows": 0, "temperature": 0,
               "tint": 0, "saturation": 0, "lut_id": None, "lut_strength": 1}  # fmt: skip
        adj = parse(old)
        assert adj.exposure == 0.5 and adj.whites == 0 and adj.crop is None and adj.rotate == 0
        assert set(validate(old)) == set(adjust.KEYS)

    @pytest.mark.parametrize(
        "bad",
        [
            {"whites": 2},
            {"sharpen": -0.1},
            {"vignette": "x"},
            {"curves": {"master": [[0, 0], [0.5, 2]]}},
            {"curves": {"master": [[0.5, 0], [0.4, 1]]}},
            {"curves": {"alpha": []}},
            {"curves": {"master": [[i / 20, i / 20] for i in range(13)]}},
            {"hsl": {"pink": [0, 0, 0]}},
            {"hsl": {"red": [0, 0]}},
            {"hsl": {"red": [0, 0, 3]}},
        ],
    )
    def test_bad_values_are_refused(self, bad: dict[str, Any]) -> None:
        with pytest.raises(RpcError) as caught:
            validate(bad)
        assert caught.value.code == INVALID_PARAMS

    def test_a_full_dict_round_trips(self) -> None:
        adj = Adjustments(
            whites=0.2, curves={**curves.neutral(), "g": [[0, 0], [1, 0.9]]},
            hsl={**hslmix.neutral(), "aqua": [0.1, 0.2, 0.3]}, crop=[0.1, 0.1, 0.9, 0.8],
            rotate=1, flip=True, angle=-3.5, aspect="3:2",
        )  # fmt: skip
        assert parse(adj.as_dict()) == adj


def test_the_automatic_correction_keeps_everything_but_the_basic_sliders() -> None:
    from mejores_engine import autofix

    old = Adjustments(
        whites=0.3, rotate=1, crop=[0.1, 0.1, 0.9, 0.9], lut_id="x", exposure=1.0,
        curves={**curves.neutral(), "master": [[0, 0], [0.5, 0.6], [1, 1]]},
    )  # fmt: skip
    new = Adjustments(exposure=-0.4, contrast=0.2)
    merged = autofix._with_look_of(old, new)
    assert (merged.exposure, merged.contrast) == (-0.4, 0.2)
    assert merged.whites == 0.3 and merged.rotate == 1 and merged.lut_id == "x"
    assert merged.crop == [0.1, 0.1, 0.9, 0.9] and merged.curves == old.curves
