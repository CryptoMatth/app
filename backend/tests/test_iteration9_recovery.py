"""Backend tests for recovery-codes password reset flow (iteration 9)."""
import os
import re
import time
import secrets
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://meal-prep-master-2.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"
CODE_RE = re.compile(r"^[A-Z0-9]{4}-[A-Z0-9]{4}$")
SAFE_ALPHABET = set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")


def _uname(prefix="rec"):
    return f"{prefix}{int(time.time()*1000)}{secrets.token_hex(3)}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def registered_user(session):
    u = _uname("rec")
    r = session.post(f"{API}/auth/register", json={"username": u, "password": "pass1234", "password_repeat": "pass1234"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "recovery_codes" in data
    return {"username": u, "token": data["session_token"], "codes": data["recovery_codes"], "user": data["user"]}


class TestRegisterRecoveryCodes:
    def test_register_returns_8_codes_correct_format(self, registered_user):
        codes = registered_user["codes"]
        assert isinstance(codes, list) and len(codes) == 8
        for c in codes:
            assert CODE_RE.fullmatch(c), f"Bad code format: {c}"
            for ch in c.replace("-", ""):
                assert ch in SAFE_ALPHABET, f"Unsafe char {ch} in {c}"
        # All unique
        assert len(set(codes)) == 8

    def test_recovery_status_after_register(self, session, registered_user):
        h = {"Authorization": f"Bearer {registered_user['token']}"}
        r = session.get(f"{API}/auth/recovery/status", headers=h)
        assert r.status_code == 200
        d = r.json()
        assert d == {"remaining": 8, "total": 8}


class TestRecoveryVerify:
    def test_reset_with_valid_code(self, session, registered_user):
        # Use fresh user to avoid interference
        u = _uname("recv")
        reg = session.post(f"{API}/auth/register", json={"username": u, "password": "pass1234", "password_repeat": "pass1234"}).json()
        codes = reg["recovery_codes"]
        old_token = reg["session_token"]

        r = session.post(f"{API}/auth/recovery/verify", json={"username": u, "code": codes[0], "new_password": "newpass1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "session_token" in body and "user" in body
        new_token = body["session_token"]
        assert new_token != old_token

        # Old session invalidated
        r2 = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {old_token}"})
        assert r2.status_code == 401

        # New session works
        r3 = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {new_token}"})
        assert r3.status_code == 200

        # Login with new password
        r4 = session.post(f"{API}/auth/login", json={"username": u, "password": "newpass1"})
        assert r4.status_code == 200

        # Status: remaining decreased
        r5 = session.get(f"{API}/auth/recovery/status", headers={"Authorization": f"Bearer {new_token}"})
        assert r5.status_code == 200
        assert r5.json() == {"remaining": 7, "total": 8}

        # Second use of same code fails
        r6 = session.post(f"{API}/auth/recovery/verify", json={"username": u, "code": codes[0], "new_password": "another1"})
        assert r6.status_code == 400

    def test_wrong_code_returns_400(self, session, registered_user):
        r = session.post(f"{API}/auth/recovery/verify", json={"username": registered_user["username"], "code": "ZZZZ-ZZZZ", "new_password": "pass9999"})
        assert r.status_code == 400

    def test_short_password_returns_400(self, session, registered_user):
        r = session.post(f"{API}/auth/recovery/verify", json={"username": registered_user["username"], "code": registered_user["codes"][1], "new_password": "abc"})
        assert r.status_code == 400

    def test_missing_username_returns_4xx(self, session):
        r = session.post(f"{API}/auth/recovery/verify", json={"code": "AAAA-BBBB", "new_password": "pass1234"})
        assert 400 <= r.status_code < 500

    def test_rate_limit_429_after_5_wrong(self, session):
        u = _uname("recrl")
        session.post(f"{API}/auth/register", json={"username": u, "password": "pass1234", "password_repeat": "pass1234"})
        statuses = []
        for _ in range(6):
            r = session.post(f"{API}/auth/recovery/verify", json={"username": u, "code": "ZZZZ-ZZZZ", "new_password": "newpass1"})
            statuses.append(r.status_code)
        assert 429 in statuses, f"Expected 429 rate limit, got {statuses}"


class TestRecoveryRegenerate:
    def test_regenerate_invalidates_old_and_returns_new(self, session):
        u = _uname("regen")
        reg = session.post(f"{API}/auth/register", json={"username": u, "password": "pass1234", "password_repeat": "pass1234"}).json()
        old_codes = reg["recovery_codes"]
        token = reg["session_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = session.post(f"{API}/auth/recovery/regenerate", headers=h)
        assert r.status_code == 200
        new_codes = r.json()["recovery_codes"]
        assert len(new_codes) == 8
        assert set(new_codes).isdisjoint(set(old_codes))
        for c in new_codes:
            assert CODE_RE.fullmatch(c)

        # Old code should not verify
        r2 = session.post(f"{API}/auth/recovery/verify", json={"username": u, "code": old_codes[0], "new_password": "newpass1"})
        assert r2.status_code == 400

        # New code works
        r3 = session.post(f"{API}/auth/recovery/verify", json={"username": u, "code": new_codes[0], "new_password": "newpass2"})
        assert r3.status_code == 200

    def test_regenerate_requires_auth(self, session):
        r = session.post(f"{API}/auth/recovery/regenerate")
        assert r.status_code == 401


class TestRecoveryStatusAuth:
    def test_status_requires_auth(self, session):
        r = session.get(f"{API}/auth/recovery/status")
        assert r.status_code == 401
