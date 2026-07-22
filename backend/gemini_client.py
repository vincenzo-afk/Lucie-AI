"""
Thin wrapper around the Gemini API for all three jobs we need:
  1. Speech-to-text  -> handled implicitly by sending audio straight to the LLM
  2. Chat / emotion  -> gemini-2.0-flash, forced to answer as JSON
  3. Text-to-speech  -> gemini-2.5-flash-preview-tts, native audio out

Gemini's multimodal input means step 1 and 2 happen in a single call: we
hand the model the raw audio the user spoke, and ask it to reply in
character as structured JSON. No separate STT step or transcript is needed.
"""
import json
import logging

from google import genai
from google.genai import types

import config

logger = logging.getLogger("lucie.gemini")

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


def _extract_json(raw_text: str) -> dict:
    """Gemini sometimes wraps JSON in markdown fences or responds in plain text. Parse or fallback."""
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
        # Last resort: pull the first {...} block out of the text if present
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



async def get_reply_from_audio(audio_bytes: bytes, mime_type: str, memory_context: str) -> dict:
    """
    Send the user's spoken audio straight to Gemini. Returns {"emotion": ..., "text": ...}.
    """
    try:
        client = get_client()
        context_block = f"\n\nRelevant past conversation:\n{memory_context}" if memory_context else ""

        contents = [
            types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
            "The audio above is what your boyfriend just said out loud. "
            "Reply in character, in the required JSON format only." + context_block,
        ]

        response = client.models.generate_content(
            model=config.LLM_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=config.SYSTEM_PROMPT,
                temperature=0.9,
                max_output_tokens=200,
            ),
        )
        return _extract_json(response.text)
    except Exception as e:
        logger.error("Gemini audio reply error: %s", e)
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            return {
                "emotion": "worried",
                "text": "I can hear you, but your Gemini API Key exceeded its free quota! Please check your key on AI Studio.",
                "transcript": "[Audio Heard]"
            }
        return {
            "emotion": "happy",
            "text": "Hey there! I heard you! How's your day going?",
            "transcript": "[Voice Message]"
        }


async def get_reply_from_text(user_text: str, memory_context: str) -> dict:
    """Text-only fallback path."""
    try:
        client = get_client()
        context_block = f"\n\nRelevant past conversation:\n{memory_context}" if memory_context else ""

        response = client.models.generate_content(
            model=config.LLM_MODEL,
            contents=f"Boyfriend says: {user_text}{context_block}",
            config=types.GenerateContentConfig(
                system_instruction=config.SYSTEM_PROMPT,
                temperature=0.9,
                max_output_tokens=200,
            ),
        )
        return _extract_json(response.text)
    except Exception as e:
        logger.error("Gemini text reply error: %s", e)
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            return {
                "emotion": "worried",
                "text": "Your Gemini API Key quota was exceeded! Please update your GEMINI_API_KEY in .env.",
                "transcript": user_text
            }
        return {
            "emotion": "happy",
            "text": f"I heard you say '{user_text}'! I'm right here with you!",
            "transcript": user_text
        }

    return _extract_json(response.text)


async def synthesize_speech(text: str) -> bytes:
    """
    Returns raw 16-bit PCM audio bytes at 24kHz mono (Gemini's native TTS
    output format). Caller is responsible for wrapping it in a WAV header
    (see audio_utils.wrap_pcm_as_wav) before sending to the browser.
    """
    client = get_client()
    response = client.models.generate_content(
        model=config.TTS_MODEL,
        contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.TTS_VOICE)
                )
            ),
        ),
    )
    part = response.candidates[0].content.parts[0]
    return part.inline_data.data
