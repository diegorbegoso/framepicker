"""Basic colour corrections: exposure, contrast, highlights, shadows, white balance, saturation and
a LUT. Pure numpy on the picture's pixels; nothing here touches files or the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from mejores_engine import luts
from mejores_engine.rpc import INVALID_PARAMS, RpcError

BAND_ROWS = 256  # rows per step, so a 24 MP export never holds the whole picture in floats
SLIDERS = ("contrast", "highlights", "shadows", "temperature", "tint", "saturation")
KEYS = ("exposure", *SLIDERS, "lut_id", "lut_strength")


@dataclass(frozen=True)
class Adjustments:
    exposure: float = 0.0  # stops, -2..2
    contrast: float = 0.0  # -1..1
    highlights: float = 0.0
    shadows: float = 0.0
    temperature: float = 0.0  # negative cooler, positive warmer
    tint: float = 0.0  # negative greener, positive more magenta
    saturation: float = 0.0
    lut_id: str | None = None
    lut_strength: float = 1.0  # 0..1

    @property
    def is_identity(self) -> bool:
        no_colour = not any(getattr(self, name) for name in ("exposure", *SLIDERS))
        return no_colour and self.lut_id is None

    def as_dict(self) -> dict[str, Any]:
        return {key: getattr(self, key) for key in KEYS}


def _bad(message: str) -> RpcError:
    return RpcError(INVALID_PARAMS, message)


def validate(value: Any) -> dict[str, Any]:
    """The adjustments as a clean dict, or INVALID_PARAMS."""
    if not isinstance(value, dict) or set(value) != set(KEYS):
        raise _bad("adjustments need exactly " + ", ".join(KEYS))
    clean: dict[str, Any] = {}
    for key in ("exposure", *SLIDERS, "lut_strength"):
        number = value[key]
        if isinstance(number, bool) or not isinstance(number, int | float):
            raise _bad(f"{key} must be a number")
        low, high = (
            (-2.0, 2.0)
            if key == "exposure"
            else (0.0, 1.0)
            if key == "lut_strength"
            else (-1.0, 1.0)
        )
        if not low <= number <= high:
            raise _bad(f"{key} must be between {low:g} and {high:g}")
        clean[key] = float(number)
    lut_id = value["lut_id"]
    if lut_id is not None and (not isinstance(lut_id, str) or not lut_id):
        raise _bad("lut_id must be a LUT id or null")
    clean["lut_id"] = lut_id
    return clean


def parse(value: Any) -> Adjustments:
    return Adjustments(**validate(value))


def _luma(px: NDArray[np.float32]) -> NDArray[np.float32]:
    """Brightness of BGR pixels, shape (h, w, 1)."""
    weights = np.array([0.114, 0.587, 0.299], dtype=np.float32)
    return np.asarray((px * weights).sum(axis=2, keepdims=True), dtype=np.float32)


def _band(band: NDArray[np.uint8], adj: Adjustments) -> NDArray[np.float32]:
    px = band.astype(np.float32) / 255.0
    if adj.exposure:
        px *= np.float32(2.0**adj.exposure)
    if adj.temperature or adj.tint:
        # BGR order: warmer lifts red and lowers blue; more magenta lowers green.
        gains = np.array(
            [1 - 0.2 * adj.temperature, 1 - 0.15 * adj.tint, 1 + 0.2 * adj.temperature],
            dtype=np.float32,
        )
        px *= gains
    if adj.contrast:
        px = (px - 0.5) * np.float32(1 + adj.contrast) + 0.5
    if adj.highlights or adj.shadows:
        luma = _luma(np.clip(px, 0, 1))
        px = px + np.float32(adj.highlights * 0.3) * np.clip((luma - 0.5) * 2, 0, 1)
        px = px + np.float32(adj.shadows * 0.3) * np.clip((0.5 - luma) * 2, 0, 1)
    if adj.saturation:
        luma = _luma(np.clip(px, 0, 1))
        px = luma + (px - luma) * np.float32(1 + adj.saturation)
    return np.asarray(np.clip(px, 0.0, 1.0), dtype=np.float32)


def apply(
    bgr: NDArray[np.uint8], adj: Adjustments, lut: luts.Lut | None = None
) -> NDArray[np.uint8]:
    """The picture with the corrections and, when given, the LUT; BGR in, BGR out."""
    use_lut = lut is not None and adj.lut_strength > 0
    if adj.is_identity or (
        not use_lut and not any(getattr(adj, n) for n in ("exposure", *SLIDERS))
    ):
        return bgr
    out = np.empty_like(bgr)
    for start in range(0, bgr.shape[0], BAND_ROWS):
        corrected = _band(bgr[start : start + BAND_ROWS], adj)
        base = np.asarray(corrected * 255.0 + 0.5, dtype=np.uint8)
        if lut is not None and use_lut:
            graded = luts.apply(base, lut)
            if adj.lut_strength < 1:
                mixed = base.astype(np.float32) * (1 - adj.lut_strength)
                mixed += graded.astype(np.float32) * adj.lut_strength
                graded = np.asarray(mixed + 0.5, dtype=np.uint8)
            base = graded
        out[start : start + BAND_ROWS] = base
    return out
