// Every code-drawn sprite, by the name art/manifest.js uses for it. A generator returns a mask
// (colored with the entry's ramp), a list of masks (animation frames), { layers } (several
// masks, each in its own ramp), or full-color frames (effects).

import * as sprites from './sprites.js';
import * as bosses from './bosses.js';
import * as effects from './effects.js';
import { planks, water, bridge, deck, roof, shedWall, hull } from './tiles.js';
import * as hub from './hub.js';
import * as harbor from './harbor.js';
import * as marsh from './marsh.js';
import * as life from './marshlife.js';
import * as mboss from './marshbosses.js';
import * as micons from './marshicons.js';
import * as trades from './trades.js';
import * as affixes from './affixes.js';
import * as dashes from './dashicons.js';

export const DRAW = Object.freeze({
  // The five elite affixes' icons (C3).
  affixWarded: () => affixes.affixWarded(), affixHerald: () => affixes.affixHerald(), affixMolten: () => affixes.affixMolten(),
  affixTethered: () => affixes.affixTethered(), affixBrine: () => affixes.affixBrine(),
  // The Dash slot's items' icons (C3, art/draw/dashicons.js).
  dashWick: () => dashes.dashWick(), dashHeavy: () => dashes.dashHeavy(), dashLong: () => dashes.dashLong(), dashMire: () => dashes.dashMire(),
  dashSink: () => dashes.dashSink(), dashSwell: () => dashes.dashSwell(), dashOar: () => dashes.dashOar(), dashLight: () => dashes.dashLight(),
  gull: () => sprites.gull(),
  crab: () => sprites.crab(),
  hurricaneLamp: () => sprites.hurricaneLamp(),
  // The Salt Marsh's enemies (art/draw/marshlife.js).
  midgeCloud: () => life.midgeCloud(),
  saltedDead: (entry, at) => life.saltedDead(entry, at),
  wellWarden: (entry, at) => life.wellWarden(entry, at),
  mireToad: () => life.mireToad(),
  pillar: () => life.pillar(),
  herbBed: () => life.herbs(),
  saltWell: () => life.well(),
  bogBody: () => life.bogBody(),
  leech: () => life.leech(),
  stormLantern: () => sprites.stormLantern(),
  saltRing: () => sprites.saltRing(),
  bell: () => sprites.bell(),
  stormBell: () => sprites.stormBell(),
  anchor: () => sprites.anchor(),
  wave: () => sprites.wave(),
  magnet: () => sprites.magnet(),
  orb: () => sprites.orb(),
  crystal: () => sprites.crystal(),
  pearl: () => sprites.pearl(),
  burstGem: () => sprites.burstGem(),
  lampPost: () => sprites.lampPost(),
  signalMirror: () => sprites.signalMirror(),
  oilFlask: () => sprites.oilFlask(),
  lightningRod: () => sprites.lightningRod(),
  corpseCandles: () => sprites.corpseCandles(),
  wreckLantern: () => sprites.wreckLantern(),
  ember: () => sprites.ember(),
  skiff: () => sprites.skiff(),
  reliquary: () => sprites.reliquary(),
  rune: (entry) => sprites.rune(entry.id, micons.MARSH_SIGILS),
  // The Salt Marsh's icons (art/draw/marshicons.js).
  brineSpring: () => micons.brineSpring(), icePicks: () => micons.icePicks(), fulgurite: () => micons.fulgurite(), fogHorn: () => micons.fogHorn(),
  eelPot: () => micons.eelPot(), anchorChain: () => micons.anchorChain(), glassCaltrops: () => micons.glassCaltrops(),
  saltPan: () => micons.saltPan(), stormGlass: () => micons.stormGlass(), congerPot: () => micons.congerPot(), seaAnchor: () => micons.seaAnchor(),
  hoarfrost: () => micons.hoarfrost(), copperWire: () => micons.copperWire(), graveMoss: () => micons.graveMoss(),
  bitternsCall: () => micons.bitternsCall(), waders: () => micons.waders(),
  seaUrchin: () => micons.seaUrchin(), quenchBucket: () => micons.quenchBucket(), coldIron: () => micons.coldIron(),
  watchmansRattle: () => micons.watchmansRattle(), tryPot: () => micons.tryPot(), brineVat: () => micons.brineVat(), bogTorc: () => micons.bogTorc(),
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
  greyBody: () => mboss.greyBody(),
  greyNeck: () => mboss.greyNeck(),
  greyHead: () => mboss.greyHead(),
  greyLeg: () => mboss.greyLeg(),
  greyWing: () => mboss.greyWing(),
  widowCloak: () => mboss.widowCloak(),
  widowCrown: () => mboss.widowCrown(),
  widowArm: () => mboss.widowArm(),
  planks: (entry) => planks(entry.variant ?? 0),
  water: (entry) => water(entry.variant ?? 0, entry.edges ?? ''),
  bridge: (entry) => bridge(entry.variant ?? 0),
  deck: (entry) => deck(entry.variant ?? 0),
  roof: (entry) => roof(entry.variant ?? 0),
  shedWall: (entry) => shedWall(entry.variant ?? 0),
  hull: (entry) => hull(entry.variant ?? 0),
  // The Salt Marsh's ground (0.8.0, art/draw/marsh.js).
  mSalt: (entry) => marsh.salt(entry.variant ?? 0),
  mMud: (entry) => marsh.mud(entry.variant ?? 0, entry.dir ?? 'h'),
  mReeds: (entry) => marsh.reeds(entry.variant ?? 0),
  mPeat: (entry) => marsh.peat(entry.variant ?? 0),
  mStump: (entry) => marsh.stump(entry.variant ?? 0),
  mCauseway: (entry) => marsh.causeway(entry.variant ?? 0),
  mBoardwalk: (entry) => marsh.boardwalk(entry.dir ?? 'h'),
  mLanding: (entry) => marsh.landing(entry.end ?? ''),
  mWater: (entry) => marsh.water(entry.variant ?? 0, entry.banks ?? 0, entry.deep === true),
  // The harbor's code-drawn pieces, each its own frame.
  hub: () => [
    hub.water(0), hub.water(1), hub.water(2),
    hub.pier('l', false), hub.pier('l', true), hub.pier('r', false), hub.pier('r', true),
    hub.quay(0), hub.quay(1), hub.seaWall(0), hub.seaWall(1), hub.setts(0), hub.setts(1), hub.rock(0), hub.rock(1), hub.rock(2), hub.rock(3),
    hub.boat(), hub.scaffold(5, 4), hub.scaffold(3, 4), hub.townLamp(true), hub.townLamp(false),
  ],
  // The harbor coming alive (0.7.3): props by level, the gate's, the town's life.
  bollard: () => [harbor.bollard()],
  ropeCoil: () => [harbor.ropeCoil()],
  noticeBoard: () => [harbor.noticeBoard()],
  supplies: () => [harbor.supplies()],
  shipBell: () => [harbor.shipBell()],
  bunting: (entry) => [harbor.bunting(entry.span)],
  marketCrates: () => [harbor.marketCrates()],
  wheelbarrow: () => [harbor.wheelbarrow()],
  lobsterPots: () => [harbor.lobsterPots()],
  anvil: () => [harbor.anvil()],
  grindstone: () => [harbor.grindstone()],
  bench: () => [harbor.bench()],
  graves: () => [harbor.graves()],
  herbPots: () => [harbor.herbPots()],
  telescope: () => [harbor.telescope()],
  tavernTable: () => [harbor.tavernTable()],
  oarRack: () => [harbor.oarRack()],
  gullPerched: () => [harbor.gullPerched()],
  rowboat: () => [harbor.rowboat()],
  dog: () => [harbor.dog()],
  cat: () => [harbor.cat()],
  shots: () => effects.shots(),
  gems: () => effects.gems(),
  particles: () => effects.particles(),
  font: () => effects.font(),
  // 0.9.0 (W2): the signature weapons' icons (art/draw/trades.js).
  grapnelIcon: () => trades.grapnelIcon(),
  puntPoleIcon: () => trades.puntPoleIcon(),
  bogHandsIcon: () => trades.bogHandsIcon(),
  gravePenniesIcon: () => trades.gravePenniesIcon(),
  kingTideIcon: () => trades.kingTideIcon(),
});

/** What a character holds, drawn onto her padded sprite. */
export const HOLD = Object.freeze({
  lantern: sprites.lanternInHand,
  harpoon: sprites.harpoonInHand,
  pole: life.poleInHand,
  hood: life.hoodOver,
  weed: trades.weedOver,   // (0.9.0, W2) the Drowned Man's
  cowl: trades.priestCowl,   // (0.9.0, W2) the Tide Priest's face in her cowl, her crook and its bell
});

/** How a townsperson stands, drawn onto their padded frame (frame k of their animation). */
export const POSES = Object.freeze({
  wave: harbor.waveArm,
});

/**
 * What rises from a building's roof (0.7.3: each its own outline), drawn into its frame's room
 * above the roof: (frame, roofTop, stage), roofTop the row the roof starts on.
 */
export const OUTLINES = Object.freeze({
  bellcote: harbor.bellcote,
  forgeStack: harbor.forgeStack,
  flagstaff: harbor.flagstaff,
  weathervane: harbor.weathervane,
  chimneyPots: harbor.chimneyPots,
  lookout: harbor.lookout,
  cupola: harbor.cupola,
  innChimney: harbor.innChimney,
  lanternRoom: harbor.lanternRoom,
});
