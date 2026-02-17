"""
🗄️ Auth Module — Database Layer (SQLite)
═══════════════════════════════════════════
Standalone users/sessions/OTP database.
"""

import sqlite3
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

from .security import get_password_hash, verify_password_and_update
from .config import auth_settings

DB_PATH = auth_settings.DATABASE_PATH
logger = logging.getLogger("auth_module.database")


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


class AuthDatabase:
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DB_PATH
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        """Initialize SQLite database with users, sessions, OTP tables."""
        with self._get_conn() as conn:
            c = conn.cursor()

            # Users Table
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    full_name TEXT,
                    password_hash TEXT NOT NULL,
                    phone TEXT,
                    role TEXT DEFAULT 'user',
                    balance INTEGER DEFAULT 100,
                    daily_used INTEGER DEFAULT 0,
                    daily_reset_date TEXT,
                    subscription_tier TEXT DEFAULT 'free',
                    subscription_expires TEXT,
                    is_verified INTEGER DEFAULT 0,
                    telegram_chat_id TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Safe migrations for existing DBs
            for col, defn in [
                ("role", "TEXT DEFAULT 'user'"),
                ("daily_used", "INTEGER DEFAULT 0"),
                ("daily_reset_date", "TEXT"),
                ("subscription_tier", "TEXT DEFAULT 'free'"),
                ("subscription_expires", "TEXT"),
                ("updated_at", "TIMESTAMP"),
                ("is_verified", "INTEGER DEFAULT 0"),
                ("telegram_chat_id", "TEXT"),
                ("phone", "TEXT"),
            ]:
                try:
                    c.execute(f"ALTER TABLE users ADD COLUMN {col} {defn}")
                except sqlite3.OperationalError:
                    pass

            # Sessions Table
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    token TEXT UNIQUE,
                    expires_at TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """
            )

            # OTP Codes Table
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS otp_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    code TEXT,
                    purpose TEXT,
                    expires_at TIMESTAMP,
                    used INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Indexes
            for idx in [
                "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
                "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)",
                "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
                "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)",
                "CREATE INDEX IF NOT EXISTS idx_otp_user_purpose ON otp_codes(user_id, purpose, expires_at)",
            ]:
                c.execute(idx)

            conn.commit()
            logger.info("✅ Auth database initialized")

    # ═══════════════════════════════════════════════════════════════
    # 👤 USER CRUD
    # ═══════════════════════════════════════════════════════════════

    async def create_user(
        self,
        email: str,
        password: str,
        full_name: str,
        phone: str = None,
        role: str = "user",
    ) -> Optional[Dict[str, Any]]:
        try:
            email = _normalize_email(email)
            password_hash = get_password_hash(password)
            today = datetime.now().strftime("%Y-%m-%d")
            with self._get_conn() as conn:
                c = conn.cursor()
                c.execute(
                    """INSERT INTO users (email, password_hash, full_name, phone, role, balance, daily_used, daily_reset_date)
                       VALUES (?, ?, ?, ?, ?, 100, 0, ?)""",
                    (email, password_hash, full_name, phone, role, today),
                )
                conn.commit()
                return {
                    "id": c.lastrowid,
                    "email": email,
                    "full_name": full_name,
                    "role": role,
                    "balance": 100,
                }
        except sqlite3.IntegrityError:
            return None
        except Exception as e:
            logger.exception(f"create_user error: {e}")
            raise

    async def authenticate_user(
        self, email: str, password: str
    ) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(
                "SELECT * FROM users WHERE lower(email) = lower(?)",
                (_normalize_email(email),),
            )
            user = c.fetchone()
            if not user:
                return None

            ok, new_hash = verify_password_and_update(password, user["password_hash"])
            if not ok:
                return None

            if new_hash:
                try:
                    c.execute(
                        "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (new_hash, user["id"]),
                    )
                    conn.commit()
                except Exception:
                    pass

            return dict(user)
        return None

    async def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(
                "SELECT id, email, full_name, role, balance, daily_used, subscription_tier "
                "FROM users WHERE lower(email) = lower(?)",
                (_normalize_email(email),),
            )
            user = c.fetchone()
            return dict(user) if user else None

    async def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(
                "SELECT id, email, full_name, role, balance, daily_used, subscription_tier "
                "FROM users WHERE id = ?",
                (user_id,),
            )
            user = c.fetchone()
            return dict(user) if user else None

    async def get_user_by_email_unverified(
        self, email: str
    ) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(
                "SELECT id, email, full_name, is_verified FROM users WHERE lower(email) = lower(?)",
                (_normalize_email(email),),
            )
            user = c.fetchone()
            return dict(user) if user else None

    async def get_user_by_telegram_or_phone(
        self, telegram_chat_id: str, phone: str
    ) -> Optional[Dict[str, Any]]:
        """Find user by Telegram chat ID or phone number."""
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            c.execute(
                "SELECT id, email, full_name, is_verified FROM users WHERE telegram_chat_id = ?",
                (telegram_chat_id,),
            )
            user = c.fetchone()
            if user:
                return dict(user)

            # Try phone
            phone_clean = phone.lstrip("+")
            c.execute(
                "SELECT id, email, full_name, is_verified FROM users "
                "WHERE phone = ? OR phone = ? OR phone = ?",
                (phone, "+" + phone_clean, phone_clean),
            )
            user = c.fetchone()
            return dict(user) if user else None

    async def delete_user_account(self, user_id: int) -> bool:
        with self._get_conn() as conn:
            c = conn.cursor()
            uid = str(user_id)
            c.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            c.execute("DELETE FROM otp_codes WHERE user_id = ?", (uid,))
            c.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
            return c.rowcount > 0

    # ═══════════════════════════════════════════════════════════════
    # 🔑 SESSION MANAGEMENT
    # ═══════════════════════════════════════════════════════════════

    async def create_session(self, user_id: int, token: str, expires_at: str):
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute(
                "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
                (user_id, token, expires_at),
            )
            conn.commit()

    async def get_session(self, token: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM sessions WHERE token = ?", (token,))
            row = c.fetchone()
            return dict(row) if row else None

    async def delete_session(self, token: str):
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()

    async def cleanup_expired_sessions(self):
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute(
                "DELETE FROM sessions WHERE expires_at < ?",
                (datetime.now().isoformat(),),
            )
            conn.commit()

    # ═══════════════════════════════════════════════════════════════
    # 📲 OTP / VERIFICATION
    # ═══════════════════════════════════════════════════════════════

    async def set_user_verified(
        self, user_id: int, telegram_chat_id: str = None
    ) -> bool:
        with self._get_conn() as conn:
            c = conn.cursor()
            if telegram_chat_id:
                c.execute(
                    "UPDATE users SET is_verified = 1, telegram_chat_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (telegram_chat_id, user_id),
                )
            else:
                c.execute(
                    "UPDATE users SET is_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (user_id,),
                )
            conn.commit()
            return c.rowcount > 0

    async def store_otp(
        self,
        user_id: int,
        code: str,
        purpose: str = "telegram_verify",
        minutes: int = 10,
    ):
        expires_at = (datetime.now() + timedelta(minutes=minutes)).isoformat()
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute(
                "UPDATE otp_codes SET used = 1 WHERE user_id = ? AND purpose = ? AND used = 0",
                (str(user_id), purpose),
            )
            c.execute(
                "INSERT INTO otp_codes (user_id, code, purpose, expires_at) VALUES (?, ?, ?, ?)",
                (str(user_id), code, purpose, expires_at),
            )
            conn.commit()

    async def verify_otp(
        self, user_id: int, code: str, purpose: str = "telegram_verify"
    ) -> bool:
        now = datetime.now().isoformat()
        with self._get_conn() as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(
                "SELECT id FROM otp_codes WHERE user_id = ? AND code = ? AND purpose = ? "
                "AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1",
                (str(user_id), code, purpose, now),
            )
            row = c.fetchone()
            if not row:
                return False
            c.execute("UPDATE otp_codes SET used = 1 WHERE id = ?", (row["id"],))
            conn.commit()
            return True

    async def cleanup_expired_otps(self):
        with self._get_conn() as conn:
            c = conn.cursor()
            c.execute(
                "DELETE FROM otp_codes WHERE used = 1 OR expires_at < ?",
                (datetime.now().isoformat(),),
            )
            deleted = c.rowcount
            conn.commit()
            return deleted


# Singleton
auth_db = AuthDatabase()
