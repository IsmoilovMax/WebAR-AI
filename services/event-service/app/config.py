from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://acs:acs@localhost:5432/acs"
    redis_url: str = "redis://localhost:6379/0"

    event_stream_key: str = "acs:events"
    consumer_group: str = "event-service"
    consumer_name: str = "worker-1"

    s3_endpoint: str = "http://localhost:9000"
    s3_public_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "acs-minio"
    s3_secret_key: str = ""
    s3_bucket: str = "acs-media"
    s3_region: str = "us-east-1"

    credentials_encryption_key: str = ""

    telegram_bot_token: str = ""
    smtp_url: str = ""

    roboflow_api_key: str = ""
    roboflow_workspace: str = ""

    media_retention_days: int = 30
    event_retention_days: int = 180

    # Klip event tasdiqlangan paytdan oldin va keyin necha soniya olinadi.
    # Oldingi qism go2rtc buferidan olinadi, shuning uchun uzun bo'la olmaydi.
    clip_pre_seconds: int = 5
    clip_post_seconds: int = 10
    clip_enabled: bool = True

    go2rtc_url: str = "http://localhost:1984"


@lru_cache
def get_settings() -> Settings:
    return Settings()
