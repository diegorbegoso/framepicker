from __future__ import annotations

import json
from pathlib import Path

import pytest

from mejores_engine import eyes
from mejores_engine.app import build_dispatcher, selftest
from mejores_engine.store import Store

KEYS = [
    "migrations_present",
    "model_present",
    "rawpy_ok",
    "cv2_ok",
    "mediapipe_ok",
    "landmarker_loads",
]


def test_selftest_passes_in_development(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path))
    reply = dispatcher.handle_line('{"jsonrpc":"2.0","id":1,"method":"selftest"}')
    assert reply == json.dumps(
        {"jsonrpc": "2.0", "id": 1, "result": dict.fromkeys(KEYS, True)},
        separators=(",", ":"),
    )


def test_a_missing_model_fails_its_checks_without_raising(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(eyes, "MODEL_PATH", tmp_path / "missing.task")
    monkeypatch.setattr(eyes, "_landmarker", None)
    checks = selftest()
    assert list(checks) == KEYS
    assert checks["model_present"] is False
    assert checks["landmarker_loads"] is False
    assert checks["migrations_present"] is True
