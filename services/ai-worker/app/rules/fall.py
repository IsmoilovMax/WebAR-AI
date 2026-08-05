"""Yiqilish detektori.

Asosiy xato, deyarli barcha demo loyihalarda uchraydi: "odam gorizontal =
yiqilgan" deb hisoblash. Bu ishlamaydi. Divanda yotgan, polda o'tirib
mahsulot tanlayotgan, ta'mirlash qilayotgan odam ham gorizontal.

Yiqilish - bu O'TISH. Uch shart birga bajarilishi kerak:

  1. Odam tik yoki o'tirgan holatda edi.
  2. Qisqa vaqt ichida (< 2 s) gorizontal holatga o'tdi - tez tushish.
  3. Yerda qoldi (>= 3 s). O'zi turib ketsa, bu yiqilish emas, egilish.

Ilmiy adabiyotda eng yaxshi natijalar poza ketma-ketligini LSTM yoki
transformerga berish orqali olinadi. Bu yerda birinchi navbatda geometrik
qoida ishlatiladi: u tushunarli, sozlanadi va o'quv datasetini talab
qilmaydi. LSTM ni keyin shu interfeys ustiga qo'yish mumkin - buning uchun
_classify_posture ni almashtirish yetarli.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Deque, Literal

import numpy as np

from ..geometry import BBox, aspect_ratio
from ..pipeline.models import PoseResult
from ..schemas import EventType, Severity
from .base import EventCandidate, Rule, RuleContext

Posture = Literal["upright", "sitting", "lying", "unknown"]

# COCO 17 nuqta indekslari.
NOSE = 0
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6
LEFT_HIP, RIGHT_HIP = 11, 12
LEFT_KNEE, RIGHT_KNEE = 13, 14
LEFT_ANKLE, RIGHT_ANKLE = 15, 16

KEYPOINT_CONFIDENCE = 0.3


@dataclass(slots=True)
class _TrackState:
    postures: Deque[tuple[float, Posture]] = field(default_factory=lambda: deque(maxlen=90))
    lying_since: float | None = None
    fall_started_at: float | None = None
    reported: bool = False
    last_seen: float = 0.0
    last_bbox: BBox | None = None


class FallRule(Rule):
    detector = "fall"
    requires = ("pose",)

    def __init__(
        self,
        *,
        transition_seconds: float = 2.5,
        ground_seconds: float = 3.0,
        cooldown_seconds: float = 60.0,
        min_pose_confidence: float = 0.4,
    ) -> None:
        self._transition_seconds = transition_seconds
        self._ground_seconds = ground_seconds
        self._cooldown_seconds = cooldown_seconds
        self._min_pose_confidence = min_pose_confidence
        self._tracks: dict[int, _TrackState] = {}
        self._last_event: dict[int, float] = {}

    def evaluate(self, context: RuleContext) -> list[EventCandidate]:
        candidates: list[EventCandidate] = []
        active: set[int] = set()

        for pose in context.poses:
            if pose.track_id is None or pose.confidence < self._min_pose_confidence:
                continue

            active.add(pose.track_id)
            state = self._tracks.setdefault(pose.track_id, _TrackState())
            state.last_seen = context.timestamp
            state.last_bbox = pose.bbox

            posture = self._classify_posture(pose)
            state.postures.append((context.timestamp, posture))

            if posture != "lying":
                # Tik turdi - yiqilish holati bekor bo'ladi.
                state.lying_since = None
                state.fall_started_at = None
                state.reported = False
                continue

            if state.lying_since is None:
                state.lying_since = context.timestamp
                state.fall_started_at = self._find_transition_start(state, context.timestamp)

            if state.reported or state.fall_started_at is None:
                continue

            # Yerda yetarli vaqt qoldimi?
            if context.timestamp - state.lying_since < self._ground_seconds:
                continue

            last = self._last_event.get(pose.track_id)
            if last is not None and context.timestamp - last < self._cooldown_seconds:
                continue

            state.reported = True
            self._last_event[pose.track_id] = context.timestamp

            transition_duration = state.lying_since - state.fall_started_at
            ground_duration = context.timestamp - state.lying_since

            candidates.append(
                EventCandidate(
                    type=EventType.FALL,
                    confidence=self._confidence(pose, transition_duration, ground_duration),
                    started_at=datetime.fromtimestamp(
                        context.wall_time - (context.timestamp - state.fall_started_at),
                        tz=UTC,
                    ),
                    confirmed_at=context.wall_datetime,
                    bbox=pose.bbox,
                    track_id=pose.track_id,
                    severity=Severity.CRITICAL,
                    highlight=[pose.bbox],
                    meta={
                        "transitionSeconds": round(transition_duration, 2),
                        "groundSeconds": round(ground_duration, 2),
                        "torsoAngle": round(self._torso_angle(pose) or -1, 1),
                        "aspectRatio": round(aspect_ratio(pose.bbox), 2),
                    },
                )
            )

        self._forget_stale(context.timestamp, active)
        return candidates

    def on_track_lost(self, track_id: int) -> None:
        self._tracks.pop(track_id, None)
        self._last_event.pop(track_id, None)

    def _find_transition_start(self, state: _TrackState, now: float) -> float | None:
        """Yotish holatidan oldin tik/o'tirgan holat bo'lganini tekshiradi.

        Odam kadrga allaqachon yotgan holda kirsa (masalan divanda), bu
        yiqilish emas - None qaytaradi va event yaratilmaydi.
        """
        for timestamp, posture in reversed(state.postures):
            if now - timestamp > self._transition_seconds:
                break
            if posture in ("upright", "sitting"):
                return timestamp
        return None

    def _classify_posture(self, pose: PoseResult) -> Posture:
        angle = self._torso_angle(pose)
        ratio = aspect_ratio(pose.bbox)

        # Poza nuqtalari ishonchsiz bo'lsa (uzoq yoki to'silgan odam),
        # faqat bbox proporsiyasiga tayanamiz - bu kamroq ishonchli,
        # shuning uchun chegaralar konservativ.
        if angle is None:
            if ratio > 1.4:
                return "lying"
            if ratio < 0.5:
                return "upright"
            return "unknown"

        # Torso vertikaldan qancha og'gani. 0 = tik, 90 = gorizontal.
        if angle > 60 and ratio > 1.0:
            return "lying"
        if angle < 30:
            return "upright"

        # Oraliq: o'tirganmi yoki egilganmi - tizza burchagi hal qiladi.
        knee = self._knee_bend(pose)
        if knee is not None and knee < 120:
            return "sitting"
        return "unknown"

    def _torso_angle(self, pose: PoseResult) -> float | None:
        """Yelka markazi va son markazi orasidagi chiziqning vertikaldan og'ishi."""
        shoulders = self._midpoint(pose, LEFT_SHOULDER, RIGHT_SHOULDER)
        hips = self._midpoint(pose, LEFT_HIP, RIGHT_HIP)
        if shoulders is None or hips is None:
            return None

        dx = hips[0] - shoulders[0]
        dy = hips[1] - shoulders[1]
        if abs(dx) < 1e-6 and abs(dy) < 1e-6:
            return None

        return abs(math.degrees(math.atan2(abs(dx), abs(dy))))

    def _knee_bend(self, pose: PoseResult) -> float | None:
        hip = self._midpoint(pose, LEFT_HIP, RIGHT_HIP)
        knee = self._midpoint(pose, LEFT_KNEE, RIGHT_KNEE)
        ankle = self._midpoint(pose, LEFT_ANKLE, RIGHT_ANKLE)
        if hip is None or knee is None or ankle is None:
            return None

        a = np.array(hip) - np.array(knee)
        b = np.array(ankle) - np.array(knee)
        norm = np.linalg.norm(a) * np.linalg.norm(b)
        if norm < 1e-9:
            return None

        cosine = float(np.clip(np.dot(a, b) / norm, -1.0, 1.0))
        return math.degrees(math.acos(cosine))

    def _midpoint(self, pose: PoseResult, left: int, right: int) -> tuple[float, float] | None:
        points = [
            pose.keypoints[index]
            for index in (left, right)
            if pose.keypoints[index][2] >= KEYPOINT_CONFIDENCE
        ]
        if not points:
            return None
        xs = sum(point[0] for point in points) / len(points)
        ys = sum(point[1] for point in points) / len(points)
        return (float(xs), float(ys))

    def _confidence(self, pose: PoseResult, transition: float, ground: float) -> float:
        """Ishonch geometriyadan hisoblanadi, modeldan emas.

        Tez tushish va uzoq yotish - ishonchni oshiradi. Sekin tushish
        (o'tirish bo'lishi mumkin) - kamaytiradi.
        """
        speed_factor = max(0.0, 1.0 - transition / max(self._transition_seconds, 0.1))
        ground_factor = min(1.0, ground / (self._ground_seconds * 2))
        pose_factor = min(1.0, pose.confidence)

        score = 0.45 * speed_factor + 0.3 * ground_factor + 0.25 * pose_factor
        return round(min(0.97, max(0.4, score)), 3)

    def _forget_stale(self, now: float, active: set[int]) -> None:
        for track_id in list(self._tracks):
            if track_id in active:
                continue
            # Odam kadrdan chiqib ketgan bo'lsa holatni tashlaymiz, aks holda
            # xotira uzoq ishlaganda o'sib boradi.
            if now - self._tracks[track_id].last_seen > 15.0:
                self.on_track_lost(track_id)
