// Pure view math (no PixiJS import, so Node tests can run it).

export const VIEW_W = 640;
export const VIEW_H = 360;
export const MARGIN = 1;

/**
 * Pure layout math (tested): where the view goes on a screen of devW x devH device pixels.
 * @returns {{ k:number, x:number, y:number, w:number, h:number }} all in device pixels
 */
export function computeLayout(devW, devH, fillScreen = false) {
  const fit = Math.min(devW / VIEW_W, devH / VIEW_H);
  const k = fillScreen ? Math.max(fit, 0.25) : Math.max(1, Math.floor(fit));
  // Fill mode rounds up (and clamps to the screen) so a fractional k can't leave a 1 px bar.
  const w = fillScreen ? Math.min(devW, Math.ceil(VIEW_W * k - 1e-9)) : VIEW_W * k;
  const h = fillScreen ? Math.min(devH, Math.ceil(VIEW_H * k - 1e-9)) : VIEW_H * k;
  return { k, x: Math.floor((devW - w) / 2), y: Math.floor((devH - h) / 2), w, h };
}

/** Split a camera coordinate into the whole-pixel part and the sub-pixel remainder in [0,1). */
export function splitCamera(v) {
  const whole = Math.floor(v);
  return { whole, frac: v - whole };
}

/**
 * Everything the renderer needs to place the view, from the canvas BACKING size in device pixels
 * (canvas.width/height) and the device pixel ratio. Pixi's stage is in CSS pixels, so every
 * position and scale below is converted with dpr, but the whole-number scale k is chosen in
 * device pixels: a 2560x1440 monitor at Windows 125% (a 2048x1152 CSS window) still gets k = 4.
 * @returns {{ layout, dpr, scale, x, y, bars: Array<{x,y,w,h}> }} x, y, scale, bars in CSS px
 */
export function placeView(canvasW, canvasH, dpr = 1, fillScreen = false) {
  const d = dpr > 0 ? dpr : 1;
  const layout = computeLayout(Math.max(1, Math.floor(canvasW)), Math.max(1, Math.floor(canvasH)), fillScreen);
  const bars = [];
  const W = canvasW / d, H = canvasH / d;
  const x0 = layout.x / d, y0 = layout.y / d, x1 = (layout.x + layout.w) / d, y1 = (layout.y + layout.h) / d;
  if (y0 > 0) bars.push({ x: 0, y: 0, w: W, h: y0 });
  if (y1 < H) bars.push({ x: 0, y: y1, w: W, h: H - y1 });
  if (x0 > 0) bars.push({ x: 0, y: y0, w: x0, h: y1 - y0 });
  if (x1 < W) bars.push({ x: x1, y: y0, w: W - x1, h: y1 - y0 });
  return { layout, dpr: d, scale: layout.k / d, x: x0, y: y0, bars };
}

/** Where the world sprite goes (CSS px): shifted left/up by the margin and the camera's sub-pixel remainder. */
export function worldSpriteOrigin(place, fracX, fracY) {
  return { x: place.x - (MARGIN + fracX) * place.scale, y: place.y - (MARGIN + fracY) * place.scale };
}
