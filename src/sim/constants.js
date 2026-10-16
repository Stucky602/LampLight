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
export const PASSIVE_SLOTS = 6;
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
});

// Enemy AI.
export const AI = Object.freeze({ chase: 0, swarm: 1, charger: 2, hazard: 3, splitter: 4, ranged_slow: 5, boss: 6 });

// Projectile flags.
export const PF = Object.freeze({ DEAD: 1, CHILD: 2, LANDED: 4, HOSTILE: 8, RETURNING: 16, MARCH: 32 });

// Projectile motions.
export const MOTION = Object.freeze({ linear: 0, homing: 1, boomerang: 2, orbit: 3, stationary: 4, arc: 5, bounce: 6, chain: 7 });

// Emitters.
export const EMIT = Object.freeze({ nearest: 0, facing: 1, radial: 2, orbit: 3, aura: 4, strike: 5, drop: 6, wave: 7, beam: 8, summon: 9 });

// On-hit effects.
export const FX = Object.freeze({ damage: 0, knockback: 1, status: 2, split: 3, chain: 4, explode: 5, pull: 6, zone: 7, light: 8, hang: 9, mark: 10, march: 11, focus: 12 });

// On-hit effects a shot's children (splits, chain hops, small flasks, marching strikes) leave out,
// so one hit never sets off a cascade of them.
export const PARENT_ONLY_FX = Object.freeze(['split', 'march', 'hang', 'focus']);

// Zone kinds.
export const ZONE = Object.freeze({ AURA: 1, GROUND: 2, WAVE: 3, BEAM: 4, HAZARD: 5, TETHER: 6, MARK: 7 });
// Zone flags: a wave rolling inward (Undertow), a beam sweeping round (Lighthouse).
export const ZF = Object.freeze({ REVERSE: 1, SWEEP: 2, FLARE: 4 }); // FLARE: a Fuel Line pulse, once, at flareMul
// Ground looks: burning oil (the default), a hanging flare, a ward.
export const ZSTYLE = Object.freeze({ OIL: 0, FLARE: 1, WARD: 2 });
// Mark kinds (a zone that rides an enemy): thrown by Riptide, charged by Static.
export const MARKS = Object.freeze({ RIPTIDE: 1, STATIC: 2 });

// Status effects.
export const STATUS_IDS = Object.freeze(['burn', 'slow', 'freeze', 'rot']);

// Pickup kinds (match events.PICK).
export const PK = Object.freeze({ MATERIAL: 1, HEAL: 2, MAGNET: 3, CHEST: 4, EMBER: 5, RELIQUARY: 6, VAULT: 7, GLASS: 8 });
/** Pickups that stay where they fell until you walk over them (the rest fly to you). */
export const PK_STAYS = Object.freeze([PK.CHEST, PK.RELIQUARY, PK.VAULT]);

// Run tasks (sim/tasks.js): kinds, and where one is.
export const TASK = Object.freeze({ LAMP: 1, BELL: 2 });
export const TASK_STATE = Object.freeze({ IDLE: 0, ACTIVE: 1, DONE: 2 });
