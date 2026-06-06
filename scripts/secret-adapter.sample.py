#!/usr/bin/env python
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import uuid
from pathlib import Path


STORE_PATH = Path(os.environ.get("AI_BOARD_SECRET_ADAPTER_STORE", "data/secret-adapter-store.json"))
MASTER_KEY = os.environ.get("AI_BOARD_SECRET_ADAPTER_MASTER_KEY", "local-secret-adapter-demo-key")


def key_bytes() -> bytes:
    return hashlib.sha256(MASTER_KEY.encode("utf-8")).digest()


def load_store() -> dict[str, str]:
    if not STORE_PATH.exists():
        return {}
    return json.loads(STORE_PATH.read_text(encoding="utf-8"))


def save_store(store: dict[str, str]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(store, indent=2, sort_keys=True), encoding="utf-8")


def seal(value: str) -> str:
    raw = value.encode("utf-8")
    digest = hmac.new(key_bytes(), raw, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest + raw).decode("ascii")


def unseal(value: str) -> str:
    raw = base64.urlsafe_b64decode(value.encode("ascii"))
    digest, payload = raw[:32], raw[32:]
    expected = hmac.new(key_bytes(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(digest, expected):
        raise ValueError("stored secret failed integrity check")
    return payload.decode("utf-8")


def protect_value(value: str) -> str:
    # Replace this block with a real Vault/KMS create-secret call in production.
    store = load_store()
    secret_id = f"ai-board/{uuid.uuid4()}"
    store[secret_id] = seal(value)
    save_store(store)
    return secret_id


def reveal_value(reference: str) -> str:
    # Replace this block with a real Vault/KMS read-secret call in production.
    store = load_store()
    if reference not in store:
        raise KeyError("secret reference not found")
    return unseal(store[reference])


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        action = payload.get("action")
        value = payload.get("value")
        if not isinstance(action, str) or not isinstance(value, str):
            raise ValueError("stdin JSON must include string action and value")
        if action == "protect":
            result = protect_value(value)
        elif action == "reveal":
            result = reveal_value(value)
        else:
            raise ValueError("action must be protect or reveal")
        print(json.dumps({"value": result}, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
