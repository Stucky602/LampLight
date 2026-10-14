// Replay files and bug reports (ARCHITECTURE §12.4).
//
// A replay (sim/replay.js toReplay()) is the RunConfig, the build id, one InputFrame per tick,
// and the decisions. As a file it's 'LREP1' then deflate(JSON), with the frames as base64:
// a 20-minute run is tens of KB. The last 3 are kept (the store's backend trims them).
//
// A report is one plain JSON text file Kevin can attach: the replay (base64 of the replay
// file), the tuning he changed, his settings, the last 300 events that matter, any errors,
// and what the run looked like at the moment he saved it. tools/replay/replay.mjs plays it.

import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

const MAGIC = 'LREP1';
export const REPORT_KIND = 'lamplight-report';
export const REPORT_VERSION = 1;

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A replay object to file bytes. */
export function encodeReplay(replay) {
  if (!replay || !(replay.frames instanceof Uint8Array)) throw new Error('encodeReplay needs a replay with frames');
  const json = JSON.stringify({ ...replay, frames: toB64(replay.frames) });
  const body = deflateSync(strToU8(json), { level: 9 });
  const out = new Uint8Array(MAGIC.length + body.length);
  out.set(strToU8(MAGIC), 0);
  out.set(body, MAGIC.length);
  return out;
}

/** File bytes back to a replay object. Throws a plain message on anything else. */
export function decodeReplay(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < MAGIC.length + 2) throw new Error('This is not a Lamplight replay file.');
  if (strFromU8(bytes.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('This is not a Lamplight replay file.');
  let obj, frames;
  try {
    obj = JSON.parse(strFromU8(inflateSync(bytes.subarray(MAGIC.length))));
    if (!obj || typeof obj.frames !== 'string' || !Array.isArray(obj.decisions)) throw new Error('shape');
    frames = fromB64(obj.frames);
  } catch { throw new Error('The replay file is damaged.'); }
  return { ...obj, frames };
}

/**
 * The report text.
 * @param {object} o
 * Any field may be a function that returns it (called here, inside its own try).
 * @param {object|Function|null} o.replay the run so far (sim toReplay()), or null outside a run
 * @param {Array} o.events recent events: [{ tick, type, name, x, y, a, b }]
 */
export function buildReport({ build, target, createdAt, replay = null, tuning = [], settings = null, events = [], errors = [], notices = [], state = null, note = '' }) {
  // Each part is gathered on its own: a report is most needed right after something broke, so
  // one part that fails to build (say, the replay of a run left half-stepped) must not cost the
  // rest. What failed is named in `problems`.
  const problems = [];
  const part = (name, get) => {
    try { return typeof get === 'function' ? get() : get; } catch (e) { problems.push(`${name}: ${e?.message || e}`); return null; }
  };
  const out = {
    kind: REPORT_KIND, v: REPORT_VERSION, build, target, createdAt, note,
    state: part('state', state), tuning: part('tuning', tuning), settings: part('settings', settings),
    errors: part('errors', errors), notices: part('notices', notices), events: part('events', events),
    replay: part('replay', () => { const r = typeof replay === 'function' ? replay() : replay; return r ? toB64(encodeReplay(r)) : null; }),
    problems,
  };
  return JSON.stringify(out, null, 1);
}

/** Read a report back (tools and tests). The replay inside comes back decoded. */
export function readReport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('This is not a Lamplight report (it is not JSON).'); }
  if (!obj || obj.kind !== REPORT_KIND) throw new Error('This is not a Lamplight report.');
  if (obj.v !== REPORT_VERSION) throw new Error(`This report is version ${obj.v}; this build reads version ${REPORT_VERSION}.`);
  let replay = null;
  if (obj.replay) {
    let bytes;
    try { bytes = fromB64(obj.replay); } catch { throw new Error('The replay in this report is damaged.'); }
    replay = decodeReplay(bytes);
  }
  return { ...obj, replay };
}
