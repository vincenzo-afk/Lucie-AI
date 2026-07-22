// Handles two audio paths:
//   1. Mic capture (hold-to-talk) -> base64 chunk sent over the WebSocket
//   2. TTS playback -> decoded + analysed live so emotion-animator can drive
//      lip sync and the subtitle glow off the actual voice amplitude.

export function createAudioHandler({ onLipSyncLevel } = {}) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingMimeType = 'audio/webm';

  let analyser = null;
  let analyserData = null;
  let currentLevel = 0;
  let playingSource = null;

  // ---------- mic capture ----------

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType: recordingMimeType });
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.start(100);
  }


  function stopRecording() {
    return new Promise((resolve) => {
      if (!mediaRecorder) return resolve(null);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: recordingMimeType });
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
        if (blob.size === 0) return resolve(null);
        const base64 = await blobToBase64(blob);
        resolve({ base64, mimeType: recordingMimeType.split(';')[0] });
      };
      mediaRecorder.stop();
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---------- TTS playback + live amplitude for lip sync ----------

  async function playTtsAudio(base64Wav) {
    await audioCtx.resume();
    const arrayBuffer = base64ToArrayBuffer(base64Wav);
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    if (playingSource) {
      try { playingSource.stop(); } catch { /* already stopped */ }
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyserData = new Uint8Array(analyser.frequencyBinCount);

    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    source.onended = () => {
      currentLevel = 0;
      playingSource = null;
      onPlaybackEnd?.();
    };


    playingSource = source;
    source.start();
    tickLevel();
  }

  function tickLevel() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(analyserData);
    let sumSquares = 0;
    for (let i = 0; i < analyserData.length; i++) {
      const v = (analyserData[i] - 128) / 128;
      sumSquares += v * v;
    }
    currentLevel = Math.sqrt(sumSquares / analyserData.length);
    onLipSyncLevel?.(currentLevel);
    if (playingSource) requestAnimationFrame(tickLevel);
  }

  function getLipSyncLevel() {
    return currentLevel;
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  return { startRecording, stopRecording, playTtsAudio, getLipSyncLevel };
}
