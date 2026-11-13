# Framepicker — agent instructions

Windows desktop app that picks the best shots of a photo burst. Everything runs locally: no network, no accounts, no cloud AI.

## Commands

| Task             | Command                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Install          | `pnpm install` · `uv sync --directory engine`                                                                                 |
| Typecheck / lint | `pnpm typecheck` · `pnpm lint`                                                                                                |
| UI tests         | `pnpm test` · one file: `pnpm exec vitest run <path>`                                                                         |
| Engine tests     | `pnpm test:engine` · `pnpm lint:engine` · `pnpm typecheck:engine`                                                             |
| Rust tests       | `pnpm test:rust`                                                                                                              |
| Gate             | `pnpm typecheck && pnpm lint && pnpm test && pnpm lint:engine && pnpm typecheck:engine && pnpm test:engine && pnpm test:rust` |

## Non-negotiable

1. Never modify, move or delete a file inside a folder the user picked.
2. Never open a network connection from the engine or the UI.
3. The engine writes only JSON-RPC lines to stdout.
4. Never expose `grant_roots` to the UI.
5. Never edit a migration that has shipped.
6. Never commit secrets, `.env`, `*.sqlite3` or build output.
7. Never mark a task done with a failing gate command.

Full architecture, boundaries and design tokens: see `CLAUDE.md` in this directory.
