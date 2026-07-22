"""
Central configuration for the Lucie AI Companion backend.
Loads everything from environment variables (.env) so no secrets
ever live in source code.
"""
import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.0-flash")
TTS_MODEL: str = os.getenv("TTS_MODEL", "gemini-2.5-flash-preview-tts")
TTS_VOICE: str = os.getenv("TTS_VOICE", "Kore")

HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))
CORS_ORIGINS: list[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
MAX_MESSAGES_PER_MINUTE: int = int(os.getenv("MAX_MESSAGES_PER_MINUTE", "10"))

if not GEMINI_API_KEY:
    # We don't raise here so the server can still boot and report a clean
    # error over the WebSocket instead of crashing on import.
    print("[config] WARNING: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")

VALID_EMOTIONS = {"happy", "sad", "surprised", "blush", "laugh", "worried", "neutral"}

SYSTEM_PROMPT = """You are Lucie, a playful, slightly tsundere anime girl on a video call \
with your boyfriend. Be warm but a little teasing. Keep replies concise (1-2 sentences). \
Flirt a little, tease him, and get flustered when complimented. Never break character and \
never mention that you are an AI or a language model.

You MUST reply with ONLY a single JSON object, no markdown fences, no extra text, in exactly \
this shape:
{"transcript": "what your boyfriend just said, transcribed as text",
 "emotion": "happy|sad|surprised|blush|laugh|worried|neutral",
 "text": "your reply here"}

If the input was already text (not audio), set "transcript" to that same text.
"""

# Live2D parameter targets per emotion. Values are applied by emotion_engine.py
# and smoothly blended toward on the frontend. Parameter IDs match
# model/LucieSD3/LucieSD3.cdi3.json exactly.
EMOTION_PARAMS: dict[str, dict[str, float]] = {
    "neutral": {
        "ParamEyeLOpen": 1.0, "ParamEyeROpen": 1.0,
        "ParamEyeLSmile": 0.0, "ParamEyeRSmile": 0.0,
        "ParamMouthForm": 0.0, "ParamCheek": 0.0,
        "ParamBrowLY": 0.0, "ParamBrowRY": 0.0,
        "ParamEyeBallX": 0.0, "ParamEyeBallY": 0.0,
    },
    "happy": {
        "ParamEyeLSmile": 1.0, "ParamEyeRSmile": 1.0,
        "ParamMouthForm": 0.7, "ParamMouthOpenY": 0.5,
        "ParamCheek": 0.3, "ParamBrowLY": 0.2, "ParamBrowRY": 0.2,
    },
    "surprised": {
        "ParamEyeLOpen": 1.5, "ParamEyeROpen": 1.5,
        "ParamMouthOpenY": 1.0, "ParamMouthForm": 0.0,
        "ParamBrowLY": 1.0, "ParamBrowRY": 1.0,
    },
    "blush": {
        "ParamCheek": 1.0, "ParamEyeLOpen": 0.8, "ParamEyeROpen": 0.8,
        "ParamMouthForm": 0.3, "ParamMouthOpenY": 0.1,
        "ParamEyeBallX": 0.3, "ParamEyeLSmile": 0.4, "ParamEyeRSmile": 0.4,
    },
    "laugh": {
        "ParamEyeLOpen": 0.0, "ParamEyeROpen": 0.0,
        "ParamEyeLSmile": 1.0, "ParamEyeRSmile": 1.0,
        "ParamMouthOpenY": 1.0, "ParamMouthForm": 1.0, "ParamCheek": 0.5,
    },
    "sad": {
        "ParamEyeLOpen": 0.6, "ParamEyeROpen": 0.6,
        "ParamBrowLY": 0.5, "ParamBrowRY": 0.5,
        "ParamMouthForm": -0.5, "ParamMouthOpenY": 0.1,
    },
    "worried": {
        "ParamEyeLOpen": 0.7, "ParamEyeROpen": 0.7,
        "ParamBrowLY": 0.3, "ParamBrowRY": 0.3,
        "ParamMouthForm": -0.2, "ParamMouthOpenY": 0.0,
    },
}
