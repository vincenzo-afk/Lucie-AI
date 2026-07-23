// Drives Live2D model parameters every frame:
//   - smoothly eases toward target emotion (eye smile, blush cheeks, mouth form, brows)
//   - overlays gentle autonomous breathing & subtle head sway (prevents shaking)
//   - applies live audio-driven lip sync during speech via beforeModelUpdate

const LERP_SPEED = 8; // snappier transition to new emotion

const IDLE_PARAM_IDS = [
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
  'ParamEyeBallX', 'ParamEyeBallY'
];

export function createEmotionAnimator(model) {
  const internalModel = model.internalModel;
  const coreModel = internalModel?.coreModel;

  let target = neutralTarget();
  let current = { ...target };

  let blinkTimer = randomBlinkDelay();
  let blinkPhase = 0; // 0 = eyes open, ramps 0->1->0 during a blink
  let elapsed = 0;

  let getLipSyncLevel = () => 0;

  function setEmotionTarget(params) {
    target = { ...neutralTarget(), ...params };
  }

  function setLipSyncSource(fn) {
    getLipSyncLevel = fn;
  }

  function tick(deltaMS) {
    const dt = Math.min(deltaMS / 1000, 0.05); // cap frame time step
    elapsed += dt;

    // 1. Ease every target parameter smoothly toward goal.
    const t = 1 - Math.exp(-LERP_SPEED * dt);
    for (const id of Object.keys(target)) {
      current[id] = lerp(current[id] ?? target[id], target[id], t);
    }

    // 2. Gentle idle breathing (sine wave).
    const breath = (Math.sin(elapsed * 1.2) + 1) / 2;
    setParamRaw('ParamBreath', breath);

    // 3. Smooth gentle head sway & eyeball drift (overrides shaking body motion).
    setParamRaw('ParamAngleX', (current['ParamAngleX'] ?? 0) + Math.sin(elapsed * 0.4) * 2.5);
    setParamRaw('ParamAngleY', (current['ParamAngleY'] ?? 0) + Math.sin(elapsed * 0.3 + 1.0) * 2.0);
    setParamRaw('ParamAngleZ', (current['ParamAngleZ'] ?? 0) + Math.sin(elapsed * 0.25 + 0.5) * 1.2);
    setParamRaw('ParamBodyAngleX', Math.sin(elapsed * 0.2) * 1.0);
    setParamRaw('ParamBodyAngleY', Math.sin(elapsed * 0.15) * 1.0);
    setParamRaw('ParamBodyAngleZ', Math.sin(elapsed * 0.1) * 0.8);

    setParamRaw('ParamEyeBallX', (current['ParamEyeBallX'] ?? 0) + Math.sin(elapsed * 0.2) * 0.1);
    setParamRaw('ParamEyeBallY', (current['ParamEyeBallY'] ?? 0) + Math.sin(elapsed * 0.15 + 1.5) * 0.08);

    // 4. Autonomous natural blink.
    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkPhase === 0) {
      blinkPhase = 0.0001;
    }
    let blinkMultiplier = 1;
    if (blinkPhase > 0) {
      blinkPhase += dt / 0.12;
      blinkMultiplier = 1 - triangleWave(blinkPhase);
      if (blinkPhase >= 1) {
        blinkPhase = 0;
        blinkTimer = randomBlinkDelay();
      }
    }
    setParamRaw('ParamEyeLOpen', (current['ParamEyeLOpen'] ?? 1) * blinkMultiplier);
    setParamRaw('ParamEyeROpen', (current['ParamEyeROpen'] ?? 1) * blinkMultiplier);

    // 5. Apply all emotion parameters (eye smile, blush, mouth form, brows).
    for (const id of Object.keys(current)) {
      if (IDLE_PARAM_IDS.includes(id) || id === 'ParamEyeLOpen' || id === 'ParamEyeROpen') continue;
      setParamRaw(id, current[id]);
    }

    // 6. Real-time audio lip-sync (overrides mouth openness during speech).
    const lipLevel = getLipSyncLevel();
    if (lipLevel > 0.003) {
      // Scale RMS level to full mouth open range (0.2 .. 1.0)
      const openAmount = Math.min(1.0, Math.pow(lipLevel * 7.0, 0.6));
      setParamRaw('ParamMouthOpenY', openAmount);
      setParamRaw('ParamMouthForm', 0.5); // happy smile while talking
    }
  }

  function setParamRaw(id, value) {
    try {
      if (coreModel && typeof coreModel.setParameterValueById === 'function') {
        coreModel.setParameterValueById(id, value);
      }
      if (internalModel && typeof internalModel.setParameterValue === 'function') {
        internalModel.setParameterValue(id, value);
      }
    } catch {
      // safe fallback
    }
  }

  // Hook tick directly into beforeModelUpdate event so parameters are applied
  // RIGHT BEFORE rendering, preventing background motion files from overwriting them!
  if (internalModel && typeof internalModel.on === 'function') {
    internalModel.on('beforeModelUpdate', () => {
      tick(16.66); // 60fps frame tick
    });
  }

  return { setEmotionTarget, setLipSyncSource, tick };
}

function neutralTarget() {
  return {
    ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0,
    ParamEyeLSmile: 0.0, ParamEyeRSmile: 0.0,
    ParamMouthForm: 0.2, ParamMouthOpenY: 0.0, ParamCheek: 0.2,
    ParamBrowLY: 0.0, ParamBrowRY: 0.0,
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

function triangleWave(phase) {
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

function randomBlinkDelay() {
  return 2.5 + Math.random() * 3.5;
}
