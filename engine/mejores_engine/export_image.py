"""Export with settings: re-encode the chosen photos in another format and size, with the
corrections and LUT they carry.

Originals are only read. The result is written to `<target>.part` and renamed into place, like a
plain copy, and the planner only picks names that are free.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import rawpy
from numpy.typing import NDArray
from PIL import Image

from mejores_engine import adjust, features, luts
from mejores_engine.rpc import DECODE_FAILED, INVALID_PARAMS, RpcError
from mejores_engine.scan import format_of

FORMATS = ("original", "jpg", "png", "webp")
EXTENSION = {"jpg": ".jpg", "png": ".png", "webp": ".webp"}
PIL_FORMAT = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP"}
MIN_EDGE = 320
MAX_EDGE = 12000
_ORIENTATION = 274
_FORBIDDEN = re.compile(r'[\\/:*?"<>|]')

DEFAULT_OPTIONS: dict[str, Any] = {
    "format": "original",
    "long_edge": 0,
    "quality": 92,
    "apply_edits": True,
    "name_pattern": "{name}",
}


@dataclass(frozen=True)
class ExportOptions:
    format: str = "original"
    long_edge: int = 0  # 0 keeps the size
    quality: int = 92
    apply_edits: bool = True  # use the corrections and LUT each photo carries
    name_pattern: str = "{name}"

    @property
    def re_encodes(self) -> bool:
        """True when every photo is saved again, whatever corrections it has."""
        return self.format != "original" or self.long_edge > 0


def _bad(message: str) -> RpcError:
    return RpcError(INVALID_PARAMS, message)


def _int(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise _bad(f"{name} must be a whole number from {low} to {high}")
    return value


def validate(value: Any) -> dict[str, Any]:
    """The options as a clean dict, or INVALID_PARAMS."""
    if not isinstance(value, dict) or set(value) != set(DEFAULT_OPTIONS):
        raise _bad("export options need format, long_edge, quality, apply_edits and name_pattern")
    if value["format"] not in FORMATS:
        raise _bad(f"format must be one of {', '.join(FORMATS)}")
    edge = value["long_edge"]
    if edge != 0:
        edge = _int(edge, "long_edge", MIN_EDGE, MAX_EDGE)
    quality = _int(value["quality"], "quality", 40, 100)
    if not isinstance(value["apply_edits"], bool):
        raise _bad("apply_edits must be true or false")
    pattern = value["name_pattern"]
    if not isinstance(pattern, str) or not pattern or len(pattern) > 80:
        raise _bad("name_pattern must be 1 to 80 characters")
    if _FORBIDDEN.search(pattern) or "{name}" not in pattern and "{n}" not in pattern:
        raise _bad('name_pattern needs {name} or {n} and no \\ / : * ? " < > |')
    leftovers = re.sub(r"\{name\}|\{n\}", "", pattern)
    if "{" in leftovers or "}" in leftovers:
        raise _bad("name_pattern only knows {name} and {n}")
    return {
        "format": value["format"],
        "long_edge": edge,
        "quality": quality,
        "apply_edits": value["apply_edits"],
        "name_pattern": pattern,
    }


def upgrade(stored: Any) -> dict[str, Any]:
    """Options saved by an older version, brought up to date; the defaults when unusable."""
    if isinstance(stored, dict) and "lut_id" in stored and "apply_edits" not in stored:
        stored = {**{k: v for k, v in stored.items() if k != "lut_id"}, "apply_edits": True}
    try:
        return validate(stored)
    except RpcError:
        return dict(DEFAULT_OPTIONS)


def parse(value: Any) -> ExportOptions:
    return ExportOptions(**validate(value))


def output_extension(photo: Path, options: ExportOptions) -> str:
    """The new file's extension. 'Original' keeps JPEG and PNG as they are; a RAW becomes a JPEG."""
    if options.format in EXTENSION:
        return EXTENSION[options.format]
    suffix = photo.suffix.lower()
    return photo.suffix if suffix in (".jpg", ".jpeg", ".png") else ".jpg"


def target_names(
    photos: list[Path], dest: Path, options: ExportOptions, taken: set[str] | None = None
) -> list[tuple[Path, Path]]:
    """(source, target) for rendered files; a taken name gets a numeric suffix."""
    used = taken if taken is not None else set()
    pairs: list[tuple[Path, Path]] = []
    for index, photo in enumerate(photos, start=1):
        extension = output_extension(photo, options)
        base = options.name_pattern.replace("{name}", photo.stem).replace("{n}", f"{index:03d}")
        counter = 0
        while True:
            stem = base if counter == 0 else f"{base}_{counter}"
            name = f"{stem}{extension}"
            if name.lower() not in used and not (dest / name).exists():
                break
            counter += 1
        used.add(name.lower())
        pairs.append((photo, dest / name))
    return pairs


def _develop_full(path: Path) -> NDArray[np.uint8]:
    """A full-size demosaic of a RAW, as BGR."""
    try:
        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, output_bps=8)
    except rawpy.LibRawError as exc:
        raise RpcError(DECODE_FAILED, f"cannot decode {path.name}") from exc
    return np.ascontiguousarray(np.asarray(rgb, dtype=np.uint8)[:, :, ::-1])


def _load(path: Path) -> NDArray[np.uint8]:
    fmt = format_of(path) or "jpg"
    if fmt == "raw":
        return _develop_full(path)
    return features.decode(features.image_bytes(path, fmt), path)


def _exif_of(path: Path) -> bytes | None:
    """The EXIF of a source minus its orientation: decoding has already turned the picture."""
    try:
        with Image.open(path) as source:
            exif = source.getexif()
            if not exif:
                return None
            exif.pop(_ORIENTATION, None)
            return bytes(exif.tobytes())
    except Exception:  # noqa: BLE001 - metadata is a courtesy; a bad tag must not fail the export
        return None


def resize_long_edge(bgr: NDArray[np.uint8], long_edge: int) -> NDArray[np.uint8]:
    """Scaled down so the longer side is `long_edge`; never enlarged."""
    height, width = bgr.shape[:2]
    if long_edge <= 0 or max(height, width) <= long_edge:
        return bgr
    scale = long_edge / max(height, width)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def encode(bgr: NDArray[np.uint8], options: ExportOptions, exif: bytes | None) -> bytes:
    rgb = np.ascontiguousarray(bgr[:, :, ::-1])
    buffer = BytesIO()
    extra: dict[str, Any] = {}
    if options.format == "png":
        extra["compress_level"] = 6
    else:
        extra["quality"] = options.quality
        if exif is not None:
            extra["exif"] = exif
    Image.fromarray(rgb).save(buffer, format=PIL_FORMAT[options.format], **extra)
    return buffer.getvalue()


def _like_source(source: Path, options: ExportOptions) -> ExportOptions:
    """With format original but a correction or a size, a RAW becomes a JPEG; others keep theirs."""
    kind = "png" if source.suffix.lower() == ".png" else "jpg"
    return ExportOptions(
        kind, options.long_edge, options.quality, options.apply_edits, options.name_pattern
    )


def render_one(
    source: Path,
    target: Path,
    options: ExportOptions,
    adjustments: adjust.Adjustments | None,
    lut: luts.Lut | None,
) -> None:
    """Decode, resize, correct, encode, and put the file in place without overwriting."""
    bgr = _load(source)
    edited = adjustments if adjustments is not None and options.apply_edits else None
    if edited is not None:
        bgr = adjust.apply_geometry(bgr, edited)  # the long edge is measured on the cropped photo
    bgr = resize_long_edge(bgr, options.long_edge)
    if edited is not None:
        bgr = adjust.apply_look(bgr, edited, lut)
    exif = _exif_of(source) if source.suffix.lower() in (".jpg", ".jpeg") else None
    chosen = options if options.format != "original" else _like_source(source, options)
    data = encode(bgr, chosen, exif)
    part = target.with_name(target.name + ".part")
    try:
        part.write_bytes(data)
        if target.exists():
            raise FileExistsError(f"{target.name} appeared during the export")
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)
