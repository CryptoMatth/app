"""Iteration 6 — clear-checked deletes ALL checked items regardless of source."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://meal-prep-master-2.preview.emergentagent.com",
).rstrip("/") + "/api"


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def user():
    email = f"test_it6_{uuid.uuid4().hex[:8]}@t.co"
    r = requests.post(f"{BASE_URL}/auth/register",
                      json={"email": email, "password": "test1234", "name": "It6"})
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["session_token"]}


@pytest.fixture(scope="module")
def dish(user):
    payload = {
        "name": "TEST_It6Dish",
        "course": "primo",
        "servings": 2,
        "ingredients": [
            {"name": "TEST_it6_flour", "quantity": 200, "unit": "g"},
        ],
        "preparation": "x",
    }
    r = requests.post(f"{BASE_URL}/dishes", json=payload, headers=H(user["token"]))
    assert r.status_code == 200
    return r.json()


def _list_shopping(user):
    return requests.get(f"{BASE_URL}/shopping", headers=H(user["token"])).json()


def _clear_all(user):
    """Test-only cleanup: delete every shopping item hard so tests are isolated."""
    for it in _list_shopping(user):
        requests.delete(f"{BASE_URL}/shopping/{it['id']}/force", headers=H(user["token"]))


# ---------- Bug #2 verification ----------
def test_clear_checked_removes_manual_only_item(user):
    _clear_all(user)
    r = requests.post(f"{BASE_URL}/shopping",
                      json={"name": "TEST_it6_manual_only", "quantity": 1, "unit": "pz"},
                      headers=H(user["token"]))
    assert r.status_code == 200
    item = r.json()

    r = requests.patch(f"{BASE_URL}/shopping/{item['id']}/toggle",
                       json={"checked": True}, headers=H(user["token"]))
    assert r.status_code == 200

    r = requests.post(f"{BASE_URL}/shopping/clear-checked", headers=H(user["token"]))
    assert r.status_code == 200

    remaining = _list_shopping(user)
    assert not any(i["id"] == item["id"] for i in remaining), \
        "Manual-only checked item should be gone after clear-checked"


def test_clear_checked_removes_mixed_planner_and_manual_item(user, dish):
    """The core bug fix: an item with planner_qty > 0 AND manual_qty > 0 that is
    checked must be fully deleted (not just unchecked / not just manual portion removed)."""
    _clear_all(user)

    # 1. Add dish to planner => creates row with planner_qty
    week = "2026-03-07"
    body = {"week_start": week, "day_index": 0, "meal": "pranzo",
            "dish_id": dish["id"], "persons": 2}
    r = requests.put(f"{BASE_URL}/planner/slot", json=body, headers=H(user["token"]))
    assert r.status_code == 200

    items = _list_shopping(user)
    flour = next((i for i in items if i["name"].lower() == "test_it6_flour"), None)
    assert flour is not None
    assert flour["planner_qty"] > 0

    # 2. Also add same ingredient manually => same row gets manual_qty
    r = requests.post(f"{BASE_URL}/shopping",
                      json={"name": "TEST_it6_flour", "quantity": 50, "unit": "g"},
                      headers=H(user["token"]))
    assert r.status_code == 200
    items = _list_shopping(user)
    mixed = next(i for i in items if i["name"].lower() == "test_it6_flour")
    assert mixed["planner_qty"] > 0 and mixed["manual_qty"] > 0

    # 3. Check it and clear-checked
    r = requests.patch(f"{BASE_URL}/shopping/{mixed['id']}/toggle",
                       json={"checked": True}, headers=H(user["token"]))
    assert r.status_code == 200

    r = requests.post(f"{BASE_URL}/shopping/clear-checked", headers=H(user["token"]))
    assert r.status_code == 200

    # 4. The mixed row must be entirely gone even though planner_qty was > 0
    items = _list_shopping(user)
    assert not any(i["id"] == mixed["id"] for i in items), \
        "Bug: clear-checked did not delete a mixed (planner+manual) checked row"

    # 5. But the planner slot itself must remain untouched
    plan = requests.get(f"{BASE_URL}/planner/{week}", headers=H(user["token"])).json()
    assert "0_pranzo" in plan.get("slots", {})

    # cleanup planner slot
    requests.put(f"{BASE_URL}/planner/slot",
                 json={"week_start": week, "day_index": 0, "meal": "pranzo",
                       "dish_id": None, "persons": 1},
                 headers=H(user["token"]))


def test_clear_checked_removes_planner_only_item(user, dish):
    """Planner-only (no manual_qty) checked row must also be fully deleted."""
    _clear_all(user)
    week = "2026-03-14"
    body = {"week_start": week, "day_index": 1, "meal": "cena",
            "dish_id": dish["id"], "persons": 2}
    r = requests.put(f"{BASE_URL}/planner/slot", json=body, headers=H(user["token"]))
    assert r.status_code == 200

    items = _list_shopping(user)
    flour = next(i for i in items if i["name"].lower() == "test_it6_flour")
    assert flour["planner_qty"] > 0
    assert flour["manual_qty"] == 0

    r = requests.patch(f"{BASE_URL}/shopping/{flour['id']}/toggle",
                       json={"checked": True}, headers=H(user["token"]))
    assert r.status_code == 200

    r = requests.post(f"{BASE_URL}/shopping/clear-checked", headers=H(user["token"]))
    assert r.status_code == 200

    items = _list_shopping(user)
    assert not any(i["id"] == flour["id"] for i in items), \
        "Bug: clear-checked did not delete a planner-only checked row"

    # cleanup planner slot
    requests.put(f"{BASE_URL}/planner/slot",
                 json={"week_start": week, "day_index": 1, "meal": "cena",
                       "dish_id": None, "persons": 1},
                 headers=H(user["token"]))


def test_clear_checked_ignores_unchecked_items(user):
    _clear_all(user)
    a = requests.post(f"{BASE_URL}/shopping",
                      json={"name": "TEST_it6_keep_a", "quantity": 1, "unit": "pz"},
                      headers=H(user["token"])).json()
    b = requests.post(f"{BASE_URL}/shopping",
                      json={"name": "TEST_it6_remove_b", "quantity": 1, "unit": "pz"},
                      headers=H(user["token"])).json()

    requests.patch(f"{BASE_URL}/shopping/{b['id']}/toggle",
                   json={"checked": True}, headers=H(user["token"]))

    r = requests.post(f"{BASE_URL}/shopping/clear-checked", headers=H(user["token"]))
    assert r.status_code == 200

    items = _list_shopping(user)
    assert any(i["id"] == a["id"] for i in items), "Unchecked item was wrongly deleted"
    assert not any(i["id"] == b["id"] for i in items), "Checked item was not deleted"
