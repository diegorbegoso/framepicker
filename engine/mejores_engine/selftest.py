"""The checks a packaged engine must pass: data files present, libraries import, model loads."""

from __future__ import annotations

import importlib

MODEL_SIZE = 3758596


def _imports(module: str) -> bool:
    try:
        importlib.import_module(module)
    except Exception:  # noqa: BLE001 - selftest reports, it never raises
        return False
    return True


def selftest() -> dict[str, bool]:
    """Six checks a packaged engine must pass: data files present, libraries import, model loads."""
    from mejores_engine import eyes, store

    model = eyes.MODEL_PATH
    checks = {
        "migrations_present": (store.MIGRATIONS_DIR / "0001_init.sql").is_file(),
        "model_present": model.is_file() and model.stat().st_size == MODEL_SIZE,
        "rawpy_ok": _imports("rawpy"),
        "cv2_ok": _imports("cv2"),
        "mediapipe_ok": _imports("mediapipe"),
        "landmarker_loads": False,
    }
    if checks["model_present"] and checks["mediapipe_ok"]:
        try:
            import numpy as np

            eyes.score(np.full((64, 64, 3), 128, dtype=np.uint8))
            checks["landmarker_loads"] = True
        except Exception:  # noqa: BLE001 - a broken model is a failed check, not a crash
            checks["landmarker_loads"] = False
    return checks
