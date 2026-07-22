// Loads the LucieSD3 Cubism 4 model onto a PIXI canvas.
// Relies on two globals loaded via <script> tags in index.html:
//   - window.Live2DCubismCore  (from live2d/core/live2dcubismcore.min.js)
//   - window.PIXI, window.PIXI.live2d.Live2DModel  (from the CDN bundles)

const MODEL_PATH = 'model/LucieSD3/LucieSD3.model3.json';


export async function initLive2D(canvasEl) {
  if (!window.PIXI || !window.PIXI.live2d) {
    throw new Error('PIXI / pixi-live2d-display did not load. Check your internet connection or the CDN script tags in index.html.');
  }
  if (!window.Live2DCubismCore) {
    throw new Error('Live2D Cubism Core did not load. Make sure the SDK zip was extracted into frontend/live2d/core/.');
  }

  const app = new PIXI.Application({
    view: canvasEl,
    resizeTo: canvasEl.parentElement,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  const { Live2DModel } = PIXI.live2d;
  const model = await Live2DModel.from(MODEL_PATH);

  model.visible = false;
  app.stage.addChild(model);
  fitModel(model, app);
  window.addEventListener('resize', () => fitModel(model, app));

  // Disable the library's built-in automatic idle motion/eye tracking so our
  // own emotion-animator has exclusive control of every parameter frame to
  // frame — otherwise the two fight over the same params.
  if (model.internalModel) {
    model.internalModel.eyeBlink = null;
  }

  requestAnimationFrame(() => {
    model.visible = true;
  });

  return { app, model };

}

function fitModel(model, app) {
  const targetHeightRatio = 0.92; // leave a little headroom above her head
  const scale = (app.renderer.height * targetHeightRatio) / model.height;
  model.scale.set(scale);
  model.x = app.renderer.width / 2;
  model.y = app.renderer.height * (1 - targetHeightRatio) + model.height * scale * 0.02;
  model.anchor.set(0.5, 0);
}
