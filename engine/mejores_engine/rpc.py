"""Line-delimited JSON-RPC 2.0 over stdio. One JSON object per line, in both directions."""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from typing import Any, TextIO

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
PATH_NOT_ALLOWED = -32010
NOT_FOUND = -32011
CANCELLED = -32012
STORE_TOO_NEW = -32013
DEST_INSIDE_SOURCE = -32014
DECODE_FAILED = -32015

Handler = Callable[[dict[str, Any]], Any]


class RpcError(Exception):
    """An error a handler wants the caller to see, with a stable machine code."""

    def __init__(self, code: int, message: str, data: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


class Dispatcher:
    def __init__(self) -> None:
        self._methods: dict[str, Handler] = {}

    def register(self, name: str) -> Callable[[Handler], Handler]:
        def decorator(handler: Handler) -> Handler:
            self._methods[name] = handler
            return handler

        return decorator

    def has(self, name: str) -> bool:
        return name in self._methods

    def handle_line(self, line: str) -> str | None:
        """Return the response line, or None when the request was a notification."""
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            return _error(None, PARSE_ERROR, "parse error")
        if not isinstance(request, dict) or not isinstance(request.get("method"), str):
            return _error(None, INVALID_REQUEST, "invalid request")
        request_id = request.get("id")
        is_notification = "id" not in request
        params = request.get("params", {})
        if not isinstance(params, dict):
            if is_notification:
                return None
            return _error(request_id, INVALID_PARAMS, "params must be an object")
        handler = self._methods.get(request["method"])
        if handler is None:
            if is_notification:
                return None
            return _error(request_id, METHOD_NOT_FOUND, f"unknown method: {request['method']}")
        try:
            result = handler(params)
        except RpcError as exc:
            if is_notification:
                return None
            return _error(request_id, exc.code, exc.message, exc.data)
        except Exception as exc:  # noqa: BLE001 - last line of defence at the process boundary
            if is_notification:
                return None
            return _error(request_id, INTERNAL_ERROR, f"{type(exc).__name__}: {exc}")
        if is_notification:
            return None
        return _dump({"jsonrpc": "2.0", "id": request_id, "result": result})


def _error(request_id: Any, code: int, message: str, data: dict[str, Any] | None = None) -> str:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return _dump({"jsonrpc": "2.0", "id": request_id, "error": error})


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def serve(dispatcher: Dispatcher, source: TextIO, sink: TextIO) -> None:
    """Answer requests until the input closes. Stray prints from libraries go to stderr."""
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for raw in source:
            line = raw.strip()
            if not line:
                continue
            response = dispatcher.handle_line(line)
            if response is not None:
                sink.write(response + "\n")
                sink.flush()
    finally:
        sys.stdout = real_stdout
