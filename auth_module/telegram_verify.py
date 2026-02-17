"""
📱 Auth Module — Telegram Verification Bot
═══════════════════════════════════════════
Inline-button driven verification flow with email + phone support.

Usage:
    from auth_module.telegram_verify import create_verify_telegram_app
    telegram_app = create_verify_telegram_app()
"""

import os
import re
import random
import logging

from telegram import (
    Update,
    ReplyKeyboardMarkup,
    KeyboardButton,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
)
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
    ContextTypes,
)

from .config import auth_settings

logger = logging.getLogger("auth_module.telegram")

# ═══════════════════════════════════════════════════════════════
# 📊 STATE
# ═══════════════════════════════════════════════════════════════

VERIFY_STATE: dict = {}
# chat_id -> {"step": ..., "method": "email"|"phone", "email": ..., "user_id": ..., "otp": ...}


# ═══════════════════════════════════════════════════════════════
# ⌨️ KEYBOARDS
# ═══════════════════════════════════════════════════════════════


def _main_keyboard():
    return ReplyKeyboardMarkup(
        [[KeyboardButton("🔐 تفعيل الحساب"), KeyboardButton("ℹ️ مساعدة")]],
        resize_keyboard=True,
        is_persistent=True,
    )


def _verify_method_keyboard():
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("📧 بالإيميل", callback_data="verify_email")],
            [InlineKeyboardButton("📱 برقم الهاتف", callback_data="verify_phone")],
            [InlineKeyboardButton("❌ إلغاء", callback_data="verify_cancel")],
        ]
    )


def _cancel_keyboard():
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("❌ إلغاء التفعيل", callback_data="verify_cancel")],
        ]
    )


def _confirm_otp_keyboard(otp: str):
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    f"📋 نسخ الكود: {otp}", callback_data=f"copy_otp_{otp}"
                )
            ],
            [
                InlineKeyboardButton(
                    f"✅ تأكيد الكود ({otp})", callback_data=f"confirm_otp_{otp}"
                )
            ],
            [InlineKeyboardButton("🔄 كود جديد", callback_data="resend_otp")],
            [InlineKeyboardButton("❌ إلغاء", callback_data="verify_cancel")],
        ]
    )


def _phone_share_keyboard():
    return ReplyKeyboardMarkup(
        [[KeyboardButton("📱 مشاركة رقم الهاتف", request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


# ═══════════════════════════════════════════════════════════════
# 🛡️ SAFE REPLY
# ═══════════════════════════════════════════════════════════════


async def safe_reply(update: Update, text: str, reply_markup=None, parse_mode="HTML"):
    try:
        await update.message.reply_text(
            text, reply_markup=reply_markup, parse_mode=parse_mode
        )
    except Exception as e:
        logger.warning(f"HTML reply failed: {e}")
        try:
            await update.message.reply_text(text, reply_markup=reply_markup)
        except Exception as e2:
            logger.error(f"Reply failed: {e2}")


# ═══════════════════════════════════════════════════════════════
# 🎯 COMMANDS
# ═══════════════════════════════════════════════════════════════


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_name = update.effective_user.first_name or "مستخدم"
    msg = f"""✨ <b>مرحباً {user_name}!</b>

🔐 هذا بوت التفعيل لـ <b>RobovAI Nova</b>.

اضغط الزر لتفعيل حسابك 👇"""

    inline_kb = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("🔐 تفعيل بالإيميل", callback_data="verify_email"),
                InlineKeyboardButton("📱 تفعيل بالهاتف", callback_data="verify_phone"),
            ],
        ]
    )
    await safe_reply(update, msg, reply_markup=_main_keyboard())
    await update.message.reply_text(
        "⚡ اختر طريقة التفعيل:", parse_mode="HTML", reply_markup=inline_kb
    )


async def verify_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = """🔐 <b>تفعيل الحساب</b>

اختر طريقة التفعيل:

📧 <b>بالإيميل</b> — أدخل بريدك واحصل على كود
📱 <b>برقم الهاتف</b> — شارك رقمك

اضغط الزر المناسب 👇"""
    await safe_reply(update, msg, reply_markup=_verify_method_keyboard())


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = """📖 <b>كيفية التفعيل</b>

1️⃣ سجّل حسابك من الموقع
2️⃣ اضغط <b>🔐 تفعيل الحساب</b>
3️⃣ اختر الطريقة (إيميل أو هاتف)
4️⃣ ستحصل على كود — اضغط <b>تأكيد</b>
5️⃣ تم! سجّل دخولك من الموقع ✅"""
    await safe_reply(update, msg, reply_markup=_main_keyboard())


# ═══════════════════════════════════════════════════════════════
# 🔘 CALLBACK QUERY HANDLER
# ═══════════════════════════════════════════════════════════════


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = str(query.message.chat_id)
    data = query.data

    if data == "verify_email":
        VERIFY_STATE[chat_id] = {"step": "awaiting_email", "method": "email"}
        await query.message.reply_text(
            "📧 <b>أدخل بريدك الإلكتروني:</b>\n\n<i>مثال: user@example.com</i>",
            parse_mode="HTML",
            reply_markup=_cancel_keyboard(),
        )

    elif data == "verify_phone":
        VERIFY_STATE[chat_id] = {"step": "awaiting_phone", "method": "phone"}
        await query.message.reply_text(
            "📱 اضغط الزر لمشاركة رقمك 👇\n\n<i>أو اكتب بريدك الإلكتروني</i>",
            parse_mode="HTML",
            reply_markup=_phone_share_keyboard(),
        )

    elif data == "verify_cancel":
        VERIFY_STATE.pop(chat_id, None)
        await query.message.reply_text("❌ تم الإلغاء.", reply_markup=_main_keyboard())

    elif data.startswith("confirm_otp_"):
        otp_code = data.replace("confirm_otp_", "")
        state = VERIFY_STATE.get(chat_id)
        if (
            state
            and state.get("step") == "awaiting_otp"
            and state.get("otp") == otp_code
        ):
            await _do_verify(query.message, chat_id, state, otp_code)
        else:
            await query.message.reply_text(
                "⚠️ انتهت الجلسة. أعد المحاولة بـ /verify", reply_markup=_main_keyboard()
            )

    elif data.startswith("copy_otp_"):
        otp_code = data.replace("copy_otp_", "")
        await query.message.reply_text(
            f"🔑 <b>الكود:</b> <code>{otp_code}</code>\n📋 اضغط لنسخه",
            parse_mode="HTML",
        )

    elif data == "resend_otp":
        state = VERIFY_STATE.get(chat_id)
        if state and state.get("user_id"):
            await _send_otp(query.message, chat_id, state)
        else:
            await query.message.reply_text(
                "⚠️ ابدأ من جديد بـ /verify", reply_markup=_main_keyboard()
            )


# ═══════════════════════════════════════════════════════════════
# 📲 CONTACT (Phone share)
# ═══════════════════════════════════════════════════════════════


async def handle_contact(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    state = VERIFY_STATE.get(chat_id)
    if not state or state.get("method") != "phone":
        return

    contact = update.message.contact
    phone = contact.phone_number if contact else None
    if not phone:
        await safe_reply(update, "⚠️ لم أتلق الرقم. حاول مرة أخرى.")
        return

    phone = re.sub(r"[\s\-()]", "", phone)
    if not phone.startswith("+"):
        phone = "+" + phone

    try:
        from .database import auth_db

        user = await auth_db.get_user_by_telegram_or_phone(chat_id, phone)

        if not user:
            await safe_reply(
                update,
                f"❌ لم يتم العثور على حساب برقم <code>{phone}</code>\n\nجرّب بالإيميل 👇",
                reply_markup=_verify_method_keyboard(),
            )
            VERIFY_STATE.pop(chat_id, None)
            return

        if user.get("is_verified"):
            await safe_reply(
                update, "✅ حسابك مُفعّل بالفعل!", reply_markup=_main_keyboard()
            )
            VERIFY_STATE.pop(chat_id, None)
            return

        state["user_id"] = user["id"]
        state["email"] = user.get("email", "")
        state["phone"] = phone
        VERIFY_STATE[chat_id] = state
        await _send_otp(update.message, chat_id, state)

    except Exception as e:
        logger.error(f"Phone verify error: {e}", exc_info=True)
        await safe_reply(update, "❌ خطأ تقني. حاول مرة أخرى.")
        VERIFY_STATE.pop(chat_id, None)


# ═══════════════════════════════════════════════════════════════
# 💬 TEXT MESSAGE HANDLER
# ═══════════════════════════════════════════════════════════════


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    state = VERIFY_STATE.get(chat_id)
    message = (update.message.text or "").strip()

    # Menu buttons
    if message == "🔐 تفعيل الحساب":
        await verify_command(update, context)
        return
    if message == "ℹ️ مساعدة":
        await help_command(update, context)
        return

    if not state:
        await safe_reply(
            update, "اضغط 🔐 <b>تفعيل الحساب</b> للبدء", reply_markup=_main_keyboard()
        )
        return

    # Cancel
    if message in ("الغاء", "إلغاء", "/cancel", "cancel"):
        VERIFY_STATE.pop(chat_id, None)
        await safe_reply(update, "❌ تم الإلغاء.", reply_markup=_main_keyboard())
        return

    # Awaiting email
    if state["step"] == "awaiting_email":
        email = message.lower()
        if "@" not in email or "." not in email:
            await safe_reply(
                update,
                "⚠️ بريد غير صحيح. حاول مرة أخرى:",
                reply_markup=_cancel_keyboard(),
            )
            return

        try:
            from .database import auth_db

            user = await auth_db.get_user_by_email_unverified(email)

            if not user:
                await safe_reply(
                    update,
                    "❌ لا يوجد حساب بهذا البريد. سجّل من الموقع أولاً.",
                    reply_markup=_verify_method_keyboard(),
                )
                VERIFY_STATE.pop(chat_id, None)
                return

            if user.get("is_verified"):
                await safe_reply(
                    update, "✅ حسابك مُفعّل بالفعل!", reply_markup=_main_keyboard()
                )
                VERIFY_STATE.pop(chat_id, None)
                return

            state["user_id"] = user["id"]
            state["email"] = email
            VERIFY_STATE[chat_id] = state
            await _send_otp(update.message, chat_id, state)

        except Exception as e:
            logger.error(f"Email verify error: {e}", exc_info=True)
            await safe_reply(update, "❌ خطأ تقني.")
            VERIFY_STATE.pop(chat_id, None)
        return

    # Awaiting phone but got text
    if state["step"] == "awaiting_phone":
        email = message.lower()
        if "@" in email and "." in email:
            state["step"] = "awaiting_email"
            state["method"] = "email"
            VERIFY_STATE[chat_id] = state
            await handle_message(update, context)
        else:
            await safe_reply(
                update,
                "📱 اضغط زر مشاركة الرقم أو اكتب بريدك.",
                reply_markup=_phone_share_keyboard(),
            )
        return

    # Awaiting OTP (manual entry)
    if state["step"] == "awaiting_otp":
        code = message.strip()
        if not code.isdigit() or len(code) != 6:
            await safe_reply(
                update,
                "⚠️ الكود 6 أرقام. حاول مرة أخرى:",
                reply_markup=_cancel_keyboard(),
            )
            return
        await _do_verify(update.message, chat_id, state, code)
        return


# ═══════════════════════════════════════════════════════════════
# 🔧 HELPERS
# ═══════════════════════════════════════════════════════════════


async def _send_otp(message, chat_id: str, state: dict):
    try:
        from .database import auth_db

        otp = str(random.randint(100000, 999999))
        await auth_db.store_otp(state["user_id"], otp, "telegram_verify", minutes=10)

        state["otp"] = otp
        state["step"] = "awaiting_otp"
        VERIFY_STATE[chat_id] = state

        msg = f"""✅ <b>تم العثور على الحساب!</b>

📧 {state.get('email', '')}

━━━━━━━━━━━━━━━━━━━━

🔑 <b>كود التحقق:</b> <code>{otp}</code>

⏱️ صلاحية: <b>10 دقائق</b>

اضغط <b>✅ تأكيد</b> للتفعيل الفوري 👇"""

        await message.reply_text(
            msg, parse_mode="HTML", reply_markup=_confirm_otp_keyboard(otp)
        )

    except Exception as e:
        logger.error(f"OTP error: {e}", exc_info=True)
        await message.reply_text("❌ خطأ تقني.")
        VERIFY_STATE.pop(chat_id, None)


async def _do_verify(message, chat_id: str, state: dict, code: str):
    try:
        from .database import auth_db

        valid = await auth_db.verify_otp(state["user_id"], code, "telegram_verify")

        if valid:
            await auth_db.set_user_verified(state["user_id"], telegram_chat_id=chat_id)
            VERIFY_STATE.pop(chat_id, None)
            await message.reply_text(
                "🎉 <b>تم تفعيل حسابك بنجاح!</b>\n\n✅ سجّل دخولك من الموقع الآن.",
                parse_mode="HTML",
                reply_markup=_main_keyboard(),
            )
        else:
            VERIFY_STATE.pop(chat_id, None)
            await message.reply_text(
                "❌ كود غير صحيح أو منتهي. اضغط /verify للمحاولة مرة أخرى.",
                reply_markup=_main_keyboard(),
            )

    except Exception as e:
        logger.error(f"Verify error: {e}", exc_info=True)
        await message.reply_text("❌ خطأ تقني.")
        VERIFY_STATE.pop(chat_id, None)


# ═══════════════════════════════════════════════════════════════
# 🚀 APP FACTORY
# ═══════════════════════════════════════════════════════════════


def create_verify_telegram_app(token: str = None):
    """Create a standalone Telegram bot app for account verification."""
    token = token or auth_settings.TELEGRAM_BOT_TOKEN
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN not set")
        return None

    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("verify", verify_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CallbackQueryHandler(handle_callback))
    app.add_handler(MessageHandler(filters.CONTACT, handle_contact))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("✅ Verification Telegram app created")
    return app
