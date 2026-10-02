"""Admin router for Planibble.

All endpoints are protected by a single admin password sent via the
`X-Admin-Password` HTTP header, matching ADMIN_PASSWORD in the environment.

Endpoints (all under /api/admin):
- GET    /users                          List users with usage stats + tier
- GET    /users?username=X               Search by username (case-insensitive)
- GET    /users/{user_id}                Full user detail
- POST   /users/{user_id}/password       Reset user password
- PATCH  /users/{user_id}/username       Change username
- PATCH  /users/{user_id}/preferences    Merge preferences
- POST   /users/{user_id}/entitlements/{tier}  Grant/revoke tier
- POST   /users/{user_id}/recovery-codes/reset  Regenerate recovery codes
- DELETE /users/{user_id}/sessions       Invalidate all sessions
- DELETE /users/{user_id}                Delete user + all data
- GET    /users/{user_id}/dishes         User dishes
- GET    /users/{user_id}/fridge         User fridge items
- GET    /stats                          Global usage stats
- GET    /export                         Full DB snapshot as JSON
- GET    /export.csv                     Users list as CSV

Notes:
- Password hashes are NEVER returned. Recovery codes are counted only.
- Deletions are permanent (hard delete). Confirm on the client.
"""
from __future__ import annotations

import io
import csv
import os
import secrets
import string
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel


class AdminResetPasswordBody(BaseModel):
    new_password: str


class AdminEntitlementBody(BaseModel):
    active: bool
    reason: Optional[str] = None


class AdminChangeUsernameBody(BaseModel):
    new_username: str


class AdminPatchPrefsBody(BaseModel):
    """Merge-patch of user preferences. Only provided fields are updated."""
    week_start_day: Optional[int] = None
    planner_span: Optional[str] = None
    language: Optional[str] = None
    notifications: Optional[Dict[str, Any]] = None
    defaults: Optional[Dict[str, Any]] = None


FOUNDER_USERNAMES = {"halley"}
FOUNDER_TIER = "pro_plus"


def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _calc_tier(u: Dict[str, Any]) -> str:
    """Compute the highest tier the user currently holds.
    Mirrors the logic in server._get_tier so admin can display it.
    """
    ents = u.get("entitlements") or {}
    if (u.get("username") or "").lower() in FOUNDER_USERNAMES:
        return FOUNDER_TIER
    if (ents.get("ultra") or {}).get("active"):
        return "pro_plus"  # legacy migration
    if (ents.get("pro_plus") or {}).get("active"):
        return "pro_plus"
    if (ents.get("pro") or {}).get("active"):
        return "pro"
    return "free"


def _clean_user(u: Dict[str, Any]) -> Dict[str, Any]:
    codes = u.get("recovery_codes", []) or []
    remaining = sum(1 for c in codes if c.get("used_at") is None)
    return {
        "user_id": u.get("user_id"),
        "username": u.get("username"),
        "created_at": (u.get("created_at").isoformat() if u.get("created_at") else None),
        "updated_at": (u.get("updated_at").isoformat() if u.get("updated_at") else None),
        "provider": u.get("provider", "username"),
        "tier": _calc_tier(u),
        "entitlements": u.get("entitlements", {}) or {},
        "recovery_codes": {"remaining": remaining, "total": len(codes)},
    }


def _generate_recovery_codes(n: int = 8) -> tuple[list[str], list[dict[str, Any]]]:
    alphabet = string.ascii_uppercase + string.digits
    plain: list[str] = []
    stored: list[dict[str, Any]] = []
    for _ in range(n):
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        plain.append(f"{raw[:4]}-{raw[4:]}")
        stored.append({"hash": _hash_password(raw), "used_at": None})
    return plain, stored


def create_admin_router(db) -> APIRouter:
    router = APIRouter(prefix="/admin", tags=["admin"])

    async def require_admin(x_admin_password: Optional[str] = Header(None)) -> None:
        expected = (os.environ.get("ADMIN_PASSWORD") or "").strip()
        if not expected:
            raise HTTPException(status_code=503, detail="Admin non configurato (ADMIN_PASSWORD mancante)")
        if not x_admin_password or x_admin_password != expected:
            raise HTTPException(status_code=401, detail="Password admin non valida")

    async def _count_for(user_id: str) -> Dict[str, int]:
        dishes = await db.dishes.count_documents({"user_id": user_id})
        plans = await db.weekly_plans.count_documents({"user_id": user_id})
        shopping = await db.shopping_items.count_documents({"user_id": user_id})
        fridge = await db.fridge_items.count_documents({"user_id": user_id})
        sessions = await db.user_sessions.count_documents({"user_id": user_id})
        return {"dishes": dishes, "weekly_plans": plans, "shopping_items": shopping, "fridge_items": fridge, "active_sessions": sessions}

    @router.get("/users")
    async def list_users(
        username: Optional[str] = Query(None, description="Case-insensitive username substring filter"),
        tier: Optional[str] = Query(None, description="Filter by exact tier: free|pro|pro_plus"),
        _: None = Depends(require_admin),
    ) -> List[Dict[str, Any]]:
        # Base Mongo filter — username substring is applied with a regex.
        q: Dict[str, Any] = {}
        if username:
            q["username"] = {"$regex": username.strip(), "$options": "i"}
        rows = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(2000)
        out: List[Dict[str, Any]] = []
        for u in rows:
            base = _clean_user(u)
            if tier and base["tier"] != tier:
                continue
            base["counts"] = await _count_for(u["user_id"])
            out.append(base)
        return out

    @router.get("/users/{user_id}")
    async def get_user(user_id: str, _: None = Depends(require_admin)) -> Dict[str, Any]:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        base = _clean_user(u)
        base["counts"] = await _count_for(user_id)
        # Include the full preferences blob (no sensitive info) for admin edit UIs.
        base["preferences"] = u.get("preferences") or {}
        return base

    @router.get("/users/{user_id}/dishes")
    async def user_dishes(user_id: str, _: None = Depends(require_admin)) -> List[Dict[str, Any]]:
        rows = await db.dishes.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = r["created_at"].isoformat()
        return rows

    @router.get("/users/{user_id}/fridge")
    async def user_fridge(user_id: str, _: None = Depends(require_admin)) -> List[Dict[str, Any]]:
        rows = await db.fridge_items.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = r["created_at"].isoformat()
        return rows

    @router.post("/users/{user_id}/password")
    async def reset_password(user_id: str, body: AdminResetPasswordBody, _: None = Depends(require_admin)) -> Dict[str, Any]:
        if len(body.new_password) < 6:
            raise HTTPException(400, "Password troppo corta (min 6 caratteri)")
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"password_hash": _hash_password(body.new_password), "updated_at": _now()}},
        )
        await db.user_sessions.delete_many({"user_id": user_id})
        return {"ok": True, "user_id": user_id}

    @router.patch("/users/{user_id}/username")
    async def change_username(user_id: str, body: AdminChangeUsernameBody, _: None = Depends(require_admin)) -> Dict[str, Any]:
        new = (body.new_username or "").strip().lower()
        if not (3 <= len(new) <= 30) or not all(c.isalnum() or c in "._" for c in new):
            raise HTTPException(400, "Username non valido (3-30 caratteri alfanumerici, `.` o `_`)")
        # Enforce uniqueness
        clash = await db.users.find_one({"username": new, "user_id": {"$ne": user_id}})
        if clash:
            raise HTTPException(409, "Username già in uso")
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"username": new, "updated_at": _now()}},
        )
        return {"ok": True, "user_id": user_id, "username": new}

    @router.patch("/users/{user_id}/preferences")
    async def patch_preferences(user_id: str, body: AdminPatchPrefsBody, _: None = Depends(require_admin)) -> Dict[str, Any]:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        prefs = u.get("preferences") or {}
        payload = body.dict(exclude_none=True)
        for k, v in payload.items():
            if isinstance(v, dict) and isinstance(prefs.get(k), dict):
                # Merge dicts (notifications, defaults) instead of overwriting.
                merged = dict(prefs.get(k) or {})
                merged.update(v)
                prefs[k] = merged
            else:
                prefs[k] = v
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"preferences": prefs, "updated_at": _now()}},
        )
        return {"ok": True, "user_id": user_id, "preferences": prefs}

    @router.post("/users/{user_id}/recovery-codes/reset")
    async def reset_recovery_codes(user_id: str, _: None = Depends(require_admin)) -> Dict[str, Any]:
        """Regenerate 8 new recovery codes. Old ones become invalid.
        Returns the plaintext codes only ONCE (never stored plain)."""
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        plain, stored = _generate_recovery_codes(8)
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"recovery_codes": stored, "updated_at": _now()}},
        )
        return {"ok": True, "user_id": user_id, "recovery_codes": plain}

    @router.delete("/users/{user_id}/sessions")
    async def invalidate_sessions(user_id: str, _: None = Depends(require_admin)) -> Dict[str, Any]:
        res = await db.user_sessions.delete_many({"user_id": user_id})
        return {"ok": True, "user_id": user_id, "removed_sessions": res.deleted_count}

    @router.delete("/users/{user_id}")
    async def delete_user(user_id: str, _: None = Depends(require_admin)) -> Dict[str, Any]:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        removed = {
            "dishes": (await db.dishes.delete_many({"user_id": user_id})).deleted_count,
            "weekly_plans": (await db.weekly_plans.delete_many({"user_id": user_id})).deleted_count,
            "shopping_items": (await db.shopping_items.delete_many({"user_id": user_id})).deleted_count,
            "fridge_items": (await db.fridge_items.delete_many({"user_id": user_id})).deleted_count,
            "user_sessions": (await db.user_sessions.delete_many({"user_id": user_id})).deleted_count,
            "notification_states": (await db.notification_states.delete_many({"user_id": user_id})).deleted_count,
        }
        await db.users.delete_one({"user_id": user_id})
        return {"ok": True, "user_id": user_id, "removed": removed}

    @router.post("/users/{user_id}/entitlements/{tier}")
    async def set_tier_entitlement(
        user_id: str, tier: str, body: AdminEntitlementBody, _: None = Depends(require_admin)
    ) -> Dict[str, Any]:
        """Grant or revoke a specific tier (`pro`, `pro_plus`)."""
        if tier not in ("pro", "pro_plus"):
            raise HTTPException(400, "Unknown tier")
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        if body.active:
            entry = {"active": True, "source": "admin_grant", "reason": body.reason or "", "granted_at": _now()}
        else:
            entry = {"active": False, "source": "admin_grant", "reason": body.reason or "", "revoked_at": _now()}
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {f"entitlements.{tier}": entry, "updated_at": _now()}},
        )
        return {"ok": True, "user_id": user_id, "tier": tier, "entitlements": {tier: entry}}

    @router.get("/stats")
    async def stats(_: None = Depends(require_admin)) -> Dict[str, Any]:
        users = await db.users.count_documents({})
        dishes = await db.dishes.count_documents({})
        plans = await db.weekly_plans.count_documents({})
        shopping = await db.shopping_items.count_documents({})
        fridge = await db.fridge_items.count_documents({})
        sessions = await db.user_sessions.count_documents({})
        # Tier breakdown
        tier_counts = {"free": 0, "pro": 0, "pro_plus": 0}
        async for u in db.users.find({}, {"_id": 0, "username": 1, "entitlements": 1}):
            tier_counts[_calc_tier(u)] = tier_counts.get(_calc_tier(u), 0) + 1
        since = _now().replace(microsecond=0)
        from datetime import timedelta as _td
        since_7 = since - _td(days=7)
        new_last_7 = await db.users.count_documents({"created_at": {"$gte": since_7}})
        return {
            "users": users,
            "new_users_last_7d": new_last_7,
            "by_tier": tier_counts,
            "dishes": dishes,
            "weekly_plans": plans,
            "shopping_items": shopping,
            "fridge_items": fridge,
            "active_sessions": sessions,
            "generated_at": since.isoformat(),
        }

    @router.get("/export")
    async def export_full(_: None = Depends(require_admin)) -> Dict[str, Any]:
        """Full DB dump (JSON). Excludes password hashes and recovery codes."""
        users = await db.users.find({}, {"_id": 0, "password_hash": 0, "recovery_codes": 0}).to_list(5000)
        for u in users:
            if u.get("created_at"):
                u["created_at"] = u["created_at"].isoformat()
            if u.get("updated_at"):
                u["updated_at"] = u["updated_at"].isoformat()
            u["tier"] = _calc_tier(u)
        dishes = await db.dishes.find({}, {"_id": 0}).to_list(20000)
        for d in dishes:
            if d.get("created_at"):
                d["created_at"] = d["created_at"].isoformat()
        plans = await db.weekly_plans.find({}, {"_id": 0}).to_list(20000)
        shopping = await db.shopping_items.find({}, {"_id": 0}).to_list(50000)
        for it in shopping:
            if it.get("created_at"):
                it["created_at"] = it["created_at"].isoformat()
        fridge = await db.fridge_items.find({}, {"_id": 0}).to_list(20000)
        for it in fridge:
            if it.get("created_at"):
                it["created_at"] = it["created_at"].isoformat()
        return {
            "app": "Planibble",
            "kind": "admin-export",
            "version": 2,
            "exported_at": _now().isoformat(),
            "users": users,
            "dishes": dishes,
            "weekly_plans": plans,
            "shopping_items": shopping,
            "fridge_items": fridge,
        }

    @router.get("/export.csv")
    async def export_csv(_: None = Depends(require_admin)) -> PlainTextResponse:
        """CSV listing of users + usage counts + tier."""
        rows = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(5000)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["user_id", "username", "tier", "created_at", "provider", "dishes", "weekly_plans", "shopping_items", "fridge_items", "active_sessions", "recovery_codes_remaining"])
        for u in rows:
            uid = u.get("user_id", "")
            c = await _count_for(uid)
            created = u.get("created_at").isoformat() if u.get("created_at") else ""
            codes = u.get("recovery_codes", []) or []
            remaining = sum(1 for x in codes if x.get("used_at") is None)
            w.writerow([
                uid,
                u.get("username", ""),
                _calc_tier(u),
                created,
                u.get("provider", "username"),
                c["dishes"],
                c["weekly_plans"],
                c["shopping_items"],
                c["fridge_items"],
                c["active_sessions"],
                remaining,
            ])
        return PlainTextResponse(content=buf.getvalue(), media_type="text/csv")

    return router
