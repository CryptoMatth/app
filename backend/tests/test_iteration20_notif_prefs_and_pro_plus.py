"""Iteration 20 backend tests:
 - Notification preferences round-trip (new NotificationPrefs shape).
 - Legacy `enabled` field backward compat.
 - /api/purchases/sync grants pro_plus tier from entitlements=["pro_plus"].
"""

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_BACKEND_URL missing")

API = f"{BASE_URL}/api"


# ---------------------- Fixtures ----------------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def fresh_user(session):
    """Register a fresh user for isolation, return {token, user_id, username}."""
    uname = f"test{int(time.time())}"[:30]
    resp = session.post(
        f"{API}/auth/register",
        json={"username": uname, "password": "pass1234", "password_repeat": "pass1234"},
        timeout=30,
    )
    assert resp.status_code == 200, f"register failed: {resp.status_code} {resp.text}"
    j = resp.json()
    token = j["session_token"]
    return {"token": token, "user_id": j["user"]["user_id"], "username": uname}


@pytest.fixture(scope="module")
def auth_headers(fresh_user):
    return {"Authorization": f"Bearer {fresh_user['token']}", "Content-Type": "application/json"}


# ---------------------- Notification prefs round-trip ----------------------
class TestNotificationPrefs:
    def test_full_new_shape_roundtrip(self, session, auth_headers):
        payload = {
            "notifications": {
                "expiry_enabled": True,
                "freezer_enabled": True,
                "freezer_hours": 12,
                "days_ahead": [3, 1, 0],
                "notify_hour": 8,
            }
        }
        r = session.put(f"{API}/auth/preferences", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        prefs = r.json()
        n = prefs.get("notifications") or {}
        assert n.get("expiry_enabled") is True
        assert n.get("freezer_enabled") is True
        assert n.get("freezer_hours") == 12
        # days_ahead sorted descending & deduped
        assert n.get("days_ahead") == [3, 1, 0]
        assert n.get("notify_hour") == 8

        # Verify via /auth/me
        me = session.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        assert me.status_code == 200
        me_n = (me.json().get("preferences") or {}).get("notifications") or {}
        assert me_n.get("expiry_enabled") is True
        assert me_n.get("freezer_enabled") is True
        assert me_n.get("freezer_hours") == 12
        assert me_n.get("days_ahead") == [3, 1, 0]
        assert me_n.get("notify_hour") == 8

    def test_independent_toggles(self, session, auth_headers):
        # Turn expiry off, keep freezer on
        r = session.put(
            f"{API}/auth/preferences",
            json={"notifications": {"expiry_enabled": False, "freezer_enabled": True}},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200
        n = (r.json().get("notifications") or {})
        assert n.get("expiry_enabled") is False
        assert n.get("freezer_enabled") is True

        # Now flip both independently
        r2 = session.put(
            f"{API}/auth/preferences",
            json={"notifications": {"expiry_enabled": True, "freezer_enabled": False}},
            headers=auth_headers,
            timeout=30,
        )
        assert r2.status_code == 200
        n2 = (r2.json().get("notifications") or {})
        assert n2.get("expiry_enabled") is True
        assert n2.get("freezer_enabled") is False

        # Confirm via GET
        me = session.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        n3 = (me.json().get("preferences") or {}).get("notifications") or {}
        assert n3.get("expiry_enabled") is True
        assert n3.get("freezer_enabled") is False

    def test_freezer_hours_clamped(self, session, auth_headers):
        # Below min (1)
        r = session.put(
            f"{API}/auth/preferences",
            json={"notifications": {"freezer_hours": 0}},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200
        assert (r.json().get("notifications") or {}).get("freezer_hours") == 1

        # Above max (168)
        r2 = session.put(
            f"{API}/auth/preferences",
            json={"notifications": {"freezer_hours": 500}},
            headers=auth_headers,
            timeout=30,
        )
        assert r2.status_code == 200
        assert (r2.json().get("notifications") or {}).get("freezer_hours") == 168

    def test_days_ahead_dedupe_sorted(self, session, auth_headers):
        r = session.put(
            f"{API}/auth/preferences",
            json={"notifications": {"days_ahead": [1, 3, 1, 2, 0, 3]}},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200
        assert (r.json().get("notifications") or {}).get("days_ahead") == [3, 2, 1, 0]

    def test_legacy_enabled_backward_compat(self, session, auth_headers):
        # Send only the legacy master toggle
        r = session.put(
            f"{API}/auth/preferences",
            json={"notifications": {"enabled": True}},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200
        n = r.json().get("notifications") or {}
        assert n.get("enabled") is True
        # Verify persistence via /auth/me
        me = session.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        n2 = (me.json().get("preferences") or {}).get("notifications") or {}
        assert n2.get("enabled") is True

        # Now flip legacy off
        r2 = session.put(
            f"{API}/auth/preferences",
            json={"notifications": {"enabled": False}},
            headers=auth_headers,
            timeout=30,
        )
        assert r2.status_code == 200
        assert (r2.json().get("notifications") or {}).get("enabled") is False


# ---------------------- Purchases sync (Pro+) ----------------------
class TestPurchasesSyncProPlus:
    def test_sync_grants_pro_plus(self, session):
        # Fresh user just for this test so we can observe the grant clearly.
        uname = f"testpp{int(time.time())}"[:30]
        reg = session.post(
            f"{API}/auth/register",
            json={"username": uname, "password": "pass1234", "password_repeat": "pass1234"},
            timeout=30,
        )
        assert reg.status_code == 200, reg.text
        token = reg.json()["session_token"]
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Baseline tier == free
        me1 = session.get(f"{API}/auth/me", headers=headers, timeout=30).json()
        assert me1.get("tier") == "free"
        assert me1.get("is_pro") is False

        # Call /purchases/sync with pro_plus entitlement
        r = session.post(
            f"{API}/purchases/sync",
            json={"revenuecat_app_user_id": me1["user_id"], "entitlements": ["pro_plus"]},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "pro_plus" in body.get("granted", [])

        # After sync, /auth/me should reflect pro_plus tier
        me2 = session.get(f"{API}/auth/me", headers=headers, timeout=30).json()
        assert me2.get("tier") == "pro_plus"
        assert me2.get("is_pro") is True

    def test_sync_grants_pro(self, session):
        uname = f"testp{int(time.time())}"[:30]
        reg = session.post(
            f"{API}/auth/register",
            json={"username": uname, "password": "pass1234", "password_repeat": "pass1234"},
            timeout=30,
        )
        assert reg.status_code == 200, reg.text
        token = reg.json()["session_token"]
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        r = session.post(
            f"{API}/purchases/sync",
            json={"revenuecat_app_user_id": reg.json()["user"]["user_id"], "entitlements": ["pro"]},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 200
        assert "pro" in r.json().get("granted", [])
        me = session.get(f"{API}/auth/me", headers=headers, timeout=30).json()
        assert me.get("tier") == "pro"
        assert me.get("is_pro") is True

    def test_sync_ignores_unknown_entitlement(self, session, auth_headers):
        r = session.post(
            f"{API}/purchases/sync",
            json={"entitlements": ["mystery_tier"]},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json().get("granted", []) == []
