---
title: ECHO TUTOR PRO
emoji: '🗣️'
colorFrom: blue
colorTo: indigo
sdk: docker
app_file: app.py
pinned: false
---

# ECHO TUTOR PRO 🗣️

An AI-powered English language tutor with a premium, immersive interface. Practice natural English conversation with real-time corrections, suggestions, and adaptive difficulty.

## ✨ Features

- **Streaming AI Responses** — Real-time token-by-token response rendering via SSE
- **Adaptive Difficulty** — Beginner, Intermediate, and Advanced levels
- **Conversation Topics** — 8 curated topics: Free Talk, Travel, Food, Tech, Movies, Sports, Work, Daily Life
- **Premium UI** — Glassmorphism design, animated particle background, 3D orb avatar
- **Voice Interaction** — Real-time Speech-to-Text (STT) and Text-to-Speech (TTS)
- **Audio Waveform** — Live microphone visualization using Web Audio API
- **Smart Corrections** — AI provides inline corrections and vocabulary suggestions
- **PWA Support** — Installable as a Progressive Web App
- **Session Persistence** — Conversation history saved across page refreshes
- **Keyboard Shortcuts** — Ctrl+M (mic), Enter (send), Escape (end)

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd echo-tutor
```

### 2. Set environment variable

```bash
export NVIDIA_API_KEY="your-api-key-here"
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run locally

```bash
python app.py
```

Open `http://localhost:7860` in your browser.

## Auth + Nova Integration (Production Runtime)

- Production runtime for `PROJECT_APP` is Flask via `app.py` (not `main.py`).
- Auth pages are served as standalone routes:
  - `/signup`
  - `/verify`
  - `/login`
- Auth API is mounted under `/auth` from `auth_module.flask_auth_routes`.
- Signup/request-otp generates local OTP and pushes it to Nova when configured:
  - `POST /api/external/push-otp` on Nova
  - `GET /api/external/check-verified` on Nova

Required env keys for integration:

- `NOVA_API_URL`
- `NOVA_API_KEY`
- `APP_ID`
- `JWT_SECRET_KEY`

To route auth through Nova centrally, set:

- `AUTH_MODE=central`
- `AUTH_PROXY_TIMEOUT_SECONDS=15`

## 🐳 Docker

```bash
docker build -t echo-tutor .
docker run -p 7860:7860 -e NVIDIA_API_KEY="your-key" echo-tutor
```

## 📁 Project Structure

```
echo-tutor/
├── app.py              # Flask backend with streaming SSE
├── config.py           # Configuration (levels, topics, API settings)
├── requirements.txt    # Python dependencies
├── Dockerfile          # Docker container configuration
├── Procfile            # Gunicorn process file
├── templates/
│   └── index.html      # Main application template
└── static/
    ├── css/style.css   # Premium glassmorphism design system
    ├── js/script.js    # Application engine (SSE, particles, waveform)
    ├── manifest.json   # PWA manifest
    ├── service-worker.js
    └── icons/
        ├── icon-192.png
        └── icon-512.png
```

## 🔧 API Endpoints

| Endpoint       | Method | Description                          |
| -------------- | ------ | ------------------------------------ |
| `/`            | GET    | Main application page                |
| `/chat`        | POST   | Non-streaming chat endpoint          |
| `/chat/stream` | POST   | SSE streaming chat endpoint          |
| `/topics`      | GET    | Available topics & difficulty levels |
| `/health`      | GET    | Health check with uptime             |

## 🌐 Deploy on Hugging Face Spaces

1. Push to your HF Space repository
2. Set `NVIDIA_API_KEY` as a Space secret
3. The app runs automatically via Docker

For more: <https://huggingface.co/docs/hub/spaces-config-reference>
