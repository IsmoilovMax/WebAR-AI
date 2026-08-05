"""Kamera parollarini ochish. Format ai-worker/crypto.py bilan bir xil."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX = "v1"


class CredentialsError(RuntimeError):
    pass


def decrypt(payload: str, key_b64: str) -> str:
    parts = payload.split(":")
    if len(parts) != 3 or parts[0] != PREFIX:
        raise CredentialsError("Shifrlangan qiymat formati noto'g'ri")

    try:
        key = base64.b64decode(key_b64, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise CredentialsError("CREDENTIALS_ENCRYPTION_KEY base64 emas") from exc

    if len(key) != 32:
        raise CredentialsError("CREDENTIALS_ENCRYPTION_KEY 32 bayt bo'lishi kerak")

    nonce = base64.b64decode(parts[1])
    ciphertext = base64.b64decode(parts[2])

    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    except Exception as exc:  # noqa: BLE001
        raise CredentialsError("Parolni ochib bo'lmadi") from exc

    return plaintext.decode("utf-8")
