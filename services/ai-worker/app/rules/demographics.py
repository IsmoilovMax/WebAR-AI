"""Jins va yosh guruhi.

Yuz + jins aniqlanganda bir marta `person_detected` hodisasi chiqariladi.
Odam kadrni tark etganda SightingUpdate (analitika) yoziladi.

InsightFace: RetinaFace + ArcFace (track qayta bog'lash). Embedding DB ga
yozilmaydi. Gender: genderage.onnx (buffalo_sc da gender yo'q).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np

from ..geometry import BBox, iou
from ..pipeline.face import GenderAgeClassifier, crop_face
from ..pipeline.face_dedupe import DailyFaceDedupe
from ..pipeline.insightface_pack import FaceHit, cosine_similarity
from ..schemas import EventType, PersonAttributes, Severity, SightingUpdate, age_to_bucket
from .base import EventCandidate, Rule, RuleContext

GENDER_KO = {"male": "남자", "female": "여자"}
AGE_KO = {"young": "어린이", "middle": "중년", "senior": "노인"}

# Har bir kadrda demografiyani hisoblash kerak emas: odam bir soniyada
# jinsini o'zgartirmaydi. Har N-kadrda hisoblash GPU ni sezilarli tejaydi.
SAMPLE_EVERY_N_FRAMES = 2

# Shundan past ishonchli o'lchov ovoz berishga kirmaydi.
MIN_SAMPLE_CONFIDENCE = 0.5

# Yo'qolgan track embeddinglari shu muddat saqlanadi (soniya).
GALLERY_TTL_SECONDS = 30.0


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
    embedding: np.ndarray | None = None
    event_emitted: bool = False

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
        match_threshold: float = 0.42,
        daily_dedupe: DailyFaceDedupe | None = None,
    ) -> None:
        self._classifier = classifier
        self._track_timeout = track_timeout
        self._match_threshold = match_threshold
        self._daily_dedupe = daily_dedupe
        self._tracks: dict[int, _TrackAccumulator] = {}
        self._frame_counter = 0
        self._pending_sightings: list[SightingUpdate] = []
        # Yo'qolgan tracklar: ArcFace orqali qayta bog'lash (xotira only).
        self._gallery: dict[int, tuple[np.ndarray, float]] = {}

    def evaluate(self, context: RuleContext) -> list[EventCandidate]:
        self._frame_counter += 1
        active: set[int] = set()
        candidates: list[EventCandidate] = []

        people = [
            detection
            for detection in context.objects
            if detection.label.lower() == "person" and detection.track_id is not None
        ]
        faces = [detection for detection in context.objects if detection.label.lower() == "face"]
        face_hits = list(context.face_hits)

        for person in people:
            track_id = person.track_id
            assert track_id is not None

            hit = self._hit_for(person.bbox, face_hits)
            if hit is not None and hit.embedding is not None:
                matched = self._rematch_track(
                    track_id, hit.embedding, context.timestamp, occupied=active
                )
                if matched is not None:
                    track_id = matched

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

            if hit is not None and hit.embedding is not None:
                accumulator.embedding = hit.embedding

            if self._frame_counter % SAMPLE_EVERY_N_FRAMES == 0:
                self._sample_demographics(context, person.bbox, faces, hit, accumulator)

            event = self._maybe_person_event(context, person.bbox, track_id, accumulator)
            if event is not None:
                candidates.append(event)

        self._flush_stale(context, active)
        return candidates

    def _sample_demographics(
        self,
        context: RuleContext,
        person_bbox: BBox,
        faces: list,
        hit: FaceHit | None,
        accumulator: _TrackAccumulator,
    ) -> None:
        # buffalo_l da gender bor; buffalo_sc da yo'q — genderage.onnx.
        if hit is not None and hit.gender is not None:
            if hit.gender_confidence >= MIN_SAMPLE_CONFIDENCE:
                accumulator.genders[hit.gender] += 1
                accumulator.gender_scores.append(hit.gender_confidence)
            if hit.age is not None:
                bucket = age_to_bucket(hit.age)
                if bucket != "unknown":
                    accumulator.age_buckets[bucket] += 1
                    accumulator.age_scores.append(max(0.45, hit.gender_confidence * 0.85))
            return

        if self._classifier is None:
            return

        face_box = hit.bbox if hit is not None else self._face_for(person_bbox, faces)
        if face_box is None:
            return

        crop = crop_face(context.frame, face_box)
        if crop is None:
            return

        prediction = self._classifier.predict(crop)
        if prediction is None or prediction.gender_confidence < MIN_SAMPLE_CONFIDENCE:
            return

        accumulator.genders[prediction.gender] += 1
        accumulator.gender_scores.append(prediction.gender_confidence)

        bucket = age_to_bucket(prediction.age)
        if bucket != "unknown":
            accumulator.age_buckets[bucket] += 1
            accumulator.age_scores.append(prediction.age_confidence)

    def _maybe_person_event(
        self,
        context: RuleContext,
        bbox: BBox,
        track_id: int,
        accumulator: _TrackAccumulator,
    ) -> EventCandidate | None:
        """Har bir track uchun jins aniqlanganda bitta hodisa."""
        if accumulator.event_emitted or len(accumulator.gender_scores) < 1:
            return None

        attrs = accumulator.attributes()
        if attrs.gender == "unknown" or attrs.genderConfidence < 0.5:
            return None

        # Bir xil odam — kuniga faqat 1 hodisa (ArcFace).
        if self._daily_dedupe is not None:
            if self._daily_dedupe.already_seen(context.camera.org_id, accumulator.embedding):
                accumulator.event_emitted = True
                return None

        # Embedding bo'lmasa kunlik dedupe ishlamaydi — track ichida 1 marta.
        accumulator.event_emitted = True
        if self._daily_dedupe is not None and accumulator.embedding is not None:
            self._daily_dedupe.mark_seen(context.camera.org_id, accumulator.embedding)

        gender_label = GENDER_KO.get(attrs.gender, attrs.gender)
        age_label = AGE_KO.get(attrs.ageBucket) if attrs.ageBucket != "unknown" else None

        return EventCandidate(
            type=EventType.PERSON_DETECTED,
            confidence=attrs.genderConfidence,
            started_at=datetime.fromtimestamp(accumulator.first_seen_wall, tz=UTC),
            confirmed_at=context.wall_datetime,
            bbox=bbox,
            track_id=track_id,
            severity=Severity.INFO,
            meta={
                "gender": attrs.gender,
                "genderLabel": gender_label,
                "ageBucket": attrs.ageBucket,
                "ageLabel": age_label,
                "ageConfidence": attrs.ageConfidence,
                "genderConfidence": attrs.genderConfidence,
                "samples": attrs.samples,
                "label": gender_label,
                "dedupe": "daily_arcface",
            },
            highlight=[bbox],
        )

    def drain_sightings(self) -> list[SightingUpdate]:
        """Runner har kadrdan keyin chaqiradi va Redis ga yuboradi."""
        pending = self._pending_sightings
        self._pending_sightings = []
        return pending

    def live_attributes(self) -> dict[int, PersonAttributes]:
        """Jonli overlay uchun hozirgi taxmin (odam hali kadrda)."""
        live: dict[int, PersonAttributes] = {}
        for track_id, acc in self._tracks.items():
            # 1 ishonchli namuna yetadi — 남자/여자 tezroq chiqadi.
            if len(acc.gender_scores) < 1:
                continue
            attrs = acc.attributes()
            if attrs.gender == "unknown" or attrs.genderConfidence < 0.5:
                continue
            live[track_id] = attrs
        return live

    def on_track_lost(self, track_id: int) -> None:
        acc = self._tracks.pop(track_id, None)
        if acc is not None and acc.embedding is not None:
            self._gallery[track_id] = (acc.embedding, acc.last_seen_mono)

    def _rematch_track(
        self,
        track_id: int,
        embedding: np.ndarray,
        now: float,
        *,
        occupied: set[int],
    ) -> int | None:
        """ByteTrack yangi ID bersa, ArcFace orqali eski trackga qaytaradi."""
        if track_id in self._tracks:
            return None

        self._prune_gallery(now)

        # Faqat hozir kadrda band bo'lmagan ID lar — ikki odamni birlashtirmaslik.
        candidates: dict[int, np.ndarray] = {}
        for old_id, acc in self._tracks.items():
            if old_id in occupied:
                continue
            if acc.embedding is not None:
                candidates[old_id] = acc.embedding
        for old_id, (known, _ts) in self._gallery.items():
            if old_id in occupied:
                continue
            candidates.setdefault(old_id, known)

        best_id: int | None = None
        best_score = 0.0
        for old_id, known in candidates.items():
            score = cosine_similarity(embedding, known)
            if score > best_score:
                best_score = score
                best_id = old_id

        if best_id is None or best_score < self._match_threshold:
            return None

        self._gallery.pop(best_id, None)
        return best_id

    def _prune_gallery(self, now: float) -> None:
        for track_id in list(self._gallery):
            _emb, ts = self._gallery[track_id]
            if now - ts > GALLERY_TTL_SECONDS:
                del self._gallery[track_id]

    def _hit_for(self, person_bbox: BBox, hits: list[FaceHit]) -> FaceHit | None:
        x, y, w, h = person_bbox
        head_region = (x, y, w, h / 3)

        best: FaceHit | None = None
        best_area = 0.0
        for hit in hits:
            if iou(head_region, hit.bbox) <= 0:
                continue
            area = hit.bbox[2] * hit.bbox[3]
            if area > best_area:
                best_area = area
                best = hit
        return best

    def _face_for(self, person_bbox: BBox, faces: list) -> BBox | None:
        """Odam ramkasi ichidagi eng katta yuzni topadi."""
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
            if accumulator.embedding is not None:
                self._gallery[track_id] = (accumulator.embedding, context.timestamp)
            del self._tracks[track_id]

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
