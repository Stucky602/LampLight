// Small, dependency-free hashes. Pure and deterministic on every JavaScript engine:
// only integer ops (Math.imul, shifts, xor) are used.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of a Uint8Array. Returns an unsigned 32-bit integer. */
export function crc32Bytes(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 of a string, hashed as UTF-8. Same result as desktop/savefs.cjs crc32(). */
export function crc32(str) {
  return crc32Bytes(utf8(str));
}

/** CRC-32 as 8 lowercase hex characters. */
export function crc32Hex(str) {
  return crc32(str).toString(16).padStart(8, '0');
}

/** FNV-1a 32-bit hash of a string (UTF-16 code units). Used for seeds and labels. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Streaming 32-bit hash for simulation state (determinism checks).
 * Feed integers or typed arrays; floats are hashed by their exact bit patterns.
 */
export function createStateHash() {
  let h = 0x811c9dc5 | 0;
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  const f64 = new Float64Array(1);
  const u64 = new Uint32Array(f64.buffer);
  const mix = (v) => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
  };
  return {
    int(v) { mix(v); return this; },
    float32(v) { f32[0] = v; mix(u32[0]); return this; },
    float64(v) { f64[0] = v; mix(u64[0]); mix(u64[1]); return this; },
    /**
     * Hash the first `count` elements of an array by their exact values: float typed arrays by
     * their raw bits, integer typed arrays by value, and plain arrays of numbers as float64 bits
     * (so 1.5 and 1 never collide). Anything else throws.
     */
    array(arr, count = arr.length) {
      const n = Math.min(count, arr.length);
      mix(n);
      if (arr instanceof Float32Array) {
        for (let i = 0; i < n; i++) { f32[0] = arr[i]; mix(u32[0]); }
      } else if (arr instanceof Float64Array) {
        for (let i = 0; i < n; i++) { f64[0] = arr[i]; mix(u64[0]); mix(u64[1]); }
      } else if (ArrayBuffer.isView(arr) && !(arr instanceof DataView)) {
        if (arr instanceof BigInt64Array || arr instanceof BigUint64Array) throw new Error('createStateHash().array: BigInt arrays are not supported');
        for (let i = 0; i < n; i++) mix(arr[i]);
      } else if (Array.isArray(arr)) {
        for (let i = 0; i < n; i++) {
          const v = arr[i];
          if (typeof v !== 'number') throw new Error(`createStateHash().array: element ${i} is not a number`);
          f64[0] = v; mix(u64[0]); mix(u64[1]);
        }
      } else {
        throw new Error('createStateHash().array needs a typed array or an array of numbers');
      }
      return this;
    },
    value() { return h >>> 0; },
    hex() { return (h >>> 0).toString(16).padStart(8, '0'); },
  };
}

/**
 * UTF-8 encode without relying on TextEncoder (works in every runtime). A lone surrogate becomes
 * U+FFFD, exactly as TextEncoder and Node's Buffer do, so hashes agree with desktop/savefs.cjs.
 */
export function utf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const d = c <= 0xdbff && i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else {
        c = 0xfffd; // lone surrogate
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
