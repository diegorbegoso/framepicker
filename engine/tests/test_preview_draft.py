"""preview with a correction that is not saved (a slider being dragged) and the decode cache."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from mejores_engine import features
from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher
from mejores_engine.store import Store

NEUTRAL = {
    "exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0, "temperature": 0,
    "tint": 0, "saturation": 0, "lut_id": None, "lut_strength": 1,
}  # fmt: skip


class Shoot:
    def __init__(self, tmp_path: Path) -> None:
        self.folder = tmp_path / "fotos"
        self.folder.mkdir()
        ok, data = cv2.imencode(".jpg", np.full((90, 120, 3), 100, dtype=np.uint8))
        assert ok
        (self.folder / "a.jpg").write_bytes(data.tobytes())
        self.dispatcher: Dispatcher = build_dispatcher(lambda: Store(tmp_path / "data"))
        self.call("grant_roots", {"roots": [str(self.folder)]})
        scanned = self.call("scan", {"paths": [str(self.folder)]})["result"]
        self.session_id = scanned["session_id"]
        self.photo_id = scanned["photos"][0]["id"]

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        reply: dict[str, Any] = json.loads(self.dispatcher.handle_line(line) or "")
        return reply

    def preview(self, **extra: Any) -> dict[str, Any]:
        return self.call("preview", {"photo_id": self.photo_id, "max_px": 100, **extra})

    def brightness(self, reply: dict[str, Any]) -> float:
        raw = base64.b64decode(reply["result"]["data_url"].split(",", 1)[1])
        return float(cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR).mean())


def test_a_draft_correction_is_drawn_without_being_saved(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path)
    plain = shoot.brightness(shoot.preview())
    drawn = shoot.brightness(shoot.preview(adjustments={**NEUTRAL, "exposure": 1}))
    assert drawn > plain * 1.7
    saved = shoot.call("edits_get", {"session_id": shoot.session_id})["result"]["edits"]
    assert saved == {}  # nothing was written
    assert abs(shoot.brightness(shoot.preview(edited=True)) - plain) < 2


def test_a_draft_wins_over_the_saved_corrections(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path)
    params = {
        "session_id": shoot.session_id,
        "photo_ids": [shoot.photo_id],
        "adjustments": {**NEUTRAL, "exposure": -1},
    }
    shoot.call("edits_set", params)
    dark = shoot.brightness(shoot.preview(edited=True))
    drafted = shoot.brightness(shoot.preview(edited=True, adjustments=NEUTRAL))
    assert drafted > dark * 1.7


def test_a_bad_draft_is_refused(tmp_path: Path) -> None:
    shoot = Shoot(tmp_path)
    assert shoot.preview(adjustments={"exposure": 1})["error"]["code"] == INVALID_PARAMS
    bad = shoot.preview(adjustments={**NEUTRAL, "exposure": 9})
    assert bad["error"]["code"] == INVALID_PARAMS
    assert shoot.preview(adjustments="nope")["error"]["code"] == INVALID_PARAMS
    assert shoot.call("preview", {"photo_id": "nope"})["error"]["code"] == NOT_FOUND


def test_the_decoded_photo_is_reused_between_calls_and_dropped_when_the_file_changes(
    tmp_path: Path, monkeypatch: Any
) -> None:
    shoot = Shoot(tmp_path)
    reads: list[Path] = []
    real = features.image_bytes

    def counting(path: Path, fmt: str, develop: bool = False) -> bytes:
        reads.append(path)
        return real(path, fmt, develop)

    monkeypatch.setattr(features, "image_bytes", counting)
    features._SCALED.clear()
    for exposure in (0.2, 0.4, 0.6):
        assert "result" in shoot.preview(adjustments={**NEUTRAL, "exposure": exposure})
    assert len(reads) == 1
    ok, data = cv2.imencode(".jpg", np.full((90, 120, 3), 30, dtype=np.uint8))
    assert ok
    (shoot.folder / "a.jpg").write_bytes(data.tobytes())  # the file changed on disk
    shoot.preview()
    assert len(reads) == 2


def test_the_cache_keeps_only_a_few_photos(tmp_path: Path) -> None:
    features._SCALED.clear()
    ok, data = cv2.imencode(".jpg", np.full((40, 40, 3), 90, dtype=np.uint8))
    assert ok
    for index in range(features._SCALED_KEEP + 3):
        path = tmp_path / f"{index}.jpg"
        path.write_bytes(data.tobytes())
        features.preview_image(path, "jpg", 32)
    assert len(features._SCALED) == features._SCALED_KEEP
