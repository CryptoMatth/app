from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Header, UploadFile, File, Query
from fastapi.responses import Response
from fastapi.security.utils import get_authorization_scheme_param
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
import uuid
import bcrypt
import re
import secrets
import ipaddress
import httpx
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timedelta, timezone

from storage import (
    put_object, get_object, sign_token, verify_token,
    user_photo_path, init_storage,
)


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
    category_id: Optional[str] = None  # matches user's preferences.ingredient_categories
    photo_path: Optional[str] = None  # Emergent Object Storage path (Pro feature)


class DishCreate(BaseModel):
    name: str
    course: str  # course id (matches user's preferences.courses)
    ingredients: List[Ingredient] = []
    preparation: str = ""
    servings: int = 1
    notes: str = ""
    photo_path: Optional[str] = None  # Emergent Object Storage path (Pro feature)


class ShoppingItemManual(BaseModel):
    name: str
    quantity: float
    unit: str
    notes: str = ""
    category_id: Optional[str] = None
    photo_path: Optional[str] = None  # Pro feature


class ShoppingItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None  # sets manual_qty
    unit: Optional[str] = None
    notes: Optional[str] = None
    category_id: Optional[str] = None
    photo_path: Optional[str] = None


class FridgeItemCreate(BaseModel):
    name: str
    quantity: float
    unit: str
    notes: str = ""
    category_id: Optional[str] = None
    photo_path: Optional[str] = None
    # Accept either legacy list of ISO date strings ("YYYY-MM-DD") OR the new
    # list of dicts {date: "YYYY-MM-DD", label: str|None}. Server normalizes
    # to the dict form on write. Kept as `Any` so both shapes validate.
    expiries: List[Any] = []


class FridgeItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    notes: Optional[str] = None
    category_id: Optional[str] = None
    photo_path: Optional[str] = None
    expiries: Optional[List[Any]] = None


class ShoppingItemToggle(BaseModel):
    checked: bool


class ShoppingReorder(BaseModel):
    ordered_ids: List[str]


USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")

# Default course catalog: users can rename/reorder/delete/add.
# `id` is the stable slug used in dish documents; label is user-facing.
DEFAULT_COURSES: List[Dict[str, Any]] = [
    {"id": "primo", "label": "Primo"},
    {"id": "secondo", "label": "Secondo"},
    {"id": "contorno", "label": "Contorno"},
    {"id": "dolce", "label": "Dolce"},
]
# 0 = Monday, 6 = Sunday (Python weekday convention).
# Historically PlanEat starts weeks on Saturday (=5).
DEFAULT_WEEK_START_DAY = 5
DEFAULT_PLANNER_SPAN = "weekly"  # "weekly" (7d) or "biweekly" (14d)
DEFAULT_LANGUAGE = "it"  # "it" | "en"

# Default course catalog: users can rename/reorder/delete/add.
# `id` is the stable slug used in dish documents; label is user-facing.
DEFAULT_COURSES: List[Dict[str, Any]] = [
    {"id": "primo", "label": "Primo"},
    {"id": "secondo", "label": "Secondo"},
    {"id": "contorno", "label": "Contorno"},
    {"id": "dolce", "label": "Dolce"},
]

# Default ingredient categories: users can rename/reorder/delete/add.
DEFAULT_INGREDIENT_CATEGORIES: List[Dict[str, Any]] = [
    {"id": "verdura", "label": "Verdura", "icon": "🥬", "color": "#7A9A65"},
    {"id": "frutta", "label": "Frutta", "icon": "🍎", "color": "#D66852"},
    {"id": "carne_pesce", "label": "Carne / Pesce", "icon": "🥩", "color": "#B14A3C"},
    {"id": "latticini", "label": "Latticini", "icon": "🥛", "color": "#E8D4A3"},
    {"id": "pane_farinacei", "label": "Pane / Farinacei", "icon": "🍞", "color": "#C9975C"},
    {"id": "surgelati", "label": "Surgelati", "icon": "❄️", "color": "#7BB0C8"},
    {"id": "bevande", "label": "Bevande", "icon": "🥤", "color": "#8E7CC3"},
    {"id": "dispensa", "label": "Dispensa", "icon": "🫙", "color": "#A38963"},
    {"id": "altro", "label": "Altro", "icon": "📦", "color": "#8C8478"},
]

# Usernames that automatically get all Pro entitlements without paying (founder).
FOUNDER_USERNAMES = {"halley"}
FOUNDER_TIER = "pro_plus"  # tier auto-granted to founder usernames


def _course_id(label: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", (label or "").strip().lower()).strip("_")
    return base[:40] or "categoria"


def _default_prefs() -> Dict[str, Any]:
    return {
        "week_start_day": DEFAULT_WEEK_START_DAY,
        "planner_span": DEFAULT_PLANNER_SPAN,
        "language": DEFAULT_LANGUAGE,
        "courses": [dict(c) for c in DEFAULT_COURSES],
        "ingredient_categories": [dict(c) for c in DEFAULT_INGREDIENT_CATEGORIES],
        "notifications": {
            "enabled": False,
            "expiry_days_ahead": 1,          # legacy fallback
            "days_ahead": [1],                # new multi-day preavviso
            "notify_hour": 9,
            "freezer_enabled": True,
            "freezer_hours": 24,
        },
        "defaults": {
            "default_qty": 1.0,
            "default_unit": "pz",
            "default_servings": 2,
        },
    }


def _norm_username(v: str) -> str:
    v = (v or "").strip().lower()
    if not USERNAME_RE.fullmatch(v):
        raise HTTPException(status_code=422, detail="Username non valido: 3-30 caratteri, lettere, numeri, '_' o '.'.")
    return v


class RegisterBody(BaseModel):
    username: str
    password: str
    password_repeat: str


class LoginBody(BaseModel):
    username: str
    password: str


class UpdateUsernameBody(BaseModel):
    username: str
    current_password: str


class UpdatePasswordBody(BaseModel):
    old_password: str
    new_password: str


class RecoveryVerifyBody(BaseModel):
    username: str
    code: str
    new_password: str


class DuplicateWeekBody(BaseModel):
    source_week_start: str
    target_week_start: str


class PlannerSlotItem(BaseModel):
    dish_id: str
    persons: int = 1


class PlannerSlotUpdate(BaseModel):
    week_start: str
    day_index: int
    meal: Literal["pranzo", "cena"]
    # New (preferred) multi-dish form:
    items: Optional[List[PlannerSlotItem]] = None
    # Legacy single-dish form (still supported for old clients):
    dish_id: Optional[str] = None
    persons: int = 1
    # Whether the update should propagate changes to the shopping list.
    # Default True for back-compat. Set False to only update the planner
    # visually and leave the shopping list untouched.
    sync_shopping: bool = True


class SessionBody(BaseModel):
    session_id: str


class ImportBody(BaseModel):
    dishes: List[Dict[str, Any]] = []
    weekly_plans: List[Dict[str, Any]] = []
    shopping_items: List[Dict[str, Any]] = []
    mode: Literal["merge", "replace"] = "merge"


class CourseItem(BaseModel):
    id: Optional[str] = None
    label: str
    icon: Optional[str] = None


class IngredientCategoryItem(BaseModel):
    id: Optional[str] = None
    label: str
    icon: Optional[str] = None
    color: Optional[str] = None


class NotificationPrefs(BaseModel):
    enabled: Optional[bool] = None
    # Legacy single-day preavviso (kept for backward compat)
    expiry_days_ahead: Optional[int] = None
    # New multi-day preavviso — e.g. [3, 2, 1, 0]. Overrides expiry_days_ahead when set.
    days_ahead: Optional[List[int]] = None
    notify_hour: Optional[int] = None  # 0..23
    freezer_enabled: Optional[bool] = None
    # New: how many hours before a planned freezer dish we should warn.
    freezer_hours: Optional[int] = None  # 1..168


class DefaultsPrefs(BaseModel):
    default_qty: Optional[float] = None
    default_unit: Optional[str] = None
    default_servings: Optional[int] = None


class PreferencesBody(BaseModel):
    week_start_day: Optional[int] = None  # 0=Mon..6=Sun
    planner_span: Optional[Literal["weekly", "biweekly"]] = None
    language: Optional[Literal["it", "en"]] = None
    courses: Optional[List[CourseItem]] = None
    ingredient_categories: Optional[List[IngredientCategoryItem]] = None
    notifications: Optional[NotificationPrefs] = None
    defaults: Optional[DefaultsPrefs] = None


# -------------------- Helpers --------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid() -> str:
    return uuid.uuid4().hex


def _new_user_id() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no confusing chars


def _generate_recovery_codes(count: int = 8) -> tuple[List[str], List[Dict[str, Any]]]:
    plain: List[str] = []
    for _ in range(count):
        p1 = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
        p2 = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
        plain.append(f"{p1}-{p2}")
    stored = [{"code_hash": _hash_password(c), "used_at": None} for c in plain]
    return plain, stored


def _normalize_code(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "")


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
    prefs = user_doc.get("preferences") or _default_prefs()
    # Backfill any missing keys (older accounts predating prefs)
    if "week_start_day" not in prefs:
        prefs["week_start_day"] = DEFAULT_WEEK_START_DAY
    if "planner_span" not in prefs:
        prefs["planner_span"] = DEFAULT_PLANNER_SPAN
    if "language" not in prefs:
        prefs["language"] = DEFAULT_LANGUAGE
    if not prefs.get("courses"):
        prefs["courses"] = [dict(c) for c in DEFAULT_COURSES]
    if not prefs.get("ingredient_categories"):
        prefs["ingredient_categories"] = [dict(c) for c in DEFAULT_INGREDIENT_CATEGORIES]
    if not prefs.get("notifications"):
        prefs["notifications"] = {"enabled": False, "expiry_days_ahead": 1, "days_ahead": [1], "notify_hour": 9, "freezer_enabled": True, "freezer_hours": 24}
    else:
        n = prefs["notifications"]
        n.setdefault("expiry_days_ahead", 1)
        # Backfill days_ahead from the legacy single-value field if missing.
        if "days_ahead" not in n or n["days_ahead"] is None:
            n["days_ahead"] = [int(n.get("expiry_days_ahead", 1))]
        n.setdefault("notify_hour", 9)
        n.setdefault("freezer_enabled", True)
        n.setdefault("freezer_hours", 24)
    if not prefs.get("defaults"):
        prefs["defaults"] = {"default_qty": 1.0, "default_unit": "pz", "default_servings": 2}
    else:
        d = prefs["defaults"]
        d.setdefault("default_qty", 1.0)
        d.setdefault("default_unit", "pz")
        d.setdefault("default_servings", 2)
    # Drop legacy `backups` prefs field if present (Ultra cloud backups
    # feature was removed — the field is ignored from now on).
    if "backups" in prefs:
        prefs.pop("backups", None)

    # Compute pro entitlement (founder whitelist OR explicit DB flag)
    ents = user_doc.get("entitlements") or {}
    pro_ent = ents.get("pro") or {}
    is_founder = (user_doc.get("username") or "").lower() in FOUNDER_USERNAMES
    tier = _get_tier(user_doc)
    is_pro = _tier_rank(tier) >= _tier_rank("pro")

    return {
        "user_id": user_doc["user_id"],
        "username": user_doc.get("username") or (user_doc.get("email") or "").split("@")[0],
        "preferences": prefs,
        "is_pro": is_pro,
        "tier": tier,
        "pro_source": "founder" if is_founder else ("admin_grant" if pro_ent.get("active") else None),
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


def _tier_rank(tier: str) -> int:
    return {"free": 0, "pro": 1, "pro_plus": 2}.get((tier or "").lower(), 0)


def _get_tier(user_doc: Dict[str, Any]) -> str:
    """Return the highest tier the user currently has entitlement for.

    Pro+ > Pro > Free. Founder usernames map to Pro+ automatically.
    Legacy `entitlements.ultra` grants are treated as Pro+.
    """
    ents = user_doc.get("entitlements") or {}
    is_founder = (user_doc.get("username") or "").lower() in FOUNDER_USERNAMES
    if is_founder:
        return FOUNDER_TIER
    # Legacy: pre-existing "ultra" grants still map to pro_plus.
    if (ents.get("ultra") or {}).get("active"):
        return "pro_plus"
    if (ents.get("pro_plus") or {}).get("active"):
        return "pro_plus"
    if (ents.get("pro") or {}).get("active"):
        return "pro"
    return "free"


def _has_tier(user_doc: Dict[str, Any], min_tier: str) -> bool:
    return _tier_rank(_get_tier(user_doc)) >= _tier_rank(min_tier)


def _is_pro(user_doc: Dict[str, Any]) -> bool:
    # Any paid tier counts as "pro" for legacy checks.
    return _tier_rank(_get_tier(user_doc)) >= _tier_rank("pro")


async def require_pro(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if not _is_pro(user):
        raise HTTPException(status_code=402, detail="Pro subscription required")
    return user


async def require_pro_plus(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if not _has_tier(user, "pro_plus"):
        raise HTTPException(status_code=402, detail="Pro+ subscription required")
    return user


# -------------------- Auth endpoints --------------------
@api_router.post("/auth/register")
async def register(body: RegisterBody):
    username = _norm_username(body.username)
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password troppo corta (min 6 caratteri)")
    if body.password != body.password_repeat:
        raise HTTPException(status_code=422, detail="Le due password non coincidono")
    existing = await db.users.find_one({"username": username})
    if existing:
        raise HTTPException(status_code=409, detail="Username già in uso")
    user = {
        "user_id": _new_user_id(),
        "username": username,
        "password_hash": _hash_password(body.password),
        "created_at": _now(),
        "provider": "username",
        "preferences": _default_prefs(),
    }
    plain_codes, code_docs = _generate_recovery_codes()
    user["recovery_codes"] = code_docs
    try:
        await db.users.insert_one(user)
    except Exception as e:
        if "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="Username già in uso")
        raise
    token = await _create_session(user["user_id"])
    return {"session_token": token, "user": await _user_public(user), "recovery_codes": plain_codes}


@api_router.post("/auth/login")
async def login(body: LoginBody):
    username = _norm_username(body.username)
    user = await db.users.find_one({"username": username})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    if not _verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    token = await _create_session(user["user_id"])
    return {"session_token": token, "user": await _user_public(user)}


@api_router.put("/auth/profile")
async def update_username(body: UpdateUsernameBody, current_user=Depends(get_current_user)):
    new_username = _norm_username(body.username)
    # Verify current password
    full = await db.users.find_one({"user_id": current_user["user_id"]})
    if not full or not _verify_password(body.current_password, full.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Password attuale non valida")
    if new_username == full.get("username"):
        return {"user": await _user_public(full)}
    existing = await db.users.find_one({"username": new_username})
    if existing and existing["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=409, detail="Username già in uso")
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"username": new_username, "updated_at": _now()}},
    )
    updated = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"user": await _user_public(updated)}


@api_router.put("/auth/password")
async def update_password(body: UpdatePasswordBody, current_user=Depends(get_current_user)):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password troppo corta (min 6 caratteri)")
    full = await db.users.find_one({"user_id": current_user["user_id"]})
    if not full or not _verify_password(body.old_password, full.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Password attuale non valida")
    if body.old_password == body.new_password:
        raise HTTPException(status_code=422, detail="La nuova password deve essere diversa da quella attuale")
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"password_hash": _hash_password(body.new_password), "updated_at": _now()}},
    )
    # Invalidate all other sessions for safety, keep current one
    return {"ok": True}


# Rate limit for recovery attempts (in-memory, single-process)
_recovery_attempts: Dict[str, List[datetime]] = {}
_RECOVERY_MAX = 5
_RECOVERY_WINDOW = timedelta(minutes=15)


def _recovery_rate_check(username: str) -> None:
    now = _now()
    q = _recovery_attempts.get(username, [])
    q = [t for t in q if now - t < _RECOVERY_WINDOW]
    _recovery_attempts[username] = q
    if len(q) >= _RECOVERY_MAX:
        raise HTTPException(status_code=429, detail="Troppi tentativi. Riprova tra 15 minuti.")


def _recovery_note_wrong(username: str) -> None:
    _recovery_attempts.setdefault(username, []).append(_now())


def _recovery_note_success(username: str) -> None:
    _recovery_attempts.pop(username, None)


@api_router.post("/auth/recovery/verify")
async def recovery_verify(body: RecoveryVerifyBody):
    username = _norm_username(body.username)
    _recovery_rate_check(username)
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password troppo corta (min 6 caratteri)")
    user = await db.users.find_one({"username": username})
    code = _normalize_code(body.code)
    matched_hash = None
    if user:
        for item in user.get("recovery_codes", []):
            if item.get("used_at") is None and _verify_password(code, item["code_hash"]):
                matched_hash = item["code_hash"]
                break
    if not matched_hash:
        _recovery_note_wrong(username)
        raise HTTPException(status_code=400, detail="Codice di recupero non valido")
    # Atomic update: mark code as used AND set new password only if still unused
    result = await db.users.find_one_and_update(
        {
            "user_id": user["user_id"],
            "recovery_codes": {"$elemMatch": {"code_hash": matched_hash, "used_at": None}},
        },
        {
            "$set": {
                "password_hash": _hash_password(body.new_password),
                "recovery_codes.$[c].used_at": _now(),
                "updated_at": _now(),
            }
        },
        array_filters=[{"c.code_hash": matched_hash, "c.used_at": None}],
    )
    if not result:
        _recovery_note_wrong(username)
        raise HTTPException(status_code=400, detail="Codice di recupero non valido")
    # Invalidate all existing sessions and issue a new one
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    _recovery_note_success(username)
    token = await _create_session(user["user_id"])
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"session_token": token, "user": await _user_public(fresh)}


@api_router.post("/auth/recovery/regenerate")
async def recovery_regenerate(current_user=Depends(get_current_user)):
    plain, docs = _generate_recovery_codes()
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"recovery_codes": docs, "updated_at": _now()}},
    )
    return {"recovery_codes": plain}


@api_router.get("/auth/recovery/status")
async def recovery_status(current_user=Depends(get_current_user)):
    u = await db.users.find_one({"user_id": current_user["user_id"]}, {"recovery_codes": 1})
    codes = (u or {}).get("recovery_codes", []) or []
    remaining = sum(1 for c in codes if c.get("used_at") is None)
    return {"remaining": remaining, "total": len(codes)}



@api_router.get("/auth/me")
async def me(current_user=Depends(get_current_user)):
    return await _user_public(current_user)


@api_router.get("/auth/preferences")
async def get_preferences(current_user=Depends(get_current_user)):
    pub = await _user_public(current_user)
    return pub["preferences"]


@api_router.put("/auth/preferences")
async def update_preferences(body: PreferencesBody, current_user=Depends(get_current_user)):
    prefs = current_user.get("preferences") or _default_prefs()
    if body.week_start_day is not None:
        if body.week_start_day < 0 or body.week_start_day > 6:
            raise HTTPException(422, "week_start_day deve essere tra 0 (Lun) e 6 (Dom)")
        prefs["week_start_day"] = int(body.week_start_day)
    if body.planner_span is not None:
        prefs["planner_span"] = body.planner_span
    if body.language is not None:
        prefs["language"] = body.language
    if body.courses is not None:
        # Enforce at least one course and unique ids
        if len(body.courses) == 0:
            raise HTTPException(422, "Serve almeno una categoria di piatto")
        if len(body.courses) > 20:
            raise HTTPException(422, "Massimo 20 categorie")
        seen_ids = set()
        seen_labels = set()
        cleaned: List[Dict[str, Any]] = []
        for c in body.courses:
            label = (c.label or "").strip()
            if not label:
                continue
            if len(label) > 40:
                label = label[:40]
            cid = (c.id or "").strip() or _course_id(label)
            # Ensure uniqueness: if id already used, suffix _2, _3...
            base_cid = cid
            n = 1
            while cid in seen_ids:
                n += 1
                cid = f"{base_cid}_{n}"
            low = label.lower()
            if low in seen_labels:
                continue
            seen_ids.add(cid)
            seen_labels.add(low)
            cleaned.append({"id": cid, "label": label, "icon": (c.icon or "").strip() or None})
        if not cleaned:
            raise HTTPException(422, "Nessuna categoria valida fornita")
        prefs["courses"] = cleaned
    if body.ingredient_categories is not None:
        if len(body.ingredient_categories) == 0:
            raise HTTPException(422, "Serve almeno una categoria ingrediente")
        if len(body.ingredient_categories) > 30:
            raise HTTPException(422, "Massimo 30 categorie ingrediente")
        seen_ids_ic: set = set()
        seen_labels_ic: set = set()
        cleaned_ic: List[Dict[str, Any]] = []
        for c in body.ingredient_categories:
            label = (c.label or "").strip()
            if not label:
                continue
            if len(label) > 40:
                label = label[:40]
            cid = (c.id or "").strip() or _course_id(label)
            base_cid = cid
            n = 1
            while cid in seen_ids_ic:
                n += 1
                cid = f"{base_cid}_{n}"
            low = label.lower()
            if low in seen_labels_ic:
                continue
            seen_ids_ic.add(cid)
            seen_labels_ic.add(low)
            cleaned_ic.append({
                "id": cid,
                "label": label,
                "icon": (c.icon or "").strip()[:8] or None,
                "color": (c.color or "").strip()[:16] or None,
            })
        if not cleaned_ic:
            raise HTTPException(422, "Nessuna categoria ingrediente valida fornita")
        prefs["ingredient_categories"] = cleaned_ic
    if body.notifications is not None:
        cur = prefs.get("notifications") or {}
        n = body.notifications
        if n.enabled is not None: cur["enabled"] = bool(n.enabled)
        if n.expiry_days_ahead is not None:
            cur["expiry_days_ahead"] = max(0, min(30, int(n.expiry_days_ahead)))
        if n.days_ahead is not None:
            # Dedupe, clamp, sort desc so the "furthest ahead" chip comes first.
            days = sorted({max(0, min(30, int(x))) for x in n.days_ahead}, reverse=True)
            cur["days_ahead"] = days
            # Also mirror the first (largest) into the legacy field for backward compat.
            if days:
                cur["expiry_days_ahead"] = days[0]
        if n.notify_hour is not None:
            cur["notify_hour"] = max(0, min(23, int(n.notify_hour)))
        if n.freezer_enabled is not None: cur["freezer_enabled"] = bool(n.freezer_enabled)
        if n.freezer_hours is not None:
            cur["freezer_hours"] = max(1, min(168, int(n.freezer_hours)))
        prefs["notifications"] = cur
    if body.defaults is not None:
        cur_d = prefs.get("defaults") or {}
        d = body.defaults
        if d.default_qty is not None:
            cur_d["default_qty"] = max(0.0, float(d.default_qty))
        if d.default_unit is not None:
            cur_d["default_unit"] = str(d.default_unit)[:16]
        if d.default_servings is not None:
            cur_d["default_servings"] = max(1, min(50, int(d.default_servings)))
        prefs["defaults"] = cur_d
    # Ultra cloud backups feature was removed — silently drop legacy field
    prefs.pop("backups", None)
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"preferences": prefs, "updated_at": _now()}},
    )
    updated = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "password_hash": 0})
    pub = await _user_public(updated)
    return pub["preferences"]


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization:
        _, token = get_authorization_scheme_param(authorization)
        if token:
            await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


class DeleteAccountBody(BaseModel):
    password: str
    # Force-word the user must type verbatim (localized). Any non-empty value
    # is accepted; the frontend enforces the exact wording.
    confirm: str


@api_router.post("/auth/delete-account")
async def delete_account(body: DeleteAccountBody, current_user=Depends(get_current_user)):
    """Permanent self-service account deletion.

    Requires the current password (defense-in-depth against stolen sessions)
    and a confirmation string. Wipes ALL user data across every collection.
    """
    user_id = current_user["user_id"]
    if not body.confirm or len(body.confirm.strip()) < 3:
        raise HTTPException(status_code=400, detail="confirmation_required")
    # Re-verify password
    user_doc = await db.users.find_one({"user_id": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    ph = user_doc.get("password_hash") or ""
    try:
        ok = bcrypt.checkpw(body.password.encode("utf-8"), ph.encode("utf-8"))
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(status_code=401, detail="invalid_password")

    # Hard-delete everything belonging to the user (mirrors admin flow).
    removed = {
        "dishes": (await db.dishes.delete_many({"user_id": user_id})).deleted_count,
        "weekly_plans": (await db.weekly_plans.delete_many({"user_id": user_id})).deleted_count,
        "shopping_items": (await db.shopping_items.delete_many({"user_id": user_id})).deleted_count,
        "fridge_items": (await db.fridge_items.delete_many({"user_id": user_id})).deleted_count,
        "photos": (await db.photos.delete_many({"user_id": user_id})).deleted_count if hasattr(db, "photos") else 0,
        "user_sessions": (await db.user_sessions.delete_many({"user_id": user_id})).deleted_count,
    }
    await db.users.delete_one({"user_id": user_id})
    return {"ok": True, "removed": removed}


# -------------------- Dishes --------------------
@api_router.get("/dishes")
async def list_dishes(course: Optional[str] = None, q: Optional[str] = None, current_user=Depends(get_current_user)):
    query: Dict[str, Any] = {"user_id": current_user["user_id"]}
    if course:
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
        "notes": body.notes,
        "servings": max(1, body.servings),
        "photo_path": body.photo_path,
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
    user_id = current_user["user_id"]
    old = await db.dishes.find_one({"id": dish_id, "user_id": user_id}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Piatto non trovato")

    new_name = body.name.strip()
    new_ingredients = [ing.dict() for ing in body.ingredients]
    new_servings = max(1, body.servings)

    res = await db.dishes.update_one(
        {"id": dish_id, "user_id": user_id},
        {"$set": {
            "name": new_name,
            "course": body.course,
            "ingredients": new_ingredients,
            "preparation": body.preparation,
            "notes": body.notes,
            "servings": new_servings,
            "photo_path": body.photo_path,
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Piatto non trovato")

    # Detect what changed
    name_changed = new_name != old.get("name")
    # Ingredients or servings changes → need to recompute shopping contributions
    ings_changed = (new_ingredients != old.get("ingredients", []) or
                     new_servings != old.get("servings", 1))

    # 1. Propagate name to slots + sources (fast path, no shopping recompute)
    if name_changed:
        plans_cursor = db.weekly_plans.find(
            {"user_id": user_id, "slots": {"$exists": True}},
            {"_id": 1, "slots": 1},
        )
        async for plan in plans_cursor:
            slots = plan.get("slots") or {}
            changed = False
            for k, slot in slots.items():
                if isinstance(slot.get("items"), list):
                    for it in slot["items"]:
                        if it.get("dish_id") == dish_id and it.get("dish_name") != new_name:
                            it["dish_name"] = new_name
                            changed = True
                elif slot.get("dish_id") == dish_id and slot.get("dish_name") != new_name:
                    slot["dish_name"] = new_name
                    changed = True
            if changed:
                await db.weekly_plans.update_one({"_id": plan["_id"]}, {"$set": {"slots": slots}})
        await db.shopping_items.update_many(
            {"user_id": user_id, "sources.dish_id": dish_id},
            {"$set": {"sources.$[s].dish_name": new_name}},
            array_filters=[{"s.dish_id": dish_id}],
        )

    # 2. Recompute shopping if ingredients/servings changed:
    #    for every slot referencing this dish, remove its OLD contributions
    #    and re-add fresh ones with the new ingredient list.
    if ings_changed:
        updated_dish = await db.dishes.find_one({"id": dish_id, "user_id": user_id}, {"_id": 0})
        plans_cursor = db.weekly_plans.find(
            {"user_id": user_id, "slots": {"$exists": True}},
            {"_id": 1, "week_start": 1, "slots": 1},
        )
        async for plan in plans_cursor:
            week_start = plan.get("week_start")
            slots = plan.get("slots") or {}
            for slot_key, slot in slots.items():
                try:
                    day_str, meal = slot_key.split("_", 1)
                    day_index = int(day_str)
                except (ValueError, AttributeError):
                    continue
                # New multi-item form
                if isinstance(slot.get("items"), list):
                    for it in slot["items"]:
                        if it.get("dish_id") == dish_id:
                            persons = int(it.get("persons") or 1)
                            await _remove_dish_source_from_shopping(user_id, week_start, day_index, meal, dish_id)
                            await _add_dish_to_shopping(user_id, week_start, day_index, meal, updated_dish, persons,
                                                        only_update_existing=True)
                # Legacy single-item form
                elif slot.get("dish_id") == dish_id:
                    persons = int(slot.get("persons") or 1)
                    await _remove_dish_source_from_shopping(user_id, week_start, day_index, meal, dish_id)
                    await _add_dish_to_shopping(user_id, week_start, day_index, meal, updated_dish, persons,
                                                only_update_existing=True)

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
        "notes": src.get("notes", ""),
        "servings": src.get("servings", 1),
        "created_at": _now(),
    }
    await db.dishes.insert_one(dict(new_dish))
    return new_dish


# -------------------- Planner + Shopping sync --------------------
def _norm_name(name: str, unit: str) -> str:
    return f"{name.strip().lower()}::{unit.strip().lower()}"


async def _add_dish_to_shopping(user_id: str, week_start: str, day_index: int, meal: str,
                                 dish: Dict[str, Any], persons: int,
                                 only_update_existing: bool = False):
    """Add scaled ingredients from a dish to the shopping list.

    When `only_update_existing` is True, ingredients that do NOT already have a
    matching shopping_items row are skipped instead of being inserted. This is
    used when a dish is *edited* and the caller wants to propagate quantity
    changes to items already on the shopping list, without silently adding
    freshly-introduced ingredients to it.
    """
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
            set_fields: Dict[str, Any] = {"sources": new_sources, "planner_qty": new_planner_qty}
            # If existing item has no category yet, inherit from ingredient
            if not existing.get("category_id") and ing.get("category_id"):
                set_fields["category_id"] = ing["category_id"]
            await db.shopping_items.update_one(
                {"user_id": user_id, "key": key},
                {"$set": set_fields},
            )
        else:
            if only_update_existing:
                # Caller opted out of inserting new rows — silently skip.
                continue
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
                "category_id": ing.get("category_id") or "altro",
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


async def _remove_dish_source_from_shopping(user_id: str, week_start: str, day_index: int,
                                             meal: str, dish_id: str) -> None:
    """Remove ONLY the sources contributed by a specific dish inside the given
    (week, day, meal) slot. Used when a dish gets edited/renamed so we can
    recompute its ingredient contributions without touching sibling items."""
    items = await db.shopping_items.find({"user_id": user_id}, {"_id": 0}).to_list(1000)
    for it in items:
        sources = it.get("sources", [])
        removed_qty = 0.0
        remaining = []
        for s in sources:
            if (
                s.get("week_start") == week_start
                and s.get("day_index") == day_index
                and s.get("meal") == meal
                and s.get("dish_id") == dish_id
            ):
                removed_qty += s.get("quantity", 0.0)
            else:
                remaining.append(s)
        if removed_qty > 0:
            new_planner_qty = max(0.0, it.get("planner_qty", 0.0) - removed_qty)
            if new_planner_qty <= 0.0001 and it.get("manual_qty", 0.0) <= 0.0001 and len(remaining) == 0:
                await db.shopping_items.delete_one({"id": it["id"], "user_id": user_id})
            else:
                await db.shopping_items.update_one(
                    {"id": it["id"], "user_id": user_id},
                    {"$set": {"sources": remaining, "planner_qty": new_planner_qty}},
                )

def _normalize_slot(slot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Return a slot in the new `{items: [...]}` form.

    Historical slots stored a single dish flat on the slot object:
        {dish_id, dish_name, course, persons}
    New slots use:
        {items: [{dish_id, dish_name, course, persons}]}
    We normalize on read so clients only deal with the new shape.
    """
    if not slot:
        return None
    if isinstance(slot.get("items"), list):
        return {"items": [dict(x) for x in slot["items"]]}
    if slot.get("dish_id"):
        return {"items": [{
            "dish_id": slot["dish_id"],
            "dish_name": slot.get("dish_name", ""),
            "course": slot.get("course", ""),
            "persons": int(slot.get("persons") or 1),
        }]}
    return {"items": []}


def _normalize_slots(slots: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in (slots or {}).items():
        norm = _normalize_slot(v)
        if norm and norm["items"]:
            out[k] = norm
    return out


@api_router.get("/planner-weeks")
async def list_planner_weeks(current_user=Depends(get_current_user)):
    """List all weeks that have any slots, most recent first, for the duplicate picker."""
    cursor = db.weekly_plans.find(
        {"user_id": current_user["user_id"]},
        {"_id": 0, "week_start": 1, "slots": 1},
    ).sort("week_start", -1)
    rows = await cursor.to_list(200)
    out: List[Dict[str, Any]] = []
    for r in rows:
        norm = _normalize_slots(r.get("slots", {}) or {})
        if norm:
            out.append({"week_start": r["week_start"], "count": len(norm)})
    return out




@api_router.get("/planner/{week_start}")
async def get_planner(week_start: str, current_user=Depends(get_current_user)):
    plan = await db.weekly_plans.find_one(
        {"user_id": current_user["user_id"], "week_start": week_start}, {"_id": 0}
    )
    if not plan:
        # 7 days x 2 meals, empty
        empty = {"user_id": current_user["user_id"], "week_start": week_start, "slots": {}}
        return empty
    plan["slots"] = _normalize_slots(plan.get("slots", {}) or {})
    return plan


@api_router.put("/planner/slot")
async def update_slot(body: PlannerSlotUpdate, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    slot_key = f"{body.day_index}_{body.meal}"

    # Resolve new items list (multi form takes priority, else legacy single, else empty)
    new_items: List[Dict[str, Any]] = []
    if body.items is not None:
        for it in body.items:
            if not it.dish_id:
                continue
            new_items.append({"dish_id": it.dish_id, "persons": max(1, int(it.persons or 1))})
    elif body.dish_id:
        new_items.append({"dish_id": body.dish_id, "persons": max(1, int(body.persons or 1))})

    # Ensure plan doc exists
    plan = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.week_start}, {"_id": 0})
    if not plan:
        plan = {"user_id": user_id, "week_start": body.week_start, "slots": {}}
        await db.weekly_plans.insert_one(dict(plan))

    # Always clear existing shopping contributions of that slot (whatever shape it had)
    # Skip when the client explicitly opted out of shopping propagation.
    if body.sync_shopping and plan.get("slots", {}).get(slot_key):
        await _remove_planner_source_from_shopping(user_id, body.week_start, body.day_index, body.meal)

    if new_items:
        # Fetch dish docs, add contributions, and persist slot
        resolved_items: List[Dict[str, Any]] = []
        for it in new_items:
            dish = await db.dishes.find_one({"id": it["dish_id"], "user_id": user_id}, {"_id": 0})
            if not dish:
                # Ignore missing dishes gracefully rather than 404 the whole update
                continue
            resolved_items.append({
                "dish_id": dish["id"],
                "dish_name": dish["name"],
                "course": dish.get("course", ""),
                "persons": it["persons"],
            })
            if body.sync_shopping:
                await _add_dish_to_shopping(user_id, body.week_start, body.day_index, body.meal, dish, it["persons"])
        if not resolved_items:
            # All requested dishes missing → unset slot
            await db.weekly_plans.update_one(
                {"user_id": user_id, "week_start": body.week_start},
                {"$unset": {f"slots.{slot_key}": ""}},
            )
        else:
            await db.weekly_plans.update_one(
                {"user_id": user_id, "week_start": body.week_start},
                {"$set": {f"slots.{slot_key}": {"items": resolved_items}}},
            )
    else:
        await db.weekly_plans.update_one(
            {"user_id": user_id, "week_start": body.week_start},
            {"$unset": {f"slots.{slot_key}": ""}},
        )

    plan = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.week_start}, {"_id": 0})
    if plan:
        plan["slots"] = _normalize_slots(plan.get("slots", {}) or {})
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

    # Normalize source slots to items form, then persist to target
    src_slots = _normalize_slots(source.get("slots", {}) or {})
    await db.weekly_plans.insert_one({
        "user_id": user_id,
        "week_start": body.target_week_start,
        "slots": src_slots,
    })
    # Add ingredients for each item in each slot
    for slot_key, slot in src_slots.items():
        day_index_str, meal = slot_key.split("_")
        day_index = int(day_index_str)
        for it in slot.get("items", []):
            dish = await db.dishes.find_one({"id": it["dish_id"], "user_id": user_id}, {"_id": 0})
            if dish:
                await _add_dish_to_shopping(
                    user_id, body.target_week_start, day_index, meal, dish, int(it.get("persons") or 1)
                )
    plan = await db.weekly_plans.find_one({"user_id": user_id, "week_start": body.target_week_start}, {"_id": 0})
    if plan:
        plan["slots"] = _normalize_slots(plan.get("slots", {}) or {})
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
        update: Dict[str, Any] = {"$inc": {"manual_qty": float(body.quantity)}}
        set_fields: Dict[str, Any] = {}
        if body.notes:
            existing_notes = existing.get("notes", "").strip()
            new_notes = body.notes.strip()
            merged = "\n".join([n for n in [existing_notes, new_notes] if n])
            set_fields["notes"] = merged
        if body.category_id and not existing.get("category_id"):
            set_fields["category_id"] = body.category_id
        if set_fields:
            update["$set"] = set_fields
        await db.shopping_items.update_one({"user_id": user_id, "key": key}, update)
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
        "notes": body.notes,
        "category_id": body.category_id or "altro",
        "photo_path": body.photo_path,
        "checked": False,
        "order": next_order,
        "created_at": _now(),
    }
    await db.shopping_items.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.patch("/shopping/{item_id}")
async def edit_item(item_id: str, body: ShoppingItemUpdate, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    it = await db.shopping_items.find_one({"id": item_id, "user_id": user_id}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Elemento non trovato")
    update_set: Dict[str, Any] = {}
    if body.notes is not None:
        update_set["notes"] = body.notes
    if body.category_id is not None:
        update_set["category_id"] = body.category_id
    if body.photo_path is not None:
        update_set["photo_path"] = body.photo_path
    # Manual qty adjustment
    if body.quantity is not None:
        new_manual = max(0.0, float(body.quantity))
        # If planner_qty=0 and new_manual=0, delete entirely
        if new_manual <= 0.0001 and it.get("planner_qty", 0.0) <= 0.0001:
            await db.shopping_items.delete_one({"id": item_id, "user_id": user_id})
            return {"ok": True, "deleted": True}
        update_set["manual_qty"] = new_manual
    # Name / unit change (affects key)
    new_name = body.name.strip() if body.name is not None else it["name"]
    new_unit = body.unit.strip() if body.unit is not None else it["unit"]
    if new_name != it["name"] or new_unit != it["unit"]:
        new_key = _norm_name(new_name, new_unit)
        if new_key != it["key"]:
            # If another item with same new_key exists, merge into it
            other = await db.shopping_items.find_one({"user_id": user_id, "key": new_key}, {"_id": 0})
            if other and other["id"] != item_id:
                merged_manual = other.get("manual_qty", 0.0) + update_set.get("manual_qty", it.get("manual_qty", 0.0))
                merged_planner = other.get("planner_qty", 0.0) + it.get("planner_qty", 0.0)
                merged_sources = other.get("sources", []) + it.get("sources", [])
                merged_notes_list = [n for n in [other.get("notes", ""), update_set.get("notes", it.get("notes", ""))] if n]
                merged_notes = "\n".join(merged_notes_list)
                await db.shopping_items.update_one(
                    {"id": other["id"], "user_id": user_id},
                    {"$set": {
                        "manual_qty": merged_manual, "planner_qty": merged_planner,
                        "sources": merged_sources, "notes": merged_notes,
                    }},
                )
                await db.shopping_items.delete_one({"id": item_id, "user_id": user_id})
                return await db.shopping_items.find_one({"id": other["id"], "user_id": user_id}, {"_id": 0})
        update_set["name"] = new_name
        update_set["unit"] = new_unit
        update_set["key"] = new_key
    if update_set:
        await db.shopping_items.update_one({"id": item_id, "user_id": user_id}, {"$set": update_set})
    return await db.shopping_items.find_one({"id": item_id, "user_id": user_id}, {"_id": 0})


@api_router.patch("/shopping/{item_id}/toggle")
async def toggle_item(item_id: str, body: ShoppingItemToggle, current_user=Depends(get_current_user)):
    user_id = current_user["user_id"]
    it = await db.shopping_items.find_one({"id": item_id, "user_id": user_id}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Elemento non trovato")
    if body.checked:
        # Move to end
        last = await db.shopping_items.find_one({"user_id": user_id}, {"_id": 0}, sort=[("order", -1)])
        new_order = (last["order"] + 1) if last else 0
        await db.shopping_items.update_one(
            {"id": item_id, "user_id": user_id},
            {"$set": {"checked": True, "order": new_order}},
        )
    else:
        await db.shopping_items.update_one(
            {"id": item_id, "user_id": user_id},
            {"$set": {"checked": False}},
        )
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


def _fridge_key(name: str, unit: str) -> str:
    return f"{name.strip().lower()}|{unit.strip().lower()}"


def _normalize_expiries(raw: Any) -> List[Dict[str, Any]]:
    """Normalize incoming expiries to a list of {date: str, label: str}.

    Accepts either legacy list of ISO date strings ("YYYY-MM-DD") or dicts
    with keys `date` (required) and optional `label`. Invalid entries are
    silently dropped. Result is sorted ascending by date.
    """
    out: List[Dict[str, Any]] = []
    for e in (raw or []):
        try:
            if isinstance(e, str):
                if len(e) == 10:
                    out.append({"date": e, "label": ""})
            elif isinstance(e, dict):
                d = str(e.get("date") or "")
                if len(d) == 10:
                    label = str(e.get("label") or "").strip()[:60]
                    out.append({"date": d, "label": label})
        except Exception:
            continue
    out.sort(key=lambda x: x.get("date", ""))
    return out


def _expiries_dates(raw: Any) -> List[str]:
    """Return just the date strings from a legacy or normalized expiries list."""
    if not raw:
        return []
    dates: List[str] = []
    for e in raw:
        if isinstance(e, str) and len(e) == 10:
            dates.append(e)
        elif isinstance(e, dict):
            d = e.get("date")
            if isinstance(d, str) and len(d) == 10:
                dates.append(d)
    return dates


async def _cleanup_expired_fridge(user_id: str) -> int:
    """Auto-remove fridge items whose LATEST expiry is in the past."""
    today = datetime.now(timezone.utc).date().isoformat()
    to_remove: List[str] = []
    async for it in db.fridge_items.find({"user_id": user_id}, {"_id": 0}):
        exps = _expiries_dates(it.get("expiries"))
        if not exps:
            continue  # keep items without any date
        latest = max(exps)
        if latest < today:
            to_remove.append(it["id"])
    if to_remove:
        await db.fridge_items.delete_many({"user_id": user_id, "id": {"$in": to_remove}})
    return len(to_remove)


@api_router.post("/shopping/clear-checked")
async def clear_checked(
    to_fridge: bool = True,
    current_user=Depends(get_current_user),
):
    """Mark ALL checked shopping items as bought.

    Query params:
    - `to_fridge` (default True): when True AND the user is Pro, checked items
      are migrated to the Frigorifero (fridge) so expirations can be tracked.
      When False (or the user is not Pro), items are simply deleted.
    """
    user_id = current_user["user_id"]
    is_pro = _is_pro(current_user)
    if is_pro and to_fridge:
        # Move each checked shopping item to fridge_items (merge by name+unit key).
        cursor = db.shopping_items.find({"user_id": user_id, "checked": True}, {"_id": 0})
        checked_items = await cursor.to_list(length=None)
        moved = 0
        for si in checked_items:
            fkey = _fridge_key(si.get("name", ""), si.get("unit", ""))
            total_qty = float(si.get("manual_qty", 0.0)) + float(si.get("planner_qty", 0.0))
            existing = await db.fridge_items.find_one({"user_id": user_id, "key": fkey}, {"_id": 0})
            if existing:
                await db.fridge_items.update_one(
                    {"user_id": user_id, "key": fkey},
                    {"$set": {
                        "quantity": float(existing.get("quantity", 0.0)) + total_qty,
                        "photo_path": existing.get("photo_path") or si.get("photo_path"),
                        "category_id": existing.get("category_id") or si.get("category_id") or "altro",
                        "updated_at": _now(),
                    }},
                )
            else:
                await db.fridge_items.insert_one({
                    "id": _uid(),
                    "user_id": user_id,
                    "key": fkey,
                    "name": si.get("name", ""),
                    "unit": si.get("unit", ""),
                    "quantity": total_qty,
                    "category_id": si.get("category_id") or "altro",
                    "photo_path": si.get("photo_path"),
                    "notes": si.get("notes", ""),
                    "expiries": [],
                    "created_at": _now(),
                })
            moved += 1
        # Also cleanup any freshly-expired items while we're here
        await _cleanup_expired_fridge(user_id)
        await db.shopping_items.delete_many({"user_id": user_id, "checked": True})
        return {"ok": True, "moved_to_fridge": moved}
    # Delete-only path (Free tier OR Pro user chose "delete only"):
    result = await db.shopping_items.delete_many({"user_id": user_id, "checked": True})
    return {"ok": True, "moved_to_fridge": 0, "deleted": result.deleted_count}


# -------------------- Frigorifero (Pro feature) --------------------
@api_router.get("/fridge")
async def list_fridge(current_user=Depends(require_pro_plus)):
    user_id = current_user["user_id"]
    await _cleanup_expired_fridge(user_id)
    cursor = db.fridge_items.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(length=None)
    # Backfill legacy list-of-strings shape into new list-of-dicts for the client
    for it in items:
        it["expiries"] = _normalize_expiries(it.get("expiries"))
    return items


@api_router.post("/fridge")
async def add_fridge(body: FridgeItemCreate, current_user=Depends(require_pro_plus)):
    user_id = current_user["user_id"]
    key = _fridge_key(body.name, body.unit)
    doc = {
        "id": _uid(),
        "user_id": user_id,
        "key": key,
        "name": body.name.strip(),
        "unit": body.unit.strip(),
        "quantity": float(body.quantity),
        "category_id": body.category_id or "altro",
        "photo_path": body.photo_path,
        "notes": body.notes,
        "expiries": _normalize_expiries(body.expiries),
        "created_at": _now(),
    }
    await db.fridge_items.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.patch("/fridge/{item_id}")
async def update_fridge(item_id: str, body: FridgeItemUpdate, current_user=Depends(require_pro_plus)):
    user_id = current_user["user_id"]
    update_set: Dict[str, Any] = {}
    if body.name is not None: update_set["name"] = body.name.strip()
    if body.unit is not None: update_set["unit"] = body.unit.strip()
    if body.quantity is not None: update_set["quantity"] = float(body.quantity)
    if body.notes is not None: update_set["notes"] = body.notes
    if body.category_id is not None: update_set["category_id"] = body.category_id
    if body.photo_path is not None: update_set["photo_path"] = body.photo_path
    if body.expiries is not None:
        update_set["expiries"] = _normalize_expiries(body.expiries)
    if body.name is not None or body.unit is not None:
        # rebuild key
        cur = await db.fridge_items.find_one({"user_id": user_id, "id": item_id}, {"_id": 0})
        if cur:
            new_name = update_set.get("name", cur["name"])
            new_unit = update_set.get("unit", cur["unit"])
            update_set["key"] = _fridge_key(new_name, new_unit)
    if not update_set:
        return {"ok": True}
    update_set["updated_at"] = _now()
    result = await db.fridge_items.update_one(
        {"user_id": user_id, "id": item_id},
        {"$set": update_set},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.fridge_items.find_one({"user_id": user_id, "id": item_id}, {"_id": 0})
    if doc:
        doc["expiries"] = _normalize_expiries(doc.get("expiries"))
    return doc


@api_router.delete("/fridge/{item_id}")
async def delete_fridge(item_id: str, current_user=Depends(require_pro_plus)):
    user_id = current_user["user_id"]
    result = await db.fridge_items.delete_one({"user_id": user_id, "id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


# -------------------- Notification center (Pro+) --------------------
@api_router.get("/notifications")
async def list_notifications(current_user=Depends(require_pro_plus)):
    """Compute fridge notifications on-the-fly and merge with per-user read/deleted state.

    Notifications are derived from current fridge state (expiring items) so no
    background job is needed. We keep only a tiny `notification_states` doc per
    user with which alerts have been read or deleted.
    """
    user_id = current_user["user_id"]
    prefs = (current_user.get("preferences") or {}).get("notifications") or {}
    days_ahead = prefs.get("days_ahead") or [int(prefs.get("expiry_days_ahead") or 1)]
    max_ahead = max(days_ahead) if days_ahead else 3

    today = datetime.now(timezone.utc).date()
    items = []
    async for it in db.fridge_items.find({"user_id": user_id}, {"_id": 0}):
        exps = _normalize_expiries(it.get("expiries"))
        if not exps:
            continue
        for e in exps:
            try:
                d = datetime.strptime(e["date"], "%Y-%m-%d").date()
                delta = (d - today).days
            except Exception:
                continue
            # Emit a notification only if today matches one of the configured
            # preavviso days OR if the item is already overdue (never miss those).
            if delta >= 0 and delta not in days_ahead and delta > max_ahead:
                continue
            if delta > max_ahead:
                continue
            nid = f"exp:{it['id']}:{e['date']}:{e.get('label') or ''}"
            items.append({
                "id": nid,
                "kind": "expiry",
                "fridge_item_id": it["id"],
                "item_name": it.get("name", ""),
                "item_photo_path": it.get("photo_path"),
                "category_id": it.get("category_id"),
                "date": e["date"],
                "label": e.get("label") or "",
                "days_until": delta,
                "created_at": _now().isoformat(),
            })

    # Load per-user state
    state_doc = await db.notification_states.find_one({"user_id": user_id}, {"_id": 0}) or {}
    read = set(state_doc.get("read") or [])
    deleted = set(state_doc.get("deleted") or [])

    out = []
    for n in items:
        if n["id"] in deleted:
            continue
        n["read"] = n["id"] in read
        out.append(n)

    # Sort by urgency: overdue first, then closest to expiring.
    out.sort(key=lambda x: (x["days_until"], x["date"]))
    unread = sum(1 for n in out if not n["read"])
    return {"notifications": out, "unread": unread}


class NotificationMarkBody(BaseModel):
    ids: List[str]


@api_router.post("/notifications/read")
async def mark_read(body: NotificationMarkBody, current_user=Depends(require_pro_plus)):
    """Mark one or more notifications as read/unread by id."""
    user_id = current_user["user_id"]
    if not body.ids:
        return {"ok": True}
    await db.notification_states.update_one(
        {"user_id": user_id},
        {"$addToSet": {"read": {"$each": body.ids}}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/notifications/unread")
async def mark_unread(body: NotificationMarkBody, current_user=Depends(require_pro_plus)):
    user_id = current_user["user_id"]
    if not body.ids:
        return {"ok": True}
    await db.notification_states.update_one(
        {"user_id": user_id},
        {"$pull": {"read": {"$in": body.ids}}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/notifications/delete")
async def delete_notifications(body: NotificationMarkBody, current_user=Depends(require_pro_plus)):
    """Soft-delete notifications so they won't reappear on the next fetch."""
    user_id = current_user["user_id"]
    if not body.ids:
        return {"ok": True}
    await db.notification_states.update_one(
        {"user_id": user_id},
        {"$addToSet": {"deleted": {"$each": body.ids}}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/notifications/mark-all-read")
async def mark_all_read(current_user=Depends(require_pro_plus)):
    """Convenience endpoint: mark every currently visible notification as read."""
    # Reuse list logic to know which ids are visible right now.
    payload = await list_notifications(current_user)  # type: ignore
    ids = [n["id"] for n in payload["notifications"]]
    if ids:
        await db.notification_states.update_one(
            {"user_id": current_user["user_id"]},
            {"$addToSet": {"read": {"$each": ids}}},
            upsert=True,
        )
    return {"ok": True, "count": len(ids)}


@api_router.get("/")
async def root():
    return {"message": "Cucina di Casa API"}


# -------------------- Photo upload (Pro feature) --------------------
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_UPLOAD_BYTES = 4 * 1024 * 1024  # 4 MB after client-side compression


@api_router.post("/upload/photo")
async def upload_photo(
    file: UploadFile = File(...),
    current_user=Depends(require_pro),
):
    """Upload a photo (dish/ingredient/shopping). Returns storage path."""
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {content_type}")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 4MB)")

    ext_map = {
        "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
        "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
    }
    ext = ext_map.get(content_type, "jpg")
    filename = f"{uuid.uuid4().hex}.{ext}"
    path = user_photo_path(current_user["user_id"], filename)
    try:
        await put_object(path, data, content_type)
    except Exception as e:
        logging.getLogger(__name__).error(f"Photo upload failed: {e}")
        raise HTTPException(status_code=502, detail="Storage upload failed")

    # Persist ownership so future GETs can be authorized
    await db.photos.insert_one({
        "path": path,
        "user_id": current_user["user_id"],
        "content_type": content_type,
        "size": len(data),
        "created_at": _now(),
    })
    return {"path": path, "size": len(data), "content_type": content_type}


@api_router.get("/files/{path:path}")
async def get_photo(
    path: str,
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """Serve a stored photo. Authenticated via bearer OR short-lived ?token= (web)."""
    # Look up ownership from our DB
    meta = await db.photos.find_one({"path": path}, {"_id": 0})
    if not meta:
        raise HTTPException(status_code=404, detail="Not found")

    authorized = False
    # 1) Bearer token path
    if authorization:
        try:
            user = await get_current_user(authorization=authorization)
            if user["user_id"] == meta["user_id"]:
                authorized = True
        except HTTPException:
            pass
    # 2) Signed query token path (for web <img>)
    if not authorized and token and verify_token(path, token):
        authorized = True

    if not authorized:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        data, ctype = await get_object(path)
    except Exception as e:
        logging.getLogger(__name__).error(f"Photo fetch failed: {e}")
        raise HTTPException(status_code=502, detail="Storage read failed")
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "public, max-age=3600"})


@api_router.get("/files-token/{path:path}")
async def sign_photo(path: str, current_user=Depends(get_current_user)):
    """Issue a short-lived HMAC token so <img> tags on web can auth read."""
    meta = await db.photos.find_one({"path": path}, {"_id": 0})
    if not meta or meta.get("user_id") != current_user["user_id"]:
        raise HTTPException(status_code=404, detail="Not found")
    return {"token": sign_token(path, ttl_seconds=3600)}


# -------------------- Export / Import --------------------
async def _gather_user_snapshot(user_id: str, username: Optional[str] = None) -> Dict[str, Any]:
    """Build a serializable snapshot of ALL user data used for both export and
    cloud backups. Includes dishes, weekly plans, shopping and fridge items.
    Datetimes are converted to ISO strings so the payload is JSON-safe.
    """
    dishes = await db.dishes.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
    plans = await db.weekly_plans.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
    shopping = await db.shopping_items.find({"user_id": user_id}, {"_id": 0}).to_list(4000)
    fridge = await db.fridge_items.find({"user_id": user_id}, {"_id": 0}).to_list(2000)

    def _cast(doc: Dict[str, Any]) -> Dict[str, Any]:
        out = {}
        for k, v in doc.items():
            if isinstance(v, datetime):
                out[k] = v.isoformat()
            else:
                out[k] = v
        return out

    return {
        "app": "PlanEat",
        "version": 2,
        "exported_at": _now().isoformat(),
        "user": {"username": username},
        "dishes": [_cast(d) for d in dishes],
        "weekly_plans": [_cast(p) for p in plans],
        "shopping_items": [_cast(s) for s in shopping],
        "fridge_items": [_cast(f) for f in fridge],
    }


async def _apply_snapshot(user_id: str, payload: Dict[str, Any], mode: str) -> Dict[str, int]:
    """Restore a snapshot to the current user's collections. mode='replace'
    wipes existing data first; mode='merge' only appends missing items.
    Returns counts of imported records per collection.
    """
    dishes = payload.get("dishes") or []
    plans = payload.get("weekly_plans") or []
    shopping = payload.get("shopping_items") or []
    fridge = payload.get("fridge_items") or []

    if mode == "replace":
        await db.dishes.delete_many({"user_id": user_id})
        await db.weekly_plans.delete_many({"user_id": user_id})
        await db.shopping_items.delete_many({"user_id": user_id})
        await db.fridge_items.delete_many({"user_id": user_id})

    imported = {"dishes": 0, "weekly_plans": 0, "shopping_items": 0, "fridge_items": 0}

    for d in dishes:
        try:
            doc = {
                "id": d.get("id") or _uid(),
                "user_id": user_id,
                "name": str(d.get("name", "")).strip() or "Piatto",
                "course": str(d.get("course") or "primo").strip() or "primo",
                "ingredients": d.get("ingredients", []),
                "preparation": d.get("preparation", ""),
                "notes": d.get("notes", ""),
                "servings": max(1, int(d.get("servings", 1) or 1)),
                "photo_path": d.get("photo_path"),
                "created_at": _now(),
            }
            if mode == "merge":
                exists = await db.dishes.find_one({"user_id": user_id, "id": doc["id"]}, {"_id": 0})
                if exists:
                    continue
            await db.dishes.insert_one(doc)
            imported["dishes"] += 1
        except Exception:
            continue

    for p in plans:
        try:
            week = str(p.get("week_start", ""))
            if not week:
                continue
            slots = p.get("slots", {}) or {}
            if mode == "merge":
                exists = await db.weekly_plans.find_one({"user_id": user_id, "week_start": week}, {"_id": 0})
                if exists:
                    continue
            await db.weekly_plans.update_one(
                {"user_id": user_id, "week_start": week},
                {"$set": {"user_id": user_id, "week_start": week, "slots": slots}},
                upsert=True,
            )
            imported["weekly_plans"] += 1
        except Exception:
            continue

    for it in shopping:
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
                "notes": it.get("notes", ""),
                "category_id": it.get("category_id"),
                "photo_path": it.get("photo_path"),
                "created_at": _now(),
            }
            if not doc["name"]:
                continue
            if mode == "merge":
                exists = await db.shopping_items.find_one({"user_id": user_id, "key": key}, {"_id": 0})
                if exists:
                    continue
            await db.shopping_items.update_one(
                {"user_id": user_id, "key": key},
                {"$set": doc},
                upsert=True,
            )
            imported["shopping_items"] += 1
        except Exception:
            continue

    for it in fridge:
        try:
            key = _norm_name(it.get("name", ""), it.get("unit", ""))
            doc = {
                "id": it.get("id") or _uid(),
                "user_id": user_id,
                "key": key,
                "name": str(it.get("name", "")).strip(),
                "unit": str(it.get("unit", "")).strip(),
                "quantity": float(it.get("quantity", 0) or 0),
                "notes": it.get("notes", ""),
                "category_id": it.get("category_id"),
                "photo_path": it.get("photo_path"),
                "expiries": _normalize_expiries(it.get("expiries")),
                "created_at": _now(),
            }
            if not doc["name"]:
                continue
            if mode == "merge":
                exists = await db.fridge_items.find_one({"user_id": user_id, "key": key}, {"_id": 0})
                if exists:
                    continue
            await db.fridge_items.update_one(
                {"user_id": user_id, "key": key},
                {"$set": doc},
                upsert=True,
            )
            imported["fridge_items"] += 1
        except Exception:
            continue

    return imported


@api_router.get("/export")
async def export_data(current_user=Depends(get_current_user)):
    """Export all of the current user's data as a JSON snapshot."""
    return await _gather_user_snapshot(current_user["user_id"], current_user.get("username"))


@api_router.post("/import")
async def import_data(body: ImportBody, current_user=Depends(get_current_user)):
    """Import a backup. mode=merge preserves existing data; mode=replace wipes user's
    data first (dishes/plans/shopping/fridge) then imports."""
    user_id = current_user["user_id"]
    payload = {
        "dishes": body.dishes,
        "weekly_plans": body.weekly_plans,
        "shopping_items": body.shopping_items,
        # Legacy /import doesn't ship fridge; new /backups snapshots do.
        "fridge_items": [],
    }
    imported = await _apply_snapshot(user_id, payload, body.mode)
    return {
        "ok": True,
        "imported": {
            "dishes": imported["dishes"],
            "weekly_plans": imported["weekly_plans"],
            "shopping_items": imported["shopping_items"],
        },
    }


# Cloud backups feature removed. Only manual /export and /import remain.


# ---- RevenueCat purchases + webhook ----
from purchases import (  # noqa: E402
    create_purchases_router,
    create_revenuecat_webhook_router,
    ensure_revenuecat_indexes,
)

api_router.include_router(create_purchases_router(db, get_current_user))
api_router.include_router(create_revenuecat_webhook_router(db))


@app.on_event("startup")
async def _ensure_purchase_indexes():
    await ensure_revenuecat_indexes(db)


app.include_router(api_router)

# Admin router (protected by ADMIN_PASSWORD header)
from admin import create_admin_router  # noqa: E402
app.include_router(create_admin_router(db), prefix="/api")

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
    # Drop old email unique index if present BEFORE running any migration
    try:
        indexes = await db.users.index_information()
        for name in list(indexes.keys()):
            info = indexes[name]
            key = info.get("key") if isinstance(info, dict) else None
            if key and any(k[0] == "email" for k in key):
                try:
                    await db.users.drop_index(name)
                except Exception:
                    pass
    except Exception:
        pass
    # Migrate old email-based users → username
    await _migrate_email_to_username()
    await db.users.create_index("username", unique=True, sparse=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.dishes.create_index([("user_id", 1), ("name", 1)])
    await db.weekly_plans.create_index([("user_id", 1), ("week_start", 1)], unique=True)
    await db.shopping_items.create_index([("user_id", 1), ("key", 1)])
    await db.shopping_items.create_index([("user_id", 1), ("order", 1)])
    await db.photos.create_index([("user_id", 1)])
    await db.photos.create_index("path", unique=True)
    await db.fridge_items.create_index([("user_id", 1), ("key", 1)])
    await db.fridge_items.create_index([("user_id", 1), ("created_at", -1)])

    # Initialize Emergent Object Storage (idempotent)
    try:
        await init_storage()
    except Exception as e:
        logger.warning(f"Object storage init deferred: {e}")

    # Cleanup: drop any legacy `backups` collection (Ultra feature removed)
    try:
        if "backups" in await db.list_collection_names():
            await db.backups.drop()
    except Exception:
        pass

    # Cleanup: reset any lingering "ultra" entitlement to pro_plus.
    try:
        await db.users.update_many(
            {"entitlements.ultra.active": True},
            {"$set": {"entitlements.pro_plus": {"active": True, "source": "migration_from_ultra", "granted_at": _now()}},
             "$unset": {"entitlements.ultra": ""}},
        )
    except Exception:
        pass

    # Seed / refresh dev accounts so testing agents always have them.
    await _seed_dev_users()


async def _seed_dev_users():
    """Ensure well-known dev/test users exist with the right entitlements.

    - `testPro` / `testPro123` → Pro
    - `halley` / `halley1234`  → founder → Pro+ automatically
    """
    seeds = [
        {"username": "testpro", "password": "testPro123", "tier": "pro"},
    ]
    for s in seeds:
        existing = await db.users.find_one({"username": s["username"]})
        if not existing:
            plain_codes, code_docs = _generate_recovery_codes()
            doc = {
                "user_id": _new_user_id(),
                "username": s["username"],
                "password_hash": _hash_password(s["password"]),
                "created_at": _now(),
                "provider": "username",
                "preferences": _default_prefs(),
                "recovery_codes": code_docs,
                "entitlements": {
                    s["tier"]: {
                        "active": True,
                        "source": "seed_dev",
                        "granted_at": _now(),
                    }
                },
            }
            try:
                await db.users.insert_one(doc)
                logger.info(f"Seeded dev user: {s['username']} ({s['tier']})")
            except Exception as e:
                logger.warning(f"Seed dev user {s['username']} failed: {e}")
        else:
            # Ensure entitlement is active on existing dev user
            ent_path = f"entitlements.{s['tier']}"
            await db.users.update_one(
                {"username": s["username"]},
                {"$set": {ent_path: {"active": True, "source": "seed_dev", "granted_at": _now()}}},
            )


async def _migrate_email_to_username():
    """Set a fallback username for users that only have email."""
    cursor = db.users.find({"username": {"$exists": False}, "email": {"$type": "string"}})
    async for u in cursor:
        base = (u["email"].split("@", 1)[0] or "utente").lower()
        base = re.sub(r"[^a-z0-9_.]", "_", base)[:30]
        if len(base) < 3:
            base = (base + "user")[:30]
        candidate = base
        n = 0
        while await db.users.find_one({"username": candidate}):
            n += 1
            suffix = f"_{n}"
            candidate = base[:30 - len(suffix)] + suffix
        await db.users.update_one(
            {"user_id": u["user_id"]},
            {"$set": {"username": candidate, "username_migrated": True}, "$unset": {"email": "", "picture": "", "name": ""}},
        )


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
