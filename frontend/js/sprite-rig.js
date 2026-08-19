// sprite-rig.js — Luna, a custom rigged 2D anime girl.
//
// A lightweight layered-sprite rig (no Live2D required): each art layer is a
// node in a bone tree. Every node holds pivot + scale/rotation/offset
// transforms that are composed and rendered to a plain 2D canvas every frame.
//
// Capabilities:
//   - idle: breathing, hair sway, subtle head drift, periodic blink
//   - gestures: touch_hair, play_hair, head_shake, head_nod, wave, giggle,
//               point, blush (all driven by timeline tweens on the bones)
//   - emotion blending: happy / sad / surprised / blush / laugh / worried /
//               neutral (overlays on top of the idle pose)
//   - lip sync: an external amplitude getter (Web Audio analyser) drives a
//               canvas-drawn mouth patch over the smile line

const ASSETS = {
  back_hair: 'model/luna/back_hair.png',
  body: 'model/luna/body.png',
  head: 'model/luna/head.png',
  arm_l: 'model/luna/arm_l.png',
  arm_r: 'model/luna/arm_r.png',
  blush: 'model/luna/blush.png',
};

// --- model-space coordinates (all layers are 1024-wide source art) ----------
// Draw order: back_hair -> body -> arm_l -> arm_r -> head -> blush -> mouth
// Anchors are the world-space pivot point (px, py) each node rotates/scales
// around. (cx, cy) is the pivot inside the layer's own 1024x1024(ish) space.
const LAYOUT = {
  back_hair: { anchor: [400, 170], cx: 512, cy: 55, z: 0 },
  body: { anchor: [400, 580], cx: 512, cy: 55, z: 1 },
  arm_l: { anchor: [260, 575], cx: 390, cy: 45, z: 2 },
  arm_r: { anchor: [540, 575], cx: 380, cy: 45, z: 2 },
  head: { anchor: [400, 565], cx: 512, cy: 955, z: 3 },
  blush: { anchor: [400, 450], cx: 384, cy: 502, z: 4 },
};

// Mouth patch sits ON the head layer at local coords — the smile
// center in head.png local px (measured on the rendered canvas with
// a gridded full capture: smile arc center canvas ~ (622,305),
// head pivot screen (643,620), vs≈1.078)
const MOUTH_LOCAL = [548, 617];

const IMG_SCALES = {
  back_hair: 0.80,
  body: 0.80,
  arm_l: 0.76,
  arm_r: 0.76,
  head: 0.80,
  blush: 0.50,
};

const EASE = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

class Node {
  constructor(name, img, layout) {
    this.name = name;
    this.img = img;
    this.anchor = layout.anchor; // world pivot in model space
    this.cx = layout.cx;
    this.cy = layout.cy;
    this.scale = IMG_SCALES[name] ?? 0.8;
    // base transform (rest pose), mutated by tweens:
    this.rot = 0;        // degrees
    this.sx = 1;
    this.sy = 1;
    this.ox = 0;         // extra offset px (model space)
    this.oy = 0;
    this.alpha = 1;
    this.z = layout.z;
  }
}

export function initSpriteRig(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  const nodes = {};
  let loaded = 0;
  const total = Object.keys(ASSETS).length;

  // --- load assets ----------------------------------------------------------
  function loadAsset(name, src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { nodes[name] = new Node(name, img, LAYOUT[name]); loaded++; resolve(); };
      img.onerror = () => { console.warn('[sprite-rig] failed to load', src); resolve(); };
      img.src = src;
    });
  }

  // --- rig state ------------------------------------------------------------
  let W = 0, H = 0, viewScale = 1, viewX = 0, viewY = 0;
  let time = 0;
  let lipLevel = 0;          // 0..1 amplitude from audio
  let lipSmoothed = 0;
  let emotion = 'neutral';   // current blended emotion target
  let emotionBlend = 0;      // 0..1 blend towards current target
  let gestureQueue = [];     // {name, startedAt, duration}
  let currentGesture = null;
  let blink = { active: false, startedAt: 0, nextAt: 0 };
  let breathPhase = Math.random() * Math.PI * 2;
  let driftPhase = Math.random() * Math.PI * 2;
  let hairPhase = Math.random() * Math.PI * 2;

  function fitToCanvas() {
    const parent = canvasEl.parentElement;
    W = parent ? parent.clientWidth : window.innerWidth;
    H = parent ? parent.clientHeight : window.innerHeight;
    canvasEl.width = W;
    canvasEl.height = H;
    // ANCHOR MODEL: LAYOUT anchors are screen-space positions in an 800x1000
    // "screen canvas" (from the tuned compose preview). We scale that whole
    // canvas to fill the real canvas: viewScale maps 800x1000 -> fit.
    // Anchors scale with viewScale; node pivots (cx, cy) and local offsets
    // scale the same way so the composition is preserved exactly.
    const modelW = 800, modelH = 1000;
    const scaleX = (W * 0.98) / modelW;
    const scaleY = (H * 0.98) / modelH;
    viewScale = Math.min(scaleX, scaleY);
    viewX = (W - modelW * viewScale) / 2;
    viewY = (H - modelH * viewScale) / 2;
  }

  // --- gesture system -------------------------------------------------------
  // A gesture is a function(g, t) -> void where g gives bone access and t is
  // eased progress 0..1 over duration.
  const GESTURES = {};

  function bone(b) { return nodes[b]; }

  function addGesture(name, duration, fn) {
    GESTURES[name] = { duration, fn };
  }

  function runGesture(name) {
    if (!GESTURES[name]) { console.warn('[sprite-rig] unknown gesture', name); return; }
    gestureQueue.push({ name, start: performance.now(), ...GESTURES[name] });
    if (!currentGesture) currentGesture = gestureQueue.shift();
  }

  // touch_hair: right arm raises with a "bent elbow" (scale compression)
  // so her hand reaches up and strokes the side of her hair; hair sways.
  // Kinematics note: the arm hangs ~683 model-px below its shoulder anchor,
  // so a plain rotation overshoots far past the head. Compressing the arm
  // (scale < 1) mimics a bent elbow and lands the hand ON the hair.
  addGesture('touch_hair', 3200, (g, t) => {
    const arm = g('arm_r');
    if (t < 0.45) {
      const k = EASE.inOutCubic(t / 0.45);
      arm.rot = lerp(0, -165, k);            // elbow raises toward hair
      arm.sx = lerp(1, 0.52, k);             // bent-elbow compression
      arm.sy = lerp(1, 0.52, k);
    } else if (t < 0.75) {
      const k = (t - 0.45) / 0.30;
      arm.rot = -165 + Math.sin(k * Math.PI * 2.5) * 5; // stroke jitter
      const hair = g('back_hair');
      hair.rot = Math.sin(k * Math.PI * 3) * 4;
    } else {
      const k = EASE.outCubic((t - 0.75) / 0.25);
      arm.rot = lerp(-165, 0, k);
      arm.sx = lerp(0.52, 1, k);
      arm.sy = lerp(0.52, 1, k);
    }
  });

  // play_hair: left arm tucks a side lock (bent-elbow raise, twirl jitter)
  addGesture('play_hair', 2600, (g, t) => {
    const arm = g('arm_l');
    if (t < 0.4) {
      const k = EASE.inOutCubic(t / 0.4);
      arm.rot = lerp(0, 165, k);
      arm.sx = lerp(1, 0.52, k);
      arm.sy = lerp(1, 0.52, k);
    } else if (t < 0.7) {
      const k = (t - 0.4) / 0.3;
      arm.rot = 165 + Math.sin(k * Math.PI * 2) * 5; // twirl around the lock
      const hair = g('back_hair');
      hair.rot = Math.sin(k * Math.PI * 2.5) * 3.5;
    } else {
      const k = EASE.outCubic((t - 0.7) / 0.3);
      arm.rot = lerp(165, 0, k);
      arm.sx = lerp(0.52, 1, k);
      arm.sy = lerp(0.52, 1, k);
    }
  });

  addGesture('head_shake', 2000, (g, t) => {
    const head = g('head');
    const swings = 3;
    head.rot = Math.sin(t * Math.PI * 2 * swings) * 9 * (1 - t * 0.5);
  });

  addGesture('head_nod', 1500, (g, t) => {
    const head = g('head');
    head.rot = Math.sin(t * Math.PI * 2) * 7 * (1 - t);
  });

  addGesture('wave', 2500, (g, t) => {
    const arm = g('arm_r');
    if (t < 0.3) {
      const k = EASE.inOutCubic(t / 0.3);
      arm.rot = lerp(0, -120, k);
      arm.ox = lerp(0, -35, k);
    } else if (t < 0.85) {
      const k = (t - 0.3) / 0.55;
      arm.rot = -120 + Math.sin(k * Math.PI * 5) * 22; // waving
    } else {
      const k = EASE.outCubic((t - 0.85) / 0.15);
      arm.rot = lerp(-120, 0, k);
      arm.ox = lerp(-35, 0, k);
    }
  });

  addGesture('giggle', 2000, (g, t) => {
    const body = g('body');
    const head = g('head');
    const k = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    body.oy = Math.sin(t * Math.PI * 6) * 5 * k;      // bouncing
    head.rot = Math.sin(t * Math.PI * 4) * 5 * k;
    head.sy = lerp(1, 1.03, Math.abs(Math.sin(t * Math.PI * 3)) * k);
  });

  addGesture('point', 1500, (g, t) => {
    const arm = g('arm_r');
    if (t < 0.35) {
      const k = EASE.outCubic(t / 0.35);
      arm.rot = lerp(0, -80, k);
      arm.ox = lerp(0, -55, k);
      arm.oy = lerp(0, -15, k);
    } else if (t < 0.65) {
      arm.rot = -80 + Math.sin((t - 0.35) * Math.PI * 4) * 8;
    } else {
      const k = EASE.outCubic((t - 0.65) / 0.35);
      arm.rot = lerp(-80, 0, k);
      arm.ox = lerp(-55, 0, k);
      arm.oy = lerp(-15, 0, k);
    }
  });

  addGesture('blush', 2400, (g, t) => {
    const b = g('blush');
    if (t < 0.25) b.alpha = EASE.outCubic(t / 0.25);
    else if (t < 0.65) b.alpha = 1;
    else b.alpha = 1 - EASE.inOutCubic((t - 0.65) / 0.35);
  });

  // --- emotion blending -----------------------------------------------------
  // Emotions overlay on top of the idle pose and gesture layer.
  // Returns per-node deltas applied each frame: {head:{rot,sx,sy}, ...}
  function emotionDeltas() {
    const b = emotionBlend; // how far we are toward the target emotion
    switch (emotion) {
      case 'happy':
        return { head: { rot: 4 * b, sy: 1.02 + 0.02 * b }, blush: { alpha: 0.55 * b } };
      case 'sad':
        return { head: { rot: -5 * b, oy: 4 * b } };
      case 'surprised':
        return { head: { rot: -3 * b, sy: 1.05 * b, oy: -3 * b } };
      case 'blush':
        return { blush: { alpha: b }, head: { rot: 6 * b } };
      case 'laugh':
        return { head: { rot: Math.sin(time * 12) * 6 * b, sy: 1.03 + 0.03 * b } };
      case 'worried':
        return { head: { rot: 3 * b, oy: 2 * b }, body: { oy: 2 * b } };
      default:
        return { blush: { alpha: 0 } };
    }
  }

  let emotionTarget = 'neutral';
  function setEmotionTarget(params) {
    const em = (params && params.emotion) || 'neutral';
    if (em === emotionTarget) return;
    emotion = em;
    emotionTarget = em;
    emotionBlend = 0; // will ramp to 1 over ~400ms
    // The LLM may have picked an explicit gesture (touch_hair, wave, ...).
    // Play that exact motion — this is the expression-rich mode the user
    // asked for. Fall back to an emotion-matched gesture only when none.
    const explicit = params?.gesture || '';
    if (explicit && explicit !== 'none') {
      runGesture(explicit);
    } else {
      const map = { laugh: 'giggle', happy: 'head_nod', surprised: 'head_shake',
                    blush: 'blush', sad: 'head_shake', worried: 'head_nod' };
      if (map[em]) runGesture(map[em]);
    }
  }

  // --- blink ----------------------------------------------------------------
  function updateBlink(now, dt) {
    if (!blink.active && now > blink.nextAt) {
      blink.active = true;
      blink.startedAt = now;
    }
    if (blink.active) {
      const el = now - blink.startedAt;
      if (el > 140) {
        blink.active = false;
        blink.nextAt = now + 2500 + Math.random() * 3500;
      }
    }
  }

  // --- render ---------------------------------------------------------------
  function worldToScreen(wx, wy) {
    return [viewX + wx * viewScale, viewY + wy * viewScale];
  }

  function drawNode(node) {
    if (!node.img.complete || !node.img.naturalWidth) return;
    const iw = node.img.naturalWidth, ih = node.img.naturalHeight;
    // screen-space anchor = screen-space anchor px * viewScale + offset
    const ax = viewX + (node.anchor[0] + node.ox) * viewScale;
    const ay = viewY + (node.anchor[1] + node.oy) * viewScale;
    // local pivot of the image (in its own pixel space), scaled to screen.
    // Rotation pivots around this point so e.g. the shoulder stays fixed.
    const px = node.cx * viewScale * node.sx;
    const py = node.cy * viewScale * node.sy;

    ctx.save();
    ctx.globalAlpha = clamp(node.alpha, 0, 1);
    ctx.translate(ax, ay);
    if (node.rot) ctx.rotate((node.rot * Math.PI) / 180);
    ctx.drawImage(node.img, -px, -py, iw * viewScale * node.sx, ih * viewScale * node.sy);
    ctx.restore();
  }

  function drawMouth() {
    // mouth patch drawn ON the head in head-local pixel coords, so it follows
    // head rotation/offset automatically. Transform to screen space by going
    // through the head pivot (same anchor math as drawNode).
    const head = nodes.head;
    const local = [MOUTH_LOCAL[0], MOUTH_LOCAL[1]];
    // screen-space head pivot (anchor = head screen pos; pivot offset inside
    // the head image scaled to screen)
    const pivotX = viewX + (head.anchor[0] + head.ox) * viewScale;
    const pivotY = viewY + (head.anchor[1] + head.oy) * viewScale;
    const pcx = head.cx * viewScale * head.sx;
    const pcy = head.cy * viewScale * head.sy;

    ctx.save();
    ctx.translate(pivotX, pivotY);
    if (head.rot) ctx.rotate((head.rot * Math.PI) / 180);
    // local position relative to the pivot, scaled to screen
    const lx = (local[0] - head.cx) * viewScale * head.sx;
    const ly = (local[1] - head.cy) * viewScale * head.sy;

    // lip-sync amplitude: map 0..1 to mouth opening
    lipSmoothed = lerp(lipSmoothed, lipLevel, 0.45);
    const open = clamp(lipSmoothed, 0, 1);
    if (open > 0.06) {
      // dark oval that grows with amplitude, sits just under the smile line
      // (sizes in screen pixels; ~0.06 viewScale -> scale from model px)
      const s = viewScale;
      const w = lerp(12 * s, 34 * s, open);
      const h = lerp(7 * s, 22 * s, open);
      ctx.globalAlpha = clamp(open * 1.4, 0, 0.95);
      ctx.fillStyle = '#5a1e22';
      ctx.beginPath();
      ctx.ellipse(lx, ly + 1 * s, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // pink interior for bigger openings
      if (open > 0.4) {
        ctx.globalAlpha = clamp((open - 0.4) * 2, 0, 0.9);
        ctx.fillStyle = '#ff8a95';
        ctx.beginPath();
        ctx.ellipse(lx, ly + 5 * s, (w * 0.55) / 2, (h * 0.6) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function renderFrame(now) {
    ctx.clearRect(0, 0, W, H);
    // background is transparent by design (canvas alpha preserved)

    // idle motion (only gently modulate rest pose)
    breathPhase += 0.0022 * (16.67 / 16.67); // ~1 breath per ~4.5s
    driftPhase += 0.0015;
    hairPhase += 0.003;
    const breathing = Math.sin(breathPhase) * 0.012;
    const drift = Math.sin(driftPhase) * 1.2;
    const hairSway = Math.sin(hairPhase) * 2.2 + Math.sin(hairPhase * 0.5) * 1.5;

    if (nodes.body) { nodes.body.sy = 1 + breathing; }
    if (nodes.back_hair) { nodes.back_hair.rot = hairSway; }
    if (nodes.head) { nodes.head.ox = drift; }

    // blink: squash head vertically very briefly
    if (blink.active) {
      const el = now - blink.startedAt;
      const t = el / 140;
      const squash = t < 0.5 ? 0.35 : 1 - (t - 0.5) * 1.3;
      if (nodes.head) nodes.head.sy = clamp(squash, 0.3, 1);
    } else if (nodes.head) {
      nodes.head.sy = 1;
    }

    // emotion ramp
    emotionBlend = clamp(emotionBlend + 0.03, 0, 1);
    const deltas = emotionDeltas();
    for (const [nodeName, delta] of Object.entries(deltas)) {
      if (!nodes[nodeName]) continue;
      const n = nodes[nodeName];
      if (delta.rot !== undefined) n.rot += delta.rot * 0.1;
      if (delta.sy !== undefined) n.sy = lerp(n.sy, delta.sy, 0.15);
      if (delta.oy !== undefined) n.oy += delta.oy * 0.1;
      if (delta.alpha !== undefined) n.alpha = lerp(n.alpha, delta.alpha, 0.1);
    }
    // decay head rot back to idle when no emotion/gesture drives it
    if (nodes.head && Math.abs(nodes.head.rot) > 0.01) {
      const base = deltas.head?.rot ?? 0;
      nodes.head.rot = lerp(nodes.head.rot, base, 0.12);
    }

    // gesture update
    if (currentGesture) {
      const t = clamp((now - currentGesture.start) / currentGesture.duration, 0, 1);
      const eased = EASE.inOutCubic(t);
      // reset bones each frame the gesture owns (keeps tweens composable)
      currentGesture.fn(bone, eased);
      if (t >= 1) {
        // restore bones the gesture touched (simple full rest for the tween
        // duration aftermath): rotations handled by decay above
        currentGesture = gestureQueue.shift() || null;
      }
    }

    updateBlink(now);

    // draw in z order
    const order = ['back_hair', 'body', 'arm_l', 'arm_r', 'head', 'blush'];
    for (const name of order) if (nodes[name]) drawNode(nodes[name]);
    if (nodes.head) drawMouth();
  }

  // --- ticker ---------------------------------------------------------------
  // The sprite rig owns its own render loop (rAF); the Live2D path ticks
  // inside PIXI's ticker, but here we drive frames ourselves.
  let last = 0;
  let rafId = 0;
  function ticker(now) {
    if (!last) last = now;
    const dt = Math.min(now - last, 50);
    last = now;
    time = now / 1000;
    renderFrame(now);
    rafId = requestAnimationFrame(ticker);
  }

  // --- public API (mirrors emotion-animator.js surface) ---------------------
  return Promise.all(Object.entries(ASSETS).map(([k, v]) => loadAsset(k, v)))
    .then(() => {
      fitToCanvas();
      window.addEventListener('resize', fitToCanvas);
      blink.nextAt = performance.now() + 2000;
      rafId = requestAnimationFrame(ticker);
      return {
        name: 'luna',
        tick: (dtMs) => { /* internal loop owns rendering; kept for parity */ },
        setEmotionTarget: (params) => setEmotionTarget(params),
        setLipSyncSource: (fn) => {
          if (typeof fn === 'function') {
            setInterval(() => { lipLevel = fn() || 0; }, 33);
          }
        },
        playGesture: (name) => runGesture(name),
        // manual lip level setter (fallback)
        setLipLevel: (v) => { lipLevel = v; },
      };
    });
}
