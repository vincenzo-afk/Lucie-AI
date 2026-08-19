// Drives Live2D model parameters every frame AND manages rich animation:
//   - cycles through Hiyori's 3 Idle motions so she is never static
//   - plays expressive one-shot gesture motions (Flick, FlickDown, FlickUp,
//     Tap, Tap@Body, Flick@Body) on emotion changes and body taps
//   - smoothly eases toward target emotion (eye smile, blush, mouth, brows)
//   - overlays gentle autonomous breathing & subtle head sway
//   - applies live audio-driven lip sync during speech
//
// Engine API (untitled-pixi-live2d-engine):
//   motionManager.startMotion(group, index, priority, options)
//   MotionPriority: NONE=0, IDLE=1, NORMAL=2, FORCE=3

const LERP_SPEED = 8; // snappier transition to new emotion

const IDLE_PARAM_IDS = [
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
  'ParamEyeBallX', 'ParamEyeBallY'
];

const PRIO_IDLE = 1;    // background breathing/swaying motions
const PRIO_TALK = 2;    // talking motion while speaking
const PRIO_GESTURE = 3; // strong one-shot gestures

export function createEmotionAnimator(model) {
  const internalModel = model.internalModel;
  const coreModel = internalModel?.coreModel;

  // Hiyori Pro manifest groups (definitions): Idle(3), Flick, FlickDown,
  // FlickUp, Tap(2), Tap@Body, Flick@Body
  let definitions = {};
  if (internalModel && internalModel.motionManager) {
    definitions = internalModel.motionManager.definitions || {};
  }
  const groupNames = Object.keys(definitions);

  // Track what's currently playing to avoid spamming the same motion
  let lastGroup = null, lastIndex = -1;

  // The engine exposes startMotion on the internal MotionManager.
  const motionManager = internalModel?.motionManager;

  function startMotion(groupName, index, priority, opts = {}) {
    try {
      if (motionManager && typeof motionManager.startMotion === 'function') {
        return motionManager.startMotion(groupName, index, priority, opts);
      }
      if (typeof model.startMotion === 'function') {
        return model.startMotion(groupName, index, priority, opts);
      }
    } catch (e) {
      // motion failed — keep it subtle; nothing to show
    }
    return false;
  }

  function list(groupName) {
    return definitions[groupName] || [];
  }

  // Pick an index different from the last played one (within the group).
  function pickDifferent(groupName) {
    const n = list(groupName).length;
    if (n === 0) return -1;
    if (n === 1) return 0;
    let idx = Math.floor(Math.random() * n);
    if (lastGroup === groupName && idx === lastIndex) {
      idx = (idx + 1 + Math.floor(Math.random() * (n - 1))) % n;
    }
    return idx;
  }

  // 1. IDLE: cycle through all 3 Idle motions (m01/m02/m05) with short gaps.
  let idleTimer = randomIdleDelay();

  function startIdleMotion() {
    const idx = pickDifferent('Idle');
    if (idx < 0) return;
    if (startMotion('Idle', idx, PRIO_IDLE, { loop: false, sound: false })) {
      lastGroup = 'Idle';
      lastIndex = idx;
    }
  }

  // 2. TALKING: a livelier motion while she speaks (m05 bounce if available,
  //    otherwise a random idle motion) so her body matches her voice.
  function startTalkMotion() {
    const idle = list('Idle');
    if (idle.length === 0) return;
    // m05 is the bounciest of the Idle set — prefer it while talking,
    // but never repeat the motion that is already playing
    let idx = -1;
    for (let i = 0; i < idle.length; i++) {
      const file = idle[i].File || idle[i];
      if (file.includes('m05')) { idx = i; break; }
    }
    if (idx < 0 || (lastGroup === 'Idle' && idx === lastIndex)) {
      idx = pickDifferent('Idle');
    }
    if (idx < 0) return;
    if (startMotion('Idle', idx, PRIO_TALK, { loop: false, sound: false })) {
      lastGroup = 'Idle';
      lastIndex = idx;
    }
  }

  // 3. GESTURES: one-shot expressive motions. Cycle through the non-idle
  //    groups so consecutive gestures never repeat:
  //    Flick / FlickDown / FlickUp / Tap / Tap@Body / Flick@Body
  const GESTURE_GROUPS = groupNames.filter(g => g !== 'Idle');
  let lastGestureGroup = null;

  // Map the LLM's explicit gesture vocabulary onto Hiyori's motion groups.
  // When a specific group isn't available, fall back to a random gesture.
  const GESTURE_GROUP_MAP = {
    touch_hair: ['Flick'],
    play_hair: ['FlickUp'],
    head_shake: ['FlickDown'],
    head_nod: ['Tap'],
    wave: ['Flick', 'FlickUp'],
    giggle: ['Tap'],
    point: ['Flick@Body'],
    blush: ['Tap'],
  };

  function playNamedGesture(name) {
    const candidates = GESTURE_GROUP_MAP[name] || [];
    for (const group of candidates) {
      if (!groupNames.includes(group)) continue;
      const idx = pickDifferent(group);
      if (idx >= 0 && startMotion(group, idx, PRIO_GESTURE, { loop: false, sound: false })) {
        lastGroup = group;
        lastIndex = idx;
        lastGestureGroup = group;
        gestureTimer = 2.2;
        idleTimer = 3.2;
        return true;
      }
    }
    return false;
  }

  function playGesture(emotion) {
    if (GESTURE_GROUPS.length === 0) return;
    // Pick a different gesture group than last time for constant variety.
    let group = GESTURE_GROUPS[Math.floor(Math.random() * GESTURE_GROUPS.length)];
    if (GESTURE_GROUPS.length > 1 && group === lastGestureGroup) {
      group = GESTURE_GROUPS[(GESTURE_GROUPS.indexOf(group) + 1) % GESTURE_GROUPS.length];
    }
    const idx = pickDifferent(group);
    if (idx < 0) return;
    if (startMotion(group, idx, PRIO_GESTURE, { loop: false, sound: false })) {
      lastGroup = group;
      lastIndex = idx;
      lastGestureGroup = group;
      gestureTimer = 2.2;
      idleTimer = 3.2; // don't race the gesture with an idle motion
    }
  }

  let isSpeaking = false;
  let gestureTimer = 0; // cooldown while a gesture motion plays

  function setSpeaking(speaking) {
    if (isSpeaking === speaking) return;
    isSpeaking = speaking;
    if (speaking) {
      startTalkMotion();
      idleTimer = randomIdleDelay();
    } else {
      idleTimer = 0.6; // resume idle motion shortly after speech ends
    }
  }

  // --- Emotion overlay ---
  let target = neutralTarget();
  let current = { ...target };

  let blinkTimer = randomBlinkDelay();
  let blinkPhase = 0; // 0 = eyes open, ramps 0->1->0 during a blink
  let elapsed = 0;

  let getLipSyncLevel = () => 0;

  function setEmotionTarget(params) {
    target = { ...neutralTarget(), ...params };
    // Play a matching gesture motion when her emotion changes. The LLM can
    // now pick a specific gesture (touch_hair, wave, ...); when it does, play
    // that exact motion first. Otherwise keep the emotion-based fallback.
    const explicitGesture = target.gesture || '';
    const emotion = target.emotion || emotionFromParams(target);
    if (explicitGesture && explicitGesture !== 'none' && !playNamedGesture(explicitGesture)) {
      playGesture(emotion);
    } else if (!explicitGesture || explicitGesture === 'none') {
      playGesture(emotion);
    }
  }

  function emotionFromParams(p) {
    if (p.ParamCheek >= 0.8) return 'blush';
    if (p.ParamEyeLSmile >= 0.5) return 'happy';
    if (p.ParamBrowLY <= -0.5) return 'angry';
    if (p.ParamEyeLOpen <= 0.4) return 'sad';
    return 'normal';
  }

  function setLipSyncSource(fn) {
    getLipSyncLevel = fn;
  }

  function tick(deltaMS) {
    const dt = Math.min(deltaMS / 1000, 0.05); // cap frame time step
    elapsed += dt;
    if (gestureTimer > 0) gestureTimer -= dt;

    // Roll idle motion between utterances (skipped while speaking OR while a
    // one-shot gesture is playing, so motion files never fight the gestures).
    if (!isSpeaking && gestureTimer <= 0) {
      idleTimer -= dt;
      if (idleTimer <= 0) {
        startIdleMotion();
        idleTimer = randomIdleDelay();
      }
    }

    // 1. Ease every target parameter smoothly toward goal.
    const t = 1 - Math.exp(-LERP_SPEED * dt);
    for (const id of Object.keys(target)) {
      if (id === 'emotion') continue;
      current[id] = lerp(current[id] ?? target[id], target[id], t);
    }

    // 2. Gentle idle breathing (sine wave).
    const breath = (Math.sin(elapsed * 1.2) + 1) / 2;
    setParamRaw('ParamBreath', breath);

    // 3. Smooth gentle head sway & eyeball drift (prevents shaking).
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
    const speakingNow = lipLevel > 0.003;
    setSpeaking(speakingNow);
    if (speakingNow) {
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

  return { setEmotionTarget, setLipSyncSource, tick, playGesture };
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

function randomIdleDelay() {
  // play a new Hiyori idle motion every 3-7s for constant variety
  return 3.0 + Math.random() * 4.0;
}
