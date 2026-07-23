"""
TTS Engine using high-quality neural voice synthesis (Kokoro-82M / edge-tts).
Outputs audio bytes decoded natively by frontend AudioContext & AnalyserNode for Lip Sync.
"""
import logging
import edge_tts

logger = logging.getLogger("lucie.tts")

# High-fidelity natural female anime-style neural voice
VOICE_NAME = "en-US-AnaNeural"


async def synthesize_speech(text: str) -> bytes:
    """
    Synthesizes speech from text using edge-tts / Kokoro pipeline.
    Returns audio bytes directly decodable by Web Audio API AudioContext.
    """
    try:
        communicate = edge_tts.Communicate(text, VOICE_NAME)
        audio_data = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.extend(chunk["data"])

        if audio_data:
            return bytes(audio_data)
    except Exception as e:
        logger.error("TTS synthesis error: %s", e)

    return b""
