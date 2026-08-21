"""Cucina di Casa backend regression tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://meal-prep-master-2.preview.emergentagent.com").rstrip("/") + "/api"


@pytest.fixture(scope="module")
def user_a():
    email = f"test_a_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": "test1234", "name": "UserA"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["session_token"], "user": d["user"]}


@pytest.fixture(scope="module")
def user_b():
    email = f"test_b_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": "test1234"})
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["session_token"]}


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---- Auth ----
def test_auth_me(user_a):
    r = requests.get(f"{BASE_URL}/auth/me", headers=H(user_a["token"]))
    assert r.status_code == 200
    assert r.json()["email"] == user_a["email"]


def test_auth_duplicate_register(user_a):
    r = requests.post(f"{BASE_URL}/auth/register", json={"email": user_a["email"], "password": "test1234"})
    assert r.status_code == 400


def test_auth_login(user_a):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": user_a["email"], "password": "test1234"})
    assert r.status_code == 200
    assert "session_token" in r.json()


def test_auth_login_bad(user_a):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": user_a["email"], "password": "wrong"})
    assert r.status_code == 401


def test_auth_no_token():
    r = requests.get(f"{BASE_URL}/auth/me")
    assert r.status_code == 401


# ---- Dishes ----
@pytest.fixture(scope="module")
def dish_primo(user_a):
    payload = {
        "name": "TEST_Spaghetti Pomodoro",
        "course": "primo",
        "servings": 2,
        "ingredients": [
            {"name": "Spaghetti", "quantity": 200, "unit": "g"},
            {"name": "Pomodoro", "quantity": 300, "unit": "g"},
        ],
        "preparation": "Cuocere",
    }
    r = requests.post(f"{BASE_URL}/dishes", json=payload, headers=H(user_a["token"]))
    assert r.status_code == 200, r.text
    return r.json()


def test_dish_created_persisted(user_a, dish_primo):
    r = requests.get(f"{BASE_URL}/dishes/{dish_primo['id']}", headers=H(user_a["token"]))
    assert r.status_code == 200
    assert r.json()["name"] == "TEST_Spaghetti Pomodoro"


def test_dishes_list_filter_search(user_a, dish_primo):
    r = requests.get(f"{BASE_URL}/dishes?course=primo", headers=H(user_a["token"]))
    assert r.status_code == 200
    assert any(d["id"] == dish_primo["id"] for d in r.json())

    r = requests.get(f"{BASE_URL}/dishes?course=secondo", headers=H(user_a["token"]))
    assert all(d["id"] != dish_primo["id"] for d in r.json())

    r = requests.get(f"{BASE_URL}/dishes?q=spaghetti", headers=H(user_a["token"]))
    assert any(d["id"] == dish_primo["id"] for d in r.json())


def test_dish_update(user_a, dish_primo):
    payload = {
        "name": "TEST_Spaghetti Aglio",
        "course": "primo",
        "servings": 2,
        "ingredients": [{"name": "Spaghetti", "quantity": 200, "unit": "g"}],
        "preparation": "x",
    }
    r = requests.put(f"{BASE_URL}/dishes/{dish_primo['id']}", json=payload, headers=H(user_a["token"]))
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/dishes/{dish_primo['id']}", headers=H(user_a["token"]))
    assert r.json()["name"] == "TEST_Spaghetti Aglio"


def test_user_isolation(user_a, user_b, dish_primo):
    r = requests.get(f"{BASE_URL}/dishes", headers=H(user_b["token"]))
    assert r.status_code == 200
    assert all(d["id"] != dish_primo["id"] for d in r.json())
    r = requests.get(f"{BASE_URL}/dishes/{dish_primo['id']}", headers=H(user_b["token"]))
    assert r.status_code == 404


# ---- Planner & Shopping sync ----
WEEK = "2026-01-03"  # Saturday


def test_planner_empty(user_a):
    r = requests.get(f"{BASE_URL}/planner/{WEEK}", headers=H(user_a["token"]))
    assert r.status_code == 200
    assert r.json().get("slots", {}) == {}


def test_planner_set_slot_populates_shopping(user_a, dish_primo):
    # clear existing shopping first
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    for it in items:
        requests.delete(f"{BASE_URL}/shopping/{it['id']}", headers=H(user_a["token"]))

    body = {"week_start": WEEK, "day_index": 0, "meal": "pranzo", "dish_id": dish_primo["id"], "persons": 4}
    r = requests.put(f"{BASE_URL}/planner/slot", json=body, headers=H(user_a["token"]))
    assert r.status_code == 200
    slots = r.json()["slots"]
    assert slots["0_pranzo"]["dish_id"] == dish_primo["id"]
    assert slots["0_pranzo"]["persons"] == 4

    # shopping should have scaled ingredients: persons=4, base servings=2 => x2
    # But dish was updated to have 1 ingredient: spaghetti 200g
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    sp = next((i for i in items if i["name"].lower() == "spaghetti"), None)
    assert sp is not None
    assert abs(sp["planner_qty"] - 400.0) < 0.01
    assert sp["manual_qty"] == 0.0


def test_manual_and_planner_merge(user_a):
    r = requests.post(f"{BASE_URL}/shopping", json={"name": "Spaghetti", "quantity": 100, "unit": "g"},
                      headers=H(user_a["token"]))
    assert r.status_code == 200
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    sp = next(i for i in items if i["name"].lower() == "spaghetti")
    assert abs(sp["planner_qty"] - 400.0) < 0.01
    assert abs(sp["manual_qty"] - 100.0) < 0.01


def test_shopping_toggle(user_a):
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    sp = next(i for i in items if i["name"].lower() == "spaghetti")
    r = requests.patch(f"{BASE_URL}/shopping/{sp['id']}/toggle", json={"checked": True}, headers=H(user_a["token"]))
    assert r.status_code == 200
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    assert next(i for i in items if i["id"] == sp["id"])["checked"] is True


def test_shopping_delete_keeps_row_if_planner(user_a):
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    sp = next(i for i in items if i["name"].lower() == "spaghetti")
    r = requests.delete(f"{BASE_URL}/shopping/{sp['id']}", headers=H(user_a["token"]))
    assert r.status_code == 200
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    sp2 = next((i for i in items if i["id"] == sp["id"]), None)
    assert sp2 is not None  # row kept
    assert sp2["manual_qty"] == 0.0
    assert sp2["planner_qty"] > 0


def test_planner_clear_removes_shopping(user_a):
    body = {"week_start": WEEK, "day_index": 0, "meal": "pranzo", "dish_id": None, "persons": 2}
    r = requests.put(f"{BASE_URL}/planner/slot", json=body, headers=H(user_a["token"]))
    assert r.status_code == 200
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    # Spaghetti row had no manual, so should be deleted
    assert not any(i["name"].lower() == "spaghetti" for i in items)


def test_reorder_and_clear_checked(user_a):
    # create two manual items
    a = requests.post(f"{BASE_URL}/shopping", json={"name": "TEST_A", "quantity": 1, "unit": "pz"},
                      headers=H(user_a["token"])).json()
    b = requests.post(f"{BASE_URL}/shopping", json={"name": "TEST_B", "quantity": 1, "unit": "pz"},
                      headers=H(user_a["token"])).json()
    r = requests.post(f"{BASE_URL}/shopping/reorder", json={"ordered_ids": [b["id"], a["id"]]},
                      headers=H(user_a["token"]))
    assert r.status_code == 200
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    ids = [i["id"] for i in items if i["id"] in (a["id"], b["id"])]
    assert ids == [b["id"], a["id"]]

    # check + clear
    requests.patch(f"{BASE_URL}/shopping/{a['id']}/toggle", json={"checked": True}, headers=H(user_a["token"]))
    r = requests.post(f"{BASE_URL}/shopping/clear-checked", headers=H(user_a["token"]))
    assert r.status_code == 200
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    assert not any(i["id"] == a["id"] for i in items)


def test_duplicate_week(user_a, dish_primo):
    src = "2026-01-10"
    tgt = "2026-01-17"
    body = {"week_start": src, "day_index": 1, "meal": "cena", "dish_id": dish_primo["id"], "persons": 2}
    r = requests.put(f"{BASE_URL}/planner/slot", json=body, headers=H(user_a["token"]))
    assert r.status_code == 200

    r = requests.post(f"{BASE_URL}/planner/duplicate",
                      json={"source_week_start": src, "target_week_start": tgt},
                      headers=H(user_a["token"]))
    assert r.status_code == 200
    assert "1_cena" in r.json()["slots"]

    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    sp = next((i for i in items if i["name"].lower() == "spaghetti"), None)
    assert sp is not None  # ingredients re-added for target week


def test_dish_delete(user_a, dish_primo):
    r = requests.delete(f"{BASE_URL}/dishes/{dish_primo['id']}", headers=H(user_a["token"]))
    assert r.status_code == 200
    r = requests.get(f"{BASE_URL}/dishes/{dish_primo['id']}", headers=H(user_a["token"]))
    assert r.status_code == 404


# ---- Password confirmation / Force-delete (Iteration 2 new behavior) ----
def test_register_short_password():
    email = f"test_short_{uuid.uuid4().hex[:8]}@test.com"
    r = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": "abc"})
    assert r.status_code == 400


def test_force_delete_manual_item(user_a):
    # Create a manual item
    r = requests.post(f"{BASE_URL}/shopping",
                      json={"name": "TEST_ForceManual", "quantity": 3, "unit": "pz"},
                      headers=H(user_a["token"]))
    assert r.status_code == 200
    item_id = r.json()["id"]

    r = requests.delete(f"{BASE_URL}/shopping/{item_id}/force", headers=H(user_a["token"]))
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # Confirm removed
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    assert not any(i["id"] == item_id for i in items)


def test_force_delete_planner_item(user_a):
    # Create a dish and add to planner => shopping row will have planner_qty > 0
    dish = requests.post(f"{BASE_URL}/dishes", json={
        "name": "TEST_ForceDish", "course": "primo", "servings": 2,
        "ingredients": [{"name": "TEST_ForceIng", "quantity": 100, "unit": "g"}],
        "preparation": "x",
    }, headers=H(user_a["token"])).json()

    body = {"week_start": "2026-02-07", "day_index": 0, "meal": "pranzo",
            "dish_id": dish["id"], "persons": 2}
    r = requests.put(f"{BASE_URL}/planner/slot", json=body, headers=H(user_a["token"]))
    assert r.status_code == 200

    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    ing = next(i for i in items if i["name"].lower() == "test_forceing")
    assert ing["planner_qty"] > 0

    # Force delete
    r = requests.delete(f"{BASE_URL}/shopping/{ing['id']}/force", headers=H(user_a["token"]))
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # Verify entirely removed even though planner_qty > 0
    items = requests.get(f"{BASE_URL}/shopping", headers=H(user_a["token"])).json()
    assert not any(i["id"] == ing["id"] for i in items)

    # Planner slot should still exist (planner not modified)
    plan = requests.get(f"{BASE_URL}/planner/2026-02-07", headers=H(user_a["token"])).json()
    assert "0_pranzo" in plan.get("slots", {})

    # cleanup
    requests.put(f"{BASE_URL}/planner/slot",
                 json={"week_start": "2026-02-07", "day_index": 0, "meal": "pranzo", "dish_id": None},
                 headers=H(user_a["token"]))
    requests.delete(f"{BASE_URL}/dishes/{dish['id']}", headers=H(user_a["token"]))


def test_force_delete_not_owned_404(user_a, user_b):
    # user_a creates a manual item
    r = requests.post(f"{BASE_URL}/shopping",
                      json={"name": "TEST_ForceOwn", "quantity": 1, "unit": "pz"},
                      headers=H(user_a["token"]))
    item_id = r.json()["id"]

    # user_b attempts to force-delete
    r = requests.delete(f"{BASE_URL}/shopping/{item_id}/force", headers=H(user_b["token"]))
    assert r.status_code == 404

    # cleanup
    requests.delete(f"{BASE_URL}/shopping/{item_id}/force", headers=H(user_a["token"]))


def test_force_delete_nonexistent_404(user_a):
    r = requests.delete(f"{BASE_URL}/shopping/nonexistent_id/force", headers=H(user_a["token"]))
    assert r.status_code == 404
