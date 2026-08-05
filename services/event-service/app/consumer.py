"""Redis Streams consumer: event / sighting / training xabarlarini qayta ishlaydi."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

import redis.asyncio as redis

from .alerts import AlertDispatcher
from .clips import capture_clip
from .config import Settings
from .db import Database
from .storage import MediaStore

log = logging.getLogger(__name__)


def _parse_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class StreamConsumer:
    def __init__(
        self,
        settings: Settings,
        db: Database,
        store: MediaStore,
        alerts: AlertDispatcher,
    ) -> None:
        self._settings = settings
        self._db = db
        self._store = store
        self._alerts = alerts
        self._redis = redis.from_url(settings.redis_url, decode_responses=True)
        self._stop = asyncio.Event()

    async def close(self) -> None:
        self._stop.set()
        await self._redis.aclose()

    async def ensure_groups(self) -> None:
        for key in (
            self._settings.event_stream_key,
            f"{self._settings.event_stream_key}:sightings",
            f"{self._settings.event_stream_key}:training",
        ):
            try:
                await self._redis.xgroup_create(
                    key, self._settings.consumer_group, id="0", mkstream=True
                )
                log.info("Consumer group yaratildi: %s", key)
            except redis.ResponseError as exc:
                if "BUSYGROUP" not in str(exc):
                    raise

    async def run(self) -> None:
        await self.ensure_groups()
        log.info("Redis Streams tinglash boshlandi")

        while not self._stop.is_set():
            try:
                await self._poll_once()
            except Exception:  # noqa: BLE001
                log.exception("Consumer xatosi, 2s dan keyin qayta uriniladi")
                await asyncio.sleep(2)

    async def _poll_once(self) -> None:
        streams = {
            self._settings.event_stream_key: ">",
            f"{self._settings.event_stream_key}:sightings": ">",
            f"{self._settings.event_stream_key}:training": ">",
        }

        result = await self._redis.xreadgroup(
            groupname=self._settings.consumer_group,
            consumername=self._settings.consumer_name,
            streams=streams,
            count=10,
            block=5000,
        )

        if not result:
            return

        for stream_key, messages in result:
            for message_id, fields in messages:
                try:
                    await self._handle(stream_key, fields)
                    await self._redis.xack(
                        stream_key, self._settings.consumer_group, message_id
                    )
                except Exception:  # noqa: BLE001
                    log.exception(
                        "Xabar qayta ishlanmadi: stream=%s id=%s", stream_key, message_id
                    )

    async def _handle(self, stream_key: str, fields: dict[str, str]) -> None:
        payload = json.loads(fields["payload"])

        if stream_key.endswith(":sightings"):
            await self._handle_sighting(payload)
        elif stream_key.endswith(":training"):
            await self._handle_training(payload)
        else:
            await self._handle_event(payload)

    async def _handle_event(self, payload: dict[str, Any]) -> None:
        # Kamera status hodisalari - faqat status yangilanadi.
        if payload["type"] in {"camera_offline", "camera_online"}:
            status = "online" if payload["type"] == "camera_online" else "offline"
            await self._db.touch_camera(
                payload["cameraId"],
                status,
                (payload.get("meta") or {}).get("reason"),
            )

        snapshot_key: str | None = None
        event_id_hint = str(uuid4())

        if payload.get("snapshotJpegBase64"):
            snapshot_key = self._store.build_key(
                payload["cameraId"], event_id_hint, "snapshots", "jpg"
            )
            await self._store.put_jpeg_base64(
                snapshot_key, payload["snapshotJpegBase64"]
            )

        # JSON dagi datetime stringlarni parse qilish.
        payload = {
            **payload,
            "startedAt": _parse_dt(payload["startedAt"]),
            "confirmedAt": _parse_dt(payload["confirmedAt"]),
        }

        event_id = await self._db.insert_event(payload, snapshot_key)
        if event_id is None:
            # Dublikat - media allaqachon yuklangan bo'lishi mumkin, lekin
            # kalit boshqacha. Orphan faylni qoldirmaslik uchun o'chirmaymiz
            # (idempotent qayta urinish).
            return

        # Snapshot kalitini haqiqiy event_id bilan moslashtirish shart emas -
        # UUID prefiksi yetarli. Lekin klip uchun event_id kerak.
        clip_key: str | None = None
        clip_path = await capture_clip(self._settings, payload["cameraId"])
        if clip_path is not None:
            try:
                clip_key = self._store.build_key(
                    payload["cameraId"], event_id, "clips", "mp4"
                )
                await self._store.put_file(clip_key, str(clip_path), "video/mp4")
                await self._db.attach_clip(event_id, clip_key)
            finally:
                clip_path.unlink(missing_ok=True)

        camera = await self._db.camera_rtsp_parts(payload["cameraId"])
        camera_name = camera["name"] if camera else payload["cameraId"]

        public = self._settings.s3_public_endpoint.rstrip("/")
        bucket = self._settings.s3_bucket
        snapshot_url = (
            f"{public}/{bucket}/{snapshot_key}" if snapshot_key else None
        )
        clip_url = f"{public}/{bucket}/{clip_key}" if clip_key else None

        bbox = payload.get("bbox")
        if bbox is not None and not isinstance(bbox, (list, tuple)):
            bbox = None

        await self._alerts.dispatch(
            org_id=payload["orgId"],
            camera_id=payload["cameraId"],
            camera_name=camera_name,
            event_id=event_id,
            event_type=payload["type"],
            severity=payload["severity"],
            confidence=float(payload["confidence"]),
            snapshot_url=snapshot_url,
            clip_url=clip_url,
            started_at=payload["startedAt"],
            confirmed_at=payload["confirmedAt"],
            track_id=payload.get("trackId"),
            bbox=bbox,
            meta=payload.get("meta") or {},
        )

    async def _handle_sighting(self, payload: dict[str, Any]) -> None:
        payload = {
            **payload,
            "firstSeenAt": _parse_dt(payload["firstSeenAt"]),
            "lastSeenAt": _parse_dt(payload["lastSeenAt"]),
        }
        await self._db.insert_sighting(payload)

    async def _handle_training(self, payload: dict[str, Any]) -> None:
        event_id = str(uuid4())
        snapshot_key = self._store.build_key(
            payload["cameraId"], event_id, "training", "jpg"
        )
        await self._store.put_jpeg_base64(snapshot_key, payload["snapshotJpegBase64"])
        await self._db.insert_training_sample(payload, snapshot_key)
