"""MinIO / S3 ga media yuklash.

boto3 sinxron kutubxona, shuning uchun barcha chaqiruvlar threadpool da
bajariladi - aks holda ular event loop ni bloklaydi va event qayta ishlash
sekinlashadi.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from datetime import UTC, datetime
from functools import partial

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import Settings

log = logging.getLogger(__name__)


class MediaStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
                # MinIO path-style manzillashni talab qiladi.
                s3={"addressing_style": "path"},
            ),
        )

    async def ensure_bucket(self) -> None:
        await asyncio.to_thread(self._ensure_bucket_sync)

    def _ensure_bucket_sync(self) -> None:
        bucket = self._settings.s3_bucket
        try:
            self._client.head_bucket(Bucket=bucket)
            return
        except ClientError as error:
            if error.response["Error"]["Code"] not in {"404", "NoSuchBucket", "403"}:
                raise

        try:
            self._client.create_bucket(Bucket=bucket)
            log.info("Bucket yaratildi: %s", bucket)
        except ClientError as error:
            if error.response["Error"]["Code"] != "BucketAlreadyOwnedByYou":
                raise

    @staticmethod
    def build_key(camera_id: str, event_id: str, kind: str, extension: str) -> str:
        """Kalit sanaga bo'linadi.

        Bu retention ni soddalashtiradi (butun prefiksni o'chirish mumkin)
        va bitta katalogda millionlab obyekt to'planishining oldini oladi.
        """
        today = datetime.now(tz=UTC).strftime("%Y/%m/%d")
        return f"{kind}/{today}/{camera_id}/{event_id}.{extension}"

    async def put_jpeg_base64(self, key: str, payload: str) -> str:
        data = base64.b64decode(payload)
        await asyncio.to_thread(
            partial(
                self._client.put_object,
                Bucket=self._settings.s3_bucket,
                Key=key,
                Body=data,
                ContentType="image/jpeg",
            )
        )
        return key

    async def put_file(self, key: str, path: str, content_type: str) -> str:
        await asyncio.to_thread(
            partial(
                self._client.upload_file,
                path,
                self._settings.s3_bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
        )
        return key

    async def get_bytes(self, key: str) -> bytes | None:
        def read() -> bytes | None:
            try:
                response = self._client.get_object(
                    Bucket=self._settings.s3_bucket, Key=key
                )
                return response["Body"].read()
            except ClientError:
                return None

        return await asyncio.to_thread(read)

    async def delete_many(self, keys: list[str]) -> int:
        if not keys:
            return 0

        def delete() -> int:
            deleted = 0
            # S3 delete_objects bir so'rovda 1000 tagacha qabul qiladi.
            for index in range(0, len(keys), 1000):
                batch = keys[index : index + 1000]
                response = self._client.delete_objects(
                    Bucket=self._settings.s3_bucket,
                    Delete={"Objects": [{"Key": key} for key in batch]},
                )
                deleted += len(response.get("Deleted", []))
            return deleted

        return await asyncio.to_thread(delete)
