// What each Form is worth (ARCHITECTURE §5.16, §14.2): a kite bot that can't die plays 12 minutes
// as the Lamplighter, starting with one weapon, and at 1:00 that weapon takes one Form (or none,
// the baseline; or all three of its line's, a tick apart, the stack). The report is each against
// the weapon without any: the weapon's own damage (which counts overkill, so area Forms read
// high) and the weapon's own kills (from the kill events' killer slot; capped by what the map
// spawns, so they read a little low). Kevin, 0.7.1: "the ascension crystals are SO powerful"; this is
// how the Forms were measured and toned down in 0.7.2. Phase 9 uses it for the archetype sweep.
//
//   node tools/bots/forms.mjs [weapon ...] [--seeds 2] [--minutes 12] [--jobs N]
//
// With no weapons named, every Form line's base weapon. Runs are spread over worker threads.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { buildRunResult } from '../../src/sim/run-result.js';
import { createKiteBot } from '../../src/sim/bot.js';
import { defaultProfile } from '../../src/save/schema.js';
import { runConfigFor } from '../../src/meta/runconfig.js';
import { EV } from '../../src/sim/events.js';

/**
 * One trial: the weapon's own damage and kills, with `forms` taken from 1:00 (one a tick; none
 * for the baseline). Each Ember is given once, on its own tick, before the world steps.
 */
export function formTrial({ weapon, forms, seed, minutes }) {
  const cfg = runConfigFor(defaultProfile(), DATA, { character: 'lamplighter', seed });
  // No other Embers: elites drop none, and with no Form taken the lines are left out entirely.
  const w = createWorld({ ...cfg, startWeapon: weapon, invulnerable: true, tuning: { embers: { eliteChance: 0 } } },
    { ...DATA, ascensions: forms.length ? DATA.ascensions : [] });
  const bot = createKiteBot({ archetype: 'projectile_storm', stay: true });
  const slot = w.slots.findIndex((x) => x?.def?.id === weapon);
  let given = 0, kills = 0;
  while (w.tick < minutes * 3600) {
    // An Ember stops the world for its choice, so the tick doesn't move until it's answered:
    // count what was given, never the tick, or the same tick gives Embers forever.
    if (given < forms.length && w.tick >= 3600 + given) { decide(w, { kind: 'dev', cmd: 'ember' }); given++; }
    for (let g = 0; currentHalt(w) && g < 100; g++) {
      const h = currentHalt(w);
      // Each Ember takes the next Form on trial; a boss's later Ember is kept.
      const next = forms[(w.slots[slot].ascensions || []).length];
      if (h.kind === 'ascend') decide(w, next && (w.slots[slot].ascensions || []).length < given ? { kind: 'ascend', slot, id: next } : { kind: 'keep' });
      else decide(w, bot.decide(w, h));
    }
    if (currentHalt(w)) throw new Error(`formTrial: stuck on a ${currentHalt(w).kind}`);
    stepWorld(w, bot.input(w));
    const ev = w.events;
    for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.KILL && ev.c[i] === slot) kills++;
  }
  const r = buildRunResult(w);
  return { weapon, forms, seed, damage: r.weapons.find((x) => x.slot === slot)?.damage ?? 0, kills, taken: (w.slots[slot].ascensions || []).map((a) => a.id) };
}

if (!isMainThread) {
  parentPort.on('message', (job) => (job ? parentPort.postMessage(formTrial(job)) : process.exit(0)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Run as a command (the gate imports formTrial without running this).
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
  const named = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  const weapons = named.length ? named : DATA.ascensions.map((l) => l.weapons[0]);
  const seeds = arg('seeds', 2), minutes = arg('minutes', 12), jobs = arg('jobs', availableParallelism());
  const queue = [];
  for (const weapon of weapons) {
    const line = DATA.ascensions.find((l) => l.weapons.includes(weapon));
    if (!line) throw new Error(`No Form line for "${weapon}"`);
    const all = line.options.map((o) => o.id);
    for (const forms of [[], ...all.map((f) => [f]), all]) for (let k = 0; k < seeds; k++) queue.push({ weapon, forms, seed: `forms-${k}`, minutes });
  }
  const out = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => new Promise((ok, fail) => {
    const worker = new Worker(new URL(import.meta.url));
    const next = () => worker.postMessage(queue.shift() ?? null);
    worker.on('message', (r) => { out.push(r); next(); });
    worker.on('error', fail);
    worker.on('exit', ok);
    next();
  })));
  const rows = [];
  for (const weapon of weapons) {
    const sum = (forms, key) => out.filter((r) => r.weapon === weapon && r.forms.join() === forms.join()).reduce((s, r) => s + r[key], 0);
    const all = DATA.ascensions.find((l) => l.weapons.includes(weapon)).options.map((o) => o.id);
    for (const forms of [...all.map((f) => [f]), all]) {
      rows.push({ weapon, forms: forms.length > 1 ? 'all three' : forms[0], damage: `x${(sum(forms, 'damage') / sum([], 'damage')).toFixed(2)}`, kills: `x${(sum(forms, 'kills') / sum([], 'kills')).toFixed(2)}` });
    }
  }
  console.log(`Each Form, and all three together, against the weapon without any: its own damage and kills, ${seeds} seed(s), ${minutes} minutes, a bot that can't die.`);
  console.table(rows);
}
