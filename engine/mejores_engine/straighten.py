"""Suggests the angle that levels a photo, from the long straight lines in it (a horizon, a door
frame, a building edge). The RPC only reads the photo; the person decides whether to use it.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from mejores_engine import features
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher, RpcError
from mejores_engine.store import Store

WORK_PX = 800
LIMIT = 10.0  # degrees: a line tilted more than this is probably meant to be diagonal
MIN_LINES = 3
AGREE_WITHIN = 1.5  # degrees
MAX_EDGES = 0.15  # share of edge pixels above which the picture is texture, not lines
AGREE_SHARE = 0.4  # of the total line length must agree for the answer to count


def _weighted_median(values: list[float], weights: list[float]) -> float:
    order = np.argsort(values)
    cumulative = np.cumsum(np.array(weights)[order])
    return float(np.array(values)[order][int(np.searchsorted(cumulative, cumulative[-1] / 2))])


def suggest(bgr: NDArray[np.uint8]) -> float | None:
    """Degrees to turn the picture clockwise to level it (negative: counter-clockwise), or None
    when it has no clear horizontal or vertical lines."""
    h, w = bgr.shape[:2]
    scale = min(1.0, WORK_PX / max(h, w))
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    if scale < 1.0:
        gray = cv2.resize(
            gray, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA
        )
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 60, 160)
    if float(np.count_nonzero(edges)) / edges.size > MAX_EDGES:
        return None
    long_side = max(gray.shape[:2])
    found = cv2.HoughLinesP(
        edges, 1, np.pi / 720, 60, minLineLength=int(long_side * 0.15), maxLineGap=8
    )
    if found is None:
        return None
    tilts: list[float] = []
    lengths: list[float] = []
    for x1, y1, x2, y2 in np.asarray(found).reshape(-1, 4):
        angle = math.degrees(math.atan2(float(y2 - y1), float(x2 - x1)))
        tilt = (angle + 45.0) % 90.0 - 45.0  # distance from the nearest axis, -45..45
        if abs(tilt) <= LIMIT:
            tilts.append(tilt)
            lengths.append(math.hypot(float(x2 - x1), float(y2 - y1)))
    if len(tilts) < MIN_LINES:
        return None
    middle = _weighted_median(tilts, lengths)
    agreeing = sum(
        n for t, n in zip(tilts, lengths, strict=True) if abs(t - middle) <= AGREE_WITHIN
    )
    if agreeing < AGREE_SHARE * sum(lengths):
        return None
    return round(-middle, 1)


def register(dispatcher: Dispatcher, store: Callable[[], Store]) -> None:
    @dispatcher.register("straighten_suggest")
    def straighten_suggest(params: dict[str, Any]) -> dict[str, Any]:
        photo_id = params.get("photo_id")
        if not isinstance(photo_id, str) or not photo_id:
            raise RpcError(INVALID_PARAMS, "photo_id must be a non-empty string")
        with store().session() as conn:
            row = conn.execute(
                "SELECT path, format FROM photos WHERE id = ?", (photo_id,)
            ).fetchone()
        if row is None:
            raise RpcError(NOT_FOUND, f"photo not found: {photo_id}")
        bgr, _w, _h = features.scaled_base(Path(row["path"]), str(row["format"]), WORK_PX, False)
        angle = suggest(bgr)
        return {"found": angle is not None, "angle": angle or 0.0}
