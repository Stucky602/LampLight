import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, seedToU32 } from '../src/lib/rng.js';
import * as fm from '../src/lib/fmath.js';
import { crc32, crc32Hex, fnv1a, createStateHash, utf8 } from '../src/lib/hash.js';

test('rng: same seed gives the same sequence; different seeds differ', () => {
  const a = createRng(12345), b = createRng(12345), c = createRng(12346);
  const sa = Array.from({ length: 50 }, () => a.u32());
  const sb = Array.from({ length: 50 }, () => b.u32());
  const sc = Array.from({ length: 50 }, () => c.u32());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
});

test('rng: golden sequence never changes (replays depend on it)', () => {
  const r = createRng('lamplight');
  const got = Array.from({ length: 6 }, () => r.u32());
  assert.deepEqual(got, GOLDEN_RNG);
});

test('rng: forks depend only on the root seed and label, not on use order', () => {
  const r1 = createRng(99);
  const spawnA = r1.fork('spawn');
  const x1 = spawnA.u32();
  const r2 = createRng(99);
  for (let i = 0; i < 1000; i++) r2.u32(); // consume the parent heavily
  r2.fork('draft').u32();                   // and use another fork first
  const spawnB = r2.fork('spawn');
  assert.equal(spawnB.u32(), x1);
  assert.notEqual(createRng(99).fork('loot').u32(), x1);
  assert.equal(createRng(99).fork('boss').fork('phase').label, 'boss/phase');
});

test('rng: next() is in [0,1) and int(n) is unbiased and in range', () => {
  const r = createRng(7);
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 70000; i++) {
    const f = r.next();
    assert.ok(f >= 0 && f < 1);
    const k = r.int(7);
    assert.ok(Number.isInteger(k) && k >= 0 && k < 7);
    counts[k]++;
  }
  for (const c of counts) assert.ok(Math.abs(c - 10000) < 450, `bucket ${c} too far from 10000`);
  assert.throws(() => r.int(0));
  assert.throws(() => r.int(2.5));
  assert.equal(r.int(1), 0);
});

test('rng: weighted() respects weights and ignores zero or negative ones', () => {
  const r = createRng(3);
  const hits = [0, 0, 0, 0];
  for (let i = 0; i < 40000; i++) hits[r.weighted([1, 0, 3, -5])]++;
  assert.equal(hits[1], 0);
  assert.equal(hits[3], 0);
  const ratio = hits[2] / hits[0];
  assert.ok(ratio > 2.8 && ratio < 3.2, `ratio ${ratio}`);
  assert.equal(r.weighted([0, 0]), -1);
  assert.equal(r.weighted([]), -1);
});

test('rng: shuffle is a permutation; pick needs a non-empty array; chance edges', () => {
  const r = createRng(11);
  const arr = Array.from({ length: 30 }, (_, i) => i);
  const s = r.shuffle(arr.slice());
  assert.deepEqual(s.slice().sort((x, y) => x - y), arr);
  assert.throws(() => r.pick([]));
  assert.equal(r.chance(1), true);
  assert.equal(r.chance(0), false);
  assert.equal(r.chance(-1), false);
});

test('rng: getState/setState round-trips the stream exactly', () => {
  const r = createRng(2024);
  for (let i = 0; i < 17; i++) r.u32();
  const snap = r.getState();
  const ahead = Array.from({ length: 10 }, () => r.u32());
  r.setState(snap);
  assert.deepEqual(Array.from({ length: 10 }, () => r.u32()), ahead);
  assert.throws(() => r.setState([1, 2, 3]));
});

test('rng: seeds are validated and large integers are mixed', () => {
  assert.throws(() => createRng(NaN));
  assert.throws(() => createRng({}));
  assert.notEqual(seedToU32(1), seedToU32(2 ** 32 + 1));
  assert.equal(seedToU32('abc'), fnv1a('abc'));
});

test('fmath: matches engine math to ~1e-14 across wide ranges', () => {
  const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
  for (let i = -5000; i <= 5000; i++) {
    const x = i * 0.0311;
    assert.ok(rel(fm.fsin(x), Math.sin(x)) < 1e-14, `sin ${x}`);
    assert.ok(rel(fm.fcos(x), Math.cos(x)) < 1e-14, `cos ${x}`);
    assert.ok(rel(fm.fatan(x), Math.atan(x)) < 1e-14, `atan ${x}`);
  }
  for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) {
    const y = i * 0.53, x = j * 0.47;
    assert.ok(rel(fm.fatan2(y, x), Math.atan2(y, x)) < 1e-14, `atan2 ${y},${x}`);
  }
  for (let i = -300; i <= 300; i++) assert.ok(rel(fm.fexp(i * 0.2), Math.exp(i * 0.2)) < 1e-14);
  for (let i = 1; i <= 3000; i++) assert.ok(rel(fm.flog(i * 0.917), Math.log(i * 0.917)) < 1e-14);
  for (let i = 1; i < 100; i++) for (let j = -10; j < 10; j++) {
    const a = i * 0.11, b = j * 0.73;
    assert.ok(rel(fm.fpow(a, b), Math.pow(a, b)) < 1e-13, `pow ${a}^${b}`);
  }
});

test('fmath: golden values are bit-identical (this is what keeps replays exact)', () => {
  assert.equal(fm.fsin(1.2345), 0.9439833239445111);
  assert.equal(fm.fcos(-7.5), 0.3466353178350258);
  assert.equal(fm.fatan2(-3, -4), -2.498091544796509);
  assert.equal(fm.fexp(2.5), 12.182493960703477);
  assert.equal(fm.flog(10), 2.3025850929940455);
  assert.equal(fm.fpow(1.15, 7.3), 2.773921933653752);
  assert.equal(fm.wrapAngle(10), -2.5663706143591725);
});

test('fmath: edge cases', () => {
  assert.ok(Number.isNaN(fm.fsin(Infinity)));
  assert.ok(Number.isNaN(fm.flog(-1)));
  assert.equal(fm.flog(0), -Infinity);
  assert.equal(fm.fexp(1000), Infinity);
  assert.equal(fm.fexp(-1000), 0);
  assert.equal(fm.fatan2(0, 0), 0);
  assert.equal(fm.fatan2(0, -1), Math.PI);
  assert.equal(fm.fatan2(-0, -1), -Math.PI);
  assert.equal(fm.fatan(Infinity), Math.PI / 2);
  assert.equal(fm.fpow(2, 10), 1024);
  assert.equal(fm.fpow(-2, 3), -8);
  assert.equal(fm.fpow(5, 0), 1);
  assert.equal(fm.flen(3, 4), 5);
  const w = fm.wrapAngle(-Math.PI);
  assert.ok(w > -Math.PI && w <= Math.PI);
});

test('hash: CRC-32 and FNV-1a match published test vectors', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);
  assert.equal(crc32Hex(''), '00000000');
  assert.equal(crc32Hex('The quick brown fox jumps over the lazy dog'), '414fa339');
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
});

test('hash: UTF-8 encoding covers multi-byte and surrogate pairs', () => {
  assert.deepEqual([...utf8('é')], [0xc3, 0xa9]);
  assert.deepEqual([...utf8('€')], [0xe2, 0x82, 0xac]);
  assert.deepEqual([...utf8('😀')], [0xf0, 0x9f, 0x98, 0x80]);
});

test('hash: state hash is order-sensitive and hashes float bits exactly', () => {
  const f = new Float32Array([1.5, -2.25, 3]);
  const h1 = createStateHash().array(f).int(7).hex();
  const h2 = createStateHash().array(f).int(7).hex();
  const h3 = createStateHash().int(7).array(f).hex();
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  const g = new Float32Array([1.5, -2.25, 3.0000002]);
  assert.notEqual(createStateHash().array(g).int(7).hex(), h1);
  assert.equal(createStateHash().float64(0.1).hex(), createStateHash().float64(0.1).hex());
  assert.notEqual(createStateHash().float64(0).hex(), createStateHash().float64(-0).hex());
});

const GOLDEN_RNG = [2409553186,2090424196,2074138936,1960809423,2893241926,1686440199];

test('rng: every named stream has a pinned golden sequence (a change here would break replays)', () => {
  const r = createRng('lamplight');
  const got = {};
  for (const f of ['spawn', 'combat', 'draft', 'loot', 'boss']) { const s = r.fork(f); got[f] = [s.u32(), s.u32()]; }
  got['boss/phase'] = [r.fork('boss').fork('phase').u32()];
  assert.deepEqual(got, {
    spawn: [2692128346, 399984637], combat: [3717510399, 1615712807], draft: [1697044458, 3113831001],
    loot: [336877277, 1820571419], boss: [1322343594, 630620949], 'boss/phase': [3578802875],
  });
});

test('rng: a fork never equals the root stream; labels are validated', () => {
  const root = createRng(5);
  const rootFirst = createRng(5).u32();
  assert.notEqual(root.fork('root').u32(), rootFirst);
  assert.throws(() => root.fork(''));
  assert.throws(() => root.fork('a/b'), /letters, digits/);
  assert.throws(() => root.fork(7));
});

test('rng: weighted() refuses non-finite weights; setState refuses corrupt state', () => {
  const r = createRng(1);
  assert.throws(() => r.weighted([Infinity, 1]), /finite/);
  assert.throws(() => r.weighted([1, NaN]), /finite/);
  assert.throws(() => r.weighted([1, '2']), /finite/);
  assert.throws(() => r.setState([NaN, 'x', {}, null]));
  assert.throws(() => r.setState([1, 2, 3, 2 ** 32]));
  assert.throws(() => r.setState([1, 2, 3, 1.5]));
  r.setState([1, 2, 3, 4]);
  assert.deepEqual(r.getState(), [1, 2, 3, 4]);
});

test('fmath: golden values for every sine/cosine quadrant, both signs, and large arguments', () => {
  const GOLD = [[0.3, 0.29552020666133955, 0.955336489125606], [1.9, 0.9463000876874145, -0.32328956686350335],
    [3.5, -0.35078322768961984, -0.9364566872907963], [5.1, -0.9258146823277325, 0.37797774271298024],
    [-0.3, -0.29552020666133955, 0.955336489125606], [-1.9, -0.9463000876874145, -0.32328956686350335],
    [-3.5, 0.35078322768961984, -0.9364566872907963], [-5.1, 0.9258146823277325, 0.37797774271298024],
    [100.25, -0.27728285645485135, 0.9607883312760612], [-99999.5, -0.5104916150747798, -0.8598827309222711]];
  const out = new Float64Array(2);
  for (const [x, s, c] of GOLD) {
    assert.equal(fm.fsin(x), s, `sin ${x}`);
    assert.equal(fm.fcos(x), c, `cos ${x}`);
    fm.sincosInto(x, out, 0);
    assert.equal(out[0], s, `sincosInto sin ${x}`);
    assert.equal(out[1], c, `sincosInto cos ${x}`);
  }
});

test('fmath: golden values for the atan reciprocal branch, negative exp, subnormal log, fractional pow', () => {
  assert.equal(fm.fatan(3.7), 1.306832603169192);
  assert.equal(fm.fatan(-12.5), -1.4909663410826592);
  assert.equal(fm.fexp(-3.25), 0.038774207831721995);
  assert.equal(fm.fexp(-700), 9.859676543759769e-305);
  assert.equal(fm.flog(0.37), -0.9942522733438669);
  assert.equal(fm.flog(1e-310), -713.8013788281542);
  assert.equal(fm.fpow(0.5, 2.25), 0.21022410381342865);
});

test('fmath: sincosInto matches fsin/fcos bit for bit across a wide sweep', () => {
  const out = new Float64Array(4);
  for (let i = -20000; i <= 20000; i++) {
    const x = i * 0.0173;
    fm.sincosInto(x, out, 2);
    assert.ok(Object.is(out[2], fm.fsin(x)) && Object.is(out[3], fm.fcos(x)), `x=${x}`);
  }
});

test('fmath: signed zeros and range edges follow Math conventions', () => {
  assert.ok(Object.is(fm.fsin(-0), -0));
  assert.ok(Object.is(fm.fatan(-0), -0));
  for (const [y, x] of [[0, 0], [-0, 0], [0, -0], [-0, -0], [0, -1], [-0, -1], [0, 1], [-0, 1]]) {
    assert.ok(Object.is(fm.fatan2(y, x), Math.atan2(y, x)), `atan2(${Object.is(y, -0) ? '-0' : y}, ${Object.is(x, -0) ? '-0' : x})`);
  }
  assert.ok(Number.isFinite(fm.fexp(709.5)), 'e^709.5 is finite, like Math.exp');
  assert.ok(Math.abs(fm.fexp(709.5) / Math.exp(709.5) - 1) < 1e-13);
  assert.equal(fm.fexp(709.8), Infinity);
  assert.ok(Number.isNaN(fm.fexp(NaN)));
  assert.ok(Number.isNaN(fm.fcos(Infinity)));
  assert.ok(Number.isNaN(fm.fatan(NaN)));
  assert.ok(Number.isNaN(fm.fatan2(NaN, 1)));
  assert.ok(Number.isNaN(fm.fatan2(1, NaN)));
  assert.ok(Number.isNaN(fm.fpow(-2, 0.5)));
  assert.equal(fm.fpow(0, 2.5), 0);
  assert.equal(fm.fpow(0, -2.5), Infinity);
});

test('hash: plain arrays hash by exact value; non-numeric input is refused', () => {
  assert.notEqual(createStateHash().array([1.5, 1.7]).hex(), createStateHash().array([1, 1]).hex());
  assert.equal(createStateHash().array([1.5, 2]).hex(), createStateHash().array([1.5, 2]).hex());
  assert.equal(createStateHash().array(new Float64Array([1.5, 2])).hex(), createStateHash().array([1.5, 2]).hex(), 'float64 array and plain array agree');
  assert.throws(() => createStateHash().array(['a']));
  assert.throws(() => createStateHash().array({ length: 1 }));
  assert.equal(createStateHash().array(new Int32Array([1, 2])).hex(), createStateHash().array(new Int32Array([1, 2])).hex());
});

test('hash: lone surrogates encode as U+FFFD, like TextEncoder', () => {
  assert.deepEqual([...utf8('\ud800')], [...new TextEncoder().encode('\ud800')]);
  assert.deepEqual([...utf8('a\udc00b')], [...new TextEncoder().encode('a\udc00b')]);
  assert.deepEqual([...utf8('x😀y')], [...new TextEncoder().encode('x😀y')]);
});
