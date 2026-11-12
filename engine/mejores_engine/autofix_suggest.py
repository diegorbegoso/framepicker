"""The measuring half of the automatic correction: what one picture needs. Conservative on
purpose: every value is damped and capped.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
from numpy.typing import NDArray

from mejores_engine.adjust import Adjustments

ANALYSIS_PX = 800
TARGET_MEDIAN = 0.46  # where the middle of the picture should sit


def _round(value: float) -> float:
    return round(float(value), 2)


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def suggest(bgr: NDArray[np.uint8], white_balance: bool = False) -> Adjustments:
    """The corrections that would even this picture out; a well exposed one gets almost none."""
    height, width = bgr.shape[:2]
    if max(height, width) > ANALYSIS_PX:
        scale = ANALYSIS_PX / max(height, width)
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        bgr = np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    rgb = bgr[:, :, ::-1].astype(np.float32) / 255.0
    luma = np.asarray(rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32), dtype=np.float32)
    p2, p50, p98 = (float(v) for v in np.percentile(luma, [2, 50, 98]))

    # Exposure: bring the middle towards the target, but never push the bright part into white.
    wanted = math.log2(TARGET_MEDIAN / max(p50, 0.02)) * 0.8
    if wanted > 0:
        room = math.log2(0.98 / max(p98, 0.05))
        wanted = max(0.0, min(wanted, room))
    exposure = _clip(wanted, -1.5, 1.5)
    if abs(exposure) < 0.1:
        exposure = 0.0
    gain = 2.0**exposure
    lit = np.clip(luma * gain, 0.0, 1.0)

    q2, q98 = (float(v) for v in np.percentile(lit, [2, 98]))
    spread = q98 - q2
    contrast = _clip((0.75 - spread) * 0.9, 0.0, 0.35) if spread < 0.75 else 0.0

    burnt = float(np.mean(luma * gain > 0.96))
    highlights = -min(0.6, max(0.0, burnt - 0.015) * 6.0)
    dark = float(np.mean(lit < 0.08))
    shadows = min(0.35, max(0.0, dark - 0.2) * 0.8)

    chroma = float(np.mean(rgb.max(axis=2) - rgb.min(axis=2)))
    saturation = min(0.15, (0.10 - chroma) * 3.0) if chroma < 0.10 else 0.0

    temperature = tint = 0.0
    if white_balance:
        spread_rgb = rgb.max(axis=2) - rgb.min(axis=2)
        mid = (luma > 0.15) & (luma < 0.85) & (spread_rgb < 0.35)
        if float(mid.mean()) > 0.05:
            red, green, blue = (float(rgb[:, :, i][mid].mean()) for i in range(3))
            temperature = _clip((blue - red) / (0.2 * (blue + red) + 1e-6) * 0.6, -0.4, 0.4)
            tint = _clip((1 - ((red + blue) / 2) / max(green, 1e-6)) / 0.15 * 0.6, -0.3, 0.3)

    return Adjustments(
        exposure=_round(exposure),
        contrast=_round(contrast),
        highlights=_round(highlights),
        shadows=_round(shadows),
        temperature=_round(temperature),
        tint=_round(tint),
        saturation=_round(saturation),
    )
