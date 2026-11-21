// Workspace check (C3): the Tavern skill tree screen for every character at 100, 125, and 150% text: a
// shot of each (optional folder), every element reached by the pad from every other, none off screen
// or clipped. Usage: npm run build first (or BUILD=<a built copy>), then node tools/shots/skills-check.mjs [shots dir].
// C3: the skill tree screen at 100%, 125%, and 150% text, for every character: a shot of each, and
// the pad's walk (focus.js move in four directions from every element): every skill and button
// reached, every one on screen, and nothing clipped by the panel.
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
    g.useProfileForTools(d);
    return ids;
  });
  for (const ts of [1, 1.25, 1.5]) for (const id of chars) {
    const r = await page.evaluate(async ({ id, ts }) => {
      const g = window.__lamplight;
      g.ui.setTextScale(ts);
      g.ui.closeAll?.();
      g.hubScene.openSkillsForTools(id);
      await new Promise((res) => setTimeout(res, 250));
      const top = g.ui.top, scope = top.scope;
      const els = [...top.el.querySelectorAll('[data-focus]')].filter((e) => e.offsetParent !== null);
      const keys = els.map((e) => e.dataset.focus);
      // Every element: on screen, inside the panel, not cut.
      const W = innerWidth, H = innerHeight, bad = [];
      for (const e of els) { const b = e.getBoundingClientRect(); if (b.left < 0 || b.top < 0 || b.right > W + 0.5 || b.bottom > H + 0.5) bad.push(`${e.dataset.focus} off screen`); }
      const panel = top.el.querySelector('.panel');
      const clipped = panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1;
      // The pad's walk: from each element, each direction.
      const seen = new Set([scope.current.dataset.focus]), queue = [scope.current.dataset.focus];
      while (queue.length) {
        const k = queue.shift();
        for (const d of ['up', 'down', 'left', 'right']) {
          scope.focusKey(k); scope.move(d);
          const n = scope.current.dataset.focus;
          if (!seen.has(n)) { seen.add(n); queue.push(n); }
        }
      }
      scope.focusKey(keys[0]);
      return { id, ts, n: keys.length, reached: seen.size, missed: keys.filter((k) => !seen.has(k)), bad, clipped };
    }, { id, ts });
    results.push(r);
    if (OUT) await page.screenshot({ path: `${OUT}/skills-${id}-ts${Math.round(ts * 100)}.png` });
  }
} finally { await browser.close(); server.close(); }
console.log(JSON.stringify(results));
const fails = results.filter((r) => r.missed.length || r.bad.length || r.clipped);
console.log(fails.length ? `FAIL ${JSON.stringify(fails)}` : `PASS ${results.length} screens`);
