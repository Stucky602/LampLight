// The Harpooner trials (HANDOFF.md, ARCHITECTURE §20 call 44): Kevin's idea of a bonus for
// standing still, next to the alternatives, each played by the kiting bot on the same seeds.
// This is how the table in HANDOFF.md is made; run it again after changing her kit.
//
//   node tools/bots/harpooner-trials.mjs [--runs 12] [--minutes 24] [--jobs N] [--variants a,b]
//
// Variants (the one that shipped is "daze"):
//   phase3        her Phase 3 kit (no daze), kiting
//   still         no daze; she holds her ground in the crowd she reels in (see canHold), no bonus
//   still_armor4  as "still", with +4 armor while she stands still
//   still_armor8  as "still", with +8 armor
//   still_regen   as "still", healing 1 HP a second while she stands still
//   still_might   as "still", with 30% more damage while she stands still
//   rest          no daze; she stands still only when nothing is near her (see canRest), no bonus
//   rest_might    as "rest", with 30% more damage while she stands still
//   crowd_x2      no daze, kiting, twice the armor per nearby enemy
//   daze          what shipped: kiting, and what she hits is dazed (her data's `daze`)
//
// Run k plays seed "trial-k" with the bot's archetype k mod 6, so every variant meets the same
// runs. The variants are made here, in this process only: a changed copy of her data, and for
// the standing-still bonus a hook that exists only while this tool runs. Nothing in the game is
// changed by running it.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { buildRunResult } from '../../src/sim/run-result.js';
import { createKiteBot, TAGS_BY_ARCHETYPE } from '../../src/sim/bot.js';
import { HOOKS, api } from '../../src/sim/hooks.js';
import { EF, ZONE, PF, DT } from '../../src/sim/constants.js';
import { heal } from '../../src/sim/player.js';
import { BOSS_STATE } from '../../src/sim/bosses.js';
import { midAttack } from '../../src/sim/enemies.js';

const HARPOONER = DATA.characters.find((c) => c.id === 'harpooner');
const BASE = HARPOONER.mechanic.params;

export const VARIANTS = Object.freeze({
  phase3: { label: 'As in Phase 3, kiting', params: { daze: 0 } },
  still: { label: 'Holding her ground, no bonus', params: { daze: 0 }, still: 'hold' },
  still_armor4: { label: 'Holding her ground, +4 armor while still', params: { daze: 0, stillArmor: 4 }, still: 'hold', hook: 'trial_harpooner_still' },
  still_armor8: { label: 'Holding her ground, +8 armor while still', params: { daze: 0, stillArmor: 8 }, still: 'hold', hook: 'trial_harpooner_still' },
  still_regen: { label: 'Holding her ground, +1 HP a second while still', params: { daze: 0, stillRegen: 1 }, still: 'hold', hook: 'trial_harpooner_still' },
  still_might: { label: 'Holding her ground, +30% damage while still', params: { daze: 0, stillMight: 0.3 }, still: 'hold', hook: 'trial_harpooner_still' },
  rest: { label: 'Standing still only when nothing is near, no bonus', params: { daze: 0 }, still: 'rest' },
  rest_might: { label: 'Standing still only when nothing is near, +30% damage while still', params: { daze: 0, stillMight: 0.3 }, still: 'rest', hook: 'trial_harpooner_still' },
  crowd_x2: { label: 'Kiting, twice the armor per nearby enemy', params: { daze: 0, armorPerNear: BASE.armorPerNear * 2 } },
  daze: { label: `Kiting, what she hits is dazed ${BASE.daze} s (shipped)`, params: {} },
});

// The standing-still bonuses: her own hook, plus armor, healing, or damage on every tick she
// stands (not moving, not dashing).
HOOKS.trial_harpooner_still = {
  needs: HOOKS.harpooner.needs,
  init: HOOKS.harpooner.init,
  onHit: HOOKS.harpooner.onHit,
  onTick(world, h) {
    const p = world.player, P = h.params;
    const still = !p.moving && p.dashTicks === 0;
    const changed = still !== (h.state.still === 1);
    if (world.tick % 6 === 0 || changed) {
      const n = api.queryEnemies(world, p.x, p.y, P.nearRadius, world.scratch.near);
      p.bonusArmor = Math.min(P.cap, n * P.armorPerNear) + (still ? P.stillArmor ?? 0 : 0);
    }
    if (still && P.stillRegen) heal(world, P.stillRegen * DT, true);
    if (changed && P.stillMight) api.markStatsDirty(world);
    h.state.still = still ? 1 : 0;
  },
  modifyStats(world, h, mods) {
    if (h.params.stillMight && h.state.still === 1) mods.push({ stat: 'might', op: 'pct', value: h.params.stillMight });
  },
};

function dataFor(v) {
  const V = VARIANTS[v];
  const mechanic = { hook: V.hook ?? HARPOONER.mechanic.hook, params: { ...BASE, ...V.params } };
  return { ...DATA, characters: DATA.characters.map((c) => (c.id === 'harpooner' ? { ...c, mechanic } : c)) };
}

/**
 * Whether she can hold her ground this tick: the way a player chasing a standing-still bonus
 * plays. She stands in the crowd she reels in and takes its bites, and steps only when an attack
 * has been warned at her (an enemy within 200 px winding up, dashing, or aiming; a boss warning
 * or charging), a shot is within 90 px, she's in or at the edge of a pool, or she's below 40%
 * health.
 */
function canHold(world) {
  const p = world.player, E = world.enemies;
  if (p.hp < world.stats.maxHp * 0.4) return false;
  for (let i = 0; i < E.count; i++) {
    if ((E.flags[i] & EF.DEAD) !== 0) continue;
    const dx = E.x[i] - p.x, dy = E.y[i] - p.y;
    if (dx * dx + dy * dy < 200 * 200 && midAttack(E, i)) return false; // a crab winding up, a gunner aiming
  }
  const P = world.projectiles;
  for (let s = 0; s < P.count; s++) {
    if ((P.flags[s] & PF.HOSTILE) === 0) continue;
    const dx = P.x[s] - p.x, dy = P.y[s] - p.y;
    if (dx * dx + dy * dy < 90 * 90) return false;
  }
  const Z = world.zones;
  for (let z = 0; z < Z.count; z++) {
    if (Z.kind[z] !== ZONE.HAZARD) continue;
    const dx = Z.x[z] - p.x, dy = Z.y[z] - p.y, r = Z.radius[z] + 24;
    if (dx * dx + dy * dy < r * r) return false;
  }
  for (const b of world.bosses) if (b.alive && (b.state === BOSS_STATE.WARN || b.state === BOSS_STATE.CHARGE)) return false;
  return true;
}

/** Whether she can stand still safely: as canHold, and nothing within 36 px of her. */
function canRest(world) {
  if (!canHold(world)) return false;
  const p = world.player, E = world.enemies, PR = world.tuning.player.radius;
  for (let i = 0; i < E.count; i++) {
    if ((E.flags[i] & EF.DEAD) !== 0) continue;
    const dx = E.x[i] - p.x, dy = E.y[i] - p.y;
    if (Math.sqrt(dx * dx + dy * dy) - E.radius[i] - PR < 36) return false;
  }
  return true;
}

/** One run to its end or the time limit. */
export function playOne({ variant, k, minutes }) {
  const data = dataFor(variant);
  const archetype = Object.keys(TAGS_BY_ARCHETYPE)[k % 6];
  const w = createWorld({ seed: `trial-${k}`, character: 'harpooner' }, data);
  const bot = createKiteBot({ archetype });
  const mode = VARIANTS[variant].still;
  const stand = mode === 'hold' ? canHold : mode === 'rest' ? canRest : null;
  let stillTicks = 0;
  while (w.tick < minutes * 3600 && !w.over) {
    const f = bot.input(w);
    if (stand && f.buttons === 0 && stand(w)) { f.mx = 0; f.my = 0; stillTicks++; }
    stepWorld(w, f);
    let g = 0;
    while (currentHalt(w) && g++ < 100) decide(w, bot.decide(w, currentHalt(w)));
  }
  const r = buildRunResult(w);
  return { variant, k, time: r.timeSurvived, died: r.end === 'died', taken: r.damageTaken, still: stillTicks / Math.max(1, w.tick) };
}

const RUN_AS_COMMAND = isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (!isMainThread) {
  // One run at a time, as the main thread hands them out (runs that die early free a thread).
  parentPort.on('message', (job) => {
    if (job === null) process.exit(0);                 // ends this worker thread only
    parentPort.postMessage(playOne(job));
  });
} else if (RUN_AS_COMMAND) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const runs = Number(arg('runs', 12));
  const minutes = Number(arg('minutes', 24));
  const jobs = Math.max(1, Number(arg('jobs', availableParallelism())));
  const variants = arg('variants', Object.keys(VARIANTS).join(',')).split(',');
  const bad = [];
  if (!(Number.isInteger(runs) && runs > 0)) bad.push('--runs must be a whole number above 0');
  if (!(minutes > 0)) bad.push('--minutes must be above 0');
  for (const v of variants) if (!VARIANTS[v]) bad.push(`unknown variant "${v}" (known: ${Object.keys(VARIANTS).join(', ')})`);
  if (bad.length) { console.error(bad.join('\n')); process.exit(2); }

  const all = [];
  for (const variant of variants) for (let k = 0; k < runs; k++) all.push({ variant, k, minutes });
  const queue = all.slice();
  const t0 = performance.now();
  const results = [];
  await Promise.all(Array.from({ length: Math.min(jobs, all.length) }, (_, j) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url));
    const next = () => worker.postMessage(queue.length ? queue.shift() : null);
    worker.on('message', (r) => { results.push(r); next(); });
    worker.on('error', reject);
    worker.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${j} exited with ${code}`))));
    next();
  })));

  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rows = variants.map((v) => {
    const rs = results.filter((r) => r.variant === v);
    const mins = rs.reduce((s, r) => s + r.time / 60, 0);
    return {
      variant: VARIANTS[v].label,
      'average time alive': `${(avg(rs.map((r) => r.time)) / 60).toFixed(1)} min`,
      died: `${rs.filter((r) => r.died).length} of ${rs.length}`,
      'died at minute': rs.filter((r) => r.died).map((r) => Math.floor(r.time / 60)).sort((a, b) => a - b).join(' ') || '-',
      'damage taken per minute': (rs.reduce((s, r) => s + r.taken, 0) / Math.max(1e-9, mins)).toFixed(0),
      'time standing still': VARIANTS[v].still ? `${(avg(rs.map((r) => r.still)) * 100).toFixed(0)}%` : '-',
    };
  });
  console.table(rows);
  console.log(`${all.length} runs of up to ${minutes} min in ${((performance.now() - t0) / 1000).toFixed(0)} s on ${jobs} threads`);
}
