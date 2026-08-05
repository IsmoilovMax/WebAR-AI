"""Media retention: eski snapshot va kliplarni MinIO dan o'chirish.

TimescaleDB eventlarni o'zi siqadi/o'chiradi (migratsiya 0003). Bu yerda
faqat obyekt ombori tozalanadi - aks holda disk to'lib ketadi.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import asyncpg

from .config import Settings
from .storage import MediaStore

log = logging.getLogger(__name__)


async def purge_expired_media(
    pool: asyncpg.Pool, store: MediaStore, settings: Settings
) -> int:
    cutoff = datetime.now(tz=UTC) - timedelta(days=settings.media_retention_days)

    rows = await pool.fetch(
        """SELECT id, snapshot_key, clip_key
           FROM events
           WHERE confirmed_at < $1
             AND (snapshot_key IS NOT NULL OR clip_key IS NOT NULL)
           LIMIT 500""",
        cutoff,
    )

    if not rows:
        return 0

    keys: list[str] = []
    ids: list[str] = []
    for row in rows:
        ids.append(str(row["id"]))
        if row["snapshot_key"]:
            keys.append(row["snapshot_key"])
        if row["clip_key"]:
            keys.append(row["clip_key"])

    deleted = await store.delete_many(keys)

    await pool.execute(
        """UPDATE events
           SET snapshot_key = NULL, clip_key = NULL
           WHERE id = ANY($1::uuid[])""",
        ids,
    )

    # Training feedback dagi eskirgan snapshotlarni ham tozalash.
    feedback = await pool.fetch(
        """SELECT id, snapshot_key FROM training_feedback
           WHERE created_at < $1 AND snapshot_key IS NOT NULL
             AND upload_status IN ('uploaded', 'failed', 'skipped')
           LIMIT 200""",
        cutoff,
    )
    if feedback:
        fb_keys = [r["snapshot_key"] for r in feedback if r["snapshot_key"]]
        deleted += await store.delete_many(fb_keys)
        await pool.execute(
            """UPDATE training_feedback SET snapshot_key = NULL
               WHERE id = ANY($1::uuid[])""",
            [str(r["id"]) for r in feedback],
        )

    log.info("Retention: %s obyekt o'chirildi (cutoff=%s)", deleted, cutoff.date())
    return deleted
