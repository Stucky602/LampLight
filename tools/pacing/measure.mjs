// One measured run for the pacing report (ARCHITECTURE §10.3): a kite bot plays a real run on a
// map, with the run config a profile at a harbor stage would give it (its pools, its Lamp Post
// upgrades, the Ferryman, the map's layers: stages.mjs), until it dies, clears the map (the last
// boss down: it leaves rather than stay for overtime), or runs out of time. What a run brings home,
// how long it lasted, and how it ended is all the model needs.
//
// The sweep, X3 (E1): a third player stays. Its bots (they can't die, like the practiced player's)
// stay after the last boss and play overtime to the dawn (STAYS; yields-stays.json), so the report
// gives a player who stays as well as the two who leave.
//
// Each measured set (a map at a stage) records the fingerprint of this file and everything it
// imports (the sim, the data the run plays with, the meta layer, the bot, the stages) and of that
// stage's run config on that map (yields.mjs), so a report made from yields measured on other code
// says which sets are stale.

import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { buildRunResult } from '../../src/sim/run-result.js';
import { createKiteBot } from '../../src/sim/bot.js';
import { runConfigFor } from '../../src/meta/runconfig.js';
import { stageProfile } from './stages.mjs';

/** How runs are measured: who plays, how the bots build, and what ends a run. */
export const MEASURE = Object.freeze({
  character: DATA.characters.find((c) => c.unlock === 'starter').id,
  archetypes: Object.freeze(['projectile_storm', 'orbit_tank', 'burning_ground']),
  bot: 'kite',
  overtime: 'leave',
});

/** The player who stays (X3): the practiced player's bots, staying for overtime; a run may last this long. */
export const STAYS = Object.freeze({ overtime: 'stay', minutes: 45 });

/** The first map: where a fresh profile runs, and the map a measured run is on unless it says. */
export const FIRST_MAP = DATA.maps[0].id;

/** The seed of measured run `k` of a set: its own for each map and stage. */
export const measureSeed = (k, map = FIRST_MAP, stage = 0) => `pacing-${map}-s${stage}-${k}`;

/**
 * The run config measured run `k` of a set plays with: the stage's profile on the map, as the gate
 * would set it out (the starting character, a standard run, no Tide). A `skilled` run's player
 * can't die: the pace of a practiced player, who clears the map (Kevin cleared his first run; the
 * kite bots die in many of theirs). `data` is the content (the fingerprint passes a copy's own).
 */
export function measureConfig(k, skilled = false, map = FIRST_MAP, stage = 0, data = DATA) {
  const cfg = runConfigFor(stageProfile(data, stage), data, { character: MEASURE.character, seed: measureSeed(k, map, stage), map });
  return skilled ? { ...cfg, invulnerable: true } : cfg;
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

/** How the bot plays measured run `k`: the archetypes in turn, and overtime as MEASURE says (STAYS's when `stays`). */
export function measureBot(k, stays = false) {
  return { archetype: MEASURE.archetypes[k % MEASURE.archetypes.length], stay: (stays ? STAYS : MEASURE).overtime === 'stay' };
}

/**
 * One run: { k, seconds, materials, seaGlass, bosses, end, dawn }. `minutes` is the most it may last;
 * `map` and `stage` say what it plays (stages.mjs); `stays` plays overtime (STAYS). `makeBot` is the
 * bot's maker, given measureBot(k, stays) (tests pass one that records what it was given). seaGlass:
 * what was left in hand at the end (the Market buys it as Coin).
 */
export function measureOne({ k, minutes, skilled = false, map = FIRST_MAP, stage = 0, stays = false }, makeBot = createKiteBot) {
  const w = createWorld(measureConfig(k, skilled, map, stage), DATA);
  const bot = makeBot(measureBot(k, stays));
  playOut(w, bot, minutes);
  if (!w.over) decide(w, { kind: 'leave' });
  const r = buildRunResult(w);
  return { k, seconds: r.timeSurvived, materials: r.materials, seaGlass: r.seaGlass ?? 0, bosses: r.bossesKilled.length, end: r.end, ...(stays ? { dawn: r.dawn === true } : {}) };
}
