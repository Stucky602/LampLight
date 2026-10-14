// The renderer foundation: a fixed 640x360 world, scaled up by a whole number.
//
// - The world renders into an offscreen texture of 642x362 (a 1 px margin all round), with
//   nearest-neighbor sampling. It is then drawn to the screen at scale k = 3 (1080p), 4 (1440p),
//   or 6 (4K). Odd window sizes are letterboxed.
// - Scaling is computed in DEVICE pixels (the canvas backing size), so Windows display scaling
//   (125%, 150%) can't shrink or blur it; Pixi's stage coordinates are CSS pixels, converted by dpr.
// - Letterbox bars are drawn over the world sprite (which overhangs the view by the margin and
//   the sub-pixel camera shift), so nothing leaks into the bars.
// - Moving the window to a monitor with a different Windows scale updates the resolution.
// - Smooth camera: the world is drawn at the camera's whole-pixel position and the upscaled image
//   is shifted by the sub-pixel remainder, so slow pans don't stair-step on 144 Hz monitors.
// - The HUD has its own 640x360 texture that is never shifted, so it doesn't jitter.
// - "Fill screen" (a setting) trades pixel-perfect scaling for no letterbox bars.

import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';

import { VIEW_W, VIEW_H, MARGIN, computeLayout, splitCamera, placeView, worldSpriteOrigin } from './layout.js';

export { VIEW_W, VIEW_H, computeLayout, splitCamera };

export async function createRenderer(parent, { fillScreen = false, background = '#07080d' } = {}) {
  const app = new Application();
  await app.init({
    background,
    antialias: false,
    autoStart: false,          // our loop driver decides when to draw
    resizeTo: window,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: 'webgl',
    powerPreference: 'high-performance',
    roundPixels: false,
  });
  parent.appendChild(app.canvas);
  app.canvas.style.imageRendering = 'pixelated';

  const worldRT = RenderTexture.create({ width: VIEW_W + MARGIN * 2, height: VIEW_H + MARGIN * 2 });
  worldRT.source.scaleMode = 'nearest';
  const hudRT = RenderTexture.create({ width: VIEW_W, height: VIEW_H });
  hudRT.source.scaleMode = 'nearest';

  const world = new Container();   // everything in world space; the camera moves this
  const hud = new Container();     // screen space at 640x360
  const worldSprite = new Sprite(worldRT);
  const bars = new Graphics();      // letterbox, drawn over the world sprite's overhang
  const hudSprite = new Sprite(hudRT);
  app.stage.addChild(worldSprite, bars, hudSprite);

  let fill = fillScreen;
  let place = placeView(1, 1, 1, fill);
  const camera = { x: VIEW_W / 2, y: VIEW_H / 2 };

  function relayout() {
    // app.canvas.width/height is the backing store in device pixels; renderer.width is CSS pixels.
    place = placeView(app.canvas.width, app.canvas.height, app.renderer.resolution || 1, fill);
    worldSprite.scale.set(place.scale);
    hudSprite.scale.set(place.scale);
    hudSprite.position.set(place.x, place.y);
    bars.clear();
    for (const b of place.bars) bars.rect(b.x, b.y, b.w, b.h);
    if (place.bars.length) bars.fill({ color: background });
  }
  app.renderer.on('resize', relayout);
  relayout();

  // Windows display scale can change when the window moves to another monitor.
  const onMaybeDprChange = () => {
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== app.renderer.resolution) app.renderer.resize(window.innerWidth, window.innerHeight, dpr);
  };
  window.addEventListener('resize', onMaybeDprChange);
  let mq = null;
  const watchDpr = () => {
    mq?.removeEventListener?.('change', onDprQuery);
    mq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    mq?.addEventListener?.('change', onDprQuery);
  };
  function onDprQuery() { onMaybeDprChange(); watchDpr(); }
  watchDpr();

  return {
    app,
    world,
    hud,
    camera,
    get layout() { return place.layout; },
    get place() { return place; },
    setFillScreen(v) { fill = !!v; relayout(); },
    /** Draw one frame with the camera centered on (camera.x, camera.y) in world pixels. */
    draw() {
      const cx = splitCamera(camera.x - VIEW_W / 2);
      const cy = splitCamera(camera.y - VIEW_H / 2);
      world.position.set(-cx.whole + MARGIN, -cy.whole + MARGIN);
      const o = worldSpriteOrigin(place, cx.frac, cy.frac);
      worldSprite.position.set(o.x, o.y);
      app.renderer.render({ container: world, target: worldRT, clear: true, clearColor: background });
      app.renderer.render({ container: hud, target: hudRT, clear: true, clearColor: [0, 0, 0, 0] });
      app.renderer.render({ container: app.stage });
    },
    destroy() {
      window.removeEventListener('resize', onMaybeDprChange);
      mq?.removeEventListener?.('change', onDprQuery);
      app.destroy(true, { children: true, texture: true });
    },
  };
}
