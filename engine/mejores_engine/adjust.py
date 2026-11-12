"""The corrections of one photo and how they are applied: light, colour, curves, colour mixer,
detail, vignette, a LUT, and the geometry (turn, mirror, straighten, crop). Pure numpy/OpenCV on
the picture's pixels; nothing here touches files or the database.

Order: geometry first (fewer pixels to process), then exposure, white balance, white/black points,
contrast, highlights/shadows, curves, colour mixer, vibrance, saturation, clarity, sharpening,
vignette and finally the LUT.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from mejores_engine import curves, detail, geometry, hslmix, luts
from mejores_engine.rpc import INVALID_PARAMS, RpcError

BAND_ROWS = 256  # rows per step, so a 24 MP export never holds the whole picture in floats
SLIDERS = (
    "contrast", "highlights", "shadows", "temperature", "tint", "saturation",
    "whites", "blacks", "vibrance", "clarity", "vignette",
)  # fmt: skip
TONE_KEYS = ("exposure", *SLIDERS, "sharpen")
GEOMETRY_KEYS = ("rotate", "flip", "angle", "crop", "aspect")
KEYS = (*TONE_KEYS, "curves", "hsl", "lut_id", "lut_strength", *GEOMETRY_KEYS)
RANGES = {"exposure": (-2.0, 2.0), "sharpen": (0.0, 1.0), "lut_strength": (0.0, 1.0)}


@dataclass(frozen=True)
class Adjustments:
    exposure: float = 0.0  # stops, -2..2
    contrast: float = 0.0  # -1..1, like every slider below unless noted
    highlights: float = 0.0
    shadows: float = 0.0
    temperature: float = 0.0  # negative cooler, positive warmer
    tint: float = 0.0  # negative greener, positive more magenta
    saturation: float = 0.0
    lut_id: str | None = None
    lut_strength: float = 1.0  # 0..1
    whites: float = 0.0
    blacks: float = 0.0
    vibrance: float = 0.0
    clarity: float = 0.0
    sharpen: float = 0.0  # 0..1
    vignette: float = 0.0  # negative darkens the corners
    curves: dict[str, list[list[float]]] = field(default_factory=curves.neutral)
    hsl: dict[str, list[float]] = field(default_factory=hslmix.neutral)
    rotate: int = 0  # quarter turns clockwise, 0..3
    flip: bool = False  # mirrored left to right
    angle: float = 0.0  # degrees to straighten, -45..45, positive turns the picture clockwise
    crop: list[float] | None = None  # [x0, y0, x1, y1] on the straightened canvas, 0..1
    aspect: str | None = None  # the proportion the crop was drawn with (kept for the editor)

    @property
    def has_geometry(self) -> bool:
        return bool(self.rotate % 4 or self.flip or self.angle or self.crop)

    @property
    def has_tones(self) -> bool:
        plain = any(getattr(self, name) for name in ("exposure", *SLIDERS[:9]))
        return plain or not curves.all_straight(self.curves) or not hslmix.is_neutral(self.hsl)

    @property
    def is_identity(self) -> bool:
        return not (
            self.has_geometry
            or self.has_tones
            or self.clarity
            or self.sharpen
            or self.vignette
            or self.lut_id is not None
        )

    def as_dict(self) -> dict[str, Any]:
        return {key: getattr(self, key) for key in KEYS}


def _bad(message: str) -> RpcError:
    return RpcError(INVALID_PARAMS, message)


def _number(value: Any, key: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _bad(f"{key} must be a number")
    if not low <= value <= high:
        raise _bad(f"{key} must be between {low:g} and {high:g}")
    return float(value)


def _geometry(value: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "rotate" in value:
        turns = value["rotate"]
        if isinstance(turns, bool) or not isinstance(turns, int) or not 0 <= turns <= 3:
            raise _bad("rotate must be a whole number from 0 to 3")
        out["rotate"] = turns
    if "flip" in value:
        if not isinstance(value["flip"], bool):
            raise _bad("flip must be true or false")
        out["flip"] = value["flip"]
    if "angle" in value:
        out["angle"] = _number(value["angle"], "angle", -geometry.MAX_ANGLE, geometry.MAX_ANGLE)
    if "crop" in value and value["crop"] is not None:
        box = value["crop"]
        if not isinstance(box, list) or len(box) != 4:
            raise _bad("crop must be [x0, y0, x1, y1] or null")
        x0, y0, x1, y1 = (_number(n, "crop", 0.0, 1.0) for n in box)
        if x1 - x0 < geometry.MIN_CROP or y1 - y0 < geometry.MIN_CROP:
            raise _bad("crop is too small")
        out["crop"] = [x0, y0, x1, y1]
    elif "crop" in value:
        out["crop"] = None
    if "aspect" in value:
        aspect = value["aspect"]
        if aspect is not None and (not isinstance(aspect, str) or not 0 < len(aspect) <= 16):
            raise _bad("aspect must be a short text or null")
        out["aspect"] = aspect
    return out


def validate(value: Any) -> dict[str, Any]:
    """The adjustments as a clean, complete dict (missing fields get their neutral value), or
    INVALID_PARAMS. Corrections saved before a field existed therefore still load."""
    if not isinstance(value, dict) or not set(value) <= set(KEYS):
        raise _bad("adjustments may only hold: " + ", ".join(KEYS))
    clean: dict[str, Any] = dict(Adjustments().as_dict())
    for key in (*TONE_KEYS, "lut_strength"):
        if key in value:
            clean[key] = _number(value[key], key, *RANGES.get(key, (-1.0, 1.0)))
    if "lut_id" in value:
        lut_id = value["lut_id"]
        if lut_id is not None and (not isinstance(lut_id, str) or not lut_id):
            raise _bad("lut_id must be a LUT id or null")
        clean["lut_id"] = lut_id
    if "curves" in value:
        tidy = curves.clean(value["curves"])
        if tidy is None:
            raise _bad("curves must hold up to 12 increasing points per channel")
        clean["curves"] = tidy
    if "hsl" in value:
        mix = hslmix.clean(value["hsl"])
        if mix is None:
            raise _bad("hsl must map colours to [hue, saturation, brightness] in -1..1")
        clean["hsl"] = mix
    clean.update(_geometry(value))
    return clean


def parse(value: Any) -> Adjustments:
    return Adjustments(**validate(value))


def _luma(px: NDArray[np.float32]) -> NDArray[np.float32]:
    """Brightness of BGR pixels, shape (h, w, 1)."""
    gray = cv2.cvtColor(np.ascontiguousarray(px), cv2.COLOR_BGR2GRAY)
    return np.asarray(gray[:, :, None], dtype=np.float32)


class _Plan:
    """What a picture needs, worked out once so every band reuses it."""

    def __init__(self, adj: Adjustments) -> None:
        self.adj = adj
        self.tables = None if curves.all_straight(adj.curves) else curves.channel_tables(adj.curves)
        self.mixer = None if hslmix.is_neutral(adj.hsl) else hslmix.deltas(adj.hsl)


def _band(band: NDArray[np.uint8], plan: _Plan) -> NDArray[np.float32]:
    adj = plan.adj
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
    if adj.whites or adj.blacks:
        black = -0.1 * adj.blacks  # positive blacks lift the shadows
        white = 1.0 - 0.25 * adj.whites  # positive whites brighten the top end
        px = (px - np.float32(black)) / np.float32(white - black)
    if adj.contrast:
        px = (px - 0.5) * np.float32(1 + adj.contrast) + 0.5
    if adj.highlights or adj.shadows:
        luma = _luma(np.clip(px, 0, 1))
        px = px + np.float32(adj.highlights * 0.3) * np.clip((luma - 0.5) * 2, 0, 1)
        px = px + np.float32(adj.shadows * 0.3) * np.clip((0.5 - luma) * 2, 0, 1)
    if plan.tables is not None:
        px = np.clip(px, 0.0, 1.0)
        curves.apply(px, plan.tables)
    if plan.mixer is not None:
        px = hslmix.apply(px, plan.mixer)
    if adj.vibrance:
        px = np.clip(px, 0.0, 1.0)
        blue, green, red = px[:, :, 0], px[:, :, 1], px[:, :, 2]
        chroma = np.maximum(np.maximum(blue, green), red) - np.minimum(np.minimum(blue, green), red)
        skin = (red > green) & (green > blue)  # keep skin tones calmer
        gain = np.float32(adj.vibrance) * (1.0 - chroma)
        gain *= np.where(skin, np.float32(0.5), np.float32(1.0))
        gain += 1.0
        luma = _luma(px)
        px = luma + (px - luma) * gain[:, :, None]
    if adj.saturation:
        luma = _luma(np.clip(px, 0, 1))
        px = luma + (px - luma) * np.float32(1 + adj.saturation)
    return np.asarray(np.clip(px, 0.0, 1.0), dtype=np.float32)


def apply_geometry(bgr: NDArray[np.uint8], adj: Adjustments) -> NDArray[np.uint8]:
    """Only the turn, mirror, straightening and crop."""
    if not adj.has_geometry:
        return bgr
    return geometry.apply(bgr, adj.rotate, adj.flip, adj.angle, adj.crop)


def apply_look(
    bgr: NDArray[np.uint8], adj: Adjustments, lut: luts.Lut | None = None
) -> NDArray[np.uint8]:
    """Everything except the geometry; BGR in, BGR out. Never modifies `bgr`."""
    use_lut = lut is not None and adj.lut_strength > 0
    if not (adj.has_tones or adj.clarity or adj.sharpen or adj.vignette or use_lut):
        return bgr
    height, width = bgr.shape[:2]
    plan = _Plan(adj)
    current = bgr
    if adj.has_tones:
        current = np.empty_like(bgr)
        for start in range(0, height, BAND_ROWS):
            corrected = _band(bgr[start : start + BAND_ROWS], plan)
            current[start : start + BAND_ROWS] = np.asarray(corrected * 255.0 + 0.5, dtype=np.uint8)
    if adj.clarity:
        current = detail.clarity(current, adj.clarity)
    if adj.sharpen:
        current = detail.sharpen(current, adj.sharpen)
    if not (adj.vignette or use_lut):
        return current
    out = np.empty_like(bgr)
    for start in range(0, height, BAND_ROWS):
        base = current[start : start + BAND_ROWS]
        if adj.vignette:
            shaded = detail.vignette(
                base.astype(np.float32) / 255.0, start, width, height, adj.vignette
            )
            base = np.asarray(np.clip(shaded, 0.0, 1.0) * 255.0 + 0.5, dtype=np.uint8)
        if lut is not None and use_lut:
            graded = luts.apply(base, lut)
            if adj.lut_strength < 1:
                mixed = base.astype(np.float32) * (1 - adj.lut_strength)
                mixed += graded.astype(np.float32) * adj.lut_strength
                graded = np.asarray(mixed + 0.5, dtype=np.uint8)
            base = graded
        out[start : start + BAND_ROWS] = base
    return out


def apply(
    bgr: NDArray[np.uint8], adj: Adjustments, lut: luts.Lut | None = None
) -> NDArray[np.uint8]:
    """The picture with all the corrections and, when given, the LUT; BGR in, BGR out."""
    return apply_look(apply_geometry(bgr, adj), adj, lut)
