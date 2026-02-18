import asyncio
import os
import random
from datetime import datetime, timedelta
import requests

from flask import Blueprint, jsonify, make_response, request

from .database import auth_db
from .security import create_access_token, decode_access_token, validate_password_strength
from .config import auth_settings


auth_blueprint = Blueprint("auth_blueprint", __name__)


def _run(coro):
    return asyncio.run(coro)


def _extract_token_from_request():
    auth_header = request.headers.get("Authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()

    cookie_value = request.cookies.get("access_token", "").strip()
    if cookie_value.lower().startswith("bearer "):
        return cookie_value.split(" ", 1)[1].strip()
    return cookie_value or None


def _get_current_user_or_error():
    token = _extract_token_from_request()
    if not token:
        return None, (jsonify({"detail": "غير مصرح — سجّل دخولك أولاً"}), 401)

    payload = decode_access_token(token)
    if not payload:
        return None, (jsonify({"detail": "جلسة منتهية — سجّل دخولك مرة أخرى"}), 401)

    email = payload.get("sub", "")
    user = _run(auth_db.get_user_by_email(email))
    if not user:
        return None, (jsonify({"detail": "المستخدم غير موجود"}), 401)

    return user, None


def _is_production():
    return bool(os.getenv("RENDER") or os.getenv("ENVIRONMENT", "").lower() == "production")


def _use_central_auth():
    return (auth_settings.AUTH_MODE or "local").strip().lower() == "central"


def _proxy_error(message: str):
    return jsonify({"detail": message}), 503


def _proxy_to_nova(method: str, path: str, *, json_body=None, form_body=None, params=None):
    nova_url = (auth_settings.NOVA_API_URL or "").rstrip("/")
    if not nova_url:
        return None, None, _proxy_error("Central auth is enabled but NOVA_API_URL is missing")

    url = f"{nova_url}{path}"
    headers = {"Accept": "application/json", "X-App-ID": auth_settings.APP_ID}

    auth_header = request.headers.get("Authorization", "").strip()
    token = _extract_token_from_request()
    if auth_header:
        headers["Authorization"] = auth_header
    elif token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        resp = requests.request(
            method=method.upper(),
            url=url,
            json=json_body,
            data=form_body,
            params=params,
            headers=headers,
            timeout=auth_settings.AUTH_PROXY_TIMEOUT_SECONDS,
        )
    except requests.RequestException:
        return None, None, _proxy_error("تعذر الاتصال بخدمة التوثيق المركزية (Nova)")

    payload = None
    try:
        payload = resp.json()
    except Exception:
        payload = {"detail": (resp.text or "").strip() or "Nova error"}

    return payload, resp.status_code, None


@auth_blueprint.post("/signup")
def signup():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    full_name = (data.get("full_name") or "").strip()
    phone = (data.get("phone") or "").strip() or None

    if _use_central_auth():
        payload, status_code, error = _proxy_to_nova(
            "POST",
            "/auth/register",
            json_body={
                "email": email,
                "password": password,
                "full_name": full_name,
            },
        )
        if error:
            return error
        return jsonify(payload), status_code

    valid, message = validate_password_strength(password)
    if not valid:
        return jsonify({"detail": message}), 400

    if "@" not in email or "." not in email:
        return jsonify({"detail": "البريد الإلكتروني غير صحيح"}), 400

    if not full_name:
        return jsonify({"detail": "الاسم الكامل مطلوب"}), 400

    created_user = _run(auth_db.create_user(email, password, full_name, phone=phone))
    if not created_user:
        return jsonify({"detail": "البريد الإلكتروني مسجل بالفعل"}), 400

    otp_code = str(random.randint(100000, 999999))
    _run(auth_db.store_otp(created_user["id"], otp_code, "telegram_verify", minutes=10))

    try:
        from .config import auth_settings
        from .nova_client import nova_client

        if nova_client.is_configured:
            _run(
                nova_client.push_otp(
                    email=email,
                    code=otp_code,
                    app_id=auth_settings.APP_ID,
                    minutes=10,
                )
            )
    except Exception:
        pass

    return jsonify(
        {
            "status": "pending_verification",
            "message": "تم إنشاء الحساب! فعّل حسابك عبر تليجرام بوت @robovainova_bot ← /verify",
            "user": created_user,
        }
    )


@auth_blueprint.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username_from_json = (data.get("username") or data.get("email") or "").strip()
    password_from_json = data.get("password") or ""

    username_from_form = (request.form.get("username") or "").strip()
    password_from_form = request.form.get("password") or ""

    username = username_from_json or username_from_form
    password = password_from_json or password_from_form

    if _use_central_auth():
        if not username or not password:
            return jsonify({"detail": "بيانات تسجيل الدخول غير مكتملة"}), 400

        payload, status_code, error = _proxy_to_nova(
            "POST",
            "/auth/login",
            form_body={"username": username, "password": password},
        )
        if error:
            return error

        response = make_response(jsonify(payload), status_code)
        access_token = (payload or {}).get("access_token")
        if access_token and status_code == 200:
            response.set_cookie(
                key="access_token",
                value=f"Bearer {access_token}",
                httponly=True,
                secure=_is_production(),
                max_age=86400,
                samesite="Lax",
            )
        return response

    if not username or not password:
        return jsonify({"detail": "بيانات تسجيل الدخول غير مكتملة"}), 400

    user = _run(auth_db.authenticate_user(username, password))
    if not user:
        return jsonify({"detail": "البريد الإلكتروني أو كلمة المرور غير صحيحة"}), 401

    if not user.get("is_verified"):
        return jsonify(
            {
                "detail": "الحساب غير مُفعّل. افتح بوت @robovainova_bot في تليجرام وأرسل /verify"
            }
        ), 403

    access_token = create_access_token(data={"sub": user["email"]})
    expires_at = (datetime.now() + timedelta(days=1)).isoformat()
    _run(auth_db.create_session(user["id"], access_token, expires_at))

    response = make_response(
        jsonify({"access_token": access_token, "token_type": "bearer"})
    )
    response.set_cookie(
        key="access_token",
        value=f"Bearer {access_token}",
        httponly=True,
        secure=_is_production(),
        max_age=86400,
        samesite="Lax",
    )
    return response


@auth_blueprint.post("/logout")
def logout():
    if _use_central_auth():
        payload, status_code, error = _proxy_to_nova("POST", "/auth/logout")
        if error:
            return error
        response = make_response(jsonify(payload), status_code)
        response.delete_cookie("access_token")
        return response

    token = request.cookies.get("access_token", "")
    if token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()

    if token:
        _run(auth_db.delete_session(token))

    response = make_response(jsonify({"status": "success"}))
    response.delete_cookie("access_token")
    return response


@auth_blueprint.get("/me")
def me():
    if _use_central_auth():
        payload, status_code, error = _proxy_to_nova("GET", "/auth/me")
        if error:
            return error
        return jsonify(payload), status_code

    user, error_response = _get_current_user_or_error()
    if error_response:
        return error_response

    return jsonify(
        {
            "id": user["id"],
            "email": user["email"],
            "full_name": user.get("full_name", ""),
            "role": user.get("role", "user"),
            "balance": user.get("balance", 0),
        }
    )


@auth_blueprint.post("/request-otp")
def request_otp():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"detail": "البريد الإلكتروني مطلوب"}), 400

    if _use_central_auth():
        payload, status_code, error = _proxy_to_nova(
            "POST", "/auth/request-otp", json_body={"email": email}
        )
        if error:
            return error
        return jsonify(payload), status_code

    user = _run(auth_db.get_user_by_email_unverified(email))
    if not user:
        return jsonify({"detail": "لم يتم العثور على حساب بهذا البريد"}), 404

    if user.get("is_verified"):
        return jsonify({"status": "already_verified", "message": "الحساب مفعّل بالفعل ✅"})

    otp_code = str(random.randint(100000, 999999))
    _run(auth_db.store_otp(user["id"], otp_code, "telegram_verify", minutes=10))

    try:
        from .config import auth_settings
        from .nova_client import nova_client

        if nova_client.is_configured:
            _run(
                nova_client.push_otp(
                    email=email,
                    code=otp_code,
                    app_id=auth_settings.APP_ID,
                    minutes=10,
                )
            )
    except Exception:
        pass

    return jsonify(
        {
            "status": "success",
            "message": "تم إنشاء كود التحقق. افتح بوت RobovAI في تليجرام وأرسل /verify",
        }
    )


@auth_blueprint.post("/verify-otp")
def verify_otp():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    code = (data.get("code") or "").strip()

    if not email or not code:
        return jsonify({"detail": "email و code مطلوبان"}), 400

    if _use_central_auth():
        payload, status_code, error = _proxy_to_nova(
            "POST",
            "/auth/verify-otp",
            json_body={"email": email, "code": code},
        )
        if error:
            return error

        response = make_response(jsonify(payload), status_code)
        access_token = (payload or {}).get("access_token")
        if access_token and status_code == 200:
            response.set_cookie(
                key="access_token",
                value=f"Bearer {access_token}",
                httponly=True,
                secure=_is_production(),
                max_age=86400,
                samesite="Lax",
            )
        return response

    user = _run(auth_db.get_user_by_email_unverified(email))
    if not user:
        return jsonify({"detail": "المستخدم غير موجود"}), 404

    if user.get("is_verified"):
        return jsonify({"status": "already_verified", "message": "الحساب مفعّل بالفعل ✅"})

    valid = _run(auth_db.verify_otp(user["id"], code, "telegram_verify"))
    if not valid:
        return jsonify({"detail": "كود التحقق غير صحيح أو منتهي الصلاحية"}), 400

    _run(auth_db.set_user_verified(user["id"]))

    access_token = create_access_token(data={"sub": email})
    expires_at = (datetime.now() + timedelta(days=1)).isoformat()
    _run(auth_db.create_session(user["id"], access_token, expires_at))

    response = make_response(
        jsonify(
            {
                "status": "success",
                "message": "تم تفعيل الحساب بنجاح! ✅",
                "access_token": access_token,
                "user": {
                    "id": user["id"],
                    "email": email,
                    "full_name": user.get("full_name", ""),
                },
            }
        )
    )
    response.set_cookie(
        key="access_token",
        value=f"Bearer {access_token}",
        httponly=True,
        secure=_is_production(),
        max_age=86400,
        samesite="Lax",
    )
    return response


@auth_blueprint.get("/check-verified")
def check_verified():
    email = (request.args.get("email") or "").strip().lower()
    if not email:
        return jsonify({"detail": "email مطلوب"}), 400

    if _use_central_auth():
        payload, status_code, error = _proxy_to_nova(
            "GET", "/auth/check-verified", params={"email": email}
        )
        if error:
            return error
        return jsonify(payload), status_code

    user = _run(auth_db.get_user_by_email_unverified(email))
    if not user:
        return jsonify({"detail": "المستخدم غير موجود"}), 404

    if user.get("is_verified"):
        return jsonify({"verified": True})

    try:
        from .nova_client import nova_client

        if nova_client.is_configured:
            remote_verified = _run(nova_client.check_verified(email))
            if remote_verified:
                _run(auth_db.set_user_verified(user["id"]))
                return jsonify({"verified": True})
    except Exception:
        pass

    return jsonify({"verified": False})


@auth_blueprint.delete("/delete-account")
def delete_account():
    if _use_central_auth():
        data = request.get_json(silent=True) or {}
        payload, status_code, error = _proxy_to_nova(
            "DELETE",
            "/account",
            json_body={"confirm": data.get("confirm", "")},
        )
        if error:
            return error
        response = make_response(jsonify(payload), status_code)
        if status_code == 200:
            response.delete_cookie("access_token")
        return response

    user, error_response = _get_current_user_or_error()
    if error_response:
        return error_response

    _run(auth_db.delete_user_account(user["id"]))
    response = make_response(
        jsonify({"status": "success", "message": "تم حذف الحساب نهائياً"})
    )
    response.delete_cookie("access_token")
    return response
