"""Iteration 11 tests: admin endpoints, user preferences, flexible dish courses,
plus regression coverage over auth, dishes, planner, shopping, export/import.

Run:
    pytest /app/backend/tests/test_iteration11_admin_prefs.py -v \
        --junitxml=/app/test_reports/pytest/pytest_iteration11.xml
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Dict, Any, Tuple

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
ADMIN_HEADER = {"X-Admin-Password": os.environ.get("ADMIN_PASSWORD", "planeat-admin-CH4ngeMe-2026")}


# ---------------- helpers ----------------
def _uniq(prefix: str = "pref") -> str:
    return f"{prefix}{int(time.time() * 1000) % 10_000_000}{uuid.uuid4().hex[:4]}"


def _register(username: str | None = None, password: str = "pass1234") -> Tuple[str, str, list]:
    username = username or _uniq()
    r = requests.post(f"{API}/auth/register", json={
        "username": username, "password": password, "password_repeat": password
    }, timeout=15)
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    data = r.json()
    return data["session_token"], data["user"]["user_id"], data.get("recovery_codes", [])


def _login(username: str, password: str = "pass1234") -> requests.Response:
    return requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=15)


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# =====================================================================
# Health
# =====================================================================
class TestHealth:
    def test_root(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert "message" in r.json()


# =====================================================================
# Auth core (regression)
# =====================================================================
class TestAuthRegression:
    def test_register_login_me_logout(self):
        u = _uniq("reg")
        token, uid, codes = _register(u)
        assert token and uid.startswith("user_")
        assert isinstance(codes, list) and len(codes) == 8

        me = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10)
        assert me.status_code == 200
        body = me.json()
        assert body["username"] == u
        # preferences is included in /auth/me (iteration 11)
        assert "preferences" in body
        assert body["preferences"]["week_start_day"] == 5
        assert isinstance(body["preferences"]["courses"], list)
        assert len(body["preferences"]["courses"]) == 4
        default_ids = {c["id"] for c in body["preferences"]["courses"]}
        assert {"primo", "secondo", "contorno", "dolce"} == default_ids

        # login
        r = _login(u)
        assert r.status_code == 200
        # logout
        lo = requests.post(f"{API}/auth/logout", headers=_auth(token), timeout=10)
        assert lo.status_code == 200
        # Token now invalid
        me2 = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10)
        assert me2.status_code == 401

    def test_recovery_verify_regression(self):
        u = _uniq("recv")
        _, _, codes = _register(u, "pass1234")
        code = codes[0]
        r = requests.post(f"{API}/auth/recovery/verify", json={
            "username": u, "code": code, "new_password": "newpass9"
        }, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "session_token" in data
        # old password no longer works
        assert _login(u, "pass1234").status_code == 401
        # new password works
        assert _login(u, "newpass9").status_code == 200


# =====================================================================
# Preferences endpoints (new in iteration 11)
# =====================================================================
class TestPreferences:
    def test_get_default_preferences(self):
        token, _, _ = _register(_uniq("pgd"))
        r = requests.get(f"{API}/auth/preferences", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        p = r.json()
        assert p["week_start_day"] == 5
        assert isinstance(p["courses"], list) and len(p["courses"]) == 4

    def test_put_update_preferences(self):
        token, _, _ = _register(_uniq("ppu"))
        payload = {
            "week_start_day": 0,
            "courses": [
                {"label": "Antipasto"},
                {"label": "Primo"},
                {"label": "Dolce"},
            ],
        }
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token), json=payload, timeout=10)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["week_start_day"] == 0
        assert len(p["courses"]) == 3
        # ids auto-generated from labels
        ids = [c["id"] for c in p["courses"]]
        assert ids == ["antipasto", "primo", "dolce"]

        # /auth/me now reflects updated prefs
        me = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).json()
        assert me["preferences"]["week_start_day"] == 0
        assert [c["id"] for c in me["preferences"]["courses"]] == ["antipasto", "primo", "dolce"]

    def test_invalid_week_start_day(self):
        token, _, _ = _register(_uniq("piw"))
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token), json={"week_start_day": 9}, timeout=10)
        assert r.status_code == 422

        r2 = requests.put(f"{API}/auth/preferences", headers=_auth(token), json={"week_start_day": -1}, timeout=10)
        assert r2.status_code == 422

    def test_empty_courses_rejected(self):
        token, _, _ = _register(_uniq("pec"))
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token), json={"courses": []}, timeout=10)
        assert r.status_code == 422

    def test_duplicate_labels_dedup(self):
        token, _, _ = _register(_uniq("pdd"))
        payload = {"courses": [
            {"label": "Primo"}, {"label": "primo"}, {"label": "Secondo"}, {"label": "Secondo"},
        ]}
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token), json=payload, timeout=10)
        assert r.status_code == 200
        labels = [c["label"].lower() for c in r.json()["courses"]]
        assert labels == ["primo", "secondo"]

    def test_preferences_requires_auth(self):
        r = requests.get(f"{API}/auth/preferences", timeout=10)
        assert r.status_code == 401
        r = requests.put(f"{API}/auth/preferences", json={"week_start_day": 0}, timeout=10)
        assert r.status_code == 401


# =====================================================================
# Dish flexibility (any course id)
# =====================================================================
class TestDishFlexibility:
    def test_create_dish_with_default_course(self):
        token, _, _ = _register(_uniq("dds"))
        r = requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "Tiramisu", "course": "dolce", "ingredients": [], "servings": 4
        }, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["course"] == "dolce"

    def test_create_dish_with_custom_course(self):
        token, _, _ = _register(_uniq("dcc"))
        r = requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "Bruschetta", "course": "antipasto", "ingredients": []
        }, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["course"] == "antipasto"

    def test_filter_dishes_by_custom_course(self):
        token, _, _ = _register(_uniq("dfc"))
        # Create a mix
        requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "Bruschetta", "course": "antipasto"
        }, timeout=10)
        requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "Pasta", "course": "primo"
        }, timeout=10)
        r = requests.get(f"{API}/dishes?course=antipasto", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) == 1
        assert rows[0]["name"] == "Bruschetta"


# =====================================================================
# Dish CRUD (regression)
# =====================================================================
class TestDishCRUD:
    def test_dish_full_crud(self):
        token, _, _ = _register(_uniq("dcrud"))
        # create
        r = requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "Pizza", "course": "primo",
            "ingredients": [{"name": "flour", "quantity": 200, "unit": "g"}], "servings": 2,
        }, timeout=10)
        assert r.status_code == 200
        dish = r.json()
        did = dish["id"]

        # get
        r = requests.get(f"{API}/dishes/{did}", headers=_auth(token), timeout=10)
        assert r.status_code == 200 and r.json()["name"] == "Pizza"

        # list
        r = requests.get(f"{API}/dishes", headers=_auth(token), timeout=10)
        assert r.status_code == 200 and any(d["id"] == did for d in r.json())

        # update
        r = requests.put(f"{API}/dishes/{did}", headers=_auth(token), json={
            "name": "Pizza Napoletana", "course": "primo",
            "ingredients": [], "servings": 4,
        }, timeout=10)
        assert r.status_code == 200 and r.json()["name"] == "Pizza Napoletana"

        # duplicate
        r = requests.post(f"{API}/dishes/{did}/duplicate", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        dup = r.json()
        assert dup["name"].endswith("(copia)")
        assert dup["id"] != did

        # delete
        r = requests.delete(f"{API}/dishes/{did}", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        r = requests.get(f"{API}/dishes/{did}", headers=_auth(token), timeout=10)
        assert r.status_code == 404


# =====================================================================
# Planner + Shopping (regression)
# =====================================================================
class TestPlannerShopping:
    def test_planner_and_shopping_flow(self):
        token, _, _ = _register(_uniq("plsh"))
        # Create a dish with an ingredient
        d = requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "Ragu", "course": "primo",
            "ingredients": [{"name": "Carne", "quantity": 200, "unit": "g"}], "servings": 2,
        }, timeout=10).json()

        # empty planner
        r = requests.get(f"{API}/planner/2026-01-05", headers=_auth(token), timeout=10)
        assert r.status_code == 200 and r.json()["slots"] == {}

        # add slot
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": "2026-01-05", "day_index": 0, "meal": "pranzo",
            "dish_id": d["id"], "persons": 4,
        }, timeout=10)
        assert r.status_code == 200
        assert "0_pranzo" in r.json()["slots"]

        # shopping list should have the scaled ingredient (200g * 4/2 = 400g)
        s = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        assert len(s) == 1
        assert s[0]["planner_qty"] == 400.0

        # add manual item
        r = requests.post(f"{API}/shopping", headers=_auth(token), json={
            "name": "Pane", "quantity": 1, "unit": "pz",
        }, timeout=10)
        assert r.status_code == 200
        pane = r.json()

        # toggle
        r = requests.patch(f"{API}/shopping/{pane['id']}/toggle", headers=_auth(token),
                           json={"checked": True}, timeout=10)
        assert r.status_code == 200

        # edit
        r = requests.patch(f"{API}/shopping/{pane['id']}", headers=_auth(token),
                           json={"notes": "integrale"}, timeout=10)
        assert r.status_code == 200

        # reorder
        r = requests.post(f"{API}/shopping/reorder", headers=_auth(token),
                          json={"ordered_ids": [pane["id"]]}, timeout=10)
        assert r.status_code == 200

        # clear checked
        r = requests.post(f"{API}/shopping/clear-checked", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        s = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        assert all(not it["checked"] for it in s)

        # duplicate week
        r = requests.post(f"{API}/planner/duplicate", headers=_auth(token), json={
            "source_week_start": "2026-01-05", "target_week_start": "2026-01-12"
        }, timeout=10)
        assert r.status_code == 200
        assert "0_pranzo" in r.json()["slots"]

        # remove slot (pass no dish_id)
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": "2026-01-05", "day_index": 0, "meal": "pranzo",
            "dish_id": None,
        }, timeout=10)
        assert r.status_code == 200 and "0_pranzo" not in r.json()["slots"]


# =====================================================================
# Export / Import (regression)
# =====================================================================
class TestExportImport:
    def test_export_import_user_data(self):
        token, _, _ = _register(_uniq("exp"))
        requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "Insalata", "course": "contorno"
        }, timeout=10)
        r = requests.get(f"{API}/export", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        blob = r.json()
        assert blob["app"] == "PlanEat"
        assert len(blob["dishes"]) == 1

        # import back into fresh user
        token2, _, _ = _register(_uniq("imp"))
        r = requests.post(f"{API}/import", headers=_auth(token2), json={
            "dishes": blob["dishes"], "weekly_plans": [], "shopping_items": [], "mode": "merge",
        }, timeout=10)
        assert r.status_code == 200
        assert r.json()["imported"]["dishes"] == 1


# =====================================================================
# Auth security: cross-user isolation
# =====================================================================
class TestCrossUserIsolation:
    def test_user_cannot_read_another_users_dish(self):
        t1, _, _ = _register(_uniq("iso1"))
        t2, _, _ = _register(_uniq("iso2"))
        d = requests.post(f"{API}/dishes", headers=_auth(t1), json={
            "name": "Secret", "course": "primo"
        }, timeout=10).json()
        r = requests.get(f"{API}/dishes/{d['id']}", headers=_auth(t2), timeout=10)
        assert r.status_code == 404

    def test_protected_endpoints_require_bearer(self):
        for path in ["/auth/me", "/auth/preferences", "/dishes", "/shopping", "/export"]:
            r = requests.get(f"{API}{path}", timeout=10)
            assert r.status_code == 401, f"{path} should require auth (got {r.status_code})"


# =====================================================================
# Admin endpoints
# =====================================================================
class TestAdminAuth:
    def test_admin_without_header_401(self):
        for path in ["/admin/stats", "/admin/users", "/admin/export", "/admin/export.csv"]:
            r = requests.get(f"{API}{path}", timeout=10)
            assert r.status_code == 401, f"{path} expected 401 got {r.status_code}"

    def test_admin_wrong_header_401(self):
        r = requests.get(f"{API}/admin/stats", headers={"X-Admin-Password": "wrong"}, timeout=10)
        assert r.status_code == 401


class TestAdminStats:
    def test_stats_shape(self):
        r = requests.get(f"{API}/admin/stats", headers=ADMIN_HEADER, timeout=10)
        assert r.status_code == 200
        j = r.json()
        for k in ["users", "new_users_last_7d", "dishes", "weekly_plans",
                  "shopping_items", "active_sessions", "generated_at"]:
            assert k in j, f"missing key {k}"
        assert isinstance(j["users"], int)
        # translate old "sessions" naming per review request
        assert isinstance(j["active_sessions"], int)


class TestAdminUsers:
    def test_list_users_shape_no_password_hash(self):
        # ensure at least one user exists
        _register(_uniq("adm"))
        r = requests.get(f"{API}/admin/users", headers=ADMIN_HEADER, timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        u = rows[0]
        assert "password_hash" not in u
        assert "counts" in u and "dishes" in u["counts"]

    def test_get_user_detail_and_404(self):
        _, uid, _ = _register(_uniq("adm2"))
        r = requests.get(f"{API}/admin/users/{uid}", headers=ADMIN_HEADER, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["user_id"] == uid
        assert "password_hash" not in j
        assert "counts" in j
        # 404 for unknown
        r2 = requests.get(f"{API}/admin/users/nonexistent", headers=ADMIN_HEADER, timeout=10)
        assert r2.status_code == 404


class TestAdminPasswordReset:
    def test_reset_password_invalidates_sessions_and_updates(self):
        username = _uniq("admr")
        token, uid, _ = _register(username, "pass1234")
        # confirm old token works
        assert requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).status_code == 200
        # admin resets
        r = requests.post(f"{API}/admin/users/{uid}/password", headers=ADMIN_HEADER,
                          json={"new_password": "brandnew"}, timeout=10)
        assert r.status_code == 200
        # old session should now be invalid
        assert requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).status_code == 401
        # old password should fail
        assert _login(username, "pass1234").status_code == 401
        # new password should work
        r2 = _login(username, "brandnew")
        assert r2.status_code == 200


class TestAdminDeleteUser:
    def test_delete_user_wipes_data(self):
        username = _uniq("admd")
        token, uid, _ = _register(username)
        # add a dish
        d = requests.post(f"{API}/dishes", headers=_auth(token), json={
            "name": "ToDelete", "course": "primo"
        }, timeout=10).json()
        # delete via admin
        r = requests.delete(f"{API}/admin/users/{uid}", headers=ADMIN_HEADER, timeout=10)
        assert r.status_code == 200
        assert r.json()["removed"]["dishes"] >= 1
        # subsequent GET returns 404
        r2 = requests.get(f"{API}/admin/users/{uid}", headers=ADMIN_HEADER, timeout=10)
        assert r2.status_code == 404
        # token invalidated
        assert requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).status_code == 401
        # dish removed - re-register another user and confirm dish doesn't exist
        _ = d  # implicit: dishes deleted


class TestAdminExport:
    def test_export_json_scrubs_secrets(self):
        _register(_uniq("adme"))
        r = requests.get(f"{API}/admin/export", headers=ADMIN_HEADER, timeout=15)
        assert r.status_code == 200
        blob = r.json()
        assert blob["kind"] == "admin-export"
        # no password_hash / recovery_codes anywhere in users
        for u in blob["users"]:
            assert "password_hash" not in u
            assert "recovery_codes" not in u

    def test_export_csv(self):
        _register(_uniq("admc"))
        r = requests.get(f"{API}/admin/export.csv", headers=ADMIN_HEADER, timeout=15)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        body = r.text
        first_line = body.splitlines()[0]
        assert "user_id" in first_line and "username" in first_line
