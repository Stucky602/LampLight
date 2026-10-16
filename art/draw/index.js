// Every code-drawn sprite, by the name art/manifest.js uses for it. A generator returns a mask
// (colored with the entry's ramp), a list of masks (animation frames), { layers } (several
// masks, each in its own ramp), or full-color frames (effects).

import * as sprites from './sprites.js';
import * as bosses from './bosses.js';
import * as effects from './effects.js';
import { planks, water, bridge, deck, roof, shedWall, hull } from './tiles.js';
import * as hub from './hub.js';

export const DRAW = Object.freeze({
  gull: () => sprites.gull(),
  crab: () => sprites.crab(),
  hurricaneLamp: () => sprites.hurricaneLamp(),
  bell: () => sprites.bell(),
  stormBell: () => sprites.stormBell(),
  anchor: () => sprites.anchor(),
  wave: () => sprites.wave(),
  magnet: () => sprites.magnet(),
  orb: () => sprites.orb(),
  crystal: () => sprites.crystal(),
  burstGem: () => sprites.burstGem(),
  lampPost: () => sprites.lampPost(),
  signalMirror: () => sprites.signalMirror(),
  oilFlask: () => sprites.oilFlask(),
  lightningRod: () => sprites.lightningRod(),
  corpseCandles: () => sprites.corpseCandles(),
  wreckLantern: () => sprites.wreckLantern(),
  ember: () => sprites.ember(),
  rune: (entry) => sprites.rune(entry.id),
  mawBody: () => bosses.mawBody(),
  mawJaw: () => bosses.mawJaw(),
  mawMouth: () => bosses.mawMouth(),
  mawStalk: () => bosses.mawStalk(),
  mawBulb: () => bosses.mawBulb(),
  mawFin: () => bosses.mawFin(),
  tidecallerRobe: () => bosses.tidecallerRobe(),
  tidecallerStaff: () => bosses.tidecallerStaff(),
  tidecallerBell: () => bosses.tidecallerBell(),
  tidecallerTentacle: () => bosses.tidecallerTentacle(),
  tidecallerHand: () => bosses.tidecallerHand(),
  planks: (entry) => planks(entry.variant ?? 0),
  water: (entry) => water(entry.variant ?? 0, entry.edges ?? ''),
  bridge: (entry) => bridge(entry.variant ?? 0),
  deck: (entry) => deck(entry.variant ?? 0),
  roof: (entry) => roof(entry.variant ?? 0),
  shedWall: (entry) => shedWall(entry.variant ?? 0),
  hull: (entry) => hull(entry.variant ?? 0),
  // The harbor's code-drawn pieces, each its own frame.
  hub: () => [
    hub.water(0), hub.water(1), hub.water(2),
    hub.pier('l', false), hub.pier('l', true), hub.pier('r', false), hub.pier('r', true),
    hub.quay(0), hub.quay(1), hub.seaWall(0), hub.seaWall(1), hub.setts(0), hub.setts(1), hub.rock(0), hub.rock(1), hub.rock(2), hub.rock(3),
    hub.boat(), hub.scaffold(5, 4), hub.townLamp(true), hub.townLamp(false),
  ],
  shots: () => effects.shots(),
  gems: () => effects.gems(),
  particles: () => effects.particles(),
  font: () => effects.font(),
});

/** What a character holds, drawn onto her padded sprite. */
export const HOLD = Object.freeze({
  lantern: sprites.lanternInHand,
  harpoon: sprites.harpoonInHand,
});
