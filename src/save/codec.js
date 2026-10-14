// Export and import codes: move a profile between machines (or keep a backup) as text.
//
// Format: LAMP1.<base64url(deflate(profile JSON))>.<crc32 hex of the JSON>
// Settings are never included. Pasted codes may carry spaces or line breaks; those are ignored.

import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { crc32Hex } from '../lib/hash.js';

export const CODE_PREFIX = 'LAMP1';

export class CodeError extends Error {
  constructor(msg) { super(msg); this.name = 'CodeError'; }
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REV = (() => { const r = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) r[ALPHA.charCodeAt(i)] = i; return r; })();

export function b64urlEncode(bytes) {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    s += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63];
  }
  return s;
}

export function b64urlDecode(str) {
  const len = str.length;
  if (len % 4 === 1) throw new CodeError('The code is cut off or has extra characters.');
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < len; i++) {
    const c = str.charCodeAt(i);
    const v = c < 128 ? REV[c] : -1;
    if (v < 0) throw new CodeError(`The code contains a character that doesn't belong ("${str[i]}").`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

/** Profile doc -> export code. */
export function encodeExportCode(doc) {
  const json = JSON.stringify(doc);
  const packed = deflateSync(strToU8(json), { level: 9 });
  return `${CODE_PREFIX}.${b64urlEncode(packed)}.${crc32Hex(json)}`;
}

/** Export code -> profile doc (not yet migrated). Throws CodeError with a plain-language message. */
export function decodeExportCode(code) {
  if (typeof code !== 'string') throw new CodeError('That is not a save code.');
  // Spaces and line breaks are ignored, and so are quotes or a sentence's closing punctuation
  // pasted along with the code (the code itself never ends in them).
  const clean = code.replace(/\s+/g, '').replace(/^[`'"\u2018\u2019\u201c\u201d(]+/, '').replace(/[`'"\u2018\u2019\u201c\u201d.,;:!?)]+$/, '');
  const parts = clean.split('.');
  if (parts[0] !== CODE_PREFIX) {
    if (/^LAMP\d+$/.test(parts[0])) throw new CodeError('This code is from a newer version of Lamplight.');
    throw new CodeError('That is not a Lamplight save code (it should start with LAMP1).');
  }
  if (parts.length > 3 || (parts.length === 3 && /^[0-9a-fA-F]{8}./.test(parts[2]))) {
    throw new CodeError('The code has extra characters at the end. Copy only the code and try again.');
  }
  if (parts.length !== 3 || !parts[1] || !/^[0-9a-fA-F]{8}$/.test(parts[2])) throw new CodeError('The code is incomplete. Copy the whole thing and try again.');
  parts[2] = parts[2].toLowerCase();
  const bytes = b64urlDecode(parts[1]);
  let json;
  try { json = strFromU8(inflateSync(bytes)); } catch { throw new CodeError('The code is damaged and cannot be unpacked.'); }
  if (crc32Hex(json) !== parts[2]) throw new CodeError('The code is damaged (checksum mismatch). Copy it again.');
  let doc;
  try { doc = JSON.parse(json); } catch { throw new CodeError('The code is damaged (bad data).'); }
  if (!doc || typeof doc !== 'object' || typeof doc.v !== 'number' || !doc.profile) throw new CodeError('The code does not contain a Lamplight profile.');
  return doc;
}

/** Short facts about a profile, shown before an import overwrites anything. */
export function summarize(doc) {
  const p = doc.profile || {};
  const buildings = Object.values(p.buildings || {}).filter((l) => l > 0).length;
  const levels = Object.values(p.buildings || {}).reduce((a, l) => a + (Number(l) || 0), 0);
  const characters = Object.values(p.characters || {}).filter((c) => c && c.unlocked).length;
  const hours = Math.floor(((doc.stats?.playtimeSec) || 0) / 360) / 10;
  return { runs: doc.stats?.runs || 0, hours, buildings, buildingLevels: levels, characters, cycle: p.prestige?.cycle || 0 };
}
