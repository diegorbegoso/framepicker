"""Straightening, cropping, quarter turns and mirroring: pure functions of the pixels.

The angle turns the picture and then the canvas is cut to the biggest rectangle of the same
proportion that fits inside the turned picture, so no empty corner ever shows. The crop is measured
on that straightened canvas, as fractions of its width and height.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
from numpy.typing import NDArray

MAX_ANGLE = 45.0
MIN_CROP = 0.02  # smallest side of a crop, as a fraction of the canvas


def fit_factor(width: int, height: int, angle: float) -> float:
    """How much of the picture's size the straightened canvas keeps (1 when not turned)."""
    theta = math.radians(abs(angle))
    longer, shorter = max(width, height), min(width, height)
    return 1.0 / (math.cos(theta) + (longer / shorter) * math.sin(theta))


def canvas_size(width: int, height: int, angle: float) -> tuple[float, float]:
    k = fit_factor(width, height, angle)
    return width * k, height * k


def output_size(width: int, height: int, angle: float, crop: list[float] | None) -> tuple[int, int]:
    """The size of the picture after turning and cutting (already counting quarter turns)."""
    cw, ch = canvas_size(width, height, angle)
    x0, y0, x1, y1 = crop if crop else (0.0, 0.0, 1.0, 1.0)
    return max(1, round((x1 - x0) * cw)), max(1, round((y1 - y0) * ch))


def apply(
    bgr: NDArray[np.uint8], rotate: int, flip: bool, angle: float, crop: list[float] | None
) -> NDArray[np.uint8]:
    """Quarter turns clockwise, mirror, straighten by `angle` degrees (positive turns the picture
    clockwise), then cut to `crop` = [x0, y0, x1, y1]."""
    out = bgr
    if rotate % 4:
        out = np.ascontiguousarray(np.rot90(out, -(rotate % 4)))
    if flip:
        out = np.ascontiguousarray(out[:, ::-1])
    h, w = out.shape[:2]
    x0, y0, x1, y1 = crop if crop else (0.0, 0.0, 1.0, 1.0)
    if abs(angle) < 1e-9:
        if not crop:
            return out
        left, right = round(x0 * w), max(round(x0 * w) + 1, round(x1 * w))
        top, bottom = round(y0 * h), max(round(y0 * h) + 1, round(y1 * h))
        return np.ascontiguousarray(out[top:bottom, left:right])
    cw, ch = canvas_size(w, h, angle)
    ow, oh = max(1, round((x1 - x0) * cw)), max(1, round((y1 - y0) * ch))
    centre = (w / 2.0, h / 2.0)
    matrix = cv2.getRotationMatrix2D(centre, -angle, 1.0)  # OpenCV turns counter-clockwise
    matrix[0, 2] -= centre[0] - cw / 2.0 + x0 * cw
    matrix[1, 2] -= centre[1] - ch / 2.0 + y0 * ch
    return np.asarray(
        cv2.warpAffine(
            out, matrix, (ow, oh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        ),
        dtype=np.uint8,
    )
