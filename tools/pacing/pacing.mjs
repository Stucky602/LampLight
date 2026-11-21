// The pacing simulator (ARCHITECTURE §10.3). Bots play real runs on each built map at a few harbor
// stages (stages.mjs: what a profile a quarter, a half, three quarters of the way through the
// harbor plays with) to measure what a run brings home (measure.mjs); then many simulated players
// each play hundreds of runs with those yields, choosing their map and spending in the harbor
// through the real meta layer (model.mjs). The report (report.mjs) says what its hours stand on,
// when each milestone lands against its target (met or missed), the MVP harbor and the whole
// harbor for a practiced player (bots that can't die, on the runs that cleared the map), a newer
// one (the ordinary bots), and one who stays for overtime to the dawn (the sweep, X3: bots that
// can't die and stay), and the share of run content a fresh profile can meet (brief §6.4).
//
//   node tools/pacing/pacing.mjs [--remeasure | --stale] [--skilled | --ordinary | --stays] [--measure 12]
//                                [--minutes 25] [--jobs N] [--players 40] [--hub 1.5]
//                                [--yields file] [--skilled-yields file] [--stays-yields file]
//
// (no flag)   the report on the committed yields (tools/pacing/yields-skilled.json, yields.json, and
//             yields-stays.json), the three players; it says which sets are stale (measured on other
//             code or data). Seconds.
// --remeasure measure every set again (the three players unless --skilled, --ordinary, or --stays),
//             then report. 12 runs a set, 7 sets a player: about an hour with --jobs 2 (a staying run
//             lasts about 32 minutes, and --minutes is STAYS.minutes for it).
// --stale     measure only the stale or missing sets, keep the rest.
// --measure   bot runs a set (the starting character, the archetypes in turn, seeded per set)
// --minutes   the most a measured run may last: 25 lets a bot that reaches the 20:00 boss fight it
// --hub       minutes spent in the harbor per run (walking, buying, the ceremonies)
// The gate (tests/pacing.test.js) never measures: it checks the committed sets' fingerprints and
// the report's arithmetic.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../../src/data/index.js';
import { measureOne, MEASURE, STAYS } from './measure.mjs';
import { reportFiles } from './report.mjs';
import { yieldsFingerprints, readYields, staleSets, setKey, YIELDS_FILE, SKILLED_YIELDS_FILE, STAYS_YIELDS_FILE, YIELDS_VERSION } from './yields.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

if (!isMainThread) {
  parentPort.on('message', (job) => {
    if (job === null) process.exit(0);
    parentPort.postMessage(measureOne(job));
  });
} else {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const flag = (name) => process.argv.includes(`--${name}`);
  const measure = Number(arg('measure', 12));
  const minutes = Number(arg('minutes', 25));
  const jobs = Math.max(1, Number(arg('jobs', availableParallelism())));
  const players = Number(arg('players', 40));
  const hubMinutes = Number(arg('hub', 1.5));
  const kinds = flag('skilled') ? ['skilled'] : flag('ordinary') ? ['ordinary'] : flag('stays') ? ['stays'] : ['skilled', 'ordinary', 'stays'];
  const files = { skilled: resolve(arg('skilled-yields', join(ROOT, SKILLED_YIELDS_FILE))), ordinary: resolve(arg('yields', join(ROOT, YIELDS_FILE))), stays: resolve(arg('stays-yields', join(ROOT, STAYS_YIELDS_FILE))) };
  // How long a kind's runs may last: the staying player's play overtime to the dawn.
  const minutesOf = (kind) => (kind === 'stays' ? Math.max(minutes, STAYS.minutes) : minutes);

  if (flag('remeasure') || flag('stale')) {
    const fps = await yieldsFingerprints(ROOT);
    // Every job of every player in one queue, so the workers stay busy to the end.
    const plan = [];
    for (const kind of kinds) {
      // (Yields in an older format, or none, are stale all through.)
      let saved = null;
      if (flag('stale')) try { saved = readYields(files[kind]); } catch { saved = null; }
      const redo = saved ? new Set(staleSets(saved, fps).stale) : null;
      const keep = saved ? saved.sets.filter((s) => !redo.has(setKey(s)) && fps.sets.some((f) => setKey(f) === setKey(s))) : [];
      const sets = fps.sets.filter((s) => !redo || redo.has(setKey(s)));
      plan.push({ kind, keep, sets: sets.map((s) => ({ ...s, runs: [] })) });
    }
    const queue = plan.flatMap((p) => p.sets.flatMap((s) => Array.from({ length: measure }, (_, k) => ({ k, minutes: minutesOf(p.kind), skilled: p.kind !== 'ordinary', stays: p.kind === 'stays', map: s.map, stage: s.stage, set: s }))));
    const t0 = performance.now();
    let done = 0;
    console.log(`measuring ${queue.length} runs (${plan.map((p) => `${p.kind}: ${p.sets.map(setKey).join(', ') || 'none'}`).join('; ')}) on ${jobs} worker${jobs === 1 ? '' : 's'}`);
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => new Promise((ok, fail) => {
      const worker = new Worker(new URL(import.meta.url));
      let job = null;
      const next = () => { job = queue.shift() ?? null; worker.postMessage(job ? { k: job.k, minutes: job.minutes, skilled: job.skilled, stays: job.stays, map: job.map, stage: job.stage } : null); };
      worker.on('message', (r) => {
        job.set.runs.push(r);
        done++;
        if (done % 12 === 0) console.log(`  ${done} runs, ${((performance.now() - t0) / 60000).toFixed(1)} min`);
        next();
      });
      worker.on('error', fail);
      worker.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`worker exited with ${code}`))));
      next();
    })));
    for (const p of plan) {
      const order = (s) => fps.sets.findIndex((f) => setKey(f) === setKey(s));
      const sets = [...p.keep, ...p.sets.map((s) => ({ map: s.map, stage: s.stage, fingerprint: fps.of(s.map, s.stage), runs: s.runs.sort((a, b) => a.k - b.k) }))].sort((a, b) => order(a) - order(b));
      const saved = { v: YIELDS_VERSION, minutes: minutesOf(p.kind), measure: { ...MEASURE, skilled: p.kind !== 'ordinary', ...(p.kind === 'stays' ? { overtime: STAYS.overtime, stays: true } : {}) }, sets };
      mkdirSync(dirname(files[p.kind]), { recursive: true });
      writeFileSync(files[p.kind], `${JSON.stringify(saved, null, 1)}\n`);
    }
    console.log(`measured ${done} runs in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
  }
  await reportFiles({ root: ROOT, data: DATA, kinds, files, players, hubMinutes });
}
