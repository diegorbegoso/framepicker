"""Colour mixer: hue, saturation and brightness moved separately for eight colour ranges, with a
smooth hand-over between neighbouring colours.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

COLORS = ("red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta")
CENTERS = (0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 320.0)  # degrees of hue
HUE_SPAN = 30.0  # degrees a full hue slider moves a colour
LIGHT_SPAN = 0.5


def neutral() -> dict[str, list[float]]:
    return {name: [0.0, 0.0, 0.0] for name in COLORS}


def is_neutral(mix: dict[str, list[float]]) -> bool:
    return not any(any(values) for values in mix.values())


def clean(value: Any) -> dict[str, list[float]] | None:
    """The mixer as a normal dict (every colour present), or None when `value` is not valid."""
    if not isinstance(value, dict) or not set(value) <= set(COLORS):
        return None
    out = neutral()
    for name, values in value.items():
        if not isinstance(values, list | tuple) or len(values) != 3:
            return None
        if any(isinstance(n, bool) or not isinstance(n, int | float) for n in values):
            return None
        if any(not -1.0 <= n <= 1.0 for n in values):
            return None
        out[name] = [float(n) for n in values]
    return out


def _weights() -> NDArray[np.float64]:
    """Weight of each colour at every whole degree, shape (360, 8); each row adds up to 1."""
    weights = np.zeros((360, len(CENTERS)))
    for degree in range(360):
        for i, start in enumerate(CENTERS):
            end = CENTERS[i + 1] if i + 1 < len(CENTERS) else 360.0
            if start <= degree < end:
                t = (degree - start) / (end - start)
                weights[degree, i] = 1 - t
                weights[degree, (i + 1) % len(CENTERS)] += t
                break
    return weights


_WEIGHTS = _weights()


def deltas(mix: dict[str, list[float]]) -> NDArray[np.float32]:
    """Per whole degree of hue: how far to move hue, saturation and brightness (each -1..1)."""
    values = np.array([mix[name] for name in COLORS], dtype=np.float64)
    return np.asarray(_WEIGHTS @ values, dtype=np.float32)


def apply(px: NDArray[np.float32], table: NDArray[np.float32]) -> NDArray[np.float32]:
    """Float BGR pixels in 0..1 with the mixer applied."""
    hsv = cv2.cvtColor(np.clip(px, 0.0, 1.0), cv2.COLOR_BGR2HSV)
    steps = hsv[:, :, 0].astype(np.int32) % 360
    move = table[steps]
    hsv[:, :, 0] = (hsv[:, :, 0] + move[:, :, 0] * HUE_SPAN) % 360.0
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * (1.0 + move[:, :, 1]), 0.0, 1.0)
    hsv[:, :, 2] = np.clip(hsv[:, :, 2] * (1.0 + move[:, :, 2] * LIGHT_SPAN), 0.0, 1.0)
    return np.asarray(cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR), dtype=np.float32)
