"""Konfiguratsiyani Postgres dan o'qish.

Worker bazaga faqat O'QISH uchun murojaat qiladi: kameralar, zonalar, faol
model versiyalari. Barcha yozish event-service orqali ketadi - shunda
inference quvuri baza sekinlashishidan ta'sirlanmaydi.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import asyncpg

from .crypto import decrypt

log = logging.getLogger(__name__)


@dataclass(slots=True)
class ZoneConfig:
    id: str
    name: str
    kind: str
    polygon: list[tuple[float, float]]
    detectors: list[str]


@dataclass(slots=True)
class CameraConfig:
    id: str
    org_id: str
    name: str
    host: str
    rtsp_port: int
    channel: int
    username: str
    password: str
    enabled_detectors: list[str]
    analytics_fps: float
    zones: list[ZoneConfig] = field(default_factory=list)

    def rtsp_url(self, *, go2rtc_url: str | None = None) -> str:
        """AI tahlil oqimi (ACS_AI_STREAM) — video (ACS_LIVE_STREAM) dan mustaqil.

        go2rtc_url berilsa — kameraga ikkinchi RTSP ochmasdan go2rtc relay
        ishlatiladi.
        """
        from .config import get_settings

        tier = get_settings().ai_stream
        if tier not in ("main", "sub"):
            tier = "sub"

        use_go2rtc = go2rtc_url and not get_settings().ai_direct_rtsp

        if use_go2rtc:
            from urllib.parse import urlparse

            parsed = urlparse(go2rtc_url)
            host = parsed.hostname or "go2rtc"
            stream = f"cam_{self.id.replace('-', '')}_{tier}"
            return f"rtsp://{host}:8554/{stream}"

        from urllib.parse import quote

        channel_id = self.channel * 100 + (1 if tier == "main" else 2)
        credentials = f"{quote(self.username, safe='')}:{quote(self.password, safe='')}"
        return (
            f"rtsp://{credentials}@{self.host}:{self.rtsp_port}"
            f"/Streaming/Channels/{channel_id}"
        )

    def redacted_rtsp_url(self, *, go2rtc_url: str | None = None) -> str:
        from .config import get_settings

        tier = get_settings().ai_stream
        if tier not in ("main", "sub"):
            tier = "sub"

        use_go2rtc = go2rtc_url and not get_settings().ai_direct_rtsp

        if use_go2rtc:
            from urllib.parse import urlparse

            parsed = urlparse(go2rtc_url)
            host = parsed.hostname or "go2rtc"
            stream = f"cam_{self.id.replace('-', '')}_{tier}"
            return f"rtsp://{host}:8554/{stream}"

        channel_id = self.channel * 100 + (1 if tier == "main" else 2)
        return (
            f"rtsp://{self.username}:***@{self.host}:{self.rtsp_port}"
            f"/Streaming/Channels/{channel_id}"
        )


CAMERA_QUERY = """
SELECT
  c.id::text,
  c.org_id::text,
  c.name,
  c.host,
  c.rtsp_port,
  c.channel,
  c.username,
  c.password_encrypted,
  c.enabled_detectors,
  c.analytics_fps,
  COALESCE(
    (
      SELECT json_agg(json_build_object(
        'id', z.id::text,
        'name', z.name,
        'kind', z.kind,
        'polygon', z.polygon,
        'detectors', z.detectors
      ))
      FROM detection_zones z
      WHERE z.camera_id = c.id
    ),
    '[]'::json
  ) AS zones
FROM cameras c
WHERE c.enabled
  AND ($1::uuid IS NULL OR c.edge_node_id = $1::uuid)
ORDER BY c.created_at
"""


class ConfigStore:
    def __init__(self, database_url: str, encryption_key: str) -> None:
        self._database_url = database_url
        self._encryption_key = encryption_key
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(
            self._database_url, min_size=1, max_size=4, command_timeout=10
        )

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()
            self._pool = None

    async def load_cameras(self, edge_node_id: str | None = None) -> list[CameraConfig]:
        if not self._pool:
            raise RuntimeError("ConfigStore ulanmagan")

        import json

        rows = await self._pool.fetch(CAMERA_QUERY, edge_node_id)
        cameras: list[CameraConfig] = []

        for row in rows:
            try:
                password = decrypt(row["password_encrypted"], self._encryption_key)
            except Exception:  # noqa: BLE001
                # Bitta kameraning kaliti buzilgan bo'lsa, qolganlari
                # ishlashda davom etishi kerak.
                log.exception("Kamera %s parolini ochib bo'lmadi, o'tkazib yuborildi", row["name"])
                continue

            raw_zones = row["zones"]
            zones_data: list[dict[str, Any]] = (
                json.loads(raw_zones) if isinstance(raw_zones, str) else (raw_zones or [])
            )

            zones = [
                ZoneConfig(
                    id=zone["id"],
                    name=zone["name"],
                    kind=zone["kind"],
                    polygon=[(float(p[0]), float(p[1])) for p in _as_list(zone["polygon"])],
                    detectors=list(zone.get("detectors") or []),
                )
                for zone in zones_data
            ]

            cameras.append(
                CameraConfig(
                    id=row["id"],
                    org_id=row["org_id"],
                    name=row["name"],
                    host=row["host"],
                    rtsp_port=row["rtsp_port"],
                    channel=row["channel"],
                    username=row["username"],
                    password=password,
                    enabled_detectors=list(row["enabled_detectors"]),
                    analytics_fps=float(row["analytics_fps"]),
                    zones=zones,
                )
            )

        return cameras

    async def load_active_models(self) -> dict[str, str]:
        """detector -> version. Eventga yoziladi, shunda har bir signalning
        qaysi model versiyasidan kelgani keyin ham ma'lum bo'ladi."""
        if not self._pool:
            raise RuntimeError("ConfigStore ulanmagan")

        rows = await self._pool.fetch(
            "SELECT detector, version FROM model_versions WHERE is_active"
        )
        return {row["detector"]: row["version"] for row in rows}


def _as_list(value: Any) -> list[Any]:
    import json

    if isinstance(value, str):
        return json.loads(value)
    return list(value or [])
