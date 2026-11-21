// Runaways in full runs (ruling 19 RA): careful runs to 20:00 on fixed seeds, every character, both
// maps, and how far each run's top weapon is over the next (health removed, no overkill). A set the
// bench can't see (a weapon's whole build with the careful picker's focus and Kindred) shows here.
// C1 runs it before every report.
//
//   node tools/bots/runaway.mjs [--seeds 2] [--from 0] [--maps drowned_docks,salt_marsh]
//        [--chars a,b] [--option 0|1|both] [--tide 0|5] [--mortal 1] [--jobs 2] [--out rows.jsonl]
//
// --tide N plays at Tide N (its health, density, damage, and speed, from a stage-3 harbor), as CW2's
// run.mjs does; ruling 21 WB: Tide 5 is part of every report.
//
// The bot is the careful follow bot (sim/bot.js), option A (or B, or both) on every axis, archetype by seed. It
// can't die unless --mortal 1. Prints one line a run and a summary: runs over x3 and x4, and each
// weapon with its Forms over x4 in more than one run (a fail, CW2's gate, round 4). The Drowned Man is
// held to his own rule instead (ruling 22): his top drafted weapon at most 70% of his damage; over it fails.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { createKiteBot } from '../../src/sim/bot.js';
import { measureConfig } from '../pacing/measure.mjs';

const MINUTES = 20;

function playOne({ ch, map, k, mortal, option, tide }) {
  const stage = tide > 0 ? 3 : map === 'salt_marsh' ? 1 : 0;
  const cfg = { ...measureConfig(k, !mortal, map, stage), character: ch, tide };
  const T = tide > 0 ? DATA.tides[tide - 1] : null;
  if (T) { cfg.hpMul = (cfg.hpMul ?? 1) * T.hpMul; cfg.densityMul = (cfg.densityMul ?? 1) * T.densityMul; cfg.enemyDamageMul = (cfg.enemyDamageMul ?? 1) * T.damageMul; cfg.enemySpeedMul = (cfg.enemySpeedMul ?? 1) * T.speedMul; }
  delete cfg.startWeapon;
  const who = DATA.characters.find((c) => c.id === ch);
  if (who.noHeal) cfg.noHeal = true;
  const w = createWorld(cfg, DATA);
  const bot = createKiteBot({ archetype: ['projectile_storm', 'orbit_tank', 'burning_ground'][k % 3], follow: true, picker: 'careful', option });
  while (!w.over && w.tick < MINUTES * 3600) {
    stepWorld(w, bot.input(w));
    for (let g = 0; currentHalt(w) && g < 100; g++) decide(w, bot.decide(w, currentHalt(w)));
  }
  const real = w.result.realBySlot || [];
  const ws = [];
  for (let i = 0; i < w.slots.length; i++) {
    const s = w.slots[i];
    if (s && s.def) ws.push({ id: s.def.id, real: real[i] || 0, forms: (s.ascensions || []).map((a) => a.id).sort(), sig: !!s.def.signature });
  }
  ws.sort((a, b) => b.real - a.real);
  const ratio = ws.length > 1 && ws[1].real > 0 ? ws[0].real / ws[1].real : null;
  // Ruling 22: a character whose drawback concentrates his build (the Drowned Man's two fewer slots)
  // is held to his top drafted weapon's share of his damage (`shareRule`), not top over next.
  const total = ws.reduce((s, x) => s + x.real, 0), drafted = ws.find((x) => !x.sig);
  const rule = who.shareRule ?? (ch === 'drowned_man' ? 0.7 : null);
  const dShare = drafted && total > 0 ? drafted.real / total : 0;
  return { ch, map, k, option, tide, end: w.over ? 'died' : 'alive', sec: Math.round(w.tick / 60), top: ws[0]?.id, forms: ws[0]?.forms ?? [], sig: ws[0]?.sig ?? false, next: ws[1]?.id ?? null, ratio: ratio === null ? null : Math.round(ratio * 100) / 100, share: ws.length ? Math.round(ws[0].real / total * 100) : null,
    rule, drafted: drafted?.id ?? null, draftedShare: Math.round(dShare * 100), over: rule !== null ? dShare > rule : !ws[0]?.sig && ratio !== null && ratio > 3,
    sigShare: total > 0 ? Math.round((ws.find((x) => x.sig)?.real ?? 0) / total * 100) : null };
}

if (!isMainThread) {
  for (const job of workerData.jobs) parentPort.postMessage(playOne(job));
} else {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const seeds = +arg('seeds', 2), from = +arg('from', 0), tide = +arg('tide', 0), mortal = arg('mortal', '0') === '1', jobsN = Math.max(1, +arg('jobs', 2)), out = arg('out', null);
  const maps = arg('maps', 'drowned_docks,salt_marsh').split(',');
  const chars = arg('chars', DATA.characters.map((c) => c.id).join(',')).split(',');
  const jobs = [];
  const options = arg('option', '0') === 'both' ? [0, 1] : [+arg('option', '0')];
  for (const option of options) for (const map of maps) for (const ch of chars) for (let k = from; k < from + seeds; k++) jobs.push({ ch, map, k, mortal, option, tide });
  const rows = [];
  const buckets = Array.from({ length: Math.min(jobsN, jobs.length) }, () => []);
  jobs.forEach((j, i) => buckets[i % buckets.length].push(j));
  await Promise.all(buckets.map((b) => new Promise((resolve, reject) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: b } });
    wk.on('message', (r) => {
      rows.push(r);
      if (out) appendFileSync(out, JSON.stringify(r) + '\n');
      console.log(`${'AB'[r.option]} ${r.map.padEnd(13)} ${r.ch.padEnd(12)} s${r.k} ${r.end.padEnd(5)} top ${r.top}${r.sig ? ' (sig)' : ''} [${r.forms.join('+')}] x${r.ratio ?? '-'} over ${r.next} (${r.share}%)${r.rule !== null ? ` | top drafted ${r.drafted} ${r.draftedShare}% (rule ${Math.round(r.rule * 100)}%)` : ''}`);
    });
    wk.on('error', reject);
    wk.on('exit', resolve);
  })));
  const ruled = rows.filter((r) => r.rule !== null), plain = rows.filter((r) => r.rule === null);
  // Ruling 24: only a drafted or start weapon on top counts as a runaway; a signature is held by its share (60% at most).
  const over3 = plain.filter((r) => !r.sig && r.ratio > 3), over4 = plain.filter((r) => !r.sig && r.ratio > 4), shareOver = ruled.filter((r) => r.over), sigOver = rows.filter((r) => r.sigShare > 60);
  const bySet = new Map();
  for (const r of over4) { const k = `${r.top} [${r.forms.join('+')}]`; bySet.set(k, (bySet.get(k) ?? 0) + 1); }
  const fails = [...bySet].filter(([, n]) => n > 1);
  for (const r of shareOver) fails.push([`${r.ch} ${r.drafted} at ${r.draftedShare}% (rule ${Math.round(r.rule * 100)}%)`, 1]);
  console.log(`\n${rows.length} runs. Without a share rule (${plain.length}): a drafted or start weapon on top and over x3 the next in ${over3.length}, over x4 in ${over4.length}.`);
  console.log(`Signature over 60% of the damage: ${sigOver.length}${sigOver.length ? ': ' + sigOver.map((r) => `${r.ch} s${r.k} ${r.sigShare}%`).join(', ') : ''}.`);
  if (ruled.length) console.log(`With a share rule (${ruled.length}, the Drowned Man at 70%): top drafted weapon over it in ${shareOver.length}${shareOver.length ? ': ' + shareOver.map((r) => `${r.ch} s${r.k} ${r.drafted} ${r.draftedShare}%`).join(', ') : ''}.`);
  for (const [k, n] of bySet) console.log(`  over x4: ${k} in ${n} run${n > 1 ? 's' : ''}`);
  console.log(fails.length ? `FAIL: ${fails.map(([k, n]) => `${k} (${n})`).join(', ')}` : 'No weapon and set over x4 in more than one run.');
  process.exitCode = fails.length ? 1 : 0;
}
