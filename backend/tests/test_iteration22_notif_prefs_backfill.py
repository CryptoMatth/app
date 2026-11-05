# Iteration 22: notification prefs defaults, symmetric legacy backfill, partial patch
import os
import time
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path("/app/frontend/.env"))
load_dotenv(Path("/app/backend/.env"))
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

CREATED = []


def _register():
    uname = f"test_{uuid.uuid4().hex[:10]}"
    r = requests.post(f"{API}/auth/register", json={"username": uname, "password": "pass1234", "password_repeat": "pass1234"})
    assert r.status_code == 200, r.text
    d = r.json()
    CREATED.append(d["user"]["user_id"])
    return d["session_token"], d["user"]["user_id"], d["user"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for uid in CREATED:
        mdb.users.delete_one({"user_id": uid})
        mdb.user_sessions.delete_many({"user_id": uid})


# New user defaults
def test_new_user_defaults_both_false():
    tok, uid, user = _register()
    n = user["preferences"]["notifications"]
    assert n["expiry_enabled"] is False and n["freezer_enabled"] is False
    r = requests.get(f"{API}/auth/preferences", headers=_h(tok))
    assert r.status_code == 200
    n = r.json()["notifications"]
    assert n["expiry_enabled"] is False
    assert n["freezer_enabled"] is False
    assert n["freezer_hours"] == 24 and n["notify_hour"] == 9 and n["days_ahead"] == [1]


# Legacy doc {enabled:true} -> both backfilled true
def test_legacy_enabled_true_backfills_both_true():
    tok, uid, _ = _register()
    mdb.users.update_one({"user_id": uid}, {"$set": {"preferences.notifications": {"enabled": True}}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["expiry_enabled"] is True and n["freezer_enabled"] is True
    assert n["days_ahead"] == [1] and n["freezer_hours"] == 24


def test_legacy_enabled_false_backfills_both_false():
    tok, uid, _ = _register()
    mdb.users.update_one({"user_id": uid}, {"$set": {"preferences.notifications": {"enabled": False}}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["expiry_enabled"] is False and n["freezer_enabled"] is False


# Doc with only freezer_enabled -> expiry backfilled false (and vice versa)
def test_only_freezer_set_expiry_false():
    tok, uid, _ = _register()
    mdb.users.update_one({"user_id": uid}, {"$set": {"preferences.notifications": {"enabled": True, "freezer_enabled": True}}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["freezer_enabled"] is True
    assert n["expiry_enabled"] is False


def test_only_expiry_set_freezer_false():
    tok, uid, _ = _register()
    mdb.users.update_one({"user_id": uid}, {"$set": {"preferences.notifications": {"enabled": True, "expiry_enabled": True}}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["expiry_enabled"] is True
    assert n["freezer_enabled"] is False


# Partial patch on new-schema user
def test_partial_patch_freezer_does_not_touch_expiry():
    tok, uid, _ = _register()
    r = requests.put(f"{API}/auth/preferences", headers=_h(tok), json={"notifications": {
        "expiry_enabled": True, "days_ahead": [3, 1], "notify_hour": 18, "enabled": True}})
    assert r.status_code == 200
    r = requests.put(f"{API}/auth/preferences", headers=_h(tok), json={"notifications": {
        "freezer_enabled": True, "freezer_hours": 48, "enabled": True}})
    assert r.status_code == 200
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["expiry_enabled"] is True and n["days_ahead"] == [3, 1] and n["notify_hour"] == 18
    assert n["expiry_days_ahead"] == 3
    assert n["freezer_enabled"] is True and n["freezer_hours"] == 48
    # now turn expiry off -> freezer untouched
    requests.put(f"{API}/auth/preferences", headers=_h(tok), json={"notifications": {"expiry_enabled": False, "enabled": True}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["expiry_enabled"] is False and n["freezer_enabled"] is True and n["freezer_hours"] == 48
    # turn freezer off -> expiry still off, days preserved
    requests.put(f"{API}/auth/preferences", headers=_h(tok), json={"notifications": {"freezer_enabled": False, "enabled": False}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["expiry_enabled"] is False and n["freezer_enabled"] is False and n["days_ahead"] == [3, 1]


# Partial patch on LEGACY user (exact payload sent by notifications-freezer.tsx)
def test_legacy_user_freezer_save_preserves_expiry():
    tok, uid, _ = _register()
    mdb.users.update_one({"user_id": uid}, {"$set": {"preferences.notifications": {"enabled": True}}})
    # Client sees expiry=true,freezer=true; user turns freezer OFF on freezer screen
    requests.put(f"{API}/auth/preferences", headers=_h(tok), json={"notifications": {
        "freezer_enabled": False, "freezer_hours": 24, "enabled": True}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["freezer_enabled"] is False
    assert n["expiry_enabled"] is True, f"expiry lost after freezer-only save on legacy doc: {n}"


# Partial patch on LEGACY user (exact payload sent by notifications-expiry.tsx)
def test_legacy_user_expiry_save_preserves_freezer():
    tok, uid, _ = _register()
    mdb.users.update_one({"user_id": uid}, {"$set": {"preferences.notifications": {"enabled": True}}})
    requests.put(f"{API}/auth/preferences", headers=_h(tok), json={"notifications": {
        "expiry_enabled": False, "days_ahead": [1], "expiry_days_ahead": 1, "notify_hour": 9, "enabled": True}})
    n = requests.get(f"{API}/auth/preferences", headers=_h(tok)).json()["notifications"]
    assert n["expiry_enabled"] is False
    assert n["freezer_enabled"] is True, f"freezer lost after expiry-only save on legacy doc: {n}"


# Founder halley login + prefs readable (no writes on halley here)
def test_halley_login_pro_plus():
    r = requests.post(f"{API}/auth/login", json={"username": "halley", "password": "halley1234"})
    assert r.status_code == 200
    u = r.json()["user"]
    assert u["tier"] == "pro_plus" and u["pro_source"] == "founder"
    n = u["preferences"]["notifications"]
    assert isinstance(n["expiry_enabled"], bool) and isinstance(n["freezer_enabled"], bool)


# Clamp validation
def test_clamps():
    tok, uid, _ = _register()
    n = requests.put(f"{API}/auth/preferences", headers=_h(tok), json={"notifications": {
        "freezer_hours": 999, "notify_hour": 50, "days_ahead": [99, -3, 1, 1]}}).json()["notifications"]
    assert n["freezer_hours"] == 168 and n["notify_hour"] == 23 and n["days_ahead"] == [30, 1, 0]
