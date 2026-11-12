"""Detail and finishing: clarity, sharpening and vignette. Radii are proportional to the long side
of the picture, so a 1000 px preview and the full-size export look alike.
"""

from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray

CLARITY_BASE = 800  # clarity measures its blur on a copy shrunk to this long side
CLARITY_SIGMA = 12.0  # on that copy
BAND_ROWS = 256
_LUMA = np.array([0.114, 0.587, 0.299], dtype=np.float32)


def clarity(bgr: NDArray[np.uint8], amount: float) -> NDArray[np.uint8]:
    """Local contrast on the mid-tones: the picture minus a very soft copy of itself, added back."""
    h, w = bgr.shape[:2]
    scale = min(1.0, CLARITY_BASE / max(h, w))
    if scale == 1.0:
        small = bgr
    else:
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        small = np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    luma_small = (small.astype(np.float32) / 255.0) @ _LUMA
    soft = cv2.GaussianBlur(np.asarray(luma_small, dtype=np.float32), (0, 0), CLARITY_SIGMA)
    if scale != 1.0:
        soft = cv2.resize(soft, (w, h), interpolation=cv2.INTER_LINEAR)
    out = np.empty_like(bgr)
    for start in range(0, h, BAND_ROWS):
        px = bgr[start : start + BAND_ROWS].astype(np.float32) / 255.0
        luma = px @ _LUMA
        mid = np.clip(4.0 * luma * (1.0 - luma), 0.0, 1.0)  # strongest at mid grey
        gain = (amount * 0.9) * (luma - soft[start : start + BAND_ROWS]) * mid
        px += gain[:, :, None]
        out[start : start + BAND_ROWS] = np.asarray(np.clip(px, 0, 1) * 255.0 + 0.5, dtype=np.uint8)
    return out


def sharpen(bgr: NDArray[np.uint8], amount: float) -> NDArray[np.uint8]:
    """Unsharp mask whose radius follows the picture size."""
    sigma = 0.5 + max(bgr.shape[:2]) * 0.0006
    soft = cv2.GaussianBlur(bgr, (0, 0), sigma)
    strength = amount * 1.5
    return np.asarray(cv2.addWeighted(bgr, 1.0 + strength, soft, -strength, 0), dtype=np.uint8)


def vignette(
    px: NDArray[np.float32], first_row: int, width: int, height: int, amount: float
) -> NDArray[np.float32]:
    """Darkens (negative) or lightens (positive) towards the corners of the whole picture."""
    rows = first_row + np.arange(px.shape[0], dtype=np.float32) + 0.5
    y = (rows / height * 2.0 - 1.0)[:, None]
    x = ((np.arange(width, dtype=np.float32) + 0.5) / width * 2.0 - 1.0)[None, :]
    r2 = (x * x + y * y) * 0.5  # 0 in the centre, 1 at the corners
    t = np.clip((r2 - 0.25) / 0.75, 0.0, 1.0)
    falloff = t * t * (3.0 - 2.0 * t)
    factor = 1.0 + amount * 0.9 * falloff
    return np.asarray(px * factor[:, :, None], dtype=np.float32)
