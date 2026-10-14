// Replays (ARCHITECTURE §12.4): a run is its RunConfig (seed included), the build it ran on,
// one InputFrame per tick, and the decisions made while it was halted. Feeding those back into
// a fresh world reproduces the run exactly, which is how Claude sees a bug Kevin hit.
//
// This file is the sim side: recording and playing back in memory. Turning a replay into a
// small file (and back) is save/replay.js's job (compression lives outside the sim).

import { createWorld, stepWorld, decide, hashWorld } from './world.js';
import { createFrameRecorder, readFrame, frameCount } from '../lib/inputframe.js';

export const REPLAY_VERSION = 1;

/**
 * Wrap a world so every consumed frame and every decision is recorded.
 * Use step() and decide() from the returned object instead of the world functions.
 */
export function createRecordedRun(config, data, buildId) {
  const world = createWorld(config, data);
  // The config the run started with: a replay starts from this, whatever changes later.
  const startConfig = structuredClone(world.config);
  const frames = createFrameRecorder(3600);
  return {
    world,
    step(frame) {
      // Recorded before stepping, so a step that throws still leaves its frame in the replay:
      // playing the replay back then reproduces the error at the same tick.
      if (world.over || world.halts.length > 0) return false;
      frames.push(frame === null || typeof frame !== 'object' ? { mx: 0, my: 0, buttons: 0 } : frame);
      return stepWorld(world, frame);
    },
    decide(d) { return decide(world, d); },
    /** The replay as plain data (frames as bytes). */
    toReplay() {
      return {
        v: REPLAY_VERSION,
        build: buildId,
        config: structuredClone(startConfig),
        frames: frames.toBytes(),
        decisions: world.decisions.map((e) => ({ ...e })),
        endTick: world.tick,
        hash: hashWorld(world),
      };
    },
  };
}

export class ReplayError extends Error {
  constructor(msg) { super(msg); this.name = 'ReplayError'; }
}

/**
 * Play a replay back. Refuses a replay from another build (it would drift without saying so).
 * Returns the world at the end (or at untilTick). Throws ReplayError if the recorded decisions
 * don't fit what the sim asks for (a sign the replay and the code disagree).
 */
export function playReplay(replay, data, { buildId, untilTick = Infinity, onTick = null } = {}) {
  if (!replay || replay.v !== REPLAY_VERSION) throw new ReplayError('This is not a replay this version of Lamplight can read.');
  if (typeof buildId !== 'string') throw new ReplayError('playReplay needs the build id of the code playing it back.');
  if (replay.build !== buildId) {
    throw new ReplayError(`This replay is from build ${replay.build}, and this is build ${buildId}. Replays only play back on the build that made them.`);
  }
  const world = createWorld(replay.config, data);
  const n = frameCount(replay.frames);
  const ds = replay.decisions;
  let di = 0;
  const applyDecisions = () => {
    while (di < ds.length && ds[di].tick === world.tick) {
      const { tick, halt, ...d } = ds[di];
      const current = world.halts[0] ? world.halts[0].kind : null;
      if (halt !== current) throw new ReplayError(`Replay out of step at tick ${tick}: it recorded a "${halt}" decision, but the run is waiting on "${current}".`);
      decide(world, d);
      di++;
    }
  };
  applyDecisions();
  for (let t = 0; t < n && world.tick < untilTick && !world.over; t++) {
    if (world.halts.length) throw new ReplayError(`Replay out of step at tick ${world.tick}: the run is waiting on a "${world.halts[0].kind}" decision the replay doesn't have.`);
    stepWorld(world, readFrame(replay.frames, t));
    if (onTick) onTick(world);
    applyDecisions();
  }
  // Played to its end, every recorded decision must have been used.
  if (world.tick < untilTick && di < ds.length) {
    throw new ReplayError(`Replay out of step: ${ds.length - di} recorded decisions were never asked for (the first at tick ${ds[di].tick}).`);
  }
  return world;
}
