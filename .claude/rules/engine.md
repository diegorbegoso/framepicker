---

description: Conventions for the Python analysis engine
paths:

- "engine/mejores_engine/**"

---

# Engine rules

- stdout belongs to the protocol: only `Emitter` and `serve()` write to it. Use `print(..., file=sys.stderr)` or `logging` for anything else.
- No network. Never import `socket`, `urllib`, `http` or `requests` in `mejores_engine/` (the model downloader lives in `scripts/`, not here).
- Photos are read-only. Open with `"rb"`/`cv2.imread`/`rawpy.imread`; never open a file inside a user folder for writing. Only `export.py` creates files, and only inside the granted destination.
- Handlers take a `dict` of params, validate it, and raise `RpcError(code, message)` with a code from `rpc.py`. Never return raw exceptions.
- Use `Store.session()` for every database access. Never share a connection between threads; each job thread opens its own.
- Workers run in a process pool: functions they call must be top-level and picklable, and must not touch the database.
- Features are pure functions of the file's bytes. If a formula changes, bump `FEATURES_VERSION` in `features.py` so the cache invalidates.
- Type-hint everything; `mypy --strict` must pass. Untyped libraries (`rawpy`, `mediapipe`) are wrapped at the boundary and typed from there inward.
