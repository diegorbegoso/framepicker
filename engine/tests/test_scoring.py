from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher
from mejores_engine.scoring import Scored, choose, combined, fill_eyes, rank, sharpness_norm
from mejores_engine.store import Store

WEIGHTS = {"sharpness": 0.6, "exposure": 0.2, "eyes": 0.2}


def member(photo_id: str, sharp: float, eyes: float | None = None, exposure: float = 1.0) -> Scored:
    return Scored(photo_id, f"{photo_id}.jpg", sharp, exposure, eyes)


def test_the_sharpest_frame_wins_a_burst_of_three() -> None:
    members = [member("IMG_1", 50), member("IMG_2", 100), member("IMG_3", 25)]
    assert choose(members, WEIGHTS, 1) == ["IMG_2"]
    assert sharpness_norm([100, 50, 25]) == [1.0, 0.5, 0.25]
    assert sharpness_norm([0.0, 0.0]) == [1.0, 1.0]


def test_missing_eyes_take_the_burst_average_or_are_ignored() -> None:
    assert fill_eyes([None, 0.8]) == [0.8, 0.8]
    assert fill_eyes([None, 0.8, 0.4]) == pytest.approx([0.6, 0.8, 0.4])
    assert fill_eyes([None, None]) == [None, None]
    assert combined(1.0, 0.5, None, WEIGHTS) == pytest.approx((0.6 * 1.0 + 0.2 * 0.5) / 0.8)
    breakdown = rank([member("a", 100, None), member("b", 100, 0.8)], WEIGHTS)
    assert breakdown[0]["eyes_open"] == 0.8
    assert breakdown[0]["combined"] == breakdown[1]["combined"]


def test_a_zero_eyes_weight_ignores_eye_values() -> None:
    weights = {"sharpness": 0.6, "exposure": 0.4, "eyes": 0.0}
    sharps = [100.0, 80.0, 60.0, 40.0]
    open_first = [
        member(f"IMG_{i}", s, e) for i, (s, e) in enumerate(zip(sharps, [0, 1, 0, 1], strict=True))
    ]
    open_last = [
        member(f"IMG_{i}", s, e) for i, (s, e) in enumerate(zip(sharps, [1, 0, 1, 0], strict=True))
    ]
    assert choose(open_first, weights, 4) == choose(open_last, weights, 4)
    assert choose(open_first, weights, 4) == ["IMG_0", "IMG_1", "IMG_2", "IMG_3"]


def test_per_burst_limits_and_natural_name_breaks_ties() -> None:
    three = [member("IMG_1", 100), member("IMG_2", 90), member("IMG_3", 80)]
    assert choose(three, WEIGHTS, 2) == ["IMG_1", "IMG_2"]
    two = [member("IMG_1", 100), member("IMG_2", 90)]
    assert sorted(choose(two, WEIGHTS, 2)) == ["IMG_1", "IMG_2"]
    assert choose([member("IMG_1", 10)], WEIGHTS, 2) == ["IMG_1"]
    tied = [member("IMG_10", 100), member("IMG_2", 100)]
    assert choose(tied, WEIGHTS, 1) == ["IMG_2"]


def seed(data: Path) -> None:
    rows = [("p1", "IMG_1.jpg", 50.0), ("p2", "IMG_2.jpg", 100.0), ("p3", "IMG_3.jpg", 25.0)]
    with Store(data).session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        for photo_id, name, sharp in rows:
            conn.execute(
                "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns, "
                "exif_time, dhash) VALUES (?, 's', ?, 'jpg', 1, 0, '2026-11-04T13:47:39', "
                "'0000000000000000')",
                (photo_id, f"C:/fotos/{name}"),
            )
            conn.execute(
                "INSERT INTO scores (photo_id, sharpness, exposure, mean_luma, clip_hi, clip_lo, "
                "eyes_open, engine_version, computed_at) VALUES (?, ?, 1.0, 118, 0, 0, NULL, "
                "'1', 'now')",
                (photo_id, sharp),
            )


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def picks(reply: dict[str, Any]) -> dict[str, tuple[bool, str]]:
    return {
        photo["id"]: (photo["selected"], photo["source"])
        for burst in reply["result"]["bursts"]
        for photo in burst["photos"]
    }


def test_select_builds_bursts_and_picks_automatically(tmp_path: Path) -> None:
    data = tmp_path / "data"
    seed(data)
    dispatcher = build_dispatcher(lambda: Store(data))
    reply = call(dispatcher, "select", {"session_id": "s"})
    assert picks(reply) == {
        "p1": (False, "auto"),
        "p2": (True, "auto"),
        "p3": (False, "auto"),
    }
    scores = reply["result"]["bursts"][0]["photos"][1]["scores"]
    assert set(scores) == {"sharpness", "sharpness_norm", "exposure", "eyes_open", "combined"}
    assert scores["sharpness_norm"] == 1.0


def test_a_user_pick_freezes_its_burst(tmp_path: Path) -> None:
    data = tmp_path / "data"
    seed(data)
    dispatcher = build_dispatcher(lambda: Store(data))
    first = call(dispatcher, "select", {"session_id": "s"})
    burst_id = first["result"]["bursts"][0]["id"]
    pick = call(dispatcher, "set_pick", {"burst_id": burst_id, "photo_id": "p3", "selected": True})
    assert pick["result"] == {
        "burst_id": burst_id,
        "photo_id": "p3",
        "selected": True,
        "source": "user",
    }
    call(dispatcher, "settings_set", {"key": "per_burst", "value": 3})
    again = call(dispatcher, "select", {"session_id": "s"})
    assert picks(again) == {
        "p1": (False, "auto"),
        "p2": (True, "auto"),
        "p3": (True, "user"),
    }


def test_set_pick_and_select_validate_their_ids(tmp_path: Path) -> None:
    data = tmp_path / "data"
    seed(data)
    dispatcher = build_dispatcher(lambda: Store(data))
    burst_id = call(dispatcher, "select", {"session_id": "s"})["result"]["bursts"][0]["id"]
    unknown_burst = {"burst_id": "nope", "photo_id": "p1", "selected": True}
    unknown_photo = {"burst_id": burst_id, "photo_id": "nope", "selected": True}
    not_bool = {"burst_id": burst_id, "photo_id": "p1", "selected": 1}
    assert call(dispatcher, "set_pick", unknown_burst)["error"]["code"] == NOT_FOUND
    assert call(dispatcher, "set_pick", unknown_photo)["error"]["code"] == NOT_FOUND
    assert call(dispatcher, "set_pick", not_bool)["error"]["code"] == INVALID_PARAMS
    assert call(dispatcher, "select", {"session_id": "nope"})["error"]["code"] == NOT_FOUND
