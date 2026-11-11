"""Eye openness from MediaPipe's local FaceLandmarker. Runs on this machine; no network."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

MODEL_PATH = Path(__file__).resolve().parent / "assets" / "face_landmarker.task"
MAX_FACES = 6

_landmarker: Any = None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def eyes_from_blendshapes(faces: list[dict[str, float]]) -> float | None:
    """1 - mean blink per face; the lowest face wins (one closed eye spoils the shot)."""
    if not faces:
        return None
    values = [
        1 - _clamp((face.get("eyeBlinkLeft", 0.0) + face.get("eyeBlinkRight", 0.0)) / 2, 0.0, 1.0)
        for face in faces
    ]
    return min(values)


def _get_landmarker() -> Any:
    """One FaceLandmarker per process, created on first use."""
    global _landmarker
    if _landmarker is None:
        from mediapipe.tasks.python import BaseOptions, vision

        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL_PATH)),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=MAX_FACES,
            output_face_blendshapes=True,
        )
        _landmarker = vision.FaceLandmarker.create_from_options(options)
    return _landmarker


def is_loaded() -> bool:
    return _landmarker is not None


def score(bgr: NDArray[np.uint8]) -> float | None:
    import mediapipe as mp

    rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    result = _get_landmarker().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    faces = [
        {str(category.category_name): float(category.score) for category in shapes}
        for shapes in (result.face_blendshapes or [])
    ]
    return eyes_from_blendshapes(faces)
