"""
🌐 Auth Module — Nova API Client (Centralized Bot Bridge)
═══════════════════════════════════════════════════════════
Sends OTP to the central RobovAI Nova server so the Telegram bot
(@robovainova_bot) can deliver it to the user.

Usage:
    from auth_module.nova_client import nova_client
    await nova_client.push_otp("user@example.com", "123456")
    verified = await nova_client.check_verified("user@example.com")
"""

import logging
from typing import Optional, Dict, Any

try:
    import httpx
except ImportError:
    httpx = None  # Will raise clear error on first use

from .config import auth_settings

logger = logging.getLogger("auth_module.nova_client")


class NovaClient:
    """HTTP client for communicating with the central RobovAI Nova API."""

    def __init__(self):
        self.base_url = (auth_settings.NOVA_API_URL or "").rstrip("/")
        self.api_key = auth_settings.NOVA_API_KEY or ""

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _headers(self) -> dict:
        return {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
        }

    async def push_otp(
        self,
        email: str,
        code: str,
        app_id: str = "default",
        minutes: int = 10,
    ) -> Dict[str, Any]:
        """Push OTP to Nova so the centralized Telegram bot can deliver it.

        Args:
            email: User email (must match what user enters in the bot)
            code: The 6-digit OTP code (generated locally)
            app_id: Identifier for your app (for Nova logging)
            minutes: OTP validity in minutes

        Returns:
            {"status": "success", "bot": "@robovainova_bot"} on success
            {"status": "error", "detail": "..."} on failure
        """
        if not self.is_configured:
            logger.warning("Nova API not configured — OTP will only work locally")
            return {"status": "skipped", "detail": "NOVA_API_URL not configured"}

        if httpx is None:
            logger.error("httpx not installed — pip install httpx")
            return {"status": "error", "detail": "httpx package required"}

        url = f"{self.base_url}/api/external/push-otp"
        payload = {
            "email": email.strip().lower(),
            "code": code,
            "app_id": app_id,
            "minutes": minutes,
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(url, json=payload, headers=self._headers())

                if resp.status_code == 200:
                    data = resp.json()
                    logger.info(f"✅ OTP pushed to Nova for {email}")
                    return data
                else:
                    detail = resp.text[:200]
                    logger.error(
                        f"❌ Nova push-otp failed [{resp.status_code}]: {detail}"
                    )
                    return {"status": "error", "detail": detail}

        except httpx.ConnectError:
            logger.error(f"❌ Cannot reach Nova at {self.base_url}")
            return {"status": "error", "detail": "Cannot connect to Nova server"}
        except Exception as e:
            logger.error(f"❌ Nova push-otp exception: {e}")
            return {"status": "error", "detail": str(e)}

    async def check_verified(self, email: str) -> bool:
        """Check if the user verified via the centralized Telegram bot.

        Returns True if the user successfully received and confirmed the OTP
        through @robovainova_bot.
        """
        if not self.is_configured:
            return False

        if httpx is None:
            return False

        url = f"{self.base_url}/api/external/check-verified"
        params = {"email": email.strip().lower()}

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    url, params=params, headers=self._headers()
                )

                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("verified", False)
                else:
                    logger.warning(f"Nova check-verified [{resp.status_code}]")
                    return False

        except Exception as e:
            logger.error(f"Nova check-verified error: {e}")
            return False


# Singleton
nova_client = NovaClient()
