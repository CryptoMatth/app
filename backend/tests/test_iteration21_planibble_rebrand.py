"""Iteration 21 — Planibble rebrand + Pro+ subscription expiry handling.

Covers:
- registered_at on new registrations and legacy users (halley/testpro).
- /auth/me exposes pro_plus_expires_at + pro_plus_will_renew.
- Fridge: expired items are NOT deleted on GET /fridge or clear-checked.
- RevenueCat webhook grant / cancellation / expiration flows.
- _get_tier safety-net for stale expires_at via admin seeded doc.
"""
import os
import time
import uuid
import json
import hashlib
import hmac
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://meal-prep-master-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

HALLEY_U, HALLEY_P = "halley", "halley1234"
PRO_U, PRO_P = "testpro", "testPro123"
ADMIN_PWD = "planeat-admin-CH4ngeMe-2026"
ADMIN_HDR = {"X-Admin-Password": ADMIN_PWD}


@pytest.fixture(scope="module")
def session():
    return requests.Session()


def _login(session, u, p):
    r = session.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=15)
    assert r.status_code == 200, f"login {u} => {r.status_code} {r.text}"
    return r.json()["session_token"]


# ---------- M5 registered_at ----------
class TestRegisteredAt:
    def test_register_new_user_has_registered_at(self, session):
        uname = f"test{int(time.time()*1000) % 10_000_000}"
        r = session.post(f"{API}/auth/register", json={
            "username": uname, "password": "pass1234", "password_repeat": "pass1234"
        }, timeout=15)
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user.get("registered_at"), "registered_at missing on register response"
        # ISO datetime parse sanity
        from datetime import datetime
        datetime.fromisoformat(user["registered_at"].replace("Z", "+00:00"))

        token = r.json()["session_token"]
        me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert me.status_code == 200
        assert me.json().get("registered_at"), "registered_at missing on /auth/me"

    def test_halley_registered_at_backfilled(self, session):
        tok = _login(session, HALLEY_U, HALLEY_P)
        me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
        assert me.get("registered_at"), f"halley registered_at missing: {me}"

    def test_testpro_registered_at_backfilled(self, session):
        tok = _login(session, PRO_U, PRO_P)
        me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
        assert me.get("registered_at"), f"testpro registered_at missing: {me}"


# ---------- D1/D2 pro_plus_expires_at / will_renew ----------
class TestProPlusExpiryFields:
    def test_me_includes_pro_plus_expires_fields(self, session):
        tok = _login(session, HALLEY_U, HALLEY_P)
        me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
        # keys must exist (even if null for founder/lifetime)
        assert "pro_plus_expires_at" in me, me
        assert "pro_plus_will_renew" in me, me
        # halley is a founder (no RC subscription) → expect None
        assert me["pro_plus_expires_at"] is None
        assert me["pro_plus_will_renew"] is None
        assert me["tier"] == "pro_plus"


# ---------- M7 Fridge no-auto-remove ----------
class TestFridgeNoAutoRemoveExpired:
    def test_expired_item_persists_in_fridge(self, session):
        tok = _login(session, HALLEY_U, HALLEY_P)
        H = {"Authorization": f"Bearer {tok}"}
        name = f"TEST_expired_{uuid.uuid4().hex[:8]}"
        r = session.post(f"{API}/fridge", headers=H, json={
            "name": name, "quantity": 1, "unit": "pz",
            "expiries": [{"date": "2025-01-01", "label": None}],
        }, timeout=15)
        assert r.status_code == 200, r.text
        item_id = r.json()["id"]

        # GET /fridge should still include it
        lst = session.get(f"{API}/fridge", headers=H, timeout=15).json()
        found = [x for x in lst if x["id"] == item_id]
        assert found, f"expired fridge item was deleted on list: {name}"
        assert found[0]["expiries"], "expiries lost"

        # clear-checked should also NOT delete it (no checked items anyway, but
        # verify item persists after calling the endpoint).
        c = session.post(f"{API}/shopping/clear-checked", headers=H, timeout=15)
        assert c.status_code == 200
        lst2 = session.get(f"{API}/fridge", headers=H, timeout=15).json()
        assert any(x["id"] == item_id for x in lst2), "expired item removed by clear-checked"

        # cleanup
        session.delete(f"{API}/fridge/{item_id}", headers=H, timeout=15)


# ---------- RevenueCat webhook ----------
def _ensure_rc_user(session):
    """Admin lookup of testpro user_id (acts as RC app_user_id)."""
    r = session.get(f"{API}/admin/users", headers=ADMIN_HDR, timeout=15)
    assert r.status_code == 200, r.text
    users = r.json() if isinstance(r.json(), list) else r.json().get("users", [])
    tp = next((u for u in users if u.get("username") == PRO_U), None)
    assert tp, "testpro user not found via admin"
    return tp["user_id"]


def _rc_signed_headers(secret: str, raw: bytes):
    ts = int(time.time())
    signed = f"{ts}.".encode() + raw
    sig = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return {"X-RevenueCat-Webhook-Signature": f"t={ts},v1={sig}"}


class TestRevenueCatWebhook:
    """Simulate the full subscription lifecycle on testpro."""

    @pytest.fixture(scope="class")
    def rc_env(self, session):
        auth = os.environ.get("RC_WEBHOOK_AUTH", "").strip()
        if not auth:
            pytest.skip("RC_WEBHOOK_AUTH not configured on backend .env")
        secret = os.environ.get("RC_WEBHOOK_HMAC_SECRET", "").strip()
        user_id = _ensure_rc_user(session)
        return {"auth": auth, "secret": secret, "user_id": user_id}

    def _post_event(self, session, rc_env, event):
        payload = json.dumps({"event": event}).encode()
        headers = {
            "Authorization": f"Bearer {rc_env['auth']}",
            "Content-Type": "application/json",
        }
        if rc_env["secret"]:
            headers.update(_rc_signed_headers(rc_env["secret"], payload))
        return session.post(
            f"{API}/integrations/revenuecat/webhook",
            data=payload, headers=headers, timeout=15,
        )

    def _me_as_admin(self, session, user_id):
        r = session.get(f"{API}/admin/users/{user_id}", headers=ADMIN_HDR, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_initial_purchase_grants_pro_plus_with_expiry(self, session, rc_env):
        future_ms = int((time.time() + 30 * 86400) * 1000)
        ev = {
            "id": f"ev_init_{uuid.uuid4().hex}",
            "type": "INITIAL_PURCHASE",
            "app_user_id": rc_env["user_id"],
            "product_id": "pro_plus_subscription:monthly",
            "entitlement_ids": ["pro_plus"],
            "expiration_at_ms": future_ms,
            "purchased_at_ms": int(time.time() * 1000),
            "transaction_id": "txn_" + uuid.uuid4().hex,
        }
        r = self._post_event(session, rc_env, ev)
        assert r.status_code == 200, r.text
        u = self._me_as_admin(session, rc_env["user_id"])
        pp = (u.get("entitlements") or {}).get("pro_plus") or {}
        assert pp.get("active") is True, pp
        assert pp.get("will_renew") is True, pp
        assert pp.get("expires_at"), pp

    def test_cancellation_keeps_active_but_will_renew_false(self, session, rc_env):
        future_ms = int((time.time() + 30 * 86400) * 1000)
        ev = {
            "id": f"ev_cancel_{uuid.uuid4().hex}",
            "type": "CANCELLATION",
            "app_user_id": rc_env["user_id"],
            "product_id": "pro_plus_subscription:monthly",
            "entitlement_ids": ["pro_plus"],
            "expiration_at_ms": future_ms,
        }
        r = self._post_event(session, rc_env, ev)
        assert r.status_code == 200, r.text
        u = self._me_as_admin(session, rc_env["user_id"])
        pp = (u.get("entitlements") or {}).get("pro_plus") or {}
        assert pp.get("active") is True, pp  # grace period
        assert pp.get("will_renew") is False, pp
        assert pp.get("cancel_reason") == "CANCELLATION", pp

    def test_expiration_revokes_pro_plus(self, session, rc_env):
        ev = {
            "id": f"ev_exp_{uuid.uuid4().hex}",
            "type": "EXPIRATION",
            "app_user_id": rc_env["user_id"],
            "product_id": "pro_plus_subscription:monthly",
            "entitlement_ids": ["pro_plus"],
        }
        r = self._post_event(session, rc_env, ev)
        assert r.status_code == 200, r.text
        u = self._me_as_admin(session, rc_env["user_id"])
        pp = (u.get("entitlements") or {}).get("pro_plus") or {}
        assert pp.get("active") is False, pp
        assert pp.get("revoked_at"), pp
        # Teardown: restore testpro entitlement to pro (admin grant) so other tests work.
        session.post(
            f"{API}/admin/users/{rc_env['user_id']}/entitlements/pro",
            headers=ADMIN_HDR, json={"active": True, "reason": "test teardown"}, timeout=15,
        )


# ---------- _get_tier safety-net for stale expires_at ----------
class TestGetTierSafetyNet:
    def test_stale_expires_downgrades_tier(self, session):
        # Grant pro_plus to testpro via admin, then manually inject a past
        # expires_at via admin DB write. Admin doesn't expose arbitrary edits,
        # so we rely on the webhook flow with a past expiration date + grant.
        user_id = _ensure_rc_user(session)
        auth = os.environ.get("RC_WEBHOOK_AUTH", "").strip()
        if not auth:
            pytest.skip("RC_WEBHOOK_AUTH not configured")
        secret = os.environ.get("RC_WEBHOOK_HMAC_SECRET", "").strip()

        past_ms = int((time.time() - 86400) * 1000)
        ev = {
            "id": f"ev_stale_{uuid.uuid4().hex}",
            "type": "INITIAL_PURCHASE",
            "app_user_id": user_id,
            "product_id": "pro_plus_subscription:monthly",
            "entitlement_ids": ["pro_plus"],
            "expiration_at_ms": past_ms,
            "purchased_at_ms": past_ms,
        }
        raw = json.dumps({"event": ev}).encode()
        headers = {"Authorization": f"Bearer {auth}", "Content-Type": "application/json"}
        if secret:
            headers.update(_rc_signed_headers(secret, raw))
        r = session.post(f"{API}/integrations/revenuecat/webhook", data=raw, headers=headers, timeout=15)
        assert r.status_code == 200, r.text

        # The grant writes active=true with a past expires_at; the per-request
        # safety-net in _get_tier should ignore it. testpro also has pro
        # entitlement from seed → tier must be 'pro' (NOT 'pro_plus').
        tok = _login(session, PRO_U, PRO_P)
        me = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
        assert me["tier"] in ("pro", "free"), f"stale pro_plus leaked: {me}"
        # Teardown: wipe pro_plus entitlement via admin
        session.post(
            f"{API}/admin/users/{user_id}/entitlements/pro_plus",
            headers=ADMIN_HDR, json={"active": False, "reason": "test teardown"}, timeout=15,
        )
