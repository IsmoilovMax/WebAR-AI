"""Event shartnomasi.

Bu fayl packages/types/src/events.ts ning aksi. Ikkalasi bir vaqtda
o'zgartirilishi kerak, aks holda event-service JSON ni parse qila olmaydi.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class EventType(StrEnum):
    PERSON_DETECTED = "person_detected"
    FIRE = "fire"
    SMOKE = "smoke"
    FALL = "fall"
    SMOKING = "smoking"
    ZONE_INTRUSION = "zone_intrusion"
    LOITERING = "loitering"
    CAMERA_OFFLINE = "camera_offline"
    CAMERA_ONLINE = "camera_online"


class Severity(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


DEFAULT_SEVERITY: dict[EventType, Severity] = {
    EventType.PERSON_DETECTED: Severity.INFO,
    EventType.FIRE: Severity.CRITICAL,
    EventType.SMOKE: Severity.HIGH,
    EventType.FALL: Severity.CRITICAL,
    EventType.SMOKING: Severity.MEDIUM,
    EventType.ZONE_INTRUSION: Severity.HIGH,
    EventType.LOITERING: Severity.LOW,
    EventType.CAMERA_OFFLINE: Severity.HIGH,
    EventType.CAMERA_ONLINE: Severity.INFO,
}


Gender = Literal["male", "female", "unknown"]
AgeBucket = Literal["young", "middle", "senior", "unknown"]

# Yosh guruhlari chegaralari. Aniq yosh qaytarilmaydi: ochiq modellarda
# MAE ~7.5 yil, ya'ni bitta raqam foydalanuvchini chalg'itadi.
AGE_BUCKET_BOUNDS: list[tuple[AgeBucket, int, int]] = [
    ("young", 0, 25),
    ("middle", 26, 50),
    ("senior", 51, 120),
]


def age_to_bucket(age: float) -> AgeBucket:
    for bucket, low, high in AGE_BUCKET_BOUNDS:
        if low <= age <= high:
            return bucket
    return "unknown"


class OverlayBox(BaseModel):
    label: str
    kind: Literal["person", "fire", "smoke", "cigarette", "face", "other"]
    confidence: float
    bbox: tuple[float, float, float, float]
    trackId: int | None = None
    subtitle: str | None = None


class LiveOverlay(BaseModel):
    """Brauzer video ustiga chizadigan jonli ramkalar.

    Bu event emas - har ~200 ms yangilanadi va saqlanmaydi.
    """

    cameraId: str
    ts: float
    boxes: list[OverlayBox] = Field(default_factory=list)


class PersonAttributes(BaseModel):
    gender: Gender = "unknown"
    genderConfidence: float = 0.0
    ageBucket: AgeBucket = "unknown"
    ageConfidence: float = 0.0
    samples: int = 0


class DetectionEvent(BaseModel):
    eventKey: str
    orgId: str
    cameraId: str
    type: EventType
    severity: Severity
    startedAt: datetime
    confirmedAt: datetime
    confidence: float
    trackId: int | None = None
    zoneId: str | None = None
    bbox: tuple[float, float, float, float] | None = None
    attributes: PersonAttributes | None = None
    modelVersions: dict[str, str] = Field(default_factory=dict)
    snapshotJpegBase64: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class SightingUpdate(BaseModel):
    """Odam kadrni tark etganda yuboriladi - analitika uchun."""

    orgId: str
    cameraId: str
    trackId: int
    firstSeenAt: datetime
    lastSeenAt: datetime
    dwellSeconds: float
    attributes: PersonAttributes


class TrainingSample(BaseModel):
    """Active learning uchun tanlangan kadr."""

    orgId: str
    cameraId: str
    detector: str
    eventType: str
    label: Literal["false_positive", "true_positive", "uncertain"]
    confidence: float
    bbox: tuple[float, float, float, float] | None = None
    modelVersion: str | None = None
    snapshotJpegBase64: str
