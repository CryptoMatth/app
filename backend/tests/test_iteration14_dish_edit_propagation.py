"""Iteration 14 tests: dish edit → shopping list propagation + FOUNDER_USERNAMES narrowing.

Covers:
  A. Ingredient / servings recompute on PUT /api/dishes/{id}
     - rename ingredient (`riso` → `risotto`) removes old row when no other sources
     - add ingredient (`zafferano`) → new row appears scaled by persons
     - remove ingredient → its row cleaned up
     - change ingredient quantity → shopping row scales with it
     - change dish `servings` → shopping quantity scales inversely
     - non-name / non-ingredient change (course/prep/notes only) does NOT touch shopping
     - multi-item slot: edit dish A → A's sources updated, sibling dish B untouched
     - multi-week: dish in weeks W1 and W2 → both recompute correctly
     - legacy flat slot form (no items[]) also gets recomputed
     - orphan dish (not referenced) edits without touching shopping
     - manual shopping items are NEVER modified by dish updates
  B. FOUNDER_USERNAMES == {"halley"} (halley/Halley/HALLEY)
     - `matteo`, `admin` are NO LONGER founders → is_pro:false out of the box
     - admin endpoint can still grant Pro to `matteo` explicitly
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

# Prefer public URL (what the mobile app sees); fall back to localhost per review request.
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_PW = os.environ.get("ADMIN_PASSWORD") or "planeat-admin-CH4ngeMe-2026"
ADMIN_H = {"X-Admin-Password": ADMIN_PW}


# ---------------- helpers ----------------
def _uniq(prefix: str = "it14") -> str:
    return f"{prefix}{int(time.time() * 1000) % 10_000_000}{uuid.uuid4().hex[:4]}"


def _delete_user_by_username(username: str) -> None:
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


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_dish(token: str, name: str,
               ingredients: Optional[List[Dict[str, Any]]] = None,
               servings: int = 1, course: str = "primo",
               preparation: str = "", notes: str = "") -> Dict[str, Any]:
    r = requests.post(f"{API}/dishes", headers=_auth(token), json={
        "name": name, "course": course, "servings": servings,
        "ingredients": ingredients or [], "preparation": preparation, "notes": notes,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _put_dish(token: str, dish_id: str, **kwargs) -> Dict[str, Any]:
    body = {
        "name": kwargs.get("name"),
        "course": kwargs.get("course", "primo"),
        "servings": kwargs.get("servings", 1),
        "ingredients": kwargs.get("ingredients", []),
        "preparation": kwargs.get("preparation", ""),
        "notes": kwargs.get("notes", ""),
    }
    r = requests.put(f"{API}/dishes/{dish_id}", headers=_auth(token), json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _put_slot(token: str, week: str, day_index: int, meal: str,
              items: List[Dict[str, Any]]) -> None:
    r = requests.put(f"{API}/planner/slot", headers=_auth(token), json={
        "week_start": week, "day_index": day_index, "meal": meal, "items": items,
    }, timeout=15)
    assert r.status_code == 200, r.text


def _shopping(token: str) -> List[Dict[str, Any]]:
    r = requests.get(f"{API}/shopping", headers=_auth(token), timeout=15)
    assert r.status_code == 200
    return r.json()


def _find(shopping: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    for it in shopping:
        if it.get("name") == name:
            return it
    return None


WEEK = "2026-08-24"
WEEK2 = "2026-08-31"


# =====================================================================
# A. Dish edit → shopping recompute
# =====================================================================
class TestIngredientRename:
    def test_rename_ingredient_removes_old_row(self):
        reg = _register(_uniq("ir1"))
        tok = reg["session_token"]
        dish = _make_dish(tok, "Risotto", servings=1, ingredients=[
            {"name": "riso", "quantity": 100, "unit": "g"},
        ])
        _put_slot(tok, WEEK, 0, "pranzo",
                  [{"dish_id": dish["id"], "persons": 2}])

        # persons=2 / servings=1 → multiplier 2 → 200g
        s0 = _shopping(tok)
        riso = _find(s0, "riso")
        assert riso is not None, s0
        assert riso["planner_qty"] == 200.0

        # Rename ingredient (dish name unchanged)
        _put_dish(tok, dish["id"], name="Risotto", servings=1,
                  ingredients=[{"name": "risotto", "quantity": 100, "unit": "g"}])

        s1 = _shopping(tok)
        assert _find(s1, "riso") is None, f"old row 'riso' should be gone: {s1}"
        risotto = _find(s1, "risotto")
        assert risotto is not None, s1
        assert risotto["planner_qty"] == 200.0
        # source must reference this dish
        assert any(src.get("dish_id") == dish["id"] for src in risotto["sources"])


class TestIngredientAddAndRemove:
    def test_add_ingredient_then_remove_it(self):
        reg = _register(_uniq("iar"))
        tok = reg["session_token"]
        dish = _make_dish(tok, "Risotto Zaff", servings=1, ingredients=[
            {"name": "risotto", "quantity": 100, "unit": "g"},
        ])
        _put_slot(tok, WEEK, 0, "pranzo",
                  [{"dish_id": dish["id"], "persons": 2}])

        # Add zafferano 5g
        _put_dish(tok, dish["id"], name="Risotto Zaff", servings=1, ingredients=[
            {"name": "risotto", "quantity": 100, "unit": "g"},
            {"name": "zafferano", "quantity": 5, "unit": "g"},
        ])
        s1 = _shopping(tok)
        assert _find(s1, "risotto")["planner_qty"] == 200.0, s1
        z = _find(s1, "zafferano")
        assert z is not None and z["planner_qty"] == 10.0, s1

        # Remove zafferano AND scale risotto to 150g
        _put_dish(tok, dish["id"], name="Risotto Zaff", servings=1, ingredients=[
            {"name": "risotto", "quantity": 150, "unit": "g"},
        ])
        s2 = _shopping(tok)
        assert _find(s2, "zafferano") is None, f"zafferano row should be removed: {s2}"
        assert _find(s2, "risotto")["planner_qty"] == 300.0, s2


class TestServingsChange:
    def test_change_servings_scales_shopping(self):
        reg = _register(_uniq("sv1"))
        tok = reg["session_token"]
        # servings=1, persons=2 → x2 → 200g
        dish = _make_dish(tok, "Pasta", servings=1, ingredients=[
            {"name": "pasta", "quantity": 100, "unit": "g"},
        ])
        _put_slot(tok, WEEK, 0, "pranzo",
                  [{"dish_id": dish["id"], "persons": 2}])
        assert _find(_shopping(tok), "pasta")["planner_qty"] == 200.0

        # Change servings 1 → 2, same ingredients: multiplier now persons/servings=2/2=1 → 100g
        _put_dish(tok, dish["id"], name="Pasta", servings=2, ingredients=[
            {"name": "pasta", "quantity": 100, "unit": "g"},
        ])
        assert _find(_shopping(tok), "pasta")["planner_qty"] == 100.0


class TestNonNameNonIngredientChangesUntouched:
    def test_course_prep_notes_only_does_not_touch_shopping(self):
        reg = _register(_uniq("nn1"))
        tok = reg["session_token"]
        dish = _make_dish(tok, "Dish", servings=1, course="primo",
                          preparation="p1", notes="n1", ingredients=[
                              {"name": "farina", "quantity": 80, "unit": "g"},
                          ])
        _put_slot(tok, WEEK, 0, "pranzo",
                  [{"dish_id": dish["id"], "persons": 1}])
        before = _find(_shopping(tok), "farina")
        assert before is not None and before["planner_qty"] == 80.0
        src_ids_before = sorted(s["source_id"] for s in before["sources"])

        # Update ONLY course/prep/notes; keep name+ingredients+servings the same
        _put_dish(tok, dish["id"], name="Dish", servings=1, course="secondo",
                  preparation="p2", notes="n2", ingredients=[
                      {"name": "farina", "quantity": 80, "unit": "g"},
                  ])
        after = _find(_shopping(tok), "farina")
        assert after is not None and after["planner_qty"] == 80.0
        # sources untouched → same source_ids
        src_ids_after = sorted(s["source_id"] for s in after["sources"])
        assert src_ids_before == src_ids_after, (src_ids_before, src_ids_after)


class TestMultiItemSlotSiblingsUntouched:
    def test_edit_A_does_not_affect_B_in_same_slot(self):
        reg = _register(_uniq("mm1"))
        tok = reg["session_token"]
        dishA = _make_dish(tok, "A", servings=1, ingredients=[
            {"name": "aing", "quantity": 50, "unit": "g"},
        ])
        dishB = _make_dish(tok, "B", servings=1, ingredients=[
            {"name": "bing", "quantity": 30, "unit": "g"},
        ])
        _put_slot(tok, WEEK, 0, "pranzo", [
            {"dish_id": dishA["id"], "persons": 2},
            {"dish_id": dishB["id"], "persons": 2},
        ])
        s0 = _shopping(tok)
        assert _find(s0, "aing")["planner_qty"] == 100.0
        assert _find(s0, "bing")["planner_qty"] == 60.0
        b_sources_before = sorted(s["source_id"] for s in _find(s0, "bing")["sources"])

        # Edit A's ingredient qty → aing 50 → 200; do NOT touch B
        _put_dish(tok, dishA["id"], name="A", servings=1, ingredients=[
            {"name": "aing", "quantity": 200, "unit": "g"},
        ])
        s1 = _shopping(tok)
        assert _find(s1, "aing")["planner_qty"] == 400.0, s1  # 200 * 2
        # B row untouched
        assert _find(s1, "bing")["planner_qty"] == 60.0
        b_sources_after = sorted(s["source_id"] for s in _find(s1, "bing")["sources"])
        assert b_sources_before == b_sources_after


class TestMultiWeekRecompute:
    def test_edit_updates_both_weeks(self):
        reg = _register(_uniq("mw1"))
        tok = reg["session_token"]
        dish = _make_dish(tok, "D", servings=1, ingredients=[
            {"name": "x", "quantity": 10, "unit": "g"},
        ])
        _put_slot(tok, WEEK, 0, "pranzo", [{"dish_id": dish["id"], "persons": 1}])
        _put_slot(tok, WEEK2, 0, "pranzo", [{"dish_id": dish["id"], "persons": 3}])

        s0 = _find(_shopping(tok), "x")
        # 1*1 + 1*3 = 4
        assert s0["planner_qty"] == 40.0 or s0["planner_qty"] == 4 * 10.0

        # rename x → y and bump to 20g
        _put_dish(tok, dish["id"], name="D", servings=1, ingredients=[
            {"name": "y", "quantity": 20, "unit": "g"},
        ])
        after = _shopping(tok)
        assert _find(after, "x") is None, f"x should be gone: {after}"
        y = _find(after, "y")
        assert y is not None
        # Now: week1 persons=1 × 20 + week2 persons=3 × 20 = 20 + 60 = 80
        assert y["planner_qty"] == 80.0, y
        # Should have sources tagged for both weeks
        weeks = {s.get("week_start") for s in y["sources"] if s.get("dish_id") == dish["id"]}
        assert weeks == {WEEK, WEEK2}, weeks


class TestLegacySlotForm:
    """Old planner docs may have `{dish_id, dish_name, course, persons}` directly
    on the slot (no `items` array). PUT /dishes must still recompute those."""

    def test_recompute_for_legacy_slot(self):
        reg = _register(_uniq("lg1"))
        tok = reg["session_token"]
        dish = _make_dish(tok, "LegacyDish", servings=1, ingredients=[
            {"name": "leg", "quantity": 100, "unit": "g"},
        ])
        # First seed via normal API so a shopping row exists (persons=2, 200g)
        _put_slot(tok, WEEK, 0, "pranzo", [{"dish_id": dish["id"], "persons": 2}])
        assert _find(_shopping(tok), "leg")["planner_qty"] == 200.0

        # Now mutate the DB directly to the legacy flat form to simulate old data.
        # Use pymongo (sync) since it's simpler here.
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        assert mongo_url and db_name, "MONGO_URL/DB_NAME not set"
        cli = MongoClient(mongo_url)
        db = cli[db_name]
        plan = db.weekly_plans.find_one({
            "user_id": reg["user"]["user_id"], "week_start": WEEK,
        })
        assert plan is not None
        new_slots = dict(plan.get("slots", {}))
        new_slots["0_pranzo"] = {
            "dish_id": dish["id"], "dish_name": "LegacyDish",
            "course": "primo", "persons": 2,
        }
        db.weekly_plans.update_one({"_id": plan["_id"]}, {"$set": {"slots": new_slots}})
        cli.close()

        # Now edit the dish (change qty 100 → 250). Recompute must find the legacy slot.
        _put_dish(tok, dish["id"], name="LegacyDish", servings=1, ingredients=[
            {"name": "leg", "quantity": 250, "unit": "g"},
        ])
        after = _find(_shopping(tok), "leg")
        assert after is not None, "leg row missing after legacy recompute"
        assert after["planner_qty"] == 500.0, after  # 250 × 2 persons


class TestManualShoppingUntouched:
    def test_manual_row_preserved_across_dish_edits(self):
        reg = _register(_uniq("mn1"))
        tok = reg["session_token"]

        # Add a manual shopping item unrelated to any dish
        r = requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "sale", "quantity": 500, "unit": "g",
        }, timeout=15)
        assert r.status_code == 200, r.text
        manual_id = r.json()["id"]

        dish = _make_dish(tok, "PastaSalata", servings=1, ingredients=[
            {"name": "pasta", "quantity": 100, "unit": "g"},
        ])
        _put_slot(tok, WEEK, 0, "pranzo", [{"dish_id": dish["id"], "persons": 2}])

        # Edit dish twice
        _put_dish(tok, dish["id"], name="PastaSalata", servings=1, ingredients=[
            {"name": "pasta", "quantity": 250, "unit": "g"},
        ])
        _put_dish(tok, dish["id"], name="PastaSalata", servings=2, ingredients=[
            {"name": "pasta", "quantity": 250, "unit": "g"},
            {"name": "olio", "quantity": 20, "unit": "ml"},
        ])

        s = _shopping(tok)
        sale = _find(s, "sale")
        assert sale is not None, "manual row lost"
        assert sale["id"] == manual_id
        assert sale["manual_qty"] == 500.0
        assert sale["planner_qty"] == 0.0
        assert sale["sources"] == []


class TestOrphanDishEdit:
    def test_orphan_edit_does_not_mutate_shopping(self):
        reg = _register(_uniq("or1"))
        tok = reg["session_token"]
        # Seed unrelated manual item + one referenced dish so shopping has state
        requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "pepe", "quantity": 10, "unit": "g",
        }, timeout=15)
        dish_ref = _make_dish(tok, "Ref", servings=1, ingredients=[
            {"name": "refing", "quantity": 40, "unit": "g"},
        ])
        _put_slot(tok, WEEK, 0, "pranzo", [{"dish_id": dish_ref["id"], "persons": 1}])
        before = _shopping(tok)

        # Orphan dish not placed anywhere
        orphan = _make_dish(tok, "Orphan", servings=1, ingredients=[
            {"name": "orx", "quantity": 12, "unit": "g"},
        ])
        # Edit the orphan
        _put_dish(tok, orphan["id"], name="Orphan2", servings=2, ingredients=[
            {"name": "orx2", "quantity": 33, "unit": "g"},
        ])

        after = _shopping(tok)
        # Same rows, same qty, no new orphan-ingredient row
        assert _find(after, "orx") is None
        assert _find(after, "orx2") is None
        assert {r["name"] for r in before} == {r["name"] for r in after}
        for name in ("pepe", "refing"):
            b = _find(before, name); a = _find(after, name)
            assert b["planner_qty"] == a["planner_qty"]
            assert b["manual_qty"] == a["manual_qty"]


# =====================================================================
# B. FOUNDER_USERNAMES narrowed to {"halley"}
# =====================================================================
class TestFounderWhitelistNarrowed:
    @pytest.mark.parametrize("input_username", ["halley", "Halley", "HALLEY"])
    def test_halley_is_still_founder(self, input_username):
        _delete_user_by_username("halley")
        reg = _register(input_username)
        u = reg["user"]
        assert u["username"] == "halley"
        assert u["is_pro"] is True
        assert u["pro_source"] == "founder"
        _delete_user_by_username("halley")

    @pytest.mark.parametrize("username", ["matteo", "admin"])
    def test_matteo_and_admin_no_longer_founders(self, username):
        _delete_user_by_username(username)
        reg = _register(username)
        u = reg["user"]
        assert u["username"] == username
        assert u["is_pro"] is False, f"{username} should NOT be founder anymore: {u}"
        assert u["pro_source"] is None, u
        _delete_user_by_username(username)

    def test_admin_can_still_grant_pro_to_matteo(self):
        _delete_user_by_username("matteo")
        reg = _register("matteo")
        uid = reg["user"]["user_id"]
        tok = reg["session_token"]
        # Fresh matteo → not pro
        assert reg["user"]["is_pro"] is False

        r = requests.post(
            f"{API}/admin/users/{uid}/entitlements/pro",
            headers=ADMIN_H, json={"active": True, "reason": "founder migration"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        me = requests.get(f"{API}/auth/me", headers=_auth(tok), timeout=15).json()
        assert me["is_pro"] is True
        assert me["pro_source"] == "admin_grant"
        _delete_user_by_username("matteo")
