// Drives every Live2D parameter each frame:
//   - smoothly eases toward whatever emotion target the backend last sent
//   - overlays autonomous idle behaviour (blink, breathing, subtle head sway)
//   - overlays live lip-sync amplitude from audio-handler.js while she talks

const LERP_SPEED = 6; // higher = snappier transition to new emotion, per second

const IDLE_PARAM_IDS = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeBallX', 'ParamEyeBallY'];

export function createEmotionAnimator(model) {
  const coreModel = model.internalModel.coreModel;

  let target = neutralTarget();
  let current = { ...target };

  let blinkTimer = randomBlinkDelay();
  let blinkPhase = 0; // 0 = eyes open, ramps 0->1->0 during a blink
  let elapsed = 0;

  let getLipSyncLevel = () => 0; // set by audio-handler via setLipSyncSource

  function setEmotionTarget(params) {
    target = { ...neutralTarget(), ...params };
  }

  function setLipSyncSource(fn) {
    getLipSyncLevel = fn;
  }

  function tick(deltaMS) {
    const dt = deltaMS / 1000;
    elapsed += dt;

    // 1. Ease every explicit target parameter toward its goal.
    const t = 1 - Math.exp(-LERP_SPEED * dt);
    for (const id of Object.keys(target)) {
      current[id] = lerp(current[id] ?? target[id], target[id], t);
    }

    // 2. Idle breathing (sine wave into ParamBreath).
    const breath = (Math.sin(elapsed * 1.1) + 1) / 2;
    setParam('ParamBreath', breath);

    // 3. Idle head sway + eyeball drift (subtle, slow, layered sines).
    setParam('ParamAngleX', current['ParamAngleX'] ?? 0, Math.sin(elapsed * 0.35) * 4);
    setParam('ParamAngleY', current['ParamAngleY'] ?? 0, Math.sin(elapsed * 0.27 + 1.3) * 3);
    setParam('ParamAngleZ', current['ParamAngleZ'] ?? 0, Math.sin(elapsed * 0.2 + 0.6) * 2);
    setParam('ParamEyeBallX', current['ParamEyeBallX'] ?? 0, Math.sin(elapsed * 0.18) * 0.15);
    setParam('ParamEyeBallY', current['ParamEyeBallY'] ?? 0, Math.sin(elapsed * 0.14 + 2) * 0.1);

    // 4. Autonomous blink, independent of emotion (dips eye-open params to 0
    //    briefly, on top of whatever open amount the current emotion wants).
    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkPhase === 0) {
      blinkPhase = 0.0001; // start a blink
    }
    let blinkMultiplier = 1;
    if (blinkPhase > 0) {
      blinkPhase += dt / 0.12; // ~120ms full blink cycle
      blinkMultiplier = 1 - triangleWave(blinkPhase);
      if (blinkPhase >= 1) {
        blinkPhase = 0;
        blinkTimer = randomBlinkDelay();
      }
    }
    setParamRaw('ParamEyeLOpen', (current['ParamEyeLOpen'] ?? 1) * blinkMultiplier);
    setParamRaw('ParamEyeROpen', (current['ParamEyeROpen'] ?? 1) * blinkMultiplier);

    // 5. Apply every other eased parameter as-is.
    for (const id of Object.keys(current)) {
      if (IDLE_PARAM_IDS.includes(id) || id === 'ParamEyeLOpen' || id === 'ParamEyeROpen') continue;
      setParamRaw(id, current[id]);
    }

    // 6. Live lip-sync overrides mouth openness while TTS audio is playing.
    const lipLevel = getLipSyncLevel();
    if (lipLevel > 0.005) {
      // Scale RMS level (0.01..0.15) to a visible mouth opening (0.2..1.0)
      const openAmount = Math.min(1, Math.pow(lipLevel * 5.0, 0.7));
      setParamRaw('ParamMouthOpenY', openAmount);
      setParamRaw('ParamMouthForm', 0.3); // slight smile while talking
    }
  }

  function setParam(id, currentVal, idleOffset) {
    current[id] = currentVal;
    setParamRaw(id, currentVal + idleOffset);
  }

  function setParamRaw(id, value) {
    // Generate Cubism 2.1 uppercase format (e.g. ParamMouthOpenY -> PARAM_MOUTH_OPEN_Y)
    const upperId = id.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
    try {
      if (coreModel && typeof coreModel.setParameterValueById === 'function') {
        coreModel.setParameterValueById(id, value);
      }
      if (coreModel && typeof coreModel.setParamFloat === 'function') {
        coreModel.setParamFloat(id, value);
        coreModel.setParamFloat(upperId, value);
      }
      if (model.internalModel && typeof model.internalModel.setParameterValue === 'function') {
        model.internalModel.setParameterValue(id, value);
        model.internalModel.setParameterValue(upperId, value);
      }
    } catch {
      // Parameter not present on this model build; safe to ignore.
    }
  }

  return { setEmotionTarget, setLipSyncSource, tick };
}

function neutralTarget() {
  return {
    ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0,
    ParamMouthForm: 0.0, ParamMouthOpenY: 0.0,
    ParamBrowLY: 0.0, ParamBrowRY: 0.0,
    ParamBrowLAngle: 0.0, ParamBrowRAngle: 0.0,
    ParamBrowLForm: 0.0, ParamBrowRForm: 0.0,
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

function triangleWave(phase) {
  // 0 -> 1 -> 0 over phase 0..1
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

function randomBlinkDelay() {
  return 2.5 + Math.random() * 3.5;
}
