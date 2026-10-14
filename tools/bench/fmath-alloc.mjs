// Workspace check (not in the gate): does each fmath function create garbage when the sim calls
// it? Run: node tools/bench/fmath-alloc.mjs
//
// Each function is measured the way the sim calls it: a short loop over 1,000 "entities", called
// 20,000 times, like a tick function called 60 times a second. V8 optimizes that normally. Two
// patterns per function: storing each result into a Float64Array (what the SoA pools do), and
// adding results into a local running total. Garbage is counted with V8's GC profiler.
// A function that allocates 16 bytes per call shows ~300 young-generation collections over the
// 20M calls here; an allocation-free one shows 0-5.
//
// Why not one long loop (what this tool did first): V8 compiles a single long-running loop
// mid-loop ("on-stack replacement"), and in that mode it kept the loop's running total boxed
// whenever the inlined function had a branch that never ran, which cost 16 bytes per iteration.
// That was the benchmark, not the math, and the game never runs code that way; the one-long-loop
// numbers are still printed (the "osr" column) so the difference stays visible.
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fsin, fcos, fatan, fatan2, fexp, flog, fpow, flen, sincosInto, wrapAngle } from '../../src/lib/fmath.js';

const E = 1000;          // entities per tick
const TICKS = 20000;     // ticks measured (20M calls)
const IN = new Float64Array(E);
const IN2 = new Float64Array(E);
const OUT = new Float64Array(E * 2);
for (let i = 0; i < E; i++) { IN[i] = ((i * 0.37) % 10) - 5; IN2[i] = ((i * 0.53) % 10) - 5; }

// Per function: [store pattern, accumulate pattern], each one "tick".
const FNS = {
  fsin: [() => { for (let i = 0; i < E; i++) OUT[i] = fsin(IN[i] * 10); }, () => { let s = 0; for (let i = 0; i < E; i++) s += fsin(IN[i] * 10); return s; }],
  fcos: [() => { for (let i = 0; i < E; i++) OUT[i] = fcos(IN[i] * 10); }, () => { let s = 0; for (let i = 0; i < E; i++) s += fcos(IN[i] * 10); return s; }],
  sincosInto: [() => { for (let i = 0; i < E; i++) sincosInto(IN[i] * 10, OUT, i * 2); }, () => { let s = 0; for (let i = 0; i < E; i++) { sincosInto(IN[i] * 10, OUT, 0); s += OUT[0] + OUT[1]; } return s; }],
  fatan: [() => { for (let i = 0; i < E; i++) OUT[i] = fatan(IN[i]); }, () => { let s = 0; for (let i = 0; i < E; i++) s += fatan(IN[i]); return s; }],
  fatan2: [() => { for (let i = 0; i < E; i++) OUT[i] = fatan2(IN[i], IN2[i]); }, () => { let s = 0; for (let i = 0; i < E; i++) s += fatan2(IN[i], IN2[i]); return s; }],
  fexp: [() => { for (let i = 0; i < E; i++) OUT[i] = fexp(IN[i]); }, () => { let s = 0; for (let i = 0; i < E; i++) s += fexp(IN[i]); return s; }],
  flog: [() => { for (let i = 0; i < E; i++) OUT[i] = flog(IN[i] + 6); }, () => { let s = 0; for (let i = 0; i < E; i++) s += flog(IN[i] + 6); return s; }],
  fpow: [() => { for (let i = 0; i < E; i++) OUT[i] = fpow(IN[i] + 6, 1.3); }, () => { let s = 0; for (let i = 0; i < E; i++) s += fpow(IN[i] + 6, 1.3); return s; }],
  flen: [() => { for (let i = 0; i < E; i++) OUT[i] = flen(IN[i], IN2[i]); }, () => { let s = 0; for (let i = 0; i < E; i++) s += flen(IN[i], IN2[i]); return s; }],
  wrapAngle: [() => { for (let i = 0; i < E; i++) OUT[i] = wrapAngle(IN[i] * 100); }, () => { let s = 0; for (let i = 0; i < E; i++) s += wrapAngle(IN[i] * 100); return s; }],
};

// The old one-long-loop measurement, kept for comparison.
const N = E * TICKS;
const OSR = {
  fsin: () => { let a = 0; for (let i = 0; i < N; i++) a += fsin((i % 100000) * 0.001 - 50); return a; },
  fcos: () => { let a = 0; for (let i = 0; i < N; i++) a += fcos((i % 100000) * 0.001 - 50); return a; },
  sincosInto: () => { let a = 0; for (let i = 0; i < N; i++) { sincosInto((i % 100000) * 0.001 - 50, OUT, 0); a += OUT[0] + OUT[1]; } return a; },
  fatan: () => { let a = 0; for (let i = 0; i < N; i++) a += fatan((i % 100000) * 0.001 - 50); return a; },
  fatan2: () => { let a = 0; for (let i = 0; i < N; i++) { const x = (i % 100000) * 0.001 - 50; a += fatan2(x, 1.3 - x); } return a; },
  fexp: () => { let a = 0; for (let i = 0; i < N; i++) a += fexp((i % 100000) * 0.00001 - 0.5); return a; },
  flog: () => { let a = 0; for (let i = 0; i < N; i++) a += flog((i % 100000) * 0.001 + 1); return a; },
  fpow: () => { let a = 0; for (let i = 0; i < N; i++) a += fpow(1.0001 + (i % 100000) * 1e-5, 3.7); return a; },
  flen: () => { let a = 0; for (let i = 0; i < N; i++) a += flen((i % 100000) * 0.001 - 50, 2); return a; },
  wrapAngle: () => { let a = 0; for (let i = 0; i < N; i++) a += wrapAngle((i % 100000) * 0.01 - 500); return a; },
};

function measure(fn, reps) {
  for (let k = 0; k < 2000; k++) fn(); // warm up: V8 optimizes the tick function normally
  const prof = new v8.GCProfiler();
  prof.start();
  const t0 = performance.now();
  let sink = 0;
  for (let k = 0; k < reps; k++) sink += fn() || 0;
  const ns = ((performance.now() - t0) / (reps * E)) * 1e6;
  return { ns, gcs: prof.stop().statistics.length, ok: Number.isFinite(sink) };
}

function measureOsr(fn) {
  fn();
  const prof = new v8.GCProfiler();
  prof.start();
  const r = fn();
  return { gcs: prof.stop().statistics.length, ok: Number.isFinite(r) };
}

const perCall = (gcs) => (gcs <= 5 ? '0 B' : `~${Math.round((gcs * 1048576) / N)} B`);

const [, , name, mode] = process.argv;
if (name) {
  // One function and one pattern per process: V8 grows its young generation as garbage piles
  // up, so measuring several things in one process makes later ones look cleaner than they are.
  const r = mode === 'osr' ? measureOsr(OSR[name]) : measure(FNS[name][mode === 'acc' ? 1 : 0], TICKS);
  console.log(JSON.stringify(r));
} else {
  const rows = [];
  const self = fileURLToPath(import.meta.url);
  const run = (n, m) => JSON.parse(spawnSync(process.execPath, [self, n, m], { encoding: 'utf8' }).stdout.trim().split('\n').pop());
  for (const n of Object.keys(FNS)) {
    const store = run(n, 'store');
    const acc = run(n, 'acc');
    const osr = run(n, 'osr');
    rows.push({ name: n, 'ns/call': Number(store.ns.toFixed(1)), 'store to array': perCall(store.gcs), 'running total': perCall(acc.gcs), osr: perCall(osr.gcs), ok: store.ok && acc.ok && osr.ok });
  }
  console.table(rows);
}
