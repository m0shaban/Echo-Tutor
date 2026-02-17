# 🔐 RobovAI Auth Module — Standalone Package

نظام تسجيل + تسجيل دخول + تفعيل عبر Telegram OTP — جاهز للنقل لأي تطبيق FastAPI.
يدعم **البوت المركزي** (@robovainova_bot) على سيرفر مختلف عبر Nova API.

## الملفات

| ملف                  | الوظيفة                                                     |
| -------------------- | ----------------------------------------------------------- |
| `security.py`        | JWT tokens, password hashing, password validation           |
| `database.py`        | SQLite: users, sessions, OTP, CRUD                          |
| `auth_routes.py`     | FastAPI routes: signup, login, logout, OTP, verify, me      |
| `nova_client.py`     | HTTP client — pushes OTP to Nova for Telegram bot delivery  |
| `telegram_verify.py` | (اختياري) Telegram bot مستقل للتفعيل                         |
| `config.py`          | Settings / environment variables                            |
| `models.py`          | Pydantic request/response models                            |

## الاستخدام السريع (سيرفر مختلف + بوت مركزي)

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from auth_module.auth_routes import auth_router, get_current_user

app = FastAPI(title="My App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth routes: /auth/signup, /auth/login, /auth/logout, /auth/me, etc.
app.include_router(auth_router, prefix="/auth", tags=["Auth"])

# Your app routes...
@app.get("/")
def root():
    return {"app": "running"}
```

## الفلو

```
1. المستخدم يعمل signup → POST /auth/signup
2. auth_module يولّد OTP → يخزنه محلياً + يبعته لـ Nova API
3. المستخدم يروح @robovainova_bot → /verify → يدخل إيميله
4. البوت يلاقي الـ OTP → يبعتهوله عبر تليجرام
5. المستخدم يدخل الـ OTP في الموقع → POST /auth/verify-otp
6. الحساب يتفعّل ✅
```

## المتطلبات

```
fastapi>=0.100.0
uvicorn[standard]
pyjwt>=2.8.0
passlib[bcrypt]>=1.7.4
pydantic-settings>=2.0.0
python-dotenv>=1.0.0
python-multipart>=0.0.6
httpx>=0.25.0
```

## البيئة (.env)

```env
# مطلوب — JWT Secret
JWT_SECRET_KEY=your-secret-key-min-32-chars

# مطلوب — ربط بالبوت المركزي
NOVA_API_URL=https://robovai-nova.onrender.com
NOVA_API_KEY=nova_ext_9f3k7Lm2Xp8qR4vW6yB1cD5eH0jN
APP_ID=my-new-app

# اختياري
DATABASE_PATH=users.db
```

> **ملاحظة:** الـ `NOVA_API_KEY` لازم يكون نفس القيمة الموجودة في `EXTERNAL_API_KEY` على سيرفر Nova.

## Signup Page JavaScript Example

```javascript
// After successful signup, poll for verification
async function pollVerification(email) {
    const interval = setInterval(async () => {
        const res = await fetch(`/auth/check-verified?email=${email}`);
        const data = await res.json();
        if (data.verified) {
            clearInterval(interval);
            alert("✅ تم تفعيل حسابك!");
            window.location.href = "/login";
        }
    }, 3000); // Poll every 3 seconds
}
```

