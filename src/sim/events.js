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
  HIT: 1,          // x, y, a = damage, b = enemy handle, c = bits: 1 critical, 2 a strike's own hit, d = weapon slot
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
  EVOLVE: 20,      // x, y, a = weapon slot
  RELIC: 21,       // x, y, a = relic index
  RUNE: 22,        // x, y, a = rune index, b = weapon slot (-1 discarded)
  WAVE: 23,        // x, y, a = radius (a hook's screen wave, e.g. the Tide Priest)
  RUN_END: 24,     // x, y, a = reason (END)
  OVERTIME: 25,    // x, y, a = minute of overtime reached
  SHIELD_HIT: 26,  // x, y, a = damage absorbed
  ENEMY_SHOT: 27,  // x, y (a hostile shot leaves an enemy or boss)
  SECRET: 28,      // x, y, a = secret index on the map (its cache opened)
  ASCEND: 30,      // x, y, a = weapon slot (an Ember spent on it)
  MUSTER: 29,      // x, y, a = escorts, b = elite handle, c = timeline event index (an elite and its crew)
});

export const TELE = Object.freeze({ RING: 1, LINE: 2, CIRCLE: 3, SUMMON: 4, FAN: 5 });
export { PK as PICK } from './constants.js'; // pickup kinds: one table for the pool and the events
export const STATUS = Object.freeze({ BURN: 1, SLOW: 2, FREEZE: 3, ROT: 4 });
export const END = Object.freeze({ DIED: 1, LEFT: 2, CLEARED: 3 });

const LOW = new Uint8Array(32);
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
