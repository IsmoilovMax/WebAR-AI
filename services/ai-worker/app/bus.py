"""Redis Streams orqali event chiqarish.

Nega Streams va oddiy pub/sub emas: pub/sub da event-service bir soniyaga
pastga tushsa, o'sha paytdagi barcha eventlar yo'qoladi. Streams consumer
group bilan ishlaydi va tasdiqlanmagan xabarlarni saqlaydi.
"""

from __future__ import annotations

import logging
import threading

import redis

from .config import Settings
from .schemas import DetectionEvent, LiveOverlay, SightingUpdate, TrainingSample

log = logging.getLogger(__name__)


class EventBus:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        # Kamera worker lari alohida threadlarda ishlaydi. redis-py ning
        # connection pool i thread-safe, ammo publish xatosini hisoblash uchun
        # lokal hisoblagichni himoyalaymiz.
        self._lock = threading.Lock()
        self._published = 0
        self._failed = 0
        self._latest_overlay: dict[str, str] = {}

    def _publish(self, key: str, payload: str) -> bool:
        try:
            self._client.xadd(
                key,
                {"payload": payload},
                maxlen=self._settings.event_stream_maxlen,
                approximate=True,
            )
        except redis.RedisError:
            # Event yo'qolishi mumkin, ammo bu kadr qayta ishlashni
            # to'xtatmasligi kerak: monitoring davom etishi muhimroq.
            log.exception("Redis ga yozib bo'lmadi: %s", key)
            with self._lock:
                self._failed += 1
            return False

        with self._lock:
            self._published += 1
        return True

    def publish_event(self, event: DetectionEvent) -> bool:
        return self._publish(
            self._settings.event_stream_key,
            event.model_dump_json(),
        )

    def publish_sighting(self, sighting: SightingUpdate) -> bool:
        return self._publish(
            f"{self._settings.event_stream_key}:sightings",
            sighting.model_dump_json(),
        )

    def publish_training_sample(self, sample: TrainingSample) -> bool:
        return self._publish(
            f"{self._settings.event_stream_key}:training",
            sample.model_dump_json(),
        )

    def publish_overlay(self, overlay: LiveOverlay) -> bool:
        """Jonli box lar — Pub/Sub + so'nggi holat (TTL 2 s).

        Stream emas: eski kadrlar kerak emas, faqat "hozir" muhim.
        """
        payload = overlay.model_dump_json()
        channel = f"{self._settings.overlay_channel_prefix}{overlay.cameraId}"
        key = f"{channel}:latest"
        try:
            pipe = self._client.pipeline()
            pipe.publish(channel, payload)
            pipe.set(key, payload, ex=10)
            pipe.execute()
        except redis.RedisError:
            log.exception("Overlay yozilmadi: %s", overlay.cameraId)
            return False

        with self._lock:
            self._latest_overlay[overlay.cameraId] = payload
        return True

    def latest_overlay(self, camera_id: str) -> str | None:
        with self._lock:
            cached = self._latest_overlay.get(camera_id)
        if cached:
            return cached
        try:
            return self._client.get(
                f"{self._settings.overlay_channel_prefix}{camera_id}:latest"
            )
        except redis.RedisError:
            return None

    @property
    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"published": self._published, "failed": self._failed}

    def ping(self) -> bool:
        try:
            return bool(self._client.ping())
        except redis.RedisError:
            return False

    def close(self) -> None:
        self._client.close()
