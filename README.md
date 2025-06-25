---
title: ECHO TUTOR PRO
emoji: "🗣️"
colorFrom: blue
colorTo: indigo
sdk: python
sdk_version: "1.0.0"
app_file: app.py
pinned: false
---

# ECHO TUTOR PRO

This is a professional version of Echo Tutor Light, an AI-powered English language tutor built with Flask and the NVIDIA NIMs API.

This version features a robust project structure, persistent conversation state, and professional-grade configuration and logging.

## Features

-   Interactive, animated AI avatar.
-   Real-time Speech-to-Text (STT) and Text-to-Speech (TTS).
-   Advanced AI-driven language correction and suggestions.
-   Conversation history is saved in the browser session (persists on page refresh).
-   Professional project structure for easy maintenance and scalability.

## Setup and Installation

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd echo-tutor-pro
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Run the app
```bash
python app.py  # (للتشغيل المحلي فقط)
```

---

## Deploy on Hugging Face Spaces

1. تأكد أن الملفات التالية موجودة في مشروعك:
   - app.py
   - config.py
   - requirements.txt
   - Procfile
   - static/ (المجلد)
   - templates/ (المجلد)
2. ارفع المشروع إلى Hugging Face Space الخاص بك (راجع التعليمات أعلاه).
3. لا داعي لتشغيل python app.py في Spaces، سيتم التشغيل تلقائيًا عبر gunicorn.

لمزيد من التفاصيل: https://huggingface.co/docs/hub/spaces-config-reference