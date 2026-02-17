"""
🔑 Auth Module — Security (JWT + Password Hashing)
═══════════════════════════════════════════════════
Standalone version — no external dependencies except pyjwt + passlib.
"""

from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import jwt
from passlib.context import CryptContext
import os
import secrets
import re

from .config import auth_settings

# ─── JWT Secret ────────────────────────────────────────────────
_SECRET_FILE = os.path.join(os.path.dirname(__file__), ".jwt_secret")


def _load_or_create_secret() -> str:
    """Load JWT secret from env or file. Creates one if missing."""
    env = auth_settings.JWT_SECRET_KEY
    if env and len(env) >= 32:
        return env

    # Production guard
    is_production = (
        os.getenv("RENDER") or os.getenv("ENVIRONMENT", "").lower() == "production"
    )
    if is_production:
        import sys

        print(
            "❌ CRITICAL: JWT_SECRET_KEY not set (min 32 chars). "
            "Sessions will break on redeploy!",
            file=sys.stderr,
        )
        return secrets.token_urlsafe(64)

    # Dev fallback — persist to file
    if os.path.exists(_SECRET_FILE):
        with open(_SECRET_FILE, "r") as f:
            stored = f.read().strip()
            if len(stored) >= 32:
                return stored

    new_secret = secrets.token_urlsafe(64)
    try:
        with open(_SECRET_FILE, "w") as f:
            f.write(new_secret)
    except Exception:
        pass
    return new_secret


SECRET_KEY = _load_or_create_secret()
ALGORITHM = auth_settings.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES

# ─── Password Hashing ─────────────────────────────────────────
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def verify_password_and_update(
    plain_password: str, hashed_password: str
) -> tuple[bool, str | None]:
    """Verify password and optionally return an upgraded hash."""
    try:
        ok, new_hash = pwd_context.verify_and_update(plain_password, hashed_password)
        return bool(ok), new_hash
    except Exception:
        return False, None


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def validate_password_strength(password: str) -> tuple[bool, str]:
    """Check password meets minimum requirements:
    8+ chars, at least 1 letter, 1 digit, 1 special character."""
    if len(password) < 8:
        return False, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"
    if not re.search(r"[A-Za-z]", password):
        return False, "كلمة المرور يجب أن تحتوي على حرف واحد على الأقل"
    if not re.search(r"[0-9]", password):
        return False, "كلمة المرور يجب أن تحتوي على رقم واحد على الأقل"
    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':",./<>?]', password):
        return False, "كلمة المرور يجب أن تحتوي على رمز خاص واحد على الأقل (!@#$%...)"
    return True, ""


# ─── JWT Tokens ────────────────────────────────────────────────
def create_access_token(
    data: Dict[str, Any], expires_delta: Optional[timedelta] = None
) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
