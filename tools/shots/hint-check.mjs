// Workspace check (X6, the sweep's S3b F13): every screen keeps its title and its hint row in view
// at 1280x720 with 100, 125, and 150% text, is no wider than its panel, and has no glossary line over it. Opens each screen through the game's own hooks (a run's
// level-up, chests, Forms, the Reliquary, the Ferryman, the Salt Well, the Fog Bell with a full
// build, pause, Stats, the codex, the run's end after a death and after leaving, the results; the
// harbor's Orders, codex, a weapon's page, a character's Details; the title's screens) and fails
// (exit 1) when a screen's h1 or .hint row leaves the view. Usage: npx vite build first (or
// BUILD=<a built copy>), then node tools/shots/hint-check.mjs [shots dir]. ONLY=<regex> limits it.
import { createRequire } from 'node:module';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
const B = process.env.BUILD || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(new URL('../package.json', import.meta.url).pathname);
const { chromium } = require('playwright-core');
const { serveDir } = await import(B + '/tools/lib/serve.mjs');
const OUT = process.argv[2];
if (OUT) mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const dirs = existsSync('/opt/pw-browsers') ? readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
const CHROME = dirs.map((d) => `/opt/pw-browsers/${d}/chrome-linux64/chrome`).find(existsSync);

// In the page: helpers, then one function per screen (each leaves its screen on top).
const HELP = () => {
  const G = window.__lamplight;
  const S = window.S = {
    frames: (n = 2) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); }),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    until: async (ok, ms = 20000) => { const t0 = performance.now(); while (!ok()) { if (performance.now() - t0 > ms) throw new Error('timeout'); await S.wait(40); } },
    title: async () => { G.ui.closeAll(); await G.scenes.go('title'); await S.frames(2); },
    hub: async () => { G.ui.closeAll(); await G.scenes.go('hub'); await S.until(() => G.hubScene.world); await S.frames(2); },
    click: (key) => { const e = G.ui.top.el.querySelector(`[data-focus="${key}"]`); if (!e) throw new Error(`no ${key}`); G.ui.top.scope.focus(e); e.click(); },
    w: () => G.runScene.world,
    dev: (d) => G.runScene.recorded.decide({ kind: 'dev', ...d }),
    give: (what, ids) => { for (const id of ids) { try { S.dev({ cmd: 'give', what, id }); } catch { /* full */ } } },
    run: async (character = 'lamplighter') => {
      await S.title();
      G.input.sampleFrame = () => ({ mx: 0, my: 0, buttons: 0 });
      G.startRun({ character, seed: 'hint-check', all: true, harbor: { ferry: 5, lampSpeed: 0.5, bellRing: 0.25, tasksOnMap: 1, secretsOnMap: 1 } });
      await S.until(() => G.scenes.name === 'run' && G.runScene.world && G.runScene.world.tick > 3);
      S.dev({ cmd: 'god', on: true });
    },
    halt: async (cls) => { await S.until(() => G.ui.top && new RegExp(cls).test(G.ui.top.el.className), 60000); await S.frames(2); },
    full: async () => {
      const w = S.w();
      S.give('weapon', (w.weaponDefs || []).filter((x) => !x.innate).map((x) => x.id));
      S.give('passive', (w.passiveDefs || []).map((x) => x.id));
      S.give('relic', (w.relicDefs || []).map((x) => x.id).slice(0, 12));
      let k = 0;
      while (w.halts.length && k++ < 40) { const h = w.halts[0]; try { G.runScene.recorded.decide(h.kind === 'ascend' ? { kind: 'keep' } : h.kind === 'draft' ? { kind: 'pick', index: 0 } : { kind: 'ok' }); } catch { w.halts.shift(); } }
      await S.frames(3);
      k = 0;
      while (G.ui.top && k++ < 30) { G.ui.top.scope?.refresh(); if (!G.ui.top.scope?.press()) G.ui.top.onBack?.(); await S.frames(2); }
    },
    die: async () => { const w = S.w(); S.dev({ cmd: 'god', on: false }); S.dev({ cmd: 'spawn', count: 300 }); const iv = setInterval(() => { if (!w.over) w.player.hp = Math.max(w.player.hp, w.stats.maxHp * 0.6); }, 50); await S.wait(4000); clearInterval(iv); w.over = { reason: 1, tick: w.tick }; w.halts.length = 0; await S.halt('end-screen'); await S.wait(800); },
  };
};
const SCREENS = {
  levelup: async () => { await S.run(); await S.full(); S.dev({ cmd: 'level', count: 1 }); await S.halt('levelup'); },
  spoilsEmber: async () => { await S.run(); S.give('weapon', ['harpoon_chain']); S.dev({ cmd: 'chest', boss: true }); S.dev({ cmd: 'ember' }); await S.halt('chest-screen'); const has = (k) => !!__lamplight.ui.top?.el.querySelector(`[data-focus="${k}"]`); for (let i = 0; i < 20 && !has('e0'); i++) { if (has('go')) S.click('go'); await S.wait(300); } await S.until(() => has('e0')); await S.frames(3); },
  spoilsForms: async () => { await SCREENS_IN_PAGE.spoilsEmber(); S.click('e0'); await S.frames(3); },
  formsFull: async () => { await S.run(); await S.full(); S.dev({ cmd: 'ember' }); await S.halt('ascend-screen'); },
  forms: async () => { await S.run(); S.give('weapon', ['harpoon_chain']); S.dev({ cmd: 'ember' }); await S.halt('ascend-screen'); S.click('w0'); await S.frames(3); },
  relicSwap: async () => { await S.run(); S.give('relic', S.w().relicDefs.map((x) => x.id).slice(0, 6)); S.dev({ cmd: 'reliquary' }); await S.halt('relic-screen'); S.click('c0'); await S.frames(3); if (!__lamplight.ui.top.el.querySelector('[data-focus="g0"]')) throw new Error('no swap step'); },
  tavern: async () => { await S.hub(); __lamplight.hubScene.openBuildingForTools('tavern'); await S.frames(3); },
  relicFull: async () => { await S.run(); S.give('relic', S.w().relicDefs.map((x) => x.id).slice(0, 6)); S.dev({ cmd: 'reliquary' }); await S.halt('relic-screen'); },
  ferry: async () => { await S.run(); S.dev({ cmd: 'glass', count: 60 }); S.dev({ cmd: 'warp', ferry: true }); await S.halt('ferry-screen'); },
  well: async () => { await S.run(); S.give('relic', S.w().relicDefs.map((x) => x.id).slice(0, 6)); S.w().halts.push({ kind: 'well', relics: S.w().build.relics.map((r) => r.id) }); await S.halt('well-screen'); },
  bellFull: async () => { await S.run(); await S.full(); const w = S.w(); const options = []; for (let s = 0; s < w.build.weaponSlots; s++) { const sl = w.slots[s]; if (sl?.def) options.push({ kind: 'weapon', slot: s, id: sl.def.id, from: sl.level ?? 1, to: (sl.level ?? 1) + 2 }); } w.build.passives.forEach((ps, i) => options.push({ kind: 'passive', slot: i, id: ps.def.id, from: ps.level, to: Math.min(ps.def.maxLevel, ps.level + 2) })); w.halts.push({ kind: 'bellpick', x: w.player.x, y: w.player.y, options }); await S.halt('bellpick-screen'); },
  pauseFull: async () => { await S.run(); await S.full(); __lamplight.runScene.openPauseForTools(); await S.frames(3); },
  stats: async () => { await S.run(); __lamplight.runScene.openStatsForTools(); await S.frames(3); },
  statsFull: async () => { await S.run(); await S.full(); __lamplight.runScene.openStatsForTools(); await S.frames(3); },
  runCodex: async () => { await S.run(); __lamplight.runScene.openGuideForTools(); await S.frames(3); },
  diedFull: async () => { await S.run('harpooner'); await S.full(); await S.die(); },
  leftFull: async () => { await S.run(); await S.full(); __lamplight.runScene.recorded.decide({ kind: 'leave' }); await S.halt('end-screen'); },
  results: async () => { await SCREENS_IN_PAGE.leftFull(); S.click('harbor'); await S.until(() => __lamplight.scenes.name === 'hub' && __lamplight.ui.top && /results/.test(__lamplight.ui.top.el.className)); await S.frames(3); },
  orders: async () => { await S.hub(); __lamplight.hubScene.openOrdersForTools(); await S.frames(3); },
  codex: async () => { await S.hub(); __lamplight.hubScene.openMenuCodexForTools(); await S.frames(3); },
  weaponPage: async () => { await S.hub(); __lamplight.hubScene.openCodexForTools(); await S.frames(2); S.click('x:weapon:flare_gun'); await S.frames(3); },
  details: async () => { await S.hub(); __lamplight.hubScene.openGateForTools(); await S.frames(2); if (/map-screen/.test(__lamplight.ui.top.el.className)) S.click('m0'); await S.frames(2); __lamplight.ui.top.onAction('reroll'); await S.frames(3); },
  pasteBox: async () => { await S.title(); S.click('savecode'); await S.frames(2); __lamplight.ui.top.showPasteBox(); __lamplight.ui.top.say('The clipboard couldn\'t be read here.'); document.activeElement.blur(); await S.frames(3); },
  glossary: async () => { await S.title(); S.click('glossary'); await S.frames(3); },
};

const { server, url } = await serveDir(B + '/dist');
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failed = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${url}/?smoke=100000&shot=title&rich=1`);
  await page.waitForFunction(() => window.__lamplight?.ui?.top, null, { timeout: 60000 });
  await page.evaluate(HELP);
  // The screens' functions go into the page as text (each refers to the others as SCREENS_IN_PAGE).
  await page.evaluate((src) => { window.SCREENS_IN_PAGE = (0, eval)(`(${src})`); }, `{${Object.entries(SCREENS).map(([k, f]) => `${k}: ${f.toString()}`).join(',\n')}}`);
  await page.evaluate(() => { const d = structuredClone(__lamplight.profile); for (const id of ['lamplighter', 'harpooner', 'punter', 'bog_warden', 'drowned_man', 'tide_priest']) d.profile.characters[id] = { unlocked: true, masteryXp: 99999, skills: [] }; __lamplight.useProfileForTools(d); });
  for (const ts of [1, 1.25, 1.5]) {
    for (const name of Object.keys(SCREENS)) {
      if (ONLY && !ONLY.test(name)) continue;
      let r;
      try {
        await page.evaluate((n) => __lamplight.ui.setTextScale(n), ts);
        await page.evaluate((n) => window.SCREENS_IN_PAGE[n](), name);
        await page.waitForTimeout(300);
        r = await page.evaluate(() => {
          const ui = __lamplight.ui, s = ui.top, v = ui.view.getBoundingClientRect();
          const inView = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.top >= v.top - 1 && b.bottom <= v.bottom + 1 && b.left >= v.left - 1 && b.right <= v.right + 1; };
          const panel = s.el.querySelector('.panel');
          // (X6) The panel no wider than itself, and the glossary's line over no panel (unless it is in the panel's own hint row).
          const wide = panel ? panel.scrollWidth - panel.clientWidth : 0;
          const gh = ui.view.querySelector('.gloss-hint:not([hidden])');
          let glossOver = 0;
          if (gh && panel && !panel.contains(gh) && getComputedStyle(gh).visibility !== 'hidden') { const g = gh.getBoundingClientRect(), p = panel.getBoundingClientRect(); const ox = Math.min(g.right, p.right) - Math.max(g.left, p.left), oy = Math.min(g.bottom, p.bottom) - Math.max(g.top, p.top); if (ox > 1 && oy > 1) glossOver = Math.round(ox * oy); }
          return { cls: s.el.className, title: inView(s.el.querySelector('h1')), hint: inView(s.el.querySelector('.hint')), scrolled: panel ? panel.scrollTop : 0, wide, glossOver };
        });
      } catch (e) { r = { error: String(e.message || e).slice(0, 160) }; }
      const bad = r.error || r.hint === false || r.title === false || r.scrolled > 1 || r.wide > 1 || r.glossOver > 0;
      const line = `[${ts}] ${name}: ${r.error ? `ERROR ${r.error}` : `${r.cls} title ${r.title} hint ${r.hint}${r.scrolled > 1 ? ` panel scrolled ${r.scrolled}px` : ''}${r.wide > 1 ? ` panel ${r.wide}px wider than itself` : ''}${r.glossOver ? ` glossary line over the panel (${r.glossOver} px²)` : ''}`}`;
      console.log(bad ? `FAIL ${line}` : `ok   ${line}`);
      if (bad) failed.push(line);
      if (OUT) await page.screenshot({ path: `${OUT}/hint-${ts}-${name}.png` }).catch(() => {});
    }
  }
} finally { await browser.close(); server.close(); }
if (failed.length) { console.log(`\n${failed.length} screen(s) failed.`); process.exit(1); }
console.log('\nEvery screen keeps its title and hint row in view.');
