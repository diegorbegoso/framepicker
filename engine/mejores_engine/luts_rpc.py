"""JSON-RPC methods of the LUT library."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from mejores_engine.luts_library import MAX_BATCH, MAX_GROUP, LutLibrary, clean_group, clean_name
from mejores_engine.rpc import INVALID_PARAMS, PATH_NOT_ALLOWED, Dispatcher, RpcError
from mejores_engine.scan import Roots


def register(dispatcher: Dispatcher, library: LutLibrary, roots: Roots) -> None:
    @dispatcher.register("luts_list")
    def luts_list(_params: dict[str, Any]) -> dict[str, Any]:
        return {"luts": library.entries()}

    def allowed(raw: Any) -> Path:
        if not isinstance(raw, str) or not raw:
            raise RpcError(INVALID_PARAMS, "a path must be a non-empty string")
        path = Path(raw)
        if not path.is_absolute() or not roots.is_allowed(path):
            raise RpcError(PATH_NOT_ALLOWED, f"path not allowed: {path}")
        return path

    def lut_id_of(params: dict[str, Any]) -> str:
        lut_id = params.get("lut_id")
        if not isinstance(lut_id, str) or not lut_id:
            raise RpcError(INVALID_PARAMS, "lut_id must be a non-empty string")
        return lut_id

    @dispatcher.register("luts_add")
    def luts_add(params: dict[str, Any]) -> dict[str, Any]:
        return library.add(allowed(params.get("path")), clean_group(params.get("group")))

    @dispatcher.register("luts_add_many")
    def luts_add_many(params: dict[str, Any]) -> dict[str, Any]:
        raw = params.get("paths")
        if not isinstance(raw, list) or not raw or len(raw) > MAX_BATCH:
            raise RpcError(INVALID_PARAMS, f"paths must be a list of 1 to {MAX_BATCH} paths")
        paths = [allowed(item) for item in raw]
        return library.add_many(paths, clean_group(params.get("group")))

    @dispatcher.register("luts_add_folder")
    def luts_add_folder(params: dict[str, Any]) -> dict[str, Any]:
        return library.add_folder(allowed(params.get("path")))

    @dispatcher.register("luts_update")
    def luts_update(params: dict[str, Any]) -> dict[str, Any]:
        changes: dict[str, Any] = {
            k: params[k] for k in ("name", "group", "favorite") if k in params
        }
        return {"lut": library.update(lut_id_of(params), changes)}

    @dispatcher.register("luts_group_rename")
    def luts_group_rename(params: dict[str, Any]) -> dict[str, Any]:
        old = clean_name(params.get("from"), MAX_GROUP, what="from")
        moved = library.rename_group(old, params.get("to"))
        return {"moved": moved}

    @dispatcher.register("luts_group_remove")
    def luts_group_remove(params: dict[str, Any]) -> dict[str, Any]:
        group = clean_name(params.get("group"), MAX_GROUP, what="group")
        return {"removed": library.remove_group(group)}

    @dispatcher.register("luts_remove")
    def luts_remove(params: dict[str, Any]) -> dict[str, Any]:
        lut_id = lut_id_of(params)
        library.remove(lut_id)
        return {"lut_id": lut_id}
