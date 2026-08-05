"""Event service kirish nuqtasi.

Vazifalar:
  1. Redis Streams dan AI eventlarni o'qish
  2. Snapshot/klipni MinIO ga yuklash
  3. Postgres ga yozish
  4. Alert qoidalarini bajarish (Telegram / webhook / email)
  5. Active learning namunalarini Roboflow ga yuklash
  6. Media retention
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .alerts import AlertDispatcher
from .config import get_settings
from .consumer import StreamConsumer
from .db import Database
from .retention import purge_expired_media
from .roboflow import RoboflowUploader
from .storage import MediaStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("event-service")


class AppState:
    def __init__(self) -> None:
        self.db: Database | None = None
        self.store: MediaStore | None = None
        self.consumer: StreamConsumer | None = None
        self.uploader: RoboflowUploader | None = None
        self.tasks: list[asyncio.Task[None]] = []


state = AppState()


async def _background_jobs() -> None:
    """Har 5 daqiqada Roboflow flush + retention."""
    assert state.db and state.store and state.uploader
    settings = get_settings()

    while True:
        try:
            uploaded = await state.uploader.flush_pending()
            if uploaded:
                log.info("Roboflow: %s namuna yuklandi", uploaded)
            deleted = await purge_expired_media(state.db.pool, state.store, settings)
            if deleted:
                log.info("Retention: %s media o'chirildi", deleted)
        except Exception:  # noqa: BLE001
            log.exception("Fon vazifa xatosi")
        await asyncio.sleep(300)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    db = Database(settings.database_url)
    await db.connect()

    store = MediaStore(settings)
    await store.ensure_bucket()

    alerts = AlertDispatcher(db.pool, settings)
    consumer = StreamConsumer(settings, db, store, alerts)
    uploader = RoboflowUploader(db.pool, store, settings)

    state.db = db
    state.store = store
    state.consumer = consumer
    state.uploader = uploader

    state.tasks = [
        asyncio.create_task(consumer.run(), name="stream-consumer"),
        asyncio.create_task(_background_jobs(), name="background-jobs"),
    ]

    log.info("Event service ishga tushdi")
    yield

    for task in state.tasks:
        task.cancel()
    await asyncio.gather(*state.tasks, return_exceptions=True)
    await consumer.close()
    await db.close()
    log.info("Event service to'xtatildi")


app = FastAPI(title="ACS Event Service", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/status")
async def status() -> dict[str, object]:
    settings = get_settings()
    return {
        "roboflowEnabled": bool(
            settings.roboflow_api_key and settings.roboflow_workspace
        ),
        "telegramConfigured": bool(settings.telegram_bot_token),
        "clipEnabled": settings.clip_enabled,
        "mediaRetentionDays": settings.media_retention_days,
    }
