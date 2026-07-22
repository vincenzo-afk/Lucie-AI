export function createUiController() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const subtitleText = document.getElementById('subtitleText');
  const micButton = document.getElementById('micButton');
  const micHint = document.getElementById('micHint');
  const root = document.documentElement;

  function setStatus(state, label) {
    statusDot.className = `status-dot status-${state}`;
    statusText.textContent = label;
  }

  function setSubtitle(text) {
    subtitleText.textContent = text || '';
  }

  function setMicState(state, customHint) {
    // state: 'idle' | 'listening' | 'recording' | 'processing' | 'disabled'
    micButton.classList.remove('recording', 'processing');
    micButton.disabled = false;
    if (state === 'recording' || state === 'listening') {
      micButton.classList.add('recording');
      micHint.textContent = customHint || 'listening… click to send';
    } else if (state === 'processing') {
      micButton.classList.add('processing');
      micButton.disabled = true;
      micHint.textContent = 'lucie is thinking…';
    } else if (state === 'disabled') {
      micButton.disabled = true;
      micHint.textContent = 'connecting…';
    } else {
      micHint.textContent = customHint || 'click mic to talk';
    }
  }


  function setGlowLevel(level) {
    root.style.setProperty('--glow-level', String(Math.min(1, level * 2.2)));
  }

  return { setStatus, setSubtitle, setMicState, setGlowLevel, micButton };
}
