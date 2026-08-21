"""Iteration 4 tests: forgot-password / reset-password, planner-weeks, export/import."""
import os
import uuid
import time
from datetime import datetime, timedelta, timezone
import bcrypt
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://meal-prep-master-2.preview.emergentagent.com",
).rstrip("/") + "/api"

# Load backend .env to get MONGO creds
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

mongo = MongoClient(MONGO_URL)[DB_NAME]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def user():
    email = f"test_it4_{uuid.uuid4().hex[:8]}@t.co"
    r = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": "test1234", "name": "IT4"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "token": d["session_token"], "user": d["user"]}


# ---- Forgot Password ----
def test_forgot_password_unknown_email_returns_ok():
    r = requests.post(f"{BASE_URL}/auth/forgot-password", json={"email": f"nope_{uuid.uuid4().hex[:6]}@t.co"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_forgot_password_known_email_returns_ok(user):
    # Will attempt send but Resend blocks .co domain — endpoint must still return ok=true
    r = requests.post(f"{BASE_URL}/auth/forgot-password", json={"email": user["email"]})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


# ---- Reset Password (inject reset code directly into Mongo) ----
def _inject_reset(email: str, code: str, attempts: int = 0, expires_delta_min: int = 15):
    code_hash = bcrypt.hashpw(code.encode(), bcrypt.gensalt()).decode()
    mongo["password_resets"].delete_many({"email": email})
    mongo["password_resets"].insert_one({
        "email": email,
        "code_hash": code_hash,
        "attempts": attempts,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=expires_delta_min),
    })


def test_reset_password_invalid_code(user):
    _inject_reset(user["email"], "123456")
    r = requests.post(f"{BASE_URL}/auth/reset-password",
                      json={"email": user["email"], "code": "999999", "new_password": "newpass123"})
    assert r.status_code == 400
    # Attempts must be incremented
    rec = mongo["password_resets"].find_one({"email": user["email"]})
    assert rec is not None
    assert rec["attempts"] == 1


def test_reset_password_success_and_session_invalidation(user):
    old_token = user["token"]
    # Confirm old token works
    r = requests.get(f"{BASE_URL}/auth/me", headers=H(old_token))
    assert r.status_code == 200

    _inject_reset(user["email"], "123456")
    new_pw = "brandnew123"
    r = requests.post(f"{BASE_URL}/auth/reset-password",
                      json={"email": user["email"], "code": "123456", "new_password": new_pw})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "session_token" in data and "user" in data
    assert data["user"]["email"] == user["email"]
    new_token = data["session_token"]

    # Old token must now be invalid
    r_old = requests.get(f"{BASE_URL}/auth/me", headers=H(old_token))
    assert r_old.status_code == 401

    # New token works
    r_new = requests.get(f"{BASE_URL}/auth/me", headers=H(new_token))
    assert r_new.status_code == 200

    # Login with new password works, old fails
    r_login = requests.post(f"{BASE_URL}/auth/login", json={"email": user["email"], "password": new_pw})
    assert r_login.status_code == 200
    r_login_old = requests.post(f"{BASE_URL}/auth/login", json={"email": user["email"], "password": "test1234"})
    assert r_login_old.status_code == 401

    # password_resets cleaned
    rec = mongo["password_resets"].find_one({"email": user["email"]})
    assert rec is None

    # Update fixture token for subsequent tests
    user["token"] = new_token
    user["password"] = new_pw


def test_reset_password_expired_code(user):
    _inject_reset(user["email"], "123456", expires_delta_min=-1)
    r = requests.post(f"{BASE_URL}/auth/reset-password",
                      json={"email": user["email"], "code": "123456", "new_password": "another123"})
    assert r.status_code == 400
    # Row cleared
    assert mongo["password_resets"].find_one({"email": user["email"]}) is None


def test_reset_password_attempts_exceeded(user):
    _inject_reset(user["email"], "123456", attempts=5)
    r = requests.post(f"{BASE_URL}/auth/reset-password",
                      json={"email": user["email"], "code": "123456", "new_password": "another123"})
    assert r.status_code == 400
    assert mongo["password_resets"].find_one({"email": user["email"]}) is None


def test_reset_password_short_password(user):
    _inject_reset(user["email"], "123456")
    r = requests.post(f"{BASE_URL}/auth/reset-password",
                      json={"email": user["email"], "code": "123456", "new_password": "abc"})
    assert r.status_code == 400
    mongo["password_resets"].delete_many({"email": user["email"]})


# ---- Planner Weeks ----
def test_planner_weeks_lists_weeks_with_slots(user):
    token = user["token"]
    # Create a dish
    r = requests.post(f"{BASE_URL}/dishes", json={
        "name": "TEST_IT4_Dish", "course": "primo", "servings": 2,
        "ingredients": [{"name": "TEST_IT4_Ing", "quantity": 100, "unit": "g"}],
        "preparation": "",
    }, headers=H(token))
    assert r.status_code == 200
    dish = r.json()

    # Add slots in 2 distinct weeks (Saturdays)
    w1 = "2026-03-07"
    w2 = "2026-03-14"
    for wk in (w1, w2):
        r = requests.put(f"{BASE_URL}/planner/slot",
                         json={"week_start": wk, "day_index": 0, "meal": "pranzo", "dish_id": dish["id"], "persons": 2},
                         headers=H(token))
        assert r.status_code == 200

    r = requests.get(f"{BASE_URL}/planner-weeks", headers=H(token))
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    starts = [row["week_start"] for row in rows]
    assert w1 in starts and w2 in starts
    # Most recent first
    idx1 = starts.index(w1)
    idx2 = starts.index(w2)
    assert idx2 < idx1  # w2 more recent
    # Each has count
    for row in rows:
        assert "count" in row and isinstance(row["count"], int)
        if row["week_start"] in (w1, w2):
            assert row["count"] >= 1

    # user-scoped: create another user, its weeks should be empty
    other_email = f"other_{uuid.uuid4().hex[:6]}@t.co"
    r = requests.post(f"{BASE_URL}/auth/register", json={"email": other_email, "password": "test1234"})
    other_token = r.json()["session_token"]
    r = requests.get(f"{BASE_URL}/planner-weeks", headers=H(other_token))
    assert r.status_code == 200
    assert r.json() == []

    # cleanup
    for wk in (w1, w2):
        requests.put(f"{BASE_URL}/planner/slot",
                     json={"week_start": wk, "day_index": 0, "meal": "pranzo", "dish_id": None},
                     headers=H(token))
    requests.delete(f"{BASE_URL}/dishes/{dish['id']}", headers=H(token))


# ---- Export ----
def test_export_returns_user_snapshot(user):
    token = user["token"]
    # Add a dish so export has content
    r = requests.post(f"{BASE_URL}/dishes", json={
        "name": "TEST_ExportDish", "course": "secondo", "servings": 1,
        "ingredients": [], "preparation": "",
    }, headers=H(token))
    dish = r.json()

    r = requests.get(f"{BASE_URL}/export", headers=H(token))
    assert r.status_code == 200
    data = r.json()
    assert data["app"] == "PlanEat"
    assert data["version"] == 1
    assert "exported_at" in data
    assert data["user"]["email"] == user["email"]
    assert isinstance(data["dishes"], list)
    assert isinstance(data["weekly_plans"], list)
    assert isinstance(data["shopping_items"], list)
    assert any(d["id"] == dish["id"] for d in data["dishes"])

    requests.delete(f"{BASE_URL}/dishes/{dish['id']}", headers=H(token))


def test_export_requires_auth():
    r = requests.get(f"{BASE_URL}/export")
    assert r.status_code == 401


# ---- Import ----
def test_import_merge_skips_existing(user):
    token = user["token"]
    # Create dish A
    r = requests.post(f"{BASE_URL}/dishes", json={
        "name": "TEST_ImportKeep", "course": "primo", "servings": 1,
        "ingredients": [], "preparation": "orig",
    }, headers=H(token))
    keep = r.json()

    # Import: merge same id (should skip) + a new dish
    new_id = uuid.uuid4().hex
    payload = {
        "dishes": [
            {"id": keep["id"], "name": "TEST_ChangedName", "course": "secondo", "servings": 9, "preparation": "changed"},
            {"id": new_id, "name": "TEST_ImportNew", "course": "primo", "servings": 2, "ingredients": [], "preparation": ""},
        ],
        "weekly_plans": [],
        "shopping_items": [],
        "mode": "merge",
    }
    r = requests.post(f"{BASE_URL}/import", json=payload, headers=H(token))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    # Only the new dish should be imported (existing skipped)
    assert data["imported"]["dishes"] == 1

    # Existing dish preserved (name unchanged)
    r = requests.get(f"{BASE_URL}/dishes/{keep['id']}", headers=H(token))
    assert r.status_code == 200
    assert r.json()["name"] == "TEST_ImportKeep"
    assert r.json()["preparation"] == "orig"

    # New dish present
    r = requests.get(f"{BASE_URL}/dishes/{new_id}", headers=H(token))
    assert r.status_code == 200

    # cleanup
    requests.delete(f"{BASE_URL}/dishes/{keep['id']}", headers=H(token))
    requests.delete(f"{BASE_URL}/dishes/{new_id}", headers=H(token))


def test_import_replace_wipes_and_imports(user):
    token = user["token"]
    # Seed with a dish
    r = requests.post(f"{BASE_URL}/dishes", json={
        "name": "TEST_WillBeWiped", "course": "primo", "servings": 1,
        "ingredients": [], "preparation": "",
    }, headers=H(token))
    old = r.json()

    payload = {
        "dishes": [
            {"id": uuid.uuid4().hex, "name": "TEST_ReplaceOnly", "course": "secondo", "servings": 1,
             "ingredients": [], "preparation": ""},
        ],
        "weekly_plans": [],
        "shopping_items": [
            {"id": uuid.uuid4().hex, "name": "TEST_ImpItem", "unit": "pz", "manual_qty": 2, "planner_qty": 0,
             "sources": [], "checked": False, "order": 0},
        ],
        "mode": "replace",
    }
    r = requests.post(f"{BASE_URL}/import", json=payload, headers=H(token))
    assert r.status_code == 200
    data = r.json()
    assert data["imported"]["dishes"] == 1
    assert data["imported"]["shopping_items"] == 1

    # Old dish must be gone
    r = requests.get(f"{BASE_URL}/dishes/{old['id']}", headers=H(token))
    assert r.status_code == 404

    # Listed items reflect replace
    dishes = requests.get(f"{BASE_URL}/dishes", headers=H(token)).json()
    names = [d["name"] for d in dishes]
    assert "TEST_ReplaceOnly" in names
    assert "TEST_WillBeWiped" not in names

    items = requests.get(f"{BASE_URL}/shopping", headers=H(token)).json()
    assert any(i["name"] == "TEST_ImpItem" for i in items)

    # cleanup: replace with empty payload to reset
    requests.post(f"{BASE_URL}/import",
                  json={"dishes": [], "weekly_plans": [], "shopping_items": [], "mode": "replace"},
                  headers=H(token))


def test_import_requires_auth():
    r = requests.post(f"{BASE_URL}/import", json={"dishes": [], "weekly_plans": [], "shopping_items": [], "mode": "merge"})
    assert r.status_code == 401
