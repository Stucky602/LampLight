// PNG read and write with nothing but node:zlib, so the deploy gate can read the committed atlas
// (tests/art.test.js) without installing anything, and the atlas builder writes the same bytes
// for the same pixels every time.
//
// Reads 8-bit grey, grey + alpha, RGB, RGBA, and palette images (palette at 1, 2, 4, or 8 bits,
// with tRNS transparency), which covers the Kenney packs and our own output. Interlaced images
// are refused with a plain message. Writes 8-bit RGBA only.

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode straight-alpha RGBA pixels. Every row uses the filter that makes it smallest, the usual
 * PNG heuristic; the output is deterministic.
 * @param {{ width: number, height: number, rgba: Uint8Array|Uint8ClampedArray }} img
 */
export function encodePng({ width, height, rgba }) {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error(`encodePng: bad size ${width}x${height}`);
  if (rgba.length !== width * height * 4) throw new Error(`encodePng: ${rgba.length} bytes for ${width}x${height} (expected ${width * height * 4})`);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0, b = up ? up[i] : 0, c = up && i >= 4 ? up[i - 4] : 0;
        let v;
        switch (f) {
          case 0: v = row[i]; break;
          case 1: v = row[i] - a; break;
          case 2: v = row[i] - b; break;
          case 3: v = row[i] - ((a + b) >> 1); break;
          default: v = row[i] - paeth(a, b, c); break;
        }
        v &= 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a PNG into straight-alpha RGBA.
 * @param {Uint8Array} buf the file's bytes
 * @returns {{ width: number, height: number, rgba: Uint8ClampedArray }}
 */
export function decodePng(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 8 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePng: not a PNG file');
  let pos = 8, width = 0, height = 0, depth = 0, type = -1, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos), kind = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (pos + 12 + len > b.length) throw new Error(`decodePng: the ${kind} chunk runs past the end of the file`);
    if (crc32(b.subarray(pos + 4, pos + 8 + len)) !== b.readUInt32BE(pos + 8 + len)) throw new Error(`decodePng: the ${kind} chunk is damaged (checksum)`);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (!(width > 0 && height > 0)) throw new Error('decodePng: no image header');
  if (interlace) throw new Error('decodePng: interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`decodePng: color type ${type} is not supported`);
  if (depth !== 8 && !((type === 0 || type === 3) && [1, 2, 4].includes(depth))) throw new Error(`decodePng: ${depth}-bit color type ${type} is not supported`);
  if (type === 3 && !palette) throw new Error('decodePng: palette image without a palette');
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('decodePng: image data is shorter than the header says');
  const lines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = lines.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0, u = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = src[i]; break;
        case 1: v = src[i] + a; break;
        case 2: v = src[i] + u; break;
        case 3: v = src[i] + ((a + u) >> 1); break;
        case 4: v = src[i] + paeth(a, u, c); break;
        default: throw new Error(`decodePng: unknown row filter ${f}`);
      }
      out[i] = v & 0xff;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 6) { const i = x * 4; rgba[o] = row[i]; rgba[o + 1] = row[i + 1]; rgba[o + 2] = row[i + 2]; rgba[o + 3] = row[i + 3]; }
      else if (type === 2) {
        const i = x * 3; rgba[o] = row[i]; rgba[o + 1] = row[i + 1]; rgba[o + 2] = row[i + 2]; rgba[o + 3] = 255;
        if (trns && trns.length >= 6 && row[i] === trns.readUInt16BE(0) && row[i + 1] === trns.readUInt16BE(2) && row[i + 2] === trns.readUInt16BE(4)) rgba[o + 3] = 0;
      } else if (type === 4) { const i = x * 2; rgba[o] = rgba[o + 1] = rgba[o + 2] = row[i]; rgba[o + 3] = row[i + 1]; }
      else {
        // Grey or palette, possibly packed several pixels to a byte.
        let v;
        if (depth === 8) v = row[x];
        else { const per = 8 / depth, byte = row[Math.floor(x / per)], shift = 8 - depth * ((x % per) + 1); v = (byte >> shift) & ((1 << depth) - 1); }
        if (type === 3) {
          if (v * 3 + 2 >= palette.length) throw new Error(`decodePng: palette index ${v} is outside the palette`);
          rgba[o] = palette[v * 3]; rgba[o + 1] = palette[v * 3 + 1]; rgba[o + 2] = palette[v * 3 + 2];
          rgba[o + 3] = trns && v < trns.length ? trns[v] : 255;
        } else {
          const g = depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1));
          rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
          rgba[o + 3] = trns && trns.length >= 2 && v === trns.readUInt16BE(0) ? 0 : 255;
        }
      }
    }
  }
  return { width, height, rgba };
}
