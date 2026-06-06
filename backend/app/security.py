from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import time
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User


SECRET_PREFIX = "enc:v1:"
COMMAND_SECRET_PREFIX = "cmd:v1:"


def secret_key() -> bytes:
    raw = settings().token_encryption_secret or settings().jwt_secret
    return hashlib.sha256(raw.encode()).digest()


def secret_storage_type(value: str) -> str:
    if not value:
        return "empty"
    if value.startswith(SECRET_PREFIX):
        return "encrypted"
    if value.startswith(COMMAND_SECRET_PREFIX):
        return "external"
    return "legacy"


def command_secret(action: str, value: str) -> str:
    command = settings().token_secret_command.strip()
    if not command:
        raise ValueError("AI_BOARD_TOKEN_SECRET_COMMAND is required when token_secret_provider=command")
    payload = json.dumps({"action": action, "value": value}, separators=(",", ":"))
    completed = subprocess.run(
        command,
        input=payload,
        text=True,
        capture_output=True,
        shell=True,
        timeout=5,
        check=False,
    )
    if completed.returncode != 0:
        raise ValueError((completed.stderr or "secret command failed").strip())
    try:
        data = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError("secret command must return JSON") from exc
    result = data.get("value")
    if not isinstance(result, str):
        raise ValueError("secret command JSON must include a string value")
    return result


def secret_stream(nonce: bytes, length: int) -> bytes:
    key = secret_key()
    chunks: list[bytes] = []
    counter = 0
    while sum(len(chunk) for chunk in chunks) < length:
        counter_bytes = counter.to_bytes(4, "big")
        chunks.append(hmac.new(key, nonce + counter_bytes, hashlib.sha256).digest())
        counter += 1
    return b"".join(chunks)[:length]


def protect_secret(value: str) -> str:
    if not value or value.startswith(SECRET_PREFIX) or value.startswith(COMMAND_SECRET_PREFIX):
        return value
    if settings().token_secret_provider.lower() == "command":
        protected = command_secret("protect", value)
        payload = base64.urlsafe_b64encode(protected.encode()).decode()
        return f"{COMMAND_SECRET_PREFIX}{payload}"
    raw = value.encode()
    nonce = secrets.token_bytes(16)
    stream = secret_stream(nonce, len(raw))
    cipher = bytes(a ^ b for a, b in zip(raw, stream, strict=True))
    mac = hmac.new(secret_key(), nonce + cipher, hashlib.sha256).digest()
    payload = base64.urlsafe_b64encode(nonce + mac + cipher).decode()
    return f"{SECRET_PREFIX}{payload}"


def reveal_secret(value: str) -> str:
    if not value:
        return ""
    if value.startswith(COMMAND_SECRET_PREFIX):
        try:
            payload = value.removeprefix(COMMAND_SECRET_PREFIX)
            protected = base64.urlsafe_b64decode(payload.encode()).decode()
            return command_secret("reveal", protected)
        except Exception:
            return ""
    if not value.startswith(SECRET_PREFIX):
        return value or ""
    payload = value.removeprefix(SECRET_PREFIX)
    try:
        raw = base64.urlsafe_b64decode(payload.encode())
        nonce, mac, cipher = raw[:16], raw[16:48], raw[48:]
        expected = hmac.new(secret_key(), nonce + cipher, hashlib.sha256).digest()
        if not hmac.compare_digest(mac, expected):
            return ""
        stream = secret_stream(nonce, len(cipher))
        plain = bytes(a ^ b for a, b in zip(cipher, stream, strict=True))
        return plain.decode()
    except Exception:
        return ""


def secret_preview(value: str) -> str:
    plain = reveal_secret(value)
    return f"{plain[:4]}..." if plain else ""


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _kind, salt_b64, digest_b64 = stored.split("$", 2)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
        return hmac.compare_digest(expected, actual)
    except Exception:
        return False


def create_token(user: User) -> str:
    payload = {"sub": user.id, "email": user.email, "role": user.role, "exp": int(time.time()) + 60 * 60 * 24 * 7}
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(settings().jwt_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def read_token(token: str) -> dict:
    raw, sig = token.split(".", 1)
    expected = hmac.new(settings().jwt_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise ValueError("bad signature")
    payload = json.loads(base64.urlsafe_b64decode(raw.encode()))
    if payload.get("exp", 0) < time.time():
        raise ValueError("expired")
    return payload


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    try:
        payload = read_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="세션이 올바르지 않습니다.") from exc
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다.")
    return user
