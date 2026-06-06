from __future__ import annotations

import json
from typing import Any

from redis import Redis
from redis.exceptions import RedisError

from .config import settings


def redis_client() -> Redis | None:
    try:
        client = Redis.from_url(settings().redis_url, decode_responses=True, socket_connect_timeout=0.25)
        client.ping()
        return client
    except RedisError:
        return None


def cache_get(key: str) -> Any | None:
    client = redis_client()
    if not client:
        return None
    value = client.get(key)
    return json.loads(value) if value else None


def cache_set(key: str, value: Any, ttl_seconds: int = 60) -> None:
    client = redis_client()
    if client:
        client.setex(key, ttl_seconds, json.dumps(value, ensure_ascii=False))
