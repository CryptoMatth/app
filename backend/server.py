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
import secrets
import ipaddress
import httpx
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timedelta, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="PlanEat API")
api_router = APIRouter(prefix="/api")

# Email (Emergent managed Resend)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "PlanEat")


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


class ForgotBody(BaseModel):
    email: EmailStr


class ResetBody(BaseModel):
    email: EmailStr
    code: str
    new_password: str


class DuplicateWeekBodyV2(BaseModel):
    source_week_start: str
    target_week_start: str


class ImportBody(BaseModel):
    dishes: List[Dict[str, Any]] = []
    weekly_plans: List[Dict[str, Any]] = []
    shopping_items: List[Dict[str, Any]] = []
    mode: Literal["merge", "replace"] = "merge"


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


# -------------------- Email helpers (guardrails inlined) --------------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []
    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []
    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links must be https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Unsafe URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor host mismatch: {m.group(1)!r} vs {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    if not EMAIL_KEY:
        raise HTTPException(500, "Email non configurato")
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as hc:
            resp = await hc.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logging.getLogger(__name__).error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="Invio email fallito")
    except Exception as e:
        logging.getLogger(__name__).error(f"Email send error: {e}")
        raise HTTPException(status_code=500, detail="Invio email fallito")


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


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotBody):
    """Send a 6-digit reset code to the user's email. Always returns 200 to avoid
    email enumeration; only actually sends if the user exists."""
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user and user.get("provider") != "google":
        # Generate 6-digit code
        code = f"{secrets.randbelow(1_000_000):06d}"
        code_hash = _hash_password(code)  # bcrypt the code
        # Invalidate any previous codes for this email
        await db.password_resets.delete_many({"email": email})
        await db.password_resets.insert_one({
            "email": email,
            "code_hash": code_hash,
            "attempts": 0,
            "created_at": _now(),
            "expires_at": _now() + timedelta(minutes=15),
        })
        html = (
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
            f'style="background:#FDFBF7;font-family:Arial,sans-serif;padding:24px">'
            f'<tr><td align="center">'
            f'<table role="presentation" width="480" cellspacing="0" cellpadding="0" '
            f'style="background:#FFFFFF;border-radius:12px;padding:32px;border:1px solid #DED5C5">'
            f'<tr><td>'
            f'<h1 style="font-family:Georgia,serif;font-size:24px;color:#3D342B;margin:0 0 8px">Ciao {escape(user.get("name") or "")}</h1>'
            f'<p style="color:#5A5045;font-size:15px;line-height:22px;margin:0 0 20px">'
            f'Hai richiesto di reimpostare la password di <strong>{escape(EMAIL_FROM_NAME)}</strong>. '
            f'Inserisci questo codice nell\'app per procedere:</p>'
            f'<div style="text-align:center;margin:24px 0">'
            f'<div style="display:inline-block;background:#F5F2EB;border:1px solid #DED5C5;'
            f'border-radius:12px;padding:16px 32px;font-family:Georgia,serif;font-size:32px;'
            f'letter-spacing:8px;color:#C66241;font-weight:bold">{code}</div>'
            f'</div>'
            f'<p style="color:#5A5045;font-size:14px;line-height:20px;margin:0 0 8px">'
            f'Il codice scade tra <strong>15 minuti</strong>.</p>'
            f'<p style="color:#5A5045;font-size:14px;line-height:20px;margin:0 0 20px">'
            f'Se non hai fatto tu questa richiesta, puoi ignorare questa email — la tua password non cambia.</p>'
            f'<hr style="border:none;border-top:1px solid #EBE5D9;margin:24px 0">'
            f'<p style="font-size:12px;color:#8A7F72;line-height:18px;margin:0">'
            f'Inviato da {escape(EMAIL_FROM_NAME)}. Non ti chiederemo mai la password o dati di pagamento via email.</p>'
            f'</td></tr></table></td></tr></table>'
        )
        try:
            await send_email(
                to=email,
                subject=f"Codice di reimpostazione — {EMAIL_FROM_NAME}",
                html=html,
            )
        except Exception as e:
            logging.getLogger(__name__).error(f"Reset email send failed: {e}")
            # Still return ok to prevent enumeration
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetBody):
    email = body.email.lower().strip()
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password troppo corta (min 6 caratteri)")
    rec = await db.password_resets.find_one({"email": email})
    if not rec:
        raise HTTPException(status_code=400, detail="Codice non valido o scaduto")
    exp = rec["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < _now():
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Codice scaduto, richiedi un nuovo codice")
    if rec.get("attempts", 0) >= 5:
        await db.password_resets.delete_many({"email": email})
        raise HTTPException(status_code=400, detail="Troppi tentativi, richiedi un nuovo codice")
    if not _verify_password(body.code, rec["code_hash"]):
        await db.password_resets.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Codice non valido")
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=400, detail="Utente non trovato")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": _hash_password(body.new_password)}},
    )
    await db.password_resets.delete_many({"email": email})
    # Also invalidate all existing sessions for safety
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
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

@api_router.get("/planner-weeks")
async def list_planner_weeks(current_user=Depends(get_current_user)):
    """List all weeks that have any slots, most recent first, for the duplicate picker."""
    cursor = db.weekly_plans.find(
        {"user_id": current_user["user_id"]},
        {"_id": 0, "week_start": 1, "slots": 1},
    ).sort("week_start", -1)
    rows = await cursor.to_list(200)
    return [
        {"week_start": r["week_start"], "count": len(r.get("slots", {}))}
        for r in rows if r.get("slots")
    ]




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


# -------------------- Export / Import --------------------
@api_router.get("/export")
async def export_data(current_user=Depends(get_current_user)):
    """Export all of the current user's data as a JSON snapshot."""
    user_id = current_user["user_id"]
    dishes = await db.dishes.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
    plans = await db.weekly_plans.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
    shopping = await db.shopping_items.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
    return {
        "app": "PlanEat",
        "version": 1,
        "exported_at": _now().isoformat(),
        "user": {"email": current_user["email"], "name": current_user.get("name")},
        "dishes": dishes,
        "weekly_plans": plans,
        "shopping_items": shopping,
    }


@api_router.post("/import")
async def import_data(body: ImportBody, current_user=Depends(get_current_user)):
    """Import a backup. mode=merge preserves existing data; mode=replace wipes user's
    data first (dishes/plans/shopping) then imports."""
    user_id = current_user["user_id"]

    if body.mode == "replace":
        await db.dishes.delete_many({"user_id": user_id})
        await db.weekly_plans.delete_many({"user_id": user_id})
        await db.shopping_items.delete_many({"user_id": user_id})

    imported_dishes = 0
    imported_plans = 0
    imported_shopping = 0

    for d in body.dishes:
        try:
            doc = {
                "id": d.get("id") or _uid(),
                "user_id": user_id,
                "name": str(d.get("name", "")).strip() or "Piatto",
                "course": d.get("course") if d.get("course") in ("primo", "secondo") else "primo",
                "ingredients": d.get("ingredients", []),
                "preparation": d.get("preparation", ""),
                "servings": max(1, int(d.get("servings", 1) or 1)),
                "created_at": _now(),
            }
            if body.mode == "merge":
                exists = await db.dishes.find_one({"user_id": user_id, "id": doc["id"]}, {"_id": 0})
                if exists:
                    continue
            await db.dishes.insert_one(doc)
            imported_dishes += 1
        except Exception:
            continue

    for p in body.weekly_plans:
        try:
            week = str(p.get("week_start", ""))
            if not week:
                continue
            slots = p.get("slots", {}) or {}
            if body.mode == "merge":
                exists = await db.weekly_plans.find_one({"user_id": user_id, "week_start": week}, {"_id": 0})
                if exists:
                    continue
            await db.weekly_plans.update_one(
                {"user_id": user_id, "week_start": week},
                {"$set": {"user_id": user_id, "week_start": week, "slots": slots}},
                upsert=True,
            )
            imported_plans += 1
        except Exception:
            continue

    for it in body.shopping_items:
        try:
            key = _norm_name(it.get("name", ""), it.get("unit", ""))
            doc = {
                "id": it.get("id") or _uid(),
                "user_id": user_id,
                "key": key,
                "name": str(it.get("name", "")).strip(),
                "unit": str(it.get("unit", "")).strip(),
                "manual_qty": float(it.get("manual_qty", 0) or 0),
                "planner_qty": float(it.get("planner_qty", 0) or 0),
                "sources": it.get("sources", []),
                "checked": bool(it.get("checked", False)),
                "order": int(it.get("order", 0) or 0),
                "created_at": _now(),
            }
            if not doc["name"]:
                continue
            if body.mode == "merge":
                exists = await db.shopping_items.find_one({"user_id": user_id, "key": key}, {"_id": 0})
                if exists:
                    continue
            await db.shopping_items.update_one(
                {"user_id": user_id, "key": key},
                {"$set": doc},
                upsert=True,
            )
            imported_shopping += 1
        except Exception:
            continue

    return {
        "ok": True,
        "imported": {
            "dishes": imported_dishes,
            "weekly_plans": imported_plans,
            "shopping_items": imported_shopping,
        },
    }




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
    await db.password_resets.create_index("email")
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
