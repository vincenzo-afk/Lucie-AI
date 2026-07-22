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
    autoStart: false,
  });

  const { Live2DModel } = PIXI.live2d;
  const model = await Live2DModel.from(MODEL_PATH);

  // Ensure model textures are fully loaded before adding to stage
  if (!model.textures || model.textures.length === 0 || !model.textures[0]) {
    await new Promise((resolve) => {
      model.once('load', resolve);
      setTimeout(resolve, 800);
    });
  }

  // Safety draw guard: prevent doDrawModel crashes if textures are unready on any frame
  if (model.draw) {
    const origDraw = model.draw.bind(model);
    model.draw = function (renderer) {
      if (!this.textures || !this.textures.length || !this.textures[0]) return;
      try {
        origDraw(renderer);
      } catch (e) {
        // Skip unready frame safely
      }
    };
  }

  if (model._render) {
    const origRender = model._render.bind(model);
    model._render = function (renderer) {
      if (!this.textures || !this.textures.length || !this.textures[0]) return;
      try {
        origRender(renderer);
      } catch (e) {
        // Skip unready frame safely
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

  // Start PIXI ticker once model and guards are set up
  app.start();

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
