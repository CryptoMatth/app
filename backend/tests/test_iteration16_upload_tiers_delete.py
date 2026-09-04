"""Iteration 16 backend regression tests.

Covers:
- POST /api/upload/photo multipart happy path + negative cases
- POST /api/auth/delete-account (missing confirm / wrong password / happy path)
- Admin POST /api/admin/users/{user_id}/entitlements/{tier} for pro_plus, ultra, revoke, and unknown tier
- GET /api/fridge is gated by require_pro_plus (test3 Pro → 402; fresh Pro+ user → 200)
- PUT /api/auth/preferences accepts and persists courses[].icon

Uses http://localhost:8001. Creates fresh throwaway users for destructive tests
prefixed `t16_<timestamp>`. Never mutates test3's tier.
"""
from __future__ import annotations

import io
import os
import time
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://localhost:8001").rstrip("/")
ADMIN_PASSWORD = "planeat-admin-CH4ngeMe-2026"
TEST3_USERNAME = "test3"
TEST3_PASSWORD = "pass1234"


# ---------- helpers ----------
def _make_min_jpeg() -> bytes:
    """Return the smallest valid-ish JPEG bytes (SOI + APP0 stub + EOI)."""
    # This is a real 1x1 JPEG produced by libjpeg; content_type check on server
    # is by header value, not decoding — but keep bytes non-empty & JPEG-magic.
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606"
        "070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d"
        "1a1c1c20242e2720222c231c1c2837292c30313434341f27393d3832"
        "3c2e333432ffdb0043010909090c0b0c180d0d1832211c2132323232"
        "32323232323232323232323232323232323232323232323232323232"
        "3232323232323232323232323232323232ffc00011080001000103012"
        "200021101031101ffc4001f0000010501010101010100000000000000"
        "000102030405060708090a0bffc400b5100002010303020403050504"
        "0400000102030405060708090a0bffda000c03010002110311003f00fbd0ffd9"
    )


def _make_min_png() -> bytes:
    """Return a valid 1x1 transparent PNG (used for negative-test in unsupported)."""
    signature = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00"))
    iend = chunk(b"IEND", b"")
    return signature + ihdr + idat + iend


def _register(session: requests.Session, username: str, password: str = "pass1234") -> dict:
    r = session.post(
        f"{BASE_URL}/api/auth/register",
        json={"username": username, "password": password, "password_repeat": password},
        timeout=15,
    )
    assert r.status_code == 200, f"register failed for {username}: {r.status_code} {r.text}"
    return r.json()


def _login(session: requests.Session, username: str, password: str = "pass1234") -> dict:
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password},
        timeout=15,
    )
    return r


def _auth_session(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _admin_headers() -> dict:
    return {"X-Admin-Password": ADMIN_PASSWORD}


def _admin_delete_user(user_id: str) -> None:
    try:
        requests.delete(
            f"{BASE_URL}/api/admin/users/{user_id}", headers=_admin_headers(), timeout=15
        )
    except Exception:
        pass


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def test3_token() -> str:
    r = _login(requests.Session(), TEST3_USERNAME, TEST3_PASSWORD)
    assert r.status_code == 200, f"test3 login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture()
def throwaway_user():
    """Register a fresh user; cleaned up (via admin DELETE) after test."""
    created: list = []

    def _mk(prefix: str = "t16"):
        uname = f"{prefix}_{int(time.time() * 1000)}_{len(created)}"
        # username validation: lowercase alphanumeric + . _ (3-30 chars) — OK.
        s = requests.Session()
        data = _register(s, uname, "pass1234")
        info = {
            "username": uname,
            "password": "pass1234",
            "user_id": data["user"]["user_id"],
            "session_token": data["session_token"],
            "user": data["user"],
        }
        created.append(info)
        return info

    yield _mk

    for u in created:
        _admin_delete_user(u["user_id"])


# ---------- upload/photo ----------
class TestUploadPhoto:
    def test_upload_photo_happy_path_returns_metadata(self, test3_token):
        img = _make_min_jpeg()
        files = {"file": ("tiny.jpg", img, "image/jpeg")}
        r = requests.post(
            f"{BASE_URL}/api/upload/photo",
            headers={"Authorization": f"Bearer {test3_token}"},
            files=files,
            timeout=30,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code} {r.text}"
        body = r.json()
        assert "path" in body and isinstance(body["path"], str) and body["path"]
        assert body.get("content_type") == "image/jpeg"
        assert body.get("size") == len(img)

    def test_upload_photo_unsupported_type_returns_400(self, test3_token):
        # text/plain is not in ALLOWED_IMAGE_TYPES
        files = {"file": ("note.txt", b"hello world", "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/upload/photo",
            headers={"Authorization": f"Bearer {test3_token}"},
            files=files,
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"
        assert "Unsupported" in (r.json().get("detail") or "")

    def test_upload_photo_empty_file_returns_400(self, test3_token):
        files = {"file": ("empty.jpg", b"", "image/jpeg")}
        r = requests.post(
            f"{BASE_URL}/api/upload/photo",
            headers={"Authorization": f"Bearer {test3_token}"},
            files=files,
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"
        assert (r.json().get("detail") or "").lower().startswith("empty")


# ---------- delete-account ----------
class TestDeleteAccount:
    def test_missing_confirm_returns_400(self, throwaway_user):
        u = throwaway_user()
        r = requests.post(
            f"{BASE_URL}/api/auth/delete-account",
            headers={"Authorization": f"Bearer {u['session_token']}"},
            json={"password": u["password"], "confirm": ""},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"
        assert r.json().get("detail") == "confirmation_required"

    def test_wrong_password_returns_401(self, throwaway_user):
        u = throwaway_user()
        r = requests.post(
            f"{BASE_URL}/api/auth/delete-account",
            headers={"Authorization": f"Bearer {u['session_token']}"},
            json={"password": "not-my-password", "confirm": "ELIMINA"},
            timeout=15,
        )
        assert r.status_code == 401, f"expected 401 got {r.status_code} {r.text}"
        assert r.json().get("detail") == "invalid_password"

    def test_correct_password_and_confirm_deletes_and_relogin_fails(self, throwaway_user):
        u = throwaway_user()
        r = requests.post(
            f"{BASE_URL}/api/auth/delete-account",
            headers={"Authorization": f"Bearer {u['session_token']}"},
            json={"password": u["password"], "confirm": "ELIMINA"},
            timeout=20,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert "removed" in body

        # re-login should fail
        r2 = _login(requests.Session(), u["username"], u["password"])
        assert r2.status_code == 401, f"expected 401 after delete got {r2.status_code} {r2.text}"
        assert r2.json().get("detail") == "Credenziali non valide"


# ---------- admin entitlements (tier) ----------
class TestAdminTierEntitlements:
    def _grant(self, user_id: str, tier: str, active: bool = True):
        return requests.post(
            f"{BASE_URL}/api/admin/users/{user_id}/entitlements/{tier}",
            headers=_admin_headers(),
            json={"active": active, "reason": "test"},
            timeout=15,
        )

    def test_grant_pro_plus_makes_user_pro_plus(self, throwaway_user):
        u = throwaway_user()
        r = self._grant(u["user_id"], "pro_plus", True)
        assert r.status_code == 200, r.text
        assert r.json().get("tier") == "pro_plus"

        # login and check user.tier
        login = _login(requests.Session(), u["username"], u["password"])
        assert login.status_code == 200, login.text
        assert login.json()["user"].get("tier") == "pro_plus"

        # /api/auth/me also shows pro_plus
        me = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {login.json()['session_token']}"},
            timeout=10,
        )
        assert me.status_code == 200
        assert me.json().get("tier") == "pro_plus"

    def test_grant_ultra_makes_user_ultra(self, throwaway_user):
        u = throwaway_user()
        r = self._grant(u["user_id"], "ultra", True)
        assert r.status_code == 200, r.text

        login = _login(requests.Session(), u["username"], u["password"])
        assert login.status_code == 200
        assert login.json()["user"].get("tier") == "ultra"

    def test_revoke_pro_plus_falls_back_to_next_lowest(self, throwaway_user):
        u = throwaway_user()
        # give both pro and pro_plus, then revoke pro_plus → should fall to pro
        assert self._grant(u["user_id"], "pro", True).status_code == 200
        assert self._grant(u["user_id"], "pro_plus", True).status_code == 200
        login = _login(requests.Session(), u["username"], u["password"])
        assert login.json()["user"].get("tier") == "pro_plus"

        assert self._grant(u["user_id"], "pro_plus", False).status_code == 200
        login2 = _login(requests.Session(), u["username"], u["password"])
        assert login2.json()["user"].get("tier") == "pro"

    def test_revoke_only_tier_falls_to_free(self, throwaway_user):
        u = throwaway_user()
        assert self._grant(u["user_id"], "pro_plus", True).status_code == 200
        assert self._grant(u["user_id"], "pro_plus", False).status_code == 200
        login = _login(requests.Session(), u["username"], u["password"])
        assert login.json()["user"].get("tier") == "free"

    def test_unknown_tier_returns_400(self, throwaway_user):
        u = throwaway_user()
        r = self._grant(u["user_id"], "gold", True)
        assert r.status_code == 400, r.text
        assert "unknown tier" in (r.json().get("detail") or "").lower()


# ---------- fridge gating (Pro+ required) ----------
class TestFridgeProPlusGating:
    def test_test3_pro_only_gets_402(self, test3_token):
        r = requests.get(
            f"{BASE_URL}/api/fridge",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=10,
        )
        assert r.status_code == 402, f"expected 402 got {r.status_code} {r.text}"
        assert "Pro+" in (r.json().get("detail") or "")

    def test_pro_plus_user_can_list_fridge(self, throwaway_user):
        u = throwaway_user()
        gr = requests.post(
            f"{BASE_URL}/api/admin/users/{u['user_id']}/entitlements/pro_plus",
            headers=_admin_headers(),
            json={"active": True, "reason": "test"},
            timeout=15,
        )
        assert gr.status_code == 200
        # need a fresh session so tier is re-read
        login = _login(requests.Session(), u["username"], u["password"])
        token = login.json()["session_token"]
        r = requests.get(
            f"{BASE_URL}/api/fridge",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code} {r.text}"
        assert isinstance(r.json(), list)


# ---------- preferences: courses[].icon ----------
class TestPreferencesCourseIcon:
    def test_put_and_get_preserves_icon(self, test3_token):
        payload = {"courses": [{"id": "primo", "label": "Primo", "icon": "🍝"}]}
        r = requests.put(
            f"{BASE_URL}/api/auth/preferences",
            headers={"Authorization": f"Bearer {test3_token}"},
            json=payload,
            timeout=15,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code} {r.text}"
        prefs = r.json()
        courses = prefs.get("courses") or []
        primo = next((c for c in courses if c.get("id") == "primo"), None)
        assert primo is not None, f"primo course missing: {courses}"
        assert primo.get("icon") == "🍝", f"icon not saved: {primo}"

        # GET back
        r2 = requests.get(
            f"{BASE_URL}/api/auth/preferences",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=10,
        )
        assert r2.status_code == 200
        courses2 = (r2.json() or {}).get("courses") or []
        primo2 = next((c for c in courses2 if c.get("id") == "primo"), None)
        assert primo2 is not None
        assert primo2.get("icon") == "🍝", f"icon not persisted on GET: {primo2}"
