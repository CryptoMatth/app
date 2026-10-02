"""
RevenueCat purchases routes for Planibble.

Two endpoints:

1. POST /api/purchases/sync (authenticated)
   Called by the client immediately after `purchasePackage` / `restorePurchases`
   returns updated CustomerInfo. Grants the reported entitlements
   *optimistically* so the UI unlocks without waiting for the webhook. The
   source is tagged "client_sync" so the webhook can later overwrite/verify.
   NOT the authoritative source — never trust unsigned client-reported
   entitlements for high-value operations.

2. POST /api/integrations/revenuecat/webhook (server-to-server, HMAC verified)
   Fired by RevenueCat after Google Play validates the transaction.
   Authoritative source of truth. Idempotent via `event.id` unique index.

Environment variables (backend/.env):

    RC_WEBHOOK_AUTH          Random string set on RevenueCat Webhook
                             "Authorization" header. Must match exactly.
    RC_WEBHOOK_HMAC_SECRET   The HMAC secret from the RevenueCat webhook
                             configuration. If empty, HMAC verification is
                             *skipped* (dev/staging only). In production set it.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger("planeat.purchases")


PRODUCT_TO_TIER: Dict[str, str] = {
    # Legacy one-time purchases (kept so old backups still restore).
    "pro_lifetime": "pro",
    "pro_plus_lifetime": "pro_plus",
    "pro_to_pro_plus_upgrade": "pro_plus",
    # New subscription model (oct 2026): a single Google Play subscription
    # id `pro_plus_subscription` with two base plans `monthly` / `annual`.
    # RevenueCat may report the base plan separately — map both forms.
    "pro_plus_subscription": "pro_plus",
    "pro_plus_subscription:monthly": "pro_plus",
    "pro_plus_subscription:annual": "pro_plus",
    "pro_plus_monthly": "pro_plus",
    "pro_plus_annual": "pro_plus",
}

ENTITLEMENT_TO_TIER: Dict[str, str] = {
    "pro": "pro",
    "pro_plus": "pro_plus",
}


def _parse_rc_timestamp(ms: Optional[int]) -> Optional[datetime]:
    """RevenueCat emits timestamps as UNIX ms. Return UTC datetime or None."""
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000.0, tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


class SyncPurchasesBody(BaseModel):
    revenuecat_app_user_id: Optional[str] = None
    entitlements: List[str] = []


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _grant_tier(db, user_id: str, tier: str, source: str, meta: Dict[str, Any]) -> None:
    """Grant `tier` (pro/pro_plus) to the user with an audit trail.

    Known optional fields in `meta` (persisted alongside `active`):
      - expires_at (datetime)    end of current paid period (subscription)
      - will_renew (bool)        True if auto-renew is on
      - product_id, transaction_id, event_id, event_type, …
    """
    if tier not in ("pro", "pro_plus"):
        return
    # Preserve any existing grant metadata (e.g. don't lose granted_at on renewal).
    existing = await db.users.find_one(
        {"user_id": user_id}, {f"entitlements.{tier}": 1, "_id": 0}
    )
    prev = ((existing or {}).get("entitlements") or {}).get(tier) or {}
    granted_at = prev.get("granted_at") or _now_utc()
    entry = {
        "active": True,
        "source": source,
        "granted_at": granted_at,
        "last_event_at": _now_utc(),
        **{k: v for k, v in meta.items() if v is not None},
    }
    # On every grant we clear any previous "revoked" markers.
    entry.setdefault("revoked_at", None)
    entry.setdefault("revoke_reason", None)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {f"entitlements.{tier}": entry, "updated_at": _now_utc()}},
    )


async def _mark_subscription_cancelled(db, user_id: str, tier: str, event_type: str, expires_at: Optional[datetime]) -> None:
    """User disabled auto-renew (CANCELLATION) but hasn't reached end of
    period yet — keep `active=True` so they retain access until `expires_at`.
    Only flip `will_renew=False` and persist the end-of-period timestamp.
    `_get_tier` and the periodic sweep handle the actual downgrade.
    """
    if tier not in ("pro", "pro_plus"):
        return
    patch: Dict[str, Any] = {
        f"entitlements.{tier}.will_renew": False,
        f"entitlements.{tier}.cancel_reason": event_type,
        f"entitlements.{tier}.cancelled_at": _now_utc(),
        "updated_at": _now_utc(),
    }
    if expires_at:
        patch[f"entitlements.{tier}.expires_at"] = expires_at
    await db.users.update_one({"user_id": user_id}, {"$set": patch})


async def _revoke_tier(db, user_id: str, tier: str, reason: str) -> None:
    """Revoke `tier` (used only from webhook on refund/cancellation)."""
    if tier not in ("pro", "pro_plus"):
        return
    await db.users.update_one(
        {"user_id": user_id},
        {
            "$set": {
                f"entitlements.{tier}": {
                    "active": False,
                    "source": "revenuecat_webhook",
                    "revoked_at": _now_utc(),
                    "reason": reason,
                }
            }
        },
    )


def create_purchases_router(db, get_current_user):
    router = APIRouter(prefix="/purchases", tags=["purchases"])

    @router.post("/sync")
    async def sync_purchases(
        body: SyncPurchasesBody,
        current_user: Dict[str, Any] = Depends(get_current_user),
    ) -> Dict[str, Any]:
        """Optimistic client-side sync of RevenueCat entitlements.

        Grants any reported `pro` / `pro_plus` entitlements right away so the
        UI unlocks. The webhook remains the authoritative source and will
        overwrite these with a verified source once RevenueCat notifies us.
        """
        user_id = current_user["user_id"]
        granted: List[str] = []
        for ent in body.entitlements or []:
            tier = ENTITLEMENT_TO_TIER.get(ent)
            if not tier:
                continue
            await _grant_tier(
                db,
                user_id,
                tier,
                source="client_sync",
                meta={
                    "revenuecat_app_user_id": body.revenuecat_app_user_id,
                    "reported_at": _now_utc(),
                },
            )
            granted.append(tier)
        # Persist the RevenueCat App User ID mapping for troubleshooting.
        if body.revenuecat_app_user_id:
            await db.users.update_one(
                {"user_id": user_id},
                {"$set": {"revenuecat_app_user_id": body.revenuecat_app_user_id}},
            )
        return {"ok": True, "granted": granted}

    return router


def create_revenuecat_webhook_router(db):
    """Separate router mounted at /api/integrations/revenuecat because the
    prefix is not /purchases."""
    router = APIRouter(prefix="/integrations/revenuecat", tags=["revenuecat"])

    @router.post("/webhook")
    async def revenuecat_webhook(
        request: Request,
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        # 1. Authenticate the webhook
        expected_auth = (os.environ.get("RC_WEBHOOK_AUTH") or "").strip()
        if not expected_auth:
            raise HTTPException(status_code=503, detail="webhook not configured")
        received = (authorization or "").strip()
        # Support "Bearer <token>" or raw value
        if received.lower().startswith("bearer "):
            received = received[7:].strip()
        if not hmac.compare_digest(received, expected_auth):
            raise HTTPException(status_code=401, detail="invalid authorization")

        raw = await request.body()

        # 2. Optional HMAC signature check (recommended in production)
        secret = (os.environ.get("RC_WEBHOOK_HMAC_SECRET") or "").strip()
        if secret:
            sig_header = request.headers.get("x-revenuecat-webhook-signature", "")
            fields = dict(
                part.split("=", 1) for part in sig_header.split(",") if "=" in part
            )
            try:
                ts = int(fields["t"])
                if abs(time.time() - ts) > 300:
                    raise HTTPException(status_code=401, detail="signature expired")
                signed = f"{ts}.".encode() + raw
                expected_sig = hmac.new(
                    secret.encode(), signed, hashlib.sha256
                ).hexdigest()
                if not hmac.compare_digest(expected_sig, fields.get("v1", "")):
                    raise HTTPException(status_code=401, detail="bad signature")
            except (KeyError, ValueError):
                raise HTTPException(status_code=401, detail="missing signature")

        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="invalid JSON")
        event = payload.get("event", {}) if isinstance(payload, dict) else {}

        event_id = event.get("id")
        if not event_id:
            raise HTTPException(status_code=400, detail="missing event id")

        # 3. Idempotency — ensure the same event is processed at most once
        try:
            await db.revenuecat_events.insert_one(
                {
                    "event_id": event_id,
                    "type": event.get("type"),
                    "product_id": event.get("product_id"),
                    "app_user_id": event.get("app_user_id"),
                    "received_at": _now_utc(),
                    "raw": event,
                }
            )
        except Exception as exc:
            # Duplicate key means we've already processed this event.
            if exc.__class__.__name__ == "DuplicateKeyError":
                return {"ok": True, "duplicate": True}
            logger.exception("RevenueCat webhook DB insert failed")
            raise

        app_user_id = event.get("app_user_id") or ""
        if not app_user_id or app_user_id.startswith("$RCAnonymousID:"):
            return {"ok": True, "ignored": "anonymous"}

        user = await db.users.find_one({"user_id": app_user_id})
        if not user:
            # RevenueCat App User ID must equal our internal user_id. If it
            # doesn't we still 200 to avoid RevenueCat retries.
            logger.warning("RevenueCat event for unknown user_id=%s", app_user_id)
            return {"ok": True, "unknown_user": True}

        event_type = event.get("type") or ""
        entitlements = set(event.get("entitlement_ids") or [])
        product_id = event.get("product_id")
        transaction_id = event.get("transaction_id")
        # RevenueCat includes `expiration_at_ms` for subscription events —
        # it marks the end of the currently paid period. Lifetime products
        # don't have one.
        expires_at_dt = _parse_rc_timestamp(event.get("expiration_at_ms"))
        purchased_at_dt = _parse_rc_timestamp(event.get("purchased_at_ms"))

        grant_events = {
            "INITIAL_PURCHASE",
            "NON_RENEWING_PURCHASE",
            "RENEWAL",
            "PRODUCT_CHANGE",
            "TRANSFER",
            "UNCANCELLATION",
        }
        # CANCELLATION / BILLING_ISSUE / SUBSCRIPTION_PAUSED do NOT revoke
        # immediately — Play Store policy requires we keep the user on the
        # paid tier until `expires_at` passes. We just flag `will_renew=False`.
        cancellation_events = {"CANCELLATION", "SUBSCRIPTION_PAUSED", "BILLING_ISSUE"}
        # EXPIRATION fires when the period actually ended → hard revoke.
        hard_revoke_events = {"EXPIRATION"}
        refund_events = {"REFUND"}

        if event_type in grant_events:
            # Compute the highest tier this event grants.
            tier = None
            if "pro_plus" in entitlements:
                tier = "pro_plus"
            elif "pro" in entitlements:
                tier = "pro"
            else:
                # Fallback: infer from product ID
                tier = PRODUCT_TO_TIER.get(product_id or "", None)
            if tier:
                await _grant_tier(
                    db,
                    user["user_id"],
                    tier,
                    source="revenuecat_webhook",
                    meta={
                        "product_id": product_id,
                        "transaction_id": transaction_id,
                        "event_id": event_id,
                        "event_type": event_type,
                        "expires_at": expires_at_dt,
                        "last_purchased_at": purchased_at_dt,
                        # Any grant event implies the sub is set to auto-renew
                        # at least for now — a later CANCELLATION flips it.
                        "will_renew": True if expires_at_dt else None,
                    },
                )

        elif event_type in cancellation_events:
            # Only mark `will_renew=False`; keep access until expires_at.
            tiers = set()
            for ent in entitlements:
                t = ENTITLEMENT_TO_TIER.get(ent)
                if t:
                    tiers.add(t)
            if product_id and not tiers:
                t = PRODUCT_TO_TIER.get(product_id)
                if t:
                    tiers.add(t)
            for t in tiers:
                await _mark_subscription_cancelled(db, user["user_id"], t, event_type, expires_at_dt)

        elif event_type in refund_events or event_type in hard_revoke_events:
            # Immediate revoke (chargeback / expired paid period).
            tiers_to_revoke = set()
            for ent in entitlements:
                t = ENTITLEMENT_TO_TIER.get(ent)
                if t:
                    tiers_to_revoke.add(t)
            if product_id and not tiers_to_revoke:
                t = PRODUCT_TO_TIER.get(product_id)
                if t:
                    tiers_to_revoke.add(t)
            for t in tiers_to_revoke:
                await _revoke_tier(
                    db, user["user_id"], t, reason=event_type or "refund"
                )

        # TEST and other event types are logged only.
        return {"ok": True}

    return router


async def ensure_revenuecat_indexes(db) -> None:
    """Create the unique index used for webhook idempotency. Safe to call on
    every startup."""
    await db.revenuecat_events.create_index("event_id", unique=True)
