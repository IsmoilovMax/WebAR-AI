"""Bitta kameraning to'liq quvuri.

Har bir kamera alohida threadda ishlaydi va ketma-ket bajaradi:
dekodlash -> aniqlash -> tracking -> poza -> qoidalar -> event.

Nega thread va process emas: modellar (ayniqsa GPU da) xotirada bir marta
turishi kerak; har bir process o'z nusxasini yuklasa, 8 kamera uchun
xotira yetmaydi. Python GIL bu yerda katta muammo emas, chunki og'ir
ishning deyarli hammasi (dekodlash, inference) C/CUDA ichida bajariladi
va GIL ni bo'shatadi.

12 dan ortiq kamera kerak bo'lganda bu model yetmaydi - o'shanda batched
inference yoki DeepStream ga o'tish kerak. Buni oldindan qurish erta
optimizatsiya bo'lardi.
"""

from __future__ import annotations

import logging
import queue
import random
import threading
import time
from dataclasses import dataclass, field

from ..bus import EventBus
from ..config import Settings
from ..db import CameraConfig
from ..rules.base import EventCandidate, Rule, RuleContext
from ..schemas import DetectionEvent, EventType, LiveOverlay, OverlayBox, Severity, TrainingSample
from .annotate import annotate, to_jpeg_base64
from .models import Detection, ModelRegistry, PoseResult
from .source import RtspSource

log = logging.getLogger(__name__)

# COCO da "person" klassi indeksi. Faqat shu klassni so'rash NMS ni
# tezlashtiradi va keraksiz obyektlarni filtrlaydi.
COCO_PERSON = 0

# Yuz/poza modellari og'ir — har N-kadrda (overlay tezroq yangilanadi).
HEAVY_INFERENCE_INTERVAL = 3

FIRE_LABELS = {"fire", "flame", "yong'in", "yongin"}
SMOKE_LABELS = {"smoke", "tutun"}
CIG_LABELS = {"cigarette", "cig", "sigaret", "smoking", "smoke_person"}
FACE_LABELS = {"face", "yuz"}


def _overlay_kind(label: str) -> str:
    low = label.lower()
    if low == "person":
        return "person"
    if low in FIRE_LABELS:
        return "fire"
    if low in SMOKE_LABELS:
        return "smoke"
    if low in CIG_LABELS:
        return "cigarette"
    if low in FACE_LABELS:
        return "face"
    return "other"


@dataclass
class CameraStats:
    frames_processed: int = 0
    events_published: int = 0
    last_frame_at: float | None = None
    connected: bool = False
    status_reason: str | None = None
    inference_ms: float = 0.0
    active_detectors: list[str] = field(default_factory=list)
    disabled_detectors: dict[str, str] = field(default_factory=dict)


class CameraWorker:
    def __init__(
        self,
        camera: CameraConfig,
        *,
        settings: Settings,
        registry: ModelRegistry,
        bus: EventBus,
        model_versions: dict[str, str],
    ) -> None:
        self._camera = camera
        self._settings = settings
        self._registry = registry
        self._bus = bus
        self._model_versions = model_versions

        self._stats = CameraStats()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

        self._rules: list[Rule] = []
        self._person_model = None
        self._pose_model = None
        self._fire_model = None
        self._cigarette_model = None
        self._face_model = None

        go2rtc = settings.go2rtc_url or None
        self._source = RtspSource(
            camera.rtsp_url(go2rtc_url=go2rtc),
            camera.analytics_fps,
            redacted_url=camera.redacted_rtsp_url(go2rtc_url=go2rtc),
            reconnect_base_delay=settings.reconnect_base_delay,
            reconnect_max_delay=settings.reconnect_max_delay,
            on_state_change=self._on_connection_change,
        )
        self._last_overlay_at = 0.0
        self._frame_counter = 0
        self._cached_demographics: dict[int, str] = {}

    @property
    def camera_id(self) -> str:
        return self._camera.id

    @property
    def stats(self) -> CameraStats:
        return self._stats

    def start(self) -> None:
        self._build_pipeline()
        self._thread = threading.Thread(
            target=self._run, name=f"camera-{self._camera.name}", daemon=True
        )
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._source.stop()
        if self._thread:
            self._thread.join(timeout=timeout)
        self._registry.unload_camera(self._camera.id)

    # -- qurish ----------------------------------------------------------

    def _build_pipeline(self) -> None:
        from ..rules import (
            DemographicsRule,
            FallRule,
            FireSmokeRule,
            SmokingRule,
            ZoneIntrusionRule,
        )

        enabled = set(self._camera.enabled_detectors)
        active: list[str] = []
        disabled: dict[str, str] = {}

        # Tracker holati model obyektida yashaydi, shuning uchun tracking
        # qiladigan modellar kamera bo'yicha alohida yuklanadi.
        needs_person = bool(enabled & {"person", "smoking", "demographics", "fall"})
        if needs_person:
            self._person_model = self._registry.load(
                "person", per_camera=True, camera_id=self._camera.id
            )
            if self._person_model is None:
                disabled["person"] = self._registry.errors.get("person", "model yo'q")
            elif "person" in enabled:
                active.append("person")

        needs_pose = bool(enabled & {"fall", "smoking"})
        if needs_pose:
            self._pose_model = self._registry.load(
                "pose", per_camera=True, camera_id=self._camera.id
            )
            if self._pose_model is None:
                disabled["pose"] = self._registry.errors.get("pose", "model yo'q")

        if "fire_smoke" in enabled:
            self._fire_model = self._registry.load("fire_smoke")
            if self._fire_model is not None:
                self._rules.append(FireSmokeRule(min_confidence=self._settings.fire_confidence))
                active.append("fire_smoke")
            else:
                disabled["fire_smoke"] = self._registry.errors.get("fire_smoke", "model yo'q")

        if "fall" in enabled:
            if self._pose_model is not None:
                self._rules.append(FallRule(min_pose_confidence=self._settings.pose_confidence))
                active.append("fall")
            else:
                disabled["fall"] = "pose modeli yo'q"

        if "smoking" in enabled:
            self._cigarette_model = self._registry.load("cigarette")
            if self._cigarette_model is not None and self._pose_model is not None:
                self._rules.append(
                    SmokingRule(min_confidence=self._settings.smoking_confidence)
                )
                active.append("smoking")
            else:
                disabled["smoking"] = (
                    self._registry.errors.get("cigarette")
                    or ("pose modeli yo'q" if self._pose_model is None else "model yo'q")
                )

        if "demographics" in enabled:
            self._face_model = self._registry.load("face")
            classifier = self._load_gender_age()
            if self._face_model is not None and classifier is not None:
                self._rules.append(DemographicsRule(classifier))
                active.append("demographics")
            else:
                disabled["demographics"] = (
                    self._registry.errors.get("face") or "genderage.onnx topilmadi"
                )

        if self._camera.zones and self._person_model is not None:
            self._rules.append(ZoneIntrusionRule())
            if "person" not in active:
                active.append("person")

        self._stats.active_detectors = active
        self._stats.disabled_detectors = disabled

        if disabled:
            log.warning(
                "Kamera %s: o'chirilgan detektorlar: %s",
                self._camera.name,
                ", ".join(f"{key} ({value})" for key, value in disabled.items()),
            )

    def _load_gender_age(self):
        from .face import GenderAgeClassifier

        path = self._settings.models_dir / "genderage.onnx"
        if not path.exists():
            return None
        try:
            providers = (
                ["CUDAExecutionProvider", "CPUExecutionProvider"]
                if self._registry.device == "cuda"
                else ["CPUExecutionProvider"]
            )
            return GenderAgeClassifier(path, providers=providers)
        except Exception:  # noqa: BLE001
            log.exception("genderage.onnx yuklanmadi")
            return None

    # -- ishlash ---------------------------------------------------------

    def _run(self) -> None:
        log.info("Kamera worker ishga tushdi: %s", self._camera.name)

        # Inference sekin bo'lsa ham RTSP dan eng yangi kadr olinadi (kechikish kamayadi).
        frame_queue: queue.Queue = queue.Queue(maxsize=1)

        def reader() -> None:
            for frame in self._source.frames():
                if self._stop.is_set():
                    return
                try:
                    frame_queue.put_nowait(frame)
                except queue.Full:
                    try:
                        frame_queue.get_nowait()
                    except queue.Empty:
                        pass
                    frame_queue.put_nowait(frame)

        threading.Thread(
            target=reader,
            name=f"camera-{self._camera.name}-reader",
            daemon=True,
        ).start()

        while not self._stop.is_set():
            try:
                frame = frame_queue.get(timeout=0.5)
            except queue.Empty:
                continue

            started = time.perf_counter()
            try:
                self._process_frame(frame)
            except Exception:  # noqa: BLE001
                log.exception("Kadrni qayta ishlashda xato: %s", self._camera.name)

            self._stats.inference_ms = round((time.perf_counter() - started) * 1000, 1)
            self._stats.frames_processed += 1
            self._stats.last_frame_at = frame.wall_time

        log.info("Kamera worker to'xtadi: %s", self._camera.name)

    def _process_frame(self, frame) -> None:
        self._frame_counter += 1
        objects: list[Detection] = []
        poses: list[PoseResult] = []

        if self._person_model is not None:
            objects.extend(
                self._person_model.track(
                    frame.image,
                    confidence=self._settings.person_confidence,
                    classes=[COCO_PERSON],
                )
            )

        # Tez yo'l: odam ramkasini darhol yuborish (video bilan sinxronroq).
        self._publish_overlay(
            frame.wall_time,
            objects,
            [],
            self._cached_demographics or None,
        )

        heavy = self._frame_counter % HEAVY_INFERENCE_INTERVAL == 0 and (
            self._face_model is not None
            or self._pose_model is not None
            or self._fire_model is not None
            or self._cigarette_model is not None
        )
        if not heavy:
            return

        if self._fire_model is not None:
            objects.extend(
                self._fire_model.predict(
                    frame.image, confidence=self._settings.fire_confidence
                )
            )

        if self._cigarette_model is not None:
            objects.extend(
                self._cigarette_model.predict(
                    frame.image, confidence=self._settings.smoking_confidence
                )
            )

        if self._face_model is not None:
            objects.extend(
                self._face_model.predict(
                    frame.image, confidence=self._settings.face_confidence
                )
            )

        # YOLO yuzni o'tkazib yuborsa — yaqin/focusdan chiqqan yuzlar (MediaPipe).
        if not any(o.label.lower() == "face" for o in objects):
            from .mediapipe_face import detect_face_boxes

            objects.extend(detect_face_boxes(frame.image))

        # Yuz bor, lekin odam yo'q (yaqin plan) — demografiya uchun taxminiy odam.
        has_person = any(o.label.lower() == "person" for o in objects)
        if not has_person:
            face_objects = [o for o in objects if o.label.lower() == "face"]
            for i, face in enumerate(face_objects):
                x, y, fw, fh = face.bbox
                objects.append(
                    Detection(
                        label="person",
                        confidence=max(0.4, face.confidence),
                        bbox=(
                            max(0.0, x - fw * 0.4),
                            max(0.0, y - fh * 0.3),
                            min(1.0, fw * 1.8),
                            min(1.0, fh * 3.5),
                        ),
                        track_id=10_000 + i,
                    )
                )

        if self._pose_model is not None:
            poses = self._pose_model.predict_pose(
                frame.image, confidence=self._settings.pose_confidence
            )

        context = RuleContext(
            camera=self._camera,
            frame=frame.image,
            timestamp=frame.timestamp,
            wall_time=frame.wall_time,
            objects=objects,
            poses=poses,
            model_versions=self._model_versions,
        )

        for rule in self._rules:
            for candidate in rule.evaluate(context):
                self._publish(candidate, context)

            drain = getattr(rule, "drain_sightings", None)
            if drain is not None:
                for sighting in drain():
                    self._bus.publish_sighting(sighting)

        self._cached_demographics = self._demographics_subtitles()
        self._publish_overlay(
            frame.wall_time, objects, poses, self._cached_demographics or None
        )
        self._maybe_sample_for_training(context, objects)

    def _demographics_subtitles(self) -> dict[int, str]:
        from ..rules.demographics import DemographicsRule

        gender_uz = {"male": "Erkak", "female": "Ayol"}
        age_uz = {"young": "yosh", "middle": "o'rta", "senior": "katta"}

        for rule in self._rules:
            if not isinstance(rule, DemographicsRule):
                continue
            subtitles: dict[int, str] = {}
            for track_id, attrs in rule.live_attributes().items():
                if attrs.genderConfidence < 0.55:
                    continue
                parts = [gender_uz.get(attrs.gender, "")]
                if attrs.ageBucket != "unknown":
                    parts.append(age_uz.get(attrs.ageBucket, attrs.ageBucket))
                text = " · ".join(p for p in parts if p)
                if text:
                    subtitles[track_id] = text
            return subtitles
        return {}

    def _face_demographic_subtitles(
        self,
        objects: list[Detection],
        demographics: dict[int, str],
    ) -> dict[int, str]:
        """Yuz ramkasiga jins/yosh taxminini biriktiradi."""
        from ..geometry import iou

        people = [
            d
            for d in objects
            if d.label.lower() == "person" and d.track_id is not None and d.track_id in demographics
        ]
        if not people:
            return {}

        result: dict[int, str] = {}
        for face in objects:
            if face.label.lower() != "face":
                continue
            fx, fy, fw, fh = face.bbox
            face_area = fw * fh
            if face_area <= 0:
                continue

            best_track: int | None = None
            best_iou = 0.0
            for person in people:
                px, py, pw, ph = person.bbox
                head = (px, py, pw, ph / 3)
                overlap = iou(head, face.bbox)
                if overlap > best_iou:
                    best_iou = overlap
                    best_track = person.track_id

            if best_track is not None and best_iou > 0:
                result[id(face)] = demographics[best_track]

        return result

    def _publish_overlay(
        self,
        wall_time: float,
        objects: list[Detection],
        poses: list[PoseResult],
        demographics: dict[int, str] | None = None,
    ) -> None:
        """Brauzer uchun jonli box lar (odam, olov, tutun, ...)."""
        min_interval = 1.0 / max(self._settings.overlay_hz, 0.5)
        if wall_time - self._last_overlay_at < min_interval:
            return
        self._last_overlay_at = wall_time

        boxes: list[OverlayBox] = []

        demographics = demographics or {}
        face_subtitles = self._face_demographic_subtitles(objects, demographics)

        for detection in objects:
            kind = _overlay_kind(detection.label)
            if kind == "other":
                continue
            track_id = getattr(detection, "track_id", None)
            subtitle = None
            if track_id is not None and kind == "person":
                subtitle = demographics.get(track_id)
            elif kind == "face":
                subtitle = face_subtitles.get(id(detection))
            boxes.append(
                OverlayBox(
                    label=detection.label,
                    kind=kind,  # type: ignore[arg-type]
                    confidence=round(float(detection.confidence), 3),
                    bbox=detection.bbox,
                    trackId=track_id,
                    subtitle=subtitle,
                )
            )

        # Person detection yo'q, lekin poza bor bo'lsa - odamni ko'rsatamiz.
        has_person = any(b.kind == "person" for b in boxes)
        if not has_person:
            for pose in poses:
                boxes.append(
                    OverlayBox(
                        label="person",
                        kind="person",
                        confidence=round(float(getattr(pose, "confidence", 0.5)), 3),
                        bbox=pose.bbox,
                        trackId=pose.track_id,
                    )
                )

        self._bus.publish_overlay(
            LiveOverlay(cameraId=self._camera.id, ts=wall_time, boxes=boxes)
        )

    def _publish(self, candidate: EventCandidate, context: RuleContext) -> None:
        severity = candidate.resolved_severity()

        snapshot = annotate(
            context.frame,
            candidate.highlight or ([candidate.bbox] if candidate.bbox else []),
            label=f"{candidate.type.value} {candidate.confidence:.0%}",
            severity=severity.value,
            timestamp=candidate.confirmed_at,
        )

        event = DetectionEvent(
            eventKey=candidate.event_key(self._camera.id),
            orgId=self._camera.org_id,
            cameraId=self._camera.id,
            type=candidate.type,
            severity=severity,
            startedAt=candidate.started_at,
            confirmedAt=candidate.confirmed_at,
            confidence=candidate.confidence,
            trackId=candidate.track_id,
            zoneId=candidate.zone_id,
            bbox=candidate.bbox,
            modelVersions=self._model_versions,
            snapshotJpegBase64=to_jpeg_base64(
                snapshot, self._settings.snapshot_jpeg_quality
            ),
            meta=candidate.meta,
        )

        if self._bus.publish_event(event):
            self._stats.events_published += 1
            log.info(
                "Event: %s / %s (ishonch %.2f)",
                self._camera.name,
                candidate.type.value,
                candidate.confidence,
            )

    def _maybe_sample_for_training(
        self, context: RuleContext, detections: list[Detection]
    ) -> None:
        """Model ikkilangan kadrlarni active learning uchun saqlaydi.

        Ishonchi 0.35-0.6 oralig'idagi aniqlanishlar eng qimmatli o'quv
        namunalari: model aynan shu yerda xato qiladi. Hammasini yuborsak
        storage to'lib ketadi, shuning uchun tasodifiy tanlash.
        """
        low, high = self._settings.uncertainty_band

        for detection in detections:
            if not (low <= detection.confidence <= high):
                continue
            if random.random() > self._settings.uncertainty_sample_rate:
                continue

            snapshot = to_jpeg_base64(
                annotate(
                    context.frame,
                    [detection.bbox],
                    label=f"{detection.label} {detection.confidence:.0%}",
                    severity="low",
                ),
                self._settings.snapshot_jpeg_quality,
            )
            if snapshot is None:
                continue

            self._bus.publish_training_sample(
                TrainingSample(
                    orgId=self._camera.org_id,
                    cameraId=self._camera.id,
                    detector=self._detector_for_label(detection.label),
                    eventType=detection.label,
                    label="uncertain",
                    confidence=detection.confidence,
                    bbox=detection.bbox,
                    modelVersion=self._model_versions.get(
                        self._detector_for_label(detection.label)
                    ),
                    snapshotJpegBase64=snapshot,
                )
            )
            # Har kadrda ko'pi bilan bitta namuna - Redis ni bosmaslik uchun.
            return

    def _detector_for_label(self, label: str) -> str:
        lowered = label.lower()
        if lowered in {"fire", "flame", "smoke"}:
            return "fire_smoke"
        if lowered in {"cigarette", "smoking"}:
            return "smoking"
        if lowered == "face":
            return "demographics"
        return "person"

    def _on_connection_change(self, connected: bool, reason: str | None) -> None:
        self._stats.connected = connected
        self._stats.status_reason = reason

        from datetime import UTC, datetime

        now = datetime.now(tz=UTC)
        event_type = EventType.CAMERA_ONLINE if connected else EventType.CAMERA_OFFLINE

        self._bus.publish_event(
            DetectionEvent(
                eventKey=f"{self._camera.id}:{event_type.value}:{int(now.timestamp())}",
                orgId=self._camera.org_id,
                cameraId=self._camera.id,
                type=event_type,
                severity=Severity.INFO if connected else Severity.HIGH,
                startedAt=now,
                confirmedAt=now,
                confidence=1.0,
                meta={"reason": reason} if reason else {},
            )
        )
