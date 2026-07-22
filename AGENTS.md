# AI Agent Coding Guidelines

Guidelines for any AI (or human) making further changes to this project.

## Critical rules

1. **Never expose API keys in code** — always read from `.env` via `config.py` / `os.getenv`.
2. **Never commit `model/`** — it contains a third party's licensed Live2D asset.
3. **Don't reintroduce the raw Cubism Framework build step.** This project
   deliberately uses `pixi-live2d-display` (loaded via CDN) instead of
   compiling `Framework/src/*.ts` from the official SDK — the framework
   source is TypeScript-only and needs a bundler to use directly. Only
   `Core/live2dcubismcore.min.js` from the SDK zip is used, at
   `frontend/live2d/core/`.
4. **All real-time messages go over the `/ws/chat` WebSocket** — no HTTP polling.
5. **Gemini chat calls MUST return the JSON contract** defined in
   `backend/config.py::SYSTEM_PROMPT` — `{transcript, emotion, text}`. If you
   change the schema, update `gemini_client._extract_json` to match.
6. **Audio between frontend and backend is always base64** inside the
   WebSocket JSON envelope (`audio_chunk` in, `audio` out).
7. **ChromaDB runs in-memory (`EphemeralClient`)** — no persistence file for v1.
   If you add persistence, gate it behind an env var so v1 behavior doesn't change by default.

## Code style

- Python: type hints, `async`/`await`, FastAPI conventions, small single-purpose modules.
- JS: ES6 modules, `async`/`await`, one concern per file (see the existing split:
  `live2d-loader` / `emotion-animator` / `websocket` / `audio-handler` / `ui-controller`).
- Comments explain *why*, not *what*.

## Error handling

- WebSocket disconnects: the frontend auto-reconnects with exponential backoff (`websocket.js`).
- Gemini API errors: caught per-request in `main.py::handle_message`; the user
  gets a friendly in-character fallback message rather than a stack trace.
- TTS failures specifically degrade gracefully: the text + expression are
  already sent before TTS runs, so a TTS failure only means she goes silent
  for that one line, not that the whole reply is lost.
- Mic errors (permission denied, no device): caught in `main.js::beginTalk`,
  surfaced in the subtitle area.

## Performance

- The text + emotion response is sent to the client as soon as it's ready,
  *before* TTS synthesis starts — don't make the client wait on audio to
  update the avatar's expression.
- Lip sync reads live amplitude from an `AnalyserNode` on the actual TTS
  audio buffer (`audio-handler.js`) rather than approximating from text
  length — keep it that way, it's what makes the mouth movement look right.
- ChromaDB context per turn is capped: last 5 turns verbatim + top 3 semantically similar (`memory.py`).
- Rate limit: `MAX_MESSAGES_PER_MINUTE` in `.env`, enforced server-side per connection.

## Extension points

- **Webcam head tracking**: add MediaPipe Face Mesh in the frontend, feed
  `ParamAngleX/Y/Z` and `ParamEyeBallX/Y` from head pose instead of (or
  blended with) the idle sway in `emotion-animator.js`.
- **More granular emotions**: `ParamBrowLAngle` / `ParamBrowRAngle` /
  `ParamBrowLForm` / `ParamBrowRForm` exist on the model but aren't mapped yet
  — add them to `EMOTION_PARAMS` in `config.py`.
- **Expressions**: `model/LucieSD3/Toggle Clothes.exp3.json` exists on disk
  but isn't wired into `model3.json`'s `FileReferences.Expressions` — add it
  there if you want to trigger it as a discrete expression rather than a
  continuous parameter.
- **Multi-language**: detect the transcript's language server-side and pass
  a matching `voice_name` / language hint to `synthesize_speech`.
