"""Emergent Object Storage integration for PlanEat.

Photos of dishes, ingredients, and shopping items are uploaded through
the FastAPI backend (never directly from the app) so the storage key
stays server-side. See the integration playbook for the /init handshake.
"""
from __future__ import annotations

import os
import time
import hmac
import hashlib
import base64
import logging
from typing import Optional, Tuple

import requests
from fastapi.concurrency import run_in_threadpool

log = logging.getLogger("planeat.storage")

APP_NAME = "planeat"

_storage_key: Optional[str] = None


def _storage_url() -> str:
    base = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
    return base.rstrip("/") + "/objstore/api/v1/storage"


def _emergent_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY") or ""


def _signed_secret() -> str:
    return os.environ.get("ADMIN_PASSWORD") or "planeat-signed-secret"


def _init_sync() -> str:
    """Blocking init call — should be wrapped in run_in_threadpool."""
    global _storage_key
    if _storage_key:
        return _storage_key
    key = _emergent_key()
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    resp = requests.post(
        f"{_storage_url()}/init",
        json={"emergent_key": key},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    log.info("Emergent Object Storage initialized")
    return _storage_key


async def init_storage() -> str:
    return await run_in_threadpool(_init_sync)


def _reset_key() -> None:
    global _storage_key
    _storage_key = None


def _put_sync(path: str, data: bytes, content_type: str) -> dict:
    key = _init_sync()
    resp = requests.put(
        f"{_storage_url()}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        _reset_key()
        key = _init_sync()
        resp = requests.put(
            f"{_storage_url()}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def _get_sync(path: str) -> Tuple[bytes, str]:
    key = _init_sync()
    resp = requests.get(
        f"{_storage_url()}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code == 503:
        _reset_key()
        key = _init_sync()
        resp = requests.get(
            f"{_storage_url()}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await run_in_threadpool(_put_sync, path, data, content_type)


async def get_object(path: str) -> Tuple[bytes, str]:
    return await run_in_threadpool(_get_sync, path)


# ---- Short-lived signed tokens for authenticated <Image> tags on web ----
# The mobile app uses Authorization header; the web preview uses ?token=... in
# the URL because <img> can't send custom headers. HMAC(secret, "path:exp").

def sign_token(path: str, ttl_seconds: int = 3600) -> str:
    exp = int(time.time()) + ttl_seconds
    msg = f"{path}:{exp}".encode()
    mac = hmac.new(_signed_secret().encode(), msg, hashlib.sha256).digest()
    tok = base64.urlsafe_b64encode(mac).decode().rstrip("=")
    return f"{exp}.{tok}"


def verify_token(path: str, token: str) -> bool:
    try:
        exp_s, tok = token.split(".", 1)
        exp = int(exp_s)
    except Exception:
        return False
    if exp < int(time.time()):
        return False
    msg = f"{path}:{exp}".encode()
    mac = hmac.new(_signed_secret().encode(), msg, hashlib.sha256).digest()
    expected_tok = base64.urlsafe_b64encode(mac).decode().rstrip("=")
    return hmac.compare_digest(tok, expected_tok)


def user_photo_path(user_id: str, filename: str) -> str:
    """Build a bucket path that isolates each user's uploads."""
    filename = filename.replace("/", "_")
    return f"{APP_NAME}/uploads/{user_id}/{filename}"
