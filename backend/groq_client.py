"""
Groq API client for STT (Whisper) and LLM Chat (LLaMA 3.3 70B).

Calls the Groq REST API directly over httpx instead of using the groq SDK,
because some hosting environments (e.g., Render) set HTTP_PROXY env vars that
the SDK's httpx client mishandles ("proxies" kwarg crash). Direct calls with
trust_env=False avoid all proxy interference.
"""
import json
import logging

import httpx

from backend import config

logger = logging.getLogger("lucie.groq")

_BASE_URL = "https://api.groq.com/openai/v1"
_HEADERS = {
    "Authorization": "",  # filled lazily
    "Content-Type": "application/json",
}


def _get_headers() -> dict:
    if not config.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set in .env")
    return {
        "Authorization": f"Bearer {config.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }


def _get_client() -> httpx.AsyncClient:
    # trust_env=False: never read HTTP_PROXY/HTTPS_PROXY from the environment
    return httpx.AsyncClient(base_url=_BASE_URL, timeout=60.0, trust_env=False)


def _extract_json(raw_text: str) -> dict:
    """Parse JSON reply from Groq LLM."""
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    data = {}
    try:
        data = json.loads(cleaned)
    except Exception:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(cleaned[start:end + 1])
            except Exception:
                data = {"emotion": "happy", "text": cleaned, "transcript": ""}
        else:
            data = {"emotion": "happy", "text": cleaned, "transcript": ""}

    emotion = data.get("emotion", "neutral")
    if emotion not in config.VALID_EMOTIONS:
        emotion = "neutral"

    text = data.get("text", "").strip() or cleaned
    return {
        "emotion": emotion,
        "text": text,
        "transcript": data.get("transcript", "").strip(),
    }


async def transcribe_audio(audio_bytes: bytes, mime_type: str) -> str:
    """Transcribe audio bytes using Groq Whisper API (whisper-large-v3-turbo)."""
    ext = "webm" if "webm" in mime_type else "wav"
    files = {"file": (f"audio.{ext}", audio_bytes, mime_type)}
    data = {"model": config.GROQ_STT_MODEL, "response_format": "text"}
    try:
        async with _get_client() as client:
            resp = await client.post(
                "/audio/transcriptions",
                files=files,
                data=data,
                headers=_get_headers(),
            )
            resp.raise_for_status()
            return resp.text.strip()
    except Exception as e:
        logger.error("Groq Whisper transcription error: %s", e)
        return ""


async def get_reply_from_text(user_text: str, memory_context: str) -> dict:
    """Send text query to Groq LLaMA 3.3 70B and return structured JSON."""
    context_block = f"\n\nRelevant past conversation:\n{memory_context}" if memory_context else ""
    payload = {
        "model": config.GROQ_LLM_MODEL,
        "temperature": 0.7,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": config.SYSTEM_PROMPT},
            {"role": "user", "content": f"User says: {user_text}{context_block}"},
        ],
    }
    try:
        async with _get_client() as client:
            resp = await client.post(
                "/chat/completions",
                json=payload,
                headers=_get_headers(),
            )
            resp.raise_for_status()
            raw_text = resp.json()["choices"][0]["message"]["content"]
            reply = _extract_json(raw_text)
            if not reply.get("transcript"):
                reply["transcript"] = user_text
            return reply
    except Exception as e:
        logger.error("Groq LLM error: %s", e)
        return {
            "emotion": "happy",
            "text": f"I heard you say '{user_text}'! I'm right here with you!",
            "transcript": user_text,
        }
