"""Zona qoidalari: taqiqlangan hududga kirish va uzoq turib qolish.

Model o'qitish talab qilinmaydi - faqat odam aniqlash va poligon
geometriyasi. Amaliyotda eng ko'p ishlatiladigan funksiya, chunki u
ishonchli va mijozga tushunarli.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from ..geometry import bottom_center, point_in_polygon
from ..schemas import EventType, Severity
from .base import EventCandidate, Rule, RuleContext, SlidingWindow


@dataclass(slots=True)
class _Presence:
    entered_at: float
    last_seen: float
    reported: bool = False


class ZoneIntrusionRule(Rule):
    detector = "person"
    requires = ("person",)

    def __init__(
        self,
        *,
        window_seconds: float = 3.0,
        required_hits: int = 3,
        cooldown_seconds: float = 60.0,
        loitering_seconds: float = 120.0,
    ) -> None:
        self._loitering_seconds = loitering_seconds
        self._window = SlidingWindow(
            window_seconds=window_seconds,
            required_hits=required_hits,
            cooldown_seconds=cooldown_seconds,
        )
        self._presence: dict[tuple[int, str], _Presence] = {}
        self._loitering_reported: set[tuple[int, str]] = set()

    def evaluate(self, context: RuleContext) -> list[EventCandidate]:
        restricted = [
            zone
            for zone in context.camera.zones
            if zone.kind == "restricted"
            and (not zone.detectors or "person" in zone.detectors)
        ]
        if not restricted:
            return []

        candidates: list[EventCandidate] = []
        active_keys: set[str] = set()
        seen_pairs: set[tuple[int, str]] = set()

        for detection in context.objects:
            if detection.label.lower() != "person" or detection.track_id is None:
                continue

            # Odam zonaga oyog'i bilan kiradi. Markaz nuqtasi ishlatilsa,
            # zona chetida turgan odam ham "ichkarida" bo'lib chiqadi.
            foot = bottom_center(detection.bbox)

            for zone in restricted:
                if not point_in_polygon(foot, zone.polygon):
                    continue

                pair = (detection.track_id, zone.id)
                seen_pairs.add(pair)

                presence = self._presence.get(pair)
                if presence is None:
                    presence = _Presence(
                        entered_at=context.timestamp, last_seen=context.timestamp
                    )
                    self._presence[pair] = presence
                presence.last_seen = context.timestamp

                key = f"intrusion:{detection.track_id}:{zone.id}"
                active_keys.add(key)

                confirmation = self._window.observe(
                    key, context.timestamp, detection.confidence
                )
                if confirmation is not None:
                    candidates.append(
                        EventCandidate(
                            type=EventType.ZONE_INTRUSION,
                            confidence=confirmation.confidence,
                            started_at=datetime.fromtimestamp(
                                context.wall_time
                                - (context.timestamp - confirmation.started_at),
                                tz=UTC,
                            ),
                            confirmed_at=context.wall_datetime,
                            bbox=detection.bbox,
                            track_id=detection.track_id,
                            zone_id=zone.id,
                            severity=Severity.HIGH,
                            highlight=[detection.bbox],
                            meta={"zoneName": zone.name},
                        )
                    )

                dwell = context.timestamp - presence.entered_at
                if dwell >= self._loitering_seconds and pair not in self._loitering_reported:
                    self._loitering_reported.add(pair)
                    candidates.append(
                        EventCandidate(
                            type=EventType.LOITERING,
                            confidence=0.9,
                            started_at=datetime.fromtimestamp(
                                context.wall_time - dwell, tz=UTC
                            ),
                            confirmed_at=context.wall_datetime,
                            bbox=detection.bbox,
                            track_id=detection.track_id,
                            zone_id=zone.id,
                            severity=Severity.LOW,
                            highlight=[detection.bbox],
                            meta={"dwellSeconds": round(dwell, 1), "zoneName": zone.name},
                        )
                    )

        self._expire(context.timestamp, seen_pairs)
        self._window.decay(context.timestamp, active_keys)
        return candidates

    def on_track_lost(self, track_id: int) -> None:
        for pair in [key for key in self._presence if key[0] == track_id]:
            self._presence.pop(pair, None)
            self._loitering_reported.discard(pair)

    def _expire(self, now: float, seen: set[tuple[int, str]]) -> None:
        for pair in list(self._presence):
            if pair in seen:
                continue
            # Qisqa yo'qolish (to'silish) zonadan chiqish hisoblanmaydi,
            # aks holda ustun ortidan o'tgan odam qayta-qayta event beradi.
            if now - self._presence[pair].last_seen > 5.0:
                self._presence.pop(pair, None)
                self._loitering_reported.discard(pair)
