"""User settings, stored as JSON text in the settings table with typed defaults."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from mejores_engine.rpc import INVALID_PARAMS, RpcError

DEFAULTS: dict[str, Any] = {
    "theme": "light",
    "weights": {"sharpness": 0.6, "exposure": 0.2, "eyes": 0.2},
    "per_burst": 1,
    # Below any of these a photo is never picked automatically, even when it is alone in its burst.
    # Sharpness is the absolute Laplacian variance; 0 switches a minimum off.
    "min_quality": {"sharpness": 90.0, "exposure": 0.55, "eyes": 0.40},
    "time_gap_s": 2.0,
    "hamming_max": 22,
    # The LUT the previews are shown through (a LUT library id), or None for the photos as shot.
    "view_lut": None,
}

THEMES = ("light", "dark")


def _bad(message: str) -> RpcError:
    return RpcError(INVALID_PARAMS, message)


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _bad(f"{name} must be a number")
    return float(value)


def validate(key: str, value: Any) -> Any:
    if key not in DEFAULTS:
        raise _bad(f"unknown setting: {key}")
    if key == "theme":
        if value not in THEMES:
            raise _bad("theme must be 'light' or 'dark'")
        return value
    if key == "weights":
        if not isinstance(value, dict) or set(value) != {"sharpness", "exposure", "eyes"}:
            raise _bad("weights needs exactly sharpness, exposure and eyes")
        numbers = {name: _number(value[name], f"weights.{name}") for name in value}
        if any(n < 0 for n in numbers.values()) or sum(numbers.values()) <= 0:
            raise _bad("weights must be non-negative and not all zero")
        return numbers
    if key == "view_lut":
        if value is not None and (not isinstance(value, str) or not value):
            raise _bad("view_lut must be a LUT id or null")
        return value
    if key == "min_quality":
        if not isinstance(value, dict) or set(value) != {"sharpness", "exposure", "eyes"}:
            raise _bad("min_quality needs exactly sharpness, exposure and eyes")
        minimums = {name: _number(value[name], f"min_quality.{name}") for name in value}
        if minimums["sharpness"] < 0 or minimums["sharpness"] > 100000:
            raise _bad("min_quality.sharpness must be between 0 and 100000")
        if not all(0.0 <= minimums[name] <= 1.0 for name in ("exposure", "eyes")):
            raise _bad("min_quality.exposure and min_quality.eyes must be between 0 and 1")
        return minimums
    if key == "per_burst":
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 20:
            raise _bad("per_burst must be an integer from 1 to 20")
        return value
    if key == "time_gap_s":
        number = _number(value, key)
        if not 0.0 <= number <= 60.0:
            raise _bad("time_gap_s must be between 0 and 60")
        return number
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 64:
        raise _bad("hamming_max must be an integer from 0 to 64")
    return value


def get_all(conn: sqlite3.Connection) -> dict[str, Any]:
    result = dict(DEFAULTS)
    for row in conn.execute("SELECT key, value FROM settings").fetchall():
        if row["key"] in DEFAULTS:
            result[str(row["key"])] = json.loads(row["value"])
    return result


def set_value(conn: sqlite3.Connection, key: str, value: Any) -> Any:
    clean = validate(key, value)
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(clean)),
    )
    return clean
