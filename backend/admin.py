"""Admin router for PlanEat.

All endpoints are protected by a single admin password sent via the
`X-Admin-Password` HTTP header, matching ADMIN_PASSWORD in the environment.

Endpoints (all under /api/admin):
- GET    /users                    List users with usage stats
- GET    /users/{user_id}          Full user detail (dishes/plans/shopping counts)
- POST   /users/{user_id}/password Reset user password
- DELETE /users/{user_id}          Delete a user AND all their data (dishes,
                                    plans, shopping items, sessions).
- GET    /stats                    Global usage stats
- GET    /export                   Full DB snapshot as JSON
- GET    /export.csv               Users list as CSV

Notes:
- Password hashes are NEVER returned. Recovery codes are counted only.
- Deletions are permanent (hard delete) — the frontend guards behind
  a confirmation.
"""
from __future__ import annotations

import io
import csv
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel


class AdminResetPasswordBody(BaseModel):
    new_password: str


class AdminEntitlementBody(BaseModel):
    active: bool
    reason: Optional[str] = None


def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_user(u: Dict[str, Any]) -> Dict[str, Any]:
    """Public-safe view of a user document."""
    codes = u.get("recovery_codes", []) or []
    remaining = sum(1 for c in codes if c.get("used_at") is None)
    return {
        "user_id": u.get("user_id"),
        "username": u.get("username"),
        "created_at": (u.get("created_at").isoformat() if u.get("created_at") else None),
        "updated_at": (u.get("updated_at").isoformat() if u.get("updated_at") else None),
        "provider": u.get("provider", "username"),
        "recovery_codes": {"remaining": remaining, "total": len(codes)},
    }


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
        sessions = await db.user_sessions.count_documents({"user_id": user_id})
        return {"dishes": dishes, "weekly_plans": plans, "shopping_items": shopping, "active_sessions": sessions}

    @router.get("/users")
    async def list_users(_: None = Depends(require_admin)) -> List[Dict[str, Any]]:
        rows = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(2000)
        out: List[Dict[str, Any]] = []
        for u in rows:
            base = _clean_user(u)
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
        return base

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
        # Invalidate all sessions of the affected user for safety
        await db.user_sessions.delete_many({"user_id": user_id})
        return {"ok": True, "user_id": user_id}

    @router.delete("/users/{user_id}")
    async def delete_user(user_id: str, _: None = Depends(require_admin)) -> Dict[str, Any]:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        removed = {
            "dishes": (await db.dishes.delete_many({"user_id": user_id})).deleted_count,
            "weekly_plans": (await db.weekly_plans.delete_many({"user_id": user_id})).deleted_count,
            "shopping_items": (await db.shopping_items.delete_many({"user_id": user_id})).deleted_count,
            "user_sessions": (await db.user_sessions.delete_many({"user_id": user_id})).deleted_count,
        }
        await db.users.delete_one({"user_id": user_id})
        return {"ok": True, "user_id": user_id, "removed": removed}

    @router.post("/users/{user_id}/entitlements/pro")
    async def set_pro_entitlement(
        user_id: str, body: AdminEntitlementBody, _: None = Depends(require_admin)
    ) -> Dict[str, Any]:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Utente non trovato")
        if body.active:
            entry = {"active": True, "source": "admin_grant", "reason": body.reason or "", "granted_at": _now()}
        else:
            entry = {"active": False, "source": "admin_grant", "reason": body.reason or "", "revoked_at": _now()}
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"entitlements.pro": entry, "updated_at": _now()}},
        )
        return {"ok": True, "user_id": user_id, "entitlements": {"pro": entry}}

    @router.post("/users/{user_id}/entitlements/{tier}")
    async def set_tier_entitlement(
        user_id: str, tier: str, body: AdminEntitlementBody, _: None = Depends(require_admin)
    ) -> Dict[str, Any]:
        """Grant or revoke a specific tier (`pro`, `pro_plus`).

        Higher tiers do NOT auto-activate lower ones — the frontend checks a
        hierarchy at read time (Pro+ > Pro > Free). Setting `active`
        to False on a higher tier will fall the user back to the next lowest
        tier they still hold entitlement for.
        """
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
        sessions = await db.user_sessions.count_documents({})
        # Users created in last 7 days
        since = _now().replace(microsecond=0)
        from datetime import timedelta as _td
        since_7 = since - _td(days=7)
        new_last_7 = await db.users.count_documents({"created_at": {"$gte": since_7}})
        return {
            "users": users,
            "new_users_last_7d": new_last_7,
            "dishes": dishes,
            "weekly_plans": plans,
            "shopping_items": shopping,
            "active_sessions": sessions,
            "generated_at": since.isoformat(),
        }

    @router.get("/export")
    async def export_full(_: None = Depends(require_admin)) -> Dict[str, Any]:
        """Full DB dump (JSON). Excludes password hashes and session tokens."""
        users = await db.users.find({}, {"_id": 0, "password_hash": 0, "recovery_codes": 0}).to_list(5000)
        for u in users:
            if u.get("created_at"):
                u["created_at"] = u["created_at"].isoformat()
            if u.get("updated_at"):
                u["updated_at"] = u["updated_at"].isoformat()
        dishes = await db.dishes.find({}, {"_id": 0}).to_list(20000)
        for d in dishes:
            if d.get("created_at"):
                d["created_at"] = d["created_at"].isoformat()
        plans = await db.weekly_plans.find({}, {"_id": 0}).to_list(20000)
        shopping = await db.shopping_items.find({}, {"_id": 0}).to_list(50000)
        for it in shopping:
            if it.get("created_at"):
                it["created_at"] = it["created_at"].isoformat()
        return {
            "app": "PlanEat",
            "kind": "admin-export",
            "version": 1,
            "exported_at": _now().isoformat(),
            "users": users,
            "dishes": dishes,
            "weekly_plans": plans,
            "shopping_items": shopping,
        }

    @router.get("/export.csv")
    async def export_csv(_: None = Depends(require_admin)) -> PlainTextResponse:
        """Simple CSV listing of users + usage counts."""
        rows = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(5000)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["user_id", "username", "created_at", "provider", "dishes", "weekly_plans", "shopping_items", "active_sessions", "recovery_codes_remaining"])
        for u in rows:
            uid = u.get("user_id", "")
            c = await _count_for(uid)
            created = u.get("created_at").isoformat() if u.get("created_at") else ""
            codes = u.get("recovery_codes", []) or []
            remaining = sum(1 for x in codes if x.get("used_at") is None)
            w.writerow([
                uid,
                u.get("username", ""),
                created,
                u.get("provider", "username"),
                c["dishes"],
                c["weekly_plans"],
                c["shopping_items"],
                c["active_sessions"],
                remaining,
            ])
        return PlainTextResponse(content=buf.getvalue(), media_type="text/csv")

    return router
