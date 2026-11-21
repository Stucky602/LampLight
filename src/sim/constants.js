// Numbers shared by the sim's systems: pool sizes, entity flags, AI and effect codes.

export const DT = 1 / 60;
export const TPS = 60;

// Pool capacities (ARCHITECTURE §5.3).
export const CAP = Object.freeze({ enemies: 4096, projectiles: 4096, gems: 4096, zones: 512, pickups: 256 }); // zones: weapon pools, rune pools, and a boss's tide rows at once

// Weapon slots: 0..MAX_WEAPON_SLOTS-1 are the build's weapons (6 by default; a hook can open
// more), then the character's innate weapon, then relic effects. Each has its own hit
// cooldown per enemy.
export const DEFAULT_WEAPON_SLOTS = 6;
export const MAX_WEAPON_SLOTS = 8;
export const INNATE_SLOT = 8;
export const RELIC_SLOT = 9;
export const HIT_SLOTS = 10;
export const HOSTILE = 255; // projectile/zone slot value for enemy attacks
// Passive and relic slots (0.9.0, rulings 3 and 4): a run's own are world.build.passiveSlots and
// relicSlots (RunConfig: from the harbor, meta/state.js slotsFor; 6 each when it leaves them out).
export const DEFAULT_PASSIVE_SLOTS = 6;
export const DEFAULT_RELIC_SLOTS = 6;
export const MAX_PASSIVE_SLOTS = 8;
export const MAX_RELIC_SLOTS = 8;
/** The most passive slots there can be (a run's own: world.build.passiveSlots). */
export const PASSIVE_SLOTS = MAX_PASSIVE_SLOTS;
// A shot remembers the last HIT_RING enemies it hit, so a piercing or chaining shot never hits
// one twice; pierce is capped at the same number (tuning.caps.weapon.maxPierce).
export const HIT_RING = 8;

// Enemy flags.
export const EF = Object.freeze({
  DEAD: 1,        // killed this tick (resolved in step 9, removed at the end of the tick)
  ELITE: 2,
  BOSS: 4,
  MARK: 8,        // temporary: excluded from a nearest-enemy search (chain hops)
  RESOLVED: 16,   // its death has been processed
  SWARM: 32,      // part of a wall: never teleports; vanishes once far away
  VANISH: 64,     // removed without a kill (a swarm that left the screen)
  MINION: 128,    // summoned by a boss (counts toward the minion cap)
  AIR: 256,       // in the air (a toad's hop, the Old Grey's leap): untouchable, skipped by every search
  // 0.9.0 (W3):
  EVENT: 512,     // part of a set piece (a wall, a ring, a flock, a muster's crew): not counted against the band's target or its alive cap
  WARNING: 1024,  // showing a warned attack of its own (a rat crouched to pounce, a champion): anchored where it warned, never held
  LUNGING: 2048,  // in the middle of a warned lunge (a rat's pounce): never held
});
/** What a hit, a search, or a blast passes over: the dead and what's in the air. */
export const EF_GONE = 1 | 256;

// Enemy AI.
export const AI = Object.freeze({ chase: 0, swarm: 1, charger: 2, hazard: 3, splitter: 4, ranged_slow: 5, boss: 6, hopper: 7, eel: 8 });
/** How an enemy moves through water (data: `swims`): walkers (0), 'amphibious' (1, a leech), 'water' only (2, an eel). */
export const SWIMS = Object.freeze({ land: 0, amphibious: 1, water: 2 });

// Projectile flags.
export const PF = Object.freeze({ DEAD: 1, CHILD: 2, LANDED: 4, HOSTILE: 8, RETURNING: 16, MARCH: 32, MINE: 64, LATCH: 128, SPLIT: 256, VIGIL: 512 });   // VIGIL (C1b, Nov 20): a Vigil flame: it doesn't lure (Wisps) or leave mist when it burns out (Grave Mist)   // SPLIT: it has split once (Splinter splits a shot at its first hit only: ruling 18 WA, a Star Shell's 5 pierces each split)   // MINE: a buried bolt waiting (it hits nothing itself); LATCH: an eel holding on

// Projectile motions.
export const MOTION = Object.freeze({ linear: 0, homing: 1, boomerang: 2, orbit: 3, stationary: 4, arc: 5, bounce: 6, chain: 7, follow: 8 });   // follow: a flame trailing behind you along the path you walked

// Emitters.
export const EMIT = Object.freeze({ nearest: 0, facing: 1, radial: 2, orbit: 3, aura: 4, strike: 5, drop: 6, wave: 7, beam: 8, summon: 9, spout: 10 });

// On-hit effects.
export const FX = Object.freeze({ damage: 0, knockback: 1, status: 2, split: 3, chain: 4, explode: 5, pull: 6, zone: 7, light: 8, hang: 9, mark: 10, march: 11, focus: 12, daze: 13, spill: 14, tar: 15, fever: 16, spike: 17, gaff: 18, bump: 19, heave: 20 });   // gaff: a hit on a dazed enemy exposes it (the Anchor Chain's, ruling 19 RE); bump: what it knocks hurts or dazes what it runs into (Knock-On, Heavy Iron); heave: a frozen enemy is thrown (Geyser)

// On-hit effects a shot's children (splits, chain hops, small flasks, marching strikes) leave out,
// so one hit never sets off a cascade of them.
export const PARENT_ONLY_FX = Object.freeze(['split', 'march', 'hang', 'focus', 'spill']);

// Zone kinds.
export const ZONE = Object.freeze({ AURA: 1, GROUND: 2, WAVE: 3, BEAM: 4, HAZARD: 5, TETHER: 6, MARK: 7, PUDDLE: 8, SPIKE: 9, STRIKE: 10 });
// Zone flags: a wave rolling inward (Undertow), a beam sweeping round (Lighthouse).
export const ZF = Object.freeze({ REVERSE: 1, SWEEP: 2, FLARE: 4, DRIFT: 8, FIXED: 16, STAND: 32, CONE: 64 });   // CONE: a wave that rolls out in a cone (the Fog Horn): dx, dy its way, length the cosine of its half-angle // FLARE: a Fuel Line pulse, once, at flareMul; DRIFT: a puddle creeping after an enemy (Creeping Brine); FIXED: a wave or a beam that starts somewhere other than you and stays there; STAND: a wave that stops at its reach and stands (Slack Water)
// Ground looks: burning oil (the default), a hanging flare, a ward.
export const ZSTYLE = Object.freeze({ OIL: 0, FLARE: 1, WARD: 2, WATER: 3, ROT: 4 });   // WATER: Ground Swell's standing water; ROT: a patch of rot
// Mark kinds (a zone that rides an enemy): thrown by Riptide, charged by Static.
export const MARKS = Object.freeze({ RIPTIDE: 1, STATIC: 2 });

// Status effects.
export const STATUS_IDS = Object.freeze(['burn', 'slow', 'freeze', 'rot', 'lost']);   // lost: the Fog Horn's (sim/enemies.js applyStatus)
/** A leech's states (E.aiState): swimming at you, latched on. A toad's: sitting, in the air. An eel's: waiting, warning, lunging, back. */
export const LEECH = Object.freeze({ SWIM: 0, LATCHED: 1 });
export const HOP = Object.freeze({ SIT: 0, AIR: 1 });
export const EEL = Object.freeze({ WAIT: 0, WARN: 1, LUNGE: 2, BACK: 3 });

// Pickup kinds (match events.PICK).
export const PK = Object.freeze({ MATERIAL: 1, HEAL: 2, MAGNET: 3, CHEST: 4, EMBER: 5, RELIQUARY: 6, VAULT: 7, GLASS: 8 });
/** Pickups that stay where they fell until you walk over them (the rest fly to you). */
export const PK_STAYS = Object.freeze([PK.CHEST, PK.RELIQUARY, PK.VAULT]);

// Run tasks (sim/tasks.js): kinds, and where one is. A lamp the fog took back is IDLE again.
// 0.9.0 (W4): CRANE (the Drowned Docks' cranes: a load dropped on the crowd) and CAIRN (the Salt
// Marsh's salt cairns: the storm works the ground round it a while), each map's task of its own.
export const TASK = Object.freeze({ LAMP: 1, BELL: 2, CRANE: 3, CAIRN: 4 });
export const TASK_STATE = Object.freeze({ IDLE: 0, ACTIVE: 1, DONE: 2 });
/** The most a Fog Bell's crew can be (sim/tasks.js: kills it needs, held to this). */
export const BELL_CREW_MAX = 64;
