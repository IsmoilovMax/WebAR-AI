"""Jins va yosh guruhi.

Bu qoida event chiqarmaydi - u odam bo'yicha atribut to'playdi va odam
kadrni tark etganda yakuniy natijani beradi (SightingUpdate). Sabab: bitta
kadr bo'yicha "erkak, 30 yosh" deyish - taxmin. O'nlab kadr bo'yicha ovoz
berish esa ancha barqaror.

Chiqishda aniq yosh emas, uchta guruh beriladi. Eng yaxshi ochiq modellarda
ham o'rtacha absolyut xato ~7.5 yil: "28 yosh" aslida 20-36 degani. Bunday
raqamni interfeysda ko'rsatish foydalanuvchini chalg'itadi.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime

from ..geometry import BBox, iou
from ..pipeline.face import GenderAgeClassifier, crop_face
from ..schemas import PersonAttributes, SightingUpdate, age_to_bucket
from .base import EventCandidate, Rule, RuleContext

# Har bir kadrda demografiyani hisoblash kerak emas: odam bir soniyada
# jinsini o'zgartirmaydi. Har N-kadrda hisoblash GPU ni sezilarli tejaydi.
SAMPLE_EVERY_N_FRAMES = 5

# Shundan past ishonchli o'lchov ovoz berishga kirmaydi.
MIN_SAMPLE_CONFIDENCE = 0.6


@dataclass(slots=True)
class _TrackAccumulator:
    first_seen_wall: float
    last_seen_wall: float
    last_seen_mono: float
    genders: Counter = field(default_factory=Counter)
    gender_scores: list[float] = field(default_factory=list)
    age_buckets: Counter = field(default_factory=Counter)
    age_scores: list[float] = field(default_factory=list)
    frames_seen: int = 0

    def attributes(self) -> PersonAttributes:
        gender, gender_confidence = _vote(self.genders, self.gender_scores)
        bucket, age_confidence = _vote(self.age_buckets, self.age_scores)

        return PersonAttributes(
            gender=gender or "unknown",  # type: ignore[arg-type]
            genderConfidence=gender_confidence,
            ageBucket=bucket or "unknown",  # type: ignore[arg-type]
            ageConfidence=age_confidence,
            samples=len(self.gender_scores),
        )


def _vote(counter: Counter, scores: list[float]) -> tuple[str | None, float]:
    if not counter:
        return None, 0.0

    label, votes = counter.most_common(1)[0]
    total = sum(counter.values())
    # Ishonch = ovozlar ulushi * o'rtacha model ishonchi. Ikkalasi ham
    # muhim: 10 kadrdan 6 tasi "erkak" desa, lekin har biri 0.55 ishonch
    # bilan - bu kuchsiz natija.
    agreement = votes / total
    mean_score = sum(scores) / len(scores) if scores else 0.0
    return str(label), round(agreement * mean_score, 3)


class DemographicsRule(Rule):
    detector = "demographics"
    requires = ("face",)

    def __init__(
        self,
        classifier: GenderAgeClassifier | None,
        *,
        track_timeout: float = 5.0,
    ) -> None:
        self._classifier = classifier
        self._track_timeout = track_timeout
        self._tracks: dict[int, _TrackAccumulator] = {}
        self._frame_counter = 0
        self._pending_sightings: list[SightingUpdate] = []

    def evaluate(self, context: RuleContext) -> list[EventCandidate]:
        self._frame_counter += 1
        active: set[int] = set()

        people = [
            detection
            for detection in context.objects
            if detection.label.lower() == "person" and detection.track_id is not None
        ]
        faces = [detection for detection in context.objects if detection.label.lower() == "face"]

        for person in people:
            track_id = person.track_id
            assert track_id is not None
            active.add(track_id)

            accumulator = self._tracks.get(track_id)
            if accumulator is None:
                accumulator = _TrackAccumulator(
                    first_seen_wall=context.wall_time,
                    last_seen_wall=context.wall_time,
                    last_seen_mono=context.timestamp,
                )
                self._tracks[track_id] = accumulator

            accumulator.last_seen_wall = context.wall_time
            accumulator.last_seen_mono = context.timestamp
            accumulator.frames_seen += 1

            if self._classifier is None:
                continue
            if self._frame_counter % SAMPLE_EVERY_N_FRAMES != 0:
                continue

            face = self._face_for(person.bbox, faces)
            if face is None:
                continue

            crop = crop_face(context.frame, face)
            if crop is None:
                continue

            prediction = self._classifier.predict(crop)
            if prediction is None or prediction.gender_confidence < MIN_SAMPLE_CONFIDENCE:
                continue

            accumulator.genders[prediction.gender] += 1
            accumulator.gender_scores.append(prediction.gender_confidence)

            bucket = age_to_bucket(prediction.age)
            if bucket != "unknown":
                accumulator.age_buckets[bucket] += 1
                accumulator.age_scores.append(prediction.age_confidence)

        self._flush_stale(context, active)
        return []

    def drain_sightings(self) -> list[SightingUpdate]:
        """Runner har kadrdan keyin chaqiradi va Redis ga yuboradi."""
        pending = self._pending_sightings
        self._pending_sightings = []
        return pending

    def live_attributes(self) -> dict[int, PersonAttributes]:
        """Jonli overlay uchun hozirgi taxmin (odam hali kadrda)."""
        live: dict[int, PersonAttributes] = {}
        for track_id, acc in self._tracks.items():
            # Kam namuna yoki past ishonch — jins ko'rsatilmaydi (xato kamayadi).
            if len(acc.gender_scores) < 3:
                continue
            attrs = acc.attributes()
            if attrs.gender == "unknown" or attrs.genderConfidence < 0.55:
                continue
            live[track_id] = attrs
        return live

    def on_track_lost(self, track_id: int) -> None:
        self._tracks.pop(track_id, None)

    def _face_for(self, person_bbox: BBox, faces: list) -> BBox | None:
        """Odam ramkasi ichidagi eng katta yuzni topadi.

        Bir nechta odam yonma-yon turganda yuzlar aralashib ketishi mumkin,
        shuning uchun yuz odamning yuqori uchdan bir qismida bo'lishi talab
        qilinadi.
        """
        x, y, w, h = person_bbox
        head_region = (x, y, w, h / 3)

        best: BBox | None = None
        best_area = 0.0

        for face in faces:
            if iou(head_region, face.bbox) <= 0:
                continue
            area = face.bbox[2] * face.bbox[3]
            if area > best_area:
                best_area = area
                best = face.bbox

        return best

    def _flush_stale(self, context: RuleContext, active: set[int]) -> None:
        for track_id in list(self._tracks):
            if track_id in active:
                continue

            accumulator = self._tracks[track_id]
            if context.timestamp - accumulator.last_seen_mono < self._track_timeout:
                continue

            attributes = accumulator.attributes()
            del self._tracks[track_id]

            # Juda qisqa ko'rinishlar statistikani buzadi: kadr chetidan
            # o'tib ketgan odam "mijoz" emas.
            dwell = accumulator.last_seen_wall - accumulator.first_seen_wall
            if accumulator.frames_seen < 3 or dwell < 1.0:
                continue

            self._pending_sightings.append(
                SightingUpdate(
                    orgId=context.camera.org_id,
                    cameraId=context.camera.id,
                    trackId=track_id,
                    firstSeenAt=datetime.fromtimestamp(accumulator.first_seen_wall, tz=UTC),
                    lastSeenAt=datetime.fromtimestamp(accumulator.last_seen_wall, tz=UTC),
                    dwellSeconds=round(dwell, 2),
                    attributes=attributes,
                )
            )
