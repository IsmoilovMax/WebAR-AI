"""Temporal qoidalar poydevori.

Loyihaning markaziy g'oyasi shu yerda: MODEL BITTA KADRDA NIMA KO'RGANI
EVENT EMAS. Model kadrda "yong'in" ko'rishi mumkin - bu quyosh aksi, qizil
kurtka yoki chiroq bo'lishi mumkin. Event faqat bir necha kadr davomida
barqaror kuzatilgan holat.

Bu qatlam bo'lmasa tizim soatiga yuzlab yolg'on signal beradi va mijoz uni
birinchi kunidayoq o'chirib qo'yadi.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Deque, Iterable

import numpy as np

from ..db import CameraConfig
from ..geometry import BBox
from ..pipeline.insightface_pack import FaceHit
from ..pipeline.models import Detection, PoseResult
from ..schemas import DEFAULT_SEVERITY, EventType, Severity


@dataclass(slots=True)
class RuleContext:
    camera: CameraConfig
    frame: np.ndarray
    timestamp: float
    wall_time: float
    objects: list[Detection] = field(default_factory=list)
    poses: list[PoseResult] = field(default_factory=list)
    model_versions: dict[str, str] = field(default_factory=dict)
    # RetinaFace/ArcFace natijalari (bo'sh bo'lsa YOLO face + genderage fallback).
    face_hits: list[FaceHit] = field(default_factory=list)

    @property
    def wall_datetime(self) -> datetime:
        return datetime.fromtimestamp(self.wall_time, tz=UTC)


@dataclass(slots=True)
class EventCandidate:
    type: EventType
    confidence: float
    started_at: datetime
    confirmed_at: datetime
    bbox: BBox | None = None
    track_id: int | None = None
    zone_id: str | None = None
    severity: Severity | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    # Snapshot ga chizish uchun: qaysi ramkalarni belgilash kerak.
    highlight: list[BBox] = field(default_factory=list)

    def resolved_severity(self) -> Severity:
        return self.severity or DEFAULT_SEVERITY[self.type]

    def event_key(self, camera_id: str) -> str:
        """Idempotentlik kaliti.

        Worker qayta ishga tushsa yoki Redis xabarni ikki marta yetkazsa,
        bir xil hodisa ikkita event bo'lib yozilmasligi kerak. Kalitga
        boshlanish vaqti kiradi - shunda bir xil odamning ikkinchi marta
        yiqilishi alohida event bo'ladi.
        """
        raw = "|".join(
            [
                camera_id,
                self.type.value,
                str(self.track_id or "-"),
                str(self.zone_id or "-"),
                self.started_at.isoformat(timespec="seconds"),
            ]
        )
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()


@dataclass(slots=True)
class _Observation:
    timestamp: float
    confidence: float


@dataclass
class Confirmation:
    started_at: float
    confidence: float
    hits: int


class SlidingWindow:
    """N-of-M ovoz berish + cooldown.

    `window_seconds` oynasida kamida `required_hits` ta ijobiy kuzatuv
    bo'lsa, holat tasdiqlanadi. Tasdiqlangandan keyin `cooldown_seconds`
    davomida o'sha kalit uchun qayta tasdiqlanmaydi - aks holda bitta
    yong'in daqiqasiga 300 ta event yaratadi.
    """

    def __init__(
        self,
        *,
        window_seconds: float,
        required_hits: int,
        cooldown_seconds: float,
    ) -> None:
        self._window = window_seconds
        self._required = required_hits
        self._cooldown = cooldown_seconds
        self._observations: dict[str, Deque[_Observation]] = {}
        self._last_confirmed: dict[str, float] = {}

    def observe(self, key: str, timestamp: float, confidence: float) -> Confirmation | None:
        history = self._observations.setdefault(key, deque())
        history.append(_Observation(timestamp, confidence))
        self._prune(history, timestamp)

        if len(history) < self._required:
            return None

        last = self._last_confirmed.get(key)
        if last is not None and timestamp - last < self._cooldown:
            return None

        self._last_confirmed[key] = timestamp
        confidences = [item.confidence for item in history]

        confirmation = Confirmation(
            started_at=history[0].timestamp,
            # O'rtacha emas, mediana: bitta g'ayrioddiy yuqori kadr
            # butun eventning ishonchini ko'tarib yubormaydi.
            confidence=float(np.median(confidences)),
            hits=len(history),
        )
        history.clear()
        return confirmation

    def decay(self, timestamp: float, active_keys: Iterable[str] | None = None) -> None:
        """Eskirgan kuzatuvlarni tozalaydi.

        Har bir kadrda chaqirilishi kerak, aks holda 10 soniya oldin bir
        marta ko'ringan tutun keyingi bitta kadr bilan qo'shilib tasdiqlanadi.
        """
        keep = set(active_keys) if active_keys is not None else None

        for key in list(self._observations):
            history = self._observations[key]
            self._prune(history, timestamp)
            if not history and (keep is None or key not in keep):
                del self._observations[key]

        for key in list(self._last_confirmed):
            if timestamp - self._last_confirmed[key] > self._cooldown * 4:
                del self._last_confirmed[key]

    def _prune(self, history: Deque[_Observation], now: float) -> None:
        while history and now - history[0].timestamp > self._window:
            history.popleft()


class Rule(ABC):
    """Bitta detektorning temporal mantiqi."""

    detector: str
    #: Bu qoida ishlashi uchun qaysi model fayllari kerak.
    requires: tuple[str, ...] = ()

    @abstractmethod
    def evaluate(self, context: RuleContext) -> list[EventCandidate]:
        """Kadrni ko'rib chiqadi va tasdiqlangan eventlarni qaytaradi.

        Ko'p hollarda bo'sh ro'yxat qaytaradi: qoida holatni to'playdi va
        faqat tasdiqlanganda event chiqaradi.
        """

    def on_track_lost(self, track_id: int) -> None:
        """Odam kadrni tark etganda holatni tozalash imkoniyati."""
