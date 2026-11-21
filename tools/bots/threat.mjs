// The threat's reference curve, measured (sim/threat.js; tuning.threat.ref): the median damage a
// second your weapons deal at each minute, over N seeds, as the kite bot plays it. Run this after
// a balance change and paste the last line into tuning.threat.ref.
//
//   node tools/bots/threat.mjs [--runs 12] [--minutes 20] [--maps drowned_docks,salt_marsh]
//                              [--characters lamplighter,harpooner,...] [--mortal] [--follow]
//                              [--tide 0] [--tune path=value,...] [--json file]
//
// What it counts is exactly what the threat counts (world.threat.dealt: weapon slots only, the
// health taken, no overkill; not wards, Lantern Night, thralls, cranes, cairns, or relics). Runs
// rotate the characters, the maps, and the bots' three archetypes; seeds are 'threat-<k>'. By
// default the bot can't die (the curve is the damage of a run that is still going); --mortal lets
// it die and counts a minute only for the runs alive through it. The threat itself is switched off
// while measuring (max 1), so the curve doesn't chase its own tail. It also prints how much of all
// damage dealt the threat doesn't count (not a weapon's, or overkill), and where the current ref would have put the threat.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { createKiteBot } from '../../src/sim/bot.js';
import { refDps } from '../../src/sim/threat.js';
import { fpow } from '../../src/lib/fmath.js';

const ARCHETYPES = ['projectile_storm', 'orbit_tank', 'burning_ground'];

/** The median of a list of numbers (0 for none). */
export function median(list) {
  if (!list.length) return 0;
  const a = list.slice().sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** One run: the weapon damage a second in each whole minute it lived through, and its share of damage that wasn't a weapon's. */
export function threatRun(k, { minutes = 20, maps = ['drowned_docks', 'salt_marsh'], characters = DATA.characters.map((c) => c.id), mortal = false, follow = false, tide = 0, tuning = {} } = {}, data = DATA) {
  const map = maps[k % maps.length], character = characters[Math.floor(k / maps.length) % characters.length];
  const w = createWorld({ seed: `threat-${k}`, map, character, invulnerable: !mortal, tide, tuning: { ...tuning, threat: { ...(tuning.threat || {}), max: 1 } } }, data);
  const bot = createKiteBot({ archetype: ARCHETYPES[k % ARCHETYPES.length], stay: false, follow });
  const perMin = [];
  let last = 0;
  while (w.tick < minutes * 3600 && !w.over) {
    stepWorld(w, bot.input(w));
    for (let g = 0; currentHalt(w) && g < 200; g++) decide(w, bot.decide(w, currentHalt(w)));
    if (w.tick % 3600 === 0) { perMin.push((w.threat.dealt - last) / 60); last = w.threat.dealt; }
  }
  let all = 0;
  for (const v of w.result.damageBySlot) all += v;
  return { k, map, character, perMin, other: all > 0 ? 1 - w.threat.dealt / all : 0, lived: w.tick / 3600 };
}

/** The curve from runs: [[minute, median dps]...] at the middle of each minute, from the runs that lived through it. */
export function medianCurve(runs, minutes) {
  const out = [];
  for (let m = 0; m < minutes; m++) {
    const vals = runs.filter((r) => r.perMin.length > m).map((r) => r.perMin[m]);
    if (vals.length) out.push([m + 0.5, median(vals), vals.length]);
  }
  return out;
}

/** The curve read at the ref's own minutes (straight lines between the measured points; the ends hold). */
export function refFrom(curve, at) {
  const read = (t) => {
    if (!curve.length) return 0;
    if (t <= curve[0][0]) return curve[0][1];
    for (let k = 1; k < curve.length; k++) if (t <= curve[k][0]) { const a = curve[k - 1], b = curve[k]; return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]); }
    return curve[curve.length - 1][1];
  };
  return at.map((t) => [t, Math.round(read(t))]);
}

function parse(argv) {
  const o = { runs: 12, minutes: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--runs') { o.runs = Number(v); i++; } else if (a === '--minutes') { o.minutes = Number(v); i++; } else if (a === '--maps') { o.maps = v.split(','); i++; } else if (a === '--characters') { o.characters = v.split(','); i++; } else if (a === '--tide') { o.tide = Number(v); i++; } else if (a === '--json') { o.json = v; i++; } else if (a === '--mortal') o.mortal = true;
    else if (a === '--follow') o.follow = true;
    else if (a === '--tune') {
      o.tuning = {};
      for (const kv of v.split(',')) { const [path, val] = kv.split('='); const keys = path.split('.'); let t = o.tuning; for (let j = 0; j < keys.length - 1; j++) t = t[keys[j]] ??= {}; t[keys.at(-1)] = Number(val); }
      i++;
    } else throw new Error(`threat.mjs: unknown option ${a}`);
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const o = parse(process.argv.slice(2));
  const runs = [];
  for (let k = 0; k < o.runs; k++) {
    const r = threatRun(k, o);
    runs.push(r);
    console.log(`run ${k} ${r.map} ${r.character}: lived ${r.lived.toFixed(1)} min; weapon damage a second by minute ${r.perMin.map((v) => Math.round(v)).join(' ')}; not counted (not a weapon's, or overkill) ${(100 * r.other).toFixed(0)}%`);
  }
  const curve = medianCurve(runs, o.minutes), T = DATA.tuning.threat;
  console.log(`\nmedian weapon damage a second, ${o.runs} runs${o.mortal ? ' (mortal: runs alive through each minute)' : ''}:`);
  console.log('minute   median   runs   ref now   threat it would set');
  for (const [t, v, n] of curve) {
    const ref = refDps(T, t), mul = t >= T.from && v > ref ? Math.min(T.max, fpow(v / ref, T.exp)) : 1;
    console.log(`${String(t).padStart(5)}  ${String(Math.round(v)).padStart(7)}  ${String(n).padStart(5)}  ${String(Math.round(ref)).padStart(8)}   ${mul.toFixed(2)}`);
  }
  const ref = refFrom(curve, T.ref.map((r) => r[0]).filter((t) => t <= o.minutes));
  console.log(`\nnot counted (not a weapon's, or overkill), median of runs: ${(100 * median(runs.map((r) => r.other))).toFixed(0)}%`);
  console.log(`ref: ${JSON.stringify(ref).replaceAll(',', ', ').replaceAll('], [', '], [')},`);
  if (o.json) writeFileSync(o.json, JSON.stringify({ options: o, runs, curve, ref }, null, 1));
}
