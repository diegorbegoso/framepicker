"""Tone curves: a master curve and one per colour channel, each a few points joined by a monotone
cubic (Fritsch-Carlson), so a curve never overshoots between its points.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

SIZE = 1024  # entries of a lookup table
CHANNELS = ("master", "r", "g", "b")
MAX_POINTS = 12
MIN_GAP = 0.005  # points closer than this in x would make the curve a cliff


def neutral() -> dict[str, list[list[float]]]:
    return {name: [] for name in CHANNELS}


def is_straight(points: list[list[float]]) -> bool:
    """A curve with fewer than two points, or lying on the diagonal, changes nothing."""
    return len(points) < 2 or all(abs(x - y) < 1e-6 for x, y in points)


def all_straight(curves: dict[str, list[list[float]]]) -> bool:
    return all(is_straight(curves[name]) for name in CHANNELS)


def clean(value: Any) -> dict[str, list[list[float]]] | None:
    """The curves as a normal dict, or None when `value` is not valid."""
    if not isinstance(value, dict) or not set(value) <= set(CHANNELS):
        return None
    out = neutral()
    for name, points in value.items():
        if not isinstance(points, list) or len(points) > MAX_POINTS:
            return None
        rows: list[list[float]] = []
        for point in points:
            if not (isinstance(point, list | tuple) and len(point) == 2):
                return None
            if any(isinstance(n, bool) or not isinstance(n, int | float) for n in point):
                return None
            x, y = float(point[0]), float(point[1])
            if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                return None
            if rows and x - rows[-1][0] < MIN_GAP:
                return None
            rows.append([x, y])
        out[name] = rows
    return out


def _slopes(xs: NDArray[np.float64], ys: NDArray[np.float64]) -> NDArray[np.float64]:
    h = np.diff(xs)
    d = np.diff(ys) / h
    m = np.zeros(len(xs))
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, len(xs) - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    return m


def table(points: list[list[float]]) -> NDArray[np.float32]:
    """The curve as SIZE values in 0..1, indexed by the input level."""
    grid = np.linspace(0.0, 1.0, SIZE)
    if is_straight(points):
        return grid.astype(np.float32)
    xs = np.array([p[0] for p in points])
    ys = np.array([p[1] for p in points])
    m = _slopes(xs, ys)
    idx = np.clip(np.searchsorted(xs, grid, side="right") - 1, 0, len(xs) - 2)
    h = xs[idx + 1] - xs[idx]
    t = (grid - xs[idx]) / h
    t2, t3 = t * t, t * t * t
    out = (
        (2 * t3 - 3 * t2 + 1) * ys[idx]
        + (t3 - 2 * t2 + t) * h * m[idx]
        + (-2 * t3 + 3 * t2) * ys[idx + 1]
        + (t3 - t2) * h * m[idx + 1]
    )
    out = np.where(grid < xs[0], ys[0], out)
    out = np.where(grid > xs[-1], ys[-1], out)
    return np.asarray(np.clip(out, 0.0, 1.0), dtype=np.float32)


def channel_tables(curves: dict[str, list[list[float]]]) -> list[NDArray[np.float32]]:
    """Tables for the B, G and R planes (the master curve first, then the channel's own)."""
    master = table(curves["master"])
    steps = np.clip(master * (SIZE - 1) + 0.5, 0, SIZE - 1).astype(np.int32)
    return [table(curves[name])[steps] for name in ("b", "g", "r")]


def apply(px: NDArray[np.float32], tables: list[NDArray[np.float32]]) -> None:
    """Applies the tables in place to float BGR pixels in 0..1."""
    for plane, lookup in enumerate(tables):
        steps = np.clip(px[:, :, plane] * (SIZE - 1) + 0.5, 0, SIZE - 1).astype(np.int32)
        px[:, :, plane] = lookup[steps]
