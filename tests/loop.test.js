import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoop, TICK_DT, TICK_MS } from '../src/app/loop.js';

/** A fake scheduler: callbacks queue up; advance(ms) runs everything queued at the new time. */
function harness(opts = {}) {
  let t = 0;
  let queue = [];
  let nextId = 1;
  const steps = [];
  const renders = [];
  const errors = [];
  let befores = 0;
  const loop = createLoop({
    step: (dt, tick) => { assert.equal(dt, TICK_DT); steps.push(tick); opts.onStep?.(tick, loop); },
    render: (alpha, ms, raw) => { renders.push({ alpha, ms, raw }); opts.onRender?.(loop); },
    beforeSteps: () => { befores++; },
    onError: (e, where) => errors.push([where, e.message]),
    now: () => t,
    raf: (cb) => { const id = nextId++; queue.push({ id, cb }); return id; },
    cancelRaf: (id) => { queue = queue.filter((q) => q.id !== id); },
    ...opts.loop,
  });
  const advance = (ms) => { t += ms; const run = queue; queue = []; for (const q of run) q.cb(t); };
  return { loop, steps, renders, errors, advance, pending: () => queue.length, befores: () => befores };
}

test('loop: runs 60 ticks per simulated second regardless of frame rate', () => {
  for (const fps of [30, 60, 144, 240]) {
    const h = harness();
    h.loop.start();
    for (let i = 0; i < fps * 10; i++) h.advance(1000 / fps);
    assert.ok(Math.abs(h.steps.length - 600) <= 1, `${fps} fps gave ${h.steps.length} ticks`);
    assert.equal(h.renders.length, fps * 10, 'exactly one render per frame');
  }
});

test('loop: alpha tracks the leftover fraction of a tick; render gets clamped and raw frame times', () => {
  const h = harness();
  h.loop.start();
  h.advance(TICK_MS * 1.5);
  assert.equal(h.steps.length, 1);
  assert.equal(h.loop.stepsLastFrame, 1);
  const r = h.renders.at(-1);
  assert.ok(Math.abs(r.alpha - 0.5) < 1e-9);
  assert.equal(r.ms, TICK_MS * 1.5);
  h.advance(900);
  assert.equal(h.renders.at(-1).ms, 250, 'clamped');
  assert.equal(h.renders.at(-1).raw, 900, 'raw kept for the overlay');
});

test('loop: a long stall is clamped and capped, never fast-forwarded', () => {
  const h = harness({ loop: { maxSteps: 5, maxFrameMs: 250 } });
  h.loop.start();
  h.advance(5000);
  assert.equal(h.steps.length, 5);
  assert.equal(h.loop.stepsLastFrame, 5);
  assert.ok(h.loop.droppedMs > 4000);
  assert.equal(h.renders.at(-1).alpha, 0, 'backlog dropped, so no leftover fraction');
});

test('loop: pause reasons stack; time is not banked; alpha is 1 while paused', () => {
  const h = harness();
  h.loop.start();
  h.loop.pause('menu');
  h.loop.pause('blur');
  for (let i = 0; i < 60; i++) h.advance(TICK_MS);
  assert.equal(h.steps.length, 0);
  assert.equal(h.renders.length, 60, 'rendering continues while paused');
  assert.ok(h.renders.every((r) => r.alpha === 1));
  assert.equal(h.befores(), 60, 'input keeps polling while paused');
  h.loop.resume('menu');
  h.advance(TICK_MS);
  assert.equal(h.steps.length, 0, 'still paused for blur');
  assert.deepEqual(h.loop.pauseReasons(), ['blur']);
  assert.equal(h.loop.isPaused('blur'), true);
  h.loop.resume('blur');
  h.advance(TICK_MS + 0.01);
  assert.equal(h.steps.length, 1, 'no burst of banked ticks after resuming');
});

test('loop: a step that pauses (a level-up) stops further steps in the same frame', () => {
  const h = harness({ onStep: (tick, loop) => { if (tick === 2) loop.pause('levelup'); } });
  h.loop.start();
  h.advance(TICK_MS * 4.5);
  assert.deepEqual(h.steps, [0, 1, 2]);
  h.advance(TICK_MS * 3);
  assert.deepEqual(h.steps, [0, 1, 2]);
});

test('loop: hit-stop from inside a step holds the sim, keeps rendering, keeps the tick sequence', () => {
  const h = harness({ onStep: (tick, loop) => { if (tick === 0) loop.hitStop(50); } });
  h.loop.start();
  h.advance(TICK_MS * 3);
  assert.deepEqual(h.steps, [0], 'the hold starts immediately, mid-frame');
  const rendersBefore = h.renders.length;
  h.advance(16); h.advance(16); h.advance(16);
  assert.deepEqual(h.steps, [0], 'held for ~50 ms');
  assert.equal(h.renders.length, rendersBefore + 3, 'rendering never stops');
  assert.ok(h.renders.slice(-3).every((r) => r.alpha === 1));
  h.advance(16); h.advance(16);
  assert.ok(h.steps.length >= 2);
  assert.deepEqual(h.steps, h.steps.map((_, i) => i), 'tick numbers stay consecutive');
});

test('loop: overlapping holds keep the longest; pausing cancels a hold; holds are ignored while paused', () => {
  const h = harness();
  h.loop.start();
  h.loop.hitStop(10); h.loop.hitStop(40); h.loop.hitStop(20);
  assert.equal(h.loop.holdMs, 40);
  h.loop.pause('levelup');
  assert.equal(h.loop.holdMs, 0, 'the level-up screen cancels the freeze');
  h.loop.hitStop(100);
  assert.equal(h.loop.holdMs, 0, 'no new holds while paused');
  h.loop.resume('levelup');
  h.advance(TICK_MS + 0.01);
  assert.equal(h.steps.length, 1, 'play resumes at once after the card is picked');
});

test('loop: stop() and start() from inside a step leave exactly one frame chain', () => {
  let restarted = false;
  const h = harness({ onStep: (tick, loop) => { if (tick === 1 && !restarted) { restarted = true; loop.stop(); loop.start(); } } });
  h.loop.start();
  h.advance(TICK_MS * 2 + 0.01);
  assert.equal(h.pending(), 1, 'one scheduled frame, not two');
  const r0 = h.renders.length;
  for (let i = 0; i < 10; i++) h.advance(TICK_MS);
  assert.equal(h.renders.length - r0, 10, 'one render per vsync');
  assert.equal(h.pending(), 1);
});

test('loop: stop() from inside render ends the chain; a later start() gives one chain', () => {
  let stopNow = false;
  const h = harness({ onRender: (loop) => { if (stopNow) { stopNow = false; loop.stop(); } } });
  h.loop.start();
  h.advance(TICK_MS);
  stopNow = true;
  h.advance(TICK_MS);
  assert.equal(h.pending(), 0);
  h.loop.start();
  h.loop.start();
  assert.equal(h.pending(), 1);
});

test('loop: a throwing step pauses the sim with reason "error"; rendering and input keep going', () => {
  const h = harness({ onStep: (tick) => { if (tick === 3) throw new Error('bad tick'); } });
  h.loop.start();
  for (let i = 0; i < 10; i++) h.advance(TICK_MS);
  assert.deepEqual(h.steps, [0, 1, 2, 3]);
  assert.deepEqual(h.errors, [['step', 'bad tick']]);
  assert.equal(h.loop.isPaused('error'), true);
  assert.equal(h.renders.length, 10);
  assert.equal(h.befores(), 10, 'the controller still works, so the error screen can be dismissed');
  assert.equal(h.loop.running, true);
});

test('loop: stop() from beforeSteps runs no tick that frame', () => {
  let t = 0; let queue = []; let steps = 0; let stopNow = false;
  const loop = createLoop({
    step: () => { steps++; }, render: () => {},
    beforeSteps: () => { if (stopNow) loop.stop(); },
    now: () => t, raf: (cb) => { queue.push(cb); return 1; }, cancelRaf: () => { queue = []; },
  });
  loop.start();
  t += TICK_MS * 2 + 0.01; let q = queue; queue = []; for (const cb of q) cb(t);
  assert.equal(steps, 2);
  stopNow = true;
  t += TICK_MS * 2 + 0.01; q = queue; queue = []; for (const cb of q) cb(t);
  assert.equal(steps, 2, 'no tick after stop()');
  assert.equal(queue.length, 0);
});

test('loop: a render that throws three frames running stops the loop; start() revives it', () => {
  let fail = true;
  let stopped = null;
  const h = harness({ onRender: () => { if (fail) throw new Error('draw'); }, loop: { onStopped: (why) => { stopped = why; } } });
  h.loop.start();
  for (let i = 0; i < 5; i++) h.advance(TICK_MS);
  assert.equal(h.errors.filter((e) => e[0] === 'render').length, 3);
  assert.equal(h.loop.running, false);
  assert.equal(stopped, 'render-errors', 'the game is told, so it can show a message');
  assert.equal(h.pending(), 0);
  fail = false;
  h.loop.start();
  h.advance(TICK_MS);
  assert.equal(h.loop.running, true);
  assert.equal(h.pending(), 1);
});

test('loop: a throwing error handler or beforeSteps never kills the loop', () => {
  let t = 0; let queue = [];
  const loop = createLoop({
    step: () => {}, render: () => {},
    beforeSteps: () => { throw new Error('poll'); },
    onError: () => { throw new Error('handler'); },
    now: () => t, raf: (cb) => { queue.push(cb); return 1; }, cancelRaf: () => {},
  });
  loop.start();
  for (let i = 0; i < 5; i++) { t += TICK_MS; const q = queue; queue = []; for (const cb of q) cb(t); }
  assert.equal(loop.running, true);
  assert.ok(loop.tick >= 4);
});

test('loop: reset() zeroes the tick and timing state but keeps pause reasons', () => {
  const h = harness();
  h.loop.start();
  for (let i = 0; i < 10; i++) h.advance(TICK_MS);
  assert.ok(h.loop.tick > 0);
  h.loop.pause('menu');
  h.loop.reset();
  assert.equal(h.loop.tick, 0);
  assert.equal(h.loop.droppedMs, 0);
  assert.deepEqual(h.loop.pauseReasons(), ['menu']);
});

test('loop: backwards clock hiccups are ignored; bad arguments throw', () => {
  const h = harness();
  h.loop.start();
  h.advance(-100);                 // clock jumps back: counted as zero time
  assert.equal(h.steps.length, 0);
  h.advance(TICK_MS + 0.01);       // then one normal frame later: exactly one tick
  assert.equal(h.steps.length, 1);
  assert.throws(() => createLoop({}));
});

test('loop: beforeSteps runs once per frame, before that frame\'s ticks', () => {
  const order = [];
  let t = 0, cb = null;
  const loop = createLoop({
    step: () => order.push('step'), render: () => order.push('render'), beforeSteps: () => order.push('before'),
    now: () => t, raf: (f) => { cb = f; return 1; }, cancelRaf: () => {},
  });
  loop.start();
  t += TICK_MS * 2 + 0.01; cb(t);
  assert.deepEqual(order, ['before', 'step', 'step', 'render']);
});
