// Soak test (ARCHITECTURE §14.2, §17): a full 20:00 run, both bosses killed, then 10 minutes of
// overtime at full density, played by the kiting bot (invulnerable, so it lasts). Reports ms
// per tick (p50, p99, worst), memory growth, pool high-water marks, and the garbage made per
// tick against the 64 KB budget (everything the process allocates while stepping, the bot
// included, so it errs high). Claude runs it before every zip. Exit code 0 = within budget.
//
// The clock (0.9.0 release, the coordinator's call): ticks are judged by wall time, and only on a
// quiet machine. At start the soak reads the 1-minute load average; under 1.0 it judges by wall
// time; otherwise it waits up to 5 minutes for the load to drop, and if it never does it falls back
// to CPU time (process.cpuUsage around each step) with 1 ms added to every per-tick budget, and
// says so. Both clocks are always reported. Why not CPU time alone (W7/V5 judged by it, after
// both soaks failed on wall time at load 10 to 17 on 2 cores): process CPU time counts V8's
// background compiler threads, which recompile the big step functions on other cores for much of
// the run, and charges them to whatever tick they overlap. On the release Marsh soak that put the
// p99 at 2.0 to 2.6 ms CPU against 0.84 to 1.0 ms wall on the same run (0.93 ms with V8's
// background threads off). A player's machine compiles on other cores too: it doesn't hold up a
// frame, so on a quiet machine the wall clock is the one that says what the player feels.
// --wall judges by wall time at once, without looking at the load.
//
//   node --expose-gc tools/soak/soak.mjs [--seed N] [--overtime 10] [--minutes 45] [--character lamplighter] [--map drowned_docks]
//   (--map salt_marsh: the Salt Marsh with every layer on: the water, rule 8, the storm, the Eye, the well)
//   (--overtime: minutes of overtime to play; --minutes: a hard stop, in case a boss never dies)
//   (--neutral: every pace dial where it was in 0.8.0, tools/bots/pace.mjs NEUTRAL, so the engine is
//   still soaked at the old density, up to the 3,000 cap; without it, the game's own pace, 0.8.1)
import v8 from 'node:v8';
import { loadavg } from 'node:os';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { createKiteBot } from '../../src/sim/bot.js';
import { NEUTRAL, tuningFrom } from '../bots/pace.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const seed = Number(arg('seed', 20260928));
const minutes = Number(arg('minutes', 45));
const overtimeGoal = Number(arg('overtime', 10));
const character = arg('character', 'lamplighter');
const map = arg('map', 'drowned_docks');
const neutral = process.argv.includes('--neutral');
// The clock: wall time on a quiet machine (load under QUIET), else CPU time plus CPU_ALLOWANCE_MS.
const QUIET = 1.0, WAIT_S = 300, POLL_S = 10, CPU_ALLOWANCE_MS = 1;
let load = loadavg()[0], waitedS = 0;
if (!process.argv.includes('--wall')) {
  while (load >= QUIET && waitedS < WAIT_S) {
    console.error(`soak: load ${load.toFixed(2)} (1 min): waiting for it to drop under ${QUIET} (${waitedS} of ${WAIT_S} s)`);
    await new Promise((r) => setTimeout(r, POLL_S * 1000));
    waitedS += POLL_S; load = loadavg()[0];
  }
}
const byWall = process.argv.includes('--wall') || load < QUIET;
const allowance = byWall ? 0 : CPU_ALLOWANCE_MS;
if (!byWall) console.error(`soak: the load stayed at ${load.toFixed(2)} for ${WAIT_S} s: judging by CPU time, with ${CPU_ALLOWANCE_MS} ms added to each per-tick budget`);
// Per-tick time is judged by how many enemies were alive (ARCHITECTURE §17): up to 1,000, up
// to 2,000, and up to the 3,000 hard cap. A p99 over the whole run would mostly measure how long
// the run spent at its peak.
// The top bracket runs to the pool's size: rings and splits can push past the 3,000 cap for a
// moment. The slowest ticks are checked too: 99.9% of all ticks fit in one 16.7 ms frame. (The
// single worst tick is reported, not judged: one scheduler hiccup on a shared machine sets it.)
const BUDGET = { garbagePerTick: 64 * 1024, heapGrowthMb: 64, p999Ms: 16.7 };
const BRACKETS = [{ upTo: 1000, p99Ms: 2 }, { upTo: 2000, p99Ms: 4 }, { upTo: 4096, p99Ms: 6 }];

const w = createWorld({ seed, map, character, invulnerable: true, ...(neutral ? { tuning: tuningFrom(NEUTRAL) } : {}) }, DATA);
const bot = createKiteBot({ stay: true, archetype: 'orbit_tank' });
const ticks = minutes * 3600;
const times = new Float64Array(ticks);      // what the tick is judged by (CPU, or wall with --wall)
const cpuTimes = new Float64Array(ticks);
const wallTimes = new Float64Array(ticks);
const alive = new Uint16Array(ticks);
const perMinute = [];

global.gc?.();
const heap0 = process.memoryUsage().heapUsed;
const prof = new v8.GCProfiler();
prof.start();
let n = 0;
let botMs = 0;
const t0 = performance.now();
const otDone = () => w.director.overtime && w.tick - w.director.overtimeStartTick >= overtimeGoal * 3600;
while (n < ticks && !w.over && !otDone()) {
  const b0 = performance.now();
  const frame = bot.input(w);
  const a = performance.now();
  botMs += a - b0;
  const c0 = process.cpuUsage();
  stepWorld(w, frame);
  const c = process.cpuUsage(c0);
  wallTimes[n] = performance.now() - a;
  cpuTimes[n] = (c.user + c.system) / 1000;
  times[n] = byWall ? wallTimes[n] : cpuTimes[n];
  alive[n++] = w.enemies.count;
  let g = 0;
  while (currentHalt(w) && g++ < 100) decide(w, bot.decide(w, currentHalt(w)));
  if (w.tick % 3600 === 0) {
    const m = w.tick / 3600;
    let sum = 0; for (let k = n - 3600; k < n; k++) sum += times[k];
    perMinute.push({ minute: m, enemies: w.enemies.count, target: Math.round(w.director.target), shots: w.projectiles.count, gems: w.gems.count, zones: w.zones.count, msPerTick: +(sum / 3600).toFixed(3), level: w.player.level, overtime: w.director.overtimeMinutes });
  }
}
const wall = performance.now() - t0;
const gcs = prof.stop().statistics;
global.gc?.();
const heap1 = process.memoryUsage().heapUsed;

// Garbage: heap growth between collections, summed over the run.
let allocated = 0;
let lastAfter = null;
for (const s of gcs) {
  const before = s.beforeGC.heapStatistics.usedHeapSize, after = s.afterGC.heapStatistics.usedHeapSize;
  if (lastAfter !== null && before > lastAfter) allocated += before - lastAfter;
  lastAfter = after;
}
const sorted = Array.from(times.subarray(0, n)).sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const wallSorted = Array.from(byWall ? cpuTimes.subarray(0, n) : wallTimes.subarray(0, n)).sort((a, b) => a - b);
const otherPct = (p) => +wallSorted[Math.min(wallSorted.length - 1, Math.floor(wallSorted.length * p))].toFixed(3);
const brackets = BRACKETS.map((b, k) => {
  const lo = k === 0 ? 0 : BRACKETS[k - 1].upTo;
  const ts = [];
  for (let t = 0; t < n; t++) if (alive[t] > lo && alive[t] <= b.upTo) ts.push(times[t]);
  ts.sort((x, y) => x - y);
  const q = (p) => (ts.length ? +ts[Math.min(ts.length - 1, Math.floor(ts.length * p))].toFixed(3) : null);
  return { enemies: `${lo + 1}-${b.upTo}`, ticks: ts.length, p50: q(0.5), p99: q(0.99), budgetP99: b.p99Ms + allowance };
});
const pools = {};
for (const k of ['enemies', 'projectiles', 'gems', 'zones', 'pickups']) pools[k] = { highWater: w[k].highWater, capacity: w[k].capacity, refused: w[k].refused };
const report = {
  seed, map, character, pace: neutral ? 'neutral (0.8.0)' : 'the game\'s', minutesPlayed: +(n / 3600).toFixed(2),
  judgedBy: byWall ? 'wall time' : `CPU time (process.cpuUsage), ${CPU_ALLOWANCE_MS} ms allowance: the machine wasn't quiet`,
  loadAtStart: +load.toFixed(2), waitedSeconds: waitedS,
  msPerTick: { p50: +pct(0.5).toFixed(3), p99: +pct(0.99).toFixed(3), p999: +pct(0.999).toFixed(3), worst: +sorted[sorted.length - 1].toFixed(2) },
  // The other clock, reported, not judged: wall time (or CPU time under --wall). On a busy machine
  // wall time includes waiting for a core.
  [byWall ? 'cpuMsPerTick' : 'wallMsPerTick']: { p50: otherPct(0.5), p99: otherPct(0.99), p999: otherPct(0.999) },   // (the other clock: both are always reported)
  msPerTickByEnemies: brackets,
  wallSeconds: +(wall / 1000).toFixed(1), botSeconds: +(botMs / 1000).toFixed(1),
  garbagePerTickBytes: Math.round(allocated / n), collections: gcs.length,
  heapGrowthMb: +((heap1 - heap0) / 1048576).toFixed(1),
  pools,
  eventsDropped: w.events.droppedTotal, spawnsRefused: w.director.spawnsRefused, bigOverflowNow: w.enemyHash.bigOverflow,
  kills: w.result.totalKills, level: w.player.level, bosses: w.result.bossesKilled.map((b) => b.id), overtimeMinutes: w.director.overtimeMinutes,
  perMinute,
  // The Salt Marsh's own work: 0-1 searches (one per water level), rule 8's passes, the ground's rebuilds.
  marsh: w.marsh ? { searches: w.marsh.searches, passes: w.marsh.passes, refreshes: w.marsh.refreshes, groundVersion: w.terrain.version } : null,
};
console.log(JSON.stringify(report, null, 2));
const problems = [];
if (report.garbagePerTickBytes > BUDGET.garbagePerTick) problems.push(`garbage ${report.garbagePerTickBytes} B/tick > ${BUDGET.garbagePerTick}`);
for (const b of brackets) if (b.p99 !== null && b.p99 > b.budgetP99) problems.push(`p99 ${b.p99} ms > ${b.budgetP99} ms with ${b.enemies} enemies alive`);
if (report.heapGrowthMb > BUDGET.heapGrowthMb) problems.push(`heap grew ${report.heapGrowthMb} MB`);
if (report.msPerTick.p999 > BUDGET.p999Ms + allowance) problems.push(`p99.9 ${report.msPerTick.p999} ms > ${BUDGET.p999Ms + allowance}`);
for (const [k, v] of Object.entries(pools)) if (v.refused > 0) problems.push(`${k} pool refused ${v.refused}`);
if (report.bosses.length < 2) problems.push(`only ${report.bosses.length} bosses killed`);
else if (!otDone()) problems.push(`stopped at ${report.minutesPlayed} min before ${overtimeGoal} minutes of overtime`);
if (problems.length) { console.error(`SOAK FAIL: ${problems.join('; ')}`); process.exit(1); }
console.log(`SOAK PASS (${report.judgedBy}): p99 by enemies alive ${brackets.map((b) => `${b.enemies}: ${b.p99} ms`).join(', ')}; ${report.garbagePerTickBytes} B/tick garbage, heap +${report.heapGrowthMb} MB, ${report.minutesPlayed} min`);
