"""The RPC method registry and the command line entry point. Later steps add methods here."""

from __future__ import annotations

import sys
from collections.abc import Callable
from typing import Any

from mejores_engine import __version__, settings
from mejores_engine.rpc import INVALID_PARAMS, Dispatcher, RpcError, serve
from mejores_engine.store import Store


def build_dispatcher(store_factory: Callable[[], Store] = Store) -> Dispatcher:
    dispatcher = Dispatcher()
    holder: list[Store] = []

    def store() -> Store:
        if not holder:
            holder.append(store_factory())
        return holder[0]

    @dispatcher.register("ping")
    def ping(_params: dict[str, Any]) -> dict[str, Any]:
        return {"pong": True, "version": __version__}

    @dispatcher.register("version")
    def version(_params: dict[str, Any]) -> dict[str, Any]:
        return {"version": __version__}

    @dispatcher.register("settings_get")
    def settings_get(_params: dict[str, Any]) -> dict[str, Any]:
        with store().session() as conn:
            return settings.get_all(conn)

    @dispatcher.register("settings_set")
    def settings_set(params: dict[str, Any]) -> dict[str, Any]:
        key = params.get("key")
        if not isinstance(key, str) or "value" not in params:
            raise RpcError(INVALID_PARAMS, "settings_set needs key and value")
        with store().session() as conn:
            clean = settings.set_value(conn, key, params["value"])
        return {"key": key, "value": clean}

    return dispatcher


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args == ["--version"]:
        print(f"mejores-engine {__version__}")
        return 0
    if args:
        print("unknown arguments: " + " ".join(args), file=sys.stderr)
        return 2
    serve(build_dispatcher(), sys.stdin, sys.stdout)
    return 0
