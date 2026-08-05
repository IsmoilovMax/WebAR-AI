"""Chekish detektori.

Bu loyihadagi eng qiyin detektor va buni yashirmaslik kerak. Sigaret -
kadrning 0.1% ini egallaydigan obyekt. Nashr etilgan tadqiqotlarda sof
sigaret aniqlash 72-84% atrofida: model barmoq, ruchka, somon naycha va
panjara chetini ham sigaret deb ko'radi.

Shuning uchun uch qatlam:

  1. Detektor - Roboflow da o'qitilgan YOLO (sigaret + chekish holati).
  2. Geometriya - sigaret odamning og'zi yoki qo'li yonida bo'lishi shart.
     Stol ustidagi yoki devordagi "sigaret" rad etiladi.
  3. Temporal ovoz - 10 kadrdan 6 tasida tasdiqlansa event.

Geometriya uchun poza nuqtalari ishlatiladi (burun, bilaklar), MediaPipe
Hands emas. Sabab: poza allaqachon hisoblangan, MediaPipe ni har bir odam
uchun qo'shimcha yugurtirish kadr byudjetini ikki barobar oshiradi va
CCTV masofasida barmoq nuqtalari baribir ishonchsiz. Yaqin masofadagi
kameralar uchun aniqroq og'iz nuqtasi kerak bo'lsa, _mouth_point ni
MediaPipe FaceMesh bilan almashtirish yetarli.
"""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np

from ..geometry import BBox, center, distance, point_in_polygon
from ..pipeline.models import Detection, PoseResult
from ..schemas import EventType, Severity
from .base import EventCandidate, Rule, RuleContext, SlidingWindow

CIGARETTE_LABELS = {"cigarette", "cig", "sigaret"}
SMOKING_LABELS = {"smoking", "smoke_person"}

NOSE = 0
LEFT_EAR, RIGHT_EAR = 3, 4
LEFT_WRIST, RIGHT_WRIST = 9, 10

KEYPOINT_CONFIDENCE = 0.3


class SmokingRule(Rule):
    detector = "smoking"
    requires = ("cigarette", "pose")

    def __init__(
        self,
        *,
        min_confidence: float = 0.35,
        window_seconds: float = 6.0,
        required_hits: int = 6,
        cooldown_seconds: float = 300.0,
        # Sigaret og'iz yoki bilakdan shu masofagacha bo'lishi mumkin
        # (kadr balandligiga nisbatan). Bosh o'lchamiga moslanadi.
        proximity_factor: float = 1.8,
    ) -> None:
        self._min_confidence = min_confidence
        self._proximity_factor = proximity_factor
        self._window = SlidingWindow(
            window_seconds=window_seconds,
            required_hits=required_hits,
            cooldown_seconds=cooldown_seconds,
        )

    def evaluate(self, context: RuleContext) -> list[EventCandidate]:
        cigarettes = [
            detection
            for detection in context.objects
            if detection.label.lower() in CIGARETTE_LABELS
            and detection.confidence >= self._min_confidence
        ]

        # Model to'g'ridan-to'g'ri "smoking" holatini bergan bo'lsa, u
        # geometriyadan o'tmasdan ham hisobga olinadi, ammo pastroq vazn bilan.
        direct = [
            detection
            for detection in context.objects
            if detection.label.lower() in SMOKING_LABELS
            and detection.confidence >= self._min_confidence
        ]

        if not cigarettes and not direct:
            self._window.decay(context.timestamp, set())
            return []

        no_smoking_zones = [
            zone
            for zone in context.camera.zones
            if zone.kind == "no_smoking"
            or (zone.kind == "restricted" and self.detector in zone.detectors)
        ]

        candidates: list[EventCandidate] = []
        active_keys: set[str] = set()

        for pose in context.poses:
            if pose.track_id is None:
                continue

            match = self._match_cigarette(pose, cigarettes, context)
            if match is None:
                match = self._match_direct(pose, direct)
            if match is None:
                continue

            cigarette_box, score = match

            zone_id = self._zone_for(pose.bbox, no_smoking_zones)
            # Chekish zonasi belgilangan bo'lsa, faqat o'sha zonadagi
            # chekish hodisa hisoblanadi. Zona yo'q bo'lsa - butun kadr.
            if no_smoking_zones and zone_id is None:
                continue

            key = f"smoking:{pose.track_id}"
            active_keys.add(key)

            confirmation = self._window.observe(key, context.timestamp, score)
            if confirmation is None:
                continue

            candidates.append(
                EventCandidate(
                    type=EventType.SMOKING,
                    confidence=confirmation.confidence,
                    started_at=datetime.fromtimestamp(
                        context.wall_time - (context.timestamp - confirmation.started_at),
                        tz=UTC,
                    ),
                    confirmed_at=context.wall_datetime,
                    bbox=pose.bbox,
                    track_id=pose.track_id,
                    zone_id=zone_id,
                    severity=Severity.MEDIUM,
                    highlight=[pose.bbox, cigarette_box],
                    meta={
                        "hits": confirmation.hits,
                        "cigaretteBox": list(cigarette_box),
                        # UI da "beta" belgisini ko'rsatish uchun.
                        "beta": True,
                    },
                )
            )

        self._window.decay(context.timestamp, active_keys)
        return candidates

    def _match_cigarette(
        self,
        pose: PoseResult,
        cigarettes: list[Detection],
        context: RuleContext,
    ) -> tuple[BBox, float] | None:
        """Sigaretni odamga bog'laydi va geometrik ishonch qaytaradi."""
        mouth = self._mouth_point(pose, context)
        wrists = self._wrist_points(pose)
        head_size = self._head_size(pose)

        if mouth is None and not wrists:
            return None

        threshold = head_size * self._proximity_factor
        best: tuple[BBox, float] | None = None

        for cigarette in cigarettes:
            point = center(cigarette.bbox)

            distances: list[float] = []
            if mouth is not None:
                distances.append(distance(point, mouth))
            distances.extend(distance(point, wrist) for wrist in wrists)

            nearest = min(distances)
            if nearest > threshold:
                continue

            # Og'izga qanchalik yaqin bo'lsa, shunchalik ishonchli.
            proximity = 1.0 - min(1.0, nearest / threshold)
            score = 0.6 * cigarette.confidence + 0.4 * proximity

            if best is None or score > best[1]:
                best = (cigarette.bbox, round(score, 3))

        return best

    def _match_direct(
        self, pose: PoseResult, direct: list[Detection]
    ) -> tuple[BBox, float] | None:
        from ..geometry import iou

        for detection in direct:
            if iou(pose.bbox, detection.bbox) > 0.5:
                # Geometrik tasdiq yo'q, shuning uchun ball pasaytiriladi.
                return (detection.bbox, round(detection.confidence * 0.75, 3))
        return None

    def _mouth_point(
        self, pose: PoseResult, context: RuleContext | None = None
    ) -> tuple[float, float] | None:
        """Og'iz nuqtasi: yaqin masofada MediaPipe, aks holda pose burun.

        COCO pozasida og'iz nuqtasi yo'q. Burun yetarli aniqlik beradi:
        sigaret og'izda bo'lganda burundan taxminan bosh o'lchamining
        chorak qismi pastda bo'ladi. Yuz kattaroq bo'lsa MediaPipe
        FaceMesh aniqroq markaz beradi.
        """
        if context is not None:
            from ..pipeline.mediapipe_face import mouth_centers

            for mx, my in mouth_centers(context.frame):
                # Og'iz nuqtasi shu odam bbox ichidami?
                x, y, w, h = pose.bbox
                if x <= mx <= x + w and y <= my <= y + h:
                    return (mx, my)

        nose = pose.keypoints[NOSE]
        if nose[2] < KEYPOINT_CONFIDENCE:
            return None
        return (float(nose[0]), float(nose[1]) + self._head_size(pose) * 0.25)

    def _wrist_points(self, pose: PoseResult) -> list[tuple[float, float]]:
        return [
            (float(pose.keypoints[index][0]), float(pose.keypoints[index][1]))
            for index in (LEFT_WRIST, RIGHT_WRIST)
            if pose.keypoints[index][2] >= KEYPOINT_CONFIDENCE
        ]

    def _head_size(self, pose: PoseResult) -> float:
        """Quloqlar orasidagi masofa yoki bbox dan taxmin.

        Masofa chegarasi mutlaq emas, bosh o'lchamiga nisbatan bo'lishi
        shart: kameraga yaqin odam kadrda katta, uzoqdagisi kichik.
        """
        left, right = pose.keypoints[LEFT_EAR], pose.keypoints[RIGHT_EAR]
        if left[2] >= KEYPOINT_CONFIDENCE and right[2] >= KEYPOINT_CONFIDENCE:
            width = abs(float(left[0]) - float(right[0]))
            if width > 1e-4:
                return width * 1.5

        # Ehtiyot variant: odam balandligining ~1/8 qismi.
        return max(pose.bbox[3] / 8.0, 0.01)

    def _zone_for(self, bbox: BBox, zones) -> str | None:
        from ..geometry import bottom_center

        point = bottom_center(bbox)
        for zone in zones:
            if point_in_polygon(point, zone.polygon):
                return zone.id
        return None
