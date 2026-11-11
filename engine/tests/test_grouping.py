from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from mejores_engine.app import build_dispatcher
from mejores_engine.features import hamming_hex
from mejores_engine.grouping import Frame, group_frames, natural_key, when_of
from mejores_engine.rpc import NOT_FOUND
from mejores_engine.store import Store

ZERO = "0000000000000000"


def bits(count: int) -> str:
    """A hash exactly `count` bits away from ZERO."""
    return f"{(1 << count) - 1:016x}"


def ids(groups: list[list[Frame]]) -> list[list[str]]:
    return [[frame.photo_id for frame in group] for group in groups]


def test_helper_hashes_have_the_intended_distance() -> None:
    assert [hamming_hex(ZERO, bits(n)) for n in (6, 22, 23)] == [6, 22, 23]


def test_close_and_similar_frames_form_one_burst() -> None:
    frames = [Frame("a", "a.jpg", 100.0, ZERO), Frame("b", "b.jpg", 100.4, bits(6))]
    assert ids(group_frames(frames, 2.0, 22)) == [["a", "b"]]


def test_a_time_gap_starts_a_new_burst_even_for_identical_frames() -> None:
    frames = [Frame("a", "a.jpg", 100.0, ZERO), Frame("b", "b.jpg", 102.5, ZERO)]
    assert ids(group_frames(frames, 2.0, 22)) == [["a"], ["b"]]


def test_the_hamming_threshold_is_inclusive() -> None:
    apart = [Frame("a", "a.jpg", 100.0, ZERO), Frame("b", "b.jpg", 101.0, bits(23))]
    together = [Frame("a", "a.jpg", 100.0, ZERO), Frame("b", "b.jpg", 101.0, bits(22))]
    assert ids(group_frames(apart, 2.0, 22)) == [["a"], ["b"]]
    assert ids(group_frames(together, 2.0, 22)) == [["a", "b"]]


def test_missing_exif_falls_back_to_mtime_and_ties_use_natural_names() -> None:
    assert when_of(None, 1_700_000_000_500_000_000) == 1_700_000_000.5
    assert when_of("2026-11-04T13:47:39", 0) == datetime(2026, 11, 4, 13, 47, 39).timestamp()
    assert natural_key("IMG_2.jpg") < natural_key("IMG_10.jpg")
    frames = [
        Frame("ten", "IMG_10.jpg", 100.0, ZERO),
        Frame("two", "IMG_2.jpg", 100.0, ZERO),
        Frame("early", "IMG_99.jpg", 99.0, ZERO),
    ]
    assert ids(group_frames(frames, 2.0, 22)) == [["early", "two", "ten"]]


def test_a_frame_without_a_hash_stays_alone() -> None:
    frames = [
        Frame("a", "a.jpg", 100.0, ZERO),
        Frame("b", "b.jpg", 100.1, None),
        Frame("c", "c.jpg", 100.2, ZERO),
    ]
    assert ids(group_frames(frames, 2.0, 22)) == [["a"], ["b"], ["c"]]


def seed(data: Path) -> None:
    rows = [
        ("p1", "IMG_1.jpg", "2026-11-04T13:47:39", 0, ZERO),
        ("p2", "IMG_2.jpg", "2026-11-04T13:47:39", 0, bits(4)),
        ("p10", "IMG_10.jpg", "2026-11-04T13:47:40", 0, "000000000000ff00"),  # 12 from p2
        ("p11", "IMG_11.jpg", "2026-11-04T13:48:30", 0, ZERO),
        ("p12", "IMG_12.jpg", None, 4_000_000_000_000_000_000, None),
    ]
    with Store(data).session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        for photo_id, name, exif, mtime, dhash in rows:
            conn.execute(
                "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns, "
                "exif_time, dhash) VALUES (?, 's', ?, 'jpg', 1, ?, ?, ?)",
                (photo_id, f"C:/fotos/{name}", mtime, exif, dhash),
            )


def call(dispatcher: Any, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "bursts", "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def shape(reply: dict[str, Any]) -> list[tuple[int, list[str]]]:
    return [
        (burst["position"], [photo["id"] for photo in burst["photos"]])
        for burst in reply["result"]["bursts"]
    ]


def test_bursts_rpc_is_idempotent(tmp_path: Path) -> None:
    data = tmp_path / "data"
    seed(data)
    dispatcher = build_dispatcher(lambda: Store(data))
    first = call(dispatcher, {"session_id": "s"})
    second = call(dispatcher, {"session_id": "s"})
    assert shape(first) == [(0, ["p1", "p2", "p10"]), (1, ["p11"]), (2, ["p12"])]
    assert shape(second) == shape(first)
    photo = first["result"]["bursts"][0]["photos"][0]
    assert photo == {
        "id": "p1",
        "path": "C:/fotos/IMG_1.jpg",
        "format": "jpg",
        "exif_time": "2026-11-04T13:47:39",
    }
    with Store(data).session() as conn:
        assert conn.execute("SELECT count(*) AS n FROM bursts").fetchone()["n"] == 3
        assert conn.execute("SELECT count(*) AS n FROM burst_members").fetchone()["n"] == 5
        positions = [
            row["position"]
            for row in conn.execute("SELECT position FROM burst_members ORDER BY position")
        ]
    assert positions == [0, 0, 0, 1, 2]


def test_bursts_reads_the_user_settings(tmp_path: Path) -> None:
    data = tmp_path / "data"
    seed(data)
    dispatcher = build_dispatcher(lambda: Store(data))
    line = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "settings_set",
            "params": {"key": "hamming_max", "value": 5},
        }
    )
    dispatcher.handle_line(line)
    assert shape(call(dispatcher, {"session_id": "s"})) == [
        (0, ["p1", "p2"]),
        (1, ["p10"]),
        (2, ["p11"]),
        (3, ["p12"]),
    ]


def test_unknown_session_is_not_found(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
    assert call(dispatcher, {"session_id": "nope"})["error"]["code"] == NOT_FOUND
