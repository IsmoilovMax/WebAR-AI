"""go2rtc orqali hodisa atrofidagi qisqa klip kesish.

Klip asosiy (main) oqimdan olinadi - dashboard sub-stream ni ko'rsatadi,
lekin dalil sifatida yuqori sifatli kadr kerak.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import httpx

from .config import Settings

log = logging.getLogger(__name__)


def stream_name(camera_id: str, stream: str = "main") -> str:
    return f"cam_{camera_id.replace('-', '')}_{stream}"


async def capture_clip(
    settings: Settings,
    camera_id: str,
    *,
    duration: int | None = None,
) -> Path | None:
    """go2rtc /api/stream.mp4 dan qisqa MP4 yuklab oladi.

    go2rtc buferi cheklangan, shuning uchun pre-roll kafolatlanmaydi.
    Post-roll uchun duration yetarli bo'lishi kerak.
    """
    if not settings.clip_enabled:
        return None

    seconds = duration or (settings.clip_pre_seconds + settings.clip_post_seconds)
    name = stream_name(camera_id, "main")
    url = (
        f"{settings.go2rtc_url.rstrip('/')}/api/stream.mp4"
        f"?src={name}&duration={seconds}"
    )

    try:
        async with httpx.AsyncClient(timeout=seconds + 15) as client:
            response = await client.get(url)
            if response.status_code != 200:
                log.warning(
                    "Klip olinmadi (%s): HTTP %s", name, response.status_code
                )
                return None

            if len(response.content) < 1024:
                log.warning("Klip juda kichik: %s bayt", len(response.content))
                return None

            tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            tmp.write(response.content)
            tmp.close()
            return Path(tmp.name)
    except httpx.HTTPError:
        log.exception("Klip so'rovi muvaffaqiyatsiz: %s", name)
        return None
