"""
Small helpers for moving audio between the WebSocket (base64 JSON)
and the Gemini API (raw bytes).
"""
import base64


def b64_to_bytes(b64_str: str) -> bytes:
    """Decode a base64 string (with or without a data: URL prefix) to raw bytes."""
    if "," in b64_str and b64_str.strip().startswith("data:"):
        b64_str = b64_str.split(",", 1)[1]
    return base64.b64decode(b64_str)


def bytes_to_b64(data: bytes) -> str:
    """Encode raw bytes as a plain base64 string (no data: URL prefix)."""
    return base64.b64encode(data).decode("utf-8")


def wrap_pcm_as_wav(pcm_bytes: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    """
    Gemini TTS returns raw 16-bit PCM audio with no container. The browser's
    <audio>/AudioContext needs a real file format, so we wrap the PCM in a
    minimal WAV header.
    """
    import struct

    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width
    data_size = len(pcm_bytes)

    header = b"RIFF" + struct.pack("<I", 36 + data_size) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, sample_width * 8)
    header += b"data" + struct.pack("<I", data_size)
    return header + pcm_bytes
