"""Download the MediaPipe FaceLandmarker model once and verify it. Standard library only.

Usage (from the project root):
    uv run --directory engine python ../scripts/fetch_model.py

Exit 0 when the model at DEST is correct (already or after downloading), 1 when the download does not
match the expected size and SHA-256. The engine itself never touches the network; only this script does.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
SIZE = 3758596
SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
DEST = (
    Path(__file__).resolve().parents[1]
    / "engine"
    / "mejores_engine"
    / "assets"
    / "face_landmarker.task"
)
CHUNK = 1 << 16

Opener = Callable[[str], BinaryIO]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def is_valid(path: Path, size: int = SIZE, sha256: str = SHA256) -> bool:
    return path.is_file() and path.stat().st_size == size and sha256_of(path) == sha256


def _open(url: str) -> BinaryIO:
    response: BinaryIO = urllib.request.urlopen(url, timeout=60)  # noqa: S310 - fixed https URL
    return response


def fetch(
    dest: Path = DEST,
    url: str = URL,
    size: int = SIZE,
    sha256: str = SHA256,
    opener: Opener = _open,
) -> int:
    if is_valid(dest, size, sha256):
        print(f"model already present: {dest}")
        return 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix=".face_landmarker-", dir=dest.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(handle, "wb") as out, opener(url) as response:
            for block in iter(lambda: response.read(CHUNK), b""):
                out.write(block)
        if not is_valid(temp, size, sha256):
            print("downloaded model does not match the expected size and SHA-256", file=sys.stderr)
            return 1
        os.replace(temp, dest)
        print(f"model saved: {dest}")
        return 0
    finally:
        temp.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(fetch())
