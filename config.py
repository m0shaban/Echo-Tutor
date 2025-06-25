import os
from dotenv import load_dotenv

# تحميل المتغيرات من ملف .env
load_dotenv()

class Config:
    """
    إعدادات التطبيق الرئيسية. يتم تحميلها من متغيرات البيئة.
    """
    # مفتاح API
    NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY")
    if not NVIDIA_API_KEY:
        raise ValueError("Error: NVIDIA_API_KEY is not set in the environment variables.")

    # إعدادات النموذج
    OPENAI_API_BASE_URL = "https://integrate.api.nvidia.com/v1"
    MODEL_NAME = "nvidia/llama-3.1-nemotron-nano-4b-v1.1"

    # إعدادات فلاسك
    FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "False").lower() in ['true', '1', 't']