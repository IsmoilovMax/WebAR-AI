"""Yong'in va tutun detektori.

Modelning o'zi yetarli emas. Amaliyotda yolg'on signal manbalari:
quyosh nuri, chiroq aksi, qizil kiyim, monitor ekrani, isitgich.

Ikkita filtr qo'llanadi:

1. Vaqt bo'yicha barqarorlik - alanga bir kadrda paydo bo'lib yo'qolmaydi.
2. Fazoviy barqarorlik - haqiqiy alanga bir joyda o'sadi, aks esa kamera
   yoki quyosh siljishi bilan sakraydi.
"""

from __future__ import annotations

from datetime import UTC, datetime

from ..geometry import iou, point_in_polygon, center
from ..schemas import EventType, Severity
from .base import EventCandidate, Rule, RuleContext, SlidingWindow

FIRE_LABELS = {"fire", "flame", "yong'in"}
SMOKE_LABELS = {"smoke", "tutun"}


class FireSmokeRule(Rule):
    detector = "fire_smoke"
    requires = ("fire_smoke",)

    def __init__(
        self,
        *,
        min_confidence: float = 0.45,
        window_seconds: float = 4.0,
        required_hits: int = 5,
        cooldown_seconds: float = 120.0,
        # Ketma-ket aniqlanishlar shu IoU dan yuqori bo'lsa "bir xil joy"
        # deb hisoblanadi. Past chegara: alanga shakli tez o'zgaradi.
        spatial_iou: float = 0.15,
    ) -> None:
        self._min_confidence = min_confidence
        self._spatial_iou = spatial_iou
        self._window = SlidingWindow(
            window_seconds=window_seconds,
            required_hits=required_hits,
            cooldown_seconds=cooldown_seconds,
        )
        # Oxirgi ko'rilgan joy, fazoviy barqarorlikni tekshirish uchun.
        self._last_boxes: dict[str, tuple[float, tuple[float, float, float, float]]] = {}

    def evaluate(self, context: RuleContext) -> list[EventCandidate]:
        candidates: list[EventCandidate] = []
        seen_keys: set[str] = set()

        exclusions = [
            zone.polygon
            for zone in context.camera.zones
            if zone.kind == "exclude" and (not zone.detectors or self.detector in zone.detectors)
        ]

        for detection in context.objects:
            label = detection.label.lower()
            if label in FIRE_LABELS:
                event_type = EventType.FIRE
            elif label in SMOKE_LABELS:
                event_type = EventType.SMOKE
            else:
                continue

            if detection.confidence < self._min_confidence:
                continue

            # Exclude zonalari: oshxona plitasi, chekish uchun ajratilgan
            # joy, ko'chaga qaragan deraza kabi doimiy manbalar.
            if any(point_in_polygon(center(detection.bbox), polygon) for polygon in exclusions):
                continue

            key = f"{event_type.value}"
            seen_keys.add(key)

            previous = self._last_boxes.get(key)
            self._last_boxes[key] = (context.timestamp, detection.bbox)

            # Birinchi ko'rish yoki uzoq tanaffusdan keyin - barqarorlikni
            # tekshirib bo'lmaydi, keyingi kadrga qoldiramiz.
            if previous is not None:
                elapsed = context.timestamp - previous[0]
                if elapsed < 3.0 and iou(previous[1], detection.bbox) < self._spatial_iou:
                    continue

            confirmation = self._window.observe(key, context.timestamp, detection.confidence)
            if confirmation is None:
                continue

            candidates.append(
                EventCandidate(
                    type=event_type,
                    confidence=confirmation.confidence,
                    started_at=datetime.fromtimestamp(
                        context.wall_time - (context.timestamp - confirmation.started_at),
                        tz=UTC,
                    ),
                    confirmed_at=context.wall_datetime,
                    bbox=detection.bbox,
                    severity=Severity.CRITICAL if event_type is EventType.FIRE else Severity.HIGH,
                    highlight=[detection.bbox],
                    meta={
                        "hits": confirmation.hits,
                        "label": detection.label,
                        # Yong'in yaqinida odam bormi - qutqaruv uchun muhim.
                        "peopleNearby": self._people_nearby(context, detection.bbox),
                    },
                )
            )

        self._window.decay(context.timestamp, seen_keys)
        return candidates

    def _people_nearby(self, context: RuleContext, bbox) -> int:
        # Alanga atrofidagi kengaytirilgan hudud (har tomonga bbox eni qadar).
        x, y, w, h = bbox
        region = (x - w, y - h, w * 3, h * 3)
        return sum(
            1
            for detection in context.objects
            if detection.label.lower() == "person" and iou(region, detection.bbox) > 0
        )
