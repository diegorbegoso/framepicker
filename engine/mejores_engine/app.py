"""The RPC method registry and the command line entry point. Later steps add methods here."""

from __future__ import annotations

import sys
from typing import Any

from mejores_engine import __version__
from mejores_engine.rpc import Dispatcher, serve


def build_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()

    @dispatcher.register("ping")
    def ping(_params: dict[str, Any]) -> dict[str, Any]:
        return {"pong": True, "version": __version__}

    @dispatcher.register("version")
    def version(_params: dict[str, Any]) -> dict[str, Any]:
        return {"version": __version__}

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
