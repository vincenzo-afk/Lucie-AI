"""
Lucie AI Companion - backend entrypoint.

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
import logging
import time
import traceback
from collections import deque

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import audio_utils
import config
import emotion_engine
import gemini_client
from memory import ConversationMemory

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lucie.main")

app = FastAPI(title="Lucie AI Companion")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "gemini_configured": bool(config.GEMINI_API_KEY)}


class RateLimiter:
    """Simple sliding-window limiter: N messages per rolling 60s window."""

    def __init__(self, max_per_minute: int):
        self.max_per_minute = max_per_minute
        self.timestamps: deque[float] = deque()

    def allow(self) -> bool:
        now = time.time()
        while self.timestamps and now - self.timestamps[0] > 60:
            self.timestamps.popleft()
        if len(self.timestamps) >= self.max_per_minute:
            return False
        self.timestamps.append(now)
        return True


async def handle_message(websocket: WebSocket, message: dict, memory: ConversationMemory) -> None:
    msg_type = message.get("type")

    if msg_type == "audio_chunk":
        audio_bytes = audio_utils.b64_to_bytes(message["data"])
        mime_type = message.get("mime_type", "audio/webm")
        context = memory.build_context("")  # transcript not known yet, use recent turns only
        reply = await gemini_client.get_reply_from_audio(audio_bytes, mime_type, context)

    elif msg_type == "text_message":
        user_text = message.get("text", "").strip()
        if not user_text:
            return
        context = memory.build_context(user_text)
        reply = await gemini_client.get_reply_from_text(user_text, context)

    else:
        await websocket.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})
        return

    memory.add_turn(reply.get("transcript", ""), reply["text"])
    params = emotion_engine.get_live2d_params(reply["emotion"])

    # Send the text + expression immediately so the avatar reacts without
    # waiting on TTS synthesis to finish.
    await websocket.send_json({
        "type": "response",
        "transcript": reply.get("transcript", ""),
        "text": reply["text"],
        "emotion": reply["emotion"],
        "live2d_params": params,
    })

    try:
        pcm_bytes = await gemini_client.synthesize_speech(reply["text"])
        wav_bytes = audio_utils.wrap_pcm_as_wav(pcm_bytes)
        await websocket.send_json({
            "type": "audio",
            "audio_base64": audio_utils.bytes_to_b64(wav_bytes),
            "format": "wav",
        })
    except Exception:
        logger.error("TTS synthesis failed:\n%s", traceback.format_exc())
        await websocket.send_json({
            "type": "error",
            "message": "Voice synthesis failed, but here's my reply above.",
        })


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
    memory = ConversationMemory()
    limiter = RateLimiter(config.MAX_MESSAGES_PER_MINUTE)
    logger.info("Client connected: session %s", memory.session_id)

    try:
        while True:
            message = await websocket.receive_json()

            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if not limiter.allow():
                await websocket.send_json({
                    "type": "error",
                    "message": "You're talking a bit fast for me! Give me a second.",
                })
                continue

            try:
                await handle_message(websocket, message, memory)
            except Exception:
                logger.error("Error handling message:\n%s", traceback.format_exc())
                await websocket.send_json({
                    "type": "error",
                    "message": "Sorry, I didn't catch that. Could you say it again?",
                })

    except WebSocketDisconnect:
        logger.info("Client disconnected: session %s", memory.session_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)
