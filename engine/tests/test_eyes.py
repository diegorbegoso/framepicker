from __future__ import annotations

import hashlib
import importlib.util
import io
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import cv2
import numpy as np
import pytest

from mejores_engine import eyes
from mejores_engine.features import extract

ENGINE_DIR = Path(__file__).resolve().parents[1]
SCRIPT = ENGINE_DIR.parent / "scripts" / "fetch_model.py"


def load_fetch_model() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_model", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def opener_for(payload: bytes) -> Any:
    calls: list[str] = []

    def opener(url: str) -> io.BytesIO:
        calls.append(url)
        return io.BytesIO(payload)

    opener.calls = calls  # type: ignore[attr-defined]
    return opener


def test_the_committed_model_matches_the_pinned_size_and_hash() -> None:
    fetch_model = load_fetch_model()
    assert fetch_model.DEST == eyes.MODEL_PATH
    assert eyes.MODEL_PATH.stat().st_size == 3758596
    assert fetch_model.sha256_of(eyes.MODEL_PATH) == (
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
    )


def test_a_correct_model_is_not_downloaded_again(tmp_path: Path) -> None:
    fetch_model = load_fetch_model()
    payload = b"model bytes"
    dest = tmp_path / "face_landmarker.task"
    dest.write_bytes(payload)
    opener = opener_for(b"never used")
    code = fetch_model.fetch(
        dest, "https://example.invalid/m", len(payload), hashlib.sha256(payload).hexdigest(), opener
    )
    assert code == 0
    assert opener.calls == []


def test_a_good_download_is_moved_into_place(tmp_path: Path) -> None:
    fetch_model = load_fetch_model()
    payload = b"fresh model"
    dest = tmp_path / "assets" / "face_landmarker.task"
    code = fetch_model.fetch(
        dest,
        "https://example.invalid/m",
        len(payload),
        hashlib.sha256(payload).hexdigest(),
        opener_for(payload),
    )
    assert code == 0
    assert dest.read_bytes() == payload
    assert [p.name for p in dest.parent.iterdir()] == ["face_landmarker.task"]


def test_a_bad_download_leaves_the_old_model_and_no_temp_file(tmp_path: Path) -> None:
    fetch_model = load_fetch_model()
    expected = b"the real model"
    dest = tmp_path / "face_landmarker.task"
    dest.write_bytes(b"an older, wrong model")
    code = fetch_model.fetch(
        dest,
        "https://example.invalid/m",
        len(expected),
        hashlib.sha256(expected).hexdigest(),
        opener_for(b"tampered bytes"),
    )
    assert code == 1
    assert dest.read_bytes() == b"an older, wrong model"
    assert [p.name for p in tmp_path.iterdir()] == ["face_landmarker.task"]


def blink(left: float, right: float) -> dict[str, float]:
    return {"eyeBlinkLeft": left, "eyeBlinkRight": right, "jawOpen": 0.3}


def test_eyes_from_blendshapes() -> None:
    assert eyes.eyes_from_blendshapes([blink(0.9, 0.9)]) == pytest.approx(0.1)
    assert eyes.eyes_from_blendshapes([blink(0.05, 0.05)]) == pytest.approx(0.95)
    two = eyes.eyes_from_blendshapes([blink(0.05, 0.05), blink(0.9, 0.9)])
    assert two == pytest.approx(0.1)
    assert eyes.eyes_from_blendshapes([]) is None


def test_the_real_landmarker_finds_no_face_in_grey() -> None:
    grey = np.full((512, 512, 3), 128, dtype=np.uint8)
    assert eyes.score(grey) is None
    assert eyes.is_loaded()


def test_extract_only_loads_the_model_when_asked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "grey.png"
    assert cv2.imwrite(str(path), np.full((256, 256, 3), 128, dtype=np.uint8))
    monkeypatch.setattr(eyes, "_landmarker", None)
    without = extract(path, "png")
    assert without.eyes_open is None
    assert not eyes.is_loaded()
    with_eyes = extract(path, "png", eyes=True)
    assert with_eyes.eyes_open is None
    assert eyes.is_loaded()


def test_extract_fills_eyes_open_from_the_detector(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "grey.png"
    assert cv2.imwrite(str(path), np.full((64, 64, 3), 128, dtype=np.uint8))
    monkeypatch.setattr(eyes, "score", lambda _bgr: 0.75)
    assert extract(path, "png", eyes=True).eyes_open == 0.75


PING_AFTER_LANDMARKER = """
import io, sys
import numpy as np
from mejores_engine import eyes
from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import Emitter, serve
eyes.score(np.full((256, 256, 3), 128, dtype=np.uint8))
source = io.StringIO('{"jsonrpc":"2.0","id":1,"method":"ping"}\\n')
serve(build_dispatcher(), source, Emitter(sys.stdout))
"""


def test_a_ping_after_the_landmarker_writes_exactly_one_stdout_line(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, "-c", PING_AFTER_LANDMARKER],
        capture_output=True,
        text=True,
        cwd=ENGINE_DIR,
        timeout=120,
        check=False,
        env={**__import__("os").environ, "MT_DATA_DIR": str(tmp_path)},
    )
    assert result.returncode == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert len(lines) == 1, result.stdout
    assert '"pong":true' in lines[0]


def test_concurrent_detections_share_one_landmarker_safely(monkeypatch: pytest.MonkeyPatch) -> None:
    from concurrent.futures import ThreadPoolExecutor

    monkeypatch.setattr(eyes, "_landmarker", None)
    grey = np.full((256, 256, 3), 128, dtype=np.uint8)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: eyes.score(grey), range(18)))
    assert results == [None] * 18
    assert eyes.is_loaded()
