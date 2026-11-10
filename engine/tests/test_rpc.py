from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, METHOD_NOT_FOUND, PARSE_ERROR

ENGINE_DIR = Path(__file__).resolve().parents[1]


def call(line: str) -> dict[str, object]:
    response = build_dispatcher().handle_line(line)
    assert response is not None
    parsed: dict[str, object] = json.loads(response)
    return parsed


def test_ping_returns_pong_and_version() -> None:
    reply = call('{"jsonrpc":"2.0","id":1,"method":"ping"}')
    assert reply == {"jsonrpc": "2.0", "id": 1, "result": {"pong": True, "version": "0.1.0"}}


def test_unknown_method_reports_method_not_found() -> None:
    reply = call('{"jsonrpc":"2.0","id":2,"method":"nope"}')
    error = reply["error"]
    assert isinstance(error, dict)
    assert error["code"] == METHOD_NOT_FOUND


def test_malformed_json_reports_parse_error_with_null_id() -> None:
    reply = call("{not json")
    error = reply["error"]
    assert isinstance(error, dict)
    assert error["code"] == PARSE_ERROR
    assert reply["id"] is None


def test_non_object_params_report_invalid_params() -> None:
    reply = call('{"jsonrpc":"2.0","id":3,"method":"ping","params":[1]}')
    error = reply["error"]
    assert isinstance(error, dict)
    assert error["code"] == INVALID_PARAMS


def test_notification_gets_no_response() -> None:
    assert build_dispatcher().handle_line('{"jsonrpc":"2.0","method":"ping"}') is None


def test_entry_point_answers_a_ping_over_stdio() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "mejores_engine"],
        input='{"jsonrpc":"2.0","id":7,"method":"ping"}\n',
        capture_output=True,
        text=True,
        cwd=ENGINE_DIR,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0
    lines = [line for line in result.stdout.splitlines() if line]
    assert len(lines) == 1
    assert json.loads(lines[0])["result"]["pong"] is True


def test_version_flag_prints_the_version() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "mejores_engine", "--version"],
        capture_output=True,
        text=True,
        cwd=ENGINE_DIR,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0
    assert result.stdout.strip() == "mejores-engine 0.1.0"
