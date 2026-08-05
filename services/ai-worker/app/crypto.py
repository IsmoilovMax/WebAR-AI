"""Kamera parollarini shifrlash / ochish.

Bazada ochiq parol saqlanmaydi. Format apps/web/lib/crypto.ts bilan bir xil:

    v1:<nonce_b64>:<ciphertext_with_tag_b64>

AES-256-GCM ishlatiladi, kalit CREDENTIALS_ENCRYPTION_KEY (base64, 32 bayt).
Kalit bazada emas, faqat muhit o'zgaruvchisida - baza dampi o'g'irlansa ham
kameralarga kirish ochilmaydi.
"""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX = "v1"
NONCE_SIZE = 12


class CredentialsError(RuntimeError):
    pass


def _load_key(key_b64: str) -> bytes:
    if not key_b64:
        raise CredentialsError("CREDENTIALS_ENCRYPTION_KEY o'rnatilmagan")
    try:
        key = base64.b64decode(key_b64, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise CredentialsError("CREDENTIALS_ENCRYPTION_KEY base64 emas") from exc
    if len(key) != 32:
        raise CredentialsError(
            f"CREDENTIALS_ENCRYPTION_KEY 32 bayt bo'lishi kerak, {len(key)} berilgan"
        )
    return key


def decrypt(payload: str, key_b64: str) -> str:
    parts = payload.split(":")
    if len(parts) != 3 or parts[0] != PREFIX:
        raise CredentialsError("Shifrlangan qiymat formati noto'g'ri")

    key = _load_key(key_b64)
    nonce = base64.b64decode(parts[1])
    ciphertext = base64.b64decode(parts[2])

    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    except Exception as exc:  # noqa: BLE001
        # GCM tag mos kelmasa - kalit boshqa yoki ma'lumot buzilgan.
        raise CredentialsError(
            "Parolni ochib bo'lmadi. CREDENTIALS_ENCRYPTION_KEY o'zgarganmi?"
        ) from exc

    return plaintext.decode("utf-8")


def encrypt(plaintext: str, key_b64: str) -> str:
    import os

    key = _load_key(key_b64)
    nonce = os.urandom(NONCE_SIZE)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return ":".join(
        [
            PREFIX,
            base64.b64encode(nonce).decode("ascii"),
            base64.b64encode(ciphertext).decode("ascii"),
        ]
    )
