"""Postgres yozuvlari."""

from __future__ import annotations

import json
import logging
from typing import Any

import asyncpg

log = logging.getLogger(__name__)

INSERT_EVENT = """
INSERT INTO events (
  org_id, camera_id, zone_id, type, severity, event_key,
  started_at, confirmed_at, confidence, track_id, bbox,
  attributes, model_versions, meta, snapshot_key
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
ON CONFLICT (event_key, confirmed_at) DO NOTHING
RETURNING id::text
"""

UPSERT_SIGHTING = """
INSERT INTO person_sightings (
  org_id, camera_id, track_id, first_seen_at, last_seen_at, dwell_seconds,
  gender, gender_confidence, age_bucket, age_confidence, samples
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (camera_id, track_id, last_seen_at) DO NOTHING
"""

INSERT_TRAINING = """
INSERT INTO training_feedback (
  org_id, camera_id, event_type, detector, label, confidence,
  snapshot_key, bbox, model_version
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
"""


class Database:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(self._dsn, min_size=2, max_size=8)

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("Baza ulanmagan")
        return self._pool

    async def insert_event(self, payload: dict[str, Any], snapshot_key: str | None) -> str | None:
        """Event ID qaytaradi, dublikat bo'lsa None.

        Idempotentlik event_key orqali: worker qayta ishga tushsa yoki
        Redis xabarni ikki marta yetkazsa, ikkinchi yozuv jimgina
        e'tiborsiz qoldiriladi.
        """
        row = await self.pool.fetchrow(
            INSERT_EVENT,
            payload["orgId"],
            payload["cameraId"],
            payload.get("zoneId"),
            payload["type"],
            payload["severity"],
            payload["eventKey"],
            payload["startedAt"],
            payload["confirmedAt"],
            payload["confidence"],
            payload.get("trackId"),
            list(payload["bbox"]) if payload.get("bbox") else None,
            json.dumps(payload["attributes"]) if payload.get("attributes") else None,
            json.dumps(payload.get("modelVersions") or {}),
            json.dumps(payload.get("meta") or {}),
            snapshot_key,
        )
        return row["id"] if row else None

    async def attach_clip(self, event_id: str, clip_key: str) -> None:
        await self.pool.execute(
            "UPDATE events SET clip_key = $2 WHERE id = $1",
            event_id,
            clip_key,
        )

    async def insert_sighting(self, payload: dict[str, Any]) -> None:
        attributes = payload["attributes"]
        await self.pool.execute(
            UPSERT_SIGHTING,
            payload["orgId"],
            payload["cameraId"],
            payload["trackId"],
            payload["firstSeenAt"],
            payload["lastSeenAt"],
            payload["dwellSeconds"],
            attributes["gender"],
            attributes["genderConfidence"],
            attributes["ageBucket"],
            attributes["ageConfidence"],
            attributes["samples"],
        )

    async def insert_training_sample(
        self, payload: dict[str, Any], snapshot_key: str
    ) -> None:
        await self.pool.execute(
            INSERT_TRAINING,
            payload["orgId"],
            payload["cameraId"],
            payload["eventType"],
            payload["detector"],
            payload["label"],
            payload.get("confidence"),
            snapshot_key,
            list(payload["bbox"]) if payload.get("bbox") else None,
            payload.get("modelVersion"),
        )

    async def touch_camera(self, camera_id: str, status: str, reason: str | None) -> None:
        await self.pool.execute(
            """UPDATE cameras
               SET status = $2, status_reason = $3, last_seen_at = now()
               WHERE id = $1""",
            camera_id,
            status,
            reason,
        )

    async def camera_rtsp_parts(self, camera_id: str) -> asyncpg.Record | None:
        return await self.pool.fetchrow(
            """SELECT host, rtsp_port, channel, username, password_encrypted, name
               FROM cameras WHERE id = $1""",
            camera_id,
        )
