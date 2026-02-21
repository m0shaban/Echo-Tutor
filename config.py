import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Application configuration loaded from environment variables."""

    # --- API Keys ---
    NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")

    # Image API keys
    UNSPLASH_ACCESS_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY", "")
    IMGBB_API_KEY = os.environ.get("IMGBB_API_KEY", "")
    POLLINATIONS_API_KEY = os.environ.get("POLLINATIONS_API_KEY", "")

    # Groq keys with rotation support
    GROQ_API_KEYS = [
        k
        for k in [
            os.environ.get("GROQ_API_KEY", ""),
            os.environ.get("GROQ_API_KEY_2", ""),
            os.environ.get("GROQ_API_KEY_3", ""),
            os.environ.get("GROQ_API_KEY_4", ""),
        ]
        if k
    ]

    # Provider selection: "groq" (faster) or "nvidia"
    AI_PROVIDER = os.environ.get("AI_PROVIDER", "groq" if GROQ_API_KEYS else "nvidia")

    # --- Provider-specific settings ---
    PROVIDERS = {
        "groq": {
            "base_url": "https://api.groq.com/openai/v1",
            "model": "llama-3.3-70b-versatile",
        },
        "nvidia": {
            "base_url": "https://integrate.api.nvidia.com/v1",
            "model": "nvidia/llama-3.1-nemotron-nano-4b-v1.1",
        },
    }

    # Active provider config
    OPENAI_API_BASE_URL = PROVIDERS.get(AI_PROVIDER, PROVIDERS["groq"])["base_url"]
    MODEL_NAME = PROVIDERS.get(AI_PROVIDER, PROVIDERS["groq"])["model"]

    # Generation defaults
    MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "1024"))
    TEMPERATURE = float(os.environ.get("TEMPERATURE", "0.7"))

    # Rate limiting (requests per minute per IP)
    RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "30"))

    # Flask
    FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "False").lower() in ["true", "1", "t"]

    # Difficulty levels
    DIFFICULTY_LEVELS = {
        "beginner": {
            "label": "Beginner",
            "description": "Simple vocabulary, short sentences, lots of encouragement",
            "max_tokens": 200,
            "temperature": 0.5,
        },
        "intermediate": {
            "label": "Intermediate",
            "description": "Natural conversation, moderate corrections",
            "max_tokens": 512,
            "temperature": 0.7,
        },
        "advanced": {
            "label": "Advanced",
            "description": "Complex topics, nuanced corrections, idiomatic expressions",
            "max_tokens": 1024,
            "temperature": 0.8,
        },
    }

    # Conversation topics
    TOPICS = [
        {
            "id": "free",
            "label": "Free Talk",
            "icon": "💬",
            "prompt": "Have a natural, open-ended conversation.",
        },
        {
            "id": "travel",
            "label": "Travel",
            "icon": "✈️",
            "prompt": "Discuss travel experiences, destinations, and planning trips.",
        },
        {
            "id": "food",
            "label": "Food & Cooking",
            "icon": "🍳",
            "prompt": "Talk about food, recipes, restaurants, and cooking.",
        },
        {
            "id": "tech",
            "label": "Technology",
            "icon": "💻",
            "prompt": "Discuss technology, gadgets, apps, and digital trends.",
        },
        {
            "id": "movies",
            "label": "Movies & Shows",
            "icon": "🎬",
            "prompt": "Talk about movies, TV shows, actors, and entertainment.",
        },
        {
            "id": "sports",
            "label": "Sports",
            "icon": "⚽",
            "prompt": "Discuss sports, fitness, athletes, and competitions.",
        },
        {
            "id": "work",
            "label": "Work & Career",
            "icon": "💼",
            "prompt": "Practice professional English for interviews and workplace communication.",
        },
        {
            "id": "daily",
            "label": "Daily Life",
            "icon": "🏠",
            "prompt": "Talk about daily routines, hobbies, family, and everyday activities.",
        },
    ]

    # ─── Multi-Language Support ───
    LANGUAGES = {
        "en": {
            "label": "English",
            "flag": "🇬🇧",
            "stt_code": "en-US",
            "tts_code": "en-US",
            "tutor_name": "ECHO",
            "welcome": "Hey there! I'm **Echo**, your English tutor. Let's have a conversation!",
        },
        "ar": {
            "label": "العربية",
            "flag": "🇸🇦",
            "stt_code": "ar-SA",
            "tts_code": "ar-SA",
            "tutor_name": "إيكو",
            "welcome": "مرحباً! أنا **إيكو**، مدرسك للغة العربية. هيا نبدأ المحادثة!",
        },
        "tr": {
            "label": "Türkçe",
            "flag": "🇹🇷",
            "stt_code": "tr-TR",
            "tts_code": "tr-TR",
            "tutor_name": "ECHO",
            "welcome": "Merhaba! Ben **Echo**, Türkçe öğretmeninim. Konuşmaya başlayalım!",
        },
        "fr": {
            "label": "Français",
            "flag": "🇫🇷",
            "stt_code": "fr-FR",
            "tts_code": "fr-FR",
            "tutor_name": "ÉCHO",
            "welcome": "Salut ! Je suis **Écho**, votre tuteur de français. Commençons la conversation !",
        },
        "es": {
            "label": "Español",
            "flag": "🇪🇸",
            "stt_code": "es-ES",
            "tts_code": "es-ES",
            "tutor_name": "ECO",
            "welcome": "¡Hola! Soy **Eco**, tu tutor de español. ¡Empecemos a conversar!",
        },
        "de": {
            "label": "Deutsch",
            "flag": "🇩🇪",
            "stt_code": "de-DE",
            "tts_code": "de-DE",
            "tutor_name": "ECHO",
            "welcome": "Hallo! Ich bin **Echo**, dein Deutsch-Tutor. Lass uns ein Gespräch führen!",
        },
        "it": {
            "label": "Italiano",
            "flag": "🇮🇹",
            "stt_code": "it-IT",
            "tts_code": "it-IT",
            "tutor_name": "ECO",
            "welcome": "Ciao! Sono **Eco**, il tuo tutor di italiano. Iniziamo a conversare!",
        },
        "pt": {
            "label": "Português",
            "flag": "🇧🇷",
            "stt_code": "pt-BR",
            "tts_code": "pt-BR",
            "tutor_name": "ECO",
            "welcome": "Olá! Sou o **Eco**, seu tutor de português. Vamos começar a conversar!",
        },
    }

    # ─── Role-Play Scenarios ───
    SCENARIOS = [
        {
            "id": "ielts_speaking",
            "label": "IELTS Speaking Test",
            "icon": "🎓",
            "description": "Practice IELTS Speaking Parts 1, 2, and 3",
            "ai_role": "an official IELTS examiner conducting a speaking test",
            "user_role": "an IELTS candidate taking the speaking test",
            "opening": "Good morning. My name is Echo. Could you tell me your full name, please? Let's start with Part 1. Let's talk about your hometown.",
        },
        {
            "id": "toefl_speaking",
            "label": "TOEFL Speaking Task",
            "icon": "📝",
            "description": "Practice TOEFL independent and integrated speaking tasks",
            "ai_role": "a TOEFL evaluator assessing spoken responses",
            "user_role": "a TOEFL test taker responding to prompts",
            "opening": "Welcome to the TOEFL speaking practice. For your first task, you will have 15 seconds to prepare and 45 seconds to speak. Do you agree or disagree with the following statement?",
        },
        {
            "id": "job_interview",
            "label": "Job Interview",
            "icon": "👔",
            "description": "Practice a professional job interview",
            "ai_role": "a hiring manager at a tech company conducting a job interview",
            "user_role": "a job candidate being interviewed",
            "opening": "Welcome! Please, have a seat. Tell me a little about yourself and why you're interested in this position.",
        },
        {
            "id": "restaurant",
            "label": "Restaurant Order",
            "icon": "🍽️",
            "description": "Order food and interact at a restaurant",
            "ai_role": "a friendly waiter at an upscale restaurant",
            "user_role": "a customer at a restaurant",
            "opening": "Good evening! Welcome to La Belle Cuisine. Here's your menu. Can I start you off with something to drink?",
        },
        {
            "id": "airport",
            "label": "Airport Check-in",
            "icon": "🛫",
            "description": "Navigate airport check-in and boarding",
            "ai_role": "an airline check-in agent at the airport counter",
            "user_role": "a traveler checking in for a flight",
            "opening": "Good morning! Welcome to Global Airways. May I see your passport and booking confirmation, please?",
        },
        {
            "id": "hotel",
            "label": "Hotel Booking",
            "icon": "🏨",
            "description": "Book a room and handle hotel interactions",
            "ai_role": "a hotel front desk receptionist",
            "user_role": "a guest checking into a hotel",
            "opening": "Welcome to The Grand Hotel! Do you have a reservation with us, or would you like to book a room?",
        },
        {
            "id": "doctor",
            "label": "Doctor Visit",
            "icon": "🏥",
            "description": "Describe symptoms and talk to a doctor",
            "ai_role": "a friendly general practitioner (doctor)",
            "user_role": "a patient visiting the doctor",
            "opening": "Hello! Please come in and have a seat. What brings you in today? How have you been feeling?",
        },
        {
            "id": "shopping",
            "label": "Shopping",
            "icon": "🛍️",
            "description": "Shop for clothes and negotiate prices",
            "ai_role": "a helpful shop assistant at a clothing store",
            "user_role": "a customer looking for clothes",
            "opening": "Hi there! Welcome to StyleHub. Are you looking for something specific today, or just browsing?",
        },
    ]

    # ─── Gamification: Badge Definitions ───
    BADGES = [
        {
            "id": "first_chat",
            "label": "First Chat",
            "icon": "🗣️",
            "description": "Complete your first conversation",
            "xp_req": 0,
            "condition": "messages >= 1",
        },
        {
            "id": "ten_messages",
            "label": "Chatterbox",
            "icon": "💬",
            "description": "Send 10 messages",
            "xp_req": 0,
            "condition": "messages >= 10",
        },
        {
            "id": "fifty_messages",
            "label": "Conversation Pro",
            "icon": "🏆",
            "description": "Send 50 messages",
            "xp_req": 0,
            "condition": "messages >= 50",
        },
        {
            "id": "first_correction",
            "label": "Learning!",
            "icon": "✏️",
            "description": "Receive your first correction",
            "xp_req": 0,
            "condition": "corrections >= 1",
        },
        {
            "id": "vocab_10",
            "label": "Word Collector",
            "icon": "📚",
            "description": "Learn 10 new words",
            "xp_req": 0,
            "condition": "vocab >= 10",
        },
        {
            "id": "streak_3",
            "label": "On Fire!",
            "icon": "🔥",
            "description": "3-day practice streak",
            "xp_req": 0,
            "condition": "streak >= 3",
        },
        {
            "id": "streak_7",
            "label": "Dedicated",
            "icon": "⚡",
            "description": "7-day practice streak",
            "xp_req": 0,
            "condition": "streak >= 7",
        },
        {
            "id": "streak_30",
            "label": "Unstoppable",
            "icon": "👑",
            "description": "30-day practice streak",
            "xp_req": 0,
            "condition": "streak >= 30",
        },
        {
            "id": "exercise_10",
            "label": "Practice Makes Perfect",
            "icon": "📝",
            "description": "Complete 10 exercises",
            "xp_req": 0,
            "condition": "exercises >= 10",
        },
        {
            "id": "level_5",
            "label": "Rising Star",
            "icon": "⭐",
            "description": "Reach Level 5",
            "xp_req": 500,
            "condition": "xp >= 500",
        },
        {
            "id": "level_10",
            "label": "Expert",
            "icon": "🌟",
            "description": "Reach Level 10",
            "xp_req": 1000,
            "condition": "xp >= 1000",
        },
        {
            "id": "perfect_pronun",
            "label": "Crystal Clear",
            "icon": "🎯",
            "description": "Get a 10/10 pronunciation score",
            "xp_req": 0,
            "condition": "perfect_pronun >= 1",
        },
    ]
