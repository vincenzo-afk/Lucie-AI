// Manages the single WebSocket connection to the FastAPI backend.
// Handles Render free-tier cold starts (instance asleep -> ~50s wake-up) by
// sending a lightweight HTTP wake-up request before each connection attempt,
// and reconnects with capped exponential backoff forever.

// Render hosts frontend + API on the same origin (wss://, no explicit port),
// while local dev uses ws://hostname:8000. Overridable via window.WS_URL.
const WS_URL = window.WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? ':8000' : ''}/ws/chat`;
const MAX_BACKOFF_MS = 8000;
const PING_INTERVAL_MS = 20000;
const WARMUP_INTERVAL_MS = 25000; // periodic HTTP ping keeps Render instance awake

export function createChatSocket(handlers = {}) {
  const { onOpen, onClose, onResponse, onAudio, onError, onWaking } = handlers;

  let socket = null;
  let backoff = 500;
  let pingTimer = null;
  let warmupTimer = null;
  let manuallyClosed = false;
  let wakeRequested = false;

  // Fires a no-op GET request to wake the Render instance before connecting.
  async function wakeServer() {
    if (wakeRequested) return;
    wakeRequested = true;
    onWaking?.();
    try {
      // /health is served instantly once the instance is alive; the GET itself
      // is what tells Render to boot the sleeping container.
      await fetch('/health', { cache: 'no-store' });
    } catch {
      // ignore — the websocket connect attempt will still run
    }
  }

  function connect() {
    manuallyClosed = false;

    // On Render (https origin), wake the instance before attempting the
    // websocket handshake so we don't burn attempts during cold start.
    if (location.protocol === 'https:') {
      void wakeServer().then(() => { socket = newSocket(); });
    } else {
      socket = newSocket();
    }
  }

  function newSocket() {
    if (manuallyClosed) return null;
    const s = new WebSocket(WS_URL);

    s.addEventListener('open', () => {
      backoff = 500;
      wakeRequested = false;
      pingTimer = setInterval(() => sendRaw({ type: 'ping' }), PING_INTERVAL_MS);
      // Render free instances sleep after 15min of inactivity. A lightweight
      // HTTP ping every 25s keeps the instance awake as long as this tab is
      // open, so returning users never hit the cold-start wait again.
      warmupTimer = setInterval(
        () => void fetch('/health', { cache: 'no-store' }).catch(() => {}),
        WARMUP_INTERVAL_MS,
      );
      onOpen?.();
    });

    s.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'response': onResponse?.(msg); break;
        case 'audio': onAudio?.(msg); break;
        case 'error': onError?.(msg.message || 'Something went wrong.'); break;
        case 'pong': break;
        default: break;
      }
    });

    s.addEventListener('close', () => {
      clearInterval(pingTimer);
      clearInterval(warmupTimer);
      onClose?.();
      if (!manuallyClosed) scheduleReconnect();
    });

    s.addEventListener('error', () => {
      s.close();
    });
    return s;
  }

  function scheduleReconnect() {
    // Reset the wake flag so the next attempt re-triggers a wake-up when the
    // server appears to be asleep again.
    wakeRequested = false;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 1.5, MAX_BACKOFF_MS);
  }

  function sendRaw(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function sendAudioChunk(base64Data, mimeType) {
    return sendRaw({ type: 'audio_chunk', data: base64Data, mime_type: mimeType });
  }

  function sendTextMessage(text) {
    return sendRaw({ type: 'text_message', text });
  }

  function close() {
    manuallyClosed = true;
    clearInterval(pingTimer);
    clearInterval(warmupTimer);
    socket?.close();
  }

  connect();
  return { sendAudioChunk, sendTextMessage, close };
}
