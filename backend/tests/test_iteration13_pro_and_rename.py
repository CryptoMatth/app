"""Iteration 13 tests: Pro entitlements + dish rename propagation.

Covers:
  1. `is_pro` + `pro_source` fields in /auth/me and login/register user payload
  2. FOUNDER_USERNAMES (halley, matteo, admin) auto-get is_pro=true / pro_source=founder
     - Case-insensitive registration (`Halley`, `HALLEY` normalized to `halley`)
  3. Admin POST /api/admin/users/{id}/entitlements/pro with {active, reason}
     - Grant/revoke, auth checks (missing / wrong password), 404 for unknown user
     - Entitlements not wiped by unrelated PUT /auth/preferences
  4. PUT /api/dishes/{id} rename propagation into weekly_plans.slots.items[]
     and shopping_items.sources[]
  5. Rename dish not referenced anywhere → still succeeds
  6. Idempotent when name unchanged
  7. Non-name changes (course, prep, notes, servings) do NOT touch weekly_plans
     or shopping_items entries

Run:
    pytest /app/backend/tests/test_iteration13_pro_and_rename.py -v \
        --junitxml=/app/test_reports/pytest/pytest_iteration13.xml
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pytest
import requests
from dotenv import load_dotenv


load_dotenv(Path("/app/backend/.env"))
load_dotenv(Path("/app/frontend/.env"))

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_PW = os.environ.get("ADMIN_PASSWORD") or "planeat-admin-CH4ngeMe-2026"
ADMIN_H = {"X-Admin-Password": ADMIN_PW}

FOUNDERS = ("halley", "matteo", "admin")


# ---------------- helpers ----------------
def _uniq(prefix: str = "it13") -> str:
    return f"{prefix}{int(time.time() * 1000) % 10_000_000}{uuid.uuid4().hex[:4]}"


def _delete_user_by_username(username: str) -> None:
    """Best-effort cleanup via admin API so we can (re)register a founder username."""
    r = requests.get(f"{API}/admin/users", headers=ADMIN_H, timeout=15)
    if r.status_code != 200:
        return
    for u in r.json():
        if (u.get("username") or "").lower() == username.lower():
            requests.delete(f"{API}/admin/users/{u['user_id']}", headers=ADMIN_H, timeout=15)


def _register(username: Optional[str] = None, password: str = "pass1234") -> Dict[str, Any]:
    username = username or _uniq()
    r = requests.post(f"{API}/auth/register", json={
        "username": username, "password": password, "password_repeat": password,
    }, timeout=15)
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    return r.json()


def _login(username: str, password: str = "pass1234") -> Dict[str, Any]:
    r = requests.post(f"{API}/auth/login", json={
        "username": username, "password": password,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_dish(token: str, name: str,
               ingredients: Optional[List[Dict[str, Any]]] = None,
               servings: int = 2, course: str = "primo",
               preparation: str = "", notes: str = "") -> Dict[str, Any]:
    r = requests.post(f"{API}/dishes", headers=_auth(token), json={
        "name": name, "course": course, "servings": servings,
        "ingredients": ingredients or [], "preparation": preparation, "notes": notes,
    }, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# =====================================================================
# 1) Pro / entitlements
# =====================================================================
class TestProEntitlementFields:
    def test_fresh_non_founder_is_not_pro(self):
        reg = _register(_uniq("nfp"))
        u = reg["user"]
        assert u.get("is_pro") is False, u
        assert u.get("pro_source") is None, u
        # /auth/me confirms
        me = requests.get(f"{API}/auth/me", headers=_auth(reg["session_token"]), timeout=10)
        assert me.status_code == 200
        assert me.json()["is_pro"] is False
        assert me.json()["pro_source"] is None

    def test_login_response_carries_pro_fields(self):
        username = _uniq("lpf")
        _register(username)
        data = _login(username)
        assert "is_pro" in data["user"] and "pro_source" in data["user"]
        assert data["user"]["is_pro"] is False
        assert data["user"]["pro_source"] is None


class TestFounderWhitelist:
    @pytest.mark.parametrize("input_username,stored", [
        ("halley", "halley"),
        ("Halley", "halley"),
        ("HALLEY", "halley"),
        ("matteo", "matteo"),
        ("admin", "admin"),
    ])
    def test_founder_registration_marks_pro(self, input_username, stored):
        _delete_user_by_username(stored)
        reg = _register(input_username)
        u = reg["user"]
        assert u["username"] == stored, u
        assert u["is_pro"] is True, u
        assert u["pro_source"] == "founder", u

        # /auth/me confirms
        me = requests.get(f"{API}/auth/me", headers=_auth(reg["session_token"]), timeout=10).json()
        assert me["is_pro"] is True and me["pro_source"] == "founder"

        # Cleanup so this test remains idempotent for subsequent runs
        _delete_user_by_username(stored)

    def test_regular_username_is_not_pro(self):
        username = _uniq("reg")
        reg = _register(username)
        assert reg["user"]["is_pro"] is False
        assert reg["user"]["pro_source"] is None


class TestAdminEntitlementEndpoint:
    def test_grant_and_revoke_pro_for_regular_user(self):
        reg = _register(_uniq("adg"))
        uid = reg["user"]["user_id"]
        token = reg["session_token"]

        # Grant
        r = requests.post(
            f"{API}/admin/users/{uid}/entitlements/pro",
            headers=ADMIN_H, json={"active": True, "reason": "beta"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        payload = r.json()
        assert payload["ok"] is True
        pro = payload["entitlements"]["pro"]
        assert pro["active"] is True
        assert pro["source"] == "admin_grant"
        assert pro["reason"] == "beta"
        assert "granted_at" in pro

        me = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).json()
        assert me["is_pro"] is True
        assert me["pro_source"] == "admin_grant"

        # Unrelated preference update must NOT wipe entitlements
        rp = requests.put(f"{API}/auth/preferences", headers=_auth(token),
                          json={"week_start_day": 3}, timeout=10)
        assert rp.status_code == 200
        me2 = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).json()
        assert me2["is_pro"] is True, me2
        assert me2["pro_source"] == "admin_grant"
        assert me2["preferences"]["week_start_day"] == 3

        # Revoke
        r = requests.post(
            f"{API}/admin/users/{uid}/entitlements/pro",
            headers=ADMIN_H, json={"active": False}, timeout=15,
        )
        assert r.status_code == 200, r.text
        pro2 = r.json()["entitlements"]["pro"]
        assert pro2["active"] is False
        assert pro2["source"] == "admin_grant"
        assert "revoked_at" in pro2

        me3 = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).json()
        assert me3["is_pro"] is False
        assert me3["pro_source"] is None

    def test_grant_without_admin_password_401(self):
        reg = _register(_uniq("adx"))
        uid = reg["user"]["user_id"]
        r = requests.post(
            f"{API}/admin/users/{uid}/entitlements/pro",
            json={"active": True}, timeout=15,
        )
        assert r.status_code == 401, r.text

    def test_grant_wrong_admin_password_401(self):
        reg = _register(_uniq("adw"))
        uid = reg["user"]["user_id"]
        r = requests.post(
            f"{API}/admin/users/{uid}/entitlements/pro",
            headers={"X-Admin-Password": "totally-wrong"},
            json={"active": True}, timeout=15,
        )
        assert r.status_code == 401

    def test_grant_unknown_user_404(self):
        r = requests.post(
            f"{API}/admin/users/does-not-exist/entitlements/pro",
            headers=ADMIN_H, json={"active": True}, timeout=15,
        )
        assert r.status_code == 404

    def test_founder_admin_grant_is_still_pro_after_revoke(self):
        """A founder username stays is_pro=True even if admin explicitly revokes.
        (Because whitelist wins over entitlements.pro.active.)"""
        _delete_user_by_username("admin")
        reg = _register("admin")
        uid = reg["user"]["user_id"]
        token = reg["session_token"]
        # Revoke via admin
        r = requests.post(
            f"{API}/admin/users/{uid}/entitlements/pro",
            headers=ADMIN_H, json={"active": False}, timeout=15,
        )
        assert r.status_code == 200
        me = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).json()
        assert me["is_pro"] is True  # founder whitelist wins
        assert me["pro_source"] == "founder"
        _delete_user_by_username("admin")


# =====================================================================
# 2) Dish rename propagation
# =====================================================================
WEEK = "2026-12-07"


class TestDishRenamePropagation:
    def _seed_dish_in_slot(self, token: str) -> Tuple[str, str]:
        dish = _make_dish(token, "Alpha", ingredients=[
            {"name": "Farina", "quantity": 100, "unit": "g"},
            {"name": "Zucchero", "quantity": 20, "unit": "g"},
        ], servings=2)
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 0, "meal": "pranzo",
            "items": [{"dish_id": dish["id"], "persons": 2}],
        }, timeout=10)
        assert r.status_code == 200, r.text
        return dish["id"], "Alpha"

    def test_planner_shows_old_name_before_rename(self):
        reg = _register(_uniq("rn0"))
        token = reg["session_token"]
        dish_id, _ = self._seed_dish_in_slot(token)
        plan = requests.get(f"{API}/planner/{WEEK}", headers=_auth(token), timeout=10).json()
        slot = plan["slots"]["0_pranzo"]
        assert slot["items"][0]["dish_id"] == dish_id
        assert slot["items"][0]["dish_name"] == "Alpha"

    def test_rename_propagates_to_planner_items(self):
        reg = _register(_uniq("rn1"))
        token = reg["session_token"]
        dish_id, _ = self._seed_dish_in_slot(token)

        r = requests.put(f"{API}/dishes/{dish_id}", headers=_auth(token), json={
            "name": "Beta", "course": "primo", "servings": 2,
            "ingredients": [
                {"name": "Farina", "quantity": 100, "unit": "g"},
                {"name": "Zucchero", "quantity": 20, "unit": "g"},
            ],
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Beta"

        plan = requests.get(f"{API}/planner/{WEEK}", headers=_auth(token), timeout=10).json()
        slot = plan["slots"]["0_pranzo"]
        assert slot["items"][0]["dish_id"] == dish_id
        assert slot["items"][0]["dish_name"] == "Beta", slot

    def test_rename_propagates_to_shopping_sources(self):
        reg = _register(_uniq("rn2"))
        token = reg["session_token"]
        dish_id, _ = self._seed_dish_in_slot(token)

        # Sanity: shopping sources initially point to Alpha
        shopping0 = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        assert any(
            any(src.get("dish_name") == "Alpha" and src.get("dish_id") == dish_id
                for src in it.get("sources", []))
            for it in shopping0
        ), shopping0

        # Rename
        r = requests.put(f"{API}/dishes/{dish_id}", headers=_auth(token), json={
            "name": "Beta", "course": "primo", "servings": 2,
            "ingredients": [
                {"name": "Farina", "quantity": 100, "unit": "g"},
                {"name": "Zucchero", "quantity": 20, "unit": "g"},
            ],
        }, timeout=15)
        assert r.status_code == 200

        shopping = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        # All sources for this dish_id must now say "Beta"
        seen = 0
        for it in shopping:
            for src in it.get("sources", []):
                if src.get("dish_id") == dish_id:
                    assert src.get("dish_name") == "Beta", src
                    seen += 1
        assert seen >= 2, f"expected sources for both ingredients, saw {seen}: {shopping}"

    def test_rename_dish_not_in_any_slot_or_shopping(self):
        reg = _register(_uniq("rn3"))
        token = reg["session_token"]
        dish = _make_dish(token, "Orphan", ingredients=[
            {"name": "Sale", "quantity": 5, "unit": "g"},
        ])
        r = requests.put(f"{API}/dishes/{dish['id']}", headers=_auth(token), json={
            "name": "Orphan2", "course": "primo", "servings": 2,
            "ingredients": [{"name": "Sale", "quantity": 5, "unit": "g"}],
        }, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "Orphan2"
        # Nothing in shopping/planner references it → safe
        s = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        # No sources should mention this dish
        for it in s:
            for src in it.get("sources", []):
                assert src.get("dish_id") != dish["id"]

    def test_rename_idempotent_when_name_unchanged(self):
        reg = _register(_uniq("rn4"))
        token = reg["session_token"]
        dish_id, _ = self._seed_dish_in_slot(token)
        # PUT with same name — should still succeed and not corrupt anything
        r = requests.put(f"{API}/dishes/{dish_id}", headers=_auth(token), json={
            "name": "Alpha", "course": "primo", "servings": 2,
            "ingredients": [
                {"name": "Farina", "quantity": 100, "unit": "g"},
                {"name": "Zucchero", "quantity": 20, "unit": "g"},
            ],
        }, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "Alpha"
        plan = requests.get(f"{API}/planner/{WEEK}", headers=_auth(token), timeout=10).json()
        assert plan["slots"]["0_pranzo"]["items"][0]["dish_name"] == "Alpha"

    def test_non_name_changes_do_not_alter_planner_or_shopping(self):
        """Change course/preparation/notes/servings → planner items[] and shopping
        sources[] remain untouched (dish_name unchanged, shopping planner_qty
        remains based on the persons setting from the slot, NOT the new
        `servings` on the dish, because we did not re-apply the slot)."""
        reg = _register(_uniq("rn5"))
        token = reg["session_token"]
        # Dish w/ servings=2 → slot persons=2 → 1x multiplier
        dish = _make_dish(token, "Gamma", ingredients=[
            {"name": "Farina", "quantity": 100, "unit": "g"},
        ], servings=2, preparation="p1", notes="n1", course="primo")
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 1, "meal": "cena",
            "items": [{"dish_id": dish["id"], "persons": 2}],
        }, timeout=10)
        assert r.status_code == 200

        s_before = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        farina_before = next(x for x in s_before if x["name"] == "Farina")
        assert farina_before["planner_qty"] == 100.0

        # Non-name update
        r = requests.put(f"{API}/dishes/{dish['id']}", headers=_auth(token), json={
            "name": "Gamma",  # unchanged
            "course": "secondo",
            "servings": 5,
            "preparation": "p2",
            "notes": "n2",
            "ingredients": [{"name": "Farina", "quantity": 100, "unit": "g"}],
        }, timeout=15)
        assert r.status_code == 200
        assert r.json()["course"] == "secondo"

        # Planner slot dish_name still Gamma; and planner_qty unchanged
        plan = requests.get(f"{API}/planner/{WEEK}", headers=_auth(token), timeout=10).json()
        item = plan["slots"]["1_cena"]["items"][0]
        assert item["dish_name"] == "Gamma"
        # Note: `course` on the slot item is cached from the slot-put time. Not
        # required to update on non-name dish changes per spec.
        s_after = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        farina_after = next(x for x in s_after if x["name"] == "Farina")
        assert farina_after["planner_qty"] == farina_before["planner_qty"], (farina_before, farina_after)
        # sources dish_name still Gamma
        for src in farina_after.get("sources", []):
            if src.get("dish_id") == dish["id"]:
                assert src.get("dish_name") == "Gamma"

    def test_rename_propagates_across_multiple_weeks(self):
        reg = _register(_uniq("rn6"))
        token = reg["session_token"]
        dish = _make_dish(token, "Multi", ingredients=[
            {"name": "Riso", "quantity": 80, "unit": "g"},
        ], servings=1)
        for wk in ("2027-03-01", "2027-03-08"):
            r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
                "week_start": wk, "day_index": 0, "meal": "pranzo",
                "items": [{"dish_id": dish["id"], "persons": 1}],
            }, timeout=10)
            assert r.status_code == 200
        # rename
        r = requests.put(f"{API}/dishes/{dish['id']}", headers=_auth(token), json={
            "name": "Multi2", "course": "primo", "servings": 1,
            "ingredients": [{"name": "Riso", "quantity": 80, "unit": "g"}],
        }, timeout=15)
        assert r.status_code == 200
        # both planners should show Multi2
        for wk in ("2027-03-01", "2027-03-08"):
            plan = requests.get(f"{API}/planner/{wk}", headers=_auth(token), timeout=10).json()
            assert plan["slots"]["0_pranzo"]["items"][0]["dish_name"] == "Multi2", (wk, plan)


# =====================================================================
# 3) Minimal regression: cross-user isolation for rename
# =====================================================================
class TestRenameCrossUserIsolation:
    def test_rename_does_not_touch_other_users(self):
        # user A creates dish + slot
        a = _register(_uniq("crA"))
        b = _register(_uniq("crB"))
        dish_a = _make_dish(a["session_token"], "Alpha", ingredients=[
            {"name": "Ing", "quantity": 10, "unit": "g"}
        ])
        # user B creates dish with same id-space (different user) and adds to shopping via slot
        dish_b = _make_dish(b["session_token"], "Alpha", ingredients=[
            {"name": "Ing", "quantity": 10, "unit": "g"}
        ])
        for token, did in ((a["session_token"], dish_a["id"]), (b["session_token"], dish_b["id"])):
            r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
                "week_start": WEEK, "day_index": 0, "meal": "pranzo",
                "items": [{"dish_id": did, "persons": 1}],
            }, timeout=10)
            assert r.status_code == 200

        # A renames Alpha → Alpha2
        r = requests.put(f"{API}/dishes/{dish_a['id']}", headers=_auth(a["session_token"]), json={
            "name": "Alpha2", "course": "primo", "servings": 2,
            "ingredients": [{"name": "Ing", "quantity": 10, "unit": "g"}],
        }, timeout=15)
        assert r.status_code == 200

        # B's planner still Alpha
        plan_b = requests.get(f"{API}/planner/{WEEK}", headers=_auth(b["session_token"]), timeout=10).json()
        assert plan_b["slots"]["0_pranzo"]["items"][0]["dish_name"] == "Alpha", plan_b
        # A's planner is Alpha2
        plan_a = requests.get(f"{API}/planner/{WEEK}", headers=_auth(a["session_token"]), timeout=10).json()
        assert plan_a["slots"]["0_pranzo"]["items"][0]["dish_name"] == "Alpha2"
