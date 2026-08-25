"""Iteration 8 backend tests: username auth, notes, shopping edits, toggle-move-to-end."""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://meal-prep-master-2.preview.emergentagent.com").rstrip("/") + "/api"


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def _uname(prefix="test"):
    return f"{prefix}{uuid.uuid4().hex[:8]}"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def user_a():
    u = _uname("a")
    r = requests.post(f"{BASE}/auth/register",
                      json={"username": u, "password": "pass1234", "password_repeat": "pass1234"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"username": u, "token": d["session_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def user_b():
    u = _uname("b")
    r = requests.post(f"{BASE}/auth/register",
                      json={"username": u, "password": "pass1234", "password_repeat": "pass1234"})
    assert r.status_code == 200, r.text
    return {"username": u, "token": r.json()["session_token"]}


# ---------- Register validation ----------
class TestRegister:
    def test_register_too_short(self):
        r = requests.post(f"{BASE}/auth/register",
                          json={"username": "ab", "password": "pass1234", "password_repeat": "pass1234"})
        assert r.status_code == 422

    def test_register_spaces(self):
        r = requests.post(f"{BASE}/auth/register",
                          json={"username": "user name", "password": "pass1234", "password_repeat": "pass1234"})
        assert r.status_code == 422

    def test_register_uppercase_normalized(self):
        u = _uname("Ux").upper()  # UUID hex is already lowercase, capitalize a couple
        u = "MixedCase" + uuid.uuid4().hex[:6]
        r = requests.post(f"{BASE}/auth/register",
                          json={"username": u, "password": "pass1234", "password_repeat": "pass1234"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"] == u.lower()

    def test_register_special_chars(self):
        r = requests.post(f"{BASE}/auth/register",
                          json={"username": "bad!user", "password": "pass1234", "password_repeat": "pass1234"})
        assert r.status_code == 422

    def test_register_password_mismatch(self):
        r = requests.post(f"{BASE}/auth/register",
                          json={"username": _uname(), "password": "pass1234", "password_repeat": "different"})
        assert r.status_code == 422

    def test_register_case_insensitive_dup(self, user_a):
        r = requests.post(f"{BASE}/auth/register",
                          json={"username": user_a["username"].upper(),
                                "password": "pass1234", "password_repeat": "pass1234"})
        assert r.status_code == 409


# ---------- Login ----------
class TestLogin:
    def test_login_case_insensitive(self, user_b):
        r = requests.post(f"{BASE}/auth/login",
                          json={"username": user_b["username"].upper(), "password": "pass1234"})
        assert r.status_code == 200
        assert "session_token" in r.json()

    def test_login_wrong_password(self, user_b):
        r = requests.post(f"{BASE}/auth/login",
                          json={"username": user_b["username"], "password": "wrong"})
        assert r.status_code == 401


# ---------- Profile / Password ----------
class TestProfileAndPassword:
    def test_profile_wrong_password(self, user_a):
        r = requests.put(f"{BASE}/auth/profile",
                         json={"username": _uname(), "current_password": "wrong"},
                         headers=H(user_a["token"]))
        assert r.status_code == 401

    def test_profile_collision(self, user_a, user_b):
        r = requests.put(f"{BASE}/auth/profile",
                         json={"username": user_b["username"], "current_password": "pass1234"},
                         headers=H(user_a["token"]))
        assert r.status_code == 409

    def test_profile_success(self, user_a):
        new = _uname("ren")
        r = requests.put(f"{BASE}/auth/profile",
                         json={"username": new, "current_password": "pass1234"},
                         headers=H(user_a["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"] == new
        # verify /me
        me = requests.get(f"{BASE}/auth/me", headers=H(user_a["token"])).json()
        assert me["username"] == new
        user_a["username"] = new

    def test_password_wrong_old(self, user_a):
        r = requests.put(f"{BASE}/auth/password",
                         json={"old_password": "wrongold", "new_password": "newpass1"},
                         headers=H(user_a["token"]))
        assert r.status_code == 401

    def test_password_same(self, user_a):
        r = requests.put(f"{BASE}/auth/password",
                         json={"old_password": "pass1234", "new_password": "pass1234"},
                         headers=H(user_a["token"]))
        assert r.status_code == 422

    def test_password_success_and_relogin(self, user_a):
        r = requests.put(f"{BASE}/auth/password",
                         json={"old_password": "pass1234", "new_password": "newpass9"},
                         headers=H(user_a["token"]))
        assert r.status_code == 200
        # re-login with new password
        r = requests.post(f"{BASE}/auth/login",
                          json={"username": user_a["username"], "password": "newpass9"})
        assert r.status_code == 200


# ---------- Removed endpoints ----------
class TestRemoved:
    def test_forgot_password_removed(self):
        r = requests.post(f"{BASE}/auth/forgot-password", json={"email": "x@x.com"})
        assert r.status_code in (404, 405)

    def test_reset_password_removed(self):
        r = requests.post(f"{BASE}/auth/reset-password", json={"token": "x", "password": "y"})
        assert r.status_code in (404, 405)

    def test_session_removed(self):
        r = requests.post(f"{BASE}/auth/session", json={"session_id": "x"})
        assert r.status_code in (404, 405)


# ---------- Dishes notes ----------
class TestDishNotes:
    def test_create_and_get_notes(self, user_b):
        r = requests.post(f"{BASE}/dishes", json={
            "name": "TEST_NotesDish", "course": "primo", "servings": 2,
            "ingredients": [{"name": "Pasta", "quantity": 100, "unit": "g"}],
            "preparation": "cook",
            "notes": "Nonna's tip: use salt",
        }, headers=H(user_b["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["notes"] == "Nonna's tip: use salt"
        r = requests.get(f"{BASE}/dishes/{d['id']}", headers=H(user_b["token"]))
        assert r.status_code == 200
        assert r.json()["notes"] == "Nonna's tip: use salt"
        # cleanup
        requests.delete(f"{BASE}/dishes/{d['id']}", headers=H(user_b["token"]))


# ---------- Shopping notes, PATCH, toggle-move-to-end ----------
class TestShopping:
    @pytest.fixture
    def clean(self, user_b):
        items = requests.get(f"{BASE}/shopping", headers=H(user_b["token"])).json()
        for it in items:
            requests.delete(f"{BASE}/shopping/{it['id']}/force", headers=H(user_b["token"]))
        return user_b

    def test_add_with_notes(self, clean):
        u = clean
        r = requests.post(f"{BASE}/shopping",
                         json={"name": "TEST_Milk", "quantity": 1, "unit": "l", "notes": "cold"},
                         headers=H(u["token"]))
        assert r.status_code == 200
        assert r.json()["notes"] == "cold"

    def test_notes_merge_on_duplicate(self, clean):
        u = clean
        r1 = requests.post(f"{BASE}/shopping",
                          json={"name": "TEST_Sugar", "quantity": 1, "unit": "kg", "notes": "brown"},
                          headers=H(u["token"]))
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE}/shopping",
                          json={"name": "TEST_Sugar", "quantity": 2, "unit": "kg", "notes": "white"},
                          headers=H(u["token"]))
        assert r2.status_code == 200
        n = r2.json()["notes"]
        assert "brown" in n and "white" in n
        assert abs(r2.json()["manual_qty"] - 3.0) < 0.001

    def test_patch_name_qty_unit_notes(self, clean):
        u = clean
        r = requests.post(f"{BASE}/shopping",
                         json={"name": "TEST_Bread", "quantity": 1, "unit": "pz"},
                         headers=H(u["token"]))
        item = r.json()
        r = requests.patch(f"{BASE}/shopping/{item['id']}",
                          json={"name": "TEST_BreadRye", "quantity": 3, "unit": "pz", "notes": "wholemeal"},
                          headers=H(u["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == "TEST_BreadRye"
        assert abs(d["manual_qty"] - 3.0) < 0.001
        assert d["notes"] == "wholemeal"

    def test_patch_zero_deletes(self, clean):
        u = clean
        r = requests.post(f"{BASE}/shopping",
                         json={"name": "TEST_Del", "quantity": 5, "unit": "pz"},
                         headers=H(u["token"]))
        iid = r.json()["id"]
        r = requests.patch(f"{BASE}/shopping/{iid}", json={"quantity": 0}, headers=H(u["token"]))
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        items = requests.get(f"{BASE}/shopping", headers=H(u["token"])).json()
        assert not any(i["id"] == iid for i in items)

    def test_patch_merges_into_existing_key(self, clean):
        u = clean
        a = requests.post(f"{BASE}/shopping",
                        json={"name": "TEST_Apple", "quantity": 2, "unit": "pz", "notes": "red"},
                        headers=H(u["token"])).json()
        b = requests.post(f"{BASE}/shopping",
                        json={"name": "TEST_Pear", "quantity": 3, "unit": "pz", "notes": "green"},
                        headers=H(u["token"])).json()
        # rename Pear -> Apple (same unit) → should merge into a
        r = requests.patch(f"{BASE}/shopping/{b['id']}",
                          json={"name": "TEST_Apple", "unit": "pz"},
                          headers=H(u["token"]))
        assert r.status_code == 200
        merged = r.json()
        assert merged["id"] == a["id"]
        assert abs(merged["manual_qty"] - 5.0) < 0.001
        items = requests.get(f"{BASE}/shopping", headers=H(u["token"])).json()
        assert not any(i["id"] == b["id"] for i in items)

    def test_toggle_moves_to_end(self, clean):
        u = clean
        # create 3 items in known order
        a = requests.post(f"{BASE}/shopping", json={"name": "TEST_X1", "quantity": 1, "unit": "pz"}, headers=H(u["token"])).json()
        b = requests.post(f"{BASE}/shopping", json={"name": "TEST_X2", "quantity": 1, "unit": "pz"}, headers=H(u["token"])).json()
        c = requests.post(f"{BASE}/shopping", json={"name": "TEST_X3", "quantity": 1, "unit": "pz"}, headers=H(u["token"])).json()
        # check the middle one
        requests.patch(f"{BASE}/shopping/{b['id']}/toggle", json={"checked": True}, headers=H(u["token"]))
        items = requests.get(f"{BASE}/shopping", headers=H(u["token"])).json()
        # last in sorted-order should be b
        ordered_ids = [i["id"] for i in items if i["id"] in (a["id"], b["id"], c["id"])]
        assert ordered_ids[-1] == b["id"], f"expected b at end, got {ordered_ids}"

    def test_toggle_uncheck_keeps_position(self, clean):
        u = clean
        a = requests.post(f"{BASE}/shopping", json={"name": "TEST_Y1", "quantity": 1, "unit": "pz"}, headers=H(u["token"])).json()
        b = requests.post(f"{BASE}/shopping", json={"name": "TEST_Y2", "quantity": 1, "unit": "pz"}, headers=H(u["token"])).json()
        # check a → moves to end
        requests.patch(f"{BASE}/shopping/{a['id']}/toggle", json={"checked": True}, headers=H(u["token"]))
        items1 = requests.get(f"{BASE}/shopping", headers=H(u["token"])).json()
        pos_a = next(i["order"] for i in items1 if i["id"] == a["id"])
        # uncheck a → should keep same order
        requests.patch(f"{BASE}/shopping/{a['id']}/toggle", json={"checked": False}, headers=H(u["token"]))
        items2 = requests.get(f"{BASE}/shopping", headers=H(u["token"])).json()
        pos_a2 = next(i["order"] for i in items2 if i["id"] == a["id"])
        assert pos_a == pos_a2


# ---------- Export sanity (regression) ----------
class TestExport:
    def test_export_ok(self, user_b):
        r = requests.get(f"{BASE}/export", headers=H(user_b["token"]))
        # This may fail due to email KeyError bug — capture status
        assert r.status_code == 200, f"Export failed: {r.status_code} {r.text[:200]}"
