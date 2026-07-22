import { initLive2D } from './live2d-loader.js';
import { createEmotionAnimator } from './emotion-animator.js';
import { createChatSocket } from './websocket.js';
import { createAudioHandler } from './audio-handler.js';
import { createUiController } from './ui-controller.js';

async function main() {
  const ui = createUiController();
  ui.setMicState('disabled');
  ui.setStatus('connecting', 'connecting…');

  let animator = null;

  // --- Live2D ---
  try {
    const canvas = document.getElementById('live2dCanvas');
    const { app, model } = await initLive2D(canvas);
    animator = createEmotionAnimator(model);
    // PIXI 8 ticker.add receives a Ticker instance which has .deltaTime
    app.ticker.add((ticker) => animator.tick(ticker.deltaTime * (1000 / 60)));
  } catch (err) {
    console.error(err);
    ui.setSubtitle("Couldn't load Lucie's model — check the console for details.");
  }

  let isRecording = false;
  let isProcessing = false;
  let isSpeaking = false;
  let handsFreeActive = true;

  async function startRecordingAudio() {
    if (isRecording || isProcessing || isSpeaking) return;
    isRecording = true;
    ui.setMicState('listening', 'listening… speak anytime');
    try {
      await audio.startRecording({
        onSpeechStart: () => {
          ui.setMicState('listening', 'listening to you…');
        },
        onSpeechEnd: () => {
          stopAndSendAudio();
        },
      });
    } catch (err) {
      console.error(err);
      ui.setSubtitle('Click anywhere to grant microphone access.');
      isRecording = false;
      ui.setMicState('idle', 'click to enable mic');
    }
  }

  async function stopAndSendAudio() {
    if (!isRecording) return;
    isRecording = false;
    isProcessing = true;
    ui.setMicState('processing');
    const result = await audio.stopRecording();
    if (result && result.base64) {
      socket.sendAudioChunk(result.base64, result.mimeType);
    } else {
      isProcessing = false;
      resumeListening();
    }
  }

  function resumeListening() {
    if (handsFreeActive && !isRecording && !isProcessing && !isSpeaking) {
      setTimeout(() => {
        if (handsFreeActive && !isRecording && !isProcessing && !isSpeaking) {
          startRecordingAudio();
        }
      }, 400);
    }
  }

  // --- Audio (mic + TTS playback + lip sync) ---
  const audio = createAudioHandler({
    onLipSyncLevel: (level) => ui.setGlowLevel(level),
    onPlaybackEnd: () => {
      isSpeaking = false;
      ui.setMicState('idle', 'listening…');
      resumeListening();
    },
  });
  animator?.setLipSyncSource(audio.getLipSyncLevel);

  // --- WebSocket ---
  const socket = createChatSocket({
    onOpen: () => {
      ui.setStatus('connected', 'hands-free connected');
      ui.setSubtitle('Hands-Free AI Active — just start speaking!');
      startRecordingAudio();
    },
    onClose: () => {
      ui.setStatus('connecting', 'reconnecting…');
      ui.setMicState('disabled');
      isRecording = false;
      isProcessing = false;
    },
    onError: (message) => {
      ui.setStatus('error', 'error');
      ui.setSubtitle(message);
      isRecording = false;
      isProcessing = false;
      resumeListening();
    },
    onResponse: (msg) => {
      ui.setSubtitle(msg.text);
      animator?.setEmotionTarget(msg.live2d_params);
    },
    onAudio: (msg) => {
      isProcessing = false;
      isSpeaking = true;
      audio.playTtsAudio(msg.audio_base64);
    },
  });

  // User click gesture handler to unlock browser audio policy if blocked
  window.addEventListener('click', () => {
    if (!isRecording && !isProcessing && !isSpeaking) {
      startRecordingAudio();
    }
  }, { once: false });
}

main();
