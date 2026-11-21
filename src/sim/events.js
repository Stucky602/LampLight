// The event buffer: the only way the sim tells render, audio, and the HUD what happened
// (ARCHITECTURE §5.14). Preallocated typed arrays; nothing flows back into the sim.
//
// Each event is a type plus six numbers (x, y, a, b, c, d) whose meaning depends on the type
// (see EV below). The sim appends during a tick. Whoever consumes the events clears the buffer:
// the headless runner every tick, the game once per rendered frame (a frame can hold several
// ticks, which is why capacity is generous).
//
// When the buffer is nearly full, low-priority events (hit numbers, status sparks, shot
// flashes) are dropped first, keeping room for the ones that matter (kills, hurts, level-ups,
// telegraphs). Drops are counted for the debug overlay.

export const EV = Object.freeze({
  HIT: 1,          // x, y, a = damage, b = enemy handle, c = bits: 1 critical, 2 a strike's own hit, 4 a boss's fight-length cap ate some or all of it (HIT_CAPPED), 8 a steady burn that shows no number (HIT_QUIET), d = weapon slot
  KILL: 2,         // x, y, a = enemy type index, b = flags (elite 1, boss 2), c = weapon slot (-1 other), d = enemy handle
  PLAYER_HURT: 3,  // x, y, a = damage taken, b = hp left
  GEM: 4,          // x, y, a = xp value
  LEVEL_UP: 5,     // x, y, a = new level
  CHEST: 6,        // x, y, a = kind (1 elite, 2 boss), b = items
  BOSS_SPAWN: 7,   // x, y, a = enemy type index, b = enemy handle
  TELEGRAPH: 8,    // x, y, a = shape (TELE), b = ticks until it hits, c = size (radius or length), d = angle or width
  DASH: 9,         // x, y, a = direction x, b = direction y
  PICKUP: 10,      // x, y, a = kind (PICK), b = material index or amount
  EXPLODE: 11,     // x, y, a = radius, b = weapon slot
  LIGHT: 12,       // x, y, a = radius, b = milliseconds
  STATUS: 13,      // x, y, a = status (STATUS), b = enemy handle
  SWARM: 14,       // x, y, a = kind (1 wall, 2 ring), b = count
  FIRE: 15,        // x, y, a = weapon slot, b = projectiles
  BOSS_ATTACK: 16, // x, y, a = attack kind, b = boss handle
  HEAL: 17,        // x, y, a = amount, b = 1 if it became shield
  REVIVE: 18,      // x, y
  ELITE_SPAWN: 19, // x, y, a = enemy type index, b = enemy handle
  EVOLVE: 20,      // x, y, a = weapon slot (0.9.0: never sent; the evolutions are gone)
  RELIC: 21,       // x, y, a = relic index
  RUNE: 22,        // x, y, a = rune index, b = weapon slot (-1 discarded)
  WAVE: 23,        // x, y, a = radius (a hook's screen wave, e.g. the Tide Priest)
  RUN_END: 24,     // x, y, a = reason (END)
  OVERTIME: 25,    // x, y, a = minute of overtime reached
  SHIELD_HIT: 26,  // x, y, a = damage absorbed
  ENEMY_SHOT: 27,  // x, y (a hostile shot leaves an enemy or boss)
  SECRET: 28,      // x, y, a = secret index on the map (its cache opened)
  ASCEND: 30,      // x, y, a = weapon slot (an Ember spent on it), b = 1 the Form was its capstone
  ZAP: 31,         // x, y (a Static charge) -> a, b (the neighbor it zapped)
  TASK: 32,        // x, y, a = kind (TASK), b = 1 started (a lamp's first tick in its ring; a bell's toll), 2 done (lit, rung), 3 a lit lamp went out (the fog took it back), 4 a bell's crew walks in; c = task index, d = Pearls it gave
  GLASS: 33,       // x, y, a = Sea Glass gained (negative: spent), b = held now
  NIGHT: 34,       // x, y, a = 1 Lantern Night begins (b = what set it off: 1 the crowd, 2 a muster or boss), 0 it ends, 2 banked (every lamp lit: it waits for the crowd); c = Lantern Nights this run
  FERRY: 35,       // x, y, a = 1 new stock (b = stock number), 2 a purchase (b = offer index), 3 he calls at a mooring (x, y his stand; b = mooring index, c = call number), 4 he casts off (x, y the stand he leaves)
  MUSTER: 29,      // x, y, a = escorts, b = elite handle, c = timeline event index (an elite and its crew); an overtime muster: c = -1 - its index in map.overtime.repeat
  LEVEL_GIFT: 36,  // x, y, a = what (GIFT: 1 food, 2 coin, 3 Sea Glass, 4 an Ember, kept), b = amount, c = the level it paid for (a level-up with nothing left to level)
  MUSTER_SOON: 37, // x, y (the player), a = seconds until it comes, b = its index in map.overtime.repeat (an overtime muster on its way)
  // The Salt Marsh (0.8.0, ARCHITECTURE §5.17; docs/design/SALT_MARSH_BUILD.md).
  WATER: 38,       // x, y (the player), a = phase (sim/marsh.js WATER: 1 warning, 2 rising, 3 high, 4 ebbing, 5 low), b = seconds until it comes (a warning), c = 1 in overtime
  HERB: 39,        // x, y, a = Marsh Herbs picked, b = the bed's index
  FIRST_SIGHT: 40, // x, y, a = what (SIGHT), b = the enemy type index (SIGHT.ENEMY), else 0: the first time a run meets it
  STRIKE: 41,      // x, y, a = radius, b = source (STRIKE_SRC: 1 the storm, 2 the Eye, 3 the Salt Widow), c = 1 if it left Salt Glass, d = 1 if a pillar rose
  PILLAR: 42,      // x, y (the tile's middle), a = 1 rises, 0 falls
  WELL: 43,        // x, y, a = 1 opens, 2 a relic given (b = relic index), 3 kept
  THRALL: 44,      // x, y, a = 1 rises, 0 crumbles, b = enemy type index, c = the thrall's slot
  LATCH: 45,       // x, y, a = 1 a leech latches on, 0 thrown off, b = enemy handle, c = how many are latched now
  SINK: 46,        // x, y, a = 1 the Bog Torc sinks you, 0 you rise
  EYE: 47,         // x, y, a = 1 the Eye begins (b = seconds), 0 it ends
  SHATTER: 48,     // x, y, a = shards, b = weapon slot (a frozen kill, Cold Iron)
  TAR: 49,         // x, y, a = radius, b = 1 set off by another weapon, 0 burned off at its end
  RATTLE: 50,      // x, y (the player): the Watchman's Rattle sounds (every weapon fires)
  LEAP: 51,        // x, y (where it lands), a = 1 up (b = seconds in the air), 0 down, c = 1 stuck in the mud, d = enemy handle
  // The interactables (0.8.2, ARCHITECTURE §5.18; work/interact/I1-CONTRACT.md).
  BELL_COUNT: 52,  // x, y (the bell), a = kills left, b = task index, c = kills it needs (a kill that counted)
  DROP: 53,        // x, y (where it lies), a = pickup kind (a chest, an Ember, a Reliquary, the vault), b = the lamp index + 1 whose ward it lies in (0 none), c = 1 a Reliquary pulled in toward you
  RELIC_POOL: 54,  // x, y (you), a = 1 every relic in the run's pool is found, b = found, c = total (once a run)
  VAULT_EMPTY: 55, // x, y (you): the vault had no relic left to offer (an Ember instead)
  // Builds (0.9.0, W1-CONTRACT.md; 60 to 63 are W1's).
  FORM_STEP: 60,   // x, y (you), a = weapon slot, b = its Form progress now, c = steps it needs (a Form card, a chest item, a bell's pick)
  RELIC_SWAP: 61,  // x, y (you), a = the relic given up (relic index), b = the relic taken (relic index, -1 none: a pass)
  // Combat and enemies (0.9.0, W3; work/veteran/W3-CONTRACT.md). Codes 64 and up are W3's.
  TELE_TIER: 64,   // x, y (as its TELEGRAPH, which it follows at once), a = tier (TIER), b = the enemy's handle (-1 none), c = ticks, d = enemy type index (-1 none)
  HIT_STOP: 65,    // x, y, a = kind (HITSTOP), b = damage: the sim asks for hit-stop only on real hits
  BOSS_GATE: 66,   // x, y (the boss), a = 1 held at a notch (waiting for its signature), 2 opened, b = boss handle, c = notch index (notches.length: its death)
  BOSS_PHASE: 67,  // x, y, a = phase index now, b = boss handle
  BOSS_WEAK: 68,   // x, y, a = 1 a weak window begins (c = seconds), 0 it ends, b = boss handle
  AFFIX: 69,       // x, y, a = affix bits (data/enemies.js AFFIXES), b = elite handle, c = enemy type index
  WARD: 70,        // x, y, a = ward hits left (0: broken), b = elite handle
  TETHER: 71,      // x, y, a = 1 linked, 0 broken, b = elite handle, c = the linked enemy's handle
  PLAYER_SLOW: 72, // x, y (you), a = what slows you now (0 to 0.5), b = cause (1 midges, 2 Brine)
  CHAMPION: 73,    // x, y, a = 1 arrives, 2 its attack begins, 0 falls; b = handle, c = timeline event index, d = attack code (sim/champions.js CHAMPION_ATTACK)
  // The run's arc and the maps (0.9.0, W4; work/veteran/W4-NOTES.md). Codes 74 to 79 are W4's.
  ACT: 74,         // x, y (you), a = the act beginning (1, 2, 3), b = its twists (TWIST bits), c = lamps it brings, d = bells it brings
  MAP_EVENT: 75,   // x, y (where it happens), a = 1 it begins, 2 its cache's guard rises, 0 it ends; b = the deck entry's index in map.deck, c = the act
  FIND: 76,        // x, y, a = what it gave (FIND_GIFT), b = amount, c = the find's index in world.finds
  FINALE: 77,      // x, y (you), a = 1 the Long Night falls (b = bosses that come), 2 a boss of it falls (b = left), 3 dawn (b = seconds until the run ends), 4 a boss returns in overtime (b = enemy type index)
  ARM: 78,         // x, y (the task), a = task kind (TASK), b = task index, c = the act, d = the place's index in map.places (-1 none): a task armed on the map (a bell waking, a crane ready again)
  // The growth core (ruling 14 sections A to C, C1; work/cw/C1-CONTRACT.md section 9). For the presentation batch.
  DEED: 81,        // x, y (you), a = slot, b = have, c = need, d = 1 when done (sent when the count moves, at most once a tick per weapon)
  AXIS_OPEN: 82,   // x, y (you), a = slot, b = axis (0 delivery, 1 flight, 2 payoff), c = why (0 level, 1 deed, 2 Ember, 3 track)
  LEGENDARY: 83,   // x, y (you), a = slot, b = the special's index in the weapon's specials: a Legendary special taken
  UPGRADE: 84,     // x, y (you), a = slot (-1 the Dash slot), b = rarity (0 to 4), c = kind (0 number, 1 line, 2 special, 3 a dash card)
  PLANT: 85,       // x, y (where), a = slot, b = kind (1 a pot, 2 a buoy, 3 a rod, 4 a moored ring), c = seconds it stands
  LOOP: 86,        // x, y (center), a = slot, b = radius: a Glass Ring closed
  // 0.9.0 (W2, ruling 2: characters' trades, sim/trades.js).
  // The characters (ruling 14 section D, C2; sim/hooks-characters.js, sim/trades.js). For the presentation batch.
  TIDE: 87,        // x, y (the Tide Priest), a = 0 the ebb, 1 the flood, b = 1 when she called it, c = its reach
  MOMENTUM: 88,    // x, y (the Punter), a = the meter's step now (0 to 4)
  SIG_UP: 89,      // x, y (you), a = the signature's slot, b = 0 from the clock, 1 from the trade, c = upgrades it has taken
  LANTERN: 90,     // x, y (where the Lamplighter set it down), a = its reach, b = seconds it stands (0: until she sets more)
  DIVE: 91,        // x, y (where the Drowned Man's crate came up), a = 1 a sea chest (the name is kept: nothing dives on the dash)
  OIL: 92,         // x, y (the Lamplighter), a = her oil's step (3 full, 0 run down), b = 1 when a lamp filled it
  CALL_DEAD: 93,   // x, y (the Bog Warden, walking over the fresh dead), a = 0, b = dead raised there
  HAUL: 94,        // x, y (what the Harpooner's hook took), a = 1 an elite, 2 loot, 3 a mooring post, 4 the Grapnel's own haul
  SKILL: 95,       // x, y, a = the skill's index in data/skills.js, b = its detail: a skill's own effect went off
  TRADE: 80,       // x, y (where), a = what (trades.js TRADE: 1 an elite yanked, 2 the Ferryman called, 3 the dead raised, 4 a sunken crate hauled up, 5 a punt cache (b 1 floats out, 0 opened), 6 a bell re-armed, 7 a net cast, 8 a weapon slot gained, 9 the Punter's punt (b 1 the pole tiring, 0 spent: carried ashore, 2 fresh again)), b = its detail
});
/** A twist an act brings (EV.ACT b bits; a task's `twist`). */
export const TWIST = Object.freeze({ HELD: 1, ELITE_CREW: 2 });
/** What a small find gave (EV.FIND a). */
export const FIND_GIFT = Object.freeze({ PEARLS: 1, EMBER: 2, ITEM: 3, MATERIALS: 4, HEAL: 5, RUNE: 6 });

/** A warning's tier (EV.TELE_TIER a): MAJOR bosses, champions, map strikes; FULL an ordinary warning that threatens you, within the cap; DIM the rest. */
export const TIER = Object.freeze({ MAJOR: 1, FULL: 2, DIM: 3 });
/** What hit you (EV.PLAYER_HURT and EV.SHIELD_HIT c). */
export const HURT = Object.freeze({ CONTACT: 1, SHOT: 2, BOSS: 3, STRIKE: 4, DRAIN: 5, HAZARD: 6, ATTACK: 7 });
/** What a hit-stop request is for (EV.HIT_STOP a). */
export const HITSTOP = Object.freeze({ HURT: 1, BOSS_HIT: 2, ELITE_KILL: 3, BOSS_KILL: 4 });

/** EV.HIT's c bits. */
export const HIT_CRIT = 1, HIT_STRIKE = 2, HIT_CAPPED = 4, HIT_QUIET = 8;   // 8: a steady burn (a ward, Lantern Night): no damage number
/** EV.HIT's c bit 16: a boss's phase gate held some or all of it (0.9.0; HIT_CAPPED is the time floor). */
export const HIT_GATED = 16;
/** What a dry level-up paid (EV.LEVEL_GIFT's a). */
export const GIFT = Object.freeze({ FOOD: 1, COIN: 2, GLASS: 3, EMBER: 4 });

export const TELE = Object.freeze({ RING: 1, LINE: 2, CIRCLE: 3, SUMMON: 4, FAN: 5 });
export { PK as PICK } from './constants.js'; // pickup kinds: one table for the pool and the events
export const STATUS = Object.freeze({ BURN: 1, SLOW: 2, FREEZE: 3, ROT: 4, SALT: 5, TAR: 6, FEVER: 7, SOAK: 8, THAW: 9, DAZE: 10, LOST: 11 });   // LOST: the Fog Horn's (walking away, lost in the fog)
/** What a FIRST_SIGHT names (a). */
export const SIGHT = Object.freeze({ ENEMY: 1, WATER: 2, STORM: 3, EYE: 4, HERBS: 5, WELL: 6, PILLAR: 7, CAUSEWAY: 8, THRALL: 9, LAMP: 10, BELL: 11, FERRY: 12, RELIQUARY: 13 });
export const SIGHT_NAMES = Object.freeze({ 2: 'water', 3: 'storm', 4: 'eye', 5: 'herbs', 6: 'well', 7: 'pillar', 8: 'causeway', 9: 'thrall', 10: 'lamp', 11: 'bell', 12: 'ferry', 13: 'reliquary' });
/** Who a STRIKE came from (b). */
export const STRIKE_SRC = Object.freeze({ STORM: 1, EYE: 2, WIDOW: 3, CRANE: 4, CAIRN: 5, FIRE: 6 });
export const END = Object.freeze({ DIED: 1, LEFT: 2, CLEARED: 3 });

const LOW = new Uint8Array(256); // (event types are a byte)
LOW[EV.HIT] = 1; LOW[EV.STATUS] = 1; LOW[EV.FIRE] = 1; LOW[EV.LIGHT] = 1;

export const EVENT_NAMES = Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k]));

/**
 * @param {number} capacity events held before dropping
 * @param {number} reserve slots kept for important events (low-priority ones stop here)
 */
export function createEventBuffer(capacity = 8192, reserve = 1024) {
  const type = new Uint8Array(capacity);
  const x = new Float32Array(capacity);
  const y = new Float32Array(capacity);
  const a = new Float32Array(capacity);
  const b = new Float32Array(capacity);
  const c = new Float32Array(capacity);
  const d = new Float32Array(capacity);
  const lowLimit = capacity - reserve;
  const buf = {
    capacity, type, x, y, a, b, c, d,
    count: 0,
    /** Events dropped since the last clear (low priority first). */
    dropped: 0,
    /** Events dropped since the buffer was made. */
    droppedTotal: 0,
    push(t, px, py, pa = 0, pb = 0, pc = 0, pd = 0) {
      const i = buf.count;
      if (i >= capacity || (LOW[t] === 1 && i >= lowLimit)) { buf.dropped++; buf.droppedTotal++; return -1; }
      type[i] = t; x[i] = px; y[i] = py; a[i] = pa; b[i] = pb; c[i] = pc; d[i] = pd;
      buf.count = i + 1;
      return i;
    },
    /**
     * Claim the next slot for an event and return its index (or -1 if dropped); the caller
     * writes x[i], y[i], a[i], ... directly. Hot paths use this instead of push(), which takes
     * fractional numbers as arguments (V8 allocates for those when it doesn't inline the call).
     * Every field starts at 0.
     */
    reserve(t) {
      const i = buf.count;
      if (i >= capacity || (LOW[t] === 1 && i >= lowLimit)) { buf.dropped++; buf.droppedTotal++; return -1; }
      type[i] = t; x[i] = 0; y[i] = 0; a[i] = 0; b[i] = 0; c[i] = 0; d[i] = 0;
      buf.count = i + 1;
      return i;
    },
    clear() { buf.count = 0; buf.dropped = 0; },
    /** Count of one event type currently in the buffer (tests and tools). */
    countOf(t) {
      let n = 0;
      for (let i = 0; i < buf.count; i++) if (type[i] === t) n++;
      return n;
    },
  };
  return buf;
}
