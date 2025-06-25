import logging
import os
from flask import Flask, render_template, request, jsonify
from openai import OpenAI
from config import Config
from flask_cors import CORS

# --- إعداد التسجيل (Logging) الاحترافي ---
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app)  # دعم CORS لجميع المسارات
app.config.from_object(Config)

# --- إعداد عميل OpenAI باستخدام الإعدادات من config.py ---
try:
    client = OpenAI(
        base_url=app.config['OPENAI_API_BASE_URL'],
        api_key=app.config['NVIDIA_API_KEY'],
    )
except Exception as e:
    logging.critical(f"Failed to initialize OpenAI client: {e}")
    # في تطبيق حقيقي، قد ترغب في إنهاء التطبيق إذا لم يتمكن من الاتصال.
    client = None

# --- الموجه (System Prompt) الخاص بالمدرس ---
SYSTEM_PROMPT = (
    "You are ECHO, a friendly and expert English language tutor. Your goal is to help the user practice and improve their English through natural conversation. "
    "1.  **Engage:** Keep the conversation going by asking follow-up questions. "
    "2.  **Correct Gently:** If the user makes a grammatical mistake, provide a correction in a subtle and encouraging way. Don't correct every single minor error, only ones that affect meaning or sound unnatural. "
    "3.  **Suggest Improvements:** Offer better vocabulary or phrasing. For example, if the user says 'I am happy', you might suggest 'That's great! You could also say, \"I'm delighted\" or \"I'm over the moon\" to express more excitement.' "
    "4.  **Format Corrections:** When you correct or suggest, use this format for clarity: `Suggestion: \"the better phrase\".` or `Correction: \"the correct phrase\".` "
    "5.  **Be Concise:** Keep your responses reasonably short and conversational. Avoid long lectures. "
    "6.  **Adapt:** Adjust the complexity of your language based on the user's proficiency level, which you can infer from their messages."
)


@app.route("/")
def index():
    """عرض الصفحة الرئيسية للتطبيق."""
    return render_template("index.html")


@app.route("/health")
def health():
    """مسار لفحص جاهزية الخادم."""
    return jsonify({"status": "ok"}), 200


@app.route("/chat", methods=["POST"])
def chat():
    """
    معالجة طلبات الدردشة من المستخدم.
    """
    if not client:
        logging.error("OpenAI client is not initialized.")
        return jsonify({"error": "AI service is currently unavailable."}), 503

    data = request.json or {}
    history = data.get("history", [])

    # إذا لم يوجد تاريخ، أرجع رسالة ترحيب افتراضية
    if not history:
        welcome = "Hello! I'm Echo, your English tutor. Let's start a conversation!"
        return jsonify({"response": welcome}), 200

    if not history:
        logging.warning("Received chat request with empty history.")
        return jsonify({"error": "No message provided."}), 400

    user_message = history[-1].get('content', '')
    is_short = len(user_message.strip().split()) <= 2

    messages_payload = [{"role": "system", "content": SYSTEM_PROMPT}] + history

    try:
        completion = client.chat.completions.create(
            model=app.config['MODEL_NAME'],
            messages=messages_payload,
            temperature=0.5 if is_short else 0.7,
            top_p=0.95,
            max_tokens=150 if is_short else 1024,
            stream=False
        )
        ai_response = completion.choices[0].message.content
        logging.info(f"Successfully generated response for user message: '{user_message[:30]}...'")
        return jsonify({"response": ai_response})

    except Exception as e:
        logging.error(f"Error calling NVIDIA API: {e}", exc_info=True)
        return jsonify({"error": "I'm having a little trouble thinking right now. Please try again."}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port)