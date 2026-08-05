"""go2rtc oqimlarini ro'yxatdan o'tkazish.

go2rtc qayta ishga tushganda API orqali qo'shilgan oqimlar yo'qoladi.
AI worker ishga tushganda kameralarni qayta ro'yxatdan o'tkazadi — live video
va AI bir xil manbadan o'qiydi.
"""

from __future__ import annotations

import logging
from urllib.parse import quote, urlparse

import httpx

from .config import Settings
from .db import CameraConfig

log = logging.getLogger(__name__)


def _stream_name(camera_id: str, stream: str) -> str:
    return f"cam_{camera_id.replace('-', '')}_{stream}"


def _build_rtsp_url(camera: CameraConfig, stream: str) -> str:
    channel_id = camera.channel * 100 + (1 if stream == "main" else 2)
    credentials = f"{quote(camera.username, safe='')}:{quote(camera.password, safe='')}"
    return (
        f"rtsp://{credentials}@{camera.host}:{camera.rtsp_port}"
        f"/Streaming/Channels/{channel_id}"
    )


def _go2rtc_source(rtsp_url: str, stream: str) -> str:
    if stream == "main":
        return f"ffmpeg:{rtsp_url}#video=h264"
    return rtsp_url


async def ensure_streams(settings: Settings, cameras: list[CameraConfig]) -> None:
    base = settings.go2rtc_url.strip()
    if not base:
        return

    api = f"{base.rstrip('/')}/api/streams"

    async with httpx.AsyncClient(timeout=15.0) as client:
        for camera in cameras:
            for stream in ("sub", "main"):
                name = _stream_name(camera.id, stream)
                src = _go2rtc_source(_build_rtsp_url(camera, stream), stream)
                try:
                    response = await client.put(api, params={"name": name, "src": src})
                    if response.is_success:
                        log.info("go2rtc oqimi ro'yxatdan o'tdi: %s", name)
                    else:
                        log.warning(
                            "go2rtc oqimi xato (%s): %s %s",
                            name,
                            response.status_code,
                            response.text[:120],
                        )
                except httpx.HTTPError as exc:
                    log.warning("go2rtc ga ulanib bo'lmadi (%s): %s", name, exc)


def relay_rtsp_url(settings: Settings, camera_id: str, stream: str = "sub") -> str | None:
    """AI worker uchun go2rtc RTSP relay manzili."""
    base = settings.go2rtc_url.strip()
    if not base:
        return None

    parsed = urlparse(base)
    host = parsed.hostname or "go2rtc"
    name = _stream_name(camera_id, stream)
    return f"rtsp://{host}:8554/{name}"
