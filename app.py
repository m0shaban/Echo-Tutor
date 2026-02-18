import logging
import os
import time
import json
import random
import tempfile
from collections import defaultdict
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    Response,
    stream_with_context,
)
from openai import OpenAI
from config import Config
from flask_cors import CORS

try:
    from auth_module.flask_auth_routes import auth_blueprint
except Exception:
    auth_blueprint = None

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


def is_rate_limited(ip):
    now = time.time()
    window = 60
    limit = app.config.get("RATE_LIMIT", 30)
    rate_limits[ip] = [t for t in rate_limits[ip] if now - t < window]
    if len(rate_limits[ip]) >= limit:
        return True
    rate_limits[ip].append(now)
    return False


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
    exercises_path = os.path.join(app.static_folder, "data", "exercises.json")
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
            return (
                f"You are playing the role of {scenario_config['ai_role']}. "
                f"The user is {scenario_config['user_role']}. "
                f"Stay in character throughout the conversation. "
                f"If the user makes language mistakes, gently correct them while staying in character. "
                f"Respond naturally as your character would.\n\n"
                f"LANGUAGE: Speak in {lang_name}.\n"
                f"DIFFICULTY: {level_config['label']} — {level_config['description']}.\n"
                f"DO NOT use emoji symbols. Speak naturally. Keep responses concise (2-4 sentences).\n"
                f"You MAY use **bold** for emphasis.\n"
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
    return (
        jsonify(
            {
                "status": "ok",
                "uptime_seconds": uptime,
                "provider": Config.AI_PROVIDER,
                "model": Config.MODEL_NAME,
                "ai_available": get_client() is not None,
                "whisper_available": whisper_available,
                "whisper_sdk_available": whisper_sdk_available,
                "whisper_keys_configured": whisper_keys_configured,
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
            except:
                pass
        return jsonify({"error": str(e)}), 500


# ─── Chat (non-streaming) ───
@app.route("/chat", methods=["POST"])
def chat():
    client = get_client()
    if not client:
        return jsonify({"error": "AI service is currently unavailable."}), 503

    if is_rate_limited(request.remote_addr):
        return jsonify({"error": "Too many requests. Please slow down."}), 429

    data = request.json or {}
    history = data.get("history", [])
    level = data.get("level", "intermediate")
    topic = data.get("topic", "free")
    language = data.get("language", "en")
    scenario = data.get("scenario", None)

    if not history:
        return (
            jsonify({"response": get_welcome_message(topic, language, scenario)}),
            200,
        )

    level_config = Config.DIFFICULTY_LEVELS.get(
        level, Config.DIFFICULTY_LEVELS["intermediate"]
    )
    system_prompt = build_system_prompt(level, topic, language, scenario)
    messages_payload = [{"role": "system", "content": system_prompt}] + history

    try:
        completion = client.chat.completions.create(
            model=Config.MODEL_NAME,
            messages=messages_payload,
            temperature=level_config["temperature"],
            top_p=0.95,
            max_tokens=level_config["max_tokens"],
            stream=False,
        )
        return jsonify({"response": completion.choices[0].message.content})
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

    if is_rate_limited(request.remote_addr):
        return jsonify({"error": "Too many requests. Please slow down."}), 429

    data = request.json or {}
    history = data.get("history", [])
    level = data.get("level", "intermediate")
    topic = data.get("topic", "free")
    language = data.get("language", "en")
    scenario = data.get("scenario", None)

    if not history:
        welcome = get_welcome_message(topic, language, scenario)

        def welcome_gen():
            yield f"data: {json.dumps({'token': welcome})}\n\n"
            yield "data: [DONE]\n\n"

        return Response(
            stream_with_context(welcome_gen()), content_type="text/event-stream"
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

    return Response(stream_with_context(generate()), content_type="text/event-stream")


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
    language = data.get("language", "en")

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
        raw = completion.choices[0].message.content.strip()
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


def get_welcome_message(topic="free", language="en", scenario=None):
    lang_config = Config.LANGUAGES.get(language, Config.LANGUAGES["en"])

    if scenario:
        scenario_config = next(
            (s for s in Config.SCENARIOS if s["id"] == scenario), None
        )
        if scenario_config:
            return scenario_config["opening"]

    if topic == "free":
        return lang_config["welcome"]

    topic_config = next(
        (t for t in Config.TOPICS if t["id"] == topic), Config.TOPICS[0]
    )
    return f"{lang_config['welcome']} {topic_config['prompt']} Ready to start?"


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=Config.FLASK_DEBUG)
