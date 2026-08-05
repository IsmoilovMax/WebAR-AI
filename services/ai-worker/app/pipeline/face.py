"""Yuz kropi va jins/yosh klassifikatori.

LITSENZIYA OGOHLANTIRISHI
-------------------------
InsightFace ning oldindan o'qitilgan model paketlari (buffalo_l va boshqalar)
FAQAT tijorat bo'lmagan tadqiqot uchun litsenziyalangan. Ularni sotiladigan
mahsulotda ishlatib bo'lmaydi.

Shuning uchun bu modul model faylini FORMAT bo'yicha yuklaydi, manba
bo'yicha emas: siz UTKFace / FairFace kabi ochiq litsenziyali datasetda o'z
modelingizni o'qitib, uni genderage.onnx sifatida qo'yasiz. Kutilayotgan
chiqish shakli quyida hujjatlashtirilgan.

MAXFIYLIK
---------
Bu modul yuz tasvirini ham, yuz embeddingini ham QAYTARMAYDI va saqlamaydi.
Faqat jins va yosh guruhi chiqadi. Embedding saqlansa, tizim biometrik
identifikatsiya tizimiga aylanadi va butunlay boshqa huquqiy rejimga tushadi.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

# Yuz kropi shu o'lchamga keltiriladi. 224x224 tanlangani bejiz emas:
# o'lchov tadqiqotlari aynan shu rezolyutsiyada eng past xatolikni
# ko'rsatadi; 112x112 da xato ~15% ortadi, 512+ da ham yomonlashadi.
INPUT_SIZE = 224

# Yuz shundan kichik bo'lsa, natija shovqindan iborat bo'ladi. Uzoqdagi
# odamlar uchun demografiya umuman hisoblanmaydi - noto'g'ri raqam
# bermaslik hech qanday raqam bermaslikdan yomonroq.
MIN_FACE_PIXELS = 60


@dataclass(slots=True)
class GenderAgePrediction:
    gender: str  # "male" | "female"
    gender_confidence: float
    age: float
    age_confidence: float


class GenderAgeClassifier:
    """ONNX modeli uchun o'ram.

    Kutilayotgan model shartnomasi:
      kirish:  (1, 3, 224, 224) float32, RGB, [0, 1] ga normallashtirilgan
      chiqish: (1, 3) float32 -> [female_logit, male_logit, age_normalized]
               age_normalized 0..1, 100 ga ko'paytiriladi.

    Boshqa shakl ishlatilsa, _postprocess ni moslashtiring.
    """

    def __init__(self, path: Path, *, providers: list[str] | None = None) -> None:
        import onnxruntime as ort

        self._session = ort.InferenceSession(
            str(path),
            providers=providers or ["CPUExecutionProvider"],
        )
        input_shape = self._session.get_inputs()[0].shape
        self._input_name = self._session.get_inputs()[0].name
        self._input_size = int(input_shape[2]) if len(input_shape) >= 4 else INPUT_SIZE
        output_size = int(np.prod(self._session.get_outputs()[0].shape))
        # InsightFace buffalo_l: kirish 96×96, chiqish [female_logit, male_logit, age_norm].
        if self._input_size == 96 and output_size == 3:
            self._format = "insightface_v3"
        elif output_size == 2:
            self._format = "insightface"
        else:
            self._format = "custom"
        self._lock = threading.Lock()
        log.info(
            "Jins/yosh modeli yuklandi: %s (%s, %spx)",
            path.name,
            self._format,
            self._input_size,
        )

    def predict(self, face_bgr: np.ndarray) -> GenderAgePrediction | None:
        import cv2

        height, width = face_bgr.shape[:2]
        if min(height, width) < MIN_FACE_PIXELS:
            return None

        size = self._input_size

        # InsightFace genderage 0..255 piksellarni kutadi (/255 noto'g'ri — jins almashtiriladi).
        if self._format in ("insightface_v3", "insightface"):
            resized = cv2.resize(face_bgr, (size, size), interpolation=cv2.INTER_LINEAR)
            tensor = cv2.dnn.blobFromImage(
                resized,
                scalefactor=1.0,
                size=(size, size),
                mean=(0.0, 0.0, 0.0),
                swapRB=True,
            )
        else:
            resized = cv2.resize(face_bgr, (size, size), interpolation=cv2.INTER_LINEAR)
            rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            tensor = np.transpose(rgb, (2, 0, 1))[np.newaxis, ...]

        with self._lock:
            outputs = self._session.run(None, {self._input_name: tensor})

        return self._postprocess(outputs)

    def _postprocess(self, outputs: list[np.ndarray]) -> GenderAgePrediction | None:
        raw = np.asarray(outputs[0]).reshape(-1)

        if self._format == "insightface_v3" and raw.size >= 3:
            logits = raw[:2].astype(np.float64)
            exponent = np.exp(logits - logits.max())
            probabilities = exponent / exponent.sum()
            female_prob, male_prob = float(probabilities[0]), float(probabilities[1])
            gender = "male" if male_prob >= female_prob else "female"
            gender_confidence = max(male_prob, female_prob)
            age = float(raw[2]) * 100.0
            return GenderAgePrediction(
                gender=gender,
                gender_confidence=round(gender_confidence, 3),
                age=age,
                age_confidence=round(self._age_bucket_margin(age), 3),
            )

        if self._format == "insightface" and raw.size >= 2:
            age = float(raw[0]) * 100.0
            gender_score = float(raw[1])
            gender = "male" if gender_score >= 0.5 else "female"
            gender_confidence = gender_score if gender == "male" else 1.0 - gender_score
            return GenderAgePrediction(
                gender=gender,
                gender_confidence=round(gender_confidence, 3),
                age=age,
                age_confidence=round(self._age_bucket_margin(age), 3),
            )

        if raw.size < 3:
            return None

        logits = raw[:2]
        exponent = np.exp(logits - logits.max())
        probabilities = exponent / exponent.sum()

        female, male = float(probabilities[0]), float(probabilities[1])
        gender = "male" if male >= female else "female"
        gender_confidence = max(male, female)

        age = float(raw[2]) * 100.0

        # Yosh uchun model ishonch bermaydi, shuning uchun uni bilvosita
        # baholaymiz: chegaralarga yaqin yosh (masalan 25 yoki 50) guruh
        # jihatidan ikkilanishli, o'rtadagi esa ishonchliroq.
        age_confidence = self._age_bucket_margin(age)

        return GenderAgePrediction(
            gender=gender,
            gender_confidence=round(gender_confidence, 3),
            age=age,
            age_confidence=round(age_confidence, 3),
        )

    def _age_bucket_margin(self, age: float) -> float:
        boundaries = (25.0, 50.0)
        nearest = min(abs(age - boundary) for boundary in boundaries)
        # 10 yildan uzoq bo'lsa to'liq ishonch, chegarada esa 0.3 gacha tushadi.
        return float(np.clip(0.3 + 0.7 * min(nearest, 10.0) / 10.0, 0.3, 1.0))


def crop_face(frame: np.ndarray, bbox: tuple[float, float, float, float], margin: float = 0.2):
    """Normallashtirilgan bbox bo'yicha yuzni kesadi.

    Chegara atrofida bo'sh joy qoldiriladi: klassifikatorlar odatda soch
    chizig'i va iyakni ham ko'rishga o'rgatilgan.
    """
    height, width = frame.shape[:2]
    x, y, w, h = bbox

    pad_x = w * margin
    pad_y = h * margin

    x1 = max(0, int((x - pad_x) * width))
    y1 = max(0, int((y - pad_y) * height))
    x2 = min(width, int((x + w + pad_x) * width))
    y2 = min(height, int((y + h + pad_y) * height))

    if x2 <= x1 or y2 <= y1:
        return None

    return frame[y1:y2, x1:x2]
