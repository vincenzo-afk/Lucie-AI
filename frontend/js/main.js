// Version tags force fresh loads even when the browser holds stale copies
// of these modules from earlier deploys.
import { initLive2D } from './live2d-loader.js?v=20';
import { createEmotionAnimator } from './emotion-animator.js?v=20';
import { initSpriteRig } from './sprite-rig.js?v=20';
import { createChatSocket } from './websocket.js?v=19';
import { createAudioHandler } from './audio-handler.js?v=19';
import { createUiController } from './ui-controller.js?v=19';

async function main() {
  const ui = createUiController();
  ui.setMicState('disabled');
  ui.setStatus('connecting', 'connecting…');

  let animator = null;

  // --- Avatar: choose between the Live2D model (default) and the custom
  //     rigged sprite model "Luna" via ?model=luna query parameter. Both
  //     animators expose the same surface: tick / setEmotionTarget /
  //     setLipSyncSource / playGesture.
  const modelParam = (new URLSearchParams(window.location.search).get('model') || '').toLowerCase();

  if (modelParam === 'luna') {
    try {
      const canvas = document.getElementById('live2dCanvas');
      animator = await initSpriteRig(canvas);
      // The sprite rig owns its own render loop; the tick() call below is a
      // no-op kept for interface compatibility.
      // Luna has no Live2D hit areas, so treat any click on the canvas as a
      // tap on her (the avatar fills most of the viewport).
      canvas.addEventListener('pointerdown', () => {
        window.dispatchEvent(new CustomEvent('lucie-tapped', { detail: { x: 0, y: 0 } }));
      });
      // Luna gestures on tap for parity with Hiyori.
      window.addEventListener('lucie-tapped', () => {
        const pool = ['touch_hair', 'play_hair', 'wave', 'giggle', 'head_nod'];
        animator.playGesture(pool[Math.floor(Math.random() * pool.length)]);
      });
      console.log('[main] Luna sprite rig loaded');
    } catch (err) {
      console.error('[main] Sprite rig init failed:', err);
      ui.setSubtitle("Couldn't load Luna's model — check the console for details.");
    }
  } else {
    try {
      const canvas = document.getElementById('live2dCanvas');
      const { app, model } = await initLive2D(canvas);
      animator = createEmotionAnimator(model);
      // PIXI 8 ticker.add receives a Ticker instance which has .deltaTime
      app.ticker.add((ticker) => animator.tick(ticker.deltaTime * (1000 / 60)));

      // Clicking/tapping Hiyori makes her react with a random gesture motion.
      window.addEventListener('lucie-tapped', () => animator.playGesture('tap'));
    } catch (err) {
      console.error('[main] Live2D init failed:', err);
      ui.setSubtitle("Couldn't load Lucie's model — check the console for details.");
    }
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
  let woke = false;
  const socket = createChatSocket({
    onWaking: () => {
      // Render free instances spin down when idle; the first load may need
      // up to ~50s to wake up. Show an honest status instead of hanging.
      if (!woke) {
        ui.setStatus('connecting', 'waking her up…');
        ui.setSubtitle('First visit after a while can take up to a minute — she\'s waking up!');
      }
    },
    onOpen: () => {
      woke = true;
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
      // Attach the backend emotion name AND the LLM-picked gesture so the
      // avatar plays a matching motion (both animators honor `gesture`).
      const params = {
        ...(msg.live2d_params || {}),
        emotion: msg.emotion || '',
        gesture: msg.gesture || '',
      };
      animator?.setEmotionTarget(params);
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
