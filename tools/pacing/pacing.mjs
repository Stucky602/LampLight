// The pacing simulator (ARCHITECTURE §10.3). Bots play real runs from a fresh profile (the pools
// and upgrades the game would give them) to measure what a run brings home (measure.mjs); then
// many simulated players each play hundreds of runs with those yields and a greedy buyer spending
// in the harbor, through the real meta layer (model.mjs). The report (report.mjs) says what its
// hours stand on, when each milestone lands against its target (met or missed), how the MVP
// harbor's hours move if every run were like the shortest third measured, and the share of run
// content a fresh profile can meet (brief §6.4).
//
//   node tools/pacing/pacing.mjs [--measure 12] [--minutes 25] [--jobs N] [--players 40]
//                                [--hub 1.5] [--yields tools/pacing/yields.json] [--remeasure]
//
// --measure   bot runs to measure yields with (the starting character, the archetypes in turn, seeded)
// --minutes   the most a measured run may last: 25 lets a bot that reaches the 20:00 boss fight it
// --hub       minutes spent in the harbor per run (walking, buying, the ceremonies)
// --yields    where the measured runs are kept (committed, yields.mjs); a later call reuses them
//             unless --remeasure, and says so plainly when they were measured on other data or code
// Measuring runs the sim for minutes; the report from kept yields takes seconds. The gate tests
// the model on made-up yields.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../../src/data/index.js';
import { measureOne, MEASURE } from './measure.mjs';
import { pacingReport } from './report.mjs';
import { yieldsFingerprint, readYields, YIELDS_FILE } from './yields.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

if (!isMainThread) {
  parentPort.on('message', (job) => {
    if (job === null) process.exit(0);
    parentPort.postMessage(measureOne(job));
  });
} else {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const measure = Number(arg('measure', 12));
  const minutes = Number(arg('minutes', 25));
  const jobs = Math.max(1, Number(arg('jobs', availableParallelism())));
  const players = Number(arg('players', 40));
  const hubMinutes = Number(arg('hub', 1.5));
  const file = resolve(arg('yields', join(ROOT, YIELDS_FILE)));
  const fingerprint = await yieldsFingerprint(ROOT);

  let saved;
  const kept = process.argv.includes('--remeasure') ? null : readYields(file, fingerprint);
  if (kept) {
    saved = kept.saved;
    console.log(`yields: ${saved.runs.length} measured runs from ${file} (--remeasure to measure again)`);
    if (kept.stale) {
      console.log(`\nSTALE YIELDS: they were measured on other data or sim code (${saved.fingerprint ?? 'no fingerprint'}; now ${fingerprint}). The hours below may not hold: run with --remeasure.\n`);
    }
  } else {
    const t0 = performance.now();
    const queue = Array.from({ length: measure }, (_, k) => ({ k, minutes }));
    const runs = [];
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => new Promise((ok, fail) => {
      const worker = new Worker(new URL(import.meta.url));
      const next = () => worker.postMessage(queue.length ? queue.shift() : null);
      worker.on('message', (r) => { runs.push(r); next(); });
      worker.on('error', fail);
      worker.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`worker exited with ${code}`))));
      next();
    })));
    runs.sort((a, b) => a.k - b.k);
    saved = { v: 2, fingerprint, minutes, measure: MEASURE, runs };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(saved, null, 1));
    console.log(`measured ${runs.length} runs in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  const how = saved.measure ?? { character: MEASURE.character, archetypes: MEASURE.archetypes, overtime: 'leave' };
  const out = pacingReport({ runs: saved.runs, how, minutes: saved.minutes ?? minutes, players, hubMinutes, data: DATA });
  for (const line of out.before) console.log(line);
  console.table(out.table);
  for (const line of out.after) console.log(line);
}
