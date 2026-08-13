"""
TTS engine with neural voice synthesis (edge-tts) plus a server-friendly fallback.

Primary path: edge-tts neural voice (en-US-AnaNeural). On hosts where Microsoft's
edge servers block datacenter IPs (403), the engine transparently falls back to
gTTS (Google's free TTS endpoint), which returns mp3 audio from virtually any
server. Both paths return raw mp3 bytes decodable by the frontend AudioContext.
"""
import io
import logging

import edge_tts

logger = logging.getLogger("lucie.tts")

# High-fidelity natural female anime-style neural voice
VOICE_NAME = "en-US-AnaNeural"


async def _edge_tts(text: str) -> bytes:
    communicate = edge_tts.Communicate(text, VOICE_NAME)
    audio_data = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.extend(chunk["data"])
    return bytes(audio_data)


def _gtts(text: str) -> bytes:
    from gtts import gTTS

    buf = io.BytesIO()
    tts = gTTS(text=text, lang="en", tld="com")
    tts.write_to_fp(buf)
    return buf.getvalue()


async def synthesize_speech(text: str) -> bytes:
    """
    Synthesizes speech from text.
    Returns mp3 audio bytes directly decodable by Web Audio API AudioContext.
    """
    if not text or not text.strip():
        return b""

    try:
        audio = await _edge_tts(text)
        if audio:
            return audio
        raise RuntimeError("edge-tts returned empty audio")
    except Exception as e:
        logger.warning("edge-tts failed (%s), using gTTS fallback", e)

    try:
        return _gtts(text)
    except Exception as e:
        logger.error("TTS fallback error: %s", e)
        return b""
