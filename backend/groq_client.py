"""
Groq API client for STT (Whisper) and LLM Chat (LLaMA 3.3 70B).
Replaces Gemini completely with sub-second Groq inference.
"""
import json
import logging
from groq import AsyncGroq

from backend import config

logger = logging.getLogger("lucie.groq")

_groq_client: AsyncGroq | None = None


def get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        if not config.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set in .env")
        _groq_client = AsyncGroq(api_key=config.GROQ_API_KEY)
    return _groq_client


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
    try:
        client = get_groq_client()
        ext = "webm" if "webm" in mime_type else "wav"
        file_tuple = (f"audio.{ext}", audio_bytes, mime_type)

        transcription = await client.audio.transcriptions.create(
            file=file_tuple,
            model=config.GROQ_STT_MODEL,
            response_format="text"
        )
        return str(transcription).strip()
    except Exception as e:
        logger.error("Groq Whisper transcription error: %s", e)
        return ""


async def get_reply_from_text(user_text: str, memory_context: str) -> dict:
    """Send text query to Groq LLaMA 3.3 70B and return structured JSON."""
    try:
        client = get_groq_client()
        context_block = f"\n\nRelevant past conversation:\n{memory_context}" if memory_context else ""

        messages = [
            {"role": "system", "content": config.SYSTEM_PROMPT},
            {"role": "user", "content": f"User says: {user_text}{context_block}"}
        ]

        response = await client.chat.completions.create(
            model=config.GROQ_LLM_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=200,
            response_format={"type": "json_object"}
        )

        raw_text = response.choices[0].message.content
        reply = _extract_json(raw_text)
        if not reply.get("transcript"):
            reply["transcript"] = user_text
        return reply
    except Exception as e:
        logger.error("Groq LLM error: %s", e)
        return {
            "emotion": "happy",
            "text": f"I heard you say '{user_text}'! I'm right here with you!",
            "transcript": user_text
        }
