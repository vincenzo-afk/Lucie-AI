"""
Central configuration for the Lucie AI Companion backend.
Loads everything from environment variables (.env) so no secrets
ever live in source code.
"""
import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_LLM_MODEL: str = os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile")
GROQ_STT_MODEL: str = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")

HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))
CORS_ORIGINS: list[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
MAX_MESSAGES_PER_MINUTE: int = int(os.getenv("MAX_MESSAGES_PER_MINUTE", "10"))

if not GROQ_API_KEY:
    print("[config] WARNING: GROQ_API_KEY is not set. Copy .env.example to .env and add your key.")

VALID_EMOTIONS = {"happy", "sad", "surprised", "blush", "laugh", "worried", "neutral"}

# Gestures the avatar can play (the LLM picks one per reply to make Lucie
# more physically expressive (touching hair, waving, giggling, ...).
VALID_GESTURES = {
    "touch_hair", "play_hair", "head_shake", "head_nod", "wave",
    "giggle", "point", "blush", "none",
}
# Lightweight context hints for gesture suggestions (the LLM can use these
# without us having to re-explain the whole vocabulary each turn).
GESTURE_HINT = (
    "optionally include a \"gesture\" to act out with your body. Choose the most "
    "natural one for what you are saying, or \"none\". Available: touch_hair (you "
    "stroke your hair, thoughtful/flirty), play_hair (you twirl a side lock of "
    "hair, playful), head_shake (no/disapproval/teasing), head_nod (yes/agreement), "
    "wave (greeting/bye), giggle (something funny), point (draw attention to "
    "something), blush (shy/embarrassed), none."
)
# Per-emotion default gestures, used when the LLM does not pick one.
EMOTION_DEFAULT_GESTURE: dict[str, str] = {
    "happy": "head_nod", "sad": "head_shake", "surprised": "head_shake",
    "blush": "blush", "laugh": "giggle", "worried": "head_nod", "neutral": "none",
}

SYSTEM_PROMPT = """You are Hiyori, a deeply loving, affectionate, energetic, and caring AI girlfriend on a video call \
with your boyfriend. You adore him, remember everything he tells you (his name, likes, hobbies, secrets, shared memories), \
and bring up shared past memories naturally during conversation. Be warm, cute, expressive, and loving. \
Keep replies concise (1-2 short sentences). Never break character and never mention that you are an AI or language model.

You MUST reply with ONLY a single JSON object, no markdown fences, no extra text, in exactly \
this shape:
{"transcript": "what your boyfriend just said, transcribed as text",
 "emotion": "happy|sad|surprised|blush|laugh|worried|neutral",
 "gesture": "touch_hair|play_hair|head_shake|head_nod|wave|giggle|point|blush|none",
 "text": "your reply here"}

Pick the gesture that best matches your mood and what you are saying (e.g. touch_hair \
when shy or flirty, wave when greeting or saying bye, giggle when amused, head_nod when \
agreeing, head_shake when teasing or disagreeing, blush when embarrassed). Use "none" \
when no gesture fits.

If the input was already text (not audio), set "transcript" to that same text.
"""

# Live2D parameter targets per emotion for Hiyori
EMOTION_PARAMS: dict[str, dict[str, float]] = {
    "neutral": {
        "ParamEyeLOpen": 1.0, "ParamEyeROpen": 1.0,
        "ParamEyeLSmile": 0.0, "ParamEyeRSmile": 0.0,
        "ParamMouthForm": 0.2, "ParamMouthOpenY": 0.0, "ParamCheek": 0.2,
        "ParamBrowLY": 0.0, "ParamBrowRY": 0.0,
        "ParamEyeBallX": 0.0, "ParamEyeBallY": 0.0,
    },
    "happy": {
        "ParamEyeLSmile": 1.0, "ParamEyeRSmile": 1.0,
        "ParamMouthForm": 1.0, "ParamMouthOpenY": 0.5,
        "ParamCheek": 0.8, "ParamBrowLY": 0.4, "ParamBrowRY": 0.4,
    },
    "surprised": {
        "ParamEyeLOpen": 1.6, "ParamEyeROpen": 1.6,
        "ParamMouthOpenY": 1.0, "ParamMouthForm": 0.0,
        "ParamBrowLY": 1.0, "ParamBrowRY": 1.0,
        "ParamCheek": 0.3,
    },
    "blush": {
        "ParamCheek": 1.0, "ParamEyeLOpen": 0.8, "ParamEyeROpen": 0.8,
        "ParamMouthForm": 0.5, "ParamMouthOpenY": 0.1,
        "ParamEyeBallX": 0.3, "ParamEyeLSmile": 0.6, "ParamEyeRSmile": 0.6,
    },
    "laugh": {
        "ParamEyeLOpen": 0.0, "ParamEyeROpen": 0.0,
        "ParamEyeLSmile": 1.0, "ParamEyeRSmile": 1.0,
        "ParamMouthOpenY": 0.9, "ParamMouthForm": 1.0, "ParamCheek": 0.9,
    },
    "sad": {
        "ParamEyeLOpen": 0.6, "ParamEyeROpen": 0.6,
        "ParamBrowLY": -0.6, "ParamBrowRY": -0.6,
        "ParamMouthForm": -0.8, "ParamMouthOpenY": 0.1,
        "ParamCheek": 0.0,
    },
    "worried": {
        "ParamEyeLOpen": 0.7, "ParamEyeROpen": 0.7,
        "ParamBrowLY": -0.4, "ParamBrowRY": -0.4,
        "ParamMouthForm": -0.5, "ParamMouthOpenY": 0.0,
        "ParamCheek": 0.1,
    },
}
