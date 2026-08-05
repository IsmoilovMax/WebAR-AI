"""Barcha kamera worker larini boshqaradi.

Konfiguratsiya bazadan o'qiladi va davriy yangilanadi: web ilovada kamera
qo'shilsa yoki zona chizilsa, worker restart qilinmasdan o'zi ko'radi.
"""

from __future__ import annotations

import asyncio
import logging

from ..bus import EventBus
from ..config import Settings
from ..db import CameraConfig, ConfigStore
from ..go2rtc import ensure_streams
from .models import ModelRegistry
from .runner import CameraWorker

log = logging.getLogger(__name__)

RELOAD_INTERVAL_SECONDS = 30


class Supervisor:
    def __init__(self, settings: Settings, *, edge_node_id: str | None = None) -> None:
        self._settings = settings
        self._edge_node_id = edge_node_id
        self._store = ConfigStore(settings.database_url, settings.credentials_encryption_key)
        self._bus = EventBus(settings)
        self._registry = ModelRegistry(settings)
        self._workers: dict[str, CameraWorker] = {}
        self._signatures: dict[str, tuple] = {}
        self._model_versions: dict[str, str] = {}
        self._reload_task: asyncio.Task | None = None
        self._go2rtc_registered = False

    @property
    def registry(self) -> ModelRegistry:
        return self._registry

    @property
    def bus(self) -> EventBus:
        return self._bus

    async def start(self) -> None:
        await self._store.connect()
        await self.reload()
        self._reload_task = asyncio.create_task(self._reload_loop())

    async def stop(self) -> None:
        if self._reload_task:
            self._reload_task.cancel()
            try:
                await self._reload_task
            except asyncio.CancelledError:
                pass

        for worker in list(self._workers.values()):
            worker.stop()
        self._workers.clear()

        await self._store.close()
        self._bus.close()

    async def _reload_loop(self) -> None:
        while True:
            await asyncio.sleep(RELOAD_INTERVAL_SECONDS)
            try:
                await self.reload()
            except Exception:  # noqa: BLE001
                log.exception("Konfiguratsiyani yangilashda xato")

    async def reload(self) -> None:
        cameras = await self._store.load_cameras(self._edge_node_id)
        self._model_versions = await self._store.load_active_models()

        if len(cameras) > self._settings.max_cameras:
            log.warning(
                "%d kamera sozlangan, ammo chegara %d. Ortiqchalari o'tkazib yuborildi.",
                len(cameras),
                self._settings.max_cameras,
            )
            cameras = cameras[: self._settings.max_cameras]

        desired = {camera.id: camera for camera in cameras}

        stream_signature = tuple(
            sorted(
                (cid, self._signature(desired[cid])[:5])
                for cid in desired
            )
        )
        if not self._go2rtc_registered or stream_signature != getattr(
            self, "_stream_signature", ()
        ):
            await ensure_streams(self._settings, cameras)
            self._go2rtc_registered = True
            self._stream_signature = stream_signature

        for camera_id in list(self._workers):
            if camera_id not in desired:
                log.info("Kamera o'chirildi, worker to'xtatilmoqda: %s", camera_id)
                self._workers.pop(camera_id).stop()
                self._signatures.pop(camera_id, None)

        for camera_id, camera in desired.items():
            signature = self._signature(camera)

            if camera_id in self._workers:
                if self._signatures.get(camera_id) == signature:
                    continue
                # Sozlama o'zgargan (masalan yangi detektor yoqilgan) -
                # workerni qayta qurish kerak.
                log.info("Kamera sozlamasi o'zgardi, qayta ishga tushirilmoqda: %s", camera.name)
                self._workers.pop(camera_id).stop()

            worker = CameraWorker(
                camera,
                settings=self._settings,
                registry=self._registry,
                bus=self._bus,
                model_versions=self._model_versions,
            )
            worker.start()
            self._workers[camera_id] = worker
            self._signatures[camera_id] = signature

    def _signature(self, camera: CameraConfig) -> tuple:
        """Worker ni qayta qurish kerakligini aniqlaydigan barcha maydonlar."""
        return (
            camera.host,
            camera.rtsp_port,
            camera.channel,
            camera.username,
            camera.password,
            tuple(sorted(camera.enabled_detectors)),
            camera.analytics_fps,
            tuple(
                (zone.id, zone.kind, tuple(zone.polygon), tuple(sorted(zone.detectors)))
                for zone in sorted(camera.zones, key=lambda z: z.id)
            ),
        )

    def snapshot(self) -> dict:
        return {
            "device": self._registry.device,
            "modelErrors": self._registry.errors,
            "modelVersions": self._model_versions,
            "bus": self._bus.stats,
            "cameras": [
                {
                    "cameraId": camera_id,
                    "connected": worker.stats.connected,
                    "statusReason": worker.stats.status_reason,
                    "framesProcessed": worker.stats.frames_processed,
                    "eventsPublished": worker.stats.events_published,
                    "lastFrameAt": worker.stats.last_frame_at,
                    "inferenceMs": worker.stats.inference_ms,
                    "activeDetectors": worker.stats.active_detectors,
                    "disabledDetectors": worker.stats.disabled_detectors,
                }
                for camera_id, worker in self._workers.items()
            ],
        }
