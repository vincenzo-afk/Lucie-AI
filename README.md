# Lucie AI Companion

A real-time conversational AI avatar: talk to Lucie, a Live2D character, and
she replies with voice, expressions, and lip sync — powered end-to-end by
Gemini.

## Architecture

```
Browser (mic + Live2D canvas, PixiJS)
        |  WebSocket (audio in / text+emotion+audio out)
        v
FastAPI backend  --->  Gemini API (chat + native TTS, audio understood directly)
        |
        v
  ChromaDB (in-memory conversation memory)
```

Gemini is multimodal, so speech-to-text isn't a separate step: the backend
sends your recorded audio straight to `gemini-2.0-flash`, which transcribes
it internally and replies in character as JSON in one round trip. A second
call to `gemini-2.5-flash-preview-tts` turns her reply into voice.

## Quick start

### 1. Install the backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
```

### 2. Set your API key

```bash
cp .env.example .env
```

Edit `.env` and paste in a key from https://aistudio.google.com/apikey.

### 3. The Live2D SDK core is already in place

`frontend/live2d/core/live2dcubismcore.min.js` is already extracted into this
repo from the official Cubism Web SDK. The rest of the Cubism framework is
handled in-browser by `pixi-live2d-display` (loaded from a CDN in
`index.html`), so there's no build step for it.

### 4. The model is already in place

`model/LucieSD3/` already contains `LucieSD3.model3.json` and everything it
references (`.moc3`, textures, physics, display info).

### 5. Run it

```bash
# Terminal 1 — backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend (any static file server works)
cd frontend
python -m http.server 3000
```

### 6. Open it

Go to `http://localhost:3000`. Hold the mic button, say something, let go —
Lucie transcribes it, replies in character, and speaks back with a matching
expression.

## Features

- 🎙️ Hold-to-talk voice chat, no separate STT step (Gemini reads the audio directly)
- 😊 Emotion-driven Live2D expressions (happy, sad, surprised, blush, laugh, worried, neutral)
- 👄 Live lip sync driven by the actual TTS waveform amplitude, not a guess
- 🧠 Conversation memory: recent turns kept verbatim, older ones recalled by semantic similarity (ChromaDB)
- ✨ Voice-reactive glowing subtitles — the glow intensity tracks her live voice amplitude
- 🔁 Auto-reconnecting WebSocket with exponential backoff

## Live2D parameters in use (from `model/LucieSD3/LucieSD3.cdi3.json`)

| Parameter | Range | Used for |
|---|---|---|
| `ParamEyeLOpen` / `ParamEyeROpen` | 0 – 1.9 | Blinking, expressions |
| `ParamEyeLSmile` / `ParamEyeRSmile` | 0 – 1 | Happy / laughing eyes |
| `ParamMouthForm` | -1 – 1 | Smile / frown shape |
| `ParamMouthOpenY` | 0 – 1 | Talking + lip sync |
| `ParamCheek` | 0 – 1 | Blush |
| `ParamBrowLY` / `ParamBrowRY` | -1 – 1 | Sad / surprised brows |
| `ParamAngleX/Y/Z` | -30 – 30 | Idle head sway |
| `ParamEyeBallX/Y` | -1 – 1 | Idle eye drift |
| `ParamBreath` | 0 – 1 | Idle breathing |

## Emotion → expression map

See `backend/config.py::EMOTION_PARAMS` — it's the single source of truth
the emotion engine reads from.

## Tech stack

- **Backend**: FastAPI, WebSockets, ChromaDB (ephemeral/in-memory), `google-genai`
- **Frontend**: Vanilla JS (ES modules), PixiJS + pixi-live2d-display, Web Audio API
- **AI**: Gemini 2.0 Flash (chat + implicit STT), Gemini 2.5 Flash TTS (native audio out)

## Project structure

See `AGENTS.md` for coding guidelines and `CLAUDE.md` for full project context
(useful if you re-upload this repo to Claude for further changes).
