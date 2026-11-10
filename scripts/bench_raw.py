"""Manual performance gate: extract features from up to 60 RAW files in one process.

Usage (from the project root):
    uv run --directory engine python ../scripts/bench_raw.py <folder>

Prints one line, `files/s: <n>`. Not part of the automatic gates: it needs real RAW files.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1] / "engine"
sys.path.insert(0, str(ENGINE_DIR))

from mejores_engine.features import extract  # noqa: E402
from mejores_engine.scan import SUPPORTED  # noqa: E402

LIMIT = 60


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: bench_raw.py <folder>", file=sys.stderr)
        return 2
    folder = Path(argv[0])
    if not folder.is_dir():
        print(f"not a folder: {folder}", file=sys.stderr)
        return 2
    files = sorted(
        path
        for path in folder.iterdir()
        if path.is_file() and SUPPORTED.get(path.suffix.lower()) == "raw"
    )[:LIMIT]
    if not files:
        print(f"no RAW files in {folder}", file=sys.stderr)
        return 1
    started = time.perf_counter()
    for path in files:
        extract(path, "raw")
    elapsed = time.perf_counter() - started
    print(f"files/s: {len(files) / elapsed:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
