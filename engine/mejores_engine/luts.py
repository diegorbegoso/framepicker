"""3D colour LUTs in the Adobe/Resolve `.cube` format: parsing and trilinear application.

Pure functions, no files written and no database: the library that keeps LUTs between sessions
lives in `luts_library.py`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from mejores_engine.rpc import INVALID_PARAMS, RpcError

MIN_SIZE = 2
MAX_SIZE = 65
MAX_BYTES = 50 * 1024 * 1024
CHUNK = 262_144  # pixels per step, so a 24 MP export does not need gigabytes of floats


@dataclass(frozen=True)
class Lut:
    title: str
    size: int
    #: Output colours indexed [blue][green][red] -> (r, g, b) in 0..1: `.cube` lists red fastest.
    table: NDArray[np.float32]
    domain_min: NDArray[np.float32]
    domain_max: NDArray[np.float32]


def _bad(message: str) -> RpcError:
    return RpcError(INVALID_PARAMS, f"invalid .cube file: {message}")


def _triplet(words: list[str], keyword: str) -> NDArray[np.float32]:
    if len(words) != 4:
        raise _bad(f"{keyword} needs three numbers")
    try:
        return np.array([float(word) for word in words[1:]], dtype=np.float32)
    except ValueError:
        raise _bad(f"{keyword} needs three numbers") from None


def parse_cube(text: str) -> Lut:
    """Parse a 3D `.cube` LUT. Anything unusual (1D, wrong counts, bad numbers) is refused."""
    title = ""
    size = 0
    domain_min = np.zeros(3, dtype=np.float32)
    domain_max = np.ones(3, dtype=np.float32)
    rows: list[tuple[float, float, float]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        words = line.split()
        keyword = words[0].upper()
        if keyword == "TITLE":
            title = line[len(words[0]) :].strip().strip('"')
        elif keyword == "LUT_1D_SIZE":
            raise _bad("only 3D LUTs are supported")
        elif keyword == "LUT_3D_SIZE":
            try:
                size = int(words[1])
            except (IndexError, ValueError):
                raise _bad("LUT_3D_SIZE needs a whole number") from None
        elif keyword == "DOMAIN_MIN":
            domain_min = _triplet(words, "DOMAIN_MIN")
        elif keyword == "DOMAIN_MAX":
            domain_max = _triplet(words, "DOMAIN_MAX")
        elif keyword.startswith("LUT_"):
            raise _bad(f"unsupported keyword {words[0]}")
        else:
            try:
                r, g, b = (float(word) for word in words)
            except ValueError:
                raise _bad(f"cannot read the line {line[:40]!r}") from None
            rows.append((r, g, b))
    if not MIN_SIZE <= size <= MAX_SIZE:
        raise _bad(f"LUT_3D_SIZE must be from {MIN_SIZE} to {MAX_SIZE}")
    if len(rows) != size**3:
        raise _bad(f"expected {size**3} colours, found {len(rows)}")
    if bool(np.any(domain_max <= domain_min)):
        raise _bad("DOMAIN_MAX must be greater than DOMAIN_MIN")
    table = np.asarray(rows, dtype=np.float32).reshape(size, size, size, 3)
    return Lut(title or "LUT", size, table, domain_min, domain_max)


def _apply_chunk(pixels: NDArray[np.uint8], lut: Lut) -> NDArray[np.uint8]:
    rgb = pixels[:, ::-1].astype(np.float32) / 255.0
    span = lut.domain_max - lut.domain_min
    position = np.clip((rgb - lut.domain_min) / span, 0.0, 1.0) * (lut.size - 1)
    lower = np.minimum(np.floor(position).astype(np.int64), lut.size - 2)
    frac = (position - lower).astype(np.float32)
    r0, g0, b0 = lower[:, 0], lower[:, 1], lower[:, 2]
    fr, fg, fb = frac[:, 0:1], frac[:, 1:2], frac[:, 2:3]
    table = lut.table

    def corner(db: int, dg: int, dr: int) -> NDArray[np.float32]:
        return np.asarray(table[b0 + db, g0 + dg, r0 + dr], dtype=np.float32)

    c00 = corner(0, 0, 0) * (1 - fr) + corner(0, 0, 1) * fr
    c01 = corner(0, 1, 0) * (1 - fr) + corner(0, 1, 1) * fr
    c10 = corner(1, 0, 0) * (1 - fr) + corner(1, 0, 1) * fr
    c11 = corner(1, 1, 0) * (1 - fr) + corner(1, 1, 1) * fr
    c0 = c00 * (1 - fg) + c01 * fg
    c1 = c10 * (1 - fg) + c11 * fg
    result = c0 * (1 - fb) + c1 * fb
    out = np.clip(result * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(out[:, ::-1])


def apply(bgr: NDArray[np.uint8], lut: Lut) -> NDArray[np.uint8]:
    """The image with the LUT applied (BGR in, BGR out), trilinear, in chunks of rows."""
    height, width = bgr.shape[:2]
    flat = np.ascontiguousarray(bgr).reshape(-1, 3)
    out = np.empty_like(flat)
    for start in range(0, flat.shape[0], CHUNK):
        out[start : start + CHUNK] = _apply_chunk(flat[start : start + CHUNK], lut)
    return np.asarray(out.reshape(height, width, 3), dtype=np.uint8)
