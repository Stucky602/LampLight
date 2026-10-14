// Deterministic math for the simulation.
//
// JavaScript engines are allowed to return slightly different bits from Math.sin, Math.cos,
// Math.atan2, Math.exp, Math.pow, Math.log, and Math.hypot. Replays are recorded in Electron (or
// a browser) and replayed by Claude in Node, which run different V8 versions, so the sim can't
// use them. Everything here is built from + - * /, Math.sqrt (IEEE 754 requires it to be exactly
// rounded), exact helpers (Math.round, Math.floor, Math.abs), and exact bit manipulation.
//
// Method: polynomials (Taylor series evaluated by Horner's rule) after exact range reduction.
// No lookup tables. Accuracy is within about 1 unit in the last place of engine math; the point
// is that the result is bit-identical everywhere. The judge verified the outputs hash identically
// under Node 22 (V8 12.4), Electron 44 (V8 15.2), and Bun (JavaScriptCore).
//
// Garbage, measured (tools/bench/fmath-alloc.mjs): every function here costs 0 bytes per call in
// the sim's pattern, a per-tick loop over the entities that writes results into typed arrays or
// a local total. That depends on V8 inlining the call. A call it doesn't inline boxes each
// non-integer double argument and result (16 bytes each), and V8 inlines within a per-function
// budget, so keep per-entity loops in small system functions. The Phase 2 soak test holds the
// real per-tick total (ARCHITECTURE.md §17). Speed per call: flen ~2 ns, wrapAngle ~3 ns,
// fsin/fcos ~10 ns, fatan/fatan2 ~20 ns, fexp/flog ~50 ns, fpow ~170 ns.
// Signed zeros follow Math conventions.

// The functions use private copies of the constants. Reading a constant through an
// `export const` binding measured slower (fsin 10.8 vs 7.7 ns) and, in a long single loop, made
// V8 box the caller's running total (16 bytes per call). Same bits either way. The exports below
// are aliases for callers.
const PI_ = 3.141592653589793;
const TAU_ = 6.283185307179586;
const HALF_PI_ = 1.5707963267948966;
export const PI = PI_;
export const TAU = TAU_;
export const HALF_PI = HALF_PI_;
const LN2 = 0.6931471805599453;
const MAX_VALUE = 1.7976931348623157e308;
// Cody-Waite splits so range reduction stays accurate for large arguments.
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const SQRT2 = 1.4142135623730951;
const EXP_MAX = 709.782712893384;      // above this e^x overflows
const EXP_MIN = -745.1332191019411;    // below this e^x underflows to 0

// sin and cos use Taylor polynomials on |r| <= pi/4, written out in each function rather than
// shared through helper calls, so each function stays one small unit V8 can inline whole.

/** Deterministic sine. NaN and infinities give NaN. */
export function fsin(x) {
  if (x === 0) return x; // keeps the sign of zero
  const k = Math.round(x / HALF_PI_);
  const r = (x - k * PIO2_HI) - k * PIO2_LO;
  const q = k & 3; // quadrant; ToInt32 keeps k mod 4 exactly for every integer k
  const r2 = r * r;
  let v;
  if ((q & 1) === 0) {
    v = r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 +
      r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))));
  } else {
    v = 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 +
      r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 * (1 / 20922789888000))))))));
  }
  return q >= 2 ? -v : v;
}

/** Deterministic cosine. NaN and infinities give NaN. */
export function fcos(x) {
  const k = Math.round(x / HALF_PI_);
  const r = (x - k * PIO2_HI) - k * PIO2_LO;
  const q = k & 3;
  const r2 = r * r;
  let v;
  if ((q & 1) === 0) {
    v = 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 +
      r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 * (1 / 20922789888000))))))));
  } else {
    v = r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 +
      r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))));
  }
  return q === 1 || q === 2 ? -v : v;
}

/**
 * sin(x) into out[o] and cos(x) into out[o + 1], same bits as fsin/fcos. Returns nothing, so it
 * can't box a result even when V8 doesn't inline it. Use it in the hottest loops.
 * The caller owns the bounds: `out` must be a Float64Array with room for o and o + 1. There is
 * no check here (a typed array silently drops an out-of-range write).
 */
export function sincosInto(x, out, o) {
  const k = Math.round(x / HALF_PI_);
  const r = (x - k * PIO2_HI) - k * PIO2_LO;
  const q = k & 3;
  const r2 = r * r;
  const s = r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 +
    r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))));
  const c = 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 +
    r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 * (1 / 20922789888000))))))));
  if (q === 0) { out[o] = x === 0 ? x : s; out[o + 1] = c; }
  else if (q === 1) { out[o] = c; out[o + 1] = -s; }
  else if (q === 2) { out[o] = -s; out[o + 1] = -c; }
  else { out[o] = -c; out[o + 1] = s; }
}

/** Deterministic arctangent. */
export function fatan(x) {
  if (x === 0) return x; // keeps the sign of zero
  const neg = x < 0;
  let a = neg ? -x : x;
  const inv = a > 1;
  if (inv) a = 1 / a; // +Infinity becomes 0, giving pi/2 below
  // Two half-angle reductions: atan(a) = 2 * atan(a / (1 + sqrt(1 + a^2))), leaving |t| <= 0.199,
  // then the Taylor series to t^21.
  let t = a / (1 + Math.sqrt(1 + a * a));
  t = t / (1 + Math.sqrt(1 + t * t));
  const t2 = t * t;
  let r = 4 * (t * (1 + t2 * (-1 / 3 + t2 * (1 / 5 + t2 * (-1 / 7 + t2 * (1 / 9 + t2 * (-1 / 11 + t2 * (1 / 13 +
    t2 * (-1 / 15 + t2 * (1 / 17 + t2 * (-1 / 19 + t2 * (1 / 21 + 0))))))))))));
  if (inv) r = HALF_PI_ - r;
  return neg ? -r : r;
}

/**
 * Deterministic atan2(y, x). For finite inputs this follows Math.atan2 exactly, signed zeros
 * included. Infinite inputs are not supported (they may give NaN).
 */
export function fatan2(y, x) {
  if (x > 0) return fatan(y / x);
  if (x < 0) {
    const r = fatan(y / x);
    if (y > 0) return r + PI_;
    if (y < 0) return r - PI_;
    if (y === 0) return Object.is(y, -0) ? -PI_ : PI_;
    return y; // NaN
  }
  if (x === 0) {
    if (y > 0) return HALF_PI_;
    if (y < 0) return -HALF_PI_;
    if (y === 0) return Object.is(x, -0) ? (Object.is(y, -0) ? -PI_ : PI_) : y; // (±0, +0) -> ±0
    return y; // NaN
  }
  return x; // NaN
}

// Scratch for exact bit work (module level: no allocation per call).
const DV = new DataView(new ArrayBuffer(8));
const TWO_54 = 18014398509481984;

/** Deterministic e^x. NaN propagates. */
export function fexp(x) {
  if (x > EXP_MAX) return x * MAX_VALUE; // overflows to +Infinity
  if (x < EXP_MIN) return 0;
  const k = Math.round(x / LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO; // |r| <= ln2/2
  let term = 1, sum = 1;
  for (let n = 1; n <= 14; n++) { term = term * r / n; sum += term; }
  // Scale by 2^k in two exact halves (each a normal power of two, built straight from its bits)
  // so a huge or tiny k can't overflow or underflow in one step.
  const half = k >> 1;
  DV.setUint32(4, 0);
  DV.setUint32(0, (half + 1023) << 20);
  const s1 = DV.getFloat64(0);
  DV.setUint32(0, (k - half + 1023) << 20);
  const s2 = DV.getFloat64(0);
  return sum * s1 * s2;
}

/** Deterministic natural log. */
export function flog(x) {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return x;
  // x = m * 2^e with m in [1, 2), read straight from the IEEE bits (exact).
  DV.setFloat64(0, x);
  let hi = DV.getUint32(0);
  let e = (hi >>> 20) & 0x7ff;
  let adj = 0;
  if (e === 0) { // subnormal: scale into the normal range first (exact)
    DV.setFloat64(0, x * TWO_54);
    hi = DV.getUint32(0);
    e = (hi >>> 20) & 0x7ff;
    adj = -54;
  }
  e = e - 1023 + adj;
  DV.setUint32(0, (hi & 0x800fffff) | 0x3ff00000);
  let m = DV.getFloat64(0);
  if (m > SQRT2) { m /= 2; e++; } // center m on [0.707, 1.414]
  // ln(m) = 2 * atanh(s), s = (m - 1) / (m + 1), |s| <= 0.1716
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  const lnm = 2 * s * (1 + s2 * (1 / 3 + s2 * (1 / 5 + s2 * (1 / 7 + s2 * (1 / 9 + s2 * (1 / 11 + s2 * (1 / 13 +
    s2 * (1 / 15 + s2 * (1 / 17 + s2 * (1 / 19 + s2 * (1 / 21 + s2 * (1 / 23 + s2 * (1 / 25 + 0)))))))))))));
  return lnm + e * LN2_HI + e * LN2_LO;
}

/** Deterministic a^b for a > 0 (and the common integer-exponent cases for any a). */
export function fpow(a, b) {
  if (b === 0) return 1;
  if (a === 1) return 1;
  if (Number.isInteger(b) && b <= 64 && b >= -64) {
    // Exponentiation by squaring: an exact sequence of IEEE multiplies.
    let r = 1, base = a, n = b < 0 ? -b : b;
    while (n) { if (n & 1) r *= base; base *= base; n >>= 1; }
    return b < 0 ? 1 / r : r;
  }
  if (a > 0) return fexp(b * flog(a));
  if (a === 0) return b > 0 ? 0 : Infinity;
  return NaN; // negative base with a fractional exponent
}

/** Length of (x, y). Uses sqrt, never Math.hypot. */
export function flen(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** Wrap an angle into (-pi, pi]. */
export function wrapAngle(a) {
  let r = a - TAU_ * Math.floor((a + PI_) / TAU_);
  if (r <= -PI_) r += TAU_;
  return r;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
