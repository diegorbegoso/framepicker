# Epic 01: Fundamentos

> Existe un proyecto que compila, un motor que responde por JSON-RPC, una base con migraciones, un shell de escritorio que lo arranca y un escaneo seguro de carpetas.

| | |
|---|---|
| **Epic id** | `01-fundamentos` |
| **Tasks** | `E1-T1` … `E1-T6` |
| **Depends on** | nothing — start here |
| **Unlocks** | `02-motor-de-analisis`, `03-interfaz-y-entrega` |
| **Parallel with** | nothing — everything waits on this epic |

You do not need any other file to complete this epic. Everything below is repeated here on purpose. References to `§N` point at `blueprint.md`, but every fact a task needs is written in the task itself.

---

## Stack

Tauri (Rust shell) · React 19 + TypeScript + Vite · Python 3.12 analysis engine (rawpy, OpenCV, MediaPipe) · SQLite · CSS custom properties for the light/dark themes · no auth, no hosting, no payments.
Package managers: `pnpm` (JS), `uv` (Python), `cargo` (Rust). Runtime pinned in `.nvmrc`, `.python-version` and `rust-toolchain.toml`. Dependency versions are in `pnpm-lock.yaml`, `engine/uv.lock` and `src-tauri/Cargo.lock` — read them, never guess one.

| Task | Command |
|---|---|
| Install | `pnpm install` · `uv sync --directory engine` |
| Typecheck | `pnpm typecheck` · `pnpm typecheck:engine` |
| Lint | `pnpm lint` · `pnpm lint:engine` |
| Test (one file) | `pnpm exec vitest run <path>` · `uv run --directory engine pytest tests/<file> -q` |
| Test (all) | `pnpm test` · `pnpm test:engine` · `pnpm test:rust` |
| Build | `pnpm build:ui` · `cargo build --manifest-path src-tauri/Cargo.toml` |

**Gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm lint:engine && pnpm typecheck:engine && pnpm test:engine && pnpm test:rust` passes before any task here is marked done.

No local service is needed: SQLite is a file and the tests use temporary folders. Shell: Git Bash, from the project root, with `$HOME/.local/bin` on `PATH`.

## Directory subtree

Only the parts this epic touches:

```
index.html                         # NEW (step 1)
src/
  main.tsx App.tsx App.test.tsx    # NEW (step 1)
  styles/tokens.css                # exists, read-only
  lib/ipc.ts ipc.test.ts           # NEW (step 5)
src-tauri/
  Cargo.toml build.rs tauri.conf.json capabilities/default.json   # exist, read-only
  src/main.rs lib.rs engine.rs     # NEW (steps 4, 5)
  icon-source.png icons/           # NEW, generated (step 4)
scripts/make_icon.py               # NEW (step 4)
engine/
  pyproject.toml                   # exists, read-only
  mejores_engine/
    __init__.py __main__.py rpc.py app.py    # NEW (steps 2, 3, 6)
    store.py settings.py scan.py             # NEW (steps 3, 6)
    migrations/0001_init.sql                 # NEW (step 3)
  tests/test_rpc.py test_store.py test_scan.py   # NEW (steps 2, 3, 6)
```

Everything outside this subtree is out of scope. If a task seems to require editing a file not listed here, stop and report — it means the epic boundary is wrong.

## Data model touched here

| Entity | Fields this epic adds or reads | Notes |
|---|---|---|
| `settings` | `key, value` | Only keys `theme`, `weights`, `per_burst`, `time_gap_s`, `hamming_max` |
| `sessions` | `id, label, created_at` | Created by `scan`; deleting cascades to everything below |
| `photos` | `id, session_id, path, format, size_bytes, mtime_ns` | `scan` fills these; width/height/exif_time/dhash stay NULL until step 8 |
| `schema_migrations` | `version, applied_at` | Written by the migration runner only |

## Contracts

**Consumed** — already exists, do not rebuild:

| From | Interface | Guarantee |
|---|---|---|
| workspace (Bootstrap) | `package.json`, `tsconfig.json`, `vite.config.ts`, `biome.json`, `engine/pyproject.toml`, `src-tauri/Cargo.toml`, `tauri.conf.json`, `src/styles/tokens.css` | Already in the project root; do not rewrite them |

**Produced** — later steps depend on exactly these signatures. Changing one breaks them:

| Export | Signature | Used by |
|---|---|---|
| `engine/mejores_engine/rpc.py` → `Dispatcher`, `RpcError`, error codes, `serve` | `Dispatcher.register(name)`, `RpcError(code, message, data=None)` | `02-motor-de-analisis`, `03-interfaz-y-entrega` |
| `engine/mejores_engine/store.py` → `Store` | `Store(directory=None)`, `Store.session()` context manager, `EXPECTED_TABLES` | every engine step |
| `engine/mejores_engine/settings.py` → `DEFAULTS`, `get_all`, `set_value` | `set_value(conn, key, value) -> Any` | `02-motor-de-analisis`, `03-interfaz-y-entrega` |
| `engine/mejores_engine/scan.py` → `Roots`, `SUPPORTED`, `collect` | `Roots.grant(paths) -> int`, `Roots.is_allowed(path) -> bool` | steps 7, 15 |
| `src-tauri/src/engine.rs` → `FORWARDABLE`, `EngineClient` | `EngineClient::spawn(on_event)`, `request(method, params, timeout)` | `03-interfaz-y-entrega` |
| `src/lib/ipc.ts` → `engineRequest`, `EngineError` | `engineRequest(method, params, zodSchema)` | `03-interfaz-y-entrega` |

## Conventions that bite in this area

- stdout of the engine belongs to the protocol. Nothing but `serve()` writes to it; `serve()` redirects `sys.stdout` to `sys.stderr` while it runs.
- `engine/` is a uv project with `package = false`: run it as `uv run --directory engine python -m mejores_engine`, never `python engine/mejores_engine/…`.
- `cargo build` needs `dist/` to exist (`generate_context!` embeds it): run `pnpm build:ui` first.
- The first Tauri compile takes several minutes (it installs the Rust toolchain pinned in `rust-toolchain.toml` and builds every dependency). Do not interrupt it.
- Debug builds print `--version`; release builds (`windows_subsystem = "windows"`) do not, so every gate uses the debug executable.

Full project rules: `CLAUDE.md`. Area rules: `.claude/rules/*.md`. Both sit in the project root — the builder copied them there from the bundle's `workspace/` before task one.

---

## Tasks

Listed in the same order as `tasks.json`. That order is the build order — work top to bottom and do not re-rank by priority or by what looks quick.

### `E1-T1` — Base de interfaz y compuertas de calidad

**Depends on:** nothing · **Priority:** p0 — metadata for scope cuts, not a running order

Bootstrap (§10) ya dejó en la raíz del proyecto los manifiestos, `tsconfig.json`,
`vite.config.ts`, `vitest.setup.ts`, `biome.json` y `src/styles/tokens.css` (§19.6). Este paso crea la
pantalla mínima y demuestra que todas las compuertas del lado de la interfaz corren. Crea exactamente
estos cuatro archivos, con este contenido:

**`index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mejores Tomas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`src/App.tsx`**

```tsx
export function App() {
  return (
    <main>
      <h1>Mejores Tomas</h1>
      <p>Selecciona las mejores tomas de tus ráfagas, sin salir de tu equipo.</p>
    </main>
  );
}
```

**`src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/tokens.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element missing");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**`src/App.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App.tsx";

describe("App", () => {
  it("shows the product name as the page heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Mejores Tomas" })).toBeInTheDocument();
  });
});
```

Después ejecuta `pnpm format` una vez para que Biome deje los archivos en su formato canónico.

**Files**
- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- `src/App.test.tsx`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `pnpm install --frozen-lockfile` runs on the committed tree **THE SYSTEM SHALL** exit 0 and leave `pnpm-lock.yaml` unmodified.
2. **WHEN** `pnpm typecheck` runs **THE SYSTEM SHALL** exit 0 with `"strict": true` present in `tsconfig.json`.
3. **WHEN** `pnpm lint` runs **THE SYSTEM SHALL** exit 0 with no diagnostics.
4. **WHEN** `pnpm exec vitest run src/App.test.tsx` runs **THE SYSTEM SHALL** pass the test that finds a level-1 heading named "Mejores Tomas".
5. **WHEN** `pnpm exec vitest run` is pointed at a test file that does not exist **THE SYSTEM SHALL** exit 1, so a missing test can never pass silently.
6. **WHEN** `pnpm build:ui` runs **THE SYSTEM SHALL** write `dist/index.html` that references a built asset under `assets/`.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm install --frozen-lockfile
git diff --exit-code pnpm-lock.yaml
grep -q '"strict": true' tsconfig.json
pnpm typecheck
pnpm lint
pnpm exec vitest run src/App.test.tsx
status=0; pnpm exec vitest run src/does-not-exist.test.tsx || status=$?; test "$status" -eq 1
pnpm build:ui
test -f dist/index.html
grep -q 'assets/' dist/index.html
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T1: Base de interfaz y compuertas de calidad"
git tag step-01-ui-base
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E1-T2` — Motor Python con JSON-RPC por stdio

**Depends on:** `E1-T1` · **Priority:** p0 — metadata for scope cuts, not a running order

El motor es un proceso Python que habla JSON-RPC 2.0, un objeto JSON por línea, por stdin y
stdout. Nada más escribe en stdout: `serve()` redirige `sys.stdout` a `sys.stderr` mientras atiende, para
que cualquier `print` de una librería no corrompa el protocolo. Crea estos cinco archivos con este
contenido (las rutas son relativas a la raíz del proyecto; `engine/` es un proyecto uv sin paquete
instalable, así que se ejecuta siempre con `uv run --directory engine python -m mejores_engine`):

**`engine/mejores_engine/__init__.py`**

```python
"""Mejores Tomas analysis engine."""

__version__ = "0.1.0"
```

**`engine/mejores_engine/rpc.py`**

```python
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
```

**`engine/mejores_engine/app.py`**

```python
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
```

**`engine/mejores_engine/__main__.py`**

```python
import sys

from mejores_engine.app import main

sys.exit(main())
```

**`engine/tests/test_rpc.py`**

```python
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
```

Después ejecuta `uv run --directory engine ruff format .` una vez.

**Files**
- `engine/mejores_engine/__init__.py`
- `engine/mejores_engine/__main__.py`
- `engine/mejores_engine/rpc.py`
- `engine/mejores_engine/app.py`
- `engine/tests/test_rpc.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** the line `{"jsonrpc":"2.0","id":1,"method":"ping"}` is sent to `uv run --directory engine python -m mejores_engine` **THE SYSTEM SHALL** answer exactly one line containing `"pong":true` and exit 0 at end of input.
2. **WHEN** `uv run --directory engine python -m mejores_engine --version` runs **THE SYSTEM SHALL** print `mejores-engine 0.1.0` and exit 0.
3. **WHEN** a request names an unknown method **THE SYSTEM SHALL** reply with error code -32601 and the same id.
4. **WHEN** an input line is not valid JSON **THE SYSTEM SHALL** reply with error code -32700 and `id` null instead of crashing.
5. **WHEN** a request omits `id` **THE SYSTEM SHALL** send no response.
6. **WHEN** `pnpm test:engine`, `pnpm lint:engine` and `pnpm typecheck:engine` run **THE SYSTEM SHALL** exit 0.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
uv run --directory engine python -m mejores_engine --version | grep -qx 'mejores-engine 0.1.0'
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"ping"}' | uv run --directory engine python -m mejores_engine | grep -q '"pong":true'
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T2: Motor Python con JSON-RPC por stdio"
git tag step-02-engine-rpc
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E1-T3` — Almacén SQLite y migraciones hacia adelante

**Depends on:** `E1-T2` · **Priority:** p0 — metadata for scope cuts, not a running order

El motor es el único dueño de la base de datos (§4). La interfaz nunca abre SQLite. Este paso
agrega el almacén con un corredor de migraciones que solo avanza, los ajustes del usuario (entre ellos el
tema, claro por defecto) y los métodos `settings_get` y `settings_set`. Crea o reemplaza estos cinco
archivos (`app.py` se reemplaza completo; la versión del paso 2 ya no sirve):

**`engine/mejores_engine/migrations/0001_init.sql`**

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('jpg', 'png', 'raw')),
  size_bytes INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  exif_time TEXT,
  dhash TEXT,
  UNIQUE (session_id, path)
);

CREATE INDEX idx_photos_session ON photos (session_id);

CREATE TABLE scores (
  photo_id TEXT PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  sharpness REAL NOT NULL,
  exposure REAL NOT NULL,
  mean_luma REAL NOT NULL,
  clip_hi REAL NOT NULL,
  clip_lo REAL NOT NULL,
  eyes_open REAL,
  engine_version TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE bursts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  UNIQUE (session_id, position)
);

CREATE TABLE burst_members (
  burst_id TEXT NOT NULL REFERENCES bursts (id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (burst_id, photo_id),
  UNIQUE (burst_id, position)
);

CREATE TABLE selections (
  burst_id TEXT NOT NULL REFERENCES bursts (id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('auto', 'user')),
  selected INTEGER NOT NULL CHECK (selected IN (0, 1)),
  PRIMARY KEY (burst_id, photo_id)
);
```

**`engine/mejores_engine/store.py`**

```python
"""The local SQLite store and its forward-only migration runner."""

from __future__ import annotations

import os
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from mejores_engine.rpc import STORE_TOO_NEW, RpcError

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")

EXPECTED_TABLES = (
    "settings",
    "sessions",
    "photos",
    "scores",
    "bursts",
    "burst_members",
    "selections",
    "schema_migrations",
)


def data_dir() -> Path:
    """Where the engine keeps its database and caches. MT_DATA_DIR overrides the default."""
    override = os.environ.get("MT_DATA_DIR")
    if override:
        return Path(override)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "MejoresTomas"
    return Path.home() / ".mejores-tomas"


def migration_files() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = _MIGRATION_NAME.match(path.name)
        if match is None:
            raise ValueError(f"bad migration file name: {path.name}")
        found.append((match.group(1), path))
    return found


class Store:
    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory if directory is not None else data_dir()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "mejores.sqlite3"
        with self.session() as conn:
            self._migrate(conn)

    def _open(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @contextmanager
    def session(self) -> Iterator[sqlite3.Connection]:
        """A short-lived connection. Commits on success, rolls back on error, always closes."""
        conn = self._open()
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def applied_versions(self) -> list[str]:
        with self.session() as conn:
            rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        return [str(row["version"]) for row in rows]

    def _migrate(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        conn.commit()
        known = migration_files()
        known_versions = {version for version, _ in known}
        applied = {
            str(row["version"])
            for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
        }
        unknown = sorted(applied - known_versions)
        if unknown:
            raise RpcError(
                STORE_TOO_NEW,
                "the database was written by a newer version of Mejores Tomas",
                {"versions": unknown},
            )
        for version, path in known:
            if version in applied:
                continue
            script = (
                "BEGIN;\n"
                + path.read_text(encoding="utf-8")
                + "\nINSERT INTO schema_migrations (version, applied_at) "
                f"VALUES ('{version}', datetime('now'));\nCOMMIT;\n"
            )
            conn.executescript(script)
```

**`engine/mejores_engine/settings.py`**

```python
"""User settings, stored as JSON text in the settings table with typed defaults."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from mejores_engine.rpc import INVALID_PARAMS, RpcError

DEFAULTS: dict[str, Any] = {
    "theme": "light",
    "weights": {"sharpness": 0.6, "exposure": 0.2, "eyes": 0.2},
    "per_burst": 1,
    "time_gap_s": 2.0,
    "hamming_max": 22,
}

THEMES = ("light", "dark")


def _bad(message: str) -> RpcError:
    return RpcError(INVALID_PARAMS, message)


def _number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _bad(f"{name} must be a number")
    return float(value)


def validate(key: str, value: Any) -> Any:
    if key not in DEFAULTS:
        raise _bad(f"unknown setting: {key}")
    if key == "theme":
        if value not in THEMES:
            raise _bad("theme must be 'light' or 'dark'")
        return value
    if key == "weights":
        if not isinstance(value, dict) or set(value) != {"sharpness", "exposure", "eyes"}:
            raise _bad("weights needs exactly sharpness, exposure and eyes")
        numbers = {name: _number(value[name], f"weights.{name}") for name in value}
        if any(n < 0 for n in numbers.values()) or sum(numbers.values()) <= 0:
            raise _bad("weights must be non-negative and not all zero")
        return numbers
    if key == "per_burst":
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 20:
            raise _bad("per_burst must be an integer from 1 to 20")
        return value
    if key == "time_gap_s":
        number = _number(value, key)
        if not 0.0 <= number <= 60.0:
            raise _bad("time_gap_s must be between 0 and 60")
        return number
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 64:
        raise _bad("hamming_max must be an integer from 0 to 64")
    return value


def get_all(conn: sqlite3.Connection) -> dict[str, Any]:
    result = dict(DEFAULTS)
    for row in conn.execute("SELECT key, value FROM settings").fetchall():
        if row["key"] in DEFAULTS:
            result[str(row["key"])] = json.loads(row["value"])
    return result


def set_value(conn: sqlite3.Connection, key: str, value: Any) -> Any:
    clean = validate(key, value)
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(clean)),
    )
    return clean
```

**`engine/mejores_engine/app.py`**

```python
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
```

**`engine/tests/test_store.py`**

```python
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from mejores_engine import settings
from mejores_engine.app import build_dispatcher
from mejores_engine.rpc import INVALID_PARAMS, STORE_TOO_NEW, RpcError
from mejores_engine.store import EXPECTED_TABLES, Store, data_dir


def table_names(store: Store) -> set[str]:
    with store.session() as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {str(row["name"]) for row in rows}


def test_fresh_store_creates_every_expected_table(tmp_path: Path) -> None:
    store = Store(tmp_path)
    assert set(EXPECTED_TABLES) <= table_names(store)


def test_reopening_applies_nothing_and_keeps_data(tmp_path: Path) -> None:
    first = Store(tmp_path)
    with first.session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s1', 'x', 'now')")
    versions = first.applied_versions()
    second = Store(tmp_path)
    assert second.applied_versions() == versions
    with second.session() as conn:
        assert conn.execute("SELECT count(*) AS n FROM sessions").fetchone()["n"] == 1


def test_a_database_from_a_newer_build_is_refused(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with store.session() as conn:
        conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES ('9999', 'now')")
    with pytest.raises(RpcError) as caught:
        Store(tmp_path)
    assert caught.value.code == STORE_TOO_NEW


def test_foreign_keys_are_enforced(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with pytest.raises(sqlite3.IntegrityError), store.session() as conn:
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES ('p', 'missing', 'a.jpg', 'jpg', 1, 1)"
        )


def test_deleting_a_session_cascades_to_its_photos(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with store.session() as conn:
        conn.execute("INSERT INTO sessions (id, label, created_at) VALUES ('s', 'x', 'now')")
        conn.execute(
            "INSERT INTO photos (id, session_id, path, format, size_bytes, mtime_ns) "
            "VALUES ('p', 's', 'a.jpg', 'jpg', 1, 1)"
        )
        conn.execute("DELETE FROM sessions WHERE id = 's'")
        assert conn.execute("SELECT count(*) AS n FROM photos").fetchone()["n"] == 0


def test_data_dir_honours_the_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("MT_DATA_DIR", str(tmp_path / "custom"))
    assert data_dir() == tmp_path / "custom"


def test_theme_defaults_to_light_and_persists_dark(tmp_path: Path) -> None:
    dispatcher = build_dispatcher(lambda: Store(tmp_path))
    first = json.loads(
        dispatcher.handle_line('{"jsonrpc":"2.0","id":1,"method":"settings_get"}') or ""
    )
    assert first["result"]["theme"] == "light"
    set_line = (
        '{"jsonrpc":"2.0","id":2,"method":"settings_set","params":{"key":"theme","value":"dark"}}'
    )
    assert json.loads(dispatcher.handle_line(set_line) or "")["result"]["value"] == "dark"
    reopened = build_dispatcher(lambda: Store(tmp_path))
    again = json.loads(
        reopened.handle_line('{"jsonrpc":"2.0","id":3,"method":"settings_get"}') or ""
    )
    assert again["result"]["theme"] == "dark"


def test_invalid_theme_is_rejected_and_not_stored(tmp_path: Path) -> None:
    store = Store(tmp_path)
    with pytest.raises(RpcError) as caught, store.session() as conn:
        settings.set_value(conn, "theme", "blue")
    assert caught.value.code == INVALID_PARAMS
    with store.session() as conn:
        assert settings.get_all(conn)["theme"] == "light"
```

Después ejecuta `uv run --directory engine ruff format .` una vez. La base vive en
`%LOCALAPPDATA%\MejoresTomas\mejores.sqlite3`; la variable `MT_DATA_DIR` la redirige (las pruebas usan
carpetas temporales y nunca tocan la base real).

**Files**
- `engine/mejores_engine/store.py`
- `engine/mejores_engine/settings.py`
- `engine/mejores_engine/migrations/0001_init.sql`
- `engine/mejores_engine/app.py`
- `engine/tests/test_store.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** a `Store` opens an empty directory **THE SYSTEM SHALL** apply migration `0001`, create every table named in `EXPECTED_TABLES`, and record `0001` in `schema_migrations`.
2. **WHEN** the same directory is opened a second time **THE SYSTEM SHALL** apply no migration and keep every existing row.
3. **WHEN** `schema_migrations` holds a version this build does not ship **THE SYSTEM SHALL** refuse to open the store with error code -32013.
4. **WHEN** a `photos` row references a session that does not exist **THE SYSTEM SHALL** raise an integrity error, and WHEN a session is deleted **THE SYSTEM SHALL** delete its photos.
5. **WHEN** `settings_get` runs on an empty store **THE SYSTEM SHALL** report `theme` as "light", and WHEN `settings_set` stores "dark" **THE SYSTEM SHALL** report "dark" after the store is reopened.
6. **WHEN** `settings_set` receives `theme` = "blue" **THE SYSTEM SHALL** reply with error code -32602 and store nothing.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
test -f engine/mejores_engine/migrations/0001_init.sql
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T3: Almacén SQLite y migraciones hacia adelante"
git tag step-03-store
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E1-T4` — Shell de escritorio: ventana y binario ejecutable

**Depends on:** `E1-T1` · **Priority:** p0 — metadata for scope cuts, not a running order

Primer paso que produce un ejecutable, así que su `Verify` lo **ejecuta** (regla 13). El shell es
Tauri; `src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json` y `capabilities/default.json` ya están en el
proyecto (§19.6). Hay tres piezas:

1. `scripts/make_icon.py` dibuja un icono fuente de 1024×1024 con Pillow y lo guarda en
   `src-tauri/icon-source.png`. Tauri en Windows exige `icons/icon.ico` para compilar, y
   `pnpm tauri icon` genera todo el conjunto a partir de ese PNG.
2. `src-tauri/src/lib.rs` expone `wants_version`, `version_line` y `run`. `run` crea la ventana.
3. `src-tauri/src/main.rs` atiende `--version` **antes** de crear ninguna ventana, para que el binario
   sea comprobable sin interfaz gráfica. En compilaciones de depuración conserva la consola; en las de
   publicación (`windows_subsystem = "windows"`) no imprime nada, por eso las compuertas usan `debug`.

**`scripts/make_icon.py`**

```python
"""Generate the 1024x1024 source icon at src-tauri/icon-source.png. Needs Pillow."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
OUT = Path(__file__).resolve().parents[1] / "src-tauri" / "icon-source.png"


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((64, 64, SIZE - 64, SIZE - 64), radius=200, fill=(37, 99, 214, 255))
    draw.ellipse((272, 272, SIZE - 272, SIZE - 272), outline=(255, 255, 255, 255), width=56)
    draw.ellipse((420, 420, SIZE - 420, SIZE - 420), fill=(255, 255, 255, 255))
    image.save(OUT)


if __name__ == "__main__":
    main()
```

**`src-tauri/src/lib.rs`**

```rust
/// True when the process was started with the exact `--version` flag (the program name is skipped).
pub fn wants_version(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--version")
}

pub fn version_line() -> String {
    format!("mejores-tomas {}", env!("CARGO_PKG_VERSION"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Mejores Tomas");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn the_version_flag_is_detected() {
        assert!(wants_version(&args(&["mejores-tomas", "--version"])));
    }

    #[test]
    fn near_misses_are_not_version_requests() {
        assert!(!wants_version(&args(&["mejores-tomas", "--versions"])));
        assert!(!wants_version(&args(&["mejores-tomas", "-v"])));
        assert!(!wants_version(&args(&["mejores-tomas"])));
    }

    #[test]
    fn the_version_line_names_the_product_and_the_cargo_version() {
        assert_eq!(version_line(), "mejores-tomas 0.1.0");
    }
}
```

**`src-tauri/src/main.rs`**

```rust
// Release builds run as a GUI process; debug builds keep the console so --version can print.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if mejores_tomas_lib::wants_version(&args) {
        println!("{}", mejores_tomas_lib::version_line());
        return;
    }
    mejores_tomas_lib::run();
}
```

Genera el conjunto de iconos y construye (la interfaz primero: `generate_context!` exige que `dist/`
exista):

```bash
uv run --directory engine python ../scripts/make_icon.py
pnpm tauri icon src-tauri/icon-source.png
pnpm build:ui
cargo build --manifest-path src-tauri/Cargo.toml
```

La primera compilación de Tauri tarda varios minutos (descarga e instala la cadena de Rust fijada en
`rust-toolchain.toml` y compila las dependencias). Las siguientes son incrementales.

**Files**
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `scripts/make_icon.py`
- `src-tauri/icon-source.png`
- `src-tauri/icons/**`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `pnpm build:ui` and then `cargo build --manifest-path src-tauri/Cargo.toml` run **THE SYSTEM SHALL** exit 0 and write `src-tauri/target/debug/mejores-tomas.exe`.
2. **WHEN** `src-tauri/target/debug/mejores-tomas.exe --version` runs **THE SYSTEM SHALL** print `mejores-tomas 0.1.0` and exit 0 without opening a window.
3. **WHEN** `uv run --directory engine python ../scripts/make_icon.py` runs **THE SYSTEM SHALL** write a non-empty `src-tauri/icon-source.png`.
4. **WHEN** `pnpm tauri icon src-tauri/icon-source.png` runs **THE SYSTEM SHALL** create `src-tauri/icons/icon.ico`, `32x32.png`, `128x128.png` and `128x128@2x.png`, the four files `tauri.conf.json` lists.
5. **WHEN** `pnpm test:rust` runs **THE SYSTEM SHALL** pass the tests that prove `wants_version` is true for `--version` and false for `--versions`, `-v` and no arguments.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
uv run --directory engine python ../scripts/make_icon.py
test -s src-tauri/icon-source.png
pnpm tauri icon src-tauri/icon-source.png
test -f src-tauri/icons/icon.ico
test -f src-tauri/icons/32x32.png
test -f src-tauri/icons/128x128.png
test -f 'src-tauri/icons/128x128@2x.png'
pnpm build:ui
cargo build --manifest-path src-tauri/Cargo.toml
src-tauri/target/debug/mejores-tomas.exe --version | grep -qx 'mejores-tomas 0.1.0'
pnpm test:rust
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T4: Shell de escritorio: ventana y binario ejecutable"
git tag step-04-shell
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E1-T5` — Puente entre el shell y el motor

**Depends on:** `E1-T2`, `E1-T4` · **Priority:** p0 — metadata for scope cuts, not a running order

El shell arranca el motor como proceso hijo, le envía una petición por línea y reparte las
respuestas. La interfaz **no** puede hablarle al motor directamente: solo conoce el comando Tauri
`engine_request`, que reenvía únicamente los métodos de la lista blanca `FORWARDABLE`. `grant_roots`
(el método que autoriza carpetas para el análisis, paso 6) **no** está en la lista: solo lo invocan los
comandos `pick_folder` y `pick_files` del propio shell, después de que la persona elige en el diálogo
nativo. Así ningún código de la interfaz puede ampliar a qué carpetas tiene acceso el motor.

Reglas del puente:

- En depuración el motor se lanza con `uv run --frozen --directory <repo>/engine python -m mejores_engine`;
  la variable `MT_ENGINE_CMD`, si existe, lo reemplaza (se separa por espacios). En publicación se lanza
  `<carpeta del ejecutable>/engine/mejores-engine.exe` (paso 17).
- El `stderr` del motor se añade a `<MT_DATA_DIR o %LOCALAPPDATA%\MejoresTomas>/logs/engine.log`.
- Las notificaciones del motor (líneas sin `id`) se reenvían a la interfaz como el evento Tauri
  `engine-event` con `{ "method", "params" }`.
- Si el motor termina, toda petición pendiente falla con código -32000 y mensaje "the analysis engine
  stopped".
- Un error del motor llega a la interfaz como el texto JSON `{"code":…,"message":…}`; `ipc.ts` lo
  convierte en la clase `EngineError`.

Crea o reemplaza estos cinco archivos:

**`src-tauri/src/engine.rs`**

```rust
//! Client for the analysis engine: a child process that speaks line-delimited JSON-RPC 2.0.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Methods the interface may reach. `grant_roots` is deliberately absent: only the shell calls it.
pub const FORWARDABLE: &[&str] = &[
    "ping",
    "version",
    "settings_get",
    "settings_set",
    "scan",
    "preview",
    "analyze",
    "cancel",
    "job_status",
    "bursts",
    "select",
    "set_pick",
    "export",
    "selftest",
];

pub fn is_forwardable(method: &str) -> bool {
    FORWARDABLE.contains(&method)
}

pub fn encode_request(id: u64, method: &str, params: &Value) -> String {
    let mut line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        .to_string();
    line.push('\n');
    line
}

#[derive(Debug, Clone, PartialEq)]
pub struct RpcFailure {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, PartialEq)]
pub enum Incoming {
    Response { id: u64, result: Result<Value, RpcFailure> },
    Notification { method: String, params: Value },
}

pub fn decode_line(line: &str) -> Result<Incoming, String> {
    let value: Value =
        serde_json::from_str(line).map_err(|error| format!("invalid JSON from engine: {error}"))?;
    if let Some(id) = value.get("id").and_then(Value::as_u64) {
        if let Some(error) = value.get("error") {
            let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32603);
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_string();
            return Ok(Incoming::Response { id, result: Err(RpcFailure { code, message }) });
        }
        let result = value.get("result").cloned().unwrap_or(Value::Null);
        return Ok(Incoming::Response { id, result: Ok(result) });
    }
    match value.get("method").and_then(Value::as_str) {
        Some(method) => Ok(Incoming::Notification {
            method: method.to_string(),
            params: value.get("params").cloned().unwrap_or(Value::Null),
        }),
        None => Err("engine line is neither a response nor a notification".to_string()),
    }
}

pub fn data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("MT_DATA_DIR") {
        if !custom.is_empty() {
            return PathBuf::from(custom);
        }
    }
    match std::env::var("LOCALAPPDATA") {
        Ok(base) => PathBuf::from(base).join("MejoresTomas"),
        Err(_) => PathBuf::from(".mejores-tomas"),
    }
}

fn log_target() -> Stdio {
    let dir = data_dir().join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return Stdio::null();
    }
    match OpenOptions::new().create(true).append(true).open(dir.join("engine.log")) {
        Ok(file) => Stdio::from(file),
        Err(_) => Stdio::null(),
    }
}

#[cfg(debug_assertions)]
pub fn engine_command() -> Command {
    if let Ok(custom) = std::env::var("MT_ENGINE_CMD") {
        let mut parts = custom.split_whitespace();
        if let Some(program) = parts.next() {
            let mut command = Command::new(program);
            command.args(parts);
            return command;
        }
    }
    let mut command = Command::new("uv");
    command.args([
        "run",
        "--frozen",
        "--directory",
        concat!(env!("CARGO_MANIFEST_DIR"), "/../engine"),
        "python",
        "-m",
        "mejores_engine",
    ]);
    command
}

#[cfg(not(debug_assertions))]
pub fn engine_command() -> Command {
    let exe = std::env::current_exe().expect("cannot locate the application executable");
    let folder = exe.parent().expect("the executable has a parent folder");
    Command::new(folder.join("engine").join("mejores-engine.exe"))
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, RpcFailure>>>>>;

fn stopped() -> RpcFailure {
    RpcFailure { code: -32000, message: "the analysis engine stopped".to_string() }
}

pub struct EngineClient {
    child: Child,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    next_id: AtomicU64,
}

impl EngineClient {
    pub fn spawn(on_event: impl Fn(String, Value) + Send + 'static) -> std::io::Result<EngineClient> {
        let mut command = engine_command();
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(log_target());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = command.spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match decode_line(&line) {
                    Ok(Incoming::Response { id, result }) => {
                        if let Some(sender) = reader_pending.lock().unwrap().remove(&id) {
                            let _ = sender.send(result);
                        }
                    }
                    Ok(Incoming::Notification { method, params }) => on_event(method, params),
                    Err(_) => {}
                }
            }
            for (_, sender) in reader_pending.lock().unwrap().drain() {
                let _ = sender.send(Err(stopped()));
            }
        });
        Ok(EngineClient {
            child,
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
        })
    }

    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, RpcFailure> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, sender);
        let line = encode_request(id, method, &params);
        let written = {
            let mut stdin = self.stdin.lock().unwrap();
            stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush())
        };
        if written.is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err(stopped());
        }
        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(RpcFailure {
                    code: -32000,
                    message: "the analysis engine did not answer in time".to_string(),
                })
            }
        }
    }
}

impl Drop for EngineClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_line_round_trips_through_the_codec() {
        let line = encode_request(7, "ping", &json!({}));
        assert!(line.ends_with('\n'));
        let echoed: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(echoed["id"], 7);
        assert_eq!(echoed["method"], "ping");
        let reply = r#"{"jsonrpc":"2.0","id":7,"result":{"pong":true,"version":"0.1.0"}}"#;
        assert_eq!(
            decode_line(reply).unwrap(),
            Incoming::Response { id: 7, result: Ok(json!({"pong": true, "version": "0.1.0"})) }
        );
    }

    #[test]
    fn an_error_response_keeps_its_code_and_message() {
        let reply = r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32010,"message":"path not allowed"}}"#;
        assert_eq!(
            decode_line(reply).unwrap(),
            Incoming::Response {
                id: 3,
                result: Err(RpcFailure { code: -32010, message: "path not allowed".to_string() }),
            }
        );
    }

    #[test]
    fn a_line_without_an_id_is_a_notification() {
        let line = r#"{"jsonrpc":"2.0","method":"progress","params":{"done":1,"total":4}}"#;
        assert_eq!(
            decode_line(line).unwrap(),
            Incoming::Notification {
                method: "progress".to_string(),
                params: json!({"done": 1, "total": 4}),
            }
        );
    }

    #[test]
    fn garbage_from_the_engine_is_an_error_not_a_panic() {
        assert!(decode_line("not json").is_err());
        assert!(decode_line(r#"{"jsonrpc":"2.0"}"#).is_err());
    }

    #[test]
    fn grant_roots_is_never_forwardable() {
        assert!(!is_forwardable("grant_roots"));
        assert!(is_forwardable("scan"));
        assert!(!is_forwardable("nope"));
    }
}
```

**`src-tauri/src/lib.rs`**

```rust
pub mod engine;

use engine::{is_forwardable, EngineClient, RpcFailure};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

/// True when the process was started with the exact `--version` flag (the program name is skipped).
pub fn wants_version(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--version")
}

/// True when the process was started with the exact `--ping-engine` flag.
pub fn wants_ping_engine(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--ping-engine")
}

pub fn version_line() -> String {
    format!("mejores-tomas {}", env!("CARGO_PKG_VERSION"))
}

/// Starts the engine, asks it to ping, prints `engine-ok <version>`. Returns the process exit code.
pub fn ping_engine() -> i32 {
    let client = match EngineClient::spawn(|_, _| {}) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("could not start the analysis engine: {error}");
            return 1;
        }
    };
    match client.request("ping", json!({}), Duration::from_secs(120)) {
        Ok(value) => match value.get("version").and_then(Value::as_str) {
            Some(version) => {
                println!("engine-ok {version}");
                0
            }
            None => {
                eprintln!("the engine answered ping without a version");
                1
            }
        },
        Err(failure) => {
            eprintln!("the engine failed: {}", failure.message);
            1
        }
    }
}

struct EngineState(Mutex<Option<Arc<EngineClient>>>);

fn failure_text(failure: RpcFailure) -> String {
    json!({ "code": failure.code, "message": failure.message }).to_string()
}

fn client(app: &AppHandle, state: &EngineState) -> Result<Arc<EngineClient>, String> {
    let mut slot = state.0.lock().unwrap();
    if slot.is_none() {
        let handle = app.clone();
        let started = EngineClient::spawn(move |method, params| {
            let _ = handle.emit("engine-event", json!({ "method": method, "params": params }));
        })
        .map_err(|error| {
            json!({ "code": -32000, "message": format!("could not start the analysis engine: {error}") })
                .to_string()
        })?;
        *slot = Some(Arc::new(started));
    }
    Ok(Arc::clone(slot.as_ref().expect("engine client was just stored")))
}

#[tauri::command]
async fn engine_request(
    app: AppHandle,
    state: State<'_, EngineState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !is_forwardable(&method) {
        return Err(
            json!({ "code": -32601, "message": format!("method not allowed: {method}") }).to_string()
        );
    }
    let client = client(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        client
            .request(&method, params, Duration::from_secs(600))
            .map_err(failure_text)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_folder(
    app: AppHandle,
    state: State<'_, EngineState>,
) -> Result<Option<String>, String> {
    let client = client(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|error| error.to_string())?;
        let text = path.to_string_lossy().to_string();
        client
            .request("grant_roots", json!({ "roots": [text.clone()] }), Duration::from_secs(30))
            .map_err(failure_text)?;
        Ok(Some(text))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_files(
    app: AppHandle,
    state: State<'_, EngineState>,
) -> Result<Option<Vec<String>>, String> {
    let client = client(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().blocking_pick_files() else {
            return Ok(None);
        };
        let mut files = Vec::new();
        let mut folders: Vec<String> = Vec::new();
        for item in picked {
            let path = item.into_path().map_err(|error| error.to_string())?;
            if let Some(parent) = path.parent() {
                let parent = parent.to_string_lossy().to_string();
                if !folders.contains(&parent) {
                    folders.push(parent);
                }
            }
            files.push(path.to_string_lossy().to_string());
        }
        client
            .request("grant_roots", json!({ "roots": folders }), Duration::from_secs(30))
            .map_err(failure_text)?;
        Ok(Some(files))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![engine_request, pick_folder, pick_files])
        .run(tauri::generate_context!())
        .expect("error while running Mejores Tomas");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn the_version_flag_is_detected() {
        assert!(wants_version(&args(&["mejores-tomas", "--version"])));
    }

    #[test]
    fn near_misses_are_not_version_requests() {
        assert!(!wants_version(&args(&["mejores-tomas", "--versions"])));
        assert!(!wants_version(&args(&["mejores-tomas", "-v"])));
        assert!(!wants_version(&args(&["mejores-tomas"])));
    }

    #[test]
    fn the_ping_engine_flag_is_detected_only_when_exact() {
        assert!(wants_ping_engine(&args(&["mejores-tomas", "--ping-engine"])));
        assert!(!wants_ping_engine(&args(&["mejores-tomas", "--ping"])));
    }

    #[test]
    fn the_version_line_names_the_product_and_the_cargo_version() {
        assert_eq!(version_line(), "mejores-tomas 0.1.0");
    }
}
```

**`src-tauri/src/main.rs`**

```rust
// Release builds run as a GUI process; debug builds keep the console so --version can print.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if mejores_tomas_lib::wants_version(&args) {
        println!("{}", mejores_tomas_lib::version_line());
        return;
    }
    if mejores_tomas_lib::wants_ping_engine(&args) {
        std::process::exit(mejores_tomas_lib::ping_engine());
    }
    mejores_tomas_lib::run();
}
```

**`src/lib/ipc.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export class EngineError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

const ErrorBody = z.object({ code: z.number(), message: z.string() });

function toEngineError(raw: unknown): EngineError {
  if (typeof raw === "string") {
    try {
      const body = ErrorBody.parse(JSON.parse(raw));
      return new EngineError(body.code, body.message);
    } catch {
      return new EngineError(-32603, raw);
    }
  }
  return new EngineError(-32603, String(raw));
}

/** Sends one request to the engine through the shell and validates the reply with `schema`. */
export async function engineRequest<S extends z.ZodType>(
  method: string,
  params: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await invoke("engine_request", { method, params });
  } catch (error) {
    throw toEngineError(error);
  }
  return schema.parse(raw);
}

export const PingResult = z.object({ pong: z.literal(true), version: z.string() });

export function ping() {
  return engineRequest("ping", {}, PingResult);
}
```

**`src/lib/ipc.test.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { EngineError, engineRequest, ping } from "./ipc.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("ipc", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns the validated result of ping", async () => {
    invokeMock.mockResolvedValue({ pong: true, version: "0.1.0" });
    await expect(ping()).resolves.toEqual({ pong: true, version: "0.1.0" });
    expect(invokeMock).toHaveBeenCalledWith("engine_request", { method: "ping", params: {} });
  });

  it("rejects a malformed engine reply", async () => {
    invokeMock.mockResolvedValue({ pong: false });
    await expect(ping()).rejects.toThrow();
  });

  it("turns a JSON error body from the shell into an EngineError with its code", async () => {
    invokeMock.mockRejectedValue(JSON.stringify({ code: -32010, message: "path not allowed" }));
    const failure = await engineRequest("scan", { paths: [] }, z.unknown()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EngineError);
    expect((failure as EngineError).code).toBe(-32010);
  });

  it("wraps a plain-text failure as an internal error", async () => {
    invokeMock.mockRejectedValue("boom");
    const failure = await engineRequest("scan", {}, z.unknown()).catch((error: unknown) => error);
    expect((failure as EngineError).code).toBe(-32603);
  });
});
```

Después ejecuta `pnpm format` para el TypeScript.

**Files**
- `src-tauri/src/engine.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`
- `src/lib/ipc.ts`
- `src/lib/ipc.test.ts`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `pnpm test:rust` runs **THE SYSTEM SHALL** pass the tests that prove a request line round-trips through `encode_request` and `decode_line`, that an error response decodes with its code and message, and that a line without `id` decodes as a notification.
2. **WHEN** `pnpm test:rust` runs **THE SYSTEM SHALL** pass the test proving `is_forwardable("grant_roots")` is false and `is_forwardable("scan")` is true.
3. **WHEN** `src-tauri/target/debug/mejores-tomas.exe --ping-engine` runs **THE SYSTEM SHALL** start the engine, print `engine-ok 0.1.0` and exit 0.
4. **WHEN** the engine process cannot be started (`MT_ENGINE_CMD` names a program that does not exist) **THE SYSTEM SHALL** make `--ping-engine` exit 1 with a message on stderr instead of hanging.
5. **WHEN** `pnpm exec vitest run src/lib/ipc.test.ts` runs **THE SYSTEM SHALL** pass the tests proving `ping()` returns the validated result and a malformed engine reply rejects.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:rust
cargo build --manifest-path src-tauri/Cargo.toml
src-tauri/target/debug/mejores-tomas.exe --ping-engine | grep -qx 'engine-ok 0.1.0'
status=0; MT_ENGINE_CMD=mejores-engine-missing src-tauri/target/debug/mejores-tomas.exe --ping-engine || status=$?; test "$status" -eq 1
pnpm exec vitest run src/lib/ipc.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T5: Puente entre el shell y el motor"
git tag step-05-bridge
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E1-T6` — Escaneo de carpetas y lista de rutas permitidas

**Depends on:** `E1-T3` · **Priority:** p0 — metadata for scope cuts, not a running order

El motor solo lee carpetas que la persona eligió. `grant_roots` (que el shell invoca tras el diálogo
nativo) registra raíces permitidas en memoria; `scan` rechaza cualquier ruta que no cuelgue de una raíz
permitida. Crea `scan.py`, edita `app.py` y crea `tests/test_scan.py`.

**`scan.py`** expone:

- `SUPPORTED: dict[str, str]` — extensión en minúsculas → formato guardado: `.jpg`, `.jpeg` → `jpg`;
  `.png` → `png`; `.arw`, `.cr2`, `.cr3`, `.nef`, `.nrw`, `.dng`, `.raf`, `.orf`, `.rw2`, `.pef`,
  `.srw` → `raw`.
- `class Roots` con `grant(paths: list[str]) -> int` y `is_allowed(path: Path) -> bool`. Cada ruta de
  `grant` debe ser absoluta y existir, o se lanza `RpcError(INVALID_PARAMS, …)`. `is_allowed` resuelve la
  ruta con `Path.resolve()`, normaliza mayúsculas con `os.path.normcase` y comprueba con
  `Path.is_relative_to` contra cada raíz resuelta. Debe rechazar `..` que escapa de la raíz y una carpeta
  hermana cuyo nombre comienza igual (`C:\fotos` no autoriza `C:\fotos-privadas`).
- `collect(paths: list[Path], recursive: bool) -> tuple[list[Path], int]` — devuelve los archivos
  compatibles ordenados por nombre natural (separa dígitos: `IMG_2` antes que `IMG_10`) y cuántos
  archivos se omitieron. Recorre subcarpetas salvo que `recursive` sea falso. No sigue enlaces
  simbólicos fuera de la raíz.

**Métodos nuevos en `app.py`:**

- `grant_roots {roots: [str]}` → `{granted: n}`.
- `scan {paths: [str], recursive?: bool = true}` → `{session_id, photos: [{id, path, format,
  size_bytes}], skipped: n}`. Cada `path` debe estar permitido, o responde -32010
  (`PATH_NOT_ALLOWED`) **sin crear sesión**. Crea una fila en `sessions` (etiqueta = nombre de la primera
  carpeta o "Selección de archivos") y una fila en `photos` por archivo, con `id` = `uuid4`, `size_bytes`
  y `mtime_ns` de `os.stat`. `paths` puede mezclar carpetas y archivos sueltos.

**`tests/test_scan.py`** usa `tmp_path` con archivos vacíos de cada extensión y cubre cada criterio de
abajo; los casos de rutas prohibidas usan carpetas hermanas reales creadas en el test.

**Files**
- `engine/mejores_engine/scan.py`
- `engine/mejores_engine/app.py`
- `engine/tests/test_scan.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `scan` receives a folder under a granted root **THE SYSTEM SHALL** create one session and one `photos` row per supported file, recursing into subfolders by default, with `format` 'jpg' for .jpg/.jpeg, 'png' for .png and 'raw' for ARW, CR2, CR3, NEF, NRW, DNG, RAF, ORF, RW2, PEF and SRW in any letter case.
2. **WHEN** `scan` receives a path outside every granted root (an unrelated folder, a `..` escape, or a sibling whose name starts with the root's name) **THE SYSTEM SHALL** reply with error code -32010 and create no session.
3. **WHEN** a folder holds unsupported files such as .txt, .xmp or .mp4 **THE SYSTEM SHALL** skip them and report their count in `skipped`.
4. **WHEN** `scan` receives individual file paths under a granted root **THE SYSTEM SHALL** include exactly those files.
5. **WHEN** file names are IMG_2.jpg and IMG_10.jpg **THE SYSTEM SHALL** list IMG_2.jpg first (natural order).
6. **WHEN** `grant_roots` receives a relative path or a path that does not exist **THE SYSTEM SHALL** reply with error code -32602 and grant nothing.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T6: Escaneo de carpetas y lista de rutas permitidas"
git tag step-06-scan
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

---

## Epic acceptance

The epic is done when every task is `done` **and**:

1. **WHEN** a ping line is sent to the engine through `src-tauri/target/debug/mejores-tomas.exe --ping-engine` **THE SYSTEM SHALL** print `engine-ok 0.1.0` — shell, bridge and engine work end to end.
2. **WHEN** the engine is asked to `scan` a folder it was never granted **THE SYSTEM SHALL** answer error code -32010 and create no session.

```bash
src-tauri/target/debug/mejores-tomas.exe --ping-engine | grep -qx 'engine-ok 0.1.0'
pnpm test:engine
```

Run from the project root. Both criteria must be decidable by these commands.

## Pitfalls

- **A corrupted venv after Bootstrap** — if `pnpm test:engine` fails with `ModuleNotFoundError` for a package listed in `engine/pyproject.toml`, run `uv sync --directory engine --reinstall` once (seen once on the author's machine with `pygments` and `typing_extensions`).
- **Biome reformats files on `pnpm format`** — run it once after writing each TypeScript file so `pnpm lint` stays green.
- **`os error 4551` durante `cargo build`** — Windows bloqueó un ejecutable recién compilado por una directiva de Control de aplicaciones. No es un defecto del código: informa a la persona, compila en una carpeta autorizada y no intentes desactivar la directiva.
- **`MT_DATA_DIR`** — engine tests must never use the real data folder; pass `tmp_path` or set the variable.

## Before moving on

- [ ] Every task in this epic is `done` in `tasks.json` — no task left `in_progress`.
- [ ] Every `verify` command of every task in this epic passed, not just the first one.
- [ ] No `verify` command was edited, and none was skipped because a file it names did not exist.
- [ ] **Every task in this epic has its `checkpoint` tag in version control** — `git tag -l 'step-*'` lists them.
- [ ] Gate command passes clean, run from the project root.
- [ ] Every "Produced" contract above exists with the stated signature.
- [ ] No file outside the subtree was modified.
- [ ] `.env.example` is unchanged: this project adds no required variable.
- [ ] One commit per task, each prefixed with its task id, each followed by its checkpoint tag.
