// The on-disk envelope around every save file.
//
// {"format":"lamplight-save","kind":"profile","savedAt":"...","build":"...","crc":"xxxxxxxx","data":"<json text>"}
//
// `data` is the document as a JSON string and `crc` is the CRC-32 of exactly that string, so a
// torn or hand-damaged file is detected without any canonical-JSON tricks. The desktop main
// process never interprets saves; it only moves bytes (atomically). All checking happens here.

import { crc32Hex } from '../lib/hash.js';
import { SAVE_FORMAT } from './schema.js';

export class SaveCorruptError extends Error {
  constructor(msg) { super(msg); this.name = 'SaveCorruptError'; }
}

export function wrap(kind, doc, { build = 'dev', savedAt = new Date().toISOString() } = {}) {
  const data = JSON.stringify(doc);
  return JSON.stringify({ format: SAVE_FORMAT, kind, savedAt, build, crc: crc32Hex(data), data });
}

/** Parse and verify an envelope. Returns { doc, meta }. Throws SaveCorruptError. */
export function unwrap(text, expectedKind) {
  let env;
  try { env = JSON.parse(text); } catch { throw new SaveCorruptError('The save file is not valid JSON.'); }
  if (!env || env.format !== SAVE_FORMAT) throw new SaveCorruptError('Not a Lamplight save file.');
  if (expectedKind && env.kind !== expectedKind) throw new SaveCorruptError(`Expected a ${expectedKind} save, found ${env.kind}.`);
  if (typeof env.data !== 'string' || typeof env.crc !== 'string') throw new SaveCorruptError('The save file is missing its data.');
  if (crc32Hex(env.data) !== env.crc) throw new SaveCorruptError('The save file is damaged (checksum mismatch).');
  let doc;
  try { doc = JSON.parse(env.data); } catch { throw new SaveCorruptError('The save data is not valid JSON.'); }
  return { doc, meta: { kind: env.kind, savedAt: env.savedAt, build: env.build } };
}
