"""The `preview` RPC: a photo as a JPEG at a size, optionally with its corrections.

`edited` shows the corrections saved for the photo. `adjustments` shows a correction that is not
saved (the slider being dragged) and wins over `edited`; nothing is written either way.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from mejores_engine import adjust, edits, features
from mejores_engine.luts_library import LutLibrary
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher, RpcError
from mejores_engine.store import Store


def _flag(params: dict[str, Any], key: str) -> bool:
    value = params.get(key, False)
    if not isinstance(value, bool):
        raise RpcError(INVALID_PARAMS, f"{key} must be true or false")
    return value


def register(dispatcher: Dispatcher, store: Callable[[], Store], library: LutLibrary) -> None:
    @dispatcher.register("preview")
    def preview(params: dict[str, Any]) -> dict[str, Any]:
        photo_id = params.get("photo_id")
        if not isinstance(photo_id, str):
            raise RpcError(INVALID_PARAMS, "photo_id must be a string")
        max_px = params.get("max_px", 960)
        if isinstance(max_px, bool) or not isinstance(max_px, int) or not 16 <= max_px <= 8192:
            raise RpcError(INVALID_PARAMS, "max_px must be an integer from 16 to 8192")
        develop = _flag(params, "develop")
        edited = _flag(params, "edited")
        draft = (
            adjust.parse(params["adjustments"]) if params.get("adjustments") is not None else None
        )
        with store().session() as conn:
            row = conn.execute(
                "SELECT path, format FROM photos WHERE id = ?", (photo_id,)
            ).fetchone()
            if row is None:
                raise RpcError(NOT_FOUND, f"photo not found: {photo_id}")
            adjustments = draft
            if adjustments is None and edited:
                adjustments = edits.load_many(conn, [photo_id]).get(photo_id)
        lut = library.find(adjustments.lut_id) if adjustments and adjustments.lut_id else None
        image = features.preview_image(
            Path(row["path"]), str(row["format"]), max_px, develop, adjustments, lut
        )
        return {
            "data_url": image.data_url,
            "width": image.width,
            "height": image.height,
            "source_width": image.source_width,
            "source_height": image.source_height,
        }
