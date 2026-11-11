---

description: Tauri shell and engine bridge conventions
paths:

- "src-tauri/**"

---

# Shell rules

- The UI reaches the engine only through the `engine_request` command, and `engine_request` forwards only methods listed in `FORWARDABLE` (`engine.rs`). `grant_roots` is never in that list.
- `pick_folder`, `pick_files` and `pick_lut` are the only callers of `grant_roots`, and only after the native dialog returns a path. `pick_lut` grants just the `.cube` file, not its folder.
- Never load remote content into the webview. Keep the CSP in `tauri.conf.json` as is; bundle every asset.
- `main.rs` handles `--version` and `--ping-engine` before creating any window. Both must work in a debug build with no display.
- Spawn the engine with `CREATE_NO_WINDOW` on Windows so no console flashes.
- Add a Tauri plugin only together with its permission in `capabilities/default.json`.
- `cargo build` needs `dist/` to exist: run `pnpm build:ui` first.
