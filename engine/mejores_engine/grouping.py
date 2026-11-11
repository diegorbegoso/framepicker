"""Burst grouping: consecutive frames that are close in time and look alike."""

from __future__ import annotations

import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from mejores_engine.features import hamming_hex

_DIGITS = re.compile(r"(\d+)")


@dataclass(frozen=True)
class Frame:
    photo_id: str
    name: str  # file name, used for natural ordering
    when: float  # seconds since the epoch
    dhash: str | None  # None when the photo failed to decode


def natural_key(name: str) -> list[object]:
    """Sort key comparing digit runs as numbers: "IMG_10" sorts after "IMG_2"."""
    key: list[object] = []
    for chunk in _DIGITS.split(name.lower()):
        key.append((0, int(chunk), "") if chunk.isdigit() else (1, 0, chunk))
    return key


def when_of(exif_time: str | None, mtime_ns: int) -> float:
    """Capture time in local epoch seconds; the file's modification time when EXIF is missing."""
    if exif_time:
        try:
            return datetime.fromisoformat(exif_time).timestamp()
        except ValueError:
            pass
    return mtime_ns / 1e9


def _sort_key(frame: Frame) -> tuple[float, list[object], str]:
    return (frame.when, natural_key(frame.name), frame.photo_id)


def _joins(prev: Frame, nxt: Frame, time_gap_s: float, hamming_max: int) -> bool:
    if prev.dhash is None or nxt.dhash is None:
        return False
    if nxt.when - prev.when > time_gap_s:
        return False
    return hamming_hex(prev.dhash, nxt.dhash) <= hamming_max


def group_frames(frames: list[Frame], time_gap_s: float, hamming_max: int) -> list[list[Frame]]:
    groups: list[list[Frame]] = []
    for frame in sorted(frames, key=_sort_key):
        if groups and _joins(groups[-1][-1], frame, time_gap_s, hamming_max):
            groups[-1].append(frame)
        else:
            groups.append([frame])
    return groups


def rebuild(
    conn: sqlite3.Connection, session_id: str, time_gap_s: float, hamming_max: int
) -> list[dict[str, Any]]:
    """Replace the session's bursts with a fresh grouping and return them in order."""
    rows = conn.execute(
        "SELECT id, path, format, exif_time, mtime_ns, dhash FROM photos WHERE session_id = ?",
        (session_id,),
    ).fetchall()
    by_id = {str(row["id"]): row for row in rows}
    frames = [
        Frame(
            photo_id=str(row["id"]),
            name=Path(str(row["path"])).name,
            when=when_of(row["exif_time"], int(row["mtime_ns"])),
            dhash=row["dhash"],
        )
        for row in rows
    ]
    conn.execute("DELETE FROM bursts WHERE session_id = ?", (session_id,))
    result: list[dict[str, Any]] = []
    for position, group in enumerate(group_frames(frames, time_gap_s, hamming_max)):
        burst_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO bursts (id, session_id, position) VALUES (?, ?, ?)",
            (burst_id, session_id, position),
        )
        photos: list[dict[str, Any]] = []
        for member_position, frame in enumerate(group):
            conn.execute(
                "INSERT INTO burst_members (burst_id, photo_id, position) VALUES (?, ?, ?)",
                (burst_id, frame.photo_id, member_position),
            )
            row = by_id[frame.photo_id]
            photos.append(
                {
                    "id": frame.photo_id,
                    "path": str(row["path"]),
                    "format": str(row["format"]),
                    "exif_time": row["exif_time"],
                }
            )
        result.append({"id": burst_id, "position": position, "photos": photos})
    return result
