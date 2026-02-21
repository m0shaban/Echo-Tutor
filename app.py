import logging
import os
import time
import json
import random
import hashlib
import tempfile
from typing import cast
import requests as _http
from openai.types.chat import ChatCompletionMessageParam
from collections import defaultdict
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    Response,
    stream_with_context,
    send_from_directory,
    make_response,
)
from openai import OpenAI
from config import Config
from flask_cors import CORS

try:
    from auth_module.flask_auth_routes import auth_blueprint
except Exception:
    auth_blueprint = None

try:
    from auth_module.security import decode_access_token as _decode_token
except Exception:
    _decode_token = None

# Groq SDK for Whisper
try:
    from groq import Groq

    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False

# --- Logging ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

app = Flask(__name__)
CORS(app)
app.config.from_object(Config)
if auth_blueprint is not None:
    app.register_blueprint(auth_blueprint, url_prefix="/auth")

START_TIME = time.time()

# --- Rate Limiter (in-memory) ---
rate_limits = defaultdict(list)

# --- In-memory response cache (TTL-based) ---
_response_cache: dict = {}  # key -> {"response": ..., "expires_at": float}
CACHE_TTL_SECONDS = 300  # 5 minutes


def _cache_key(*parts: str) -> str:
    """Create a deterministic cache key from multiple parts."""
    raw = "|".join(str(p) for p in parts)
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str):
    """Return cached value or None if missing/expired."""
    entry = _response_cache.get(key)
    if entry and entry["expires_at"] > time.time():
        return entry["value"]
    if key in _response_cache:
        del _response_cache[key]
    return None


def _cache_set(key: str, value, ttl: int = CACHE_TTL_SECONDS):
    """Store value in cache with TTL."""
    # Prune old entries if cache is getting large
    if len(_response_cache) > 500:
        now = time.time()
        expired = [k for k, v in _response_cache.items() if v["expires_at"] <= now]
        for k in expired:
            del _response_cache[k]
    _response_cache[key] = {"value": value, "expires_at": time.time() + ttl}


# --- In-memory leaderboard ---
_leaderboard: dict = {}  # keyed by email (from JWT) or IP


def get_client_ip():
    forwarded = (request.headers.get("X-Forwarded-For", "") or "").strip()
    if forwarded:
        first_ip = forwarded.split(",", 1)[0].strip()
        if first_ip:
            return first_ip

    real_ip = (request.headers.get("X-Real-IP", "") or "").strip()
    if real_ip:
        return real_ip

    return request.remote_addr or "unknown"


def is_rate_limited(ip):
    now = time.time()
    window = 60
    limit = app.config.get("RATE_LIMIT", 30)
    rate_limits[ip] = [t for t in rate_limits[ip] if now - t < window]
    if len(rate_limits[ip]) >= limit:
        return True, limit, 0
    rate_limits[ip].append(now)
    remaining = limit - len(rate_limits[ip])
    return False, limit, remaining


# --- OpenAI Client Factory (supports Groq key rotation) ---
def get_client():
    provider = Config.AI_PROVIDER
    if provider == "groq" and Config.GROQ_API_KEYS:
        api_key = random.choice(Config.GROQ_API_KEYS)
        base_url = Config.PROVIDERS["groq"]["base_url"]
    elif Config.NVIDIA_API_KEY:
        api_key = Config.NVIDIA_API_KEY
        base_url = Config.PROVIDERS["nvidia"]["base_url"]
    else:
        return None
    try:
        return OpenAI(base_url=base_url, api_key=api_key)
    except Exception as e:
        logging.error(f"Failed to create client: {e}")
        return None


# --- Groq Client for Whisper ---
def get_groq_client():
    if not GROQ_AVAILABLE or not Config.GROQ_API_KEYS:
        return None
    try:
        api_key = random.choice(Config.GROQ_API_KEYS)
        return Groq(api_key=api_key)
    except Exception as e:
        logging.error(f"Failed to create Groq client: {e}")
        return None


# Test initial connection
_test_client = get_client()
if _test_client:
    logging.info(f"AI Provider: {Config.AI_PROVIDER} | Model: {Config.MODEL_NAME}")
else:
    logging.warning("No AI provider configured. AI features unavailable.")


# --- Load Exercises ---
EXERCISES = {}
try:
    exercises_path = os.path.join(app.static_folder or "", "data", "exercises.json")
    with open(exercises_path, "r", encoding="utf-8") as f:
        EXERCISES = json.load(f)
    total = sum(len(v) for v in EXERCISES.values())
    logging.info(f"Loaded {total} exercises across {len(EXERCISES)} types")
except Exception as e:
    logging.warning(f"Could not load exercises: {e}")


# --- System Prompt Builder (with language + scenario) ---
def build_system_prompt(
    level="intermediate", topic="free", language="en", scenario=None
):
    level_config = Config.DIFFICULTY_LEVELS.get(
        level, Config.DIFFICULTY_LEVELS["intermediate"]
    )
    lang_config = Config.LANGUAGES.get(language, Config.LANGUAGES["en"])
    lang_name = lang_config["label"]

    # Scenario mode overrides regular topic
    if scenario:
        scenario_config = next(
            (s for s in Config.SCENARIOS if s["id"] == scenario), None
        )
        if scenario_config:
            extra = ""
            if scenario == "ielts_speaking":
                extra = (
                    "\n\nIELTS SPEAKING FORMAT:\n"
                    "- Part 1 (4-5 min): Ask familiar topic questions (hometown, work, hobbies)\n"
                    "- Part 2 (3-4 min): Give a cue card topic, allow 1 min prep, then user speaks 2 min\n"
                    "- Part 3 (4-5 min): Abstract discussion related to Part 2 topic\n"
                    "After each response, give a brief band-score tip (e.g. 'To improve your score, try using more linking words like however, although...')\n"
                    "Give a final band score estimate at the end.\n"
                )
            elif scenario == "toefl_speaking":
                extra = (
                    "\n\nTOEFL SPEAKING FORMAT:\n"
                    "- Independent Task: Opinion question (15s prep, 45s response)\n"
                    "- After each response, give feedback on: Task completion, Delivery, Language use, Topic development\n"
                    "- Estimate a TOEFL speaking score (0-30) after the practice task.\n"
                )
            return (
                f"You are playing the role of {scenario_config['ai_role']}. "
                f"The user is {scenario_config['user_role']}. "
                f"Stay in character throughout the conversation. "
                f"If the user makes language mistakes, gently correct them while staying in character. "
                f"Respond naturally as your character would.\n\n"
                f"LANGUAGE: Speak in {lang_name}.\n"
                f"DIFFICULTY: {level_config['label']} — {level_config['description']}.\n"
                f"DO NOT use emoji symbols. Speak naturally. Keep responses concise (2-4 sentences).\n"
                f"You MAY use **bold** for emphasis.\n" + extra
            )

    topic_config = next(
        (t for t in Config.TOPICS if t["id"] == topic), Config.TOPICS[0]
    )

    base = (
        f"You are {lang_config['tutor_name']}, a friendly and expert {lang_name} language tutor. "
        f"Your goal is to help the user practice and improve their {lang_name} through natural conversation.\n\n"
        "RULES:\n"
        "1. **Engage**: Keep the conversation going by asking follow-up questions.\n"
        "2. **Correct Gently**: If the user makes a grammatical mistake, provide a correction naturally "
        "within the conversation. Don't correct every single minor error, only ones that affect meaning. "
        "Example: 'By the way, instead of X, you could say Y — it sounds more natural.'\n"
        "3. **Suggest Improvements**: Offer better vocabulary or phrasing as part of your natural response.\n"
        "4. **Formatting**: Keep your responses clean and readable. "
        "DO NOT use emoji symbols because the response is read aloud by text-to-speech. "
        "DO NOT use labels like 'Correction:' or 'Suggestion:' — instead weave corrections into your natural reply. "
        "You MAY use **bold** for emphasis on key words.\n"
        "5. **Be Concise**: Keep responses conversational — 2-4 sentences max for simple exchanges.\n"
        "6. **Encourage**: Use positive reinforcement.\n"
        "7. **Sound Human**: Write the way a real friendly tutor would speak.\n"
    )

    level_instruction = (
        f"\n**DIFFICULTY**: {level_config['label']} — {level_config['description']}.\n"
    )
    topic_instruction = (
        f"**TOPIC**: {topic_config['label']} — {topic_config['prompt']}\n"
    )
    lang_instruction = f"**LANGUAGE**: Speak and teach in {lang_name}.\n"

    return base + level_instruction + topic_instruction + lang_instruction


# --- Routes ---
@app.route("/service-worker.js")
def service_worker():
    response = make_response(send_from_directory("static", "service-worker.js"))
    response.headers["Content-Type"] = "application/javascript"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.route("/")
def index():
    return render_template("landing.html")


@app.route("/app")
def app_page():
    return render_template("index.html")


@app.route("/login")
def login_page():
    return render_template("login.html")


@app.route("/signup")
def signup_page():
    return render_template("signup.html")


@app.route("/verify")
def verify_page():
    return render_template("verify.html")


@app.route("/health")
def health():
    uptime = int(time.time() - START_TIME)
    whisper_sdk_available = GROQ_AVAILABLE
    whisper_keys_configured = bool(Config.GROQ_API_KEYS)
    whisper_available = whisper_sdk_available and whisper_keys_configured
    ai_client = get_client()
    return (
        jsonify(
            {
                "status": "ok",
                "uptime_seconds": uptime,
                "uptime_human": f"{uptime // 3600}h {(uptime % 3600) // 60}m",
                "provider": Config.AI_PROVIDER,
                "model": Config.MODEL_NAME,
                "ai_available": ai_client is not None,
                "whisper_available": whisper_available,
                "whisper_sdk_available": whisper_sdk_available,
                "whisper_keys_configured": whisper_keys_configured,
                "cache_entries": len(_response_cache),
                "leaderboard_entries": len(_leaderboard),
                "version": "2.2.0",
            }
        ),
        200,
    )


@app.route("/topics")
def topics():
    return jsonify(
        {
            "topics": Config.TOPICS,
            "levels": {
                k: {"label": v["label"], "description": v["description"]}
                for k, v in Config.DIFFICULTY_LEVELS.items()
            },
            "languages": Config.LANGUAGES,
            "scenarios": Config.SCENARIOS,
            "badges": Config.BADGES,
        }
    )


# ─── Whisper STT Endpoint ───
@app.route("/transcribe", methods=["POST"])
def transcribe():
    """Transcribe audio using Groq Whisper API."""
    groq_client = get_groq_client()
    if not groq_client:
        return jsonify({"error": "Whisper service unavailable"}), 503

    limited, limit, remaining = is_rate_limited(get_client_ip())
    if limited:
        resp = jsonify({"error": "Too many requests. Please slow down."})
        resp.headers["X-RateLimit-Limit"] = str(limit)
        resp.headers["X-RateLimit-Remaining"] = "0"
        resp.headers["Retry-After"] = "60"
        return resp, 429

    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files["audio"]
    language = request.form.get("language", "en")

    try:
        # Save to temp file (Groq needs a file path)
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            audio_file.save(tmp)
            tmp_path = tmp.name

        with open(tmp_path, "rb") as f:
            transcription = groq_client.audio.transcriptions.create(
                file=(os.path.basename(tmp_path), f.read()),
                model="whisper-large-v3-turbo",
                language=language,
                temperature=0,
                response_format="verbose_json",
            )

        os.unlink(tmp_path)  # Clean up

        return jsonify(
            {
                "text": transcription.text,
                "language": getattr(transcription, "language", language),
                "duration": getattr(transcription, "duration", 0),
            }
        )

    except Exception as e:
        logging.error(f"Transcription error: {e}", exc_info=True)
        if "tmp_path" in locals():
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        return jsonify({"error": str(e)}), 500


# ─── Chat (non-streaming) ───
@app.route("/chat", methods=["POST"])
def chat():
    client = get_client()
    if not client:
        return jsonify({"error": "AI service is currently unavailable."}), 503

    limited, limit, remaining = is_rate_limited(get_client_ip())
    if limited:
        resp = jsonify({"error": "Too many requests. Please slow down."})
        resp.headers["X-RateLimit-Limit"] = str(limit)
        resp.headers["X-RateLimit-Remaining"] = "0"
        resp.headers["Retry-After"] = "60"
        return resp, 429

    data = request.json or {}
    history = data.get("history", [])
    level = str(data.get("level", "intermediate"))[:20]
    topic = str(data.get("topic", "free"))[:50]
    language = str(data.get("language", "en"))[:5]
    scenario = data.get("scenario", None)
    user_name = str(data.get("user_name", "") or "").strip()[:60]

    # Input validation & sanitization
    if not isinstance(history, list):
        return jsonify({"error": "Invalid history format"}), 400
    if len(history) > 100:
        history = history[-100:]  # Prevent context flooding
    for msg in history:
        if isinstance(msg, dict) and len(str(msg.get("content", ""))) > 4000:
            msg["content"] = str(msg["content"])[:4000]

    if not history:
        return (
            jsonify(
                {
                    "response": get_welcome_message(
                        topic,
                        language,
                        scenario,
                        user_name=user_name,
                    )
                }
            ),
            200,
        )

    level_config = Config.DIFFICULTY_LEVELS.get(
        level, Config.DIFFICULTY_LEVELS["intermediate"]
    )
    system_prompt = build_system_prompt(level, topic, language, scenario)

    # Check cache for identical conversation state
    last_user_msg = next(
        (m["content"] for m in reversed(history) if m.get("role") == "user"), ""
    )
    cache_key = _cache_key(last_user_msg, level, topic, language, scenario or "")
    cached = _cache_get(cache_key)
    if cached:
        resp = jsonify({"response": cached})
        resp.headers["X-Cache"] = "HIT"
        resp.headers["X-RateLimit-Remaining"] = str(remaining)
        return resp

    messages_payload: list[ChatCompletionMessageParam] = cast(
        list[ChatCompletionMessageParam],
        [{"role": "system", "content": system_prompt}] + history,
    )

    try:
        completion = client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=messages_payload,
            temperature=level_config["temperature"],
            top_p=0.95,
            max_tokens=level_config["max_tokens"],
            stream=False,
        )
        reply = completion.choices[0].message.content
        _cache_set(cache_key, reply)
        resp = jsonify({"response": reply})
        resp.headers["X-Cache"] = "MISS"
        resp.headers["X-RateLimit-Remaining"] = str(remaining)
        return resp
    except Exception as e:
        logging.error(f"Error calling API: {e}", exc_info=True)
        return (
            jsonify({"error": "I'm having trouble right now. Please try again."}),
            500,
        )


# ─── Chat (streaming) ───
@app.route("/chat/stream", methods=["POST"])
def chat_stream():
    client = get_client()
    if not client:
        return jsonify({"error": "AI service is currently unavailable."}), 503

    limited, limit, remaining = is_rate_limited(get_client_ip())
    if limited:
        resp = jsonify({"error": "Too many requests. Please slow down."})
        resp.headers["Retry-After"] = "60"
        return resp, 429

    data = request.json or {}
    history = data.get("history", [])
    level = data.get("level", "intermediate")
    topic = data.get("topic", "free")
    language = data.get("language", "en")
    scenario = data.get("scenario", None)
    user_name = str(data.get("user_name", "") or "").strip()[:60]

    if not history:
        welcome = get_welcome_message(
            topic,
            language,
            scenario,
            user_name=user_name,
        )

        def welcome_gen():
            yield f"data: {json.dumps({'token': welcome})}\n\n"
            yield "data: [DONE]\n\n"

        return Response(
            stream_with_context(welcome_gen()),
            content_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    level_config = Config.DIFFICULTY_LEVELS.get(
        level, Config.DIFFICULTY_LEVELS["intermediate"]
    )
    system_prompt = build_system_prompt(level, topic, language, scenario)
    messages_payload = [{"role": "system", "content": system_prompt}] + history

    def generate():
        try:
            stream_client = get_client()
            if not stream_client:
                yield f"data: {json.dumps({'error': 'AI service unavailable'})}\n\n"
                return

            stream = stream_client.chat.completions.create(
                model=Config.MODEL_NAME,
                messages=messages_payload,
                temperature=level_config["temperature"],
                top_p=0.95,
                max_tokens=level_config["max_tokens"],
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'token': token})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logging.error(f"Streaming error: {e}", exc_info=True)
            yield f"data: {json.dumps({'error': 'Connection interrupted. Please try again.'})}\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Exercises Endpoints ───
@app.route("/exercises")
def get_exercises():
    """Return random exercises filtered by level and type."""
    level = request.args.get("level", "intermediate")
    ex_type = request.args.get("type", "all")
    count = min(int(request.args.get("count", 10)), 20)

    result = []
    types_to_fetch = [ex_type] if ex_type != "all" else list(EXERCISES.keys())

    for t in types_to_fetch:
        if t in EXERCISES:
            filtered = [
                e for e in EXERCISES[t] if e.get("level", "intermediate") == level
            ]
            if not filtered:
                filtered = EXERCISES[t]  # fall back to all levels
            result.extend(filtered)

    random.shuffle(result)
    return jsonify({"exercises": result[:count], "total": len(result)})


@app.route("/exercises/generate", methods=["POST"])
def generate_exercises():
    """AI-generate exercises based on user's past errors."""
    client = get_client()
    if not client:
        return jsonify({"error": "AI unavailable"}), 503

    data = request.json or {}
    errors = data.get("errors", [])
    level = data.get("level", "intermediate")
    _language = data.get("language", "en")  # reserved for future i18n use

    if not errors:
        return jsonify({"error": "No errors provided"}), 400

    errors_text = "\n".join(
        [
            f"- Wrong: '{e.get('wrong','')}' → Right: '{e.get('right','')}'"
            for e in errors[:10]
        ]
    )

    prompt = (
        f"Based on these language mistakes a student made:\n{errors_text}\n\n"
        f"Generate 5 fill-in-the-blank exercises at the {level} level that target these specific error patterns. "
        f"Return ONLY valid JSON array, no other text. Each item should have: "
        f'"q" (question with ___ for blank), "options" (4 choices), "answer" (correct), "explain" (brief explanation). '
        f'Example: {{"q":"She ___ to school.","options":["go","goes","going","gone"],"answer":"goes","explain":"Third person singular."}}'
    )

    try:
        completion = client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=1024,
        )
        raw = (completion.choices[0].message.content or "").strip()
        # Try to parse JSON from response
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        exercises = json.loads(raw)
        return jsonify({"exercises": exercises, "generated": True})
    except Exception as e:
        logging.error(f"Exercise generation error: {e}")
        return jsonify({"error": "Could not generate exercises"}), 500


@app.route("/leaderboard", methods=["GET"])
def get_leaderboard():
    top = sorted(_leaderboard.values(), key=lambda x: x["xp"], reverse=True)[:10]
    return jsonify(top)


@app.route("/leaderboard", methods=["POST"])
def submit_leaderboard():
    data = request.json or {}
    key = get_client_ip()
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer ") and _decode_token:
        token = auth_header.split(" ", 1)[1]
        payload = _decode_token(token)
        if payload:
            key = payload.get("sub", key)
    _leaderboard[key] = {
        "name": str(data.get("name", "Anonymous"))[:40],
        "xp": max(0, int(data.get("xp", 0))),
        "level": max(1, int(data.get("level", 1))),
        "flag": str(data.get("flag", "\U0001f30d"))[:8],
    }
    return jsonify({"ok": True})


@app.route("/story/generate", methods=["POST"])
def generate_story():
    story_client = get_client()
    if not story_client:
        return jsonify({"error": "AI service unavailable"}), 503

    data = request.json or {}
    language = data.get("language", "en")
    level = data.get("level", "intermediate")
    topic = data.get("topic", "daily life")

    # Check cache first
    story_key = _cache_key("story", language, level, topic)
    cached_story = _cache_get(story_key)
    if cached_story:
        return jsonify(cached_story)

    lang_names = {
        "en": "English",
        "fr": "French",
        "es": "Spanish",
        "de": "German",
        "ar": "Arabic",
        "it": "Italian",
        "pt": "Portuguese",
        "ja": "Japanese",
        "zh": "Chinese",
    }
    lang_name = lang_names.get(language, "English")
    word_counts = {"beginner": 80, "intermediate": 130, "advanced": 180}
    wc = word_counts.get(level, 130)
    prompt = (
        f"Write a short {lang_name} story for a {level} language learner about '{topic}'. "
        f"The story MUST be written entirely in {lang_name}. "
        f"Target length: {wc} words. Make it engaging and use common vocabulary. "
        f"Return ONLY a valid JSON object with these exact fields:\n"
        f'  "title": story title in {lang_name}\n'
        f'  "story": the full story text in {lang_name}\n'
        f'  "vocabulary": array of 6 key words, each with "word" (in {lang_name}), '
        f'"translation" (English), "example" (short sentence in {lang_name})\n'
        f'  "image_prompt": vivid 12-word English description of the main scene for AI image generation\n'
        f"No markdown, no extra text — only the JSON object."
    )
    try:
        completion = story_client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.75,
            max_tokens=1400,
        )
        raw = (completion.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip("`").strip()
        story_data = json.loads(raw)
        _cache_set(story_key, story_data, ttl=600)  # cache stories for 10 min
        return jsonify(story_data)
    except json.JSONDecodeError as e:
        logging.error(f"Story JSON parse error: {e} | raw: {raw[:200]}")
        return jsonify({"error": "Story format error. Please try again."}), 500
    except Exception as e:
        logging.error(f"Story generation error: {e}")
        return jsonify({"error": "Could not generate story"}), 500


@app.route("/story/image", methods=["POST"])
def get_story_image():
    """Fetch a relevant image from Unsplash → Pexels → Pollinations fallback chain."""
    data = request.json or {}
    topic = str(data.get("topic", ""))[:60]
    image_prompt = str(data.get("image_prompt", topic))[:80]
    query = topic or image_prompt

    # 1. Unsplash (highest quality, free API)
    if Config.UNSPLASH_ACCESS_KEY:
        try:
            r = _http.get(
                "https://api.unsplash.com/photos/random",
                params={
                    "query": query,
                    "orientation": "landscape",
                    "count": 1,
                    "content_filter": "high",
                },
                headers={"Authorization": f"Client-ID {Config.UNSPLASH_ACCESS_KEY}"},
                timeout=5,
            )
            if r.ok:
                photos = r.json()
                if isinstance(photos, list) and photos:
                    return jsonify(
                        {"url": photos[0]["urls"]["regular"], "source": "unsplash"}
                    )
        except Exception as e:
            logging.warning(f"Unsplash image fetch failed: {e}")

    # 2. Pexels fallback
    if Config.PEXELS_API_KEY:
        try:
            r = _http.get(
                "https://api.pexels.com/v1/search",
                params={"query": query, "per_page": 1, "orientation": "landscape"},
                headers={"Authorization": Config.PEXELS_API_KEY},
                timeout=5,
            )
            if r.ok:
                d = r.json()
                if d.get("photos"):
                    return jsonify(
                        {"url": d["photos"][0]["src"]["large"], "source": "pexels"}
                    )
        except Exception as e:
            logging.warning(f"Pexels image fetch failed: {e}")

    # 3. Signal client to use Pollinations (no server-side key needed)
    return jsonify({"url": None, "source": "pollinations"})


def get_welcome_message(topic="free", language="en", scenario=None, user_name=""):
    lang_config = Config.LANGUAGES.get(language, Config.LANGUAGES["en"])
    safe_name = str(user_name or "").strip()[:40]
    first_name = safe_name.split()[0] if safe_name else ""

    if scenario:
        scenario_config = next(
            (s for s in Config.SCENARIOS if s["id"] == scenario), None
        )
        if scenario_config:
            opening = scenario_config["opening"]
            if first_name:
                return f"{opening} {first_name}, let's begin."
            return opening

    if topic == "free":
        welcome = lang_config["welcome"]
        if first_name:
            return f"{welcome} Nice to meet you, {first_name}."
        return welcome

    topic_config = next(
        (t for t in Config.TOPICS if t["id"] == topic), Config.TOPICS[0]
    )
    if first_name:
        return (
            f"{lang_config['welcome']} {topic_config['prompt']} "
            f"Ready to start, {first_name}?"
        )
    return f"{lang_config['welcome']} {topic_config['prompt']} Ready to start?"


@app.route("/api/status")
def api_status():
    """Detailed status endpoint for monitoring and debugging."""
    now = time.time()
    uptime = int(now - START_TIME)
    active_ips = len(rate_limits)
    cache_live = sum(1 for v in _response_cache.values() if v["expires_at"] > now)
    return jsonify(
        {
            "status": "operational",
            "version": "2.2.0",
            "uptime_seconds": uptime,
            "uptime_human": f"{uptime // 3600}h {(uptime % 3600) // 60}m {uptime % 60}s",
            "ai_provider": Config.AI_PROVIDER,
            "model": Config.MODEL_NAME,
            "ai_available": get_client() is not None,
            "whisper_available": GROQ_AVAILABLE and bool(Config.GROQ_API_KEYS),
            "cache": {
                "total_entries": len(_response_cache),
                "live_entries": cache_live,
                "ttl_seconds": CACHE_TTL_SECONDS,
            },
            "rate_limiter": {
                "tracked_ips": active_ips,
                "limit_per_minute": app.config.get("RATE_LIMIT", 30),
            },
            "leaderboard_entries": len(_leaderboard),
        }
    )


# ─── Vocabulary Suggestion Endpoint ───
@app.route("/vocab/suggest", methods=["POST"])
def vocab_suggest():
    """AI-powered vocabulary suggestions based on topic, level, and language."""
    client = get_client()
    if not client:
        return jsonify({"error": "AI service unavailable"}), 503

    limited, _, _ = is_rate_limited(get_client_ip())
    if limited:
        return jsonify({"error": "Too many requests. Please slow down."}), 429

    data = request.json or {}
    topic = str(data.get("topic", "daily life"))[:100]
    level = str(data.get("level", "intermediate"))
    language = str(data.get("language", "en"))[:5]
    count = min(int(data.get("count", 8)), 15)

    lang_names = {
        "en": "English",
        "fr": "French",
        "es": "Spanish",
        "de": "German",
        "ar": "Arabic",
        "it": "Italian",
    }
    lang_name = lang_names.get(language, "English")

    cache_key = _cache_key("vocab_suggest", topic, level, language, str(count))
    cached = _cache_get(cache_key)
    if cached:
        resp = jsonify(cached)
        resp.headers["X-Cache"] = "HIT"
        return resp

    prompt = (
        f"Generate {count} useful {lang_name} vocabulary words for a {level} learner studying '{topic}'.\n"
        f"Return ONLY a valid JSON array. Each item must have:\n"
        f'  "word": the word in {lang_name}\n'
        f'  "translation": English translation\n'
        f'  "example": short natural sentence using the word in {lang_name}\n'
        f'  "tip": one memory tip or usage note (in English)\n'
        f"No markdown, no extra text — only the JSON array."
    )

    try:
        completion = client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=900,
        )
        raw = (completion.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip("`").strip()
        words = json.loads(raw)
        result = {"words": words, "topic": topic, "level": level, "language": language}
        _cache_set(cache_key, result, ttl=600)
        return jsonify(result)
    except json.JSONDecodeError as e:
        logging.error(f"Vocab suggest JSON parse error: {e}")
        return jsonify({"error": "Could not parse vocabulary. Try again."}), 500
    except Exception as e:
        logging.error(f"Vocab suggest error: {e}")
        return jsonify({"error": "Could not generate vocabulary."}), 500


# ─── Grammar Check Endpoint ───
@app.route("/grammar/check", methods=["POST"])
def grammar_check():
    """Check a sentence or paragraph for grammar errors and return corrections."""
    client = get_client()
    if not client:
        return jsonify({"error": "AI service unavailable"}), 503

    limited, _, _ = is_rate_limited(get_client_ip())
    if limited:
        return jsonify({"error": "Too many requests. Please slow down."}), 429

    data = request.json or {}
    text = str(data.get("text", "")).strip()
    language = str(data.get("language", "en"))[:5]

    if not text:
        return jsonify({"error": "No text provided"}), 400
    if len(text) > 1000:
        return jsonify({"error": "Text too long (max 1000 characters)"}), 400

    lang_names = {
        "en": "English",
        "fr": "French",
        "es": "Spanish",
        "de": "German",
        "ar": "Arabic",
        "it": "Italian",
    }
    lang_name = lang_names.get(language, "English")

    cache_key = _cache_key("grammar", text[:200], language)
    cached = _cache_get(cache_key)
    if cached:
        resp = jsonify(cached)
        resp.headers["X-Cache"] = "HIT"
        return resp

    prompt = (
        f"You are a {lang_name} grammar expert. Analyze this text and return a grammar check report.\n\n"
        f'Text: "{text}"\n\n'
        f"Return ONLY valid JSON with these fields:\n"
        f'  "is_correct": boolean\n'
        f'  "corrected": the fully corrected version (same as input if no errors)\n'
        f'  "errors": array of {{"original": str, "corrected": str, "explanation": str}}\n'
        f'  "score": integer 1-10 (grammar quality)\n'
        f'  "tip": one concise improvement tip\n'
        f"No markdown, no extra text."
    )

    try:
        completion = client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=600,
        )
        raw = (completion.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip("`").strip()
        result = json.loads(raw)
        _cache_set(cache_key, result, ttl=300)
        return jsonify(result)
    except json.JSONDecodeError as e:
        logging.error(f"Grammar check JSON parse error: {e}")
        return jsonify({"error": "Could not parse grammar check response."}), 500
    except Exception as e:
        logging.error(f"Grammar check error: {e}")
        return jsonify({"error": "Grammar check failed. Try again."}), 500


# ─── Pronunciation Tip Endpoint ───
@app.route("/pronunciation/tip", methods=["POST"])
def pronunciation_tip():
    """Get pronunciation tips for a word or phrase."""
    client = get_client()
    if not client:
        return jsonify({"error": "AI service unavailable"}), 503

    limited, _, _ = is_rate_limited(get_client_ip())
    if limited:
        return jsonify({"error": "Too many requests."}), 429

    data = request.json or {}
    word = str(data.get("word", "")).strip()[:100]
    language = str(data.get("language", "en"))[:5]

    if not word:
        return jsonify({"error": "No word provided"}), 400

    cache_key = _cache_key("pron_tip", word.lower(), language)
    cached = _cache_get(cache_key)
    if cached:
        resp = jsonify(cached)
        resp.headers["X-Cache"] = "HIT"
        return resp

    lang_names = {
        "en": "English",
        "fr": "French",
        "es": "Spanish",
        "de": "German",
        "ar": "Arabic",
        "it": "Italian",
    }
    lang_name = lang_names.get(language, "English")

    prompt = (
        f'Give a pronunciation guide for the {lang_name} word or phrase: "{word}".\n'
        f"Return ONLY valid JSON:\n"
        f'  "word": the word\n'
        f'  "ipa": IPA phonetic transcription\n'
        f'  "phonetic": simple phonetic spelling (e.g. SEE-ren-DIP-ih-tee)\n'
        f'  "tips": array of 2-3 short tips for native English speakers to pronounce it correctly\n'
        f'  "similar_sound": an English word that has a similar sound (if applicable)\n'
        f"No markdown, no extra text."
    )

    try:
        completion = client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=400,
        )
        raw = (completion.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip("`").strip()
        result = json.loads(raw)
        _cache_set(cache_key, result, ttl=3600)  # cache 1 hour
        return jsonify(result)
    except Exception as e:
        logging.error(f"Pronunciation tip error: {e}")
        return jsonify({"error": "Could not generate pronunciation tip."}), 500


# ─── Daily Challenge Endpoint ───
@app.route("/challenge/daily", methods=["GET"])
def daily_challenge():
    """Return a daily language challenge based on level and language."""
    level = request.args.get("level", "intermediate")
    language = request.args.get("language", "en")

    client = get_client()
    if not client:
        return jsonify({"error": "AI service unavailable"}), 503

    # Use date as seed for consistent daily challenge
    today = time.strftime("%Y-%m-%d")
    cache_key = _cache_key("daily_challenge", today, level, language)
    cached = _cache_get(cache_key)
    if cached:
        resp = jsonify(cached)
        resp.headers["X-Cache"] = "HIT"
        return resp

    lang_names = {
        "en": "English",
        "fr": "French",
        "es": "Spanish",
        "de": "German",
        "ar": "Arabic",
        "it": "Italian",
    }
    lang_name = lang_names.get(language, "English")

    prompt = (
        f"Create a short daily language challenge for a {level} {lang_name} learner.\n"
        f"Return ONLY valid JSON:\n"
        f'  "title": short catchy title (max 6 words)\n'
        f'  "description": what the learner should do (1-2 sentences)\n'
        f'  "prompt": the exact conversation starter or task prompt to send to the AI tutor\n'
        f'  "xp_reward": integer 15-50 based on difficulty\n'
        f'  "category": one of ["speaking", "vocabulary", "grammar", "roleplay", "pronunciation"]\n'
        f"No markdown, no extra text."
    )

    try:
        completion = client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.8,
            max_tokens=300,
        )
        raw = (completion.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip("`").strip()
        result = json.loads(raw)
        result["date"] = today
        _cache_set(cache_key, result, ttl=86400)  # cache 24 hours
        return jsonify(result)
    except Exception as e:
        logging.error(f"Daily challenge error: {e}")
        return jsonify(
            {
                "title": "Free Talk Practice",
                "description": "Have a natural conversation with your AI tutor.",
                "prompt": "Let's have a natural conversation. Tell me about your day.",
                "xp_reward": 20,
                "category": "speaking",
                "date": today,
            }
        )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=Config.FLASK_DEBUG)
