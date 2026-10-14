// Play back a report or a replay file Kevin attached (ARCHITECTURE §12.4, §15), headless, and
// print what the run looked like at the end (or at a chosen tick).
//
//   node tools/replay/replay.mjs <report.json | run.lamprep> [--until <tick | m:ss>] [--any-build]
//
// A replay only plays on the build that recorded it. Kevin's build ids carry a timestamp that
// this workspace's builds never match, so --any-build plays it on the current code anyway (fine
// when the sim code is the same as the version he played; the output says it did this).

import { readFileSync } from 'node:fs';
import { DATA } from '../../src/data/index.js';
import { playReplay, ReplayError } from '../../src/sim/replay.js';
import { hashWorld, buildRunResult, currentHalt } from '../../src/sim/world.js';
import { decodeReplay, readReport } from '../../src/save/replay.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--until');
if (!file) { console.error('usage: node tools/replay/replay.mjs <report.json | run.lamprep> [--until tick|m:ss] [--any-build]'); process.exit(2); }
const untilArg = args.includes('--until') ? args[args.indexOf('--until') + 1] : null;
const until = untilArg === null ? Infinity : /:/.test(untilArg) ? (Number(untilArg.split(':')[0]) * 60 + Number(untilArg.split(':')[1])) * 60 : Number(untilArg);
if (!(until > 0)) { console.error(`--until: "${untilArg}" is not a tick or m:ss`); process.exit(2); }

const raw = readFileSync(file);
let replay, report = null;
if (raw.subarray(0, 5).toString() === 'LREP1') replay = decodeReplay(new Uint8Array(raw));
else {
  report = readReport(raw.toString('utf8'));
  replay = report.replay;
  if (!replay) { console.log('This report has no run in it (it was saved outside a run).'); console.log(JSON.stringify({ state: report.state, errors: report.errors }, null, 2)); process.exit(0); }
}

const anyBuild = args.includes('--any-build');
let world, lastTick = 0;
try {
  world = playReplay(replay, DATA, { buildId: anyBuild ? replay.build : 'workspace', untilTick: until, onTick: (w) => { lastTick = w.tick; } });
} catch (e) {
  if (e instanceof ReplayError && !anyBuild && /from build/.test(e.message)) {
    console.error(`${e.message}\nRun again with --any-build to play it on this code.`);
    process.exit(3);
  }
  if (e instanceof ReplayError) throw e;
  // The sim itself threw: the same error the player hit, reproduced at the same tick.
  console.log(JSON.stringify({
    file, build: replay.build, playedOnAnyBuild: anyBuild, seed: replay.config.seed,
    reproducedError: { atTick: lastTick, message: e?.message || String(e), stack: String(e?.stack || '').split('\n').slice(0, 12) },
    reportErrors: report?.errors ?? null,
  }, null, 2));
  process.exit(0);
}
const p = world.player;
const out = {
  file, build: replay.build, playedOnAnyBuild: anyBuild, seed: replay.config.seed, character: replay.config.character,
  endedAtTick: world.tick, time: `${Math.floor(world.tick / 3600)}:${String(Math.floor(world.tick / 60) % 60).padStart(2, '0')}`,
  hashMatches: until === Infinity ? hashWorld(world) === replay.hash : '(stopped early)',
  player: { x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), level: p.level },
  enemies: world.enemies.count, shots: world.projectiles.count, gems: world.gems.count,
  halt: currentHalt(world)?.kind ?? null, over: world.over,
  weapons: world.slots.filter(Boolean).filter((s) => s.def).map((s) => `${s.def.id} ${s.level}`),
  tuned: replay.decisions.filter((d) => d.kind === 'tune').map((d) => `${d.path}=${d.value} @${d.tick}`),
  dev: replay.decisions.filter((d) => d.kind === 'dev').map((d) => `${d.cmd} @${d.tick}`),
};
if (world.over) out.result = buildRunResult(world);
if (report) Object.assign(out, { reportState: report.state, reportErrors: report.errors, reportProblems: report.problems, lastEvents: (report.events || []).slice(-15) });
if (out.hashMatches === false) {
  out.note = report?.errors?.length
    ? `The run hit an error (see reportErrors) that playing it back did not reproduce, so the end state differs: the error came from outside the recorded inputs (rendering, saving, a menu) or this code is not the code that ran.`
    : 'The end state differs from the recording: this code is not the code that ran (see playedOnAnyBuild).';
}
console.log(JSON.stringify(out, null, 2));
