// Workspace check (C3, ruling 18 P2): the gate's two steps (the map, then the character, all six
// open) at 100, 125, and 150% text: a shot of each (optional folder), and no text or button off the
// screen. Usage: npm run build first (or BUILD=<a built copy>), then node tools/shots/gate-check.mjs [shots dir].
import { createRequire } from 'node:module';
const B = process.env.BUILD || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(new URL('../package.json', import.meta.url).pathname);
const { chromium } = require('playwright-core');
const { serveDir } = await import(B + '/tools/lib/serve.mjs');
import { readdirSync, existsSync } from 'node:fs';
const OUT = process.argv[2];
const dirs = readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
const CHROME = dirs.map((d) => `/opt/pw-browsers/${d}/chrome-linux64/chrome`).find(existsSync);
const { server, url } = await serveDir(B + '/dist');
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${url}/?smoke=600&shot=gate&rich=1`);
  await page.waitForFunction(() => window.__lamplight?.hubScene?.world, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const chars = await page.evaluate(() => {
    const g = window.__lamplight, d = structuredClone(g.profile);
    const ids = g.data?.characters?.map((c) => c.id) ?? ['lamplighter', 'harpooner', 'punter', 'bog_warden', 'drowned_man', 'tide_priest'];
    d.profile.characters = Object.fromEntries(ids.map((id, k) => [id, { unlocked: true, masteryXp: [60, 300, 900, 0, 140, 600][k] ?? 300, skills: [] }]));
    d.profile.kept = [...(d.profile.kept || []), 'feat:first_crossing', 'feat:eel_season', 'secret:breakwater_point', 'feat:tide_priest_call'];
    g.useProfileForTools(d);
    return ids;
  });
  for (const ts of [1, 1.25, 1.5]) {
    for (const which of ['map', 'char']) {
    const r = await page.evaluate(async ({ ts, which }) => {
      const g = window.__lamplight;
      g.ui.setTextScale(ts); g.ui.closeAll?.();
      g.hubScene.openGateForTools();
      await new Promise((res) => setTimeout(res, 400));
      if (which === 'char') { g.ui.top.el.querySelector('[data-focus]').click(); await new Promise((res) => setTimeout(res, 400)); }
      const top = g.ui.top;
      const els = [...top.el.querySelectorAll('[data-focus]')].filter((e) => e.offsetParent !== null);
      const W = innerWidth, H = innerHeight, bad = [];
      for (const e of els) { const b = e.getBoundingClientRect(); if (b.left < 0 || b.top < 0 || b.right > W + 0.5 || b.bottom > H + 0.5) bad.push(`${e.dataset.focus} off screen`); }
      const all = [...top.el.querySelectorAll('*')].filter((e) => e.offsetParent !== null && e.children.length === 0 && e.textContent.trim());
      for (const e of all) { const b = e.getBoundingClientRect(); if (b.bottom > H + 0.5 || b.right > W + 0.5) { bad.push(`text off: ${e.textContent.trim().slice(0, 30)}`); } }
      const over = [...top.el.querySelectorAll('*')].filter((e) => e.offsetParent !== null && (e.scrollHeight > e.clientHeight + 1) && getComputedStyle(e).overflowY !== 'visible').map((e) => e.className + ':' + (e.scrollHeight - e.clientHeight) + ':' + getComputedStyle(e).getPropertyValue('--u'));
      // The pad (ruling 19 PB): every element reached from every other, and each strip line, once in
      // focus, inside the strip's visible box (it scrolls with the focus).
      const scope = top.scope, keys = els.map((e) => e.dataset.focus);
      const seen = new Set([scope.current.dataset.focus]), queue = [scope.current.dataset.focus];
      while (queue.length) {
        const k = queue.shift();
        for (const d of ['up', 'down', 'left', 'right']) { scope.focusKey(k); scope.move(d); const n = scope.current.dataset.focus; if (!seen.has(n)) { seen.add(n); queue.push(n); } }
      }
      const strip = top.el.querySelector('.char-detail'), hidden = [];
      if (strip) for (const e of strip.querySelectorAll('[data-focus]')) {
        scope.focusKey(e.dataset.focus);
        const a = e.getBoundingClientRect(), b = strip.getBoundingClientRect();
        if (a.top < b.top - 0.5 || a.bottom > b.bottom + 0.5) hidden.push(e.dataset.focus);
      }
      scope.focusKey(keys[0]);
      bad.push(...keys.filter((k) => !seen.has(k)).map((k) => `${k} not reached by the pad`), ...hidden.map((k) => `${k} not scrolled into view`));
      return { which, ts, n: els.length, bad: bad.slice(0, 8), scrolls: over.slice(0, 5) };
    }, { ts, which });
    results.push(r);
    if (OUT) await page.screenshot({ path: `${OUT}/${which}sel-ts${Math.round(ts * 100)}.png` });
  }
  }
} finally { await browser.close(); server.close(); }
console.log(JSON.stringify(results));
const fails = results.filter((r) => r.bad.length);
console.log(fails.length ? `FAIL ${JSON.stringify(fails)}` : `PASS ${results.length} screens`);
