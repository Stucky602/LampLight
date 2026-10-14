// The sim's building blocks: pools and handles, the spatial hash, terrain and the flow field,
// and the event buffer (ARCHITECTURE §5.3, §5.4, §5.6, §5.14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool, NO_HANDLE } from '../src/sim/pools.js';
import { createSpatialHash } from '../src/sim/spatial.js';
import { createTerrain, buildLayout, TILE } from '../src/sim/terrain.js';
import { createFlowField } from '../src/sim/flowfield.js';
import { createEventBuffer, EV } from '../src/sim/events.js';
import { createStateHash } from '../src/lib/hash.js';
import { createRng } from '../src/lib/rng.js';

// ---------------------------------------------------------------- pools

test('pools: alloc zeroes every field, stays dense, and swap-with-last keeps order predictable', () => {
  const P = createPool(8, { x: Float32Array, tag: Uint8Array, ring: [Int32Array, 3] });
  const a = P.alloc(), b = P.alloc(), c = P.alloc();
  assert.deepEqual([a, b, c], [0, 1, 2]);
  P.x[a] = 1; P.x[b] = 2; P.x[c] = 3;
  P.ring.set([7, 8, 9], c * 3);
  P.remove(a); // c moves into 0
  assert.equal(P.count, 2);
  assert.deepEqual([P.x[0], P.x[1]], [3, 2]);
  assert.deepEqual([...P.ring.subarray(0, 3)], [7, 8, 9], 'strided fields move with their entity');
  P.x[2] = 99; P.ring[6] = 5; // garbage past the end
  const d = P.alloc();
  assert.equal(d, 2);
  assert.equal(P.x[d], 0, 'a new entity never inherits old values');
  assert.deepEqual([...P.ring.subarray(6, 9)], [0, 0, 0]);
  assert.equal(P.highWater, 3);
});

test('pools: every supported field type moves with its entity on removal; other field types are refused', () => {
  const types = { f32: Float32Array, f64: Float64Array, i8: Int8Array, u8: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array, pair: [Float32Array, 2] };
  const P = createPool(4, types);
  P.alloc(); P.alloc();
  const vals = { f32: 1.5, f64: 2.25, i8: -3, u8: 4, i16: -500, u16: 60000, i32: -70000 };
  for (const [k, v] of Object.entries(vals)) P[k][1] = v;
  P.pair[2] = 0.5; P.pair[3] = -0.75;
  P.remove(0); // entity 1 moves into 0
  for (const [k, v] of Object.entries(vals)) assert.equal(P[k][0], v, `${k} moved`);
  assert.deepEqual([P.pair[0], P.pair[1]], [0.5, -0.75]);
  assert.throws(() => createPool(4, { list: Array }), /typed array/);
  assert.throws(() => createPool(4, { big: Uint32Array }), /typed array/);
});

test('pools: handles survive moves and die with their entity, even after the slot is reused', () => {
  const P = createPool(4, { v: Int32Array });
  const i0 = P.alloc(); P.v[i0] = 10;
  const i1 = P.alloc(); P.v[i1] = 11;
  const i2 = P.alloc(); P.v[i2] = 12;
  const h0 = P.handle(i0), h2 = P.handle(i2);
  P.remove(i0); // entity "12" moves from index 2 to 0
  assert.equal(P.resolve(h0), -1, 'removed entity no longer resolves');
  assert.equal(P.v[P.resolve(h2)], 12, 'moved entity is found at its new index');
  const j = P.alloc(); // reuses the freed slot id
  P.v[j] = 13;
  assert.equal(P.resolve(h0), -1, 'a reused slot has a new generation');
  assert.equal(P.resolve(NO_HANDLE), -1);
  assert.equal(P.resolve(123456), -1, 'garbage handles resolve to nothing');
  assert.ok(P.handle(j) >= 0 && Number.isInteger(P.handle(j)));
});

test('pools: a full pool refuses (and counts it); removing from the middle while walking backward is safe', () => {
  const P = createPool(4, { v: Int32Array });
  for (let k = 0; k < 4; k++) P.v[P.alloc()] = k;
  assert.equal(P.alloc(), -1);
  assert.equal(P.refused, 1);
  for (let i = P.count - 1; i >= 0; i--) if (P.v[i] % 2 === 0) P.remove(i);
  assert.deepEqual([...P.v.subarray(0, P.count)].sort(), [1, 3]);
  assert.throws(() => P.remove(5), /not live/);
  P.clear();
  assert.equal(P.count, 0);
  assert.throws(() => createPool(0, {}), /capacity/);
  assert.throws(() => createPool(4, { count: Int32Array }), /reserved/);
});

test('pools: the state hash covers order, values, generations, and the free list', () => {
  const mk = () => { const P = createPool(8, { v: Float32Array }); for (let k = 0; k < 3; k++) P.v[P.alloc()] = k; return P; };
  const a = mk(), b = mk();
  assert.equal(a.hashInto(createStateHash()).hex(), b.hashInto(createStateHash()).hex());
  b.remove(0); b.v[b.alloc()] = 0; // same values, different order and generations
  assert.notEqual(a.hashInto(createStateHash()).hex(), b.hashInto(createStateHash()).hex());
});

// ---------------------------------------------------------------- spatial hash

function brute(xs, ys, rs, n, x, y, r, skip = -1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i === skip) continue;
    const dx = xs[i] - x, dy = ys[i] - y, rr = r + rs[i];
    if (dx * dx + dy * dy <= rr * rr) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

test('spatial hash: queries match brute force, with big items, clamped stragglers, and a moving window', () => {
  const rng = createRng('spatial');
  const N = 600;
  const xs = new Float32Array(N), ys = new Float32Array(N), rs = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xs[i] = 1000 + rng.range(-900, 900); ys[i] = 1000 + rng.range(-900, 900);
    rs[i] = i % 50 === 0 ? 24 : rng.range(3, 8); // some bosses and elites
  }
  xs[5] = -5000; ys[5] = 1000; // far outside the window: clamped into an edge cell
  const H = createSpatialHash({ capacity: N, cell: 16, cols: 64, rows: 64, maxBig: 4 });
  const out = new Int32Array(N);
  for (const [ox, oy] of [[0, 0], [488, 488], [1500, -200]]) {
    H.build(N, xs, ys, rs, ox, oy);
    assert.ok(H.bigOverflow > 0, 'more big items than the list holds still works');
    for (let q = 0; q < 200; q++) {
      const x = 1000 + rng.range(-1100, 1100), y = 1000 + rng.range(-1100, 1100), r = rng.range(0, 80);
      const m = H.query(x, y, r, out, q % 7);
      assert.deepEqual([...out.subarray(0, m)].sort((a, b) => a - b), brute(xs, ys, rs, N, x, y, r, q % 7), `query ${q} at window ${ox},${oy}`);
    }
    const m = H.query(-5000, 1000, 1, out);
    assert.deepEqual([...out.subarray(0, m)], [5], 'the straggler is still found');
  }
});

test('spatial hash: nearest matches brute force (ties to the lower index) and honors the flag mask', () => {
  const rng = createRng('nearest');
  const N = 400;
  const xs = new Float32Array(N), ys = new Float32Array(N), rs = new Float32Array(N).fill(5);
  const flags = new Uint8Array(N);
  for (let i = 0; i < N; i++) { xs[i] = 1024 + rng.range(-800, 800); ys[i] = 1024 + rng.range(-800, 800); if (i % 3 === 0) flags[i] = 1; }
  xs[10] = xs[11] = 1024; ys[10] = ys[11] = 1100; // an exact tie
  const H = createSpatialHash({ capacity: N, cols: 128, rows: 128 });
  H.build(N, xs, ys, rs, 0, 0);
  for (let q = 0; q < 300; q++) {
    const x = 1024 + rng.range(-700, 700), y = 1024 + rng.range(-700, 700), maxD = rng.range(10, 500);
    const mask = q % 2 ? 1 : 0;
    let best = -1, bd = maxD * maxD;
    for (let i = 0; i < N; i++) {
      if ((flags[i] & mask) !== 0) continue;
      const dx = xs[i] - x, dy = ys[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < bd || (d2 === bd && best >= 0 && i < best)) { bd = d2; best = i; }
    }
    assert.equal(H.nearest(x, y, maxD, flags, mask), best, `nearest ${q}`);
  }
  assert.equal(H.nearest(1024, 1100, 5), 10, 'a tie goes to the lower index');
  assert.equal(H.nearest(1024, 1100, 5, null, 0, 10), 11, 'skip leaves one out');
});

test('spatial hash: results stop at the output size, and an empty build finds nothing', () => {
  const xs = new Float32Array([0, 1, 2, 3]), ys = new Float32Array(4), rs = new Float32Array(4).fill(1);
  const H = createSpatialHash({ capacity: 4, cols: 8, rows: 8 });
  H.build(4, xs, ys, rs, -64, -64);
  assert.equal(H.query(1, 0, 5, new Int32Array(2)), 2);
  H.build(0, xs, ys, rs, 0, 0);
  assert.equal(H.query(1, 0, 5, new Int32Array(4)), 0);
  assert.equal(H.nearest(1, 0, 50), -1);
  assert.throws(() => H.build(5, xs, ys, rs, 0, 0), /capacity/);
});

// ---------------------------------------------------------------- terrain and flow field

function wallMap() {
  // 40 x 40 tiles with a wall across the middle, open only at the right end.
  const cols = 40, rows = 40, solid = new Uint8Array(cols * rows);
  for (let x = 0; x < 34; x++) solid[20 * cols + x] = 1;
  return createTerrain({ cols, rows, solid });
}

test('terrain: circles are pushed out of walls and kept on the map', () => {
  const t = wallMap(), out = new Float64Array(2);
  // Overlapping the wall's top face from above.
  t.collide(100, 20 * TILE - 3, 6, out);
  assert.ok(out[1] <= 20 * TILE - 6 + 1e-9, `pushed up (y ${out[1]})`);
  assert.equal(out[0], 100);
  // Center inside a wall tile: leaves by the nearest open side.
  t.collide(100, 20 * TILE + 2, 5, out);
  assert.ok(!t.blockedAt(out[0], out[1]), 'no longer inside the wall');
  // The map edge.
  t.collide(-10, 5, 6, out);
  assert.deepEqual([...out], [6, 6]);
  assert.equal(t.solidIn(0, 0, 39, 19), 0);
  assert.equal(t.solidIn(0, 20, 39, 20), 34);
  assert.equal(t.blocked(-1, 0), true, 'outside the map is blocked');
});

test('terrain: layouts are deterministic and keep the start area open', () => {
  const layout = { kind: 'scatter', seed: 'x', clusters: 300, size: [1, 3], clearRadius: 10 };
  const a = buildLayout(layout, 128, 128), b = buildLayout(layout, 128, 128);
  assert.deepEqual(a, b);
  for (let y = 60; y < 68; y++) for (let x = 60; x < 68; x++) assert.equal(a[y * 128 + x], 0, 'start area open');
  assert.ok(a.reduce((s, v) => s + v, 0) > 100);
  assert.equal(buildLayout({ kind: 'open' }, 8, 8).reduce((s, v) => s + v, 0), 0);
  assert.throws(() => buildLayout({ kind: 'maze' }, 8, 8), /Unknown map layout/);
});

test('flow field: walks enemies around a wall, updates only on a new tile, and stays off in the open', () => {
  const t = wallMap();
  const f = createFlowField(t, { radius: 32 });
  const px = 10 * TILE + 8, py = 30 * TILE + 8; // player below the wall, on the left
  assert.equal(f.update(px, py), true);
  assert.equal(f.update(px + 3, py + 3), false, 'same tile: no rebuild');
  assert.equal(f.active, true);
  // An enemy straight above the player, on the other side of the wall, must head right (to the gap).
  const out = new Float64Array(2);
  assert.equal(f.dirAt(10 * TILE + 8, 15 * TILE + 8, out), true);
  assert.ok(out[0] > 0.5, `heads for the gap (dir ${out[0]}, ${out[1]})`);
  // Following the field step by step reaches the player.
  let x = 10 * TILE + 8, y = 15 * TILE + 8;
  for (let k = 0; k < 400 && f.stepsAt(x, y) > 0; k++) {
    assert.equal(f.dirAt(x, y, out), true);
    x += out[0] * 8; y += out[1] * 8;
    assert.equal(t.blockedAt(x, y), false, `path never enters a wall (step ${k})`);
  }
  assert.equal(f.stepsAt(x, y), 0, 'arrived');
  assert.equal(f.dirAt(px, py, out), false, 'the player tile says "chase directly"');
  const open = createFlowField(createTerrain({ cols: 40, rows: 40 }), { radius: 16 });
  open.update(100, 100);
  assert.equal(open.active, false);
  assert.equal(open.dirAt(200, 200, out), false);
});

// ---------------------------------------------------------------- events

test('events: low-priority events drop first and are counted; clear resets', () => {
  const b = createEventBuffer(10, 4);
  for (let k = 0; k < 8; k++) b.push(EV.HIT, k, 0, 1);
  assert.equal(b.count, 6, 'hits stop at capacity minus the reserve');
  assert.equal(b.dropped, 2);
  for (let k = 0; k < 4; k++) b.push(EV.KILL, k, 0, 1);
  assert.equal(b.count, 10, 'important events use the reserve');
  assert.equal(b.dropped, 2);
  assert.equal(b.push(EV.KILL, 0, 0), -1, 'a full buffer drops even important events');
  assert.equal(b.dropped, 3);
  assert.equal(b.countOf(EV.KILL), 4);
  assert.deepEqual([b.type[9], b.x[9]], [EV.KILL, 3]);
  b.clear();
  assert.equal(b.count, 0);
  assert.equal(b.dropped, 0);
  assert.equal(b.droppedTotal, 3);
});

// ---------------------------------------------------------------- the edges the judges pinned

test('pools: a capacity that isn\'t a power of two works, and a handle for a dead index is NO_HANDLE', () => {
  const P = createPool(5, { v: Int32Array });
  const hs = [];
  for (let k = 0; k < 5; k++) { const i = P.alloc(); P.v[i] = k; hs.push(P.handle(i)); }
  assert.equal(P.alloc(), -1);
  for (let k = 0; k < 5; k++) assert.equal(P.v[P.resolve(hs[k])], k);
  P.remove(0);
  assert.equal(P.resolve(hs[0]), -1);
  assert.equal(P.handle(4), NO_HANDLE, 'index 4 is past the live range now');
  assert.equal(P.handle(-1), NO_HANDLE);
});

test('spatial hash: elites and bosses (big items), and more of them than the big list holds, are found like any other', () => {
  const rng = createRng('big');
  const N = 300, maxBig = 4;
  const xs = new Float32Array(N), ys = new Float32Array(N), rs = new Float32Array(N);
  for (let i = 0; i < N; i++) { xs[i] = 1024 + rng.range(-600, 600); ys[i] = 1024 + rng.range(-600, 600); rs[i] = i % 25 === 0 ? 20 + rng.range(0, 20) : 5; }
  const H = createSpatialHash({ capacity: N, cols: 128, rows: 128, maxBig });
  H.build(N, xs, ys, rs, 0, 0);
  assert.equal(H.bigCount, maxBig);
  assert.ok(H.bigOverflow > 0, 'some big items spilled into the grid');
  const out = new Int32Array(N);
  for (let q = 0; q < 300; q++) {
    const x = 1024 + rng.range(-650, 650), y = 1024 + rng.range(-650, 650), r = rng.range(1, 60), maxD = rng.range(10, 400);
    // query: every big item whose edge the circle reaches, including ones only the widened search finds
    const m = H.query(x, y, r, out);
    assert.deepEqual([...out.subarray(0, m)].sort((a, b) => a - b), brute(xs, ys, rs, N, x, y, r), `query ${q}`);
    // nearest (by center) over everything, big items included
    let best = -1, bd = maxD * maxD;
    for (let i = 0; i < N; i++) { const dx = xs[i] - x, dy = ys[i] - y, d2 = dx * dx + dy * dy; if (d2 < bd || (d2 === bd && best >= 0 && i < best)) { bd = d2; best = i; } }
    assert.equal(H.nearest(x, y, maxD), best, `nearest ${q}`);
  }
  // Only a big item's edge is in reach: a query that must widen to find it.
  const X = new Float32Array([1000]), Y = new Float32Array([1000]), R = new Float32Array([40]);
  const B = createSpatialHash({ capacity: 1, cols: 128, rows: 128, maxBig: 0 });
  B.build(1, X, Y, R, 0, 0);
  assert.equal(B.query(1045, 1000, 6, out), 1, 'its edge at 40 px reaches a 6 px circle 45 px away');
  assert.equal(B.nearest(1000, 1000, Infinity, new Uint8Array(1).fill(1), 1), -1, 'an unbounded search with everything masked ends');
});

test('flow field: a new player tile changes the field; sealed pockets and corners are handled', () => {
  const t = wallMap(), out = new Float64Array(2);
  const f = createFlowField(t, { radius: 32 });
  f.update(10 * TILE + 8, 30 * TILE + 8);
  const s1 = f.stepsAt(10 * TILE + 8, 25 * TILE + 8);
  f.update(10 * TILE + 8, 26 * TILE + 8);
  assert.equal(f.stepsAt(10 * TILE + 8, 25 * TILE + 8), 1, 'rebuilt around the new tile');
  assert.notEqual(s1, 1);
  assert.equal(f.dirAt(10 * TILE + 8, 25 * TILE + 8, out), true);
  assert.deepEqual([...out], [0, 1], 'the cached direction was rebuilt too');
  // A sealed box: nothing inside can reach the player, so it chases directly (no direction).
  const cols = 40, rows = 40, solid = new Uint8Array(cols * rows);
  for (let k = 0; k < 7; k++) { solid[5 * cols + 5 + k] = 1; solid[11 * cols + 5 + k] = 1; solid[(5 + k) * cols + 5] = 1; solid[(5 + k) * cols + 11] = 1; }
  const box = createFlowField(createTerrain({ cols, rows, solid }), { radius: 20 });
  box.update(20 * TILE + 8, 20 * TILE + 8);
  assert.equal(box.stepsAt(8 * TILE + 8, 8 * TILE + 8), -1);
  assert.equal(box.dirAt(8 * TILE + 8, 8 * TILE + 8, out), false);
  // Diagonal steps are used in the open, never across a wall corner.
  const g = createFlowField(t, { radius: 32 });
  g.update(20 * TILE + 8, 30 * TILE + 8);
  assert.equal(g.dirAt(25 * TILE + 8, 35 * TILE + 8, out), true);
  assert.ok(out[0] !== 0 && out[1] !== 0, 'a diagonal in the open');
});

test('enemies: a crate corner doesn\'t trap an enemy between the straight line and the field', async () => {
  // The judge's case on the real map: the field says "up" within 45 degrees of the straight line,
  // which runs into a block corner; the sailor must still arrive.
  const { DATA } = await import('../src/data/index.js');
  const { createWorld, stepWorld } = await import('../src/sim/world.js');
  const { spawnEnemy } = await import('../src/sim/enemies.js');
  const map = { ...DATA.maps[0], id: 'probe', timeline: { bands: [{ from: 0, to: 9999, roster: { fog_wisp: 1 }, density: [0, 0] }], events: [] } };
  const none = { ...DATA.characters[0], id: 'none', start: null, innate: null, mechanic: null };
  const w = createWorld({ seed: 2, map: 'probe', character: 'none', invulnerable: true }, { ...DATA, maps: [...DATA.maps, map], characters: [...DATA.characters, none] });
  w.player.x = 834; w.player.y = 962;
  spawnEnemy(w, w.enemyIndex.get('drowned_sailor'), 834 + 300 * Math.cos(1.4), 962 + 300 * Math.sin(1.4), null);
  let t = 0;
  for (; t < 60 * 30; t++) { stepWorld(w, { mx: 0, my: 0, buttons: 0 }); if (Math.hypot(w.enemies.x[0] - 834, w.enemies.y[0] - 962) < 14) break; }
  assert.ok(t < 60 * 30, 'the sailor reached the player');
  // Pressed against a player standing still, it jostles them at most shoveMax a tick.
  const x0 = w.player.x, y0 = w.player.y;
  for (let k = 0; k < 60; k++) stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.ok(Math.hypot(w.player.x - x0, w.player.y - y0) <= w.tuning.player.shoveMax * 60 + 1e-6, 'jostled, not bulldozed');
});

test('terrain: the map edge always holds, a circle inside a tile leaves by the nearest open side, and tiny scatter maps are refused', () => {
  const t = wallMap(), out = new Float64Array(2);
  t.collide(t.width + 50, 100, 6, out);
  assert.equal(out[0], t.width - 6);
  // Inside the wall's rightmost tile (x 33), nearer its right side: out to the right (open).
  t.collide(33 * TILE + 13, 20 * TILE + 8, 3, out);
  assert.ok(out[0] >= 34 * TILE + 3 - 1e-9 && out[1] === 20 * TILE + 8, `out to the right: ${[...out]}`);
  // Two blocks one tile apart: a circle pushed from one lands clear of both after the two passes.
  const solid = new Uint8Array(20 * 20);
  solid[10 * 20 + 8] = 1; solid[10 * 20 + 10] = 1;
  const g = createTerrain({ cols: 20, rows: 20, solid });
  const gap = (x, y, tx, ty) => { const qx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE)), qy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE)); return Math.hypot(x - qx, y - qy); };
  g.collide(9 * TILE + 5, 10 * TILE + 8, 7, out);
  assert.ok(gap(out[0], out[1], 8, 10) >= 7 - 1e-6 && gap(out[0], out[1], 10, 10) >= 7 - 1e-6, `clear of both blocks: ${[...out].map((v) => v.toFixed(2))}`);
  assert.throws(() => buildLayout({ kind: 'scatter', seed: 'x', clusters: 5, size: [1, 3] }, 6, 6), /at least 9 tiles/);
});

test('events: reserve() keeps the same room for important events that push() does', () => {
  const b = createEventBuffer(10, 4);
  for (let k = 0; k < 8; k++) b.reserve(EV.HIT);
  assert.equal(b.count, 6, 'hits stop at the reserve line');
  assert.equal(b.dropped, 2);
  assert.ok(b.reserve(EV.KILL) >= 0 && b.reserve(EV.LEVEL_UP) >= 0 && b.reserve(EV.TELEGRAPH) >= 0, 'kills, level-ups, and warnings still fit');
  const i = b.reserve(EV.KILL);
  assert.equal(i, 9);
  assert.deepEqual([b.x[i], b.a[i], b.d[i]], [0, 0, 0], 'fields start at 0');
  assert.equal(b.reserve(EV.KILL), -1, 'full');
});

test('spatial hash: an item with a NaN position (a bug elsewhere) does not break the grid for the others', () => {
  const xs = new Float32Array([NaN, 8, 100]), ys = new Float32Array([NaN, 8, 100]), rs = new Float32Array([5, 5, 5]);
  const H = createSpatialHash({ capacity: 3, cols: 16, rows: 16 });
  H.build(3, xs, ys, rs, 0, 0);
  const out = new Int32Array(4);
  assert.deepEqual([...out.subarray(0, H.query(8, 8, 5, out))], [1], 'the item sharing its corner cell is found');
  assert.deepEqual([...out.subarray(0, H.query(100, 100, 5, out))], [2]);
  assert.equal(H.nearest(10, 10, 50), 1);
});

test('flow field: a direction asked for before the player moves is recomputed after', () => {
  const t = wallMap(), out = new Float64Array(2);
  const f = createFlowField(t, { radius: 32 });
  f.update(10 * TILE + 8, 30 * TILE + 8);
  assert.equal(f.dirAt(10 * TILE + 8, 25 * TILE + 8, out), true);
  assert.deepEqual([...out], [0, 1], 'straight down toward the player at first');
  f.update(10 * TILE + 8, 16 * TILE + 8); // the player walks to the other side of the wall (row 16)
  assert.equal(f.dirAt(10 * TILE + 8, 25 * TILE + 8, out), true);
  assert.ok(out[0] > 0.5, `now heads right, for the gap (${[...out]})`);
});

test('events: reserve() clears a slot that held an older event', () => {
  const b = createEventBuffer(4, 1);
  const i = b.push(EV.KILL, 5, 6, 7, 8, 9, 10);
  b.clear();
  const j = b.reserve(EV.GEM);
  assert.equal(j, i);
  assert.deepEqual([b.x[j], b.y[j], b.a[j], b.b[j], b.c[j], b.d[j]], [0, 0, 0, 0, 0, 0]);
});

test('pools: generations wrap only after 2^(31 - id bits) reuses', () => {
  const P = createPool(4096, { v: Int32Array });
  const i = P.alloc(), h = P.handle(i);
  P.remove(i);
  // Reuse the same slot until its generation wraps back to where it started.
  let wrapped = -1;
  for (let k = 1; k <= (1 << 19) + 1; k++) { const j = P.alloc(); if (P.handle(j) === h) { wrapped = k; P.remove(j); break; } P.remove(j); }
  assert.equal(wrapped, 1 << 19, 'the handle comes back after 524,288 reuses, not sooner');
});
