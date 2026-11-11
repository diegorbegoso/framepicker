"""Explainable per-burst scoring and the automatic pick.

Scores are relative: sharpness is normalised inside each burst, because the question is which of
these near-identical frames is best, not how sharp a photo is in absolute terms.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mejores_engine import grouping
from mejores_engine.grouping import natural_key
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, RpcError

METRICS = ("sharpness", "exposure", "eyes")


@dataclass(frozen=True)
class Scored:
    photo_id: str
    name: str  # file name, the tie-breaker in natural order
    sharpness: float
    exposure: float
    eyes_open: float | None


def sharpness_norm(values: list[float]) -> list[float]:
    top = max(values, default=0.0)
    if top <= 0:
        return [1.0 for _ in values]
    return [value / top for value in values]


def fill_eyes(values: list[float | None]) -> list[float | None]:
    known = [value for value in values if value is not None]
    if not known:
        return list(values)
    average = sum(known) / len(known)
    return [average if value is None else value for value in values]


def combined(sharp: float, exposure: float, eyes: float | None, weights: dict[str, float]) -> float:
    pairs = [(weights.get("sharpness", 0.0), sharp), (weights.get("exposure", 0.0), exposure)]
    if eyes is not None:
        pairs.append((weights.get("eyes", 0.0), eyes))
    total = sum(weight for weight, _ in pairs)
    if total <= 0:
        return 0.0
    return sum(weight * value for weight, value in pairs) / total


def rank(members: list[Scored], weights: dict[str, float]) -> list[dict[str, Any]]:
    """Per-member score breakdown, in the members' original order."""
    norms = sharpness_norm([member.sharpness for member in members])
    eyes = fill_eyes([member.eyes_open for member in members])
    return [
        {
            "photo_id": member.photo_id,
            "name": member.name,
            "sharpness": member.sharpness,
            "sharpness_norm": norm,
            "exposure": member.exposure,
            "eyes_open": eye,
            "combined": combined(norm, member.exposure, eye, weights),
        }
        for member, norm, eye in zip(members, norms, eyes, strict=True)
    ]


def choose(members: list[Scored], weights: dict[str, float], per_burst: int) -> list[str]:
    ranked = sorted(rank(members, weights), key=lambda r: (-r["combined"], natural_key(r["name"])))
    return [row["photo_id"] for row in ranked[:per_burst]]


def _members(conn: sqlite3.Connection, burst_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT p.id, p.path, p.format, s.sharpness, s.exposure, s.eyes_open FROM burst_members m "
        "JOIN photos p ON p.id = m.photo_id LEFT JOIN scores s ON s.photo_id = p.id "
        "WHERE m.burst_id = ? ORDER BY m.position",
        (burst_id,),
    ).fetchall()


def select_session(
    conn: sqlite3.Connection, session_id: str, current: dict[str, Any]
) -> list[dict[str, Any]]:
    """Pick the best frames of every burst, keeping any burst the user already touched."""
    if conn.execute("SELECT 1 FROM bursts WHERE session_id = ?", (session_id,)).fetchone() is None:
        grouping.rebuild(
            conn, session_id, float(current["time_gap_s"]), int(current["hamming_max"])
        )
    weights = {name: float(value) for name, value in current["weights"].items()}
    per_burst = int(current["per_burst"])
    bursts = conn.execute(
        "SELECT id, position FROM bursts WHERE session_id = ? ORDER BY position", (session_id,)
    ).fetchall()
    result: list[dict[str, Any]] = []
    for burst in bursts:
        burst_id = str(burst["id"])
        rows = _members(conn, burst_id)
        members = [
            Scored(
                photo_id=str(row["id"]),
                name=Path(str(row["path"])).name,
                sharpness=float(row["sharpness"] or 0.0),
                exposure=float(row["exposure"] or 0.0),
                eyes_open=row["eyes_open"],
            )
            for row in rows
        ]
        user_locked = conn.execute(
            "SELECT 1 FROM selections WHERE burst_id = ? AND source = 'user'", (burst_id,)
        ).fetchone()
        if user_locked is None:
            picked = set(choose(members, weights, per_burst))
            for member in members:
                conn.execute(
                    "INSERT OR REPLACE INTO selections (burst_id, photo_id, source, selected) "
                    "VALUES (?, ?, 'auto', ?)",
                    (burst_id, member.photo_id, int(member.photo_id in picked)),
                )
        stored = {
            str(row["photo_id"]): row
            for row in conn.execute(
                "SELECT photo_id, source, selected FROM selections WHERE burst_id = ?", (burst_id,)
            )
        }
        photos = []
        for row, breakdown in zip(rows, rank(members, weights), strict=True):
            selection = stored.get(str(row["id"]))
            photos.append(
                {
                    "id": str(row["id"]),
                    "path": str(row["path"]),
                    "format": str(row["format"]),
                    "scores": {
                        key: breakdown[key]
                        for key in ("sharpness", "sharpness_norm", "exposure", "eyes_open")
                    }
                    | {"combined": breakdown["combined"]},
                    "selected": bool(selection["selected"]) if selection else False,
                    "source": str(selection["source"]) if selection else "auto",
                }
            )
        result.append({"id": burst_id, "position": int(burst["position"]), "photos": photos})
    return result


def confirm_burst(conn: sqlite3.Connection, burst_id: str) -> int:
    """Mark a burst as reviewed, keeping its picks as they are. Returns how many rows it marked."""
    if conn.execute("SELECT 1 FROM bursts WHERE id = ?", (burst_id,)).fetchone() is None:
        raise RpcError(NOT_FOUND, f"burst not found: {burst_id}")
    marked = conn.execute("UPDATE selections SET source = 'user' WHERE burst_id = ?", (burst_id,))
    if marked.rowcount == 0:
        raise RpcError(INVALID_PARAMS, "the burst has no selections yet; run select first")
    return int(marked.rowcount)


def set_pick(conn: sqlite3.Connection, burst_id: str, photo_id: str, selected: bool) -> None:
    member = conn.execute(
        "SELECT 1 FROM burst_members WHERE burst_id = ? AND photo_id = ?", (burst_id, photo_id)
    ).fetchone()
    if member is None:
        raise RpcError(NOT_FOUND, f"photo {photo_id} is not in burst {burst_id}")
    conn.execute(
        "INSERT OR REPLACE INTO selections (burst_id, photo_id, source, selected) "
        "VALUES (?, ?, 'user', ?)",
        (burst_id, photo_id, int(selected)),
    )
