// Manages the single WebSocket connection to the FastAPI backend.
// Auto-reconnects with exponential backoff and exposes a small pub/sub API.

const WS_URL = `ws://${location.hostname}:8000/ws/chat`;
const MAX_BACKOFF_MS = 15000;
const PING_INTERVAL_MS = 20000;

export function createChatSocket(handlers = {}) {
  const { onOpen, onClose, onResponse, onAudio, onError } = handlers;

  let socket = null;
  let backoff = 500;
  let pingTimer = null;
  let manuallyClosed = false;

  function connect() {
    manuallyClosed = false;
    socket = new WebSocket(WS_URL);

    socket.addEventListener('open', () => {
      backoff = 500;
      pingTimer = setInterval(() => sendRaw({ type: 'ping' }), PING_INTERVAL_MS);
      onOpen?.();
    });

    socket.addEventListener('message', (event) => {
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

    socket.addEventListener('close', () => {
      clearInterval(pingTimer);
      onClose?.();
      if (!manuallyClosed) scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      onError?.('Connection error.');
      socket.close();
    });
  }

  function scheduleReconnect() {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
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
    socket?.close();
  }

  connect();
  return { sendAudioChunk, sendTextMessage, close };
}
