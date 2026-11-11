"""scan -> analyze -> bursts -> select on synthetic photos, with the network switched off."""

from __future__ import annotations

import json
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from mejores_engine import features
from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import Dispatcher
from mejores_engine.store import Store


def base(kind: str, size: int = 256) -> NDArray[np.float64]:
    ramp = np.linspace(40, 200, size)
    return np.tile(ramp, (size, 1)) if kind == "horizontal" else np.tile(ramp[:, None], (1, size))


def frame(kind: str, sharp: bool) -> NDArray[np.uint8]:
    rows, cols = np.indices((256, 256))
    texture = ((((rows // 4) + (cols // 4)) % 2) * 2 - 1) * 30.0
    image = np.clip(base(kind) + texture, 0, 255).astype(np.uint8)
    if not sharp:
        image = np.asarray(cv2.GaussianBlur(image, (21, 21), 6), dtype=np.uint8)
    return image


def write(path: Path, image: NDArray[np.uint8], when: str) -> None:
    exif = Image.Exif()
    exif[0x8769] = {36867: when}
    Image.fromarray(image, "L").convert("RGB").save(path, "JPEG", quality=92, exif=exif)


def call(dispatcher: Dispatcher, method: str, params: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    reply: dict[str, Any] = json.loads(dispatcher.handle_line(line) or "")
    assert "error" not in reply, reply
    return reply["result"]  # type: ignore[no-any-return]


def no_network(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("the engine tried to open a network socket")


def test_the_whole_pipeline_runs_offline(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket, "socket", no_network)
    folder = tmp_path / "fotos"
    folder.mkdir()
    shots = [
        ("A_1.jpg", "horizontal", False, "2026:11:04 10:00:00"),
        ("A_2.jpg", "horizontal", True, "2026:11:04 10:00:01"),
        ("A_3.jpg", "horizontal", False, "2026:11:04 10:00:01"),
        ("B_1.jpg", "vertical", False, "2026:11:04 10:05:00"),
        ("B_2.jpg", "vertical", False, "2026:11:04 10:05:01"),
        ("B_3.jpg", "vertical", True, "2026:11:04 10:05:01"),
    ]
    for name, kind, sharp, when in shots:
        write(folder / name, frame(kind, sharp), when)

    data = tmp_path / "data"
    dispatcher = build_dispatcher(
        lambda: Store(data),
        executor_factory=lambda: ThreadPoolExecutor(max_workers=2),
        extractor=features.extract,
    )
    call(dispatcher, "grant_roots", {"roots": [str(folder)]})
    session_id = call(dispatcher, "scan", {"paths": [str(folder)]})["session_id"]
    job_id = call(dispatcher, "analyze", {"session_id": session_id})["job_id"]
    deadline = time.monotonic() + 60
    while call(dispatcher, "job_status", {"job_id": job_id})["state"] == "running":
        assert time.monotonic() < deadline
        time.sleep(0.05)
    assert call(dispatcher, "job_status", {"job_id": job_id})["state"] == "done"

    bursts = call(dispatcher, "bursts", {"session_id": session_id})["bursts"]
    names = [[Path(p["path"]).name for p in burst["photos"]] for burst in bursts]
    assert names == [["A_1.jpg", "A_2.jpg", "A_3.jpg"], ["B_1.jpg", "B_2.jpg", "B_3.jpg"]]

    chosen = call(dispatcher, "select", {"session_id": session_id})["bursts"]
    selected = [
        [Path(photo["path"]).name for photo in burst["photos"] if photo["selected"]]
        for burst in chosen
    ]
    assert selected == [["A_2.jpg"], ["B_3.jpg"]]
