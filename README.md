# Lucie — Live 2D AI Companion

A real-time, hands-free Live2D AI girlfriend that hears you, talks back with a real voice, and reacts with genuine emotion — all through one full-screen animated character.

## How it works

1. **Live2D character** — The avatar is the official **Hiyori Pro (Cubism 4)** model from Live2D Inc. (the same quality tier as commercial VTuber apps). Her mouth, eyes, brows, blush, and body move live, driven by actual TTS audio waveform analysis — she literally *talks*.
2. **Listening** — The browser records your voice continuously (WebM/Opus) and auto-detects when you stop speaking (voice activity detection).
3. **Thinking** — The audio is transcribed by **Groq Whisper**, then **LLaMA 3.3 70B** on Groq replies in character with an emotion tag (`happy`, `sad`, `surprised`, `blush`, `laugh`, `worried`, `neutral`).
4. **Talking** — **edge-tts** synthesizes a natural female neural voice. The frontend decodes it with Web Audio and streams amplitude into `ParamMouthOpenY` every frame for real lip-sync.
5. **Remembering** — Every exchange is stored in a persistent **ChromaDB** vector memory, so she recalls your name, hobbies, and shared memories across sessions.

## Running locally

```bash
cd backend
cp ../.env.example .env     # add GROQ_API_KEY
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Then open `http://localhost:8000` — the FastAPI app serves the frontend at `/` alongside the chat API at `/ws/chat`.

> Get a free Groq API key at https://console.groq.com/

## Deploying to Render

1. Connect this repository to a new **Web Service** on Render.
2. Configure:
   - **Build Command:** `./build.sh`
   - **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - **Environment variable:** `GROQ_API_KEY` — your Groq API key
3. Deploy. One service hosts both the UI and the API; the frontend automatically uses `ws://localhost:8000` locally and `wss://<render-host>` in production.

## Project layout

```
backend/                       FastAPI service: STT, LLM, emotion engine, TTS, memory
frontend/                      index.html + Live2D renderer (PixiJS 8 + Cubism Core)
frontend/model/Hiyori/         Hiyori Pro runtime assets (moc3, textures, motions)
frontend/live2d/core/          Official Cubism 2.1 + Cubism 4/5 core SDKs
data/chroma_db/                Persistent conversation memory
```

## Features

- Microphone hands-free voice chat with automatic speech-end detection
- Emotion-driven Live2D expressions (happy, sad, surprised, blush, laugh, worried, neutral)
- Live lip sync driven by the actual TTS waveform amplitude, not a guess
- Built-in Hiyori idle body motions between utterances, paused during speech
- Autonomous blinking, breathing, and gentle head sway
- Conversation memory: recent turns kept verbatim, older ones recalled by semantic similarity (ChromaDB)
- Voice-reactive glowing subtitles — glow intensity tracks her live voice amplitude
- Auto-reconnecting WebSocket with exponential backoff

## Tech stack

- **Backend**: FastAPI, WebSockets, ChromaDB (persistent), Groq (Whisper STT + LLaMA 3.3 70B), edge-tts
- **Frontend**: Vanilla JS (ES modules), PixiJS 8 + untitled-pixi-live2d-engine, official Cubism Core SDKs, Web Audio API

## Live2D parameters in use (Hiyori Pro, from `frontend/model/Hiyori/hiyori_pro_t11.cdi3.json`)

| Parameter | Used for |
|---|---|
| `ParamEyeLOpen` / `ParamEyeROpen` | Blinking, expressions |
| `ParamEyeLSmile` / `ParamEyeRSmile` | Happy / laughing eyes |
| `ParamMouthForm` / `ParamMouthOpenY` | Smile / frown shape, talking + lip sync |
| `ParamCheek` | Blush |
| `ParamBrowLY` / `ParamBrowRY` | Sad / surprised brows |
| `ParamAngleX/Y/Z`, `ParamBodyAngleX/Y/Z` | Idle head/body sway |
| `ParamEyeBallX/Y` | Idle eye drift |
| `ParamBreath` | Idle breathing |

## Note on licensed assets

The Hiyori Pro model is distributed by Live2D Inc. under its own terms.
It is bundled here solely as part of this project; do not redistribute the
runtime assets separately.
