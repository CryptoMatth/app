"""
Iteration 19 backend tests:
- Ultra tier removed / migrated to pro_plus
- Cloud backups feature fully removed
- New seeded testpro / testPro123 user (Pro tier)
- halley is Pro+ (not Ultra)
- Non-regression: export/import, fridge Pro+ gate, dishes/shopping/planner flow
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_PASSWORD = "planeat-admin-CH4ngeMe-2026"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(http, username, password):
    r = http.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    data = r.json()
    # server returns session_token + user{user_id,...}; normalize to keep tests compact
    token = data.get("session_token") or data.get("token")
    assert token, f"no session_token in login response: {data}"
    data["token"] = token
    user = data.get("user") or {}
    if "id" not in user and "user_id" in user:
        user["id"] = user["user_id"]
    data["user"] = user
    return data


@pytest.fixture(scope="module")
def halley(http):
    return _login(http, "halley", "halley1234")


@pytest.fixture(scope="module")
def testpro(http):
    return _login(http, "testpro", "testPro123")


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _admin_headers():
    return {"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"}


# ---------- 1. Auth + tier ----------

class TestAuthTiers:
    def test_halley_login_returns_pro_plus(self, halley):
        user = halley.get("user", {})
        assert user.get("tier") == "pro_plus", f"halley tier != pro_plus (got {user.get('tier')})"

    def test_testpro_login_returns_pro(self, testpro):
        user = testpro.get("user", {})
        assert user.get("tier") == "pro", f"testpro tier != pro (got {user.get('tier')})"

    def test_halley_me_endpoint(self, http, halley):
        r = http.get(f"{BASE_URL}/api/auth/me", headers=_auth(halley["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data.get("tier") == "pro_plus", data
        assert data.get("is_pro") is True, data
        assert data.get("pro_source") == "founder", data

    def test_testpro_me_endpoint(self, http, testpro):
        r = http.get(f"{BASE_URL}/api/auth/me", headers=_auth(testpro["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data.get("tier") == "pro", data
        assert data.get("is_pro") is True, data
        assert data.get("pro_source") == "admin_grant", data


# ---------- 2. Backup endpoints removed ----------

class TestBackupEndpointsRemoved:
    def test_get_backups_404(self, http, halley):
        r = http.get(f"{BASE_URL}/api/backups", headers=_auth(halley["token"]))
        assert r.status_code == 404, f"expected 404, got {r.status_code}"

    def test_post_backups_404(self, http, halley):
        r = http.post(f"{BASE_URL}/api/backups", json={}, headers=_auth(halley["token"]))
        assert r.status_code == 404, f"expected 404, got {r.status_code}"

    def test_post_auto_check_404(self, http, halley):
        r = http.post(f"{BASE_URL}/api/backups/auto-check", json={}, headers=_auth(halley["token"]))
        assert r.status_code == 404, f"expected 404, got {r.status_code}"


# ---------- 3. Preferences no longer include backups ----------

class TestPreferencesNoBackups:
    def test_get_prefs_no_backups(self, http, halley):
        r = http.get(f"{BASE_URL}/api/auth/preferences", headers=_auth(halley["token"]))
        assert r.status_code == 200
        data = r.json()
        assert "backups" not in data, f"'backups' key still in prefs: {data}"

    def test_put_prefs_ignores_backups(self, http, halley):
        r = http.put(
            f"{BASE_URL}/api/auth/preferences",
            json={"backups": {"frequency": "daily"}},
            headers=_auth(halley["token"]),
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
        data = r.json()
        assert "backups" not in data, f"'backups' key present after PUT: {data}"


# ---------- 4. Non-regression: export/import ----------

class TestExportImport:
    def test_export_v2(self, http, halley):
        r = http.get(f"{BASE_URL}/api/export", headers=_auth(halley["token"]))
        assert r.status_code == 200
        data = r.json()
        for key in ("dishes", "weekly_plans", "shopping_items", "fridge_items"):
            assert key in data, f"export missing key {key}: keys={list(data.keys())}"

    def test_import_merge_empty(self, http, halley):
        payload = {
            "version": 2,
            "mode": "merge",
            "dishes": [],
            "weekly_plans": [],
            "shopping_items": [],
            "fridge_items": [],
        }
        r = http.post(f"{BASE_URL}/api/import?mode=merge", json=payload, headers=_auth(halley["token"]))
        # Some APIs accept mode in body; try both. Accept 200/201.
        if r.status_code not in (200, 201):
            r2 = http.post(f"{BASE_URL}/api/import", json=payload, headers=_auth(halley["token"]))
            assert r2.status_code in (200, 201), f"import failed: {r.status_code}/{r.text} then {r2.status_code}/{r2.text}"
        else:
            assert r.status_code in (200, 201)


# ---------- 5. Non-regression: Pro+ gating on fridge ----------

class TestFridgeProPlusGate:
    def test_halley_can_get_fridge(self, http, halley):
        r = http.get(f"{BASE_URL}/api/fridge", headers=_auth(halley["token"]))
        assert r.status_code == 200, f"halley fridge GET failed: {r.status_code} {r.text}"

    def test_testpro_blocked_get_fridge(self, http, testpro):
        r = http.get(f"{BASE_URL}/api/fridge", headers=_auth(testpro["token"]))
        assert r.status_code == 402, f"testpro fridge GET expected 402, got {r.status_code} {r.text}"

    def test_testpro_blocked_post_fridge(self, http, testpro):
        r = http.post(
            f"{BASE_URL}/api/fridge",
            json={"name": "test", "quantity": 1, "unit": "pz", "notes": ""},
            headers=_auth(testpro["token"]),
        )
        assert r.status_code == 402, f"testpro fridge POST expected 402, got {r.status_code} {r.text}"


# ---------- 6. Non-regression: dishes/shopping/planner flow ----------

class TestDishesShoppingFlow:
    dish_id = None
    shop_id = None
    fridge_item_id = None
    dish_name = f"TEST_dish_{uuid.uuid4().hex[:8]}"
    shop_name = f"TEST_pomodori_{uuid.uuid4().hex[:6]}"

    def test_create_dish(self, http, halley):
        payload = {
            "name": self.__class__.dish_name,
            "course": "primo",
            "ingredients": [],
            "servings": 2,
            "preparation": "",
        }
        r = http.post(f"{BASE_URL}/api/dishes", json=payload, headers=_auth(halley["token"]))
        assert r.status_code in (200, 201), f"create dish failed: {r.status_code} {r.text}"
        data = r.json()
        assert "id" in data, data
        TestDishesShoppingFlow.dish_id = data["id"]

    def test_get_dishes_contains_created(self, http, halley):
        r = http.get(f"{BASE_URL}/api/dishes", headers=_auth(halley["token"]))
        assert r.status_code == 200
        dishes = r.json()
        assert any(d.get("id") == TestDishesShoppingFlow.dish_id for d in dishes), "created dish not in list"

    def test_add_shopping_item(self, http, halley):
        payload = {"name": self.__class__.shop_name, "quantity": 500, "unit": "g", "notes": ""}
        r = http.post(f"{BASE_URL}/api/shopping", json=payload, headers=_auth(halley["token"]))
        assert r.status_code in (200, 201), f"add shopping failed: {r.status_code} {r.text}"
        data = r.json()
        assert "id" in data, data
        TestDishesShoppingFlow.shop_id = data["id"]

    def test_toggle_shopping_item(self, http, halley):
        assert TestDishesShoppingFlow.shop_id is not None
        r = http.patch(
            f"{BASE_URL}/api/shopping/{TestDishesShoppingFlow.shop_id}/toggle",
            json={"checked": True},
            headers=_auth(halley["token"]),
        )
        assert r.status_code == 200, f"toggle failed: {r.status_code} {r.text}"

    def test_clear_checked_to_fridge(self, http, halley):
        r = http.post(
            f"{BASE_URL}/api/shopping/clear-checked?to_fridge=true",
            headers=_auth(halley["token"]),
        )
        assert r.status_code == 200, f"clear-checked failed: {r.status_code} {r.text}"

    def test_fridge_contains_moved_item(self, http, halley):
        r = http.get(f"{BASE_URL}/api/fridge", headers=_auth(halley["token"]))
        assert r.status_code == 200
        items = r.json()
        match = [i for i in items if i.get("name") == TestDishesShoppingFlow.shop_name]
        assert match, f"item not moved to fridge; names={[i.get('name') for i in items]}"
        TestDishesShoppingFlow.fridge_item_id = match[0].get("id")

    def test_cleanup_fridge_item(self, http, halley):
        if TestDishesShoppingFlow.fridge_item_id:
            r = http.delete(
                f"{BASE_URL}/api/fridge/{TestDishesShoppingFlow.fridge_item_id}",
                headers=_auth(halley["token"]),
            )
            assert r.status_code in (200, 204), f"delete fridge item failed: {r.status_code} {r.text}"

    def test_cleanup_dish(self, http, halley):
        if TestDishesShoppingFlow.dish_id:
            r = http.delete(
                f"{BASE_URL}/api/dishes/{TestDishesShoppingFlow.dish_id}",
                headers=_auth(halley["token"]),
            )
            assert r.status_code in (200, 204), f"delete dish failed: {r.status_code} {r.text}"


# ---------- 7 & 8. Admin: ultra rejected, ultra migrated ----------

class TestAdminUltraRemoval:
    halley_user_id = None

    def test_fetch_halley_user_id(self, http, halley):
        # Prefer using login response
        uid = halley.get("user", {}).get("id")
        if not uid:
            r = http.get(f"{BASE_URL}/api/auth/me", headers=_auth(halley["token"]))
            uid = r.json().get("id")
        assert uid, "cannot resolve halley user_id"
        TestAdminUltraRemoval.halley_user_id = uid

    def test_admin_grant_ultra_rejected(self, http):
        uid = TestAdminUltraRemoval.halley_user_id
        r = http.post(
            f"{BASE_URL}/api/admin/users/{uid}/entitlements/ultra",
            json={"active": True, "reason": "test"},
            headers=_admin_headers(),
        )
        assert r.status_code == 400, f"expected 400 Unknown tier, got {r.status_code} {r.text}"

    def test_admin_grant_pro_ok(self, http):
        uid = TestAdminUltraRemoval.halley_user_id
        r = http.post(
            f"{BASE_URL}/api/admin/users/{uid}/entitlements/pro",
            json={"active": True, "reason": "test"},
            headers=_admin_headers(),
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"

    def test_halley_entitlements_no_active_ultra(self, http):
        uid = TestAdminUltraRemoval.halley_user_id
        r = http.get(f"{BASE_URL}/api/admin/users/{uid}", headers=_admin_headers())
        assert r.status_code == 200, f"admin get user failed: {r.status_code} {r.text}"
        data = r.json()
        ent = data.get("entitlements") or {}
        ultra = ent.get("ultra") or {}
        assert not ultra.get("active"), f"halley still has active ultra: {ultra}"
