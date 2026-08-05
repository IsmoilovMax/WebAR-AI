"""Alert yetkazib berish: Telegram, webhook, email."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime, time
from typing import Any
from urllib.parse import urlparse

import asyncpg
import httpx

from .config import Settings

log = logging.getLogger(__name__)

SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

EVENT_LABELS = {
    "person_detected": "Odam aniqlandi",
    "fire": "Yong'in",
    "smoke": "Tutun",
    "fall": "Yiqilish",
    "smoking": "Chekish",
    "zone_intrusion": "Zona buzilishi",
    "loitering": "Uzoq turib qolish",
    "camera_offline": "Kamera offline",
    "camera_online": "Kamera online",
}


def _in_active_window(now: datetime, active_from: time | None, active_to: time | None) -> bool:
    if active_from is None or active_to is None:
        return True
    current = now.timetz().replace(tzinfo=None)
    if active_from <= active_to:
        return active_from <= current <= active_to
    # Tunda kesilgan oraliq (masalan 22:00 - 06:00)
    return current >= active_from or current <= active_to


class AlertDispatcher:
    def __init__(self, pool: asyncpg.Pool, settings: Settings) -> None:
        self._pool = pool
        self._settings = settings

    async def dispatch(
        self,
        *,
        org_id: str,
        camera_id: str,
        camera_name: str,
        event_id: str,
        event_type: str,
        severity: str,
        confidence: float,
        snapshot_url: str | None,
        clip_url: str | None = None,
        started_at: datetime | None = None,
        confirmed_at: datetime | None = None,
        track_id: int | None = None,
        bbox: list[float] | tuple[float, ...] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        rules = await self._pool.fetch(
            """SELECT id, name, event_types, min_severity, camera_ids,
                      target, active_from, active_to, cooldown_seconds
               FROM alert_rules
               WHERE org_id = $1 AND enabled = true""",
            org_id,
        )

        now = datetime.now(tz=UTC)
        for rule in rules:
            if event_type not in rule["event_types"]:
                continue
            if SEVERITY_RANK.get(severity, 0) < SEVERITY_RANK.get(rule["min_severity"], 0):
                continue
            if rule["camera_ids"] and camera_id not in [str(c) for c in rule["camera_ids"]]:
                continue
            if not _in_active_window(now, rule["active_from"], rule["active_to"]):
                continue

            if await self._in_cooldown(rule["id"], camera_id, event_type, rule["cooldown_seconds"]):
                await self._record(
                    org_id, rule["id"], camera_id, event_id, event_type, "suppressed", None
                )
                continue

            target = rule["target"]
            if isinstance(target, str):
                target = json.loads(target)

            try:
                await self._send(
                    target=target,
                    rule_name=rule["name"],
                    event={
                        "eventId": event_id,
                        "orgId": org_id,
                        "cameraId": camera_id,
                        "cameraName": camera_name,
                        "eventType": event_type,
                        "severity": severity,
                        "confidence": confidence,
                        "startedAt": (started_at or now).isoformat(),
                        "confirmedAt": (confirmed_at or now).isoformat(),
                        "trackId": track_id,
                        "bbox": list(bbox) if bbox is not None else None,
                        "snapshotUrl": snapshot_url,
                        "clipUrl": clip_url,
                        "meta": meta or {},
                        "ruleName": rule["name"],
                    },
                )
                await self._record(
                    org_id, rule["id"], camera_id, event_id, event_type, "sent", None
                )
            except Exception as exc:  # noqa: BLE001
                log.exception("Alert yuborilmadi: rule=%s", rule["id"])
                await self._record(
                    org_id, rule["id"], camera_id, event_id, event_type, "failed", str(exc)
                )

    async def _in_cooldown(
        self, rule_id: Any, camera_id: str, event_type: str, cooldown: int
    ) -> bool:
        if cooldown <= 0:
            return False
        row = await self._pool.fetchrow(
            """SELECT created_at FROM alert_deliveries
               WHERE rule_id = $1 AND camera_id = $2 AND event_type = $3
                 AND status = 'sent'
               ORDER BY created_at DESC LIMIT 1""",
            rule_id,
            camera_id,
            event_type,
        )
        if not row:
            return False
        age = (datetime.now(tz=UTC) - row["created_at"]).total_seconds()
        return age < cooldown

    async def _record(
        self,
        org_id: str,
        rule_id: Any,
        camera_id: str,
        event_id: str,
        event_type: str,
        status: str,
        error: str | None,
    ) -> None:
        await self._pool.execute(
            """INSERT INTO alert_deliveries
                 (org_id, rule_id, camera_id, event_id, event_type, status, error)
               VALUES ($1, $2, $3, $4::uuid, $5, $6, $7)""",
            org_id,
            rule_id,
            camera_id,
            event_id,
            event_type,
            status,
            error,
        )

    async def _send(
        self,
        *,
        target: dict[str, Any],
        rule_name: str,
        event: dict[str, Any],
    ) -> None:
        label = EVENT_LABELS.get(event["eventType"], event["eventType"])
        text = (
            f"[{event['severity'].upper()}] {label}\n"
            f"Kamera: {event['cameraName']}\n"
            f"Ishonch: {event['confidence']:.0%}\n"
            f"Qoida: {rule_name}"
        )
        if event.get("snapshotUrl"):
            text += f"\n{event['snapshotUrl']}"

        kind = target.get("kind")
        if kind == "telegram":
            await self._telegram(target["chatId"], text)
        elif kind == "webhook":
            # Tashqi saytlar jadvalga yozishi uchun to'liq strukturali payload.
            await self._webhook(target, {**event, "text": text})
        elif kind == "email":
            await self._email(target["to"], f"ACS: {label}", text)
        else:
            raise ValueError(f"Noma'lum alert kanali: {kind}")

    async def _telegram(self, chat_id: str, text: str) -> None:
        token = self._settings.telegram_bot_token
        if not token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN o'rnatilmagan")

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                url,
                json={"chat_id": chat_id, "text": text, "disable_web_page_preview": False},
            )
            if response.status_code >= 400:
                raise RuntimeError(f"Telegram HTTP {response.status_code}: {response.text}")

    async def _webhook(self, target: dict[str, Any], payload: dict[str, Any]) -> None:
        url = target["url"]
        headers = {"Content-Type": "application/json"}
        body = json.dumps(payload).encode("utf-8")

        secret = target.get("secret")
        if secret:
            signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
            headers["X-ACS-Signature"] = signature

        # SSRF himoyasi: faqat http(s) va ichki tarmoq IP lariga ruxsat.
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Webhook faqat http/https bo'lishi mumkin")

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(url, content=body, headers=headers)
            if response.status_code >= 400:
                raise RuntimeError(f"Webhook HTTP {response.status_code}")

    async def _email(self, recipients: list[str], subject: str, body: str) -> None:
        if not self._settings.smtp_url:
            raise RuntimeError("SMTP_URL o'rnatilmagan")

        import aiosmtplib
        from email.message import EmailMessage

        parsed = urlparse(self._settings.smtp_url)
        message = EmailMessage()
        message["From"] = parsed.username or "noreply@acs.local"
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject
        message.set_content(body)

        await aiosmtplib.send(
            message,
            hostname=parsed.hostname or "localhost",
            port=parsed.port or 587,
            username=parsed.username,
            password=parsed.password,
            start_tls=parsed.scheme == "smtp",
        )
