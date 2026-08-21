from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Header
from fastapi.security.utils import get_authorization_scheme_param
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal, Dict, Any
import uuid
import bcrypt
import re
import httpx
from datetime import datetime, timedelta, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Cucina di Casa API")
api_router = APIRouter(prefix="/api")


# -------------------- Models --------------------
class Ingredient(BaseModel):
    name: str
    quantity: float
    unit: str  # e.g. "g", "kg", "ml", "pz"


class DishCreate(BaseModel):
    name: str
    course: Literal["primo", "secondo"]
    ingredients: List[Ingredient] = []
    preparation: str = ""
    servings: int = 1  # base servings the recipe is written for


class Dish(BaseModel):
    id: str
    user_id: str
    name: str
    course: Literal["primo", "secondo"]
    ingredients: List[Ingredient] = []
    preparation: str = ""
    servings: int = 1
    created_at: datetime


class PlannerSlotUpdate(BaseModel):
    week_start: str  # ISO date, must be a Saturday
    day_index: int  # 0=Sat, 1=Sun, ..., 6=Fri
    meal: Literal["pranzo", "cena"]
    dish_id: Optional[str] = None  # None means clear
    persons: int = 2


class DuplicateWeekBody(BaseModel):
    source_week_start: str
    target_week_start: str


class ShoppingItemManual(BaseModel):
    name: str
    quantity: float
    unit: str


class ShoppingItemToggle(BaseModel):
    checked: bool


class ShoppingReorder(BaseModel):
    ordered_ids: List[str]


class RegisterBody(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class SessionBody(BaseModel):
    session_id: str


# -------------------- Helpers --------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid() -> str:
    return uuid.uuid4().hex


def _new_user_id() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


async def _create_session(user_id: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": _now(),
        "expires_at": _now() + timedelta(days=30),
    })
    return token


async def _user_public(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": user_doc["user_id"],
        "email": user_doc["email"],
        "name": user_doc.get("name") or user_doc["email"].split("@")[0],
        "picture": user_doc.get("picture"),
    }


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")
    scheme, token = get_authorization_scheme_param(authorization)
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid auth header")
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Session not found")
    exp = session["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < _now():
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# -------------------- Auth endpoints --------------------
@api_router.post("/auth/register")
async def register(body: RegisterBody):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password troppo corta (min 6 caratteri)")
    user = {
        "user_id": _new_user_id(),
        "email": body.email.lower(),
        "name": body.name or body.email.split("@")[0],
        "picture": None,
        "password_hash": _hash_password(body.password),
        "created_at": _now(),
        "provider": "email",
    }
    await db.users.insert_one(user)
    token = await _create_session(user["user_id"])
    return {"session_token": token, "user": await _user_public(user)}


@api_router.post("/auth/login")
async def login(body: LoginBody):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    if not _verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    token = await _create_session(user["user_id"])
    return {"session_token": token, "user": await _user_public(user)}


_processed_session_ids: set = set()


@api_router.post("/auth/session")
async def google_session(body: SessionBody):
    if body.session_id in _processed_session_ids:
        raise HTTPException(status_code=401, detail="Session already processed")
    _processed_session_ids.add(body.session_id)
    async with httpx.AsyncClient(timeout=15.0) as hc:
        try:
            resp = await hc.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Auth failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = resp.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="No email in profile")
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name") or existing.get("name"), "picture": data.get("picture"), "provider": existing.get("provider", "google")}},
        )
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    else:
        user = {
            "user_id": _new_user_id(),
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture"),
            "created_at": _now(),
            "provider": "google",
        }
        await db.users.insert_one(user)
        user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    token = await _create_session(user["user_id"])
    return {"session_token": token, "user": await _user_public(user)}


@api_router.get("/auth/me")
async def me(current_user=Depends(get_current_user)):
    return await _user_public(current_user)


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization:
        _, token = get_authorization_scheme_param(authorization)
        if token:
            await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# -------------------- Dishes --------------------
@api_router.get("/dishes")
async def list_dishes(course: Optional[str] = None, q: Optional[str] = None, current_user=Depends(get_current_user)):
    query: Dict[str, Any] = {"user_id": current_user["user_id"]}
    if course in ("primo", "secondo"):
        query["course"] = course
    if q:
        query["name"] = {"$regex": re.escape(q), "$options": "i"}
    cursor = db.dishes.find(query, {"_id": 0}).sort("name", 1)
    return await cursor.to_list(500)


@api_router.post("/dishes")
async def create_dish(body: DishCreate, current_user=Depends(get_current_user)):
    dish = {
        "id": _uid(),
        "user_id": current_user["user_id"],
        "name": body.name.strip(),
        "course": body.course,
        "ingredients": [ing.dict() for ing in body.ingredients],
        "preparation": body.preparation,
        "servings": max(1, body.servings),
        "created_at": _now(),
    }
    await db.dishes.insert_one(dish)
    dish.pop("_id", None)
    return dish


@api_router.get("/dishes/{dish_id}")
async def get_dish(dish_id: str, current_user=Depends(get_current_user)):
    d = await db.dishes.find_one({"id": dish_id, "user_id": current_user["user_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Piatto non trovato")
    return d


@api_router.put("/dishes/{dish_id}")
async def update_dish(dish_id: str, body: DishCreate, current_user=Depends(get_current_user)):
    res = await db.dishes.update_one(
        {"id": dish_id, "user_id": current_user["user_id"]},
        {"$set": {
            "name": body.name.strip(),
            "course": body.course,
            "ingredients": [ing.dict() for ing in body.ingredients],
            "preparation": body.preparation,
            "servings": max(1, body.servings),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Piatto non trovato")
    d = await db.dishes.find_one({"id": dish_id}, {"_id": 0})
    return d


@api_router.delete("/dishes/{dish_id}")
async def delete_dish(dish_id: str, current_user=Depends(get_current_user)):
    await db.dishes.delete_one({"id": dish_id, "user_id": current_user["user_id"]})
    return {"ok": True}


@api_router.post("/dishes/{dish_id}/duplicate")
async def duplicate_dish(dish_id: str, current_user=Depends(get_current_user)):
    src = await db.dishes.find_one({"id": dish_id, "user_id": current_user["user_id"]}, {"_id": 0})
    if not src:
        raise HTTPException(404, "Piatto non trovato")
    new_dish = {
        "id": _uid(),
        "user_id": current_user["user_id"],
        "name": f"{src['name']} (copia)",
        "course": src["course"],
        "ingredients": src.get("ingredients", []),
        "preparation": src.get("preparation", ""),
        "servings": src.get("servings", 1),
        "created_at": _now(),
    }
    await db.dishes.insert_one(dict(new_dish))
    return new_dish


# -------------------- Planner + Shopping sync --------------------
def _norm_name(name: str, unit: str) -> str:
    return f"{name.strip().lower()}::{unit.strip().lower()}"


async def _add_dish_to_shopping(user_id: str, week_start: str, day_index: int, meal: str,
                                 dish: Dict[str, Any], persons: int):
    """Add scaled ingredients from a dish to the shopping list."""
    base_servings = max(1, dish.get("servings", 1))
    multiplier = persons / base_servings
    for ing in dish.get("ingredients", []):
        key = _norm_name(ing["name"], ing["unit"])
        added_qty = float(ing["quantity"]) * multiplier
        source_entry = {
            "source_id": _uid(),
            "week_start": week_start,
            "day_index": day_index,
            "meal": meal,
            "dish_id": dish["id"],
            "dish_name": dish["name"],
            "quantity": added_qty,
        }
        existing = await db.shopping_items.find_one({"user_id": user_id, "key": key}, {"_id": 0})
        if existing:
            new_sources = existing.get("sources", []) + [source_entry]
            new_planner_qty = existing.get("planner_qty", 0.0) + added_qty
            await db.shopping_items.update_one(
                {"user_id": user_id, "key": key},
                {"$set": {"sources": new_sources, "planner_qty": new_planner_qty}},
            )
        else:
            # find max order
            last = await db.shopping_items.find_one({"user_id": user_id}, {"_id": 0}, sort=[("order", -1)])
            next_order = (last["order"] + 1) if last else 0
            await db.shopping_items.insert_one({
                "id": _uid(),
                "user_id": user_id,
                "key": key,
                "name": ing["name"],
                "unit": ing["unit"],
                "manual_qty": 0.0,
                "planner_qty": added_qty,
                "sources": [source_entry],
                "checked": False,
                "order": next_order,
                "created_at": _now(),
            })


async def _remove_planner_source_from_shopping(user_id: str, week_start: str, day_index: int, meal: str):
    """Remove all planner-added ingredients for a given slot."""
    items = await db.shopping_items.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
    for it in items:
        sources = it.get("sources", [])
        removed_qty = 0.0
        remaining = []
        for s in sources:
            if s["week_start"] == week_start and s["day_index"] == day_index and s["meal"] == meal:
                removed_qty += s["quantity"]
            else:
                remaining.append(s)
        if removed_qty > 0:
            new_planner_qty = max(0.0, it.get("planner_qty", 0.0) - removed_qty)
            # If nothing left (no manual, no planner), delete the row
            if new_planner_qty <= 0.0001 and it.get("manual_qty", 0.0) <= 0.0001 and len(remaining) == 0:
                await db.shopping_items.delete_one({"id": it["id"], "user_id": user_id})
            else:
                await db.shopping_items.update_one(
                    {"id": it["id"], "user_id": user_id},
                    {"$set": {"sources": remaining, "planner_qty": new_planner_qty}},
                )


@api_router.get("/planner/{week_start}")
async def get_planner(week_start: str, current_user=Depends(get_current_user)):
    plan = await db.weekly_plans.find_one(
        {"user_id": current_user["user_id"], "week_start": week_start}, {"_id": 0}
    )
    if not plan:
        # 7 days x 2 meals, empty
        empty = {"user_id": current_user["user_id"], "week_start": week_start, "slots": {}}
        return empty
    return plan


@api_router.put("/planner/slot")
async def update_slot(body: PlannerSlotUpdate, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    slot_key = f"{body.day_index}_{body.meal}"
    plan = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.week_start}, {"_id": 0})
    if not plan:
        plan = {"user_id": user_id, "week_start": body.week_start, "slots": {}}
        await db.weekly_plans.insert_one(dict(plan))

    old_slot = plan.get("slots", {}).get(slot_key)
    # Remove old slot's contribution
    if old_slot:
        await _remove_planner_source_from_shopping(user_id, body.week_start, body.day_index, body.meal)

    if body.dish_id:
        dish = await db.dishes.find_one({"id": body.dish_id, "user_id": user_id}, {"_id": 0})
        if not dish:
            raise HTTPException(404, "Piatto non trovato")
        new_slot = {"dish_id": body.dish_id, "dish_name": dish["name"], "course": dish["course"],
                    "persons": max(1, body.persons)}
        await db.weekly_plans.update_one(
            {"user_id": user_id, "week_start": body.week_start},
            {"$set": {f"slots.{slot_key}": new_slot}},
        )
        await _add_dish_to_shopping(user_id, body.week_start, body.day_index, body.meal, dish, body.persons)
    else:
        await db.weekly_plans.update_one(
            {"user_id": user_id, "week_start": body.week_start},
            {"$unset": {f"slots.{slot_key}": ""}},
        )
    plan = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.week_start}, {"_id": 0})
    return plan


@api_router.post("/planner/duplicate")
async def duplicate_week(body: DuplicateWeekBody, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    source = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.source_week_start}, {"_id": 0})
    if not source:
        raise HTTPException(404, "Settimana di origine non trovata")

    # Clear target: remove all planner contributions for target week
    target = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.target_week_start}, {"_id": 0})
    if target:
        for slot_key in list(target.get("slots", {}).keys()):
            day_index, meal = slot_key.split("_")
            await _remove_planner_source_from_shopping(user_id, body.target_week_start, int(day_index), meal)
        await db.weekly_plans.delete_one({"user_id": user_id, "week_start": body.target_week_start})

    # Create new target from source slots
    new_slots = dict(source.get("slots", {}))
    await db.weekly_plans.insert_one({
        "user_id": user_id,
        "week_start": body.target_week_start,
        "slots": new_slots,
    })
    # Add ingredients for each slot
    for slot_key, slot in new_slots.items():
        day_index, meal = slot_key.split("_")
        dish = await db.dishes.find_one({"id": slot["dish_id"], "user_id": user_id}, {"_id": 0})
        if dish:
            await _add_dish_to_shopping(user_id, body.target_week_start, int(day_index), meal, dish, slot.get("persons", 2))
    plan = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.target_week_start}, {"_id": 0})
    return plan


# -------------------- Shopping --------------------
@api_router.get("/shopping")
async def list_shopping(current_user=Depends(get_current_user)):
    items = await db.shopping_items.find({"user_id": current_user["user_id"]}, {"_id": 0}).sort("order", 1).to_list(1000)
    return items


@api_router.post("/shopping")
async def add_manual(body: ShoppingItemManual, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    key = _norm_name(body.name, body.unit)
    existing = await db.shopping_items.find_one({"user_id": user_id, "key": key}, {"_id": 0})
    if existing:
        await db.shopping_items.update_one(
            {"user_id": user_id, "key": key},
            {"$inc": {"manual_qty": float(body.quantity)}},
        )
        item = await db.shopping_items.find_one({"user_id": user_id, "key": key}, {"_id": 0})
        return item
    last = await db.shopping_items.find_one({"user_id": user_id}, {"_id": 0}, sort=[("order", -1)])
    next_order = (last["order"] + 1) if last else 0
    doc = {
        "id": _uid(),
        "user_id": user_id,
        "key": key,
        "name": body.name.strip(),
        "unit": body.unit.strip(),
        "manual_qty": float(body.quantity),
        "planner_qty": 0.0,
        "sources": [],
        "checked": False,
        "order": next_order,
        "created_at": _now(),
    }
    await db.shopping_items.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.patch("/shopping/{item_id}/toggle")
async def toggle_item(item_id: str, body: ShoppingItemToggle, current_user=Depends(get_current_user)):
    res = await db.shopping_items.update_one(
        {"id": item_id, "user_id": current_user["user_id"]},
        {"$set": {"checked": bool(body.checked)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Elemento non trovato")
    return {"ok": True}


@api_router.delete("/shopping/{item_id}")
async def delete_item(item_id: str, current_user=Depends(get_current_user)):
    """Delete only the manual part; if there's a planner part, keep the row."""
    it = await db.shopping_items.find_one({"id": item_id, "user_id": current_user["user_id"]}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Elemento non trovato")
    if it.get("planner_qty", 0.0) > 0.0001:
        # zero out manual
        await db.shopping_items.update_one(
            {"id": item_id, "user_id": current_user["user_id"]},
            {"$set": {"manual_qty": 0.0}},
        )
    else:
        await db.shopping_items.delete_one({"id": item_id, "user_id": current_user["user_id"]})
    return {"ok": True}


@api_router.delete("/shopping/{item_id}/force")
async def force_delete_item(item_id: str, current_user=Depends(get_current_user)):
    """Force delete an item entirely, including planner-added portions.
    Does NOT modify the planner itself — dishes remain planned, but the ingredient
    is removed from the shopping list."""
    res = await db.shopping_items.delete_one({"id": item_id, "user_id": current_user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Elemento non trovato")
    return {"ok": True}


@api_router.post("/shopping/reorder")
async def reorder(body: ShoppingReorder, current_user=Depends(get_current_user)):
    for idx, item_id in enumerate(body.ordered_ids):
        await db.shopping_items.update_one(
            {"id": item_id, "user_id": current_user["user_id"]},
            {"$set": {"order": idx}},
        )
    return {"ok": True}


@api_router.post("/shopping/clear-checked")
async def clear_checked(current_user=Depends(get_current_user)):
    await db.shopping_items.delete_many({"user_id": current_user["user_id"], "checked": True, "planner_qty": {"$lte": 0.0001}})
    # For items with planner qty checked, uncheck them
    await db.shopping_items.update_many(
        {"user_id": current_user["user_id"], "checked": True},
        {"$set": {"checked": False}},
    )
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "Cucina di Casa API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.dishes.create_index([("user_id", 1), ("name", 1)])
    await db.weekly_plans.create_index([("user_id", 1), ("week_start", 1)], unique=True)
    await db.shopping_items.create_index([("user_id", 1), ("key", 1)])
    await db.shopping_items.create_index([("user_id", 1), ("order", 1)])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
