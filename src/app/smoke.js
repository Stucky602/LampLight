// Smoke test mode (?smoke=<seconds>): play a real run on autopilot for a while, exercise the save
// path end to end, then report. Used by tools/smoke on the packaged desktop app (saves cross the
// real preload bridge into real files) and by tools/shots on the web build (IndexedDB). A pass
// means: it booted, a run ticked and drew, menus answered, it saved and reloaded what it saved,
// wrote a replay and a report, and logged no errors.
//
// Extra query settings (tools/shots uses them to stop on a screen worth looking at):
//   busy=1          god mode, 1,500 extra enemies, and a few weapons, at 14:00 (or at jump=), for
//                   a crowded screen
//   shot=<name>     stop there instead of playing on: title, levelup, chest, pause, settings,
//                   tuning, end (the run's end screen)
//   char=<id>       the character (default: the Lamplighter)
//   jump=<seconds>  start that far into the run (599 shows the first boss arriving)
//   chase=1         walk at the boss once one is out (to see it up close)
// The harbor (Phase 5):
//   shot=hub | building | gate | results | ceremony | arrival | hubtuning
//                   stop in the harbor; with a building's panel open (building=<id>, default the
//                   Library); at the gate; on the results after a run; mid-ceremony as a building
//                   levels up (building=<id>); as the Harpooner's boat comes in; or with the
//                   harbor's tuning panel open
//   levels=<id>:<n>,...  building levels for the (throwaway) smoke profile first
//   shot=loop       play the whole loop through the real screens and saves: the title's first
//                   button to the harbor, restore the Lamp Post from its panel (its ceremony), set
//                   out from the gate with the profile's own pools, leave the run, back to the
//                   harbor, the results; then check the save
//
// Without a shot the smoke walks the harbor for a moment first, then sets out on the run.

import { stampName } from '../save/store.js';
import { currentHalt } from '../sim/world.js';
import { applyRunResult } from '../meta/apply.js';
import { DATA } from '../data/index.js';

const HUB_SHOTS = ['hub', 'building', 'gate', 'results', 'ceremony', 'arrival', 'hubtuning', 'loop'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait until `ok()` (checked every 50 ms), or fail after `ms` naming what never happened. */
async function until(ok, ms, what) {
  const t0 = performance.now();
  while (!ok()) {
    if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

/**
 * The whole loop through the real screens, saves, and meta (shot=loop). Returns
 * { ok, steps: [...], error? }; each step is a short note of what was seen.
 */
async function playLoop(game) {
  const steps = [];
  const note = (s) => steps.push(s);
  try {
    const rich = structuredClone(game.profile);
    for (const m of DATA.materials) rich.profile.materials[m.id] = 500;
    game.useProfileForTools(rich);
    // From the title, the way a player starts: its first button (Start, or Continue) goes to the harbor.
    await game.scenes.go('title');
    await until(() => game.ui.top && /title-screen/.test(game.ui.top.el.className), 2000, 'the title');
    const label = game.ui.top.el.querySelector('[data-focus="start"]')?.textContent;
    game.ui.top.scope.focusKey('start');
    game.ui.top.scope.press();
    await until(() => game.scenes.name === 'hub' && game.hubScene.world, 5000, 'the harbor from the title');
    note(`harbor, from the title's ${label}`);
    // Restore the Lamp Post the way a player does: its panel, its Restore button.
    game.hubScene.openBuildingForTools('lamp_post');
    await until(() => game.ui.top && /building-screen/.test(game.ui.top.el.className), 2000, 'the Lamp Post\'s panel');
    if (!game.ui.top.scope.focusKey('restore') || !game.ui.top.scope.press()) throw new Error('the panel has no Restore button to press');
    await until(() => game.profile.profile.buildings.lamp_post === 1, 2000, 'the Lamp Post to reach level 1');
    note('restored the Lamp Post from its panel');
    // (Headless Chromium draws in software and runs the sim at about half speed: the loop check
    // watches the ceremony start and play a moment, then skips it the way a player can.)
    await until(() => game.hubScene.world?.timeline?.kind === 'ceremony' && game.hubScene.world.timeline.t > 0.5, 10000, 'the ceremony to play');
    note('the ceremony plays');
    game.hubScene.skipForTools();
    await until(() => game.hubScene.world && !game.hubScene.world.timeline, 2000, 'the ceremony to end when skipped');
    if (!game.hubScene.world.revealed.has('lamp_1')) throw new Error('the fog did not clear for the Lamp Post\'s first level');
    note('skipped; the fog is back from the square');
    const saved = await game.store.loadProfile();
    if (saved.doc.profile.buildings.lamp_post !== 1) throw new Error('the restore was not saved');
    note('the restore is saved');
    game.hubScene.openGateForTools();
    await until(() => game.ui.top && /gate-screen/.test(game.ui.top.el.className), 2000, 'the gate');
    game.ui.top.scope.refresh();
    game.ui.top.scope.press();
    await until(() => game.scenes.name === 'run' && game.runScene.world && game.runScene.world.tick > 120, 20000, 'the run to start and tick');
    const cfg = game.runScene.world.config;
    if (!cfg.pools || cfg.pools.weapons.includes('lantern_orb')) throw new Error('the run did not get the profile\'s own pools');
    note(`set out with ${cfg.pools.weapons.length} weapons in the pool`);
    game.runScene.recorded.decide({ kind: 'leave' });
    await until(() => game.ui.top && /end-screen/.test(game.ui.top.el.className), 10000, 'the end of the run');
    game.ui.top.scope.refresh();
    game.ui.top.scope.press();
    await until(() => game.scenes.name === 'hub' && game.ui.top && /results-screen/.test(game.ui.top.el.className), 10000, 'the results in the harbor');
    note('results in the harbor');
    const back = await game.store.loadProfile();
    if (back.doc.stats.runs < 1) throw new Error('the run was not saved into the profile');
    note(`saved: ${back.doc.stats.runs} run(s)`);
    game.ui.top.scope.refresh();
    game.ui.top.scope.press();
    await until(() => !game.ui.open, 2000, 'the results to close');
    note('back in the harbor');
    return { ok: true, steps };
  } catch (e) {
    return { ok: false, steps, error: String(e?.message || e) };
  }
}

/** A run's result for the results screen shot: a short run with a little of everything. */
function sampleResult() {
  return {
    v: 1, seed: 'smoke', map: 'drowned_docks', mode: 'standard', character: 'lamplighter', end: 'died', timeSurvived: 431, ticks: 25860,
    level: 14, kills: { fog_wisp: 210, drowned_sailor: 46 }, totalKills: 256, elitesKilled: 1, bossesKilled: [], cleared: false,
    weapons: [{ id: 'flare_gun', slot: 0, level: 6, runes: [], damage: 1200 }, { id: 'harpoon_chain', slot: 1, level: 3, runes: [], damage: 500 }],
    weaponLevelMax: { flare_gun: 6, harpoon_chain: 3 }, maxWeaponLevel: 6,
    passives: [{ id: 'wick_oil', level: 2 }], relics: [], runes: [], evolutions: [], tags: {},
    materials: { coin: 46, oil: 31, timber: 9, drowned_pages: 7, rope: 4 }, damageTaken: 180, dashKills: 0, revivalsUsed: 0, gems: 400, chests: 1,
    overtimeMinutes: 0, secretsFound: [], rerolls: 0, skips: 0, banished: [],
  };
}

async function storageRoundTrip(game) {
  const { store } = game;
  const out = { label: store.label, ok: false };
  try {
    const probe = structuredClone(game.settings);
    probe.controls.deadzone = probe.controls.deadzone === 0.23 ? 0.24 : 0.23;
    await store.saveSettings(probe);
    const sBack = await store.loadSettings();
    out.settingsRoundTrip = sBack?.controls?.deadzone === probe.controls.deadzone;
    await store.saveSettings(game.settings);
    const doc = structuredClone(game.profile);
    doc.stats.runs = 1;
    await store.saveProfile(doc, { rotate: true });
    doc.stats.runs = 2;
    doc.profile.materials.oil = 17;
    await store.saveProfile(doc, { rotate: true });
    const back = await store.loadProfile();
    out.reloadedFrom = back.source;
    out.reloadedRuns = back.doc?.stats?.runs;
    out.replay = await store.writeReplay(stampName('smoke.lamprep'), new Uint8Array([1, 2, 3, 4]));
    out.report = await store.writeReport(stampName('smoke-report.json'), game.reportText('smoke test'));
    out.ok = out.settingsRoundTrip && back.source === 'main' && back.doc.stats.runs === 2 && back.doc.profile.materials.oil === 17 && !!out.replay && !!out.report;
  } catch (e) {
    out.error = String(e?.message || e);
  }
  return out;
}

export function runSmoke(game, { native = null, seconds = 30, params = new URLSearchParams() } = {}) {
  const { loop, errors, renderer, ui, runScene } = game;
  const shot = params.get('shot') || '';
  const startWall = performance.now();
  let frames = 0, worstFrame = 0, last = startWall, angle = 0, pressAt = 0, pressed = 0;
  let setupDone = false, shotDone = false, settled = false, settleFrames = 0;
  const runTicksAt = { start: null };

  // Scripted input: walk in a slow circle, dash every 2 seconds. With chase=1, walk straight at
  // the first living boss instead (so a screenshot can show one up close).
  const chase = params.get('chase') === '1';
  game.input.sampleFrame = () => {
    angle += 0.02;
    const t = performance.now() - startWall;
    const w = runScene.world;
    if (chase && w) {
      for (const b of w.bosses) {
        const e = b.alive ? w.enemies.resolve(b.handle) : -1;
        if (e < 0) continue;
        const dx = w.enemies.x[e] - w.player.x, dy = w.enemies.y[e] - w.player.y, d = Math.hypot(dx, dy);
        if (d < 70) return { mx: 0, my: 0, buttons: 0 };
        return { mx: Math.round((dx / d) * 127), my: Math.round((dy / d) * 127), buttons: 0 };
      }
    }
    return { mx: Math.round(Math.cos(angle) * 127), my: Math.round(Math.sin(angle) * 127), buttons: t % 2000 < 100 ? 1 : 0 };
  };
  const unpause = () => { for (const r of loop.pauseReasons()) if (r === 'blur' || r === 'controller') loop.resume(r); };
  unpause();
  const storage = storageRoundTrip(game);
  // A throwaway profile with the building levels asked for (the smoke's saves live in their own space).
  if (params.get('levels')) {
    const d = structuredClone(game.profile);
    for (const kv of params.get('levels').split(',')) { const [id, n] = kv.split(':'); d.profile.buildings[id] = Number(n); }
    game.useProfileForTools(d);
  }
  const hubShot = HUB_SHOTS.includes(shot);
  let hubSeen = false;
  if (shot === 'title') { /* stay on the title */ } else if (hubShot) setTimeout(() => hubStop(), 300);
  else {
    // Walk the harbor for a moment (it has to draw without errors too), then set out.
    setTimeout(() => {
      game.scenes.go('hub').then(() => setTimeout(() => {
        hubSeen = !!game.hubScene.world && game.hubScene.world.time > 0;
        game.startRun({ character: params.get('char') || 'lamplighter', seed: 'smoke', all: true });
      }, 1500));
    }, 300);
  }

  let loopResult = null;
  async function hubStop() {
    // The storage round trip writes the same save; the loop checks what it saved, so it goes after.
    if (shot === 'loop') { await storage; loopResult = await playLoop(game); hubSeen = loopResult.ok; return; }
    const building = params.get('building') || (shot === 'arrival' ? 'tavern' : 'library');
    if (shot === 'results') {
      const out = applyRunResult(game.profile, sampleResult(), DATA);
      game.useProfileForTools(out.doc);
      await game.scenes.go('hub', { results: { changes: out.changes, result: sampleResult() } });
    } else await game.scenes.go('hub');
    if (shot === 'building') game.hubScene.openBuildingForTools(building);
    if (shot === 'gate') game.hubScene.openGateForTools();
    if (shot === 'hubtuning') game.hubScene.toggleTuningForTools();
    if (shot === 'ceremony' || shot === 'arrival') {
      const d = structuredClone(game.profile);
      for (const m of DATA.materials) d.profile.materials[m.id] = 999;
      game.useProfileForTools(d);
      // The arrival shot skips the Tavern's ceremony, so the boat is out on the water in time.
      setTimeout(() => { game.hubScene.restoreForTools(building); if (shot === 'arrival') game.hubScene.skipForTools(); }, 400);
    }
    hubSeen = true;
  }

  function setup(w) {
    const rec = runScene.recorded;
    // A command the sim refuses shows up in the result's errors instead of stopping the run.
    const dev = (d) => { try { rec.decide({ kind: 'dev', ...d }); } catch (e) { errors.add('smoke', `setup: ${e?.message || e}`); } };
    dev({ cmd: 'god', on: true });
    // jump=<seconds>: start later in the run (a boss arrives at 600 and 1200). busy=1 starts at
    // 14:00 unless jump says otherwise.
    const jump = Number(params.get('jump'));
    if (params.get('busy')) {
      for (const id of ['lantern_orb', 'tide_bell', 'harpoon_chain']) dev({ cmd: 'give', what: 'weapon', id });
      for (let k = 0; k < 4; k++) for (const id of ['flare_gun', 'lantern_orb']) dev({ cmd: 'give', what: 'weapon', id });
      dev({ cmd: 'jump', to: jump > 0 ? jump : 840 });
      dev({ cmd: 'spawn', count: 1500 });
    } else if (jump > 0) dev({ cmd: 'jump', to: jump });
    if (shot === 'levelup') dev({ cmd: 'level', count: 1 });
    if (shot === 'chest') dev({ cmd: 'give', what: 'weapon', id: 'harpoon_chain' });
    runTicksAt.start = w.tick;
  }

  function stopOn() {
    // Stop the scripted play at the screen the screenshot wants.
    if (shotDone) return;
    const w = runScene.world;
    // Let the run tick at least once first (a pause at tick 0 would prove nothing ran).
    if (!w || runTicksAt.start === null || w.tick <= runTicksAt.start) return;
    if (shot === 'pause') { shotDone = true; runScene.openPauseForTools?.(); }
    if (shot === 'tuning' && w) { shotDone = true; runScene.toggleTuningForTools?.(); }
    if (shot === 'settings') { shotDone = true; runScene.openSettingsForTools?.(); }
    if (shot === 'end' && w) { shotDone = true; runScene.recorded.decide({ kind: 'leave' }); }
    if (shot === 'chest' && w) { shotDone = true; runScene.openChestForTools?.(); }
  }

  const tick = async () => {
    const now = performance.now();
    frames++;
    worstFrame = Math.max(worstFrame, now - last);
    last = now;
    unpause();
    const w = runScene.world;
    if (w && !setupDone && game.scenes.name === 'run') { setupDone = true; setup(w); }
    if (setupDone && now - startWall > 2500) stopOn();
    // Answer menus the way a player would, a few times a second (unless a screenshot wants one).
    const holdScreen = shot && shot !== 'run' && (shot !== 'levelup' || (ui.top && /levelup/.test(ui.top.el.className)));
    if (!holdScreen && ui.top && game.scenes.name === 'run' && now - pressAt > 250) {
      pressAt = now;
      ui.top.scope?.refresh();
      if (ui.top.scope?.press()) pressed++;
    }
    // (The loop check runs until it's done, up to a minute.)
    if (now - startWall < seconds * 1000 || (shot === 'loop' && !loopResult && now - startWall < 60000)) { requestAnimationFrame(tick); return; }
    // A gameplay screenshot wants the run itself: answer anything still open, then let a few
    // frames draw without it before the picture is taken.
    if (shot === 'run' && !settled) {
      for (let k = 0; k < 8 && ui.top; k++) { ui.top.scope?.refresh(); ui.top.scope?.press(); }
      if (ui.top) { requestAnimationFrame(tick); return; }
      settled = true;
      settleFrames = 3;
    }
    if (settleFrames > 0) { settleFrames--; requestAnimationFrame(tick); return; }
    const wallS = (now - startWall) / 1000;
    const runTicks = w && runTicksAt.start !== null ? w.tick - runTicksAt.start : 0;
    const store = await storage;
    const result = {
      ok: errors.count === 0 && frames > 0 && store.ok && (shot === 'title' || shot === 'settings' || (hubShot ? hubSeen : runTicks > 0 && hubSeen)),
      hub: hubSeen,
      loop: loopResult,
      seconds: Math.round(wallS * 10) / 10,
      scene: game.scenes.name,
      runTicks,
      ticksPerSecond: Math.round((runTicks / wallS) * 10) / 10,
      menuPresses: pressed,
      frames,
      fps: Math.round((frames / wallS) * 10) / 10,
      worstFrameMs: Math.round(worstFrame),
      bootMs: Math.round(game.bootMs),
      renderer: renderer.app.renderer.name || renderer.app.renderer.type,
      layout: renderer.layout,
      enemies: w?.enemies.count ?? 0,
      halted: w ? currentHalt(w)?.kind ?? null : null,
      storage: store,
      errors: errors.items,
    };
    window.__smokeResult = result;
    if (native) native.smokeDone(result);
  };
  requestAnimationFrame(tick);
}
