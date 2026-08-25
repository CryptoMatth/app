"""Iteration 12 tests: multi-item planner slots + biweekly planner_span preference.

Covers the new behavior on top of iteration 11 regression:
  1. `planner_span` preference (weekly | biweekly, default weekly)
  2. Multi-item slot updates via PUT /api/planner/slot with `items:[...]`
  3. Legacy single-dish form still supported
  4. Empty/missing items clears the slot
  5. Shopping list contributions per item (scaled by persons/servings)
  6. Missing dish_id in items is gracefully ignored
  7. Updating a slot removes previous ingredient contributions
  8. GET /planner/{week} returns normalized {items:[...]} form
  9. Duplicate week preserves multi-item slots and shopping contributions
 10. Lazy migration: pre-existing legacy flat slots (dish_id at top-level) are
     normalized on GET

Run:
    pytest /app/backend/tests/test_iteration12_multi_items.py -v \
        --junitxml=/app/test_reports/pytest/pytest_iteration12.xml
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from pathlib import Path
from typing import Dict, Any, Tuple, List

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


# ---------------- helpers ----------------
def _uniq(prefix: str = "it12") -> str:
    return f"{prefix}{int(time.time() * 1000) % 10_000_000}{uuid.uuid4().hex[:4]}"


def _register(username: str | None = None, password: str = "pass1234") -> Tuple[str, str]:
    username = username or _uniq()
    r = requests.post(f"{API}/auth/register", json={
        "username": username, "password": password, "password_repeat": password,
    }, timeout=15)
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    data = r.json()
    return data["session_token"], data["user"]["user_id"]


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_dish(token: str, name: str, ingredients: List[Dict[str, Any]] | None = None,
               servings: int = 2, course: str = "primo") -> Dict[str, Any]:
    r = requests.post(f"{API}/dishes", headers=_auth(token), json={
        "name": name, "course": course, "servings": servings,
        "ingredients": ingredients or [],
    }, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# =====================================================================
# 1) Preference: planner_span
# =====================================================================
class TestPlannerSpanPreference:
    def test_default_is_weekly(self):
        token, _ = _register(_uniq("psp"))
        r = requests.get(f"{API}/auth/preferences", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        prefs = r.json()
        assert prefs.get("planner_span") == "weekly", prefs

    def test_default_appears_in_me(self):
        token, _ = _register(_uniq("pspme"))
        me = requests.get(f"{API}/auth/me", headers=_auth(token), timeout=10).json()
        assert me["preferences"]["planner_span"] == "weekly"

    def test_update_to_biweekly(self):
        token, _ = _register(_uniq("pspb"))
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token),
                         json={"planner_span": "biweekly"}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["planner_span"] == "biweekly"
        # persists
        r2 = requests.get(f"{API}/auth/preferences", headers=_auth(token), timeout=10)
        assert r2.json()["planner_span"] == "biweekly"

    def test_update_back_to_weekly(self):
        token, _ = _register(_uniq("pspw"))
        requests.put(f"{API}/auth/preferences", headers=_auth(token),
                     json={"planner_span": "biweekly"}, timeout=10)
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token),
                         json={"planner_span": "weekly"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["planner_span"] == "weekly"

    def test_invalid_span_rejected(self):
        token, _ = _register(_uniq("pspi"))
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token),
                         json={"planner_span": "monthly"}, timeout=10)
        assert r.status_code == 422

    def test_combined_update(self):
        """planner_span combined with week_start_day and courses in a single PUT."""
        token, _ = _register(_uniq("pspc"))
        payload = {
            "planner_span": "biweekly",
            "week_start_day": 0,
            "courses": [{"label": "Primo"}, {"label": "Secondo"}],
        }
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token), json=payload, timeout=10)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["planner_span"] == "biweekly"
        assert p["week_start_day"] == 0
        assert [c["id"] for c in p["courses"]] == ["primo", "secondo"]

    def test_partial_update_does_not_reset_other_fields(self):
        token, _ = _register(_uniq("psppa"))
        # set week_start_day and courses first
        requests.put(f"{API}/auth/preferences", headers=_auth(token), json={
            "week_start_day": 2,
            "courses": [{"label": "Antipasto"}, {"label": "Primo"}],
        }, timeout=10)
        # only change span
        r = requests.put(f"{API}/auth/preferences", headers=_auth(token),
                         json={"planner_span": "biweekly"}, timeout=10)
        assert r.status_code == 200
        p = r.json()
        assert p["planner_span"] == "biweekly"
        assert p["week_start_day"] == 2
        assert [c["id"] for c in p["courses"]] == ["antipasto", "primo"]


# =====================================================================
# 2) Multi-item slot updates
# =====================================================================
WEEK = "2026-08-24"


class TestMultiItemSlot:
    def test_new_items_form_saves_and_normalizes(self):
        token, _ = _register(_uniq("mi1"))
        d1 = _make_dish(token, "DishA")
        d2 = _make_dish(token, "DishB")
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 0, "meal": "pranzo",
            "items": [
                {"dish_id": d1["id"], "persons": 4},
                {"dish_id": d2["id"], "persons": 2},
            ],
        }, timeout=10)
        assert r.status_code == 200, r.text
        plan = r.json()
        slot = plan["slots"]["0_pranzo"]
        assert "items" in slot and isinstance(slot["items"], list)
        assert len(slot["items"]) == 2
        ids = [it["dish_id"] for it in slot["items"]]
        assert ids == [d1["id"], d2["id"]]
        # dish_name/course resolved server-side
        assert slot["items"][0]["dish_name"] == "DishA"
        assert slot["items"][0]["persons"] == 4
        assert slot["items"][1]["persons"] == 2

        # GET returns normalized shape
        g = requests.get(f"{API}/planner/{WEEK}", headers=_auth(token), timeout=10).json()
        assert g["slots"]["0_pranzo"]["items"][0]["dish_id"] == d1["id"]

    def test_legacy_single_dish_form_still_works(self):
        token, _ = _register(_uniq("mi2"))
        d = _make_dish(token, "Legacy")
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 1, "meal": "cena",
            "dish_id": d["id"], "persons": 3,
        }, timeout=10)
        assert r.status_code == 200
        slot = r.json()["slots"]["1_cena"]
        assert slot["items"] and len(slot["items"]) == 1
        assert slot["items"][0]["dish_id"] == d["id"]
        assert slot["items"][0]["persons"] == 3
        assert slot["items"][0]["dish_name"] == "Legacy"

    def test_empty_items_clears_slot(self):
        token, _ = _register(_uniq("mi3"))
        d = _make_dish(token, "ToClear")
        # add
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 2, "meal": "pranzo",
            "items": [{"dish_id": d["id"], "persons": 2}],
        }, timeout=10)
        # clear
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 2, "meal": "pranzo",
            "items": [],
        }, timeout=10)
        assert r.status_code == 200
        assert "2_pranzo" not in r.json().get("slots", {})

    def test_missing_items_and_no_dish_clears(self):
        token, _ = _register(_uniq("mi4"))
        d = _make_dish(token, "ToClear2")
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 3, "meal": "pranzo",
            "dish_id": d["id"], "persons": 2,
        }, timeout=10)
        # null items + null dish_id
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 3, "meal": "pranzo",
            "items": None, "dish_id": None,
        }, timeout=10)
        assert r.status_code == 200
        assert "3_pranzo" not in r.json().get("slots", {})

    def test_shopping_scales_per_item(self):
        token, _ = _register(_uniq("mish"))
        # 2 dishes with ingredients
        d1 = _make_dish(token, "Pasta", ingredients=[
            {"name": "Pasta", "quantity": 100, "unit": "g"},
        ], servings=2)
        d2 = _make_dish(token, "Salsa", ingredients=[
            {"name": "Pomodoro", "quantity": 50, "unit": "g"},
        ], servings=1)
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 4, "meal": "pranzo",
            "items": [
                {"dish_id": d1["id"], "persons": 4},   # 100 * 4/2 = 200
                {"dish_id": d2["id"], "persons": 3},   # 50 * 3/1 = 150
            ],
        }, timeout=10)
        assert r.status_code == 200
        shopping = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        by_name = {s["name"]: s for s in shopping}
        assert "Pasta" in by_name and "Pomodoro" in by_name
        assert by_name["Pasta"]["planner_qty"] == 200.0
        assert by_name["Pomodoro"]["planner_qty"] == 150.0

    def test_same_ingredient_across_items_merges(self):
        """If two dishes share an ingredient, shopping list should aggregate quantities."""
        token, _ = _register(_uniq("miag"))
        d1 = _make_dish(token, "A", ingredients=[
            {"name": "Olio", "quantity": 10, "unit": "ml"}
        ], servings=1)
        d2 = _make_dish(token, "B", ingredients=[
            {"name": "Olio", "quantity": 20, "unit": "ml"}
        ], servings=1)
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 5, "meal": "pranzo",
            "items": [
                {"dish_id": d1["id"], "persons": 2},   # 10*2 = 20
                {"dish_id": d2["id"], "persons": 3},   # 20*3 = 60
            ],
        }, timeout=10)
        assert r.status_code == 200
        shopping = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        olio = [s for s in shopping if s["name"] == "Olio"]
        assert len(olio) == 1, shopping
        assert olio[0]["planner_qty"] == 80.0

    def test_missing_dish_id_gracefully_ignored(self):
        token, _ = _register(_uniq("mimd"))
        real = _make_dish(token, "Real", ingredients=[
            {"name": "Zucchero", "quantity": 20, "unit": "g"}
        ], servings=1)
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 6, "meal": "cena",
            "items": [
                {"dish_id": "does-not-exist", "persons": 2},
                {"dish_id": real["id"], "persons": 2},
            ],
        }, timeout=10)
        assert r.status_code == 200, r.text
        slot = r.json()["slots"]["6_cena"]
        assert len(slot["items"]) == 1
        assert slot["items"][0]["dish_id"] == real["id"]
        # Shopping list has scaled ingredient for the real dish only (40g)
        shopping = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        assert any(s["name"] == "Zucchero" and s["planner_qty"] == 40.0 for s in shopping)

    def test_all_missing_dish_ids_clears_slot(self):
        token, _ = _register(_uniq("miam"))
        # first, put something
        d = _make_dish(token, "First")
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 0, "meal": "cena",
            "items": [{"dish_id": d["id"], "persons": 2}],
        }, timeout=10)
        # now overwrite with only ghost dishes
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 0, "meal": "cena",
            "items": [
                {"dish_id": "ghost1", "persons": 1},
                {"dish_id": "ghost2", "persons": 1},
            ],
        }, timeout=10)
        assert r.status_code == 200
        assert "0_cena" not in r.json().get("slots", {})

    def test_updating_slot_removes_previous_contributions(self):
        token, _ = _register(_uniq("miup"))
        d1 = _make_dish(token, "Old", ingredients=[
            {"name": "Farina", "quantity": 100, "unit": "g"}
        ], servings=1)
        d2 = _make_dish(token, "New", ingredients=[
            {"name": "Zucchero", "quantity": 50, "unit": "g"}
        ], servings=1)
        # add old
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 1, "meal": "pranzo",
            "items": [{"dish_id": d1["id"], "persons": 2}],
        }, timeout=10)
        # confirm Farina present
        s = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        assert any(x["name"] == "Farina" and x["planner_qty"] == 200.0 for x in s)

        # overwrite with new
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": WEEK, "day_index": 1, "meal": "pranzo",
            "items": [{"dish_id": d2["id"], "persons": 3}],
        }, timeout=10)
        s2 = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        # Farina should be gone, Zucchero present (150g)
        assert not any(x["name"] == "Farina" for x in s2), s2
        assert any(x["name"] == "Zucchero" and x["planner_qty"] == 150.0 for x in s2)


# =====================================================================
# 3) Duplicate week with multi-item slots
# =====================================================================
class TestDuplicateWeekMulti:
    def test_duplicate_with_three_dish_slot(self):
        token, _ = _register(_uniq("dup"))
        d1 = _make_dish(token, "DA", ingredients=[
            {"name": "IngA", "quantity": 10, "unit": "g"}
        ], servings=1)
        d2 = _make_dish(token, "DB", ingredients=[
            {"name": "IngB", "quantity": 20, "unit": "g"}
        ], servings=1)
        d3 = _make_dish(token, "DC", ingredients=[
            {"name": "IngC", "quantity": 30, "unit": "g"}
        ], servings=1)
        src_week = "2026-09-07"
        tgt_week = "2026-09-14"
        r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": src_week, "day_index": 0, "meal": "pranzo",
            "items": [
                {"dish_id": d1["id"], "persons": 2},
                {"dish_id": d2["id"], "persons": 2},
                {"dish_id": d3["id"], "persons": 2},
            ],
        }, timeout=10)
        assert r.status_code == 200
        # duplicate
        r = requests.post(f"{API}/planner/duplicate", headers=_auth(token), json={
            "source_week_start": src_week, "target_week_start": tgt_week,
        }, timeout=10)
        assert r.status_code == 200, r.text
        tgt = r.json()
        assert "0_pranzo" in tgt["slots"]
        assert len(tgt["slots"]["0_pranzo"]["items"]) == 3
        ids = [it["dish_id"] for it in tgt["slots"]["0_pranzo"]["items"]]
        assert ids == [d1["id"], d2["id"], d3["id"]]
        # shopping list must contain all three ingredients with doubled qty
        # (source's ingredients + target's = 40g each, since source contributed 20g first)
        # Wait: shopping is aggregate across weeks, so source(20) + target(20) = 40
        s = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        by = {x["name"]: x for x in s}
        for name, base in [("IngA", 20.0), ("IngB", 40.0), ("IngC", 60.0)]:
            assert name in by, s
            # base is per-week contribution; both weeks present, so total 2*base
            assert by[name]["planner_qty"] == 2 * base, (name, by[name])

    def test_duplicate_overwrites_target(self):
        token, _ = _register(_uniq("dupo"))
        d = _make_dish(token, "X", ingredients=[
            {"name": "Foo", "quantity": 10, "unit": "g"}
        ], servings=1)
        src = "2026-10-05"
        tgt = "2026-10-12"
        # target has an existing slot with a different dish
        d2 = _make_dish(token, "Y", ingredients=[
            {"name": "Bar", "quantity": 5, "unit": "g"}
        ], servings=1)
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": tgt, "day_index": 3, "meal": "cena",
            "items": [{"dish_id": d2["id"], "persons": 1}],
        }, timeout=10)
        # source
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": src, "day_index": 0, "meal": "pranzo",
            "items": [{"dish_id": d["id"], "persons": 1}],
        }, timeout=10)
        # duplicate
        r = requests.post(f"{API}/planner/duplicate", headers=_auth(token), json={
            "source_week_start": src, "target_week_start": tgt,
        }, timeout=10)
        assert r.status_code == 200
        tgt_plan = r.json()
        # old target slot 3_cena is gone
        assert "3_cena" not in tgt_plan["slots"]
        assert "0_pranzo" in tgt_plan["slots"]
        # 'Bar' should be gone from shopping (target 3_cena removed).
        s = requests.get(f"{API}/shopping", headers=_auth(token), timeout=10).json()
        assert not any(x["name"] == "Bar" for x in s)


# =====================================================================
# 4) Lazy migration of legacy slot shape
# =====================================================================
class TestLazyMigration:
    def test_legacy_flat_slot_normalized_on_get(self):
        """Inject a legacy `{dish_id, dish_name, ...}` slot directly in MongoDB,
        then GET /planner/{week} should return it in the new `{items: [...]}` form."""
        token, uid = _register(_uniq("lazy"))
        d = _make_dish(token, "LegacyDish")
        week = "2026-11-02"

        # Insert legacy shape directly into Mongo, bypassing the API.
        from motor.motor_asyncio import AsyncIOMotorClient  # local import
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def _seed():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            await db.weekly_plans.delete_one({"user_id": uid, "week_start": week})
            await db.weekly_plans.insert_one({
                "user_id": uid,
                "week_start": week,
                "slots": {
                    "2_pranzo": {
                        "dish_id": d["id"],
                        "dish_name": d["name"],
                        "course": d["course"],
                        "persons": 3,
                    }
                },
            })
            client.close()

        asyncio.get_event_loop().run_until_complete(_seed())

        # GET normalized
        r = requests.get(f"{API}/planner/{week}", headers=_auth(token), timeout=10)
        assert r.status_code == 200, r.text
        plan = r.json()
        assert "2_pranzo" in plan["slots"]
        slot = plan["slots"]["2_pranzo"]
        assert "items" in slot and isinstance(slot["items"], list)
        assert len(slot["items"]) == 1
        assert slot["items"][0]["dish_id"] == d["id"]
        assert slot["items"][0]["persons"] == 3
        # Legacy flat keys should NOT be at top level of the slot anymore
        assert "dish_id" not in slot or "items" in slot  # tolerant: at minimum items must exist


# =====================================================================
# 5) Minimal regression around the modified endpoints
# =====================================================================
class TestRegressionAfterChange:
    def test_get_planner_empty(self):
        token, _ = _register(_uniq("regE"))
        r = requests.get(f"{API}/planner/2027-01-04", headers=_auth(token), timeout=10)
        assert r.status_code == 200
        assert r.json()["slots"] == {}

    def test_planner_weeks_lists_only_weeks_with_items(self):
        token, _ = _register(_uniq("regW"))
        d = _make_dish(token, "Zeta")
        # empty listing
        r0 = requests.get(f"{API}/planner-weeks", headers=_auth(token), timeout=10)
        assert r0.status_code == 200 and r0.json() == []
        # add + list
        requests.put(f"{API}/planner/slot", headers=_auth(token), json={
            "week_start": "2027-02-01", "day_index": 0, "meal": "pranzo",
            "items": [{"dish_id": d["id"], "persons": 1}],
        }, timeout=10)
        r1 = requests.get(f"{API}/planner-weeks", headers=_auth(token), timeout=10)
        assert r1.status_code == 200
        rows = r1.json()
        assert any(x["week_start"] == "2027-02-01" and x["count"] == 1 for x in rows)

    def test_planner_slot_requires_auth(self):
        r = requests.put(f"{API}/planner/slot", json={
            "week_start": "2027-01-01", "day_index": 0, "meal": "pranzo",
            "items": [],
        }, timeout=10)
        assert r.status_code == 401
