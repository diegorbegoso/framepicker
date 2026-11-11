"""Per-photo features: dimensions, capture time, perceptual hash, sharpness and exposure.

RAW files are never developed when it can be avoided: the JPEG preview the camera embedded is
read instead, which is two orders of magnitude cheaper and plenty for ranking sharpness.
"""

from __future__ import annotations

import base64
import threading
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import rawpy
from numpy.typing import NDArray
from PIL import Image

from mejores_engine import adjust, luts
from mejores_engine.rpc import DECODE_FAILED, RpcError

FEATURES_VERSION = "1"

_EXIF_IFD = 0x8769
_DATETIME_ORIGINAL = 36867
_DATETIME = 306
_EXIF_FORMAT = "%Y:%m:%d %H:%M:%S"


@dataclass(frozen=True)
class Features:
    width: int
    height: int
    exif_time: str | None  # ISO 8601 local, "2026-11-04T13:47:39", or None
    dhash: str  # 16 lowercase hex digits
    sharpness: float  # variance of the Laplacian over the centre crop
    mean_luma: float  # 0..255
    clip_hi: float  # fraction of pixels >= 250
    clip_lo: float  # fraction of pixels <= 5
    exposure: float  # 0..1
    eyes_open: float | None = None  # filled from step 10 on


def _failed(path: Path) -> RpcError:
    return RpcError(DECODE_FAILED, f"cannot decode {path.name}")


def _encode_rgb(rgb: Any, path: Path) -> bytes:
    bgr = cv2.cvtColor(np.ascontiguousarray(rgb), cv2.COLOR_RGB2BGR)
    ok, encoded = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        raise _failed(path)
    return bytes(encoded.tobytes())


def _raw_develop_bytes(raw: Any, path: Path) -> bytes:
    """A half-size demosaic (about 3000x2000 on a 24 MP camera) as JPEG bytes."""
    rgb = raw.postprocess(half_size=True, use_camera_wb=True, no_auto_bright=True)
    return _encode_rgb(rgb, path)


def _raw_bytes(path: Path, develop: bool = False) -> bytes:
    """The camera's embedded preview as JPEG bytes; a half-size demosaic when asked or missing."""
    try:
        with rawpy.imread(str(path)) as raw:
            if develop:
                return _raw_develop_bytes(raw, path)
            try:
                thumb = raw.extract_thumb()
            except (rawpy.LibRawNoThumbnailError, rawpy.LibRawUnsupportedThumbnailError):
                return _raw_develop_bytes(raw, path)
            if thumb.format == rawpy.ThumbFormat.JPEG:
                return bytes(thumb.data)
            if thumb.format == rawpy.ThumbFormat.BITMAP:
                return _encode_rgb(thumb.data, path)
            raise _failed(path)
    except rawpy.LibRawError as exc:
        raise _failed(path) from exc


def image_bytes(path: Path, fmt: str, develop: bool = False) -> bytes:
    """Step 1: the bytes of an image file, opened read-only. `develop` only affects RAW."""
    if fmt == "raw":
        return _raw_bytes(path, develop)
    try:
        with path.open("rb") as handle:
            return handle.read()
    except OSError as exc:
        raise _failed(path) from exc


def decode(data: bytes, path: Path) -> NDArray[np.uint8]:
    """Step 2: decode to BGR, or raise DECODE_FAILED."""
    buffer = np.frombuffer(data, dtype=np.uint8)
    bgr = cv2.imdecode(buffer, cv2.IMREAD_COLOR) if buffer.size else None
    if bgr is None:
        raise _failed(path)
    return np.asarray(bgr, dtype=np.uint8)


def exif_time(data: bytes) -> str | None:
    """DateTimeOriginal (or DateTime) as ISO local time; None when absent or malformed."""
    try:
        with Image.open(BytesIO(data)) as image:
            exif = image.getexif()
            value = exif.get_ifd(_EXIF_IFD).get(_DATETIME_ORIGINAL) or exif.get(_DATETIME)
        if not isinstance(value, str):
            return None
        return datetime.strptime(value.strip("\x00 "), _EXIF_FORMAT).isoformat()
    except Exception:  # noqa: BLE001 - any EXIF oddity means "no capture time"
        return None


def dhash(gray: NDArray[np.uint8]) -> str:
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bool(bit))
    return f"{value:016x}"


def hamming_hex(a: str, b: str) -> int:
    return (int(a, 16) ^ int(b, 16)).bit_count()


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def extract(path: Path, fmt: str, eyes: bool = False) -> Features:
    data = image_bytes(path, fmt)
    bgr = decode(data, path)
    gray = np.asarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), dtype=np.uint8)
    h, w = gray.shape
    centre = gray[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
    sharpness = float(cv2.Laplacian(centre, cv2.CV_64F).var())
    mean_luma = float(gray.mean())
    clip_hi = float((gray >= 250).mean())
    clip_lo = float((gray <= 5).mean())
    exposure = _clamp(1 - 0.5 * abs(mean_luma - 118) / 118 - 4 * clip_hi - 2 * clip_lo, 0.0, 1.0)
    eyes_open: float | None = None
    if eyes:
        # Imported lazily so that eyes=False never loads MediaPipe or the model.
        from mejores_engine import eyes as eye_model

        eyes_open = eye_model.score(bgr)
    return Features(
        width=int(w),
        height=int(h),
        exif_time=exif_time(data),
        dhash=dhash(gray),
        sharpness=sharpness,
        mean_luma=mean_luma,
        clip_hi=clip_hi,
        clip_lo=clip_lo,
        exposure=exposure,
        eyes_open=eyes_open,
    )


@dataclass(frozen=True)
class PreviewImage:
    data_url: str
    width: int  # of the image returned
    height: int
    source_width: int  # before scaling down: the size a 100 % zoom shows
    source_height: int


# Dragging a slider asks for the same photo again and again: keep the last few decoded and scaled.
_SCALED: OrderedDict[tuple[object, ...], tuple[NDArray[np.uint8], int, int]] = OrderedDict()
_SCALED_KEEP = 4
_scaled_lock = threading.Lock()


def _scaled(path: Path, fmt: str, max_px: int, develop: bool) -> tuple[NDArray[np.uint8], int, int]:
    """The photo decoded and shrunk to `max_px`, with the size it had. Shared: do not modify it."""
    try:
        info = path.stat()
        key: tuple[object, ...] | None = (
            str(path), info.st_size, info.st_mtime_ns, fmt, max_px, develop,
        )  # fmt: skip
    except OSError:
        key = None
    if key is not None:
        with _scaled_lock:
            hit = _SCALED.get(key)
            if hit is not None:
                _SCALED.move_to_end(key)
                return hit
    bgr = decode(image_bytes(path, fmt, develop), path)
    h, w = bgr.shape[:2]
    if max(h, w) > max_px:
        scale = max_px / max(h, w)
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        bgr = np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    if key is not None:
        with _scaled_lock:
            _SCALED[key] = (bgr, int(w), int(h))
            while len(_SCALED) > _SCALED_KEEP:
                _SCALED.popitem(last=False)
    return bgr, int(w), int(h)


def preview_image(
    path: Path,
    fmt: str,
    max_px: int = 960,
    develop: bool = False,
    adjustments: adjust.Adjustments | None = None,
    lut: luts.Lut | None = None,
) -> PreviewImage:
    """A JPEG data URL no larger than `max_px`, with its size and the size it was scaled from.

    `develop` asks a RAW for a half-size demosaic instead of the camera's embedded preview.
    """
    bgr, w, h = _scaled(path, fmt, max_px, develop)
    if adjustments is not None:
        bgr = adjust.apply(bgr, adjustments, lut)
    out_h, out_w = bgr.shape[:2]
    quality = 80 if max(out_h, out_w) <= 640 else 92  # thumbnails stay light, big views keep detail
    ok, encoded = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise _failed(path)
    url = "data:image/jpeg;base64," + base64.b64encode(encoded.tobytes()).decode("ascii")
    return PreviewImage(url, int(out_w), int(out_h), int(w), int(h))


def preview_data_url(path: Path, fmt: str, max_px: int = 960) -> str:
    return preview_image(path, fmt, max_px).data_url
