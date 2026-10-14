// Measures on the GPU (headless Chromium, software WebGL) what the harbor's Node tests model
// (tests/hubview.test.js), reading the canvas back pixel by pixel with the page's clock stopped
// between frames:
//   1. the fog's share of the picture at known densities, against density x thickness (the
//      wisps off and the fog made bright, so the share reads to a few thousandths)
//   2. a newcomer's brightest pixel, tick by tick, from her boat nearing the pier to her walk up
//      it: no jump where she steps off, or where her figure over the boat fades out
// Workspace only. Usage: node tools/shots/harbor-probe.mjs [--dist dist]
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveDir } from '../lib/serve.mjs';

const i = process.argv.indexOf('--dist');
const dist = resolve(i > 0 ? process.argv[i + 1] : 'dist');
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = '/opt/pw-browsers';
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) { const p = join(base, d, 'chrome-linux', 'chrome'); if (existsSync(p)) return p; }
  return null;
}
const CHROME = findChrome();
if (!CHROME) { console.error('HARBOR PROBE CANNOT RUN: no Chromium found (set CHROME_PATH).'); process.exit(5); }
if (!existsSync(join(dist, 'index.html'))) { console.error(`HARBOR PROBE: no web build at ${dist} (npx vite build --mode web first).`); process.exit(2); }

const { server, url } = await serveDir(dist);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;

/** A page on the smoke profile, its clock under the probe's hand (time stands still between steps). */
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto(`${url}/?smoke=900&${query}`);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  return { page, errors };
}
/** Run the clock until `fn` is true in the page. */
async function runUntil(page, fn, what, stepMs = 50, max = 4000) {
  for (let k = 0; k < max; k++) {
    if (await page.evaluate(fn)) return;
    await page.clock.runFor(stepMs);
  }
  throw new Error(`never: ${what}`);
}
/** The canvas's pixels in a rectangle of view px (640 x 360), read back right after drawing the stage again. */
async function pixels(page, vx, vy, vw, vh) {
  return page.evaluate(([vx, vy, vw, vh]) => {
    const g = window.__lamplight, app = g.renderer.app, L = g.renderer.layout;
    app.render();
    const gl = app.renderer.gl;
    const x = Math.round(L.x + vx * L.k), y = Math.round(L.y + vy * L.k), w = Math.round(vw * L.k), h = Math.round(vh * L.k);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(x, gl.drawingBufferHeight - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const out = [];
    for (let r = h - 1; r >= 0; r--) for (let c = 0; c < w; c++) out.push([buf[(r * w + c) * 4], buf[(r * w + c) * 4 + 1], buf[(r * w + c) * 4 + 2]]);
    return out;   // rows top down
  }, [vx, vy, vw, vh]);
}

// ---------------------------------------------------------------- 1. the fog
{
  const { page, errors } = await open('shot=hub');
  await runUntil(page, () => window.__lamplight?.scenes?.name === 'hub' && !!window.__lamplight.hubScene.world, 'the harbor');
  await page.clock.runFor(500);
  const TILE = [19, 20], REGION = 'lamp_1';   // a tile only the Lamp Post's first level clears (tests/harbor.test.js)
  const shown = [];
  for (const fade of [0, 0.25, 0.5, 0.8, 1]) {
    const at = await page.evaluate(([tx, ty, region, fade]) => {
      const g = window.__lamplight, w = g.hubScene.world, look = g.hubScene.tuning.look;
      look.wisps = 0;
      look.fogColor = 'fog-5';
      if (!w.revealed.has(region)) w.revealed = new Set([...w.revealed, region]);
      w.fogFade = fade > 0 ? new Map([[region, fade]]) : new Map();
      return g.hubView.toView(tx * 16 + 8, ty * 16 + 8);
    }, [...TILE, REGION, fade]);
    await page.clock.runFor(34);
    const px = await pixels(page, at.x, at.y, 1 / 3, 1 / 3);
    shown.push([fade, px[0]]);
  }
  const thickness = await page.evaluate(() => window.__lamplight.hubScene.tuning.look.fogDensity);
  const clear = shown[0][1], full = shown[shown.length - 1][1];
  // A pixel is clear * (1 - a) + fog * a; the fully fogged tile (a = thickness) gives the fog's color.
  const fog = full.map((c, k) => (c - clear[k] * (1 - thickness)) / thickness);
  const k = [0, 1, 2].reduce((b, c) => (Math.abs(fog[c] - clear[c]) > Math.abs(fog[b] - clear[b]) ? c : b), 0);
  console.log(`fog (thickness ${thickness}): its share of the picture at each density`);
  for (const [d, c] of shown) {
    const a = (c[k] - clear[k]) / (fog[k] - clear[k]);
    const off = Math.abs(a - d * thickness);
    if (off > 0.03) failed = true;
    console.log(`  density ${d}: ${a.toFixed(3)} on screen, ${(d * thickness).toFixed(3)} meant${off > 0.03 ? '   <-- OFF' : ''}`);
  }
  if (errors.length) { failed = true; console.log('  page errors:', errors); }
  await page.close();
}

// ---------------------------------------------------------------- 2. the newcomer
{
  const { page, errors } = await open('shot=arrival');
  await runUntil(page, () => window.__lamplight?.hubScene?.world?.timeline?.phase === 'sail', 'the boat out');
  const rows = [];
  for (let f = 0; f < 60 * 40; f++) {
    const s = await page.evaluate(() => {
      const g = window.__lamplight, tl = g.hubScene.world.timeline;
      if (!tl || tl.kind !== 'arrival') return null;
      const h = g.hubScene.world.hub.harbor;
      const feet = tl.phase === 'sail' ? { x: tl.boat.x + h.aboard, y: tl.boat.y + h.deck } : { x: tl.walker.x, y: tl.walker.y };
      const over = g.renderer.world.getChildByLabel('stepping-off', true);
      return { phase: tl.phase, feet, v: g.hubView.toView(feet.x, feet.y), over: over?.visible ? over.alpha : 0, walked: tl.phase === 'walk' ? Math.hypot(tl.walker.x - tl.walk[0][0], tl.walker.y - tl.walk[0][1]) : 0 };
    });
    if (!s || (s.phase === 'walk' && s.walked > 60)) break;
    if ((s.phase === 'sail' || s.phase === 'walk') && s.v.x > 8 && s.v.x < 632) {
      // Her head: 12 to 19 px above her feet, 5 either side of her middle; its brightest pixel.
      const px = await pixels(page, s.v.x - 5, s.v.y - 19, 10, 8);
      const best = px.reduce((b, c) => (c[0] + c[1] + c[2] > b[0] + b[1] + b[2] ? c : b), [0, 0, 0]);
      rows.push({ ...s, best });
    }
    await page.clock.runFor(1000 / 60);
  }
  const where = (r) => (r.phase === 'sail' ? 'in the boat' : r.over ? `over it at ${r.over.toFixed(2)}` : 'under the light map');
  const show = (r) => console.log(`  ${r.phase.padEnd(4)} ${where(r).padEnd(20)} feet ${r.feet.x.toFixed(1)}, ${r.feet.y.toFixed(1)}: ${r.best.join(', ')}`);
  const change = (i) => Math.max(...rows[i].best.map((v, c) => Math.abs(v - rows[i - 1].best[c])));
  const step = rows.findIndex((r) => r.phase === 'walk'), under = rows.findIndex((r) => r.phase === 'walk' && !r.over);
  console.log('newcomer: her brightest pixel, a tick at a time');
  console.log(' where she steps off:'); rows.slice(step - 2, step + 3).forEach(show);
  console.log(' where her figure over the boat fades out:'); rows.slice(under - 4, under + 2).forEach(show);
  const around = [step, under].map((i) => Math.max(change(i), change(i + 1)));
  const typical = rows.slice(step, under + 20).map((_, k) => change(step + k)).sort((a, b) => a - b)[Math.floor((under + 20 - step) / 2)];
  console.log(`  the biggest one-tick change at the two hand-offs: ${around.join(' and ')} (typical on the pier: ${typical})`);
  if (around.some((d) => d > 12)) { failed = true; console.log('  <-- a jump'); }
  if (errors.length) { failed = true; console.log('  page errors:', errors); }
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? 'HARBOR PROBE: something is off (see above)' : 'harbor probe: ok');
process.exit(failed ? 1 : 0);
