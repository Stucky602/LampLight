// Resume a run (0.9.0, W7; V5: "A crash, a power cut or a closed tab at 19:00 loses the whole run
// and its materials"). Runs are deterministic and recorded as replays, so the run scene saves the
// replay so far every minute (a checkpoint, save/store.js saveCheckpoint), and the title offers
// "Resume run" when one is left over: the same run, played back from 0:00 to where it was, quickly
// and without a screen or a sound, then handed back to the player.
//
// The checkpoint is written as the run sets out (what it used up is already saved, so a crash in
// the first minute can still resume) and then every minute. Each one adds only the frames since
// the last (createCheckpointer: the sweep, S4 C1; packing the whole replay again every minute
// stopped the game for 80 to 250 ms late in a run).
//
// A checkpoint is good only for the build that made it (a replay plays back only there) and for
// the profile as it was when the run set out (the same count of runs: one folded in since, or a
// save imported, makes it stale). It's cleared when the run's end is saved, and when the player
// starts something else instead.

import { createRecordedRun } from '../sim/replay.js';
import { readFrame, frameCount } from '../lib/inputframe.js';
import { encodeReplay, decodeReplay } from '../save/replay.js';
import { deflateSync, inflateSync } from 'fflate';
import { FRAME_BYTES } from '../lib/inputframe.js';
import { clockText } from '../lib/text.js';

/** Ticks between checkpoints (a minute of the run). */
export const CHECKPOINT_TICKS = 3600;

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

/** The gate's choices a checkpoint keeps, so Run again after a resume sets out the same way. */
const CHOICE_KEYS = ['character', 'map', 'mode', 'kit', 'tide', 'curses', 'heirloom', 'challenge'];   // (heirloom: the sweep's ruling 11; it was 'arcana')
/** The most a checkpoint's frames may unpack to (about 15 hours of run), and the most chunks. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_CHUNKS = 4096;

/** A gate choice as a checkpoint keeps it: the keys above, plain values only; null for none. */
export function keptChoice(choice) {
  if (!choice || typeof choice !== 'object') return null;
  const out = {};
  for (const k of CHOICE_KEYS) {
    const v = choice[k];
    if (k === 'curses') { if (Array.isArray(v)) out.curses = v.filter((c) => typeof c === 'string').slice(0, 32); }
    else if (k === 'tide') { if (Number.isInteger(v) && v >= 0) out.tide = v; }
    else if (typeof v === 'string' && v.length <= 80) out[k] = v;
  }
  return out;
}

/**
 * What Run again asks for after a resumed run (the sweep, S4 B3): the gate's choice the run set
 * out with (its Tide, curses, mode, kit, Heirloom, set run, map), a new seed, and no run tools
 * or rune stone (used up). A checkpoint without the choice gives the replay's character and map.
 */
export function runAgainChoice(resume) {
  const cfg = resume?.replay?.config || {};
  const c = keptChoice(resume?.choice) || {};
  return { ...c, character: c.character ?? cfg.character, map: c.map ?? cfg.map, seed: undefined, consumables: [], rune: '' };
}

/** The checkpoint to save for a run now, whole: its replay so far, and what it needs to be resumed. */
export function makeCheckpoint(replay, { runs, map, character, tick, choice = null }) {
  return { v: 1, build: replay.build, replay: toB64(encodeReplay(replay)), runs, map, character, tick, ...(keptChoice(choice) ? { choice: keptChoice(choice) } : {}) };
}

/**
 * Checkpoints for a run, each adding only what's new: make(rec, meta) packs the frames recorded
 * since the last call into one more chunk and returns the whole checkpoint (the chunks so far,
 * the config, the decisions). A different recorded run starts over.
 */
export function createCheckpointer() {
  let forRec = null, chunks = [], bytes = 0;
  return {
    make(rec, { runs, map, character, tick, choice = null }) {
      if (rec !== forRec) { forRec = rec; chunks = []; bytes = 0; }
      const p = rec.sinceByte(bytes);
      if (p.frames.length) { chunks.push(toB64(deflateSync(p.frames, { level: 6 }))); bytes += p.frames.length; }
      const kept = keptChoice(choice);
      return {
        v: 2, build: p.build, replay: { v: p.v, config: p.config, decisions: p.decisions, endTick: p.endTick, chunks: chunks.slice(), frameBytes: bytes },
        runs, map, character, tick, ...(kept ? { choice: kept } : {}),
      };
    },
  };
}

/** A chunked checkpoint's replay put back together. Throws on anything that doesn't fit. */
function joinChunks(r, build) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.chunks) || !Array.isArray(r.decisions) || !r.config || typeof r.config !== 'object') throw new Error('shape');
  if (r.chunks.length > MAX_CHUNKS || !Number.isInteger(r.frameBytes) || r.frameBytes < 0 || r.frameBytes > MAX_FRAME_BYTES || r.frameBytes % FRAME_BYTES) throw new Error('size');
  const frames = new Uint8Array(r.frameBytes);
  let o = 0;
  for (const c of r.chunks) {
    if (typeof c !== 'string') throw new Error('shape');
    // Unpacked into what's left plus one: a chunk that would unpack past the count stops there.
    const part = inflateSync(fromB64(c), { out: new Uint8Array(r.frameBytes - o + 1) });
    if (o + part.length > r.frameBytes) throw new Error('size');
    frames.set(part, o);
    o += part.length;
  }
  if (o !== r.frameBytes) throw new Error('size');
  return { v: r.v, build, config: r.config, frames, decisions: r.decisions, endTick: r.endTick };
}

/**
 * The checkpoint, read and checked: { replay, map, character, tick } when it can resume on this
 * build and profile, else null (`why` says which, for the log).
 */
/** Why a saved run can't be resumed, in the player's words (round 3, L1 8). */
const RESUME_WHY = Object.freeze({
  'another build': 'The saved run is from another version of the game, so it can\'t be resumed.',
  'the profile moved on': 'The saved run is from before your last finished run, so it can\'t be resumed.',
  damaged: 'The saved run\'s file is damaged, so it can\'t be resumed.',
});

export function readCheckpoint(cp, { buildId, runs }) {
  const whole = cp && typeof cp === 'object' && cp.v === 1 && typeof cp.replay === 'string';
  const chunked = cp && typeof cp === 'object' && cp.v === 2 && cp.replay && typeof cp.replay === 'object';
  if (!whole && !chunked) return { ok: null, why: 'none' };
  if (cp.build !== buildId) return { ok: null, why: 'another build' };
  if (Number(cp.runs) !== Number(runs)) return { ok: null, why: 'the profile moved on' };
  let replay;
  try { replay = whole ? decodeReplay(fromB64(cp.replay)) : joinChunks(cp.replay, cp.build); } catch { return { ok: null, why: 'damaged' }; }
  if (replay.build !== buildId) return { ok: null, why: 'another build' };
  const tick = Number.isInteger(replay.endTick) ? replay.endTick : cp.tick;
  return { ok: { replay, map: cp.map, character: cp.character, tick, choice: keptChoice(cp.choice) }, why: null };
}

/** The title's line under Resume run: "A run on the Drowned Docks stopped at 12:00." */
export function resumeNote(data, cp) {
  const map = data.maps.find((m) => m.id === cp.map)?.name;
  const who = data.characters.find((c) => c.id === cp.character)?.name;
  return `${who ? `The ${who}'s run` : 'A run'}${map ? ` on the ${map}` : ''} stopped at ${clockText(Math.floor((cp.tick ?? 0) / 60))}. Resume run plays on from there.`;
}

/**
 * A recorded run caught up from a replay, in steps: { rec, step(maxTicks) -> done, progress (0..1) }.
 * The replay's frames and decisions go back through a fresh recorded run (so it records them again
 * and goes on recording), each decision at its tick, as sim/replay.js playReplay does. Throws on a
 * replay that doesn't fit (it would drift without saying so).
 */
export function catchUp(replay, data, buildId) {
  const rec = createRecordedRun(replay.config, data, buildId);
  const world = rec.world;
  const n = frameCount(replay.frames);
  const ds = replay.decisions || [];
  let t = 0, di = 0;
  const applyDecisions = () => {
    while (di < ds.length && ds[di].tick === world.tick) {
      const { tick, halt, ...d } = ds[di];
      const current = world.halts[0] ? world.halts[0].kind : null;
      if (halt !== current) throw new Error(`The saved run is out of step at ${tick}: it has a "${halt}" answer where the run waits on "${current}".`);
      rec.decide(d);
      di++;
    }
  };
  applyDecisions();
  return {
    rec,
    get progress() { return n ? t / n : 1; },
    get total() { return n; },
    /** Play up to `maxTicks` more; true once every frame is played. */
    step(maxTicks = 600) {
      for (let k = 0; k < maxTicks && t < n && !world.over; k++) {
        if (world.halts.length) throw new Error(`The saved run is out of step at ${world.tick}: it waits on a "${world.halts[0].kind}" answer the save doesn't have.`);
        rec.step(readFrame(replay.frames, t++));
        world.events.clear();
        applyDecisions();
      }
      return t >= n || world.over;
    },
  };
}

/**
 * The title's Resume run, kept in one place (the sweep, S4 B4 and B6): the run left in the middle,
 * if this build and profile can resume it.
 *   load()  reads the store's checkpoint. A tab that doesn't own the save (the read-only second
 *           tab) never reads it: the slot is the first tab's live run.
 *   take()  the run to resume, once (Resume run was pressed).
 *   drop()  the left-over run is gone, and its slot cleared: something else was started, or
 *           another profile was imported (its run isn't this profile's).
 *   clear() the run's end was saved: nothing to offer (the caller clears the slot).
 */
export function createResumeOffer({ store, buildId, runs, owner = true, note = () => {} }) {
  let current = null;
  return {
    get current() { return current; },
    async load() {
      current = null;
      if (!owner) return null;
      try {
        const cp = readCheckpoint(await store.loadCheckpoint?.(), { buildId, runs: runs() });
        current = cp.ok;
        if (!cp.ok && cp.why !== 'none') note(RESUME_WHY[cp.why] ?? 'The saved run can\'t be resumed.');
      } catch { current = null; }
      return current;
    },
    take() { const r = current; current = null; return r; },
    drop() {
      const had = current;
      current = null;
      // The slot is cleared even when nothing was on offer: an import must not leave the old profile's run behind.
      try { store.clearCheckpoint?.()?.catch?.(() => {}); } catch { /* a store that can't clear: nothing to offer either way */ }
      return !!had;
    },
    clear() { current = null; },
  };
}
