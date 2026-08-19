// sprite-rig.js — Luna, a custom rigged 2D anime girl (v3, seamless layers +
// pre-rendered raised-arm pose overlays for the big arm gestures).
//
// All layers are native-size crops cut from ONE unified artwork
// (unified_base.png 1632x2176). Each layer keeps its exact source origin, so
// placing every crop at its origin makes the character one seamless piece.
//
// Transform model (origin-based, no padding):
//   - Node stores origin=[ox,oy] in unified-image px and size=[w,h] (crop px)
//   - viewScale (vs) maps unified px -> screen px (fits canvas)
//   - Anchor screen pos: ax = origin[0]*vs (+ world offset), ay = origin[1]*vs
//   - drawImage(img, ax - cx*s, ay - cy*s, w*s, h*s) with s = scale*vs
//     (rotation pivots at the anchor; (cx,cy) is the pivot in layer-local px)
//
// Capabilities:
//   - idle: breathing, hair sway, subtle head drift, periodic blink
//   - gestures: touch_hair, play_hair, head_shake, head_nod, wave, giggle,
//               point, blush (timeline tweens on the bones)
//   - emotion blending: happy / sad / surprised / blush / laugh / worried /
//               neutral (overlays on top of the idle pose)
//   - lip sync: an external amplitude getter (Web Audio analyser) drives a
//               canvas-drawn mouth patch over the smile line

const MANIFEST_SRC = 'model/luna/manifest.json';

// Draw order: back_hair -> body -> arm_l -> arm_r -> head -> blush -> mouth
// Pose overlays (arm_r_touch, arm_r_wave, arm_l_play) are static crops cut
// from bent-arm variants of the same unified artwork; they draw at their
// manifest origin during the matching gesture (small bounce added), so the
// raised hand reads as a real hand with no rotation sweep artifact.
// Pivot (cx, cy) in each layer's own pixel space:
//   body       (748, 1053) — torso center (breathing pivot)
//   arm_l      (326,   0)  — shoulder top (arm hangs down; raising rotates)
//   arm_r      (339,   0)  — shoulder top
//   head       (522,   0)  — top center of the head crop (nod/tilt pivot)
//   back_hair  (408,   0)  — top of the back-hair strip (sway pivot)
const PIVOTS = {
  back_hair: [408, 0],
  body: [748, 1053],
  arm_l: [26, 0],
  arm_r: [197, 0],
  head: [522, 0],
  blush: [420, 80],
  arm_r_wave: [0, 0],
  arm_r_touch: [0, 0],
  arm_l_play: [0, 0],
};

// Mouth patch: head-layer-local px of the smile center.
// Unified-image smile ≈ (850, 785); head origin = (293, 69) → (557, 716).
const MOUTH_LOCAL = [516, 743];

const EASE = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

class Node {
  constructor(name, img, manifest, pivot) {
    const m = manifest[name];
    this.name = name;
    this.img = img;
    this.origin = m.origin;   // [ox, oy] unified-image px (top-left of crop)
    this.w = m.size[0];       // crop width px
    this.h = m.size[1];       // crop height px
    this.cx = pivot[0];       // pivot, layer-local px
    this.cy = pivot[1];
    this.scale = 1;           // base scale multiplier (rest pose = 1)
    this.rot = 0;             // degrees
    this.sx = 1;
    this.sy = 1;
    this.ox = 0;              // extra world offset px (unified coords)
    this.oy = 0;
    this.alpha = 1;
  }
}

  // Arm layers are drawn only during their gesture (fade in/out) so the rest
// pose stays perfectly clean. The raised-hand motion itself comes from
// pose overlay layers (arm_r_touch / arm_r_wave / arm_l_play) cut from
// bent-arm variants of the unified artwork, not from rotating the strip.

export function initSpriteRig(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  const nodes = {};
  let manifest = null;

  // --- load assets ----------------------------------------------------------
  // cache-buster: bump ASSET_VER whenever layer PNGs change
  const ASSET_VER = 18;

  function loadAsset(name, src) {
    return new Promise((resolve) => {
      const img = new Image();
      // NOTE: no crossOrigin attribute — this rig draws to the canvas from
      // same-origin local assets; setting crossOrigin without a CORS header
      // taints the canvas in headless Chromium and silently blanks exports.
      img.onload = () => {
        nodes[name] = new Node(name, img, manifest, PIVOTS[name]);
        if (name === 'arm_l' || name === 'arm_r') nodes[name].alpha = 0;
        resolve();
      };
      img.onerror = () => { console.warn('[sprite-rig] failed to load', src); resolve(); };
      img.src = src + '?v=' + ASSET_VER;
    });
  }

  // --- rig state ------------------------------------------------------------
  let W = 0, H = 0, viewScale = 1, viewX = 0, viewY = 0;
  const UW = 1632, UH = 2176;   // unified artwork space
  let time = 0;
  let lipLevel = 0;          // 0..1 amplitude from audio
  let lipSmoothed = 0;
  let emotion = 'neutral';
  let emotionBlend = 0;
  let gestureQueue = [];
  let currentGesture = null;
  let blink = { active: false, startedAt: 0, nextAt: 0 };
  let hbCounter = 0;
  let sampleCounter = 0;
  let breathPhase = Math.random() * Math.PI * 2;
  let driftPhase = Math.random() * Math.PI * 2;
  let hairPhase = Math.random() * Math.PI * 2;

  function fitToCanvas() {
    const parent = canvasEl.parentElement;
    W = parent ? parent.clientWidth : window.innerWidth;
    H = parent ? parent.clientHeight : window.innerHeight;
    canvasEl.width = W;
    canvasEl.height = H;
    // Scale unified-image space to fill ~96% of canvas height, keep aspect.
    viewScale = Math.min((W * 0.96) / UW, (H * 0.96) / UH);
    viewX = (W - UW * viewScale) / 2;
    viewY = (H - UH * viewScale) / 2;
  }

  // --- gesture system -------------------------------------------------------
  // Gestures are tweens. Arm raises rotate around the shoulder-top pivot at
  // the top of the arm crop; the arm crop hangs below the pivot like a real
  // limb, so rotation lands the hand exactly on the hair — no bend hacks.
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

    // touch_hair: right arm swings as an arc from the shoulder (pivot rotation,
  // never a slide) so the hand stays attached at the shoulder the whole time
  // and the hand sweeps up to stroke her side lock, with two soft strokes.
  // touch_hair: the pre-rendered bent-arm overlay draws the hand already at
  // her hair; only a tiny rotation nudge (+ strokes on the hair) sells motion.
  addGesture('touch_hair', 3200, (g, t) => {
    if (t < 0.35) {
      const k = EASE.inOutCubic(t / 0.35);
      g('arm_r').rot = lerp(0, -5, k);
    } else if (t < 0.75) {
      const k = (t - 0.35) / 0.40;
      g('arm_r').rot = -5 + Math.sin(k * Math.PI * 2.5) * 2;
      const hair = g('back_hair');
      hair.rot = Math.sin(k * Math.PI * 3) * 4;
    } else {
      const k = EASE.outCubic((t - 0.75) / 0.25);
      g('arm_r').rot = lerp(-5, 0, k);
    }
    return { drivesArm: true };
  });
  // play_hair: left arm swings up from her shoulder to twirl her other lock.
  addGesture('play_hair', 2600, (g, t) => {
    const arm = g('arm_l');
    if (t < 0.4) {
      const k = EASE.inOutCubic(t / 0.4);
      arm.rot = lerp(0, 14, k);
    } else if (t < 0.7) {
      const k = (t - 0.4) / 0.3;
      arm.rot = 14 + Math.sin(k * Math.PI * 2) * 4;     // twirl strokes
      const hair = g('back_hair');
      hair.rot = Math.sin(k * Math.PI * 2.5) * 3.5;
    } else {
      const k = EASE.outCubic((t - 0.7) / 0.3);
      arm.rot = lerp(14, 0, k);
    }
    return { drivesArm: true };
  });

  addGesture('head_shake', 2000, (g, t) => {
    const head = g('head');
    const swings = 3;
    head.rot = Math.sin(t * Math.PI * 2 * swings) * 9 * (1 - t * 0.5);
    return { drivesHead: true };
  });
  addGesture('head_nod', 1500, (g, t) => {
    const head = g('head');
    head.rot = Math.sin(t * Math.PI * 2) * 7 * (1 - t);
    return { drivesHead: true };
  });

  // wave: pre-rendered raised-arm overlay (hand up beside head) bounces with
  // the hand while waving; the strip itself only rotates a few degrees.
  addGesture('wave', 2500, (g, t) => {
    const arm = g('arm_r');
    if (t < 0.3) {
      const k = EASE.inOutCubic(t / 0.3);
      arm.rot = lerp(0, -6, k);
    } else if (t < 0.85) {
      const k = (t - 0.3) / 0.55;
      arm.rot = -6 + Math.sin(k * Math.PI * 2) * 3;
    } else {
      const k = EASE.outCubic((t - 0.85) / 0.15);
      arm.rot = lerp(-6, 0, k);
    }
    return { drivesArm: true };
  });

  addGesture('giggle', 2000, (g, t) => {
    const body = g('body');
    const head = g('head');
    const k = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    body.oy = Math.sin(t * Math.PI * 6) * 5 * k;      // bouncing
    head.rot = Math.sin(t * Math.PI * 4) * 5 * k;
    head.sy = lerp(1, 1.03, Math.abs(Math.sin(t * Math.PI * 3)) * k);
    return { drivesHead: true };
  });

  // point: small rotation nudge (subtle, no visible sweep at -8deg) plus a
  // quick forward-outward pulse.
  addGesture('point', 1500, (g, t) => {
    const arm = g('arm_r');
    if (t < 0.35) {
      const k = EASE.outCubic(t / 0.35);
      arm.rot = lerp(0, -8, k);
      arm.oy = lerp(0, -45, k);
      arm.ox = lerp(0, -30, k);
    } else if (t < 0.65) {
      const pulse = Math.sin((t - 0.35) * Math.PI * 4) * 2;
      arm.rot = -8 + pulse;
      arm.oy = -45 + Math.sin((t - 0.35) * Math.PI * 4) * 8;
    } else {
      const k = EASE.outCubic((t - 0.65) / 0.35);
      arm.rot = lerp(-8, 0, k);
      arm.oy = lerp(-45, 0, k);
      arm.ox = lerp(-30, 0, k);
    }
    return { drivesArm: true };
  });

  addGesture('blush', 2400, (g, t) => {
    const b = g('blush');
    if (t < 0.25) b.alpha = EASE.outCubic(t / 0.25);
    else if (t < 0.65) b.alpha = 1;
    else b.alpha = 1 - EASE.inOutCubic((t - 0.65) / 0.35);
  });

  // --- emotion blending -----------------------------------------------------
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
  function updateBlink(now) {
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
  // Draw a node at its source origin (screen px), rotating around
  // anchor = origin*vs (world offset scaled in), pivot at local (cx,cy).
  function drawNode(node) {
    if (!node.img.complete || !node.img.naturalWidth) return;
    const vs = viewScale;
    const s = node.scale * vs;
    // anchor in screen px: source origin scaled + world offsets scaled
    const ax = viewX + (node.origin[0] + node.ox) * vs;
    const ay = viewY + (node.origin[1] + node.oy) * vs;

    // The image top-left must land exactly at origin*vs (source placement).
    // Rotation pivots around (origin + local pivot)*vs, achieved by shifting
    // the translate to include the pivot, then drawing offset by the pivot.
    ctx.save();
    ctx.globalAlpha = clamp(node.alpha, 0, 1);
    ctx.translate(ax + node.cx * s, ay + node.cy * s);
    if (node.rot) ctx.rotate((node.rot * Math.PI) / 180);
    ctx.drawImage(node.img, -node.cx * s, -node.cy * s, node.w * s, node.h * s);
    ctx.restore();
  }

  function drawMouth() {
    // Mouth patch drawn in head-layer-local px so it follows head motion.
    // We compute the head's current screen-space transform (same math as
    // drawNode) and draw the oval in that frame.
    const head = nodes.head;
    const vs = viewScale;
    const s = head.scale * vs;
    const ax = viewX + (head.origin[0] + head.ox) * vs;
    const ay = viewY + (head.origin[1] + head.oy) * vs;
    const local = [MOUTH_LOCAL[0], MOUTH_LOCAL[1]];

    // anchor here is the head image top-left; rotate around pivot like drawNode
    ctx.save();
    ctx.translate(ax + head.cx * s, ay + head.cy * s);
    if (head.rot) ctx.rotate((head.rot * Math.PI) / 180);
    const lx = (local[0] - head.cx) * s;
    const ly = (local[1] - head.cy) * s;

    // lip-sync amplitude: map 0..1 to mouth opening (sizes scale with vs)
    lipSmoothed = lerp(lipSmoothed, lipLevel, 0.45);
    const open = clamp(lipSmoothed, 0, 1);
    if (open > 0.06) {
      const w = lerp(12 * vs, 34 * vs, open);
      const h = lerp(7 * vs, 22 * vs, open);
      ctx.globalAlpha = clamp(open * 1.4, 0, 0.95);
      ctx.fillStyle = '#5a1e22';
      ctx.beginPath();
      ctx.ellipse(lx, ly + 1 * vs, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // pink interior for bigger openings
      if (open > 0.4) {
        ctx.globalAlpha = clamp((open - 0.4) * 2, 0, 0.9);
        ctx.fillStyle = '#ff8a95';
        ctx.beginPath();
        ctx.ellipse(lx, ly + 5 * vs, (w * 0.55) / 2, (h * 0.6) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function renderFrame(now) {
    try {
    ctx.clearRect(0, 0, W, H);
    // background is transparent by design (canvas alpha preserved)

    // idle motion (only gently modulate rest pose)
    breathPhase += 0.0022; // ~1 breath per ~4.5s
    driftPhase += 0.0015;
    hairPhase += 0.003;
    const breathing = Math.sin(breathPhase) * 0.008;
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
        // gesture update
    let gFlags = {};
    if (currentGesture) {
      const t = clamp((now - currentGesture.start) / currentGesture.duration, 0, 1);
      gFlags = currentGesture.fn(bone, t) || {};
            if (t >= 1) {
        currentGesture = gestureQueue.shift() || null;
      }
    }
    // decay head rot back to idle when no emotion/gesture drives it
    if (!gFlags.drivesHead && nodes.head && Math.abs(nodes.head.rot) > 0.01) {
      const base = deltas.head?.rot ?? 0;
      nodes.head.rot = lerp(nodes.head.rot, base, 0.12);
    }
  // arm layers fade in during arm gestures (they support the sleeve edge);
  // the raised hand itself is drawn by the pose overlay above
    // wave uses the pre-rendered raised-arm overlay exclusively — the strip
    // itself would read as a detached pale block at her side, so it stays
    // hidden during wave. touch/point keep a subtle strip support, play uses
    // the overlay plus a small strip fade so her sleeve edge connects.
    // wave and touch/play now use pre-rendered arm overlays exclusively — the
    // strip at its side would read as a detached block, so it stays hidden for
    // those gestures. only point keeps a subtle strip motion (forward pulse).
    const armMap = { touch_hair: null, play_hair: null, wave: null, point: 'arm_r' };
    const activeArm = gFlags.drivesArm && currentGesture ? armMap[currentGesture.name] : null;
    for (const armName of ['arm_l', 'arm_r']) {
      if (!nodes[armName]) continue;
      const target = armName === activeArm ? 1 : 0;
      const k = armName === activeArm ? 0.35 : 0.12;
      nodes[armName].alpha = lerp(nodes[armName].alpha, target, k);
    }

    // pose overlays: draw the raised-arm crop during its matching gesture
    drawPoseOverlays(now);

    updateBlink(now);

    // draw in z order
    const order = ['back_hair', 'body', 'arm_l', 'arm_r', 'head', 'blush'];
    for (const name of order) if (nodes[name]) drawNode(nodes[name]);
    if (nodes.head) drawMouth();
    } catch (e) { console.error('[sprite-rig] renderFrame error:', e); }
    hbCounter++;
    sampleCounter++;
    if (sampleCounter >= 1200) {
      sampleCounter = 0;
      try {
        const sp = ctx.getImageData(Math.floor(W / 2), Math.floor(H / 2), 20, 20).data;
        let mx = 0;
        for (let i = 0; i < sp.length; i += 4) mx = Math.max(mx, sp[i + 3]);
        console.log('[sprite-rig] sample alphaAtCenter=' + mx);
      } catch (e) { console.log('[sprite-rig] sample fail:', e.message); }
    }
    if (hbCounter % 40 === 0) {
      const imgStatus = Object.keys(nodes).map(k => {
        const n = nodes[k];
        return k + '=' + (n.img ? (n.img.complete ? 'c' : 'p') + (n.img.naturalWidth || 0) : 'x');
      }).join(' ');
      console.log('[sprite-rig] tick', 'gesture=' + (currentGesture ? currentGesture.name : 'none'),
        'vs=' + viewScale.toFixed(3), 'W=' + W, 'H=' + H,
        'bodyA=' + (nodes.body ? nodes.body.alpha : -1).toFixed(2),
        'headA=' + (nodes.head ? nodes.head.alpha : -1).toFixed(2),
        'imgs=' + imgStatus);
    }
  }

  // Pose overlays map: which overlay layer belongs to which arm gesture,
  // and the idle bounce applied to it while active.
  const POSE_OVERLAYS = {
    touch_hair: { node: 'arm_r_touch', oyPeak: 0, bounce: (k) => Math.sin(k * Math.PI * 2) * 4 },
    wave: { node: 'arm_r_wave', oyPeak: 12, bounce: (k) => Math.sin(k * Math.PI * 6) * 7 },
    play_hair: { node: 'arm_l_play', oyPeak: 0, bounce: (k) => Math.sin(k * Math.PI * 2) * 4 },
  };

  function drawPoseOverlays(now) {
    if (!currentGesture || !POSE_OVERLAYS[currentGesture.name]) return;
    const t = clamp((now - currentGesture.start) / currentGesture.duration, 0, 1);
    // fade in during the first 20%, fade out during the last 20%
    let fade = 1;
    if (t < 0.2) fade = EASE.outCubic(t / 0.2);
    else if (t > 0.8) fade = 1 - EASE.inOutCubic((t - 0.8) / 0.2);
    const overlay = POSE_OVERLAYS[currentGesture.name];
    const n = nodes[overlay.node];
    if (!n || !n.img || !n.img.complete) {
      console.log('[sprite-rig] overlay skip:', overlay.node, n ? 'incomplete' : 'missing node');
      return;
    }
    const vs = viewScale;
    // appearance: fade the overlay's own alpha via globalAlpha
    ctx.save();
    ctx.globalAlpha = clamp(fade, 0, 1);
    // static origin placement (like drawNode, no rotation), plus a gentle
    // bounce while the gesture is in its hold phase (0.2..0.8)
    const hold = clamp((t - 0.2) / 0.6, 0, 1);
    const bounceY = hold > 0 && hold < 1 ? overlay.bounce(t) : 0;
    const ax = viewX + (n.origin[0] - overlay.oyPeak * 0) * vs;
    const ay = viewY + (n.origin[1] - overlay.oyPeak) * vs + bounceY * vs;
    ctx.drawImage(n.img, ax, ay, n.w * vs, n.h * vs);
    ctx.restore();
  }

  // --- ticker ---------------------------------------------------------------
  let last = 0;
  let rafId = 0;
  function ticker(now) {
    if (!last) last = now;
    last = now;
    time = now / 1000;
    renderFrame(now);
    rafId = requestAnimationFrame(ticker);
  }

  // --- public API (mirrors emotion-animator.js surface) ---------------------
  return fetch(MANIFEST_SRC)
    .then((r) => { if (!r.ok) throw new Error('manifest load failed'); return r.json(); })
    .then((m) => {
      manifest = Object.assign({}, m);
      // blush overlay: two soft pink cheek spots covering unified x 400..1240,
      // y 640..800 (placed as a fixed-origin overlay, NOT in the layer manifest)
      manifest.blush = { origin: [400, 640], size: [840, 160] };
      const assetNames = Object.keys(m);
      // diagnostic experiment: skip the pose-overlay PNGs entirely
      const SKIP_OVERLAYS = /skipOverlays=1/.test(location.search);
      const skipNames = SKIP_OVERLAYS ? ['arm_r_wave', 'arm_r_touch', 'arm_l_play'] : [];
      return Promise.all(assetNames.filter((n) => !skipNames.includes(n)).map((name) => loadAsset(name, `model/luna/${name}.png`)));
    })
    .then(() => loadAsset('blush', 'model/luna/blush.png'))
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
        // debug accessors
        __bone: (name) => nodes[name],
        __gesture: () => currentGesture,
        __viewScale: () => viewScale,
        __viewX: () => viewX,
        __viewY: () => viewY,
      };
    });
}
