# Claude Context File

## Project: Lucie AI Companion

A real-time AI avatar companion using Live2D (the `LucieSD3` model) and the
Gemini API. The user talks to Lucie by voice; she replies with voice,
in-character text, and a matching facial expression.

## Status: complete, working v1

This isn't a scaffold — every file listed below is fully implemented, no
`TODO`s or stubs. What's left is genuinely optional (see "Extension points"
in `AGENTS.md`) or requires the user's own key/model, which can't ship in a
repo:

- The user must supply their own `GEMINI_API_KEY` in `.env`.
- `model/LucieSD3/` and `frontend/live2d/core/live2dcubismcore.min.js` are
  already populated from the two source zips (`CubismSdkForWeb-5-r_5.zip`,
  `lucieSD3_vts.zip`) — nothing further to extract.

## Key implementation decisions (so you don't re-litigate them)

- **No manual Cubism Framework build.** The official SDK's `Framework/`
  folder is TypeScript source only — it needs webpack/rollup to use directly,
  which is a heavy, fragile build step for a single-model project. Instead,
  the frontend loads `pixi-live2d-display` (a maintained wrapper) from a
  CDN, which only needs the official `live2dcubismcore.min.js` (already
  copied into `frontend/live2d/core/`) plus PixiJS. This is why there's no
  `frontend/live2d/framework/` folder — it isn't needed with this approach.
- **STT is not a separate step.** Gemini is multimodal — the backend sends
  recorded audio straight to `gemini-2.0-flash` in `gemini_client.py`, and
  the model both transcribes and replies in one call, returning
  `{transcript, emotion, text}` as JSON. This is faster and simpler than a
  separate Google Cloud Speech-to-Text call.
- **TTS uses `gemini-2.5-flash-preview-tts`** via the unified `google-genai`
  SDK (`from google import genai`), not the older `google-generativeai`
  package — the newer SDK is what supports native audio output today.
- **Live2D parameter IDs are taken directly from the real
  `model/LucieSD3/LucieSD3.cdi3.json`**, not guessed — e.g. `ParamAngleX/Y/Z`,
  `ParamEyeBallX/Y`, `ParamBrowLY/RY`, `ParamCheek`, `ParamMouthForm`,
  `ParamMouthOpenY`, `ParamBreath` all exist on this model and are mapped in
  `backend/config.py::EMOTION_PARAMS`.
- **The model's `EyeBlink`/`LipSync` parameter groups in `model3.json` are
  empty**, so the framework's own auto-blink doesn't do anything for this
  model — blinking and breathing are implemented manually in
  `frontend/js/emotion-animator.js` instead of relying on Cubism defaults.

## File map

```
backend/
  main.py            FastAPI app + the /ws/chat WebSocket endpoint
  config.py           Settings, system prompt, emotion→parameter map
  gemini_client.py     Gemini wrapper: audio-in chat, text-in chat, TTS
  emotion_engine.py    Emotion label -> full Live2D parameter dict
  memory.py            ChromaDB (ephemeral) conversation memory
  audio_utils.py        base64 <-> bytes, raw PCM -> WAV wrapping

frontend/
  index.html           Canvas + subtitles + mic button; loads Core + CDN libs
  css/style.css         Dark "video call at night" theme; voice-reactive subtitle glow
  js/main.js            Bootstraps everything, wires mic hold-to-talk
  js/live2d-loader.js    Loads LucieSD3 via pixi-live2d-display
  js/emotion-animator.js Per-frame parameter blending, idle blink/breath/sway, lip sync
  js/websocket.js        Auto-reconnecting WebSocket client
  js/audio-handler.js     Mic recording (MediaRecorder) + TTS playback + amplitude analysis
  js/ui-controller.js     Subtitle text, connection status, mic button state
```

## WebSocket protocol

Frontend → backend:
```json
{"type": "audio_chunk", "data": "<base64 webm/opus>", "mime_type": "audio/webm"}
{"type": "text_message", "text": "typed fallback input"}
{"type": "ping"}
```

Backend → frontend (text/expression arrives first, audio follows once TTS finishes):
```json
{"type": "response", "transcript": "...", "text": "...", "emotion": "happy", "live2d_params": {"...": 0.0}}
{"type": "audio", "audio_base64": "<base64 wav>", "format": "wav"}
{"type": "error", "message": "..."}
{"type": "pong"}
```

## If you're asked to extend this project

Read `AGENTS.md`'s "Extension points" section first — webcam tracking, more
emotions, wiring the unused `Toggle Clothes.exp3.json` expression, and
multi-language support are all called out there with the exact files to
touch.
