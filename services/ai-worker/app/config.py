from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    database_url: str = "postgresql://acs:acs@localhost:5432/acs"
    redis_url: str = "redis://localhost:6379/0"

    event_stream_key: str = "acs:events"
    # Redis xotirasi cheklangan va eventlar snapshot (base64 JPEG) olib yuradi.
    # event-service pastga tushsa, stream cheksiz o'smasligi kerak.
    event_stream_maxlen: int = 10_000

    ai_worker_token: str = ""
    credentials_encryption_key: str = ""

    models_dir: Path = Path("models")

    # Bo'sh emas bo'lsa AI go2rtc RTSP relay orqali o'qiydi (bitta kamera ulanishi).
    go2rtc_url: str = ""

    # Brauzer jonli videosi (ACS_LIVE_STREAM) — odatda main.
    live_stream: str = Field(default="main", validation_alias="ACS_LIVE_STREAM")

    # AI tahlil oqimi — sub tezroq va 640×360 da aniqlash yaxshiroq (CPU).
    ai_stream: str = Field(default="sub", validation_alias="ACS_AI_STREAM")

    # True bo'lsa AI kameradan to'g'ridan-to'g'ri RTSP oladi (go2rtc relay emas).
    ai_direct_rtsp: bool = Field(default=True, validation_alias="ACS_AI_DIRECT_RTSP")

    # "cuda", "cpu", yoki "auto". Auto: CUDA bor bo'lsa ishlatadi.
    device: str = "auto"
    # FP16 GPU da tezlikni ~2x oshiradi, aniqlikka ta'siri sezilmas.
    half_precision: bool = True

    # Inference kirish o'lchami. Kichraytirilsa tez, ammo kichik obyektlar
    # (sigaret) yo'qoladi.
    detector_imgsz: int = 640

    person_confidence: float = 0.3
    fire_confidence: float = 0.45
    smoking_confidence: float = 0.35
    pose_confidence: float = 0.4
    face_confidence: float = 0.25

    # Bitta workerda nechta kamera. Bundan ko'p bo'lsa kadr navbati o'sadi.
    max_cameras: int = 12

    # Kamera qayta ulanish orasidagi kutish (soniya), eksponensial o'sadi.
    reconnect_base_delay: float = 2.0
    reconnect_max_delay: float = 60.0

    # Snapshot JPEG sifati. 75 - hajm va detal o'rtasida yaxshi muvozanat.
    snapshot_jpeg_quality: int = 75

    # Model ishonchi shu oraliqqa tushsa, kadr active learning uchun
    # belgilanadi: model ikkilanayotgan holatlar eng qimmatli o'quv namunasi.
    uncertainty_band: tuple[float, float] = (0.35, 0.6)
    uncertainty_sample_rate: float = 0.02

    # Live overlay (video ustidagi box) Redis ga shu chastotada yoziladi.
    # 5 Hz: brauzer silliq ko'radi, tarmoqni ortiqcha yuklamaydi.
    overlay_hz: float = 10.0
    overlay_channel_prefix: str = "acs:overlay:"


@lru_cache
def get_settings() -> Settings:
    return Settings()
