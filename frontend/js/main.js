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
    app.ticker.add((tickerObj) => animator.tick(tickerObj.deltaMS));
  } catch (err) {
    console.error(err);
    ui.setSubtitle("Couldn't load Lucie's model — check the console for details.");
  }

  let isRecording = false;
  let handsFreeActive = false;

  async function startRecordingAudio() {
    if (isRecording || micButton.disabled) return;
    isRecording = true;
    ui.setMicState('listening', 'listening… click mic to send');
    try {
      await audio.startRecording();
    } catch (err) {
      console.error(err);
      ui.setSubtitle('Could not access your microphone.');
      isRecording = false;
      handsFreeActive = false;
      ui.setMicState('idle', 'click mic to talk');
    }
  }

  async function stopAndSendAudio() {
    if (!isRecording) return;
    isRecording = false;
    ui.setMicState('processing');
    const result = await audio.stopRecording();
    if (result && result.base64) {
      socket.sendAudioChunk(result.base64, result.mimeType);
    } else {
      ui.setMicState('idle', handsFreeActive ? 'hands-free mode • click mic' : 'click mic to talk');
    }
  }

  // --- Audio (mic + TTS playback + lip sync) ---
  const audio = createAudioHandler({
    onLipSyncLevel: (level) => ui.setGlowLevel(level),
    onPlaybackEnd: () => {
      // Auto-resume listening when Lucie finishes speaking in Hands-Free mode
      if (handsFreeActive && !isRecording && !micButton.disabled) {
        setTimeout(() => {
          if (handsFreeActive && !isRecording && !micButton.disabled) {
            startRecordingAudio();
          }
        }, 600);
      } else if (!isRecording) {
        ui.setMicState('idle', 'click mic to talk');
      }
    },
  });
  animator?.setLipSyncSource(audio.getLipSyncLevel);

  // --- WebSocket ---
  const socket = createChatSocket({
    onOpen: () => {
      ui.setStatus('connected', 'connected');
      ui.setMicState('idle', 'click mic to talk');
    },
    onClose: () => {
      ui.setStatus('connecting', 'reconnecting…');
      ui.setMicState('disabled');
      handsFreeActive = false;
      isRecording = false;
    },
    onError: (message) => {
      ui.setStatus('error', 'error');
      ui.setSubtitle(message);
      ui.setMicState('idle', 'click mic to talk');
      isRecording = false;
    },
    onResponse: (msg) => {
      ui.setSubtitle(msg.text);
      animator?.setEmotionTarget(msg.live2d_params);
      if (!handsFreeActive) {
        ui.setMicState('idle', 'click mic to talk');
      }
    },
    onAudio: (msg) => {
      audio.playTtsAudio(msg.audio_base64);
    },
  });

  // --- Mic: Click-to-Talk & Hands-Free Mode ---
  const micButton = ui.micButton;

  function toggleTalk(e) {
    if (e) e.preventDefault();
    if (micButton.disabled) return;

    if (isRecording) {
      // Clicked while listening -> Stop & send audio
      stopAndSendAudio();
    } else {
      // Clicked while idle -> Enable Hands-Free & start listening
      handsFreeActive = true;
      startRecordingAudio();
    }
  }

  micButton.addEventListener('click', toggleTalk);
}

main();

