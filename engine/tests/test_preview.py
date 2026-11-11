"""preview: sizes, JPEG quality tiers and the RAW "develop" option."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from mejores_engine import features
from mejores_engine.app import build_dispatcher
from mejores_engine.features import preview_image
from mejores_engine.rpc import INVALID_PARAMS
from mejores_engine.store import Store


def write_png(path: Path, image: NDArray[np.uint8]) -> Path:
    assert cv2.imwrite(str(path), image)
    return path


def noise(width: int, height: int, seed: int = 4) -> NDArray[np.uint8]:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(height, width, 3), dtype=np.uint8)


def jpeg_bytes(image: NDArray[np.uint8]) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return bytes(encoded.tobytes())


def test_preview_reports_its_size_and_the_size_it_was_scaled_from(tmp_path: Path) -> None:
    path = write_png(tmp_path / "wide.png", np.full((1000, 2000, 3), 90, dtype=np.uint8))
    scaled = preview_image(path, "png", max_px=500)
    assert (scaled.width, scaled.height) == (500, 250)
    assert (scaled.source_width, scaled.source_height) == (2000, 1000)
    whole = preview_image(path, "png", max_px=8192)
    assert (whole.width, whole.height) == (2000, 1000)
    assert (whole.source_width, whole.source_height) == (2000, 1000)
    assert whole.data_url.startswith("data:image/jpeg;base64,")


def test_big_views_keep_more_detail_than_thumbnails(tmp_path: Path) -> None:
    path = write_png(tmp_path / "noise.png", noise(1200, 1200))
    thumb = preview_image(path, "png", max_px=640)
    view = preview_image(path, "png", max_px=641)
    assert (thumb.width, view.width) == (640, 641)
    # Same picture at almost the same size: only the JPEG quality differs.
    assert len(view.data_url) > len(thumb.data_url)


class FakeThumb:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.format = features.rawpy.ThumbFormat.JPEG


class FakeRaw:
    """A RAW with a 100x80 embedded preview that develops to 400x300."""

    def __init__(self) -> None:
        self.postprocess_calls: list[dict[str, Any]] = []

    def __enter__(self) -> FakeRaw:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def extract_thumb(self) -> FakeThumb:
        return FakeThumb(jpeg_bytes(np.full((80, 100, 3), 100, dtype=np.uint8)))

    def postprocess(self, **kwargs: Any) -> NDArray[np.uint8]:
        self.postprocess_calls.append(kwargs)
        return np.full((300, 400, 3), 150, dtype=np.uint8)


def test_develop_asks_a_raw_for_the_half_size_demosaic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeRaw()
    monkeypatch.setattr(features.rawpy, "imread", lambda _path: fake)
    raw = tmp_path / "shot.ARW"
    raw.write_bytes(b"not really raw")

    embedded = preview_image(raw, "raw", max_px=8192)
    assert (embedded.width, embedded.height) == (100, 80)
    assert fake.postprocess_calls == []

    developed = preview_image(raw, "raw", max_px=8192, develop=True)
    assert (developed.width, developed.height) == (400, 300)
    assert fake.postprocess_calls == [
        {"half_size": True, "use_camera_wb": True, "no_auto_bright": True}
    ]


def test_develop_changes_nothing_for_jpg_and_png(tmp_path: Path) -> None:
    path = write_png(tmp_path / "plain.png", noise(300, 200))
    assert preview_image(path, "png", 8192, develop=True) == preview_image(path, "png", 8192)


def seed(tmp_path: Path, photo: Path, fmt: str) -> Any:
    data = tmp_path / "data"
    with Store(data).session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES ('p', 's', ?, ?, 1, 1)",
            (str(photo), fmt),
        )
    return build_dispatcher(lambda: Store(data))


def call(dispatcher: Any, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "preview", "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    return reply


def test_preview_rpc_returns_the_sizes_and_validates_develop(tmp_path: Path) -> None:
    photo = write_png(tmp_path / "wide.png", np.full((600, 1200, 3), 90, dtype=np.uint8))
    dispatcher = seed(tmp_path, photo, "png")

    result = call(dispatcher, {"photo_id": "p", "max_px": 300})["result"]
    assert (result["width"], result["height"]) == (300, 150)
    assert (result["source_width"], result["source_height"]) == (1200, 600)
    prefix = "data:image/jpeg;base64,"
    assert base64.b64decode(result["data_url"][len(prefix) :])[:2] == b"\xff\xd8"

    bad = call(dispatcher, {"photo_id": "p", "develop": "yes"})
    assert bad["error"]["code"] == INVALID_PARAMS
    assert "result" in call(dispatcher, {"photo_id": "p", "develop": True})
