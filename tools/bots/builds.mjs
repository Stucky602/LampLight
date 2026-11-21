// How much a run's build is a choice (0.9.0, W1): bots play whole runs from a harbor stage's profile
// (tools/pacing/stages.mjs) with the player's own pools, and the report says how often runs end
// with the same build, how many cards a draft offers, how many levels pay nothing after 15:00, and
// how the relic pool and slots are used. W1b (ruling 10) adds the pace: kills in the minute before
// 5:00, 10:00, and 15:00, the level at each, and the rarities of the weapon upgrades taken.
//
//   node tools/bots/builds.mjs [--stages 0,2] [--maps drowned_docks] [--seeds 2] [--minutes 21]
//                              [--archetypes a,b] [--jobs 2] [--json out.json]
//                              [--tune weaponUps.value.damage=0.3,forms.steps=8/8/8]   (a run's tuning overrides; a/b/c is a list)
//
// Each run is the kite bot following the edge arrows (as V2's judge played), a bot that can die,
// one run per archetype and seed. A "build" is the weapons and passives carried at the end.

import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { createKiteBot, TAGS_BY_ARCHETYPE } from '../../src/sim/bot.js';
import { runConfigFor } from '../../src/meta/runconfig.js';
import { stageProfile } from '../pacing/stages.mjs';
import { EV, GIFT, END } from '../../src/sim/events.js';

/** 'a.b=1,c=2/3' as a nested tuning override ({ a: { b: 1 }, c: [2, 3] }). */
export function parseTune(text) {
  const out = {};
  for (const part of String(text || '').split(',').filter(Boolean)) {
    const [path, v] = part.split('=');
    const keys = path.trim().split('.');
    let o = out;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    o[keys.at(-1)] = v.includes('/') ? v.split('/').map(Number) : Number(v);
  }
  return out;
}

export function buildRun({ map, stage, archetype, seed, minutes, tune = '' }) {
  const doc = stageProfile(DATA, stage);
  const base = runConfigFor(doc, DATA, { character: 'lamplighter', seed, map });
  const t = parseTune(tune);
  const cfg = Object.keys(t).length ? { ...base, tuning: { ...(base.tuning || {}), ...t } } : base;
  const w = createWorld(cfg, DATA);
  const bot = createKiteBot({ archetype, follow: true });
  const out = {
    map, stage, archetype, seed, drafts: 0, cards: 0, short: 0, dry: 0, dryLate: 0, halts: {},
    pool: { weapons: cfg.pools.weapons.length, passives: cfg.pools.passives.length, relics: cfg.pools.relics.length },
    slots: { weapons: w.build.weaponSlots, passives: w.build.passiveSlots ?? 6, relics: w.build.relicSlots ?? null },
    relicOffers: 0, relicSwaps: 0, skips: 0,
    kills: {}, levels: {}, formsAt: {},
  };
  const marks = [4, 5, 9, 10, 14, 15];
  while (w.tick < minutes * 3600 && !w.over) {
    stepWorld(w, bot.input(w));
    if (w.tick % 3600 === 0 && marks.includes(w.tick / 3600)) { const m = w.tick / 3600; out.kills[m] = w.result.totalKills; out.levels[m] = w.player.level; out.formsAt[m] = w.result.ascensions.length; }
    const ev = w.events;
    for (let i = 0; i < ev.count; i++) {
      if (ev.type[i] === EV.LEVEL_GIFT && ev.a[i] !== GIFT.EMBER) { out.dry++; if (w.tick >= 15 * 3600) out.dryLate++; }
    }
    for (let g = 0; currentHalt(w) && g < 100; g++) {
      const h = currentHalt(w);
      out.halts[h.kind] = (out.halts[h.kind] || 0) + 1;
      if (h.kind === 'draft') { out.drafts++; out.cards += h.offer.length; if (h.offer.length < 3) out.short++; }
      if (h.kind === 'relic') out.relicOffers++;
      const d = bot.decide(w, h);
      if (h.kind === 'relic' && d.swap !== undefined) out.relicSwaps++;
      if (h.kind === 'draft' && d.kind === 'skip') out.skips++;
      decide(w, d);
    }
  }
  out.minutes = +(w.tick / 3600).toFixed(1);
  out.end = w.over ? w.over.reason ?? String(w.over) : 'time';
  out.weapons = w.slots.slice(0, w.build.weaponSlots).filter((s) => s && s.def).map((s) => s.def.id).sort();
  out.weaponLevels = w.slots.slice(0, w.build.weaponSlots).filter((s) => s && s.def).map((s) => `${s.def.id}:${s.level}${s.ascensions?.length ? `+${s.ascensions.length}F` : ''}`);
  out.passives = w.build.passives.map((p) => p.def.id).sort();
  out.relics = w.build.relics.map((r) => r.id).sort();
  out.forms = w.result.ascensions.length;
  out.level = w.player.level;
  out.died = !!w.over && w.over.reason === END.DIED;
  out.rolls = w.result.upRolls ? [...w.result.upRolls] : null;
  out.weaponUps = w.result.weaponUps ?? null;
  for (const m of [5, 10, 15]) out[`kpm${m}`] = out.kills[m] !== undefined && out.kills[m - 1] !== undefined ? out.kills[m] - out.kills[m - 1] : null;
  return out;
}

const mode = (list) => {
  const n = new Map();
  for (const x of list) n.set(x, (n.get(x) || 0) + 1);
  let best = null, bestN = 0;
  for (const [k, v] of n) if (v > bestN) { best = k; bestN = v; }
  return { best, n: bestN, distinct: n.size };
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function report(results) {
  const rows = {};
  const groups = new Map();
  for (const r of results) {
    const k = `${r.map} s${r.stage}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, rs] of groups) {
    const ws = mode(rs.map((r) => r.weapons.join(','))), ps = mode(rs.map((r) => r.passives.join(',')));
    const full = mode(rs.map((r) => `${r.weapons.join(',')}|${r.passives.join(',')}`));
    const drafts = rs.reduce((s, r) => s + r.drafts, 0), cards = rs.reduce((s, r) => s + r.cards, 0), short = rs.reduce((s, r) => s + r.short, 0);
    rows[k] = {
      runs: rs.length,
      'pool w/p/r': `${rs[0].pool.weapons}/${rs[0].pool.passives}/${rs[0].pool.relics}`,
      'slots w/p/r': `${rs[0].slots.weapons}/${rs[0].slots.passives}/${rs[0].slots.relics ?? '-'}`,
      'same weapons': `${ws.n}/${rs.length}`,
      'same passives': `${ps.n}/${rs.length}`,
      'same build': `${full.n}/${rs.length}`,
      'distinct builds': full.distinct,
      'cards/draft': (drafts ? cards / drafts : 0).toFixed(2),
      'short drafts': `${short}/${drafts}`,
      'dry levels': mean(rs.map((r) => r.dry)).toFixed(1),
      'dry after 15:00': mean(rs.map((r) => r.dryLate)).toFixed(1),
      'relics held': mean(rs.map((r) => r.relics.length)).toFixed(1),
      'relic swaps': mean(rs.map((r) => r.relicSwaps)).toFixed(1),
      forms: mean(rs.map((r) => r.forms)).toFixed(1),
      'ended at': mean(rs.map((r) => r.minutes)).toFixed(1),
    };
  }
  console.table(rows);
  // The pace (W1b): kills in the minute before each mark and the level there, over the runs that got there.
  const pace = {};
  for (const [k, rs] of groups) {
    const at = (m, f) => { const xs = rs.map(f).filter((x) => x !== null && x !== undefined); return xs.length ? mean(xs).toFixed(m === 10 || m === 15 ? (xs.every(Number.isInteger) && xs.some((x) => x < 20) ? 1 : 0) : 0) : '-'; };
    const rar = rs.filter((r) => r.rolls);
    pace[k] = {
      'kills/min 5:00': at(5, (r) => r.kpm5), 'kills/min 10:00': at(10, (r) => r.kpm10), 'kills/min 15:00': at(15, (r) => r.kpm15),
      'level 5:00': at(5, (r) => r.levels[5]), 'level 10:00': at(10, (r) => r.levels[10]), 'level 15:00': at(15, (r) => r.levels[15]),
      'Forms 10:00': at(10, (r) => r.formsAt?.[10]), 'Forms 15:00': at(15, (r) => r.formsAt?.[15]),
      'level at end': mean(rs.map((r) => r.level)).toFixed(1), died: `${rs.filter((r) => r.died).length}/${rs.length}`,
      'rarities C/U/R/E/L': rar.length ? [0, 1, 2, 3, 4].map((i) => mean(rar.map((r) => r.rolls[i])).toFixed(1)).join('/') : '-',
    };
  }
  console.table(pace);
}

async function pool(jobs, queue, file) {
  const out = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => new Promise((ok, fail) => {
    const worker = new Worker(file);
    const next = () => worker.postMessage(queue.shift() ?? null);
    worker.on('message', (r) => { out.push(r); next(); });
    worker.on('error', fail);
    worker.on('exit', ok);
    next();
  })));
  return out;
}

if (!isMainThread) {
  parentPort.on('message', (job) => (job ? parentPort.postMessage(buildRun(job)) : process.exit(0)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const stages = arg('stages', '0,2').split(',').map(Number);
  const maps = arg('maps', 'drowned_docks').split(',');
  const seeds = Number(arg('seeds', 2)), minutes = Number(arg('minutes', 21));
  const archetypes = arg('archetypes', Object.keys(TAGS_BY_ARCHETYPE).join(',')).split(',');
  const jobs = Math.max(1, Number(arg('jobs', availableParallelism())));
  const queue = [];
  for (const map of maps) for (const stage of stages) {
    if (map !== 'drowned_docks' && stage === 0) continue; // the Marsh isn't open on a fresh profile
    for (const archetype of archetypes) for (let s = 0; s < seeds; s++) queue.push({ map, stage, archetype, seed: `builds-${s}`, minutes, tune: arg('tune', '') });
  }
  const t0 = performance.now();
  const results = await pool(jobs, queue, new URL(import.meta.url));
  results.sort((a, b) => (a.map + a.stage + a.archetype + a.seed).localeCompare(b.map + b.stage + b.archetype + b.seed));
  report(results);
  const json = arg('json', '');
  if (json) writeFileSync(json, JSON.stringify(results, null, 1));
  console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)} s on ${jobs} threads`);
}
