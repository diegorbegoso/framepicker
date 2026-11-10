from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
import rawpy
from numpy.typing import NDArray
from PIL import Image

from mejores_engine import features
from mejores_engine.app import build_dispatcher
from mejores_engine.features import extract, hamming_hex, preview_data_url
from mejores_engine.rpc import DECODE_FAILED, NOT_FOUND, RpcError
from mejores_engine.store import Store


def write_png(path: Path, image: NDArray[np.uint8]) -> Path:
    assert cv2.imwrite(str(path), image)
    return path


def checkerboard(size: int = 512, square: int = 16) -> NDArray[np.uint8]:
    rows, cols = np.indices((size, size))
    board = (((rows // square) + (cols // square)) % 2) * 255
    return board.astype(np.uint8)


def grey(value: int, size: int = 64) -> NDArray[np.uint8]:
    return np.full((size, size), value, dtype=np.uint8)


def jpeg_with_exif(path: Path, when: str | None) -> Path:
    rng = np.random.default_rng(7)
    pixels = rng.integers(0, 256, size=(120, 160, 3), dtype=np.uint8)
    image = Image.fromarray(pixels, "RGB")
    exif = Image.Exif()
    if when is not None:
        exif[0x8769] = {36867: when}
    image.save(path, "JPEG", quality=90, exif=exif)
    return path


def test_a_sharp_checkerboard_is_far_sharper_than_its_blurred_copy(tmp_path: Path) -> None:
    board = checkerboard()
    blurred = cv2.GaussianBlur(board, (15, 15), 5)
    sharp = extract(write_png(tmp_path / "sharp.png", board), "png")
    soft = extract(write_png(tmp_path / "soft.png", np.asarray(blurred, np.uint8)), "png")
    assert soft.sharpness > 0
    assert sharp.sharpness >= 10 * soft.sharpness
    assert (sharp.width, sharp.height) == (512, 512)


def test_mid_grey_is_perfectly_exposed(tmp_path: Path) -> None:
    result = extract(write_png(tmp_path / "grey.png", grey(118)), "png")
    assert result.exposure == pytest.approx(1.0)
    assert result.mean_luma == pytest.approx(118.0)


def test_white_and_black_are_clipped_and_score_zero(tmp_path: Path) -> None:
    white = extract(write_png(tmp_path / "white.png", grey(255)), "png")
    black = extract(write_png(tmp_path / "black.png", grey(0)), "png")
    assert white.exposure == 0.0
    assert white.clip_hi == 1.0
    assert black.exposure == 0.0
    assert black.clip_lo == 1.0


def test_exif_capture_time_is_read_and_png_without_exif_has_none(tmp_path: Path) -> None:
    jpg = extract(jpeg_with_exif(tmp_path / "a.jpg", "2026:11:04 13:47:39"), "jpg")
    assert jpg.exif_time == "2026-11-04T13:47:39"
    png = extract(write_png(tmp_path / "a.png", grey(100)), "png")
    assert png.exif_time is None


def test_malformed_exif_time_gives_none(tmp_path: Path) -> None:
    result = extract(jpeg_with_exif(tmp_path / "odd.jpg", "not a date"), "jpg")
    assert result.exif_time is None


class FakeThumb:
    def __init__(self, data: Any, fmt: Any) -> None:
        self.data = data
        self.format = fmt


class FakeRaw:
    def __init__(self, thumb: FakeThumb | None, developed: NDArray[np.uint8] | None) -> None:
        self.thumb = thumb
        self.developed = developed
        self.postprocess_calls: list[dict[str, Any]] = []

    def __enter__(self) -> FakeRaw:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def extract_thumb(self) -> FakeThumb:
        if self.thumb is None:
            raise rawpy.LibRawNoThumbnailError()
        return self.thumb

    def postprocess(self, **kwargs: Any) -> NDArray[np.uint8]:
        self.postprocess_calls.append(kwargs)
        assert self.developed is not None
        return self.developed


def test_raw_uses_the_embedded_jpeg_preview(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    jpg = jpeg_with_exif(tmp_path / "preview.jpg", "2026:11:04 13:47:39")
    fake = FakeRaw(FakeThumb(jpg.read_bytes(), rawpy.ThumbFormat.JPEG), None)
    opened: list[str] = []

    def fake_imread(path: str) -> FakeRaw:
        opened.append(path)
        return fake

    monkeypatch.setattr(features.rawpy, "imread", fake_imread)
    raw_path = tmp_path / "shot.ARW"
    raw_path.write_bytes(b"not really raw")
    assert extract(raw_path, "raw") == extract(jpg, "jpg")
    assert opened == [str(raw_path)]
    assert fake.postprocess_calls == []


def test_raw_without_a_preview_falls_back_to_a_half_size_demosaic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    developed = np.zeros((300, 400, 3), dtype=np.uint8)
    developed[:, :, 0] = 200
    fake = FakeRaw(None, developed)
    monkeypatch.setattr(features.rawpy, "imread", lambda _path: fake)
    raw_path = tmp_path / "shot.NEF"
    raw_path.write_bytes(b"not really raw")
    result = extract(raw_path, "raw")
    assert (result.width, result.height) == (400, 300)
    assert fake.postprocess_calls == [
        {"half_size": True, "use_camera_wb": True, "no_auto_bright": True}
    ]


def test_undecodable_files_raise_decode_failed(tmp_path: Path) -> None:
    broken = tmp_path / "broken.jpg"
    broken.write_bytes(b"\x00\x01 definitely not a jpeg")
    with pytest.raises(RpcError) as caught:
        extract(broken, "jpg")
    assert caught.value.code == DECODE_FAILED
    fake_raw = tmp_path / "broken.CR2"
    fake_raw.write_bytes(b"\x00" * 64)
    with pytest.raises(RpcError) as caught_raw:
        extract(fake_raw, "raw")
    assert caught_raw.value.code == DECODE_FAILED


def decoded_size(url: str) -> tuple[int, int]:
    prefix = "data:image/jpeg;base64,"
    assert url.startswith(prefix)
    data = np.frombuffer(base64.b64decode(url[len(prefix) :]), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    assert image is not None
    height, width = image.shape[:2]
    return int(width), int(height)


def test_preview_is_a_jpeg_data_url_no_larger_than_max_px(tmp_path: Path) -> None:
    wide = np.full((1000, 2000, 3), 90, dtype=np.uint8)
    path = write_png(tmp_path / "wide.png", wide)
    assert max(decoded_size(preview_data_url(path, "png"))) <= 960
    assert max(decoded_size(preview_data_url(path, "png", max_px=100))) <= 100
    small = write_png(tmp_path / "small.png", grey(40, size=50))
    assert decoded_size(preview_data_url(small, "png")) == (50, 50)


def test_preview_rpc_finds_the_photo_and_reports_unknown_ids(tmp_path: Path) -> None:
    path = write_png(tmp_path / "wide.png", np.full((600, 1200, 3), 90, dtype=np.uint8))
    data = tmp_path / "data"
    with Store(data).session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES ('p', 's', ?, 'png', 1, 1)",
            (str(path),),
        )
    dispatcher = build_dispatcher(lambda: Store(data))

    def call(params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "preview", "params": params})
        reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
        return reply

    ok = call({"photo_id": "p", "max_px": 300})
    assert max(decoded_size(ok["result"]["data_url"])) <= 300
    assert call({"photo_id": "missing"})["error"]["code"] == NOT_FOUND


def test_hamming_and_hash_stability(tmp_path: Path) -> None:
    assert hamming_hex("0000000000000000", "ffffffffffffffff") == 64
    assert hamming_hex("00000000000000ff", "0000000000000000") == 8
    path = write_png(tmp_path / "board.png", checkerboard())
    first = extract(path, "png").dhash
    second = extract(path, "png").dhash
    assert first == second
    assert re.fullmatch(r"[0-9a-f]{16}", first)
