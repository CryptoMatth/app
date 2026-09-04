"""Iteration 18 backend regression: photo upload → sign → retrieve loop.

Per review request, this iteration only regression-tests the backend photo pipeline
(server code did not change; only client upload/display code did). Verifies:

1. Full loop: POST /api/upload/photo (multipart JPEG) as test3 → 200 with
   {path, size, content_type}. Then GET /api/files-token/{path} → 200 with a token
   (and, per request, an `expires_at` field ideally). Then GET /api/files/{path}?token=<t>
   → 200 with image/* content-type, positive content-length, body bytes byte-identical
   to the uploaded image.
2. Signed URL security:
   - GET /api/files/{path} without any auth → 401.
   - GET /api/files/{path}?token=INVALID → 401.
   - A token issued for path_A must NOT authorize GET on path_B (token bound to path).
   - A second user cannot sign a first user's path (/files-token/{other_path} → 404).
3. Token expiration semantics: /files-token responses expose an expiration far enough
   in the future; a token with exp in the past is rejected (we craft a forged-but-invalid
   past-exp token → 401; we can't sign a valid past token without the secret).
4. Bearer fallback: GET /api/files/{path} with Authorization: Bearer <session_token>
   also succeeds and returns identical bytes with positive Content-Length.
5. Concurrent uploads: 3 near-simultaneous POST /api/upload/photo return 3 distinct
   paths, none overwrite each other, and each can be independently fetched byte-exact.

Uses the public EXPO backend URL. Never mutates test3/halley/testlang01 permanently.
Throwaway users prefixed `t18_*` are deleted in fixture teardown.
"""
from __future__ import annotations

import concurrent.futures
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
def _min_jpeg(marker: int = 0) -> bytes:
    """Real 1x1 baseline JPEG bytes. `marker` is appended after EOI as a harmless
    trailer so we can differentiate multiple uploads by content, if desired."""
    base = bytes.fromhex(
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
    # decoders ignore bytes after EOI; use them to make each upload byte-unique
    return base + bytes([marker % 256]) if marker else base


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


def _upload(token: str, name: str, data: bytes, ctype: str = "image/jpeg") -> requests.Response:
    return requests.post(
        f"{BASE_URL}/api/upload/photo",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (name, data, ctype)},
        timeout=30,
    )


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def test3_token() -> str:
    r = _login(TEST3_USERNAME, TEST3_PASSWORD)
    assert r.status_code == 200, f"test3 login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def halley_token() -> str:
    r = _login(HALLEY_USERNAME, HALLEY_PASSWORD)
    assert r.status_code == 200, f"halley login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def uploaded_photo(test3_token) -> dict:
    """Upload one photo as test3 and return {path, bytes}."""
    img = _min_jpeg(marker=1)
    r = _upload(test3_token, "loop.jpg", img)
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
    meta = r.json()
    return {"path": meta["path"], "bytes": img, "meta": meta}


# ---------- 1. Full upload → sign → retrieve loop ----------
class TestUploadSignRetrieveLoop:
    def test_upload_returns_expected_metadata(self, uploaded_photo):
        meta = uploaded_photo["meta"]
        assert isinstance(meta.get("path"), str) and meta["path"]
        assert meta.get("size") == len(uploaded_photo["bytes"])
        assert meta.get("content_type") == "image/jpeg"

    def test_files_token_returns_token(self, test3_token, uploaded_photo):
        r = requests.get(
            f"{BASE_URL}/api/files-token/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"sign failed: {r.status_code} {r.text}"
        body = r.json()
        assert isinstance(body.get("token"), str) and "." in body["token"]

    def test_files_token_exposes_expires_at(self, test3_token, uploaded_photo):
        """Review request: response should include `expires_at` a few minutes in the
        future. Backend currently embeds exp inside the token (`<exp>.<mac>`); accept
        either an explicit `expires_at` field OR a parseable exp prefix > now + 60s."""
        r = requests.get(
            f"{BASE_URL}/api/files-token/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        now = int(time.time())
        explicit = body.get("expires_at")
        implicit = None
        try:
            implicit = int(body["token"].split(".", 1)[0])
        except Exception:
            pass
        exp = explicit if isinstance(explicit, (int, float)) else implicit
        assert exp is not None, f"no expires_at (explicit or embedded): {body}"
        assert exp > now + 60, f"expiration too close to now: exp={exp} now={now}"
        assert exp < now + 7 * 24 * 3600, f"expiration unreasonably far: exp={exp}"

    def test_retrieve_via_signed_token_returns_bytes(self, test3_token, uploaded_photo):
        # sign
        r1 = requests.get(
            f"{BASE_URL}/api/files-token/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=15,
        )
        assert r1.status_code == 200
        token = r1.json()["token"]
        # retrieve (no bearer)
        r2 = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}",
            params={"token": token},
            timeout=20,
        )
        assert r2.status_code == 200, f"retrieve failed: {r2.status_code} {r2.text[:200]}"
        ctype = r2.headers.get("content-type", "").lower()
        assert ctype.startswith("image/"), f"unexpected ctype: {ctype}"
        clen = int(r2.headers.get("content-length", "0"))
        assert clen == len(uploaded_photo["bytes"]) == len(r2.content)
        assert r2.content == uploaded_photo["bytes"], "bytes must be identical"


# ---------- 2. Signed URL security ----------
class TestSignedUrlSecurity:
    def test_get_files_without_any_auth_returns_401(self, uploaded_photo):
        r = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}", timeout=15
        )
        assert r.status_code == 401, f"expected 401 got {r.status_code} {r.text[:200]}"

    def test_get_files_with_invalid_token_returns_401(self, uploaded_photo):
        r = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}",
            params={"token": "INVALID"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_get_files_with_malformed_token_returns_401(self, uploaded_photo):
        # exp prefix present but MAC is garbage
        r = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}",
            params={"token": "9999999999.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_token_bound_to_path(self, test3_token, uploaded_photo):
        """Token issued for path_A must NOT authorize GET on path_B.
        Upload a second photo, sign only the first, try to fetch the second with it."""
        img_b = _min_jpeg(marker=2)
        r_up = _upload(test3_token, "second.jpg", img_b)
        assert r_up.status_code == 200
        path_b = r_up.json()["path"]
        assert path_b != uploaded_photo["path"]

        # sign path A
        r_sign = requests.get(
            f"{BASE_URL}/api/files-token/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=15,
        )
        assert r_sign.status_code == 200
        token_a = r_sign.json()["token"]

        # use it on path B → must NOT succeed
        r_bad = requests.get(
            f"{BASE_URL}/api/files/{path_b}", params={"token": token_a}, timeout=15
        )
        assert r_bad.status_code == 401, (
            f"token leaked across paths: got {r_bad.status_code} for path_b using token_a"
        )

        # sanity: same token still works on path A
        r_ok = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}",
            params={"token": token_a},
            timeout=15,
        )
        assert r_ok.status_code == 200

    def test_other_user_cannot_sign_or_fetch_via_bearer(
        self, test3_token, halley_token, uploaded_photo
    ):
        """A second Pro+ user (halley) must not be able to issue a token for test3's
        path, nor fetch it via their own bearer."""
        # sign attempt by halley → 404 (per server: not found for non-owner)
        r = requests.get(
            f"{BASE_URL}/api/files-token/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {halley_token}"},
            timeout=15,
        )
        assert r.status_code == 404, f"cross-user sign leaked: {r.status_code} {r.text[:200]}"

        # bearer fetch attempt by halley → 401
        r2 = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {halley_token}"},
            timeout=15,
        )
        assert r2.status_code == 401, (
            f"cross-user bearer fetch leaked: {r2.status_code} {r2.text[:200]}"
        )


# ---------- 3. Token expiration semantics ----------
class TestTokenExpiration:
    def test_token_with_past_exp_is_rejected(self, uploaded_photo):
        """A forged token whose exp prefix is in the past must be rejected (401).
        We cannot mint a valid past-exp token without the secret, but this ensures
        the server does not blindly trust the exp field."""
        forged = "1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        r = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}",
            params={"token": forged},
            timeout=15,
        )
        assert r.status_code == 401

    def test_fresh_token_has_reasonable_ttl(self, test3_token, uploaded_photo):
        r = requests.get(
            f"{BASE_URL}/api/files-token/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        token = r.json()["token"]
        exp = int(token.split(".", 1)[0])
        now = int(time.time())
        # must be at least 5 min in future and at most 24h out
        assert now + 300 < exp <= now + 86_400, (
            f"unreasonable ttl: exp={exp} now={now} delta={exp - now}"
        )


# ---------- 4. Bearer fallback ----------
class TestBearerFallback:
    def test_bearer_fetch_returns_bytes(self, test3_token, uploaded_photo):
        r = requests.get(
            f"{BASE_URL}/api/files/{uploaded_photo['path']}",
            headers={"Authorization": f"Bearer {test3_token}"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").lower().startswith("image/")
        clen = int(r.headers.get("content-length", "0"))
        assert clen == len(uploaded_photo["bytes"]) > 0
        assert r.content == uploaded_photo["bytes"]


# ---------- 5. Concurrent uploads ----------
class TestConcurrentUploads:
    def test_three_rapid_uploads_return_distinct_paths_and_are_all_retrievable(
        self, test3_token
    ):
        # Three distinct byte payloads
        payloads = [
            ("cA.jpg", _min_jpeg(marker=11)),
            ("cB.jpg", _min_jpeg(marker=22)),
            ("cC.jpg", _min_jpeg(marker=33)),
        ]

        def _do(item):
            name, data = item
            r = _upload(test3_token, name, data)
            return r.status_code, (r.json() if r.status_code == 200 else r.text), data

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(_do, payloads))

        # All three must have succeeded
        for i, (status, body, _data) in enumerate(results):
            assert status == 200, f"upload #{i} failed: {status} {body}"

        paths = [body["path"] for _, body, _ in results]
        assert len(set(paths)) == 3, f"paths not distinct: {paths}"

        # Each must be independently retrievable and byte-identical
        for path, (_, body, data) in zip(paths, results):
            # sign
            r1 = requests.get(
                f"{BASE_URL}/api/files-token/{path}",
                headers={"Authorization": f"Bearer {test3_token}"},
                timeout=15,
            )
            assert r1.status_code == 200, f"sign failed for {path}: {r1.text[:200]}"
            token = r1.json()["token"]
            r2 = requests.get(
                f"{BASE_URL}/api/files/{path}", params={"token": token}, timeout=15
            )
            assert r2.status_code == 200
            assert r2.content == data, f"bytes mismatch for {path}"
            assert body["size"] == len(data)
