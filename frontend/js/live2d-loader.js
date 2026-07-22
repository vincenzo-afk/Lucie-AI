// Loads the LucieSD3 Cubism 5 model onto a PIXI canvas.
// Relies on two globals loaded via <script> tags in index.html:
//   - window.Live2DCubismCore  (from live2d/core/live2dcubismcore.min.js)
//   - window.PIXI, window.PIXI.live2d.Live2DModel  (from the CDN bundles)

const MODEL_PATH = 'model/LucieSD3/LucieSD3.model3.json';

export async function initLive2D(canvasEl) {
  if (!window.PIXI || !window.PIXI.live2d) {
    throw new Error('PIXI / untitled-pixi-live2d-engine did not load.');
  }
  if (!window.Live2DCubismCore) {
    throw new Error('Live2D Cubism Core did not load.');
  }

  const { Live2DModel, Live2DPlugin } = PIXI.live2d;

  // PIXI 8 requires explicit plugin registration before app initialization
  PIXI.extensions.add(Live2DPlugin);

  // PixiJS v8 Application setup - MUST force WebGL preference as Live2D WebAssembly SDK is WebGL only
  const app = new PIXI.Application();
  await app.init({
    canvas: canvasEl,
    resizeTo: canvasEl.parentElement,
    preference: 'webgl',
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  // Load the model
  const model = await Live2DModel.from(MODEL_PATH, { autoInteract: false });

  // Guard model.renderLive2D against initial frame texture loading race conditions
  if (typeof model.renderLive2D === 'function') {
    const origRenderLive2D = model.renderLive2D.bind(model);
    let errorCount = 0;
    model.renderLive2D = function (...args) {
      try {
        return origRenderLive2D(...args);
      } catch (err) {
        if (errorCount++ < 5) {
          console.warn('[live2d render error]:', err.message, err);
        }
      }
    };
  }

  app.stage.addChild(model);
  fitModel(model, app);
  window.addEventListener('resize', () => fitModel(model, app));

  // Disable built-in eyeBlink so emotion-animator has full control
  if (model.internalModel) {
    model.internalModel.eyeBlink = null;
  }

  return { app, model };
}

function fitModel(model, app) {
  if (!model || !app) return;
  // In PIXI 8, app.canvas replaces app.view
  const rendererHeight = app.canvas.parentElement ? app.canvas.parentElement.clientHeight : window.innerHeight;
  const rendererWidth  = app.canvas.parentElement ? app.canvas.parentElement.clientWidth  : window.innerWidth;

  let modelHeight = 1000;
  if (model.internalModel && model.internalModel.height) {
    modelHeight = model.internalModel.height;
  }

  const scale = (rendererHeight * 0.88) / modelHeight;
  if (!isFinite(scale) || scale <= 0) return;

  model.scale.set(scale);
  model.x = rendererWidth / 2;
  model.y = rendererHeight * 0.05;
  if (model.anchor && typeof model.anchor.set === 'function') {
    model.anchor.set(0.5, 0);
  }
}
