"""Active learning: training_feedback ni Roboflow ga yuklash.

Operator yoki worker belgilagan kadrlar fonda yuklanadi. Muvaffaqiyatli
yuklanganlar `upload_status = uploaded` bo'ladi; xatolar qayta urinish
uchun `failed` holatida qoladi.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import asyncpg
import httpx

from .config import Settings
from .storage import MediaStore

log = logging.getLogger(__name__)

# Detektor -> Roboflow loyiha slugi. Workspace sozlamada.
PROJECT_BY_DETECTOR = {
    "fire_smoke": "fire-smoke",
    "fall": "fall-pose",
    "smoking": "cigarette-smoking",
    "person": "person-attributes",
    "demographics": "person-attributes",
}


class RoboflowUploader:
    def __init__(
        self, pool: asyncpg.Pool, store: MediaStore, settings: Settings
    ) -> None:
        self._pool = pool
        self._store = store
        self._settings = settings

    @property
    def enabled(self) -> bool:
        return bool(self._settings.roboflow_api_key and self._settings.roboflow_workspace)

    async def flush_pending(self, limit: int = 20) -> int:
        if not self.enabled:
            return 0

        rows = await self._pool.fetch(
            """SELECT id, detector, label, snapshot_key, bbox, confidence
               FROM training_feedback
               WHERE upload_status = 'pending' AND snapshot_key IS NOT NULL
               ORDER BY created_at
               LIMIT $1""",
            limit,
        )

        uploaded = 0
        for row in rows:
            try:
                await self._upload_one(row)
                await self._pool.execute(
                    """UPDATE training_feedback
                       SET upload_status = 'uploaded', uploaded_at = now()
                       WHERE id = $1""",
                    row["id"],
                )
                uploaded += 1
            except Exception as exc:  # noqa: BLE001
                log.exception("Roboflow yuklash xatosi: %s", row["id"])
                await self._pool.execute(
                    """UPDATE training_feedback
                       SET upload_status = 'failed', upload_error = $2
                       WHERE id = $1""",
                    row["id"],
                    str(exc)[:500],
                )

        return uploaded

    async def _upload_one(self, row: asyncpg.Record) -> None:
        project = PROJECT_BY_DETECTOR.get(row["detector"])
        if not project:
            raise RuntimeError(f"Detektor uchun loyiha yo'q: {row['detector']}")

        data = await self._store.get_bytes(row["snapshot_key"])
        if not data:
            raise RuntimeError("Snapshot MinIO da topilmadi")

        # Roboflow upload API: workspace/project ga rasm yuborish.
        # Annotation keyinchalik operator yoki automatik label sifatida.
        url = (
            f"https://api.roboflow.com/dataset/{project}/upload"
            f"?api_key={self._settings.roboflow_api_key}"
            f"&name={row['id']}.jpg"
            f"&split=train"
        )

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                with tmp_path.open("rb") as handle:
                    response = await client.post(
                        url,
                        files={"file": ("sample.jpg", handle, "image/jpeg")},
                        data={
                            "tags": f"{row['label']},{row['detector']}",
                        },
                    )
                if response.status_code >= 400:
                    raise RuntimeError(
                        f"Roboflow HTTP {response.status_code}: {response.text[:300]}"
                    )
        finally:
            tmp_path.unlink(missing_ok=True)
