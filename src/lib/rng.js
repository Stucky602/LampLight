// Seeded random numbers for the simulation. Never use Math.random in sim/ or meta/.
//
// Generator: sfc32 (Chris Doty-Humphrey's Small Fast Counter), 128-bit state.
// Only 32-bit integer operations are used, so every engine produces identical sequences.
//
// Streams: a run owns one root seed and forks named streams from it ('spawn', 'combat',
// 'draft', 'loot', 'boss'). A fork depends only on the root seed and its label, never on how
// much any other stream has been used. Changing draft code therefore can't reshuffle spawns.

import { fnv1a } from './hash.js';

const TWO_32 = 4294967296;

function splitmix32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Turn any seed (number or string) into an unsigned 32-bit integer. */
export function seedToU32(seed) {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) throw new Error(`rng seed must be finite, got ${seed}`);
    // Mix both halves of large integers so 1 and 2^32+1 differ.
    const lo = seed >>> 0;
    const hi = Math.floor(seed / TWO_32) >>> 0;
    return (lo ^ Math.imul(hi, 0x9e3779b1)) >>> 0;
  }
  if (typeof seed === 'string') return fnv1a(seed);
  throw new Error(`rng seed must be a number or string, got ${typeof seed}`);
}

/**
 * Create a root random stream from a run seed. Named streams come from fork().
 * @param {number|string} seed
 */
export function createRng(seed) {
  return makeStream(seedToU32(seed), null);
}

const LABEL_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * A stream is fully determined by (root seed, path). The root stream has path null. A fork's
 * state is derived from the root seed and the text "fork:<path>", so no fork can ever equal
 * the root stream, and fork('a').fork('b') is the stream at path "a/b".
 */
function makeStream(root, path) {
  const label = path === null ? 'root' : path;
  const init = splitmix32(path === null ? root : (root ^ fnv1a(`fork:${path}`)) >>> 0);
  let a = init(), b = init(), c = init(), d = init();

  function u32() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }

  // Warm up: the first few outputs of sfc32 correlate with the seed.
  for (let i = 0; i < 12; i++) u32();

  const rng = {
    label,
    seed: root,
    /** Unsigned 32-bit integer. */
    u32,
    /** Float in [0, 1). Exact: a 32-bit integer divided by 2^32. */
    next() { return u32() / TWO_32; },
    /** Integer in [0, n). Unbiased (rejection sampling). */
    int(n) {
      if (!(n >= 1) || n > TWO_32 || n !== Math.floor(n)) throw new Error(`rng.int(n) needs an integer 1..2^32, got ${n}`);
      if (n === 1) return 0;
      const limit = TWO_32 - (TWO_32 % n);
      let x;
      do { x = u32(); } while (x >= limit);
      return x % n;
    },
    /** Float in [lo, hi). */
    range(lo, hi) { return lo + (hi - lo) * rng.next(); },
    /** True with probability p (p <= 0 is never, p >= 1 is always). */
    chance(p) { return p >= 1 ? true : p <= 0 ? false : rng.next() < p; },
    /** Uniform pick from a non-empty array. */
    pick(arr) {
      if (!arr.length) throw new Error('rng.pick on an empty array');
      return arr[rng.int(arr.length)];
    },
    /**
     * Index chosen in proportion to weights. Zero and negative weights are never chosen.
     * Returns -1 if every weight is zero. Throws on NaN or infinite weights (a data bug).
     */
    weighted(weights) {
      let total = 0;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i];
        if (typeof w !== 'number' || !Number.isFinite(w)) throw new Error(`rng.weighted: weight ${i} is ${w}; weights must be finite numbers`);
        if (w > 0) total += w;
      }
      if (!(total > 0)) return -1;
      let r = rng.next() * total;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i];
        if (w <= 0) continue;
        if (r < w) return i;
        r -= w;
      }
      // Floating-point leftovers: fall back to the last positive weight.
      for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
      return -1;
    },
    /** Fisher-Yates shuffle in place. Returns the same array. */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    /** A new independent stream derived from the root seed and this stream's path plus a label. */
    fork(childLabel) {
      if (typeof childLabel !== 'string' || !LABEL_RE.test(childLabel)) {
        throw new Error(`rng.fork label must be 1-40 letters, digits, _ or - (got ${JSON.stringify(childLabel)})`);
      }
      return makeStream(root, path === null ? childLabel : `${path}/${childLabel}`);
    },
    /** Snapshot of the internal state (for replays and saves). */
    getState() { return [a >>> 0, b >>> 0, c >>> 0, d >>> 0]; },
    /** Restore a snapshot from getState(). Throws on anything that isn't four 32-bit integers. */
    setState(s) {
      if (!Array.isArray(s) || s.length !== 4 || !s.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) {
        throw new Error('rng.setState needs [a, b, c, d]: four unsigned 32-bit integers');
      }
      a = s[0] | 0; b = s[1] | 0; c = s[2] | 0; d = s[3] | 0;
    },
  };
  return rng;
}
