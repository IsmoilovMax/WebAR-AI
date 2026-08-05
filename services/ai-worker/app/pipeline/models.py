"""Model yuklash va inference o'ramlari.

Loyihaning eng nozik joyi shu: modellar og'ir, ular bir marta yuklanadi va
barcha kameralar o'rtasida bo'lishiladi. Model fayli topilmasa, servis
ishdan chiqmasligi kerak - shunchaki o'sha detektor o'chirilgan bo'lib
qoladi va bu holat /health da ko'rinadi.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from ..config import Settings
from ..geometry import BBox, xyxy_to_norm

log = logging.getLogger(__name__)


@dataclass(slots=True)
class Detection:
    label: str
    confidence: float
    bbox: BBox
    track_id: int | None = None


@dataclass(slots=True)
class PoseResult:
    bbox: BBox
    # COCO 17 nuqta: (x, y, ishonch), normallashtirilgan.
    keypoints: np.ndarray
    confidence: float
    track_id: int | None = None


def resolve_device(setting: str) -> str:
    if setting != "auto":
        return setting
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


class YoloModel:
    """Ultralytics YOLO o'rami.

    Ultralytics .pt, .onnx va .engine formatlarini bir xil API bilan
    yuklaydi, shuning uchun TensorRT ga o'tishda kod o'zgarmaydi -
    faqat fayl kengaytmasi boshqacha bo'ladi.
    """

    def __init__(
        self,
        path: Path,
        *,
        device: str,
        imgsz: int,
        half: bool,
        name: str,
    ) -> None:
        from ultralytics import YOLO

        self.name = name
        self.path = path
        self._device = device
        self._imgsz = imgsz
        # FP16 faqat GPU da mantiqiy; CPU da u sekinlashtiradi.
        self._half = half and device != "cpu"
        self._model = YOLO(str(path))
        # Ultralytics modeli thread-safe emas. Bir nechta kamera threadi
        # bitta modelga murojaat qilgani uchun qulf shart.
        self._lock = threading.Lock()

    def predict(
        self,
        image: np.ndarray,
        *,
        confidence: float,
        classes: Sequence[int] | None = None,
    ) -> list[Detection]:
        with self._lock:
            results = self._model.predict(
                image,
                imgsz=self._imgsz,
                conf=confidence,
                device=self._device,
                half=self._half,
                classes=list(classes) if classes else None,
                verbose=False,
            )
        return self._parse(results, image.shape[1], image.shape[0])

    def track(
        self,
        image: np.ndarray,
        *,
        confidence: float,
        classes: Sequence[int] | None = None,
        tracker: str = "bytetrack.yaml",
        persist: bool = True,
    ) -> list[Detection]:
        """Aniqlash + ByteTrack bir chaqiruvda.

        Tracker holati model obyektida saqlanadi, shuning uchun har bir
        kamera uchun ALOHIDA model nusxasi kerak - aks holda kameralar
        bir-birining track_id larini buzadi.
        """
        with self._lock:
            results = self._model.track(
                image,
                imgsz=self._imgsz,
                conf=confidence,
                device=self._device,
                half=self._half,
                classes=list(classes) if classes else None,
                tracker=tracker,
                persist=persist,
                verbose=False,
            )
        return self._parse(results, image.shape[1], image.shape[0])

    def _parse(self, results: Any, width: int, height: int) -> list[Detection]:
        detections: list[Detection] = []
        if not results:
            return detections

        result = results[0]
        boxes = getattr(result, "boxes", None)
        if boxes is None or len(boxes) == 0:
            return detections

        names = result.names
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        classes = boxes.cls.cpu().numpy().astype(int)
        ids = boxes.id.cpu().numpy().astype(int) if boxes.id is not None else None

        for i in range(len(xyxy)):
            detections.append(
                Detection(
                    label=str(names.get(int(classes[i]), classes[i])),
                    confidence=float(confs[i]),
                    bbox=xyxy_to_norm(xyxy[i], width, height),
                    track_id=int(ids[i]) if ids is not None else None,
                )
            )

        return detections

    def predict_pose(
        self, image: np.ndarray, *, confidence: float, persist: bool = True
    ) -> list[PoseResult]:
        with self._lock:
            results = self._model.track(
                image,
                imgsz=self._imgsz,
                conf=confidence,
                device=self._device,
                half=self._half,
                tracker="bytetrack.yaml",
                persist=persist,
                verbose=False,
            )

        poses: list[PoseResult] = []
        if not results:
            return poses

        result = results[0]
        keypoints = getattr(result, "keypoints", None)
        boxes = getattr(result, "boxes", None)
        if keypoints is None or boxes is None or len(boxes) == 0:
            return poses

        height, width = image.shape[:2]
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        ids = boxes.id.cpu().numpy().astype(int) if boxes.id is not None else None
        kpts = keypoints.data.cpu().numpy()  # (N, 17, 3)

        for i in range(len(xyxy)):
            normalized = kpts[i].copy()
            normalized[:, 0] /= width
            normalized[:, 1] /= height
            poses.append(
                PoseResult(
                    bbox=xyxy_to_norm(xyxy[i], width, height),
                    keypoints=normalized,
                    confidence=float(confs[i]),
                    track_id=int(ids[i]) if ids is not None else None,
                )
            )

        return poses


class ModelRegistry:
    """Model fayllarini topadi va yuklaydi.

    Kutilayotgan fayl nomlari (models/ ichida):

      person.pt           - COCO pretrained YOLO (o'qitish shart emas)
      pose.pt             - YOLO11-pose
      fire_smoke.pt       - Roboflow da o'qitilgan yong'in/tutun modeli
      cigarette.pt        - Roboflow da o'qitilgan sigaret modeli
      face.pt             - yuz detektori (demografiya uchun)
      genderage.onnx      - jins va yosh klassifikatori

    Fayl yo'q bo'lsa, tegishli detektor o'chiriladi va sabab /health da
    ko'rsatiladi. Bu ataylab: mijozda hali sigaret modeli bo'lmasligi mumkin,
    ammo yong'in detektori ishlashi kerak.
    """

    FILENAMES = {
        "person": "person.pt",
        "pose": "pose.pt",
        "fire_smoke": "fire_smoke.pt",
        "cigarette": "cigarette.pt",
        "face": "face.pt",
    }

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._device = resolve_device(settings.device)
        self._cache: dict[str, YoloModel] = {}
        self._errors: dict[str, str] = {}
        self._lock = threading.Lock()

    @property
    def device(self) -> str:
        return self._device

    @property
    def errors(self) -> dict[str, str]:
        return dict(self._errors)

    def path_for(self, key: str) -> Path:
        return self._settings.models_dir / self.FILENAMES[key]

    def available(self, key: str) -> bool:
        return key in self.FILENAMES and self.path_for(key).exists()

    def load(self, key: str, *, per_camera: bool = False, camera_id: str = "") -> YoloModel | None:
        """per_camera=True bo'lsa har bir kamera uchun alohida nusxa yuklanadi.

        Bu tracker holati uchun zarur: ByteTrack model obyektida saqlanadi.
        Xotira sarfi ortadi (~50-200MB har biriga), shuning uchun faqat
        tracking kerak bo'lgan modellar uchun ishlatiladi.
        """
        cache_key = f"{key}:{camera_id}" if per_camera else key

        with self._lock:
            if cache_key in self._cache:
                return self._cache[cache_key]

            path = self.path_for(key) if key in self.FILENAMES else None
            if path is None or not path.exists():
                message = f"Model fayli topilmadi: {path}"
                self._errors[key] = message
                log.warning("%s (detektor o'chirildi)", message)
                return None

            try:
                model = YoloModel(
                    path,
                    device=self._device,
                    imgsz=self._settings.detector_imgsz,
                    half=self._settings.half_precision,
                    name=key,
                )
            except Exception as exc:  # noqa: BLE001
                self._errors[key] = str(exc)
                log.exception("Model yuklanmadi: %s", key)
                return None

            self._errors.pop(key, None)
            self._cache[cache_key] = model
            log.info("Model yuklandi: %s (%s) -> %s", key, path.name, self._device)
            return model

    def unload_camera(self, camera_id: str) -> None:
        with self._lock:
            for cache_key in [k for k in self._cache if k.endswith(f":{camera_id}")]:
                self._cache.pop(cache_key, None)
