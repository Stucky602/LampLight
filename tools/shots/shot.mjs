// Screenshot + smoke run of the web build in headless Chromium (software WebGL).
// Usage: node tools/shots/shot.mjs [--dist dist] [--seconds 6] [--size 1920x1080] [--dpr 1.25]
//        [--out tools/out/shot.png] [--query "a=1"]
// --size is the window in CSS pixels; --dpr is the display scaling (1.25 = Windows 125%).
// Frame rates here say nothing about a real PC: the GPU is emulated. This is for "does it draw,
// and does it draw correctly". When the layout has letterbox bars, every bar pixel in the
// screenshot is checked against the background color (the DOM overlays are skipped), so a world
// sprite leaking into the bars fails the shot.
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { serveDir } from '../lib/serve.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const dist = resolve(args.dist || 'dist');
const seconds = Number(args.seconds || 8);
const [w, h] = (args.size || '1920x1080').split('x').map(Number);
const out = resolve(args.out || 'tools/out/shot.png');
const dpr = Number(args.dpr || 1);
const extraQuery = args.query ? `&${args.query}` : '';
// The workspace image ships a Playwright Chromium under /opt/pw-browsers; its build number can
// change between images, so find it rather than hard-coding it.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = '/opt/pw-browsers';
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) { const p = join(base, d, 'chrome-linux', 'chrome'); if (existsSync(p)) return p; }
  try { return chromium.executablePath(); } catch { return null; }
}
const CHROME = findChrome();
if (!CHROME || !existsSync(CHROME)) {
  console.error('SHOT CANNOT RUN: no Chromium found (set CHROME_PATH, or check /opt/pw-browsers).');
  process.exit(5);
}

const { server, url } = await serveDir(dist);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let exitCode = 0;
const logs = [];
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`${url}/?smoke=${seconds}${extraQuery}`);
  await page.waitForFunction(() => window.__smokeResult, null, { timeout: (seconds + 60) * 1000 });
  const result = await page.evaluate(() => window.__smokeResult);
  mkdirSync(dirname(out), { recursive: true });
  // DOM boxes over the canvas (debug overlay, status label), in screenshot pixels.
  const domBoxes = await page.evaluate((scale) => [...document.querySelectorAll('#ui > *')]
    .filter((e) => !e.hidden && e.getClientRects().length)
    .map((e) => { const r = e.getBoundingClientRect(); return [r.left * scale - 1, r.top * scale - 1, r.right * scale + 1, r.bottom * scale + 1]; }), dpr);
  await page.screenshot({ path: out });
  const bars = checkBars(out, result.layout, domBoxes);
  console.log(JSON.stringify({ result, bars, logs: logs.slice(-20), screenshot: out }, null, 2));
  if (!result.ok) exitCode = 1;
  if (bars.leaks > 0) { console.error(`SHOT FAIL: ${bars.leaks} letterbox pixels are not the background color`); exitCode = 1; }
} catch (e) {
  console.error('shot failed:', e.message);
  // What the page said before it failed usually says why.
  if (logs.length) console.error(logs.slice(-20).join('\n'));
  exitCode = 2;
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);

/**
 * Count screenshot pixels outside the game view (the letterbox) that aren't the background
 * color #07080d. The layout is in device pixels, the same grid as the screenshot.
 */
function checkBars(file, layout, skip) {
  if (!layout) return { checked: 0, leaks: 0 };
  const png = PNG.sync.read(readFileSync(file));
  const { width: W, height: H, data } = png;
  const inView = (x, y) => x >= layout.x && x < layout.x + layout.w && y >= layout.y && y < layout.y + layout.h;
  const skipped = (x, y) => skip.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b);
  let checked = 0, leaks = 0, first = null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inView(x, y) || skipped(x, y)) continue;
      checked++;
      const o = (y * W + x) * 4;
      if (Math.abs(data[o] - 7) > 2 || Math.abs(data[o + 1] - 8) > 2 || Math.abs(data[o + 2] - 13) > 2) {
        leaks++;
        if (!first) first = { x, y, rgb: [data[o], data[o + 1], data[o + 2]] };
      }
    }
  }
  return { checked, leaks, first };
}
