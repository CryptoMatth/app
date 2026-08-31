"""Iteration 15 tests: ingredient categories + language preference.

Covers:
  A. preferences.language  (new, "it"|"en", default "it")
  B. preferences.ingredient_categories  (new, list of {id,label,icon?,color?},
     default = 9 seeded categories, validated on PUT).
  C. Ingredient.category_id (optional) propagates to shopping items when a dish
     is put on the planner.
  D. ShoppingItemManual.category_id (defaults to "altro" when missing).
  E. ShoppingItemUpdate.category_id updates the item's category.
  F. Never overwrite an existing shopping item's category when another dish/portion
     provides its own category.
  G. Legacy shopping items (no category_id in DB) are returned untouched from
     GET /shopping (no 500).
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

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

WEEK = "2026-09-07"


DEFAULT_IC_IDS = [
    "verdura", "frutta", "carne_pesce", "latticini", "pane_farinacei",
    "surgelati", "bevande", "dispensa", "altro",
]
DEFAULT_IC_LABELS = {
    "verdura": "Verdura",
    "frutta": "Frutta",
    "carne_pesce": "Carne / Pesce",
    "latticini": "Latticini",
    "pane_farinacei": "Pane / Farinacei",
    "surgelati": "Surgelati",
    "bevande": "Bevande",
    "dispensa": "Dispensa",
    "altro": "Altro",
}


# ---------------- helpers ----------------
def _uniq(prefix: str = "it15") -> str:
    return f"{prefix}{int(time.time() * 1000) % 10_000_000}{uuid.uuid4().hex[:4]}"


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
               servings: int = 1, course: str = "primo") -> Dict[str, Any]:
    r = requests.post(f"{API}/dishes", headers=_auth(token), json={
        "name": name, "course": course, "servings": servings,
        "ingredients": ingredients or [], "preparation": "", "notes": "",
    }, timeout=15)
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


def _prefs(token: str) -> Dict[str, Any]:
    r = requests.get(f"{API}/auth/preferences", headers=_auth(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _put_prefs(token: str, body: Dict[str, Any], expected: int = 200) -> Any:
    r = requests.put(f"{API}/auth/preferences", headers=_auth(token), json=body, timeout=15)
    assert r.status_code == expected, f"PUT prefs {r.status_code}: {r.text}"
    return r.json()


# =====================================================================
# A. preferences.language
# =====================================================================
class TestLanguagePreference:
    def test_fresh_user_defaults_to_italian(self):
        tok = _register(_uniq("lg1"))["session_token"]
        prefs = _prefs(tok)
        assert prefs.get("language") == "it", prefs

    def test_update_language_to_en(self):
        tok = _register(_uniq("lg2"))["session_token"]
        updated = _put_prefs(tok, {"language": "en"})
        assert updated["language"] == "en"
        # GET reflects update
        got = _prefs(tok)
        assert got["language"] == "en"
        # Existing default categories are preserved (untouched by language-only PUT)
        assert [c["id"] for c in got["ingredient_categories"]] == DEFAULT_IC_IDS

    def test_invalid_language_rejected(self):
        tok = _register(_uniq("lg3"))["session_token"]
        r = requests.put(f"{API}/auth/preferences", headers=_auth(tok),
                         json={"language": "fr"}, timeout=15)
        assert r.status_code == 422, r.text
        # No change persisted
        assert _prefs(tok)["language"] == "it"

    def test_language_it_and_en_both_accepted(self):
        tok = _register(_uniq("lg4"))["session_token"]
        assert _put_prefs(tok, {"language": "en"})["language"] == "en"
        assert _put_prefs(tok, {"language": "it"})["language"] == "it"


# =====================================================================
# B. preferences.ingredient_categories
# =====================================================================
class TestIngredientCategoriesDefaults:
    def test_fresh_user_has_9_default_categories_in_order(self):
        tok = _register(_uniq("ic1"))["session_token"]
        prefs = _prefs(tok)
        cats = prefs.get("ingredient_categories")
        assert isinstance(cats, list) and len(cats) == 9, cats
        assert [c["id"] for c in cats] == DEFAULT_IC_IDS
        for c in cats:
            assert c["label"] == DEFAULT_IC_LABELS[c["id"]]
            # icon and color must be present (non-empty) for defaults
            assert c.get("icon"), c
            assert c.get("color", "").startswith("#"), c


class TestIngredientCategoriesUpdate:
    def test_replace_with_labels_generates_ids(self):
        tok = _register(_uniq("ic2"))["session_token"]
        updated = _put_prefs(tok, {"ingredient_categories": [
            {"label": "Fresco"}, {"label": "Congelato"},
        ]})
        cats = updated["ingredient_categories"]
        assert [c["id"] for c in cats] == ["fresco", "congelato"], cats
        assert [c["label"] for c in cats] == ["Fresco", "Congelato"], cats

    def test_empty_list_rejected(self):
        tok = _register(_uniq("ic3"))["session_token"]
        r = requests.put(f"{API}/auth/preferences", headers=_auth(tok),
                         json={"ingredient_categories": []}, timeout=15)
        assert r.status_code == 422, r.text
        # Defaults preserved
        assert len(_prefs(tok)["ingredient_categories"]) == 9

    def test_duplicate_labels_deduplicated(self):
        tok = _register(_uniq("ic4"))["session_token"]
        updated = _put_prefs(tok, {"ingredient_categories": [
            {"label": "Fresco"},
            {"label": "fresco"},   # dup by lowercased label
            {"label": "Congelato"},
        ]})
        cats = updated["ingredient_categories"]
        # first occurrence kept, second dropped
        assert [c["id"] for c in cats] == ["fresco", "congelato"], cats

    def test_duplicate_ids_get_suffixed(self):
        tok = _register(_uniq("ic5"))["session_token"]
        updated = _put_prefs(tok, {"ingredient_categories": [
            {"id": "x", "label": "A"},
            {"id": "x", "label": "B"},
        ]})
        cats = updated["ingredient_categories"]
        # both labels differ so both survive dedup, ids must be uniquified
        assert [c["id"] for c in cats] == ["x", "x_2"], cats

    def test_icon_and_color_preserved(self):
        tok = _register(_uniq("ic6"))["session_token"]
        updated = _put_prefs(tok, {"ingredient_categories": [
            {"label": "Verdure", "icon": "🥕", "color": "#123456"},
        ]})
        cats = updated["ingredient_categories"]
        assert len(cats) == 1
        assert cats[0]["icon"] == "🥕"
        assert cats[0]["color"] == "#123456"

    def test_too_many_categories_rejected(self):
        tok = _register(_uniq("ic7"))["session_token"]
        big = [{"label": f"cat{i}"} for i in range(31)]
        r = requests.put(f"{API}/auth/preferences", headers=_auth(tok),
                         json={"ingredient_categories": big}, timeout=15)
        assert r.status_code == 422, r.text


class TestPreferencesCombinedUpdate:
    def test_language_categories_and_week_start_day_atomic(self):
        tok = _register(_uniq("ic8"))["session_token"]
        updated = _put_prefs(tok, {
            "language": "en",
            "week_start_day": 0,  # Monday
            "ingredient_categories": [{"label": "Uno"}, {"label": "Due"}],
        })
        assert updated["language"] == "en"
        assert updated["week_start_day"] == 0
        assert [c["id"] for c in updated["ingredient_categories"]] == ["uno", "due"]
        # And a re-GET matches
        got = _prefs(tok)
        assert got["language"] == "en"
        assert got["week_start_day"] == 0
        assert [c["id"] for c in got["ingredient_categories"]] == ["uno", "due"]


# =====================================================================
# C. Ingredient.category_id → shopping propagation
# =====================================================================
class TestIngredientCategoryPropagation:
    def test_dish_ingredient_category_flows_to_shopping(self):
        tok = _register(_uniq("cp1"))["session_token"]
        dish = _make_dish(tok, "Insalata Mista", servings=1, ingredients=[
            {"name": "insalata", "quantity": 100, "unit": "g",
             "category_id": "verdura"},
        ])
        # Verify dish was created with category_id
        assert dish["ingredients"][0].get("category_id") == "verdura"

        _put_slot(tok, WEEK, 0, "pranzo", [{"dish_id": dish["id"], "persons": 1}])
        s = _shopping(tok)
        row = _find(s, "insalata")
        assert row is not None, s
        assert row["category_id"] == "verdura", row
        assert row["planner_qty"] == 100.0

    def test_dish_ingredient_without_category_defaults_to_altro(self):
        tok = _register(_uniq("cp2"))["session_token"]
        dish = _make_dish(tok, "Piatto Semplice", servings=1, ingredients=[
            {"name": "sale", "quantity": 5, "unit": "g"},   # no category_id
        ])
        _put_slot(tok, WEEK, 0, "cena", [{"dish_id": dish["id"], "persons": 1}])
        s = _shopping(tok)
        row = _find(s, "sale")
        assert row is not None, s
        assert row["category_id"] == "altro", row


# =====================================================================
# D. Manual add / E. edit  → category behavior
# =====================================================================
class TestShoppingManualCategory:
    def test_add_manual_with_category(self):
        tok = _register(_uniq("mc1"))["session_token"]
        r = requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "gelato", "quantity": 500, "unit": "g",
            "category_id": "surgelati",
        }, timeout=15)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["category_id"] == "surgelati"

        # persists via GET
        row = _find(_shopping(tok), "gelato")
        assert row is not None and row["category_id"] == "surgelati"

    def test_add_manual_without_category_defaults_to_altro(self):
        tok = _register(_uniq("mc2"))["session_token"]
        r = requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "zucchero", "quantity": 200, "unit": "g",
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["category_id"] == "altro"

    def test_edit_item_changes_category(self):
        tok = _register(_uniq("mc3"))["session_token"]
        # create with surgelati
        r = requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "gelato", "quantity": 500, "unit": "g",
            "category_id": "surgelati",
        }, timeout=15)
        assert r.status_code == 200, r.text
        item_id = r.json()["id"]

        # patch → frutta
        r2 = requests.patch(f"{API}/shopping/{item_id}", headers=_auth(tok),
                            json={"category_id": "frutta"}, timeout=15)
        assert r2.status_code == 200, r2.text

        row = _find(_shopping(tok), "gelato")
        assert row is not None and row["category_id"] == "frutta", row


# =====================================================================
# F. Never overwrite an existing shopping item's category
# =====================================================================
class TestCategoryNotOverwritten:
    def test_second_portion_does_not_overwrite_existing_category(self):
        """User adds a manual item with category X, then plans a dish whose
        ingredient (same name+unit) has category Y. Shopping row keeps X."""
        tok = _register(_uniq("nov1"))["session_token"]
        # 1) manual add gelato → surgelati
        requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "gelato", "quantity": 200, "unit": "g",
            "category_id": "surgelati",
        }, timeout=15).raise_for_status()

        # 2) dish with same key gelato/g but different category → frutta
        dish = _make_dish(tok, "Coppa Gelato", servings=1, ingredients=[
            {"name": "gelato", "quantity": 100, "unit": "g",
             "category_id": "frutta"},
        ])
        _put_slot(tok, WEEK, 1, "pranzo", [{"dish_id": dish["id"], "persons": 1}])

        row = _find(_shopping(tok), "gelato")
        assert row is not None, "gelato missing"
        # Existing category kept (surgelati), NOT overwritten by ingredient's frutta
        assert row["category_id"] == "surgelati", row
        # But planner_qty aggregated (200 manual + 100 planner)
        assert row["planner_qty"] == 100.0
        assert row["manual_qty"] == 200.0

    def test_add_second_portion_of_same_dish_preserves_category(self):
        tok = _register(_uniq("nov2"))["session_token"]
        dish = _make_dish(tok, "Insalata", servings=1, ingredients=[
            {"name": "insalata", "quantity": 100, "unit": "g",
             "category_id": "verdura"},
        ])
        # slot A
        _put_slot(tok, WEEK, 0, "pranzo", [{"dish_id": dish["id"], "persons": 1}])
        # slot B (same dish, different slot)
        _put_slot(tok, WEEK, 2, "cena", [{"dish_id": dish["id"], "persons": 2}])

        row = _find(_shopping(tok), "insalata")
        assert row is not None
        assert row["category_id"] == "verdura"
        assert row["planner_qty"] == 300.0  # 100 + 200

    def test_manual_without_category_then_dish_with_category_inherits(self):
        """When existing item has NO category_id, adding a planner source
        with a category_id should inherit it (per _add_dish_to_shopping)."""
        tok = _register(_uniq("nov3"))["session_token"]
        # Manual add WITHOUT category — server default sets "altro".
        # To simulate a truly missing category_id (legacy), directly patch DB.
        r = requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "pane", "quantity": 100, "unit": "g",
        }, timeout=15)
        assert r.status_code == 200
        item_id = r.json()["id"]
        # server sets "altro" — patch to None to simulate legacy row
        _clear_category(tok, item_id)

        dish = _make_dish(tok, "Panino", servings=1, ingredients=[
            {"name": "pane", "quantity": 50, "unit": "g",
             "category_id": "pane_farinacei"},
        ])
        _put_slot(tok, WEEK, 3, "pranzo", [{"dish_id": dish["id"], "persons": 1}])

        row = _find(_shopping(tok), "pane")
        assert row is not None
        assert row["category_id"] == "pane_farinacei", row


# =====================================================================
# G. Legacy shopping items (no category_id in DB) — GET is safe
# =====================================================================
class TestLegacyShoppingItems:
    def test_get_shopping_with_legacy_item_missing_category(self):
        tok = _register(_uniq("lg"))["session_token"]
        # Create then strip category via direct DB
        r = requests.post(f"{API}/shopping", headers=_auth(tok), json={
            "name": "legacy_item", "quantity": 1, "unit": "pz",
        }, timeout=15)
        assert r.status_code == 200
        item_id = r.json()["id"]
        _clear_category(tok, item_id)

        s = _shopping(tok)
        row = _find(s, "legacy_item")
        assert row is not None
        # category_id must be absent OR None (never present as garbage)
        assert row.get("category_id") in (None, ""), row


# ------- direct-DB helpers for legacy simulation -------
def _clear_category(_tok: str, item_id: str) -> None:
    """Directly $unset category_id on a shopping item to simulate a legacy row."""
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    assert mongo_url and db_name, "MONGO_URL / DB_NAME required for legacy-sim test"
    client = MongoClient(mongo_url)
    try:
        client[db_name].shopping_items.update_one(
            {"id": item_id}, {"$unset": {"category_id": ""}}
        )
    finally:
        client.close()
