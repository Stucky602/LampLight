// The combat's pace, measured (ARCHITECTURE §5.7, §14.2): how many enemies are alive, how fast
// they die, what a minute earns, how hard they hit, and how long each kind takes to kill. Kevin,
// Nov 7 2026: "The combat is too fast paced ... fewer slower but stronger enemies." This is how the
// pace dials (tuning.pace) were set: run it, turn a dial with --tune, run it again.
//
//   node tools/bots/pace.mjs [--maps drowned_docks,salt_marsh] [--runs 3] [--minutes 20]
//                            [--mortal | --skilled] [--tune path=value,...] [--neutral]
//                            [--jobs N] [--json file]
//   node tools/bots/pace.mjs --weapons [--minutes 9] [--list flare_gun,...] [--tune ...] [--neutral]
//   node tools/bots/pace.mjs --crowd [--runs 2] [--tune ...] [--neutral]
//
// Runs: the pacing report's (tools/pacing/measure.mjs): the Lamplighter, the three archetypes in
// turn, a fresh profile on the Drowned Docks and a quarter of the harbor on the Salt Marsh.
// --skilled bots can't die and play to --minutes: the rates (alive, kills, XP, and materials a
// minute, time-to-kill). --mortal bots can die: the clear rate (the last boss killed by 25:00),
// damage taken a minute alive, and the levels at 10:00 and 20:00. Both by default.
// --neutral sets every pace dial to what it was before the dials existed (density, cap, speed,
// health, contact, XP, and drops all as in 0.8.0), so one build measures both sides (the
// kill-counted content in the data stays as 0.8.1 set it; the soak's --neutral uses this too).
// --weapons: each base weapon alone (a stand-in character with no mechanic and no lamp, its pool
// only that weapon, a bot that can't die): its own kills and damage a minute, and its hits to
// kill and seconds from first hit to death on each kind it killed, by minute (0-3, 3-6, 6 on:
// enemy health grows with the minute), with the weapon's level and yours at 3:00, 6:00, and the end.
// --crowd: a Flare Gun alone stands still in the crowd from 2:00 (crowdRun): how many gather, and
// how long a crowd of each size holds (the Watchman's feat and Rattle).
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { buildRunResult } from '../../src/sim/run-result.js';
import { createKiteBot } from '../../src/sim/bot.js';
import { xpToNext } from '../../src/sim/player.js';
import { EV } from '../../src/sim/events.js';
import { EF, EF_GONE } from '../../src/sim/constants.js';
import { measureConfig } from '../pacing/measure.mjs';

const ARCHETYPES = ['projectile_storm', 'orbit_tank', 'burning_ground'];

/** The pace dials as they were before they existed (0.8.0): --neutral. */
export const NEUTRAL = Object.freeze({
  'pace.density': 1, 'pace.maxAlive': 3000, 'pace.speed': 1, 'pace.hp': 1, 'pace.contact': 1, 'pace.xp': 1, 'pace.drops': 1,
});

/** "a.b=1,c.d=2" (or an object of paths) as a tuning override object. */
export function tuningFrom(pairs) {
  const out = {};
  for (const [path, v] of Object.entries(pairs)) {
    const keys = path.split('.');
    let o = out;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
    o[keys.at(-1)] = v;
  }
  return out;
}

/** Every XP point earned so far (levels gained plus the bar). */
function xpEarned(w) {
  let s = w.player.xp;
  for (let L = 1; L < w.player.level; L++) s += xpToNext(w.tuning, L);
  return s;
}

/** Hits and first-hit tick per living enemy (by handle), and the kills they add up to. */
function createKillLog() {
  const first = new Map(), hits = new Map();
  const rows = new Map(); // key -> { n, hits, sec }
  const add = (key, h, sec) => { const r = rows.get(key) ?? { n: 0, hits: 0, sec: 0 }; r.n++; r.hits += h; r.sec += sec; rows.set(key, r); };
  return {
    rows,
    read(w, keyOf) {
      const ev = w.events;
      for (let i = 0; i < ev.count; i++) {
        const t = ev.type[i];
        if (t === EV.HIT) {
          const h = ev.b[i];
          if (!first.has(h)) first.set(h, w.tick);
          hits.set(h, (hits.get(h) ?? 0) + 1);
        } else if (t === EV.KILL) {
          const h = ev.d[i];
          if ((ev.b[i] & 3) === 0 && first.has(h)) {
            const key = keyOf(ev.a[i], ev.c[i]);
            if (key !== null) add(key, hits.get(h), (w.tick - first.get(h)) / 60);
          }
          first.delete(h); hits.delete(h);
        }
      }
      // Forget enemies that left without dying (swarmers flying off, eels sinking).
      if (w.tick % 3600 === 0) for (const [h, t0] of first) if (w.tick - t0 > 3600) { first.delete(h); hits.delete(h); }
    },
  };
}

const levelBand = (L) => (L <= 10 ? '1-10' : L <= 20 ? '11-20' : L <= 30 ? '21-30' : '31+');

/**
 * The run config a measured run plays with: the pacing report's (tools/pacing/measure.mjs), a
 * fresh profile on the Drowned Docks and a quarter of the harbor on the Salt Marsh (the first stage
 * it's open at), the Lamplighter, a standard run; its seed is this tool's own.
 */
function paceConfig(map, k, skilled, tune) {
  const cfg = measureConfig(k, skilled, map, map === DATA.maps[0].id ? 0 : 1);
  return { ...cfg, seed: `pace-${map}-${k}`, tuning: tuningFrom(tune) };
}

/** One run: the numbers the report needs. */
export function paceRun({ map, k, minutes, skilled, tune }) {
  const archetype = ARCHETYPES[k % ARCHETYPES.length];
  const w = createWorld(paceConfig(map, k, skilled, tune), DATA);
  const bot = createKiteBot({ archetype, stay: false });
  const log = createKillLog();
  const names = DATA.enemies.map((e) => e.id);
  let aliveSum = 0, aliveTicks = 0, peak = 0, peakAt = 0;
  const marks = {};
  // What the kill-counted things see (sim/hooks.js, sim/world.js crowdStep), at several counts
  // each, so a count can be picked that's as reachable as before: the longest stand among N
  // enemies within 56 px (the Watchman); how often N within 60 px held 2 s would sound the
  // Rattle (re-armed under half of N); how often N kills inside 8 s would fire the Bloodied Hook
  // (6 s of fury, then counting again); and kills within 84 px of you (a Fog Bell's ring).
  const CROWD = [10, 15, 20, 25, 30, 40], STREAK = [10, 15, 20, 25, 30, 40];
  const crowdHeld = CROWD.map(() => 0), crowdBest = CROWD.map(() => 0);
  const rattleHeld = CROWD.map(() => 0), rattleArmed = CROWD.map(() => 1), rattles = CROWD.map(() => 0);
  const killTicks = new Int32Array(480);
  let windowKills = 0;
  const furyUntil = STREAK.map(() => -1), furies = STREAK.map(() => 0);
  let nearKills = 0;
  const limit = (skilled ? minutes : Math.max(minutes, 25)) * 3600;
  while (w.tick < limit && !w.over) {
    stepWorld(w, bot.input(w));
    for (let g = 0; currentHalt(w) && g < 100; g++) decide(w, bot.decide(w, currentHalt(w)));
    const L = w.player.level;
    log.read(w, (type) => `${names[type]}|${levelBand(L)}`);
    const ev = w.events, p = w.player;
    let k = 0;
    for (let i = 0; i < ev.count; i++) {
      if (ev.type[i] !== EV.KILL) continue;
      k++;
      const dx = ev.x[i] - p.x, dy = ev.y[i] - p.y;
      if (dx * dx + dy * dy <= 84 * 84) nearKills++;
    }
    const slot = w.tick % 480;
    windowKills += k - killTicks[slot]; killTicks[slot] = k;
    STREAK.forEach((n, j) => {
      if (furyUntil[j] >= 0 && w.tick < furyUntil[j]) return;
      furyUntil[j] = -1;
      if (windowKills >= n) { furies[j]++; furyUntil[j] = w.tick + 360; }
    });
    if (w.tick % 6 === 0) {
      // (Counted by hand: the world's grid is a tick old here, and its indices moved with the removals.)
      const E = w.enemies;
      let n56 = 0, n60 = 0;
      for (let q = 0; q < E.count; q++) {
        if ((E.flags[q] & EF_GONE) !== 0) continue;
        const dx = E.x[q] - p.x, dy = E.y[q] - p.y, d2 = dx * dx + dy * dy, r = E.radius[q];
        if (d2 <= (56 + r) * (56 + r)) n56++;
        if (d2 <= (60 + r) * (60 + r)) n60++;
      }
      CROWD.forEach((n, j) => {
        if (n56 >= n) {
          crowdHeld[j] += 0.1;
          if (crowdHeld[j] > crowdBest[j]) crowdBest[j] = crowdHeld[j];
        } else crowdHeld[j] = 0;
        if (rattleArmed[j] === 0) { if (n60 < n / 2) rattleArmed[j] = 1; return; }
        if (n60 < n) { rattleHeld[j] = 0; return; }
        rattleHeld[j] += 0.1;
        if (rattleHeld[j] + 1e-9 >= 2) { rattleHeld[j] = 0; rattleArmed[j] = 0; rattles[j]++; }
      });
    }
    let alive = 0;
    const E = w.enemies;
    for (let i = 0; i < E.count; i++) if ((E.flags[i] & EF.DEAD) === 0) alive++;
    aliveSum += alive; aliveTicks++;
    if (alive > peak) { peak = alive; peakAt = w.tick; }
    if (w.tick % 3600 === 0) {
      const m = w.tick / 3600;
      if (m === 10 || m === 18 || m === 20) marks[m] = { level: L, alive, xp: xpEarned(w), kills: w.result.totalKills, mats: w.result.materialsRaw.reduce((a, b) => a + b, 0) };
    }
  }
  const r = buildRunResult(w);
  const sec = w.tick / 60;
  const mats = {};
  DATA.materials.forEach((m, i) => { if (w.result.materialsRaw[i] > 0) mats[m.id] = w.result.materialsRaw[i]; });
  return {
    map, k, archetype, skilled, minutes: sec / 60,
    end: r.end, cleared: r.bossesKilled.length >= 2, bosses: r.bossesKilled.length,
    aliveAvg: aliveSum / aliveTicks, alivePeak: peak, peakAt: peakAt / 3600,
    kills: r.totalKills, xp: xpEarned(w), mats, matTotal: Object.values(mats).reduce((a, b) => a + b, 0),
    damageTaken: w.result.damageTaken, level: w.player.level, marks,
    ttk: Object.fromEntries(log.rows),
    killsByType: Object.fromEntries(DATA.enemies.map((e, i) => [e.id, w.result.killsByType[i]]).filter(([, n]) => n > 0)),
    reliquaries: w.result.reliquaries, bellsRung: w.result.bellsRung, lampsLit: w.result.lampsLit,
    crowd: Object.fromEntries(CROWD.map((n, j) => [n, Math.round(crowdBest[j] * 10) / 10])),
    rattles: Object.fromEntries(CROWD.map((n, j) => [n, rattles[j]])),
    furies: Object.fromEntries(STREAK.map((n, j) => [n, furies[j]])),
    nearKills,
  };
}

/** A base weapon alone for `minutes`: its own kills, damage, and time-to-kill by its level. */
export function weaponRun({ weapon, minutes, tune, seed = 'pace-weapon' }) {
  const trial = { id: 'trial', name: 'Trial', desc: 'A stand-in.', sprite: 'pc_lamplighter', start: weapon, innate: null, base: { maxHp: 100 }, unlock: 'starter' };
  const data = { ...DATA, characters: [...DATA.characters, trial] };
  const pools = { weapons: [weapon], passives: [], relics: [], runes: [] };
  const w = createWorld({ seed, character: 'trial', map: 'drowned_docks', invulnerable: true, pools, tuning: tuningFrom(tune) }, data);
  const bot = createKiteBot({ archetype: 'projectile_storm', stay: true });
  const slot = w.slots.findIndex((x) => x?.def?.id === weapon);
  const log = createKillLog();
  const names = DATA.enemies.map((e) => e.id);
  let kills = 0;
  const levels = [];
  while (w.tick < minutes * 3600 && !w.over) {
    stepWorld(w, bot.input(w));
    for (let g = 0; currentHalt(w) && g < 100; g++) decide(w, bot.decide(w, currentHalt(w)));
    const m = w.tick / 3600;
    const band = m < 3 ? '0-3' : m < 6 ? '3-6' : '6+';
    log.read(w, (type, killer) => (killer === slot ? `${names[type]}|${band}` : null));
    if (w.tick === 3 * 3600 || w.tick === 6 * 3600) levels.push(`${w.slots[slot]?.level}/${w.player.level}`);
    const ev = w.events;
    for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.KILL && ev.c[i] === slot) kills++;
  }
  levels.push(`${w.slots[slot]?.level}/${w.player.level}`);
  return { weapon, minutes, kills, damage: w.result.damageBySlot[slot], level: levels.join(' '), ttk: Object.fromEntries(log.rows) };
}

/**
 * A player who stands in the crowd (the Watchman's feat, the Watchman's Rattle): a stand-in
 * character with only the Flare Gun (its pool only that), who can't die and stands still from 2:00
 * to the end. Every 0.1 s, the enemies within 56 px (the result's crowd) and 60 px (the Rattle):
 * the average by minute, the longest hold at each count, and the Rattles at each count (2 s,
 * again under half of it).
 */
export function crowdRun({ map, minutes, tune, k = 0 }) {
  const trial = { id: 'trial', name: 'Trial', desc: 'A stand-in.', sprite: 'pc_lamplighter', start: 'flare_gun', innate: null, base: { maxHp: 100 }, unlock: 'starter' };
  const data = { ...DATA, characters: [...DATA.characters, trial] };
  const pools = { weapons: ['flare_gun'], passives: [], relics: [], runes: [] };
  const w = createWorld({ seed: `pace-crowd-${map}-${k}`, character: 'trial', map, invulnerable: true, pools, tuning: tuningFrom(tune) }, data);
  const bot = createKiteBot({ archetype: 'projectile_storm', stay: true });
  const still = { mx: 0, my: 0, buttons: 0 };
  const N = [10, 15, 20, 25, 30, 40];
  const held = N.map(() => 0), best = N.map(() => 0), rheld = N.map(() => 0), armed = N.map(() => 1), rattles = N.map(() => 0);
  const first10 = N.map(() => -1), firstRattle = N.map(() => -1); // the minute a hold first reaches 10 s; the first Rattle
  const byMin = [];
  let sum = 0, cnt = 0;
  while (w.tick < minutes * 3600 && !w.over) {
    const frame = bot.input(w);
    stepWorld(w, w.tick < 2 * 3600 ? frame : still);
    for (let g = 0; currentHalt(w) && g < 100; g++) decide(w, bot.decide(w, currentHalt(w)));
    if (w.tick % 6 !== 0 || w.tick < 2 * 3600) continue;
    const E = w.enemies, p = w.player;
    let n56 = 0, n60 = 0;
    for (let q = 0; q < E.count; q++) {
      if ((E.flags[q] & EF_GONE) !== 0) continue;
      const dx = E.x[q] - p.x, dy = E.y[q] - p.y, d2 = dx * dx + dy * dy, r = E.radius[q];
      if (d2 <= (56 + r) * (56 + r)) n56++;
      if (d2 <= (60 + r) * (60 + r)) n60++;
    }
    sum += n56; cnt++;
    if (w.tick % 3600 === 0) { byMin.push(Math.round(sum / cnt)); sum = 0; cnt = 0; }
    N.forEach((n, j) => {
      if (n56 >= n) { held[j] += 0.1; if (held[j] > best[j]) best[j] = held[j]; if (first10[j] < 0 && held[j] + 1e-9 >= 10) first10[j] = w.tick / 3600; } else held[j] = 0;
      if (armed[j] === 0) { if (n60 < n / 2) armed[j] = 1; return; }
      if (n60 < n) { rheld[j] = 0; return; }
      rheld[j] += 0.1;
      if (rheld[j] + 1e-9 >= 2) { rheld[j] = 0; armed[j] = 0; rattles[j]++; if (firstRattle[j] < 0) firstRattle[j] = w.tick / 3600; }
    });
  }
  return { crowd: true, map, byMin, first10: Object.fromEntries(N.map((n, j) => [n, first10[j]])), firstRattle: Object.fromEntries(N.map((n, j) => [n, firstRattle[j]])), best: Object.fromEntries(N.map((n, j) => [n, Math.round(best[j] * 10) / 10])), rattles: Object.fromEntries(N.map((n, j) => [n, rattles[j]])) };
}

function crowdReport(results, maps) {
  for (const map of maps) {
    const rs = results.filter((r) => r.map === map);
    console.log(`\n${map}: a Flare Gun alone, standing still from 2:00 (${rs.length} runs)`);
    console.log(`  within 56 px, by minute from 3:00: ${rs[0].byMin.map((_, i) => f0(avg(rs.map((r) => r.byMin[i])))).join(' ')}`);
    console.log(`  longest hold at N within 56 px (s): ${Object.keys(rs[0].best).map((n) => `${n}: ${f1(avg(rs.map((r) => r.best[n])))}`).join(', ')}`);
    console.log(`  Rattles at N within 60 px for 2 s: ${Object.keys(rs[0].rattles).map((n) => `${n}: ${f1(avg(rs.map((r) => r.rattles[n])))}`).join(', ')}`);
    const when = (key) => Object.keys(rs[0][key]).map((n) => `${n}: ${rs.map((r) => (r[key][n] < 0 ? 'never' : r[key][n].toFixed(1))).join('/')}`).join(', ');
    console.log(`  minute a hold first reaches 10 s, at N within 56 px (each run): ${when('first10')}`);
    console.log(`  minute of the first Rattle, at N (each run): ${when('firstRattle')}`);
  }
}

// ---------------------------------------------------------------- the command

function parseTune(s) {
  const out = {};
  for (const part of String(s || '').split(',').filter(Boolean)) {
    const [k, v] = part.split('=');
    out[k.trim()] = Number(v);
  }
  return out;
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f0 = (x) => (Number.isFinite(x) ? x.toFixed(0) : '-');

function report(results, maps) {
  for (const map of maps) {
    const sk = results.filter((r) => r.map === map && r.skilled);
    const mo = results.filter((r) => r.map === map && !r.skilled);
    console.log(`\n${map}`);
    if (sk.length) {
      const min = avg(sk.map((r) => r.minutes));
      const at = (m, f) => avg(sk.filter((r) => r.marks[m]).map((r) => f(r.marks[m])));
      console.table({
        'skilled (cannot die)': {
          runs: sk.length, minutes: f1(min),
          'alive avg': f0(avg(sk.map((r) => r.aliveAvg))), 'alive peak': f0(avg(sk.map((r) => r.alivePeak))), 'alive at 18:00': f0(at(18, (m) => m.alive)),
          'kills/min': f0(avg(sk.map((r) => r.kills / r.minutes))),
          'XP/min': f0(avg(sk.map((r) => r.xp / r.minutes))),
          'materials/min': f1(avg(sk.map((r) => r.matTotal / r.minutes))),
          'level 10:00': f1(at(10, (m) => m.level)), 'level 20:00': f1(at(20, (m) => m.level)),
          'XP by 10:00': f0(at(10, (m) => m.xp)), 'XP by 20:00': f0(at(20, (m) => m.xp)),
        },
      });
      const mats = {};
      for (const r of sk) for (const [id, n] of Object.entries(r.mats)) mats[id] = (mats[id] ?? 0) + n / r.minutes / sk.length;
      console.log('materials a minute:', Object.entries(mats).map(([id, n]) => `${id} ${n.toFixed(2)}`).join(', '));
      const ttk = {};
      for (const r of sk) for (const [key, v] of Object.entries(r.ttk)) {
        const t = ttk[key] ??= { n: 0, hits: 0, sec: 0 };
        t.n += v.n; t.hits += v.hits; t.sec += v.sec;
      }
      const rows = {};
      const bandOrder = ['1-10', '11-20', '21-30', '31+'];
      const keys = Object.keys(ttk).sort((a, b) => a.split('|')[0].localeCompare(b.split('|')[0]) || bandOrder.indexOf(a.split('|')[1]) - bandOrder.indexOf(b.split('|')[1]));
      for (const key of keys) {
        const t = ttk[key];
        if (t.n < 20) continue;
        const [enemy, band] = key.split('|');
        (rows[enemy] ??= {})[`L${band} hits`] = (t.hits / t.n).toFixed(1);
        rows[enemy][`L${band} s`] = (t.sec / t.n).toFixed(2);
      }
      const per = (f) => avg(sk.map(f));
      console.log(`kill-counted: Reliquaries ${f1(per((r) => r.reliquaries))} a run, Fog Bells rung ${f1(per((r) => r.bellsRung))}, kills within 84 px ${f0(per((r) => r.nearKills / r.minutes))} a minute`);
      console.log(`  longest stand among N within 56 px (s): ${Object.keys(sk[0].crowd).map((n) => `${n}: ${f1(per((r) => r.crowd[n]))}`).join(', ')}`);
      console.log(`  Rattles a run at N within 60 px for 2 s: ${Object.keys(sk[0].rattles).map((n) => `${n}: ${f1(per((r) => r.rattles[n]))}`).join(', ')}`);
      console.log(`  Bloodied Hook furies a run at N kills in 8 s: ${Object.keys(sk[0].furies).map((n) => `${n}: ${f1(per((r) => r.furies[n]))}`).join(', ')}`);
      const kt = {};
      for (const r of sk) for (const [id, n] of Object.entries(r.killsByType)) kt[id] = (kt[id] ?? 0) + n / sk.length;
      console.log(`  kills a run by kind: ${Object.entries(kt).map(([id, n]) => `${id} ${f0(n)}`).join(', ')}`);
      console.log('time to kill (regular enemies, first hit to death; hits taken), by player level:');
      console.table(rows);
    }
    if (mo.length) {
      console.table({
        'mortal (can die)': {
          runs: mo.length, minutes: f1(avg(mo.map((r) => r.minutes))),
          cleared: `${mo.filter((r) => r.cleared).length}/${mo.length}`, died: `${mo.filter((r) => r.end === 'died').length}/${mo.length}`,
          'boss 1': `${mo.filter((r) => r.bosses >= 1).length}/${mo.length}`,
          'damage taken/min': f1(avg(mo.map((r) => r.damageTaken / r.minutes))),
          'level 10:00': f1(avg(mo.filter((r) => r.marks[10]).map((r) => r.marks[10].level))),
          'level 20:00': f1(avg(mo.filter((r) => r.marks[20]).map((r) => r.marks[20].level))),
          'reached 20:00': `${mo.filter((r) => r.marks[20]).length}/${mo.length}`,
          'kills/min': f0(avg(mo.map((r) => r.kills / r.minutes))),
          'deaths at': mo.filter((r) => r.end === 'died').map((r) => r.minutes.toFixed(1)).join(' ') || '-',
        },
      });
    }
  }
}

function weaponReport(results) {
  const rows = {};
  for (const r of results) {
    const row = rows[r.weapon] = { 'level 3/6/end': r.level, 'kills/min': f0(r.kills / r.minutes), 'damage/min': f0(r.damage / r.minutes) };
    for (const enemy of ['fog_wisp', 'drowned_sailor', 'bilge_rat', 'mud_crab', 'bloater']) {
      for (const band of ['0-3', '3-6', '6+']) {
        const t = r.ttk[`${enemy}|${band}`];
        if (t && t.n >= 3) row[`${enemy.split('_').at(-1)} ${band}`] = `${(t.hits / t.n).toFixed(1)}h ${(t.sec / t.n).toFixed(1)}s`;
      }
    }
  }
  console.table(rows);
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
  parentPort.on('message', (job) => (job ? parentPort.postMessage(job.weapon ? weaponRun(job) : job.crowd ? crowdRun(job) : paceRun(job)) : process.exit(0)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const flag = (name) => process.argv.includes(`--${name}`);
  const tune = { ...(flag('neutral') ? NEUTRAL : {}), ...parseTune(arg('tune', '')) };
  const jobs = Math.max(1, Number(arg('jobs', availableParallelism())));
  const t0 = performance.now();
  let results;
  if (flag('weapons')) {
    const minutes = Number(arg('minutes', 9));
    const named = arg('list', '');
    const weapons = named ? named.split(',') : DATA.weapons.filter((x) => x.unlock !== 'evolution' && !x.innate && x.unlock !== 'innate').map((x) => x.id);
    results = await pool(jobs, weapons.map((weapon) => ({ weapon, minutes, tune })), new URL(import.meta.url));
    results.sort((a, b) => weapons.indexOf(a.weapon) - weapons.indexOf(b.weapon));
    console.log(`Each base weapon alone, ${minutes} minutes, a bot that can't die${Object.keys(tune).length ? `, tuning ${JSON.stringify(tune)}` : ''}:`);
    weaponReport(results);
  } else if (flag('crowd')) {
    const maps = arg('maps', DATA.maps.map((m) => m.id).join(',')).split(',');
    const runs = Number(arg('runs', 2)), minutes = Number(arg('minutes', 20));
    const queue = [];
    for (const map of maps) for (let k = 0; k < runs; k++) queue.push({ crowd: true, map, k, minutes, tune });
    results = await pool(jobs, queue, new URL(import.meta.url));
    crowdReport(results, maps);
  } else {
    const maps = arg('maps', DATA.maps.map((m) => m.id).join(',')).split(',');
    const runs = Number(arg('runs', 3)), minutes = Number(arg('minutes', 20));
    const kinds = flag('skilled') ? [true] : flag('mortal') ? [false] : [true, false];
    const queue = [];
    for (const skilled of kinds) for (const map of maps) for (let k = 0; k < runs; k++) queue.push({ map, k, minutes, skilled, tune });
    results = await pool(jobs, queue, new URL(import.meta.url));
    console.log(`Pace: ${runs} runs a map and kind${Object.keys(tune).length ? `, tuning ${JSON.stringify(tune)}` : ''}.`);
    report(results, maps);
  }
  const json = arg('json', '');
  if (json) writeFileSync(json, JSON.stringify(results, null, 1));
  console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)} s on ${jobs} threads`);
}
