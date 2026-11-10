# Mejores Tomas

App de escritorio para Windows que elige las mejores tomas de una ráfaga de fotos (JPG, PNG y RAW).
Todo se analiza en el equipo: sin red, sin cuentas y sin IA en la nube. Los originales nunca se modifican.

## Commands

Shell: Git Bash. Run everything from the project root.

| Task | Command |
|---|---|
| Install | `pnpm install` · `uv sync --directory engine` |
| App window (dev) | `pnpm dev` |
| UI only (browser) | `pnpm dev:ui` |
| Typecheck | `pnpm typecheck` |
| Lint / format | `pnpm lint` · `pnpm format` |
| UI tests | `pnpm test` · one file: `pnpm exec vitest run src/lib/theme.test.ts` |
| Engine tests | `pnpm test:engine` · one file: `uv run --directory engine pytest tests/test_rpc.py -q` |
| Engine lint / types | `pnpm lint:engine` · `pnpm typecheck:engine` |
| Rust tests | `pnpm test:rust` |
| Build UI | `pnpm build:ui` |
| Build shell (debug) | `cargo build --manifest-path src-tauri/Cargo.toml` |
| Freeze engine | `pnpm build:sidecar` |
| Installer | `pnpm build:app` |
| Engine by hand | `uv run --directory engine python -m mejores_engine` (reads JSON-RPC lines on stdin) |

**Gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm lint:engine && pnpm typecheck:engine && pnpm test:engine && pnpm test:rust` must pass before any task is marked done.

Runtime versions: `.nvmrc` (Node), `.python-version` (Python), `rust-toolchain.toml` (Rust). Dependency
versions live in `pnpm-lock.yaml`, `engine/uv.lock` and `src-tauri/Cargo.lock`: read them, never guess one.

## Stack

Tauri (Rust shell) · React + TypeScript + Vite · Python engine (rawpy, OpenCV, MediaPipe) · SQLite.

## Architecture

**Request path.** UI (`src/screens/*.tsx`) → `src/lib/engine.ts` → Tauri command `engine_request`
(`src-tauri/src/lib.rs`) → `EngineClient` (`src-tauri/src/engine.rs`) → child process
`python -m mejores_engine` (JSON-RPC 2.0, one JSON object per line on stdin/stdout) →
`engine/mejores_engine/app.py` handlers → `store.py` (SQLite). Long work (`analyze`, `export`) runs in a
background thread of the engine and reports through `progress` and `job_done` notifications, which the
shell forwards to the UI as the Tauri event `engine-event`.

**Boundaries.** Cross one of these the wrong way and the build breaks:

| Layer | May use | Must never |
|---|---|---|
| `src/screens`, `src/components` | `src/lib/*`, tokens | Call `invoke` or the engine directly, hold a colour literal |
| `src/lib/engine.ts`, `ipc.ts` | `@tauri-apps/api`, zod | Import React |
| `src-tauri/src` | `engine.rs` | Forward `grant_roots` from the UI, load remote content |
| `engine/mejores_engine/app.py` | every engine module | Print to stdout |
| `engine/mejores_engine/store.py` | stdlib `sqlite3` | Be imported by `features.py` |
| everything in `engine/` | the filesystem read-only for photos | Open a socket, write to a source folder |

**Where things live.**

| Concern | Single source of truth |
|---|---|
| DB schema | `engine/mejores_engine/migrations/*.sql` (forward-only) |
| RPC methods | `engine/mejores_engine/app.py`; allowlist in `engine.rs` `FORWARDABLE` |
| Settings and defaults | `engine/mejores_engine/settings.py` |
| Colours, spacing, type | `src/styles/tokens.css` |
| Version `0.1.0` | `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `engine/pyproject.toml`, `engine/mejores_engine/__init__.py` (change all five together) |

## Code rules

1. One component per file, max 250 lines; one Python module per concern, max 300 lines.
2. UI text is Spanish; code, identifiers and commands are English.
3. TypeScript: `strict`; validate every engine reply with zod in `src/lib/engine.ts`; no `any`.
4. Python: `from __future__ import annotations`, full type hints (`mypy --strict`), `ruff` clean.
5. Every engine handler validates its params and raises `RpcError` with a code from `rpc.py`.
6. The database is touched only through `Store.session()`; one short-lived connection per use.
7. Tests never touch the real data folder: set `MT_DATA_DIR` or pass `tmp_path`.
8. Tests build images from numpy/OpenCV; never commit a RAW file.
9. No new dependency without a reason in the commit message.

## Design system

Tokens are defined once in `src/styles/tokens.css`; components use `var(--token)` only. Light is the
default theme; dark is chosen by the user and stored as setting `theme` (`data-theme="dark"` on `<html>`).

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f7f7f5` | `#121316` |
| `--surface` | `#ffffff` | `#1c1d21` |
| `--fg` | `#1c1c1e` | `#e8e8ea` |
| `--fg-muted` | `#5e5e63` | `#a0a0a8` |
| `--primary` | `#2563d6` | `#6ea8fe` |
| `--primary-fg` | `#ffffff` | `#0b1220` |
| `--border` | `#8a8a93` | `#6b6c75` |
| `--divider` | `#dadadf` | `#34353b` |
| `--destructive` | `#c62828` | `#ff8a80` |
| `--success` | `#2e7d32` | `#81c784` |

- **Type:** `Segoe UI Variable Text`, `Segoe UI`, `system-ui`; mono `Cascadia Mono`. Sizes 12/14/16/20/24/32 px.
- **Spacing:** 4 px base: 4, 8, 12, 16, 24, 32, 48. **Radius:** 6 px controls, 10 px cards.
- **Motion:** 120/200 ms, `cubic-bezier(0.2, 0, 0, 1)`, off under `prefers-reduced-motion`.
- **Layout:** desktop only; min window 960×600; max content width 1440 px.

## Environment

No variable is required. Optional: `MT_DATA_DIR` (data folder), `MT_ENGINE_CMD` (debug-only engine
override). `.env.example` is committed. Nothing loads `.env` automatically; export inline.

## Rules

Deferred conventions: read the matching file before editing that area.

| File | Applies to |
|---|---|
| `.claude/rules/engine.md` | `engine/mejores_engine/**` |
| `.claude/rules/migrations.md` | `engine/mejores_engine/migrations/**` |
| `.claude/rules/shell.md` | `src-tauri/**` |
| `.claude/rules/ui.md` | `src/**` |
| `.claude/rules/tests.md` | `engine/tests/**`, `src/**/*.test.*` |

Project skills: `add-engine-method`, `add-migration` (`.claude/skills/`).

## Non-negotiable

1. Never modify, move or delete a file inside a folder the user picked. Export copies; nothing else writes there.
2. Never open a network connection from the engine or the UI. Local models only.
3. The engine writes only JSON-RPC lines to stdout. Logs and library noise go to stderr.
4. Never expose `grant_roots` to the UI; only `pick_folder` and `pick_files` call it.
5. Never edit a migration that has shipped. Add a new one.
6. Never commit secrets, `.env`, `*.sqlite3` or build output.
7. Never mark a task done with a failing gate command, and never edit a `verify` command to make it pass.
