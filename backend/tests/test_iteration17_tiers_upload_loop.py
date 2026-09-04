"""Iteration 17 backend regression tests.

Covers per review request:
1. Halley user tier: founder whitelist → tier == 'ultra', is_pro True, pro_source 'founder'.
   Register `halley` if missing; verify /auth/me + /auth/login both propagate tier.
2. tier field on login for existing users: test3 → 'pro', testlang01 → 'free'.
3. Grant Pro+ via admin on a throwaway user → next login response.user.tier == 'pro_plus'.
4. Photo upload → sign → retrieve full loop: upload returns metadata, files-token issues
   a token, GET /files/{path}?token=... returns the original bytes with image/* content-type.
5. Photo upload negative: empty body → 400; non-pro (testlang01) → 402.

Uses the public backend URL from the frontend .env (falls back to localhost).
Creates throwaway users prefixed `t17_<timestamp>`. Never mutates test3 or testlang01.
"""
from __future__ import annotations

import os
import time
import pytest
import requests

BASE_URL = os.environ.get(
    "BACKEND_BASE_URL",
    "https://meal-prep-master-2.preview.emergentagent.com",
).rstrip("/")
ADMIN_PASSWORD = "planeat-admin-CH4ngeMe-2026"

TEST3_USERNAME = "test3"
TEST3_PASSWORD = "pass1234"
TESTLANG_USERNAME = "testlang01"
TESTLANG_PASSWORD = "pass1234"
HALLEY_USERNAME = "halley"
HALLEY_PASSWORD = "halley1234"


# ---------- helpers ----------
def _min_jpeg() -> bytes:
    """Real 1x1 baseline JPEG bytes."""
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


def _admin_headers() -> dict:
    return {"X-Admin-Password": ADMIN_PASSWORD}


def _admin_delete_user(user_id: str) -> None:
    try:
        requests.delete(
            f"{BASE_URL}/api/admin/users/{user_id}",
            headers=_admin_headers(),
            timeout=15,
        )
    except Exception:
        pass


def _register(username: str, password: str = "pass1234") -> requests.Response:
    return requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"username": username, "password": password, "password_repeat": password},
        timeout=20,
    )


def _login(username: str, password: str = "pass1234") -> requests.Response:
    return requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password},
        timeout=20,
    )


def _find_user_id(username: str) -> str | None:
    r = requests.get(
        f"{BASE_URL}/api/admin/users", headers=_admin_headers(), timeout=20
    )
    if r.status_code != 200:
        return None
    for u in r.json():
        if (u.get("username") or "").lower() == username.lower():
            return u.get("user_id")
    return None


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def test3_token() -> str:
    r = _login(TEST3_USERNAME, TEST3_PASSWORD)
    assert r.status_code == 200, f"test3 login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def testlang_token() -> str:
    r = _login(TESTLANG_USERNAME, TESTLANG_PASSWORD)
    if r.status_code != 200:
        # Register testlang01 fresh if missing (free tier)
        rr = _register(TESTLANG_USERNAME, TESTLANG_PASSWORD)
        assert rr.status_code == 200, f"testlang01 register failed: {rr.text}"
        return rr.json()["session_token"]
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def halley_ctx() -> dict:
    """Ensure halley exists (register if missing / reset password via admin if exists),
    then return {'token', 'user_id', 'created'}."""
    # Try login first
    r = _login(HALLEY_USERNAME, HALLEY_PASSWORD)
    created_now = False
    if r.status_code == 200:
        data = r.json()
        return {
            "token": data["session_token"],
            "user_id": data["user"]["user_id"],
            "login_body": data,
            "created": False,
        }
    # If already exists but different password, reset via admin
    existing_id = _find_user_id(HALLEY_USERNAME)
    if existing_id:
        rr = requests.post(
            f"{BASE_URL}/api/admin/users/{existing_id}/password",
            headers=_admin_headers(),
            json={"new_password": HALLEY_PASSWORD},
            timeout=20,
        )
        assert rr.status_code == 200, f"admin password reset failed: {rr.text}"
        r2 = _login(HALLEY_USERNAME, HALLEY_PASSWORD)
        assert r2.status_code == 200, f"halley login after reset failed: {r2.text}"
        data = r2.json()
        return {
            "token": data["session_token"],
            "user_id": data["user"]["user_id"],
            "login_body": data,
            "created": False,
        }
    # Otherwise register fresh
    reg = _register(HALLEY_USERNAME, HALLEY_PASSWORD)
    assert reg.status_code == 200, f"halley register failed: {reg.status_code} {reg.text}"
    data = reg.json()
    created_now = True
    return {
        "token": data["session_token"],
        "user_id": data["user"]["user_id"],
        "login_body": data,
        "created": created_now,
    }


@pytest.fixture()
def throwaway_user():
    created = []

    def _mk(prefix: str = "t17"):
        uname = f"{prefix}_{int(time.time() * 1000)}_{len(created)}"
        r = _register(uname, "pass1234")
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
        data = r.json()
        info = {
            "username": uname,
            "password": "pass1234",
            "user_id": data["user"]["user_id"],
            "token": data["session_token"],
            "user": data["user"],
        }
        created.append(info)
        return info

    yield _mk

    for u in created:
        _admin_delete_user(u["user_id"])


# ---------- 1. Halley tier ----------
class TestHalleyFounderTier:
    def test_halley_login_returns_ultra_tier(self, halley_ctx):
        user = halley_ctx["login_body"]["user"]
        assert user.get("tier") == "ultra", f"expected tier ultra got {user.get('tier')}"
        assert user.get("is_pro") is True
        assert user.get("pro_source") == "founder"

    def test_halley_me_endpoint_returns_ultra_tier(self, halley_ctx):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {halley_ctx['token']}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/auth/me failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("tier") == "ultra"
        assert body.get("is_pro") is True
        assert body.get("pro_source") == "founder"


# ---------- 2. tier field on login for existing users ----------
class TestExistingUserTiers:
    def test_test3_login_tier_is_pro(self):
        r = _login(TEST3_USERNAME, TEST3_PASSWORD)
        assert r.status_code == 200, f"test3 login failed: {r.text}"
        user = r.json()["user"]
        assert user.get("tier") == "pro", f"expected pro got {user.get('tier')}"
        assert user.get("is_pro") is True

    def test_testlang01_login_tier_is_free(self, testlang_token):
        # testlang_token fixture guarantees the user exists; re-login for the response body
        r = _login(TESTLANG_USERNAME, TESTLANG_PASSWORD)
        assert r.status_code == 200, f"testlang01 login failed: {r.text}"
        user = r.json()["user"]
        assert user.get("tier") == "free", f"expected free got {user.get('tier')}"
        assert user.get("is_pro") is False


# ---------- 3. Grant Pro+ via admin, verify next login ----------
class TestAdminProPlusGrant:
    def test_grant_pro_plus_reflects_in_next_login(self, throwaway_user):
        u = throwaway_user()
        # baseline should be free
        assert u["user"].get("tier") == "free"

        r = requests.post(
            f"{BASE_URL}/api/admin/users/{u['user_id']}/entitlements/pro_plus",
            headers=_admin_headers(),
            json={"active": True, "reason": "iteration17 test"},
            timeout=20,
        )
        assert r.status_code == 200, f"grant pro_plus failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("tier") == "pro_plus"
        assert body.get("entitlements", {}).get("pro_plus", {}).get("active") is True

        # Re-login to get fresh public user with tier
        r2 = _login(u["username"], u["password"])
        assert r2.status_code == 200
        user2 = r2.json()["user"]
        assert user2.get("tier") == "pro_plus", f"expected pro_plus got {user2.get('tier')}"
        assert user2.get("is_pro") is True

        # /auth/me should agree
        r3 = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {r2.json()['session_token']}"},
            timeout=15,
        )
        assert r3.status_code == 200
        assert r3.json().get("tier") == "pro_plus"


# ---------- 4. Photo upload → sign → retrieve loop ----------
class TestUploadSignRetrieveLoop:
    def test_upload_sign_retrieve_returns_bytes(self, test3_token):
        img = _min_jpeg()
        # upload
        r = requests.post(
            f"{BASE_URL}/api/upload/photo",
            headers={"Authorization": f"Bearer {test3_token}"},
            files={"file": ("tiny.jpg", img, "image/jpeg")},
            timeout=30,
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        meta = r.json()
        assert meta.get("size") == len(img)
        assert meta.get("content_type") == "image/jpeg"
        path = meta.get("path")
        assert path and isinstance(path, str)

        # sign
        r2 = requests.get(
            f"{BASE_URL}/api/files-token/{path}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=15,
        )
        assert r2.status_code == 200, f"sign failed: {r2.status_code} {r2.text}"
        token = r2.json().get("token")
        assert token and isinstance(token, str)

        # retrieve via signed token (no bearer)
        r3 = requests.get(
            f"{BASE_URL}/api/files/{path}", params={"token": token}, timeout=20
        )
        assert r3.status_code == 200, f"retrieve failed: {r3.status_code} {r3.text[:200]}"
        assert r3.headers.get("content-type", "").lower().startswith("image/"), (
            f"unexpected ctype: {r3.headers.get('content-type')}"
        )
        assert int(r3.headers.get("content-length", "0")) > 0
        assert r3.content == img, "retrieved bytes must equal uploaded bytes"

    def test_retrieve_via_bearer_also_works(self, test3_token):
        img = _min_jpeg()
        r = requests.post(
            f"{BASE_URL}/api/upload/photo",
            headers={"Authorization": f"Bearer {test3_token}"},
            files={"file": ("tiny2.jpg", img, "image/jpeg")},
            timeout=30,
        )
        assert r.status_code == 200
        path = r.json()["path"]
        r2 = requests.get(
            f"{BASE_URL}/api/files/{path}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=20,
        )
        assert r2.status_code == 200
        assert r2.content == img


# ---------- 5. Photo upload negative cases ----------
class TestUploadNegative:
    def test_upload_empty_body_returns_400(self, test3_token):
        r = requests.post(
            f"{BASE_URL}/api/upload/photo",
            headers={"Authorization": f"Bearer {test3_token}"},
            files={"file": ("empty.jpg", b"", "image/jpeg")},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"

    def test_upload_without_pro_returns_402(self, testlang_token):
        r = requests.post(
            f"{BASE_URL}/api/upload/photo",
            headers={"Authorization": f"Bearer {testlang_token}"},
            files={"file": ("tiny.jpg", _min_jpeg(), "image/jpeg")},
            timeout=15,
        )
        assert r.status_code == 402, f"expected 402 got {r.status_code} {r.text}"

    def test_files_token_unknown_path_returns_404(self, test3_token):
        r = requests.get(
            f"{BASE_URL}/api/files-token/does/not/exist.jpg",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=15,
        )
        assert r.status_code == 404
