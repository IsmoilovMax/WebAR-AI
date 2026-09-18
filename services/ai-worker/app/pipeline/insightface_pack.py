"""InsightFace buffalo_sc: RetinaFace deteksiya + ArcFace embedding.

LITSENZIYA: InsightFace paketlari odatda tijorat bo'lmagan tadqiqot uchun.
Sotiladigan mahsulotda alohida litsenziya yoki ochiq o'qitilgan model kerak.

MAXFIYLIK: embedding disk/DB ga yozilmaydi — faqat jarayon xotirasida
track qayta bog'lash (cosine >= threshold) uchun ishlatiladi.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..geometry import BBox, xyxy_to_norm
from .models import Detection

log = logging.getLogger(__name__)

DEFAULT_PACK = "buffalo_sc"
DEFAULT_MATCH_THRESHOLD = 0.42
DEFAULT_DET_SIZE = 640


@dataclass(slots=True)
class FaceHit:
    """Bitta yuz: box + ixtiyoriy ArcFace / genderage."""

    bbox: BBox
    confidence: float
    embedding: np.ndarray | None = None  # L2-norm 512-d
    gender: str | None = None  # male | female
    gender_confidence: float = 0.0
    age: float | None = None


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a is None or b is None:
        return 0.0
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-9:
        return 0.0
    return float(np.dot(a, b) / denom)


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-9:
        return vector.astype(np.float32)
    return (vector / norm).astype(np.float32)


class InsightFacePack:
    """buffalo_sc FaceAnalysis o'rami (RetinaFace + ArcFace + genderage)."""

    def __init__(
        self,
        *,
        pack: str = DEFAULT_PACK,
        root: Path | None = None,
        providers: list[str] | None = None,
        det_size: int = DEFAULT_DET_SIZE,
        match_threshold: float = DEFAULT_MATCH_THRESHOLD,
        min_det_score: float = 0.32,
    ) -> None:
        from insightface.app import FaceAnalysis

        self.pack = pack
        self.match_threshold = match_threshold
        self.min_det_score = min_det_score
        self._det_size = det_size
        self._lock = threading.Lock()

        kwargs: dict = {
            "name": pack,
            "providers": providers or ["CPUExecutionProvider"],
        }
        if root is not None:
            kwargs["root"] = str(root)

        self._app = FaceAnalysis(**kwargs)
        # ctx_id=-1: CPU; GPU bo'lsa 0.
        ctx_id = 0 if any("CUDA" in p for p in (providers or [])) else -1
        self._app.prepare(ctx_id=ctx_id, det_size=(det_size, det_size))
        log.info(
            "InsightFace yuklandi: %s (det=%s, match>=%.2f, providers=%s)",
            pack,
            det_size,
            match_threshold,
            providers or ["CPUExecutionProvider"],
        )

    def detect(self, frame_bgr: np.ndarray) -> list[FaceHit]:
        height, width = frame_bgr.shape[:2]
        with self._lock:
            faces = self._app.get(frame_bgr)

        hits: list[FaceHit] = []
        for face in faces:
            score = float(getattr(face, "det_score", 0.0) or 0.0)
            if score < self.min_det_score:
                continue

            x1, y1, x2, y2 = [float(v) for v in face.bbox]
            bbox = xyxy_to_norm((x1, y1, x2, y2), width, height)

            embedding = None
            raw_emb = getattr(face, "normed_embedding", None)
            if raw_emb is None:
                raw_emb = getattr(face, "embedding", None)
            if raw_emb is not None:
                embedding = l2_normalize(np.asarray(raw_emb, dtype=np.float32))

            gender = None
            gender_confidence = 0.0
            gender_value = getattr(face, "gender", None)
            if gender_value is not None:
                # InsightFace: 0 = female, 1 = male
                gender = "male" if int(gender_value) == 1 else "female"
                gender_confidence = min(0.92, 0.55 + score * 0.4)

            age = getattr(face, "age", None)
            age_f = float(age) if age is not None else None

            hits.append(
                FaceHit(
                    bbox=bbox,
                    confidence=score,
                    embedding=embedding,
                    gender=gender,
                    gender_confidence=round(gender_confidence, 3),
                    age=age_f,
                )
            )

        return hits

    def as_detections(self, hits: list[FaceHit]) -> list[Detection]:
        return [
            Detection(label="face", confidence=hit.confidence, bbox=hit.bbox)
            for hit in hits
        ]

    def best_match(
        self,
        embedding: np.ndarray,
        gallery: dict[int, np.ndarray],
    ) -> tuple[int | None, float]:
        """Gallery ichidan eng o'xshash track_id (cosine >= threshold)."""
        best_id: int | None = None
        best_score = 0.0
        for track_id, known in gallery.items():
            score = cosine_similarity(embedding, known)
            if score > best_score:
                best_score = score
                best_id = track_id
        if best_id is None or best_score < self.match_threshold:
            return None, best_score
        return best_id, best_score


_shared: InsightFacePack | None = None
_shared_lock = threading.Lock()
_shared_error: str | None = None


def get_insightface_pack(
    *,
    pack: str = DEFAULT_PACK,
    root: Path | None = None,
    device: str = "cpu",
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
    det_size: int = DEFAULT_DET_SIZE,
) -> InsightFacePack | None:
    """Jarayon bo'yicha bitta nusxa (modellarni qayta yuklamaslik)."""
    global _shared, _shared_error

    with _shared_lock:
        if _shared is not None:
            return _shared
        if _shared_error is not None:
            return None

        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if device == "cuda"
            else ["CPUExecutionProvider"]
        )
        try:
            _shared = InsightFacePack(
                pack=pack,
                root=root,
                providers=providers,
                det_size=det_size,
                match_threshold=match_threshold,
            )
            return _shared
        except Exception as exc:  # noqa: BLE001
            _shared_error = str(exc)
            log.exception("InsightFace %s yuklanmadi: %s", pack, exc)
            return None


def insightface_error() -> str | None:
    return _shared_error
