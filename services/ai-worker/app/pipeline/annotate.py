"""Snapshot tayyorlash.

Event bilan birga saqlanadigan rasm operator uchun: u bir qarashda nima
sodir bo'lganini ko'rishi kerak. Shuning uchun ramka chiziladi va vaqt
belgisi qo'yiladi.
"""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Sequence

import cv2
import numpy as np

from ..geometry import BBox, norm_to_pixels

SEVERITY_COLORS = {
    "critical": (0, 0, 255),
    "high": (0, 102, 255),
    "medium": (0, 200, 255),
    "low": (0, 200, 0),
    "info": (200, 200, 200),
}


def annotate(
    frame: np.ndarray,
    boxes: Sequence[BBox],
    *,
    label: str,
    severity: str = "medium",
    timestamp: datetime | None = None,
) -> np.ndarray:
    canvas = frame.copy()
    height, width = canvas.shape[:2]
    color = SEVERITY_COLORS.get(severity, SEVERITY_COLORS["medium"])

    for box in boxes:
        x1, y1, x2, y2 = norm_to_pixels(box, width, height)
        cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)

    if boxes:
        x1, y1, _, _ = norm_to_pixels(boxes[0], width, height)
        _draw_label(canvas, label, (x1, max(18, y1 - 8)), color)

    if timestamp is not None:
        stamp = timestamp.astimezone().strftime("%Y-%m-%d %H:%M:%S")
        _draw_label(canvas, stamp, (8, height - 10), (255, 255, 255))

    return canvas


def _draw_label(canvas: np.ndarray, text: str, origin: tuple[int, int], color) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.55
    thickness = 1

    (text_width, text_height), baseline = cv2.getTextSize(text, font, scale, thickness)
    x, y = origin
    # Matn ortidagi to'q fon: yorug' kadrda oq matn o'qilmaydi.
    cv2.rectangle(
        canvas,
        (x - 3, y - text_height - baseline - 2),
        (x + text_width + 3, y + baseline - 2),
        (0, 0, 0),
        -1,
    )
    cv2.putText(canvas, text, (x, y - 4), font, scale, color, thickness, cv2.LINE_AA)


def to_jpeg_base64(frame: np.ndarray, quality: int = 75) -> str | None:
    success, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not success:
        return None
    return base64.b64encode(buffer.tobytes()).decode("ascii")
