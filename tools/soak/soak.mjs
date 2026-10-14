// Soak test (ARCHITECTURE §14.2, §17): a full 20:00 run, both bosses killed, then 10 minutes of
// overtime at full density, played by the kiting bot (invulnerable, so it lasts). Reports ms
// per tick (p50, p99, worst), memory growth, pool high-water marks, and the garbage made per
// tick against the 64 KB budget (everything the process allocates while stepping, the bot
// included, so it errs high). Claude runs it before every zip. Exit code 0 = within budget.
//
//   node --expose-gc tools/soak/soak.mjs [--seed N] [--overtime 10] [--minutes 45] [--character lamplighter]
//   (--overtime: minutes of overtime to play; --minutes: a hard stop, in case a boss never dies)
import v8 from 'node:v8';
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { createKiteBot } from '../../src/sim/bot.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const seed = Number(arg('seed', 20260928));
const minutes = Number(arg('minutes', 45));
const overtimeGoal = Number(arg('overtime', 10));
const character = arg('character', 'lamplighter');
// Per-tick time is judged by how many enemies were alive (ARCHITECTURE §17): up to 1,000, up
// to 2,000, and up to the 3,000 hard cap. A p99 over the whole run would mostly measure how long
// the run spent at its peak.
// The top bracket runs to the pool's size: rings and splits can push past the 3,000 cap for a
// moment. The slowest ticks are checked too: 99.9% of all ticks fit in one 16.7 ms frame. (The
// single worst tick is reported, not judged: one scheduler hiccup on a shared machine sets it.)
const BUDGET = { garbagePerTick: 64 * 1024, heapGrowthMb: 64, p999Ms: 16.7 };
const BRACKETS = [{ upTo: 1000, p99Ms: 2 }, { upTo: 2000, p99Ms: 4 }, { upTo: 4096, p99Ms: 6 }];

const w = createWorld({ seed, character, invulnerable: true }, DATA);
const bot = createKiteBot({ stay: true, archetype: 'orbit_tank' });
const ticks = minutes * 3600;
const times = new Float64Array(ticks);
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
  stepWorld(w, frame);
  times[n] = performance.now() - a;
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
const brackets = BRACKETS.map((b, k) => {
  const lo = k === 0 ? 0 : BRACKETS[k - 1].upTo;
  const ts = [];
  for (let t = 0; t < n; t++) if (alive[t] > lo && alive[t] <= b.upTo) ts.push(times[t]);
  ts.sort((x, y) => x - y);
  const q = (p) => (ts.length ? +ts[Math.min(ts.length - 1, Math.floor(ts.length * p))].toFixed(3) : null);
  return { enemies: `${lo + 1}-${b.upTo}`, ticks: ts.length, p50: q(0.5), p99: q(0.99), budgetP99: b.p99Ms };
});
const pools = {};
for (const k of ['enemies', 'projectiles', 'gems', 'zones', 'pickups']) pools[k] = { highWater: w[k].highWater, capacity: w[k].capacity, refused: w[k].refused };
const report = {
  seed, character, minutesPlayed: +(n / 3600).toFixed(2),
  msPerTick: { p50: +pct(0.5).toFixed(3), p99: +pct(0.99).toFixed(3), p999: +pct(0.999).toFixed(3), worst: +sorted[sorted.length - 1].toFixed(2) },
  msPerTickByEnemies: brackets,
  wallSeconds: +(wall / 1000).toFixed(1), botSeconds: +(botMs / 1000).toFixed(1),
  garbagePerTickBytes: Math.round(allocated / n), collections: gcs.length,
  heapGrowthMb: +((heap1 - heap0) / 1048576).toFixed(1),
  pools,
  eventsDropped: w.events.droppedTotal, spawnsRefused: w.director.spawnsRefused, bigOverflowNow: w.enemyHash.bigOverflow,
  kills: w.result.totalKills, level: w.player.level, bosses: w.result.bossesKilled.map((b) => b.id), overtimeMinutes: w.director.overtimeMinutes,
  perMinute,
};
console.log(JSON.stringify(report, null, 2));
const problems = [];
if (report.garbagePerTickBytes > BUDGET.garbagePerTick) problems.push(`garbage ${report.garbagePerTickBytes} B/tick > ${BUDGET.garbagePerTick}`);
for (const b of brackets) if (b.p99 !== null && b.p99 > b.budgetP99) problems.push(`p99 ${b.p99} ms > ${b.budgetP99} ms with ${b.enemies} enemies alive`);
if (report.heapGrowthMb > BUDGET.heapGrowthMb) problems.push(`heap grew ${report.heapGrowthMb} MB`);
if (report.msPerTick.p999 > BUDGET.p999Ms) problems.push(`p99.9 ${report.msPerTick.p999} ms > ${BUDGET.p999Ms}`);
for (const [k, v] of Object.entries(pools)) if (v.refused > 0) problems.push(`${k} pool refused ${v.refused}`);
if (report.bosses.length < 2) problems.push(`only ${report.bosses.length} bosses killed`);
else if (!otDone()) problems.push(`stopped at ${report.minutesPlayed} min before ${overtimeGoal} minutes of overtime`);
if (problems.length) { console.error(`SOAK FAIL: ${problems.join('; ')}`); process.exit(1); }
console.log(`SOAK PASS: p99 by enemies alive ${brackets.map((b) => `${b.enemies}: ${b.p99} ms`).join(', ')}; ${report.garbagePerTickBytes} B/tick garbage, heap +${report.heapGrowthMb} MB, ${report.minutesPlayed} min`);
