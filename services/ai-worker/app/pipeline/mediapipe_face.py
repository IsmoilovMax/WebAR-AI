"""Yaqin masofadagi kameralar uchun ixtiyoriy MediaPipe FaceMesh.

Asosiy chekish qoidasi YOLO pose nuqtalaridan foydalanadi (CCTV uchun
barqarorroq). Agar MediaPipe o'rnatilgan bo'lsa va yuz yetarlicha katta
bo'lsa, og'iz markazini aniqroq hisoblash mumkin.

Bu modul import xatosida hech narsa qilmaydi - production da MediaPipe
majburiy emas.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

_mesh: Any = None
_tried = False


def _get_mesh() -> Any:
    global _mesh, _tried
    if _tried:
        return _mesh
    _tried = True
    try:
        import mediapipe as mp

        _mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=4,
            refine_landmarks=False,
            min_detection_confidence=0.5,
        )
        log.info("MediaPipe FaceMesh yuklandi (yaqin masofa uchun)")
    except Exception:  # noqa: BLE001
        log.info("MediaPipe mavjud emas — pose og'iz nuqtasi ishlatiladi")
        _mesh = None
    return _mesh


def mouth_centers(
    frame_bgr: np.ndarray,
    *,
    min_face_height_px: int = 80,
) -> list[tuple[float, float]]:
    """Og'iz markazlari (normallashtirilgan x, y).

    Yuz balandligi `min_face_height_px` dan kichik bo'lsa - CCTV masofasi
    deb hisoblanadi va bo'sh ro'yxat qaytariladi (pose ishonchliroq).
    """
    mesh = _get_mesh()
    if mesh is None:
        return []

    h, w = frame_bgr.shape[:2]
    import cv2

    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    result = mesh.process(rgb)
    if not result.multi_face_landmarks:
        return []

    # FaceMesh og'iz landmarklari (approx): 13 = pastki lab, 14 = yuqori.
    centers: list[tuple[float, float]] = []
    for face in result.multi_face_landmarks:
        ys = [lm.y for lm in face.landmark]
        face_h = (max(ys) - min(ys)) * h
        if face_h < min_face_height_px:
            continue
        upper = face.landmark[13]
        lower = face.landmark[14]
        centers.append(((upper.x + lower.x) / 2.0, (upper.y + lower.y) / 2.0))

    return centers


_face_detection: Any = None
_tried_detection = False


def _get_face_detection() -> Any:
    global _face_detection, _tried_detection
    if _tried_detection:
        return _face_detection
    _tried_detection = True
    try:
        import mediapipe as mp

        _face_detection = mp.solutions.face_detection.FaceDetection(
            model_selection=1,
            min_detection_confidence=0.4,
        )
        log.info("MediaPipe FaceDetection yuklandi (yaqin yuz fallback)")
    except Exception:  # noqa: BLE001
        log.info("MediaPipe FaceDetection mavjud emas")
        _face_detection = None
    return _face_detection


def detect_face_boxes(frame_bgr: np.ndarray) -> list:
    """YOLO yuz topolmaganda yaqin/focusdan chiqqan yuzlar uchun fallback."""
    from .models import Detection

    detector = _get_face_detection()
    if detector is None:
        return []

    import cv2

    h, w = frame_bgr.shape[:2]
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    result = detector.process(rgb)
    if not result.detections:
        return []

    faces: list[Detection] = []
    for det in result.detections:
        if det.location_data is None or not det.location_data.relative_bounding_box:
            continue
        box = det.location_data.relative_bounding_box
        confidence = float(det.score[0]) if det.score else 0.5
        if confidence < 0.4:
            continue
        faces.append(
            Detection(
                label="face",
                confidence=confidence,
                bbox=(
                    max(0.0, float(box.xmin)),
                    max(0.0, float(box.ymin)),
                    max(0.0, min(1.0, float(box.width))),
                    max(0.0, min(1.0, float(box.height))),
                ),
            )
        )
    return faces
