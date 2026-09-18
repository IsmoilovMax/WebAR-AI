"""Bir xil yuzni kuniga bir marta hodisa qilish (ArcFace cosine).

Embedding faqat Redis da kunlik TTL bilan saqlanadi — doimiy biometrik
arxiv yaratilmaydi. Kun tugagach kalit o'chadi.
"""

from __future__ import annotations

import base64
import logging
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import redis

from .insightface_pack import cosine_similarity, l2_normalize

log = logging.getLogger(__name__)


class DailyFaceDedupe:
    def __init__(
        self,
        redis_url: str,
        *,
        match_threshold: float = 0.42,
        timezone: str = "Asia/Seoul",
        key_prefix: str = "acs:face-day:",
    ) -> None:
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)
        self._threshold = match_threshold
        self._tz = ZoneInfo(timezone)
        self._prefix = key_prefix
        self._lock = threading.Lock()
        self._cache: dict[str, list[np.ndarray]] = {}

    def already_seen(self, org_id: str, embedding: np.ndarray | None) -> bool:
        if embedding is None:
            return False

        key = self._day_key(org_id)
        with self._lock:
            known = self._ensure_loaded(key)
            for prior in known:
                if cosine_similarity(embedding, prior) >= self._threshold:
                    return True
        return False

    def mark_seen(self, org_id: str, embedding: np.ndarray | None) -> None:
        if embedding is None:
            return

        key = self._day_key(org_id)
        vector = l2_normalize(np.asarray(embedding, dtype=np.float32))
        payload = base64.b64encode(vector.tobytes()).decode("ascii")

        with self._lock:
            known = self._ensure_loaded(key)
            for prior in known:
                if cosine_similarity(vector, prior) >= self._threshold:
                    return
            known.append(vector)

        try:
            pipe = self._client.pipeline()
            pipe.rpush(key, payload)
            pipe.expireat(key, self._expire_at())
            pipe.execute()
        except redis.RedisError:
            log.exception("Kunlik yuz dedupe yozilmadi")

    def _day_key(self, org_id: str) -> str:
        day = datetime.now(tz=self._tz).date().isoformat()
        return f"{self._prefix}{org_id}:{day}"

    def _expire_at(self) -> int:
        now = datetime.now(tz=self._tz)
        tomorrow = (now + timedelta(days=1)).replace(
            hour=0, minute=5, second=0, microsecond=0
        )
        return int(tomorrow.timestamp())

    def _ensure_loaded(self, key: str) -> list[np.ndarray]:
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        vectors: list[np.ndarray] = []
        try:
            raw_items = self._client.lrange(key, 0, -1) or []
            for item in raw_items:
                try:
                    raw = base64.b64decode(item)
                    vectors.append(l2_normalize(np.frombuffer(raw, dtype=np.float32).copy()))
                except Exception:  # noqa: BLE001
                    continue
        except redis.RedisError:
            log.exception("Kunlik yuz dedupe o'qilmadi")

        self._cache[key] = vectors
        # Eski kun keshini tozalash.
        if len(self._cache) > 8:
            for old in list(self._cache)[:-4]:
                self._cache.pop(old, None)
        return vectors

    def close(self) -> None:
        self._client.close()
