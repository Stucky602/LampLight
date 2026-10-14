// One measured run for the pacing report (ARCHITECTURE §10.3): a kite bot plays a real run from a
// fresh profile (the pools and Lamp Post upgrades the game would give it) until it dies, clears the
// map (the last boss down: it leaves rather than stay for overtime), or runs out of time. What a
// run brings home, how long it lasted, and how it ended is all the model needs.
//
// The yields file records the fingerprint of this file and everything it imports (the sim, the
// data, the meta layer, the bot), so a report made from yields measured on other code says so.

import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { buildRunResult } from '../../src/sim/run-result.js';
import { createKiteBot } from '../../src/sim/bot.js';
import { defaultProfile } from '../../src/save/schema.js';
import { runConfigFor } from '../../src/meta/runconfig.js';

/** How runs are measured: who plays, how the bots build, and what ends a run. */
export const MEASURE = Object.freeze({
  character: DATA.characters.find((c) => c.unlock === 'starter').id,
  archetypes: Object.freeze(['projectile_storm', 'orbit_tank', 'burning_ground']),
  bot: 'kite',
  overtime: 'leave',
});

/** The run config measured run `k` plays with: a fresh profile's (its pools and upgrades). */
export function measureConfig(k) {
  return runConfigFor(defaultProfile(), DATA, { character: MEASURE.character, seed: `pacing-${k}` });
}

/**
 * Play a world out with a bot, a tick at a time, until it's over or `minutes` have passed. A halt
 * the bot can't get past (still there after 100 answers) stops it with an error rather than
 * spinning forever (a halted world doesn't tick). `sim` is the sim's own (tests pass stand-ins).
 */
export function playOut(w, bot, minutes, sim = { stepWorld, decide, currentHalt }) {
  while (w.tick < minutes * 3600 && !w.over) {
    sim.stepWorld(w, bot.input(w));
    for (let g = 0; sim.currentHalt(w); g++) {
      if (g >= 100) throw new Error(`playOut: the bot can't get past a ${sim.currentHalt(w).kind} (still there after 100 answers)`);
      sim.decide(w, bot.decide(w, sim.currentHalt(w)));
    }
  }
}

/** How the bot plays measured run `k`: the archetypes in turn, and overtime as MEASURE says. */
export function measureBot(k) {
  return { archetype: MEASURE.archetypes[k % MEASURE.archetypes.length], stay: MEASURE.overtime === 'stay' };
}

/**
 * One run: { k, seconds, materials, bosses, end }. `minutes` is the most it may last. `makeBot`
 * is the bot's maker, given measureBot(k) (tests pass one that records what it was given).
 */
export function measureOne({ k, minutes }, makeBot = createKiteBot) {
  const w = createWorld(measureConfig(k), DATA);
  const bot = makeBot(measureBot(k));
  playOut(w, bot, minutes);
  if (!w.over) decide(w, { kind: 'leave' });
  const r = buildRunResult(w);
  return { k, seconds: r.timeSurvived, materials: r.materials, bosses: r.bossesKilled.length, end: r.end };
}
