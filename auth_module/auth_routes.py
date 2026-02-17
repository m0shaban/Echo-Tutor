"""
🌐 Auth Module — FastAPI Routes
═══════════════════════════════════════════
Standalone auth router:  signup, login, logout, OTP, verify, me.

Usage:
    from auth_module.auth_routes import auth_router
    app.include_router(auth_router, prefix="/auth", tags=["Auth"])
"""

import os
import random
import logging
from datetime import datetime, timedelta
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

from .models import UserCreate, OTPRequest, OTPVerify
from .security import (
    create_access_token,
    decode_access_token,
    validate_password_strength,
)
from .database import auth_db

logger = logging.getLogger("auth_module.routes")

auth_router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# ─── Dependency: current user ─────────────────────────────────


async def get_current_user(
    token: str = Depends(oauth2_scheme), request: Request = None
):
    """Extract current user from JWT (cookie or Authorization header)."""
    # Try cookie first
    if (not token) and request:
        cookie_val = request.cookies.get("access_token")
        if cookie_val:
            token = (
                cookie_val.split(" ")[-1]
                if cookie_val.startswith("Bearer ")
                else cookie_val
            )

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="غير مصرح — سجّل دخولك أولاً",
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="جلسة منتهية — سجّل دخولك مرة أخرى")

    user = await auth_db.get_user_by_email(payload.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="المستخدم غير موجود")
    return user


# ═══════════════════════════════════════════════════════════════
# 📝 SIGNUP
# ═══════════════════════════════════════════════════════════════


@auth_router.post("/signup")
async def register(user: UserCreate):
    """Register a new user — account needs Telegram OTP verification."""
    valid, msg = validate_password_strength(user.password)
    if not valid:
        raise HTTPException(status_code=400, detail=msg)

    if "@" not in user.email or "." not in user.email:
        raise HTTPException(status_code=400, detail="البريد الإلكتروني غير صحيح")

    res = await auth_db.create_user(
        user.email, user.password, user.full_name, phone=user.phone
    )
    if not res:
        raise HTTPException(status_code=400, detail="البريد الإلكتروني مسجل بالفعل")

    # Generate OTP
    otp = str(random.randint(100000, 999999))
    await auth_db.store_otp(res["id"], otp, "telegram_verify", minutes=10)

    # Push OTP to centralized Nova bot (if configured)
    try:
        from .nova_client import nova_client
        from .config import auth_settings

        if nova_client.is_configured:
            await nova_client.push_otp(
                email=user.email,
                code=otp,
                app_id=auth_settings.APP_ID,
                minutes=10,
            )
    except Exception as e:
        logger.warning(f"Failed to push OTP to Nova (non-critical): {e}")

    return {
        "status": "pending_verification",
        "message": "تم إنشاء الحساب! فعّل حسابك عبر تليجرام بوت @robovainova_bot ← /verify",
        "user": res,
    }


# ═══════════════════════════════════════════════════════════════
# 🔑 LOGIN
# ═══════════════════════════════════════════════════════════════


@auth_router.post("/login")
async def login(response: Response, form_data: OAuth2PasswordRequestForm = Depends()):
    """Login and set session cookie."""
    user = await auth_db.authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="البريد الإلكتروني أو كلمة المرور غير صحيحة",
        )

    if not user.get("is_verified"):
        raise HTTPException(
            status_code=403,
            detail="الحساب غير مُفعّل. افتح بوت @robovainova_bot في تليجرام وأرسل /verify",
        )

    access_token = create_access_token(data={"sub": user["email"]})
    expires_at = (datetime.now() + timedelta(days=1)).isoformat()
    await auth_db.create_session(user["id"], access_token, expires_at)

    _is_prod = os.getenv("RENDER") or os.getenv("ENVIRONMENT") == "production"
    response.set_cookie(
        key="access_token",
        value=f"Bearer {access_token}",
        httponly=True,
        secure=bool(_is_prod),
        max_age=86400,
        samesite="lax",
    )
    return {"access_token": access_token, "token_type": "bearer"}


# ═══════════════════════════════════════════════════════════════
# 🚪 LOGOUT
# ═══════════════════════════════════════════════════════════════


@auth_router.post("/logout")
async def logout(response: Response, request: Request):
    token = request.cookies.get("access_token")
    if token:
        if token.startswith("Bearer "):
            token = token.split(" ")[1]
        await auth_db.delete_session(token)
    response.delete_cookie("access_token")
    return {"status": "success"}


# ═══════════════════════════════════════════════════════════════
# 👤 ME
# ═══════════════════════════════════════════════════════════════


@auth_router.get("/me")
async def read_users_me(current_user: dict = Depends(get_current_user)):
    return {
        "id": current_user["id"],
        "email": current_user["email"],
        "full_name": current_user.get("full_name", ""),
        "role": current_user.get("role", "user"),
        "balance": current_user.get("balance", 0),
    }


# ═══════════════════════════════════════════════════════════════
# 📲 OTP ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@auth_router.post("/request-otp")
async def request_telegram_otp(req: OTPRequest):
    """Generate OTP for an unverified user. They then use /verify in the Telegram bot."""
    email = req.email.strip().lower()
    user = await auth_db.get_user_by_email_unverified(email)
    if not user:
        raise HTTPException(
            status_code=404, detail="لم يتم العثور على حساب بهذا البريد"
        )

    if user.get("is_verified"):
        return {"status": "already_verified", "message": "الحساب مفعّل بالفعل ✅"}

    otp = str(random.randint(100000, 999999))
    await auth_db.store_otp(user["id"], otp, "telegram_verify", minutes=10)

    # Push to centralized Nova bot
    try:
        from .nova_client import nova_client
        from .config import auth_settings

        if nova_client.is_configured:
            await nova_client.push_otp(
                email=email, code=otp, app_id=auth_settings.APP_ID, minutes=10
            )
    except Exception as e:
        logger.warning(f"Failed to push OTP to Nova: {e}")

    return {
        "status": "success",
        "message": "تم إنشاء كود التحقق. افتح بوت RobovAI في تليجرام وأرسل /verify",
    }


@auth_router.post("/verify-otp")
async def verify_otp_endpoint(req: OTPVerify):
    """Verify OTP and activate account."""
    email = req.email.strip().lower()
    user = await auth_db.get_user_by_email_unverified(email)
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    if user.get("is_verified"):
        return {"status": "already_verified", "message": "الحساب مفعّل بالفعل ✅"}

    valid = await auth_db.verify_otp(user["id"], req.code, "telegram_verify")
    if not valid:
        raise HTTPException(
            status_code=400, detail="كود التحقق غير صحيح أو منتهي الصلاحية"
        )

    await auth_db.set_user_verified(user["id"])

    # Auto-login
    access_token = create_access_token(data={"sub": email})
    expires_at = (datetime.now() + timedelta(days=1)).isoformat()
    await auth_db.create_session(user["id"], access_token, expires_at)

    return {
        "status": "success",
        "message": "تم تفعيل الحساب بنجاح! ✅",
        "access_token": access_token,
        "user": {
            "id": user["id"],
            "email": email,
            "full_name": user.get("full_name", ""),
        },
    }


@auth_router.get("/check-verified")
async def check_verified(email: str):
    """Check if a user's account is verified.

    First checks local DB, then polls the centralized Nova bot
    (if configured) and auto-verifies locally when confirmed.
    """
    email = email.strip().lower()
    user = await auth_db.get_user_by_email_unverified(email)
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    if user.get("is_verified"):
        return {"verified": True}

    # Poll Nova centralized bot
    try:
        from .nova_client import nova_client

        if nova_client.is_configured:
            remote_verified = await nova_client.check_verified(email)
            if remote_verified:
                # Auto-verify locally
                await auth_db.set_user_verified(user["id"])
                return {"verified": True}
    except Exception as e:
        logger.warning(f"Nova check-verified poll error: {e}")

    return {"verified": False}


# ═══════════════════════════════════════════════════════════════
# 🗑️ DELETE ACCOUNT
# ═══════════════════════════════════════════════════════════════


@auth_router.delete("/delete-account")
async def delete_account(
    response: Response, current_user: dict = Depends(get_current_user)
):
    """Permanently delete the current user's account."""
    await auth_db.delete_user_account(current_user["id"])
    response.delete_cookie("access_token")
    return {"status": "success", "message": "تم حذف الحساب نهائياً"}
