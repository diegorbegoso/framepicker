---

description: Test conventions for the engine and the interface
paths:

- "engine/tests/**"
- "src/**/*.test.ts"
- "src/**/*.test.tsx"

---

# Test rules

- No skipped or focused tests (`skip`, `only`, `xfail`). A gate with a skip is not a gate.
- No network and no real data folder: use `tmp_path` / `MT_DATA_DIR` for files and databases.
- Build images in the test with numpy and OpenCV (checkerboards, uniform greys, Gaussian blur) and write EXIF with Pillow. Never commit a RAW or a real photo.
- Fake `rawpy.imread` with `monkeypatch` to cover the RAW code paths.
- Time-based tests (progress cadence, cancellation) use a fake extractor that sleeps; keep their total under 5 seconds.
- UI tests replace `./lib/engine.ts` or `./lib/ipc.ts` with `vi.mock`; they never start Tauri.
- Query by role and accessible name (`getByRole`), not by CSS class.
