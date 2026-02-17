"""
📦 Auth Module — Pydantic Models
"""

from pydantic import BaseModel
from typing import Optional


class UserCreate(BaseModel):
    email: str
    password: str
    full_name: str
    phone: Optional[str] = None


class OTPRequest(BaseModel):
    email: str


class OTPVerify(BaseModel):
    email: str
    code: str


class PasswordChange(BaseModel):
    old_password: str
    new_password: str
