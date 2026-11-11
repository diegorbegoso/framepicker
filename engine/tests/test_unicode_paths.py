"""The shell and the engine talk UTF-8 over stdio, whatever code page Windows uses for pipes."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ENGINE_DIR = Path(__file__).resolve().parents[1]


def request(request_id: int, method: str, params: dict[str, object]) -> bytes:
    """One request line, encoded the way the Rust shell writes it: raw UTF-8, no \\u escapes."""
    body = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    return json.dumps(body, ensure_ascii=False).encode("utf-8") + b"\n"


def test_non_ascii_paths_survive_a_legacy_code_page(tmp_path: Path) -> None:
    # "ł" is not in cp1252, so a pipe left on the ANSI code page cannot even print this path back.
    folder = tmp_path / "VASCO 1 AÑO ł"
    folder.mkdir()
    photo = folder / "ÑANDÚ ł.jpg"
    ok, encoded = cv2.imencode(".jpg", np.full((32, 32, 3), 120, dtype=np.uint8))
    assert ok
    photo.write_bytes(encoded.tobytes())

    result = subprocess.run(
        [sys.executable, "-m", "mejores_engine"],
        input=request(1, "grant_roots", {"roots": [str(folder)]})
        + request(2, "scan", {"paths": [str(folder)]}),
        capture_output=True,
        cwd=ENGINE_DIR,
        timeout=60,
        check=False,
        env={
            **os.environ,
            "MT_DATA_DIR": str(tmp_path / "data"),
            "PYTHONUTF8": "0",
            "PYTHONIOENCODING": "cp1252",
        },
    )
    stderr = result.stderr.decode("utf-8", "replace")
    assert result.returncode == 0, stderr
    replies = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines() if line]
    assert [reply["id"] for reply in replies] == [1, 2], replies
    assert replies[0]["result"] == {"granted": 1}
    scanned = replies[1]["result"]
    assert [item["path"] for item in scanned["photos"]] == [str(photo)]
