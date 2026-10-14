// Balance sweeps (ARCHITECTURE §14.2): bots play real runs (they can die) for each character
// and build archetype, and the report shows how long they last, how often they clear the run,
// when they die, and how the level curve and kills grow. v1 (Phase 2): one careful kiting bot
// (src/sim/bot.js) with draft preferences per archetype. Later phases add per-archetype play
// styles and DPS by minute.
//
//   node tools/bots/bots.mjs [--runs 4] [--minutes 21] [--jobs 2]
//                            [--characters lamplighter,harpooner] [--archetypes orbit_tank,...]
//
// Runs are spread over worker threads (--jobs, default: the CPU count). Every run is seeded
// from its character, archetype, and number, so a sweep gives the same table every time.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { buildRunResult } from '../../src/sim/run-result.js';
import { createKiteBot, TAGS_BY_ARCHETYPE } from '../../src/sim/bot.js';

/** Play one run to its end or the time limit; returns the numbers the table needs. */
function playOne({ character, archetype, k, minutes }) {
  const w = createWorld({ seed: `${character}-${archetype}-${k}`, character }, DATA);
  const bot = createKiteBot({ archetype, stay: false });
  const levelAt = [];
  while (w.tick < minutes * 3600 && !w.over) {
    stepWorld(w, bot.input(w));
    let g = 0;
    while (currentHalt(w) && g++ < 100) decide(w, bot.decide(w, currentHalt(w)));
    if (w.tick % 3600 === 0) levelAt.push(w.player.level);
  }
  const r = buildRunResult(w);
  return {
    character, archetype, k,
    time: r.timeSurvived, level: r.level, kills: r.totalKills, bosses: r.bossesKilled.length,
    died: r.end === 'died', levelAt10: levelAt[9] ?? r.level,
  };
}

if (!isMainThread) {
  // One run at a time, as the main thread hands them out (runs that die early free a thread).
  parentPort.on('message', (job) => {
    if (job === null) process.exit(0);                 // ends this worker thread only
    parentPort.postMessage(playOne(job));
  });
} else {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const runs = Number(arg('runs', 4));
  const minutes = Number(arg('minutes', 21));
  const jobs = Math.max(1, Number(arg('jobs', availableParallelism())));
  const characters = arg('characters', DATA.characters.map((c) => c.id).join(',')).split(',');
  const archetypes = arg('archetypes', Object.keys(TAGS_BY_ARCHETYPE).join(',')).split(',');
  const bad = [];
  if (!(Number.isInteger(runs) && runs > 0)) bad.push('--runs must be a whole number above 0');
  if (!(minutes > 0)) bad.push('--minutes must be above 0');
  for (const c of characters) if (!DATA.characters.some((x) => x.id === c)) bad.push(`unknown character "${c}"`);
  for (const a of archetypes) if (!TAGS_BY_ARCHETYPE[a]) bad.push(`unknown archetype "${a}" (known: ${Object.keys(TAGS_BY_ARCHETYPE).join(', ')})`);
  if (bad.length) { console.error(bad.join('\n')); process.exit(2); }

  const all = [];
  for (const character of characters) for (const archetype of archetypes) for (let k = 0; k < runs; k++) all.push({ character, archetype, k, minutes });
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
  const rows = [];
  for (const character of characters) {
    for (const archetype of archetypes) {
      const rs = results.filter((r) => r.character === character && r.archetype === archetype);
      const deaths = rs.filter((r) => r.died).map((r) => Math.floor(r.time / 60)).sort((a, b) => a - b);
      rows.push({
        character, archetype,
        survived: `${(avg(rs.map((r) => r.time)) / 60).toFixed(1)} min`,
        cleared: `${rs.filter((r) => r.bosses >= 2).length}/${rs.length}`,
        'boss 1': `${rs.filter((r) => r.bosses >= 1).length}/${rs.length}`,
        deathsAtMinute: deaths.join(' ') || '-',
        'level at 10:00': avg(rs.map((r) => r.levelAt10)).toFixed(0),
        level: avg(rs.map((r) => r.level)).toFixed(0),
        kills: avg(rs.map((r) => r.kills)).toFixed(0),
      });
    }
  }
  console.table(rows);
  console.log(`${all.length} runs in ${((performance.now() - t0) / 1000).toFixed(0)} s on ${jobs} threads`);
}
