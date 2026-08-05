"""AI worker boshqaruv API si.

Bu servis inference ni bajaradi; web ilova unga faqat holat so'rovi va
qo'lda yangilash uchun murojaat qiladi. Hech qanday video brauzerga bu
yerdan ketmaydi - buning uchun go2rtc bor.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status

from .config import get_settings
from .pipeline.supervisor import Supervisor

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)

log = logging.getLogger(__name__)

supervisor: Supervisor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global supervisor
    settings = get_settings()

    supervisor = Supervisor(settings, edge_node_id=os.getenv("EDGE_NODE_ID") or None)
    await supervisor.start()
    log.info("AI worker tayyor (%s)", supervisor.registry.device)

    try:
        yield
    finally:
        await supervisor.stop()
        supervisor = None


app = FastAPI(title="ACS AI Worker", version="0.1.0", lifespan=lifespan)


async def require_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = get_settings().ai_worker_token
    if not expected:
        # Token sozlanmagan bo'lsa himoya yo'q. Bu faqat lokal ishlab
        # chiqishda qabul qilinadi, shuning uchun ogohlantirish beriladi.
        log.warning("AI_WORKER_TOKEN o'rnatilmagan - API himoyalanmagan")
        return

    if authorization != f"Bearer {expected}":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token noto'g'ri"
        )


def _require_supervisor() -> Supervisor:
    if supervisor is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supervisor hali ishga tushmagan",
        )
    return supervisor


@app.get("/health")
async def health() -> dict:
    """Kubernetes/Docker healthcheck uchun. Token talab qilmaydi.

    Modellar yetishmasa ham "ok" qaytaradi: bu servis nosozligi emas,
    konfiguratsiya holati. Batafsil ma'lumot /status da.
    """
    if supervisor is None:
        return {"status": "starting"}

    return {
        "status": "ok",
        "redis": supervisor.bus.ping(),
        "device": supervisor.registry.device,
        "modelsMissing": list(supervisor.registry.errors),
    }


@app.get("/status", dependencies=[Depends(require_token)])
async def get_status() -> dict:
    return _require_supervisor().snapshot()


@app.post("/reload", dependencies=[Depends(require_token)], status_code=status.HTTP_202_ACCEPTED)
async def reload_config() -> dict:
    """Kamera yoki zona o'zgarganda web ilova shu endpointni chaqiradi.

    Chaqirilmasa ham 30 soniyada avtomatik yangilanadi, ammo darhol
    chaqirish foydalanuvchiga tezroq javob beradi.
    """
    await _require_supervisor().reload()
    return {"reloaded": True}


@app.get("/overlay/{camera_id}", dependencies=[Depends(require_token)])
async def get_overlay(camera_id: str) -> dict:
    """So'nggi jonli box lar (odam, olov, ...). Brauzer polling / SSE uchun."""
    import json

    raw = _require_supervisor().bus.latest_overlay(camera_id)
    if not raw:
        return {"cameraId": camera_id, "ts": 0, "boxes": []}
    return json.loads(raw)
