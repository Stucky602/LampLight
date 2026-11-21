// What the run view remembers between frames, and how events change it (pure; tested in Node).
//
// The sim's event buffer says what happened; this turns that into things to draw for a while:
// sparks, the pop of a dying enemy, damage numbers, warning shapes, short-lived lights, scorch
// marks, and the squash of a hit enemy. render/runview.js draws from it. Keeping
// this out of the Pixi code lets the gate check it.
//
// Per-enemy state (facing, when it was last hit, when it appeared) is kept per pool slot id, and
// a slot is known to hold a new enemy when its handle changes. Nothing here allocates per frame.

import { EV, TELE, PICK, HIT_CAPPED as CAPPED, HIT_QUIET } from '../sim/events.js';
import * as EVENTS from '../sim/events.js';
import { TPS } from '../sim/constants.js';
import { GROUND } from '../sim/terrain.js';
import { color as pal } from '../data/palette.js';
import { createNumbers, createParticles } from './feel.js';

export const MAX_TELEGRAPHS = 96;
export const MAX_DYING = 512;
export const MAX_BOLTS = 48;
export const BOLT_MS = 140; // how long a bolt shows
export const MAX_ZAPS = 64; // Static's zaps from a charged enemy to its neighbor (they show as long as a bolt)
export const MAX_HAULS = 16; // the Harpooner's line, from her to what her hook took (C3)
export const HAUL_MS = 260;  // how long a haul's line shows
export const MAX_DECALS = 192;
export const MAX_LIGHTS = 96;
export const NUMBERS_CAP = 400;   // the most tuning.feel.numbers.max can ask for
export const MAX_TICK_MARKS = 32; // sim ticks read in one rendered frame (the loop runs at most 5)
export const MAX_WARDS = 4;       // bosses showing a ward at once (a capped hit, below)
/**
 * A hit a boss's fight-length cap ate (HIT, c bit 4: the sim's minimum fight length, §5.13): no
 * number (there's no damage to show), a small grey ring where it landed (at most one every
 * WARD_RING_MS, so a crowd of shots doesn't fill the screen with rings), and a pale ward round the
 * boss for WARD_MS, so the player sees the boss is shrugging hits off rather than a weapon missing.
 */
export const HIT_CAPPED = CAPPED;   // sim/events.js: 4
/**
 * A level-up with nothing left to level (0.7.3) is paid without a stop: the sim writes LEVEL_UP as
 * usual and, in the same tick, LEVEL_GIFT for that level. Such a level-up gets only a small glint,
 * not the level-up's burst, light, and wash (nothing was offered; the quiet notice says what it paid).
 */
const LEVEL_GIFT = EV.LEVEL_GIFT ?? 36;
const MAX_GIFTS = 16;
export const WARD_MS = 260;
/**
 * Damage numbers in a crowd (0.9.0, the veteran round: at 1,287 alive they piled into "14 14 14"
 * clusters and buried the player). Above NUMBERS_CROWD enemies alive, a number shows only for a
 * critical hit or a big one (at least NUMBERS_BIG times the recent average hit); and no number ever
 * shows within NUMBERS_CLEAR px of the player (the run view also skips any that drift inside it).
 * Your own damage and healing go above that ring.
 */
export const NUMBERS_CROWD = 200;
export const NUMBERS_BIG = 3;
export const NUMBERS_CLEAR = 24;
/** How quickly the recent average hit follows new hits (a share per hit). */
const HIT_MEAN_RATE = 0.02;

/** Should a hit's number show? (pure: the gate checks it) */
export function numberShows(amount, crit, alive, mean, dx, dy) {
  if (dx * dx + dy * dy < NUMBERS_CLEAR * NUMBERS_CLEAR) return false;
  if (alive <= NUMBERS_CROWD) return true;
  return crit || amount >= NUMBERS_BIG * mean;
}
export const WARD_RING_MS = 120;

/**
 * Warning tiers (0.9.0, W3's contract §1): EV.TELE_TIER follows each TELEGRAPH with its tier. MAJOR
 * (bosses, champions, map strikes) draws the full bright shape; FULL (an ordinary warning that
 * threatens you, within the sim's cap) the full shape, thinner and dimmer; DIM a short tell only (a
 * 20 px arrow from the enemy for a line, with a flash on its body; a thin dim outline for a ring or
 * a pool). A warning with no tier (an older sim) draws as MAJOR did.
 */
export const TIER = EVENTS.TIER ?? Object.freeze({ MAJOR: 1, FULL: 2, DIM: 3 });
const TELE_TIER = EV.TELE_TIER ?? 64;
const FORM_STEP = EV.FORM_STEP ?? 60;
/** A DIM line's arrow, px. */
export const TELL_PX = 20;
export const MAX_POOL_TIERS = 64;

/** Particle frames, by index (runview maps them to atlas frames). */
export const PF_FRAME = Object.freeze({ DOT: 0, SPARK: 1, PLUS: 2, DISC: 3, RING: 4 });

/** Colors the effects use (0xrrggbb). */
export const FX_COLOR = Object.freeze({
  spark: pal('lamp-6'), ember: pal('lamp-4'), gem: pal('gem-3'), blood: pal('fog-2'), heal: pal('moss-4'),
  hurt: pal('rot-4'), warn: pal('rot-3'), warnHot: pal('rot-4'), lamp: pal('lamp-5'), cool: pal('sea-6'), violet: pal('violet-4'),
  capped: pal('fog-3'), ward: pal('fog-5'),
  // C3: a Legendary's gold (the rarity's own color).
  gold: pal('lamp-4'),
  // The Salt Marsh's (0.8.0): glass, mud and peat thrown up, ice shards, a thrall rising.
  glass: pal('fog-5'), mud: pal('wood-2'), ice: pal('gem-4'), thrall: pal('moss-4'),
});

/**
 * The Salt Marsh's marks (0.8.0). A thrall (the Bog Warden's) is its own enemy's sprite darkened
 * with a cool tint, a pip over it in her moss green (no enemy wears one; never your amber), so it
 * reads as neither you nor a threat. A fever carrier wears a violet pip; a salted enemy is a pale
 * grey still silhouette (its flash frame in this tint); a leech latched on and the peat of the Bog
 * Torc are drawn over you.
 */
export const MARSH_COLOR = Object.freeze({
  thrall: pal('gem-4'), thrallPip: pal('moss-4'), feverPip: pal('violet-4'), salt: pal('fog-3'),
  peat: pal('wood-1'), peatTop: pal('wood-2'), herb: 0xffffff, well: pal('sea-5'),
});

/** How high something in the air is drawn (a toad's hop, the Old Grey's leap): an arc over its flight, `u` 0..1. */
export function airLift(u, height) {
  const k = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.sin(Math.PI * k) * height;
}

/** How far along its flight something in the air is: from (sx, sy) toward (ax, ay), where it is now (x, y). */
export function airProgress(sx, sy, x, y, ax, ay) {
  const tx = ax - sx, ty = ay - sy, d2 = tx * tx + ty * ty;
  if (d2 < 1e-6) return 1;
  const u = ((x - sx) * tx + (y - sy) * ty) / d2;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

export function createViewState({ slots = 4096, rand = Math.random } = {}) {
  const st = {
    slots, rand,
    slotHandle: new Int32Array(slots).fill(-2),
    facing: new Int8Array(slots).fill(1),
    hitAt: new Float64Array(slots).fill(-1e9),
    bornAt: new Float64Array(slots).fill(-1e9),
    sparks: createParticles(4096),
    numbers: createNumbers(NUMBERS_CAP, slots),
    bolts: { n: 0, next: 0, x: new Float32Array(MAX_BOLTS), y: new Float32Array(MAX_BOLTS), t: new Float64Array(MAX_BOLTS) },
    zaps: { n: 0, next: 0, x: new Float32Array(MAX_ZAPS), y: new Float32Array(MAX_ZAPS), x2: new Float32Array(MAX_ZAPS), y2: new Float32Array(MAX_ZAPS), t: new Float64Array(MAX_ZAPS) },
    hauls: { n: 0, next: 0, x: new Float32Array(MAX_HAULS), y: new Float32Array(MAX_HAULS), x2: new Float32Array(MAX_HAULS), y2: new Float32Array(MAX_HAULS), t: new Float64Array(MAX_HAULS), big: new Uint8Array(MAX_HAULS) },
    dying: { n: 0, x: new Float32Array(MAX_DYING), y: new Float32Array(MAX_DYING), t: new Float64Array(MAX_DYING), type: new Uint16Array(MAX_DYING), big: new Uint8Array(MAX_DYING), face: new Int8Array(MAX_DYING) },
    decals: { n: 0, next: 0, x: new Float32Array(MAX_DECALS), y: new Float32Array(MAX_DECALS), t: new Float64Array(MAX_DECALS), size: new Uint8Array(MAX_DECALS) },
    tele: { n: 0, shape: new Uint8Array(MAX_TELEGRAPHS), x: new Float32Array(MAX_TELEGRAPHS), y: new Float32Array(MAX_TELEGRAPHS), size: new Float32Array(MAX_TELEGRAPHS), ang: new Float32Array(MAX_TELEGRAPHS), end: new Int32Array(MAX_TELEGRAPHS), total: new Int32Array(MAX_TELEGRAPHS), tier: new Uint8Array(MAX_TELEGRAPHS) },
    // The last TELEGRAPH read: its index in tele (-1: it was a pool, or none), so its TELE_TIER finds it.
    lastTele: -1,
    // Pools' tiers (a CIRCLE is drawn from its zone, so its tier is kept by place until it ends).
    poolTier: { n: 0, next: 0, x: new Float32Array(MAX_POOL_TIERS), y: new Float32Array(MAX_POOL_TIERS), end: new Int32Array(MAX_POOL_TIERS), tier: new Uint8Array(MAX_POOL_TIERS) },
    // A DIM line's flash on its enemy's body: per slot, the tick it ends (checked against the handle).
    tellUntil: new Int32Array(slots), tellHandle: new Int32Array(slots).fill(-2),
    lights: { n: 0, next: 0, x: new Float32Array(MAX_LIGHTS), y: new Float32Array(MAX_LIGHTS), r: new Float32Array(MAX_LIGHTS), t: new Float64Array(MAX_LIGHTS), ms: new Float32Array(MAX_LIGHTS), col: new Uint32Array(MAX_LIGHTS) },
    // Which sim tick wrote which events: the run scene marks the buffer's end after each tick.
    marks: { n: 0, end: new Int32Array(MAX_TICK_MARKS), tick: new Int32Array(MAX_TICK_MARKS) },
    // Wards: the boss (its handle) and when its last capped hit landed; the last grey ring's time.
    wards: { handle: new Int32Array(MAX_WARDS).fill(-1), t: new Float64Array(MAX_WARDS).fill(-1e9) },
    cappedRingAt: -1e9,
    gifted: new Int32Array(MAX_GIFTS),   // the levels this batch's LEVEL_GIFTs paid for (consumeEvents)
    hurtAt: -1e9,
    levelAt: -1e9,
    hitMean: 0,          // the recent average hit (numberShows' "big")
  };
  return st;
}

/** Forget everything (a new run). */
export function resetViewState(st) {
  st.slotHandle.fill(-2); st.facing.fill(1); st.hitAt.fill(-1e9); st.bornAt.fill(-1e9);
  st.sparks.clear(); st.numbers.clear();
  st.lastTele = -1; st.poolTier.n = 0; st.poolTier.next = 0; st.tellUntil.fill(0); st.tellHandle.fill(-2);
  st.bolts.n = 0; st.bolts.next = 0; st.zaps.n = 0; st.zaps.next = 0; st.hauls.n = 0; st.hauls.next = 0; st.dying.n = 0; st.decals.n = 0; st.decals.next = 0; st.tele.n = 0; st.lights.n = 0; st.lights.next = 0; st.marks.n = 0;
  st.wards.handle.fill(-1); st.wards.t.fill(-1e9); st.cappedRingAt = -1e9;
  st.hurtAt = -1e9; st.levelAt = -1e9; st.hitMean = 0;
}

/** A boss's ward from a capped hit now: its own entry renewed, else a free one (or the oldest). */
function addWard(st, handle, now) {
  const W = st.wards;
  let k = W.handle.indexOf(handle);
  if (k < 0) { k = 0; for (let j = 1; j < MAX_WARDS; j++) if (W.t[j] < W.t[k]) k = j; W.handle[k] = handle; }
  W.t[k] = now;
}

/** How strong a boss's ward shows (1 just hit, fading to 0 over WARD_MS), or 0 for none. */
export function wardStrength(st, handle, now) {
  const k = st.wards.handle.indexOf(handle);
  if (k < 0) return 0;
  const u = (now - st.wards.t[k]) / WARD_MS;
  return u >= 0 && u < 1 ? 1 - u : 0;
}

/** After a sim tick: events before `endIndex` in the buffer were written by tick `tick` or earlier. */
export function markTick(st, endIndex, tick) {
  const m = st.marks;
  if (m.n < MAX_TICK_MARKS) { m.end[m.n] = endIndex; m.tick[m.n] = tick; m.n++; }
  else { m.end[MAX_TICK_MARKS - 1] = endIndex; m.tick[MAX_TICK_MARKS - 1] = tick; }
}

/** The sim tick that wrote event i (the latest tick if no mark covers it: a decision's events). */
export function tickOfEvent(st, i, fallback) {
  const m = st.marks;
  for (let k = 0; k < m.n; k++) if (i < m.end[k]) return m.tick[k];
  return fallback;
}

/** Note that slot `s` holds the enemy with handle `h` right now; returns true if it's a newcomer. */
export function noteEnemy(st, s, h, now) {
  if (st.slotHandle[s] === h) return false;
  st.slotHandle[s] = h; st.bornAt[s] = now; st.facing[s] = 1; st.hitAt[s] = -1e9;
  return true;
}

function burst(st, x, y, count, rgb, speed, lifeMs, frame, gravity = 0) {
  const r = st.rand, TAU = Math.PI * 2;
  for (let k = 0; k < count; k++) {
    const a = r() * TAU, v = speed * (0.4 + r() * 0.6);
    st.sparks.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, lifeMs * (0.6 + r() * 0.4), frame, rgb, gravity, 3);
  }
}

export function addLight(st, x, y, r, ms, rgb, now, strength = 1) {
  const L = st.lights;
  let i;
  if (L.n < MAX_LIGHTS) i = L.n++;
  else { i = L.next; L.next = (L.next + 1) % MAX_LIGHTS; } // full: replace the oldest-placed
  L.x[i] = x; L.y[i] = y; L.r[i] = r * strength; L.t[i] = now; L.ms[i] = ms; L.col[i] = rgb;
}

function addDecal(st, x, y, size, now) {
  const D = st.decals;
  let i;
  if (D.n < MAX_DECALS) i = D.n++;
  else { i = D.next; D.next = (D.next + 1) % MAX_DECALS; }
  D.x[i] = x; D.y[i] = y; D.t[i] = now; D.size[i] = size;
}

function addTelegraph(st, shape, x, y, endTick, total, size, ang) {
  const T = st.tele;
  if (T.n >= MAX_TELEGRAPHS) return -1;
  const i = T.n++;
  T.shape[i] = shape; T.x[i] = x; T.y[i] = y; T.size[i] = size; T.ang[i] = ang;
  T.total[i] = total; T.end[i] = endTick; T.tier[i] = 0;
  return i;
}

/** A pool's tier, kept by its place until its warning ends (the oldest goes when full). */
function addPoolTier(st, x, y, endTick, tier) {
  const P = st.poolTier;
  let k;
  if (P.n < MAX_POOL_TIERS) k = P.n++;
  else { k = P.next; P.next = (P.next + 1) % MAX_POOL_TIERS; }
  P.x[k] = x; P.y[k] = y; P.end[k] = endTick; P.tier[k] = tier;
}

/** The tier of a pool warning at (x, y) now, or 0 if none was given (draw it as MAJOR did). */
export function poolTierAt(st, x, y, tick) {
  const P = st.poolTier;
  for (let k = 0; k < P.n; k++) if (P.end[k] >= tick && Math.abs(P.x[k] - x) < 1 && Math.abs(P.y[k] - y) < 1) return P.tier[k];
  return 0;
}

/** Is the enemy in this slot (with this handle) showing a DIM line's body flash at this tick? */
export function tellShowing(st, s, h, tick) {
  return st.tellHandle[s] === h && tick < st.tellUntil[s];
}

/** A lightning bolt down onto (x, y) (a strike's own hit; the oldest goes when full). */
function addBolt(st, x, y, now) {
  const B = st.bolts, k = B.next;
  B.x[k] = x; B.y[k] = y; B.t[k] = now;
  B.next = (k + 1) % MAX_BOLTS;
  if (B.n < MAX_BOLTS) B.n++;
}

function addDying(st, x, y, type, big, face, now) {
  const D = st.dying;
  if (D.n >= MAX_DYING) return;
  const k = D.n++;
  D.x[k] = x; D.y[k] = y; D.t[k] = now; D.type[k] = type; D.big[k] = big; D.face[k] = face;
}

/**
 * Read the events the sim wrote since the last frame.
 * ctx: { now (ms), tick (the world's tick now), feel (tuning.feel), numbersOn, playerX, playerY,
 *   slotOf(handle), alive (enemies alive now, for numberShows), noBolt (a strike weapon's slot that
 *   draws no lightning: the Bog Warden's hands, W2; -1 none) }.
 */
export function consumeEvents(st, ev, ctx) {
  const F = ctx.feel, C = FX_COLOR, now = ctx.now;
  st.numbers.setLimit(Math.min(NUMBERS_CAP, F.numbers.max));
  const busy = st.sparks.count > F.particles.busyAt; // a screen already full of sparks: hits add none
  // The levels paid without a stop in this batch (their LEVEL_UP is quiet).
  let gifts = 0;
  for (let i = 0; i < ev.count && gifts < MAX_GIFTS; i++) if (ev.type[i] === LEVEL_GIFT) st.gifted[gifts++] = ev.c[i] | 0;
  for (let i = 0; i < ev.count; i++) {
    const t = ev.type[i], x = ev.x[i], y = ev.y[i];
    switch (t) {
      case EV.HIT: {
        const h = ev.b[i], s = ctx.slotOf(h);
        if (s >= 0 && s < st.slots) st.hitAt[s] = now;
        const bits = ev.c[i] | 0;
        if ((bits & HIT_CAPPED) !== 0) {
          // The boss's cap ate it: no number, a grey ring (now and then), and the boss's ward.
          addWard(st, h, now);
          if (now - st.cappedRingAt >= WARD_RING_MS) { st.cappedRingAt = now; st.sparks.spawn(x, y, 0, 0, 220, PF_FRAME.RING, C.capped, 0, 0, 0.6); }
          break;
        }
        if ((bits & HIT_QUIET) !== 0) break;   // a ward's or Lantern Night's steady burn: its own flames show it, not a number a pulse
        const amt = ev.a[i];
        st.hitMean = st.hitMean > 0 ? st.hitMean + (amt - st.hitMean) * HIT_MEAN_RATE : amt;
        if (ctx.numbersOn && amt >= F.numbers.minShown && numberShows(amt, (bits & 1) !== 0, ctx.alive ?? 0, st.hitMean, x - ctx.playerX, y - ctx.playerY)) {
          st.numbers.hit(s, h, x, y, amt, bits & 1, now, F.numbers.groupMs);
        }
        if (!busy && F.particles.hit > 0) burst(st, x, y, F.particles.hit, C.spark, 60, 160, PF_FRAME.DOT);
        if ((bits & 2) !== 0 && (ev.d[i] | 0) !== ctx.noBolt) addBolt(st, x, y, now); // a strike's own hit: its bolt (not Bog Hands': their hand rises instead, W2)
        if ((bits & 2) !== 0 && ctx.strikeColor) { const col = ctx.strikeColor(ev.d[i] | 0); if (col >= 0 && !busy) burst(st, x, y, 4, col, 60, 280, PF_FRAME.SPARK); }   // its capstone's sparks (C3)
        break;
      }
      case EV.ZAP: {
        const Z = st.zaps, k = Z.next;
        Z.x[k] = x; Z.y[k] = y; Z.x2[k] = ev.a[i]; Z.y2[k] = ev.b[i]; Z.t[k] = now;
        Z.next = (k + 1) % MAX_ZAPS;
        if (Z.n < MAX_ZAPS) Z.n++;
        break;
      }
      case EV.KILL: {
        const flags = ev.b[i], big = (flags & 2) !== 0 ? 2 : (flags & 1) !== 0 ? 1 : 0;
        // Face the way it last walked (its slot's state, if the slot still holds it).
        const h = ev.d[i], s = ctx.slotOf(h);
        const face = s >= 0 && s < st.slots && st.slotHandle[s] === h ? st.facing[s] : 1;
        addDying(st, x, y, ev.a[i], big, face, now);
        burst(st, x, y, big ? F.particles.bigKill : F.particles.kill, big ? C.spark : C.blood, big ? 120 : 70, big ? 520 : 300, big ? PF_FRAME.SPARK : PF_FRAME.DOT);
        if (big) {
          addLight(st, x, y, 60, 400, C.lamp, now);
          addDecal(st, x, y, 1, now);
        }
        break;
      }
      case EV.PLAYER_HURT:
        st.hurtAt = now;
        if (ctx.numbersOn) st.numbers.hit(-1, -1, ctx.playerX, ctx.playerY - NUMBERS_CLEAR - 4, ev.a[i], 2, now, 0);
        burst(st, ctx.playerX, ctx.playerY, 6, C.hurt, 90, 300, PF_FRAME.SPARK);
        break;
      case EV.GEM:
        if (F.particles.gem > 0) burst(st, x, y, F.particles.gem, C.gem, 50, 260, PF_FRAME.DOT);
        break;
      case EV.LEVEL_UP: {
        let dry = false;
        for (let k = 0; k < gifts; k++) if (st.gifted[k] === (ev.a[i] | 0)) { dry = true; break; }
        if (dry) { burst(st, x, y - 6, 4, C.lamp, 40, 260, PF_FRAME.DOT); break; }   // a glint, no more
        st.levelAt = now;
        burst(st, x, y, F.particles.levelUp, C.lamp, 160, 700, PF_FRAME.SPARK);
        addLight(st, x, y, 140, 600, C.lamp, now);
        break;
      }
      case EV.CHEST:
        burst(st, x, y, F.particles.chest, C.lamp, 120, 600, PF_FRAME.SPARK);
        addLight(st, x, y, 90, 500, C.lamp, now);
        break;
      case EV.SECRET:
        burst(st, x, y, F.particles.boon, C.violet, 160, 800, PF_FRAME.SPARK);
        st.sparks.spawn(x, y, 0, 0, 600, PF_FRAME.RING, C.violet, 0, 0, 6);
        addLight(st, x, y, 160, 900, C.violet, now);
        break;
      case EV.MUSTER:
        st.sparks.spawn(x, y, 0, 0, 500, PF_FRAME.RING, C.warn, 0, 0, 8);
        break;
      case EV.TELEGRAPH: {
        // Hazard pools (CIRCLE) are drawn from the zone itself. The others end a set number of
        // ticks after the tick that wrote them, so a warning freezes with the sim and never
        // outlives its hit.
        st.lastTele = -1;
        if (ev.a[i] === TELE.CIRCLE) break;
        const ticks = Math.max(1, ev.b[i] | 0);
        st.lastTele = addTelegraph(st, ev.a[i], x, y, tickOfEvent(st, i, ctx.tick) + ticks, ticks, ev.c[i], ev.d[i]);
        break;
      }
      case TELE_TIER: {
        // The tier of the TELEGRAPH just before it (W3's contract §1).
        const tier = ev.a[i] | 0, ticks = Math.max(1, ev.c[i] | 0), end = tickOfEvent(st, i, ctx.tick) + ticks;
        if (st.lastTele >= 0 && st.lastTele < st.tele.n) st.tele.tier[st.lastTele] = tier;
        else addPoolTier(st, x, y, end, tier);
        st.lastTele = -1;
        // A DIM tell flashes its enemy's body while it lasts.
        if (tier === TIER.DIM && ev.b[i] >= 0) {
          const s = ctx.slotOf(ev.b[i]);
          if (s >= 0 && s < st.slots) { st.tellHandle[s] = ev.b[i]; st.tellUntil[s] = end; }
        }
        break;
      }
      case EV.DASH:
        for (let k = 0; k < 8; k++) st.sparks.spawn(x - ev.a[i] * k * 4, y - ev.b[i] * k * 4, 0, 0, 220, PF_FRAME.PLUS, C.lamp, 0, 0);
        break;
      case EV.PICKUP:
        burst(st, x, y, ev.a[i] === PICK.CHEST ? 20 : 6, ev.a[i] === PICK.HEAL ? C.heal : C.lamp, 70, 360, PF_FRAME.DOT);
        break;
      case EV.EXPLODE: {
        const boss = ev.b[i] < 0;
        burst(st, x, y, 14, boss ? C.warnHot : C.ember, ev.a[i] * 3, 380, PF_FRAME.SPARK);
        st.sparks.spawn(x, y, 0, 0, 260, PF_FRAME.RING, boss ? C.warnHot : C.spark, 0, 0, ev.a[i] / 3.5);
        addLight(st, x, y, ev.a[i] * 2, 260, boss ? C.warn : C.lamp, now);
        addDecal(st, x, y, 0, now);
        break;
      }
      case EV.LIGHT:
        addLight(st, x, y, ev.a[i], ev.b[i], C.lamp, now);
        break;
      case EV.WAVE:
        st.sparks.spawn(x, y, 0, 0, 500, PF_FRAME.RING, C.cool, 0, 0, (ev.a[i] / 3.5) * 2);
        break;
      case EV.HEAL:
        if (ctx.numbersOn) st.numbers.hit(-1, -1, x, y - NUMBERS_CLEAR - 4, ev.a[i], 3, now, 0);
        burst(st, x, y, 8, C.heal, 50, 400, PF_FRAME.DOT, -30);
        break;
      case EV.REVIVE:
        burst(st, x, y, 60, C.lamp, 200, 800, PF_FRAME.SPARK);
        addLight(st, x, y, 160, 800, C.lamp, now);
        break;
      case FORM_STEP:
        // A step toward a weapon's next Form (W1's contract §2): a small violet glint at you.
        burst(st, x, y - 6, 6, C.violet, 50, 320, PF_FRAME.DOT);
        break;
      case EV.EVOLVE: case EV.RELIC: case EV.RUNE:
        burst(st, x, y, F.particles.boon, C.violet, 140, 700, PF_FRAME.SPARK);
        addLight(st, x, y, 100, 600, C.violet, now);
        break;
      case EV.SHIELD_HIT:
        burst(st, x, y, 6, C.cool, 80, 260, PF_FRAME.SPARK);
        break;
      // The Salt Marsh's (0.8.0).
      case EV.STRIKE: {
        // Lightning is a bolt and a scorch mark (SALT_MARSH.md rule 4), never a sky flash: its bolt,
        // the scorch where it landed, a short light (softer with Reduce flashing), and glass sparks
        // where it left Salt Glass or raised a pillar.
        addBolt(st, x, y, now);
        addDecal(st, x, y, 0, now);
        addLight(st, x, y, ev.a[i] * 2.4, 220, C.lamp, now, ctx.reduced ? 0.35 : 1);
        if (ev.c[i] || ev.d[i]) burst(st, x, y, 10, C.glass, 90, 420, PF_FRAME.SPARK);
        break;
      }
      case EV.PILLAR:
        if (ev.a[i] === 1) burst(st, x, y - 8, 12, C.glass, 70, 500, PF_FRAME.SPARK);
        else burst(st, x, y - 4, 14, C.glass, 50, 600, PF_FRAME.DOT, 80);   // it crumbles
        break;
      case EV.LEAP:
        // A landing throws up mud (more when it sticks), and leaves its mark.
        if (ev.a[i] === 0) {
          burst(st, x, y, ev.c[i] ? 18 : 8, C.mud, ev.c[i] ? 90 : 60, 420, PF_FRAME.DOT, 120);
          if (ev.c[i]) addDecal(st, x, y, 1, now);
        }
        break;
      case EV.WELL:
        if (ev.a[i] === 1) { st.sparks.spawn(x, y, 0, 0, 700, PF_FRAME.RING, C.cool, 0, 0, 5); addLight(st, x, y, 90, 900, C.cool, now); }
        else if (ev.a[i] === 2) { burst(st, x, y, F.particles.boon, C.violet, 120, 700, PF_FRAME.SPARK); addLight(st, x, y, 100, 600, C.violet, now); }
        break;
      case EV.THRALL:
        burst(st, x, y, ev.a[i] === 1 ? 10 : 6, ev.a[i] === 1 ? C.thrall : C.blood, 50, 400, PF_FRAME.DOT, ev.a[i] === 1 ? -40 : 60);
        break;
      case EV.SINK:
        burst(st, x, y, 16, C.mud, ev.a[i] === 1 ? 50 : 110, 500, PF_FRAME.DOT, 140);
        if (ev.a[i] === 0) addLight(st, x, y, 120, 600, C.lamp, now);
        break;
      case EV.SHATTER:
        burst(st, x, y, 6 + (ev.a[i] | 0) * 2, C.ice, 110, 360, PF_FRAME.SPARK);
        break;
      case EV.TAR:
        if (ev.b[i] === 1) { burst(st, x, y, 12, C.ember, ev.a[i] * 3, 360, PF_FRAME.SPARK); addLight(st, x, y, ev.a[i] * 2, 240, C.ember, now); }
        break;
      case EV.HERB:
        burst(st, x, y, 8, C.heal, 50, 400, PF_FRAME.DOT, -30);
        break;
      case EV.RATTLE:
        st.sparks.spawn(x, y, 0, 0, 400, PF_FRAME.RING, C.lamp, 0, 0, 6);
        break;
      default:
        if (t >= 81 && t <= 95) growthEvent(st, ev, i, t, x, y, ctx);
        break;
    }
  }
  st.marks.n = 0;
}

/**
 * The growth core's and the characters' events (C3: codes 81 to 95, work/cw/C1-CONTRACT.md section 9
 * and C2-DESIGN.md section 0). Each has a look of its own on the ground or at you, never a word and
 * never the whole view moving: a Legendary a gold ring and light, a Form's axis a violet glint, a deed
 * done a violet ring, a lantern set down a warm pop, the tide's ebb drawn in toward her, and so on.
 */
function growthEvent(st, ev, i, t, x, y, ctx) {
  const C = FX_COLOR, now = ctx.now, a = ev.a[i], b = ev.b[i];
  switch (t) {
    case EV.DEED:
      // Only the deed done shows (the count moves on the HUD).
      if (ev.d[i] === 1) { st.sparks.spawn(x, y - 6, 0, 0, 700, PF_FRAME.RING, C.violet, 0, 0, 7); burst(st, x, y - 6, 14, C.violet, 90, 600, PF_FRAME.SPARK); addLight(st, x, y, 90, 600, C.violet, now); }
      break;
    case EV.AXIS_OPEN:
      burst(st, x, y - 6, 10, C.violet, 70, 500, PF_FRAME.SPARK);
      break;
    case EV.LEGENDARY:
      st.sparks.spawn(x, y - 6, 0, 0, 900, PF_FRAME.RING, C.gold, 0, 0, 10);
      st.sparks.spawn(x, y - 6, 0, 0, 600, PF_FRAME.RING, C.spark, 0, 0, 5);
      burst(st, x, y - 6, 24, C.gold, 130, 800, PF_FRAME.SPARK, -20);
      addLight(st, x, y, 160, 900, C.gold, now, ctx.reduced ? 0.5 : 1);
      break;
    case EV.UPGRADE:
      if (ev.c[i] === 1) burst(st, x, y - 6, 8, C.violet, 50, 400, PF_FRAME.DOT, -30);   // a Rare or Epic line: a small glint
      break;
    case EV.PLANT:
      st.sparks.spawn(x, y, 0, 0, 380, PF_FRAME.RING, C.ember, 0, 0, 3);
      burst(st, x, y, 8, C.mud, 50, 380, PF_FRAME.DOT, 90);
      break;
    case EV.LOOP: {
      // A Glass Ring closed: glass glints all round the loop, and a ring its size.
      const r = Math.max(8, a), n = 18;
      for (let k = 0; k < n; k++) { const ang = (k / n) * Math.PI * 2; st.sparks.spawn(x + Math.cos(ang) * r, y + Math.sin(ang) * r, 0, -12, 520, PF_FRAME.SPARK, C.glass, 0, 0); }
      st.sparks.spawn(x, y, 0, 0, 420, PF_FRAME.RING, C.glass, 0, 0, r / 3.5);
      break;
    }
    case EV.TIDE: {
      const r = Math.max(16, ev.c[i]);
      if (a === 0) {
        // The ebb: water drawn in toward her from the edge of her reach.
        const n = 20;
        for (let k = 0; k < n; k++) { const ang = (k / n) * Math.PI * 2; st.sparks.spawn(x + Math.cos(ang) * r, y + Math.sin(ang) * r, -Math.cos(ang) * r * 1.6, -Math.sin(ang) * r * 1.6, 560, PF_FRAME.DOT, C.cool, 0, 0); }
      } else if (b === 1) {
        // A flood she called: brighter, a warm ring inside the water's.
        st.sparks.spawn(x, y, 0, 0, 600, PF_FRAME.RING, C.lamp, 0, 0, (r / 3.5) * 1.6);
        addLight(st, x, y, r * 1.6, 500, C.cool, now, ctx.reduced ? 0.5 : 1);
      }
      break;
    }
    case EV.MOMENTUM:
      if (a >= 4) burst(st, x, y + 4, 6, C.ember, 40, 300, PF_FRAME.DOT, 40);   // full: a spray at his feet
      break;
    case EV.SIG_UP:
      burst(st, x, y - 6, 12, C.lamp, 60, 600, PF_FRAME.SPARK, -50);
      addLight(st, x, y, 70, 500, C.lamp, now);
      break;
    case EV.LANTERN:
      st.sparks.spawn(x, y, 0, 0, 500, PF_FRAME.RING, C.lamp, 0, 0, 4);
      burst(st, x, y - 4, 8, C.ember, 40, 500, PF_FRAME.DOT, -40);
      addLight(st, x, y, Math.max(40, a * 2), 400, C.lamp, now);
      break;
    case EV.DIVE:
      burst(st, x, y, 14, C.cool, 70, 500, PF_FRAME.DOT, 120);
      if (a === 1) { st.sparks.spawn(x, y, 0, 0, 700, PF_FRAME.RING, C.gold, 0, 0, 6); addLight(st, x, y, 90, 700, C.lamp, now); }
      break;
    case EV.OIL:
      if (b === 1) burst(st, x, y - 8, 8, C.lamp, 40, 400, PF_FRAME.DOT, -30);
      else if (a === 0) burst(st, x, y - 10, 6, C.blood, 20, 700, PF_FRAME.DOT, -25);   // run down: a little smoke
      break;
    case EV.CALL_DEAD:
      burst(st, x, y, 8, C.thrall, 40, 450, PF_FRAME.DOT, -40);
      break;
    case EV.HAUL: {
      if (a === 1 || a === 3) {
        // Her line, from her to what the hook took (an elite, a mooring post).
        const H = st.hauls, k = H.next;
        H.x[k] = ctx.playerX; H.y[k] = ctx.playerY - 4; H.x2[k] = x; H.y2[k] = y; H.t[k] = now; H.big[k] = 1;
        H.next = (k + 1) % MAX_HAULS; if (H.n < MAX_HAULS) H.n++;
        burst(st, x, y, 10, C.spark, 70, 360, PF_FRAME.SPARK);
      } else if (a === 2) burst(st, x, y, 6, C.lamp, 40, 320, PF_FRAME.DOT);
      break;
    }
    case EV.SKILL:
      burst(st, x, y - 4, 6, C.lamp, 40, 360, PF_FRAME.DOT, -20);
      break;
    default: break;
  }
}

/** Drop warnings whose tick has come (call each frame with the world's tick). */
export function expireTelegraphs(st, tick) {
  const T = st.tele;
  for (let k = T.n - 1; k >= 0; k--) {
    if (tick < T.end[k]) continue;
    const last = --T.n;
    if (k === last) continue;
    T.shape[k] = T.shape[last]; T.x[k] = T.x[last]; T.y[k] = T.y[last]; T.size[k] = T.size[last];
    T.ang[k] = T.ang[last]; T.end[k] = T.end[last]; T.total[k] = T.total[last]; T.tier[k] = T.tier[last];
  }
  const P = st.poolTier;
  for (let k = P.n - 1; k >= 0; k--) {
    if (tick <= P.end[k]) continue;
    const last = --P.n;
    if (k !== last) { P.x[k] = P.x[last]; P.y[k] = P.y[last]; P.end[k] = P.end[last]; P.tier[k] = P.tier[last]; }
    if (P.next > P.n) P.next = 0;
  }
}

/** Drop dying enemies whose pop is over. */
export function expireDying(st, now, deathMs, bigMul) {
  const D = st.dying;
  for (let k = D.n - 1; k >= 0; k--) {
    if (now - D.t[k] < deathMs * (D.big[k] ? bigMul : 1)) continue;
    const last = --D.n;
    if (k === last) continue;
    D.x[k] = D.x[last]; D.y[k] = D.y[last]; D.t[k] = D.t[last]; D.type[k] = D.type[last]; D.big[k] = D.big[last]; D.face[k] = D.face[last];
  }
}

/** Drop flash lights that have faded. */
export function expireLights(st, now) {
  const L = st.lights;
  for (let k = L.n - 1; k >= 0; k--) {
    if (now - L.t[k] < L.ms[k]) continue;
    const last = --L.n;
    if (k !== last) { L.x[k] = L.x[last]; L.y[k] = L.y[last]; L.r[k] = L.r[last]; L.t[k] = L.t[last]; L.ms[k] = L.ms[last]; L.col[k] = L.col[last]; }
    if (L.next > L.n) L.next = 0;
  }
}

/** 0..1 strengths of the red edge (hurt) and the warm wash (level-up); softer with flash reduction. */
export function screenFlash(st, now, flashFeel, reduced, out) {
  const cap = reduced ? 0.35 : 1;
  out.hurt = Math.max(0, 1 - (now - st.hurtAt) / flashFeel.playerHurtMs) * cap;
  out.level = Math.max(0, 1 - (now - st.levelAt) / flashFeel.levelUpMs) * cap;
  return out;
}

/** How an enemy is tinted this frame (pure, so the gate can check it). */
export const LOOK = Object.freeze({ PLAIN: 0, WARN: 1, FROZEN: 2, BURN: 3, SLOW: 4, ROT: 5, DAZED: 6, TAR: 7, SALT: 8 });

/**
 * An enemy about to act (a charger winding up, a gunner aiming) pulses warm; otherwise the
 * strongest status shows: dazed (untinted, so it keeps its contrast; it wobbles instead, see
 * dazeWobble), turned to salt (the view draws its pale silhouette), frozen, burning (flickering),
 * tarred (a dull grey sheen, never darker than rot's tint, so it keeps its contrast), slowed, rotting. `now` is in milliseconds (the run
 * view passes sim time, so the flicker holds while the sim does); `pulse` is 0..1.
 */
export function enemyLook(E, i, now, pulse, isWarned) {
  if (isWarned(E, i)) return pulse > 0.5 ? LOOK.WARN : LOOK.PLAIN;
  if (E.dazeT[i] > 0) return LOOK.DAZED;
  if (E.saltT !== undefined && E.saltT[i] > 0) return LOOK.SALT;
  if (E.freezeT[i] > 0) return LOOK.FROZEN;
  if (E.burnT[i] > 0) return ((now / 90) | 0) % 2 === 0 ? LOOK.BURN : LOOK.PLAIN;
  if (E.tarT !== undefined && E.tarT[i] > 0) return LOOK.TAR;
  if (E.slowT[i] > 0) return LOOK.SLOW;
  if (E.rotT[i] > 0) return LOOK.ROT;
  return LOOK.PLAIN;
}

/** Tint colors for each LOOK (0xrrggbb; PLAIN is white). */
export const LOOK_COLOR = Object.freeze([0xffffff, pal('rot-4'), pal('gem-4'), pal('lamp-5'), pal('sea-6'), pal('moss-4'), 0xffffff, pal('fog-4'), pal('fog-3')]);

// ---------------------------------------------------------------- procedural animation (§6.4)
// These run on sim time (the world's tick), not the render clock, so everything stands still
// while the sim does: under a level-up, a chest, the pause menu, and a hit-stop.

/** Seconds of sim time. */
export function simSeconds(world) {
  return world.tick / TPS;
}

/**
 * Which of an enemy's `n` animation frames shows: `fps` frames a second, each enemy starting at
 * its own point (`phase`, 0..1) so a crowd never flaps in step. A held enemy (frozen, dazed)
 * stops on one frame, its own by its phase (it may step to it as the hold starts).
 */
export function animFrameIndex(n, fps, simSec, phase, held = false) {
  if (!(n > 1)) return 0;
  const t = held ? 0 : simSec * fps;
  return ((t + phase * n) | 0) % n;
}

/** The player's walking hop: up a pixel every other step while she moves, nothing while she stands. */
export function stepHop(moving, simSec, stepsPerSec) {
  return moving ? ((simSec * stepsPerSec) | 0) % 2 : 0;
}

/**
 * A well-mixed hash of a tile's position, so the floor's variants never fall into a pattern
 * (the first version multiplied and XORed the coordinates, and since both factors were odd its
 * low bits repeated every 4 tiles: the whole map was one 4 x 4 block).
 */
export function tileHash(tx, ty) {
  let h = Math.imul(tx, 374761393) + Math.imul(ty, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Floor tile variants by weight: plain boards half the time, a board end or wear the rest. */
export const FLOOR_PICK = Object.freeze([0, 0, 0, 1, 2, 3]);

/** Which floor variant (0 to 3) goes at a tile: the run view and the title's yard both use this. */
export function floorVariant(tx, ty) {
  return FLOOR_PICK[(tileHash(tx, ty) >>> 4) % FLOOR_PICK.length];
}

/** Which obstacle variant goes at a blocked tile, out of `n`. */
export function blockVariant(tx, ty, n) {
  return tileHash(tx, ty) % n;
}

/**
 * The atlas frame for a tile of the run map. A map without kinds (a plain crate scatter) is
 * boards and crates; the docks pick by kind, and by the neighbors where it shows: water under
 * the wharf shows the quay's lip on its sides, a bridge's row over open water its rail.
 */
export function groundFrame(tr, tx, ty) {
  const K = tr.kinds;
  if (K === null) return tr.blocked(tx, ty) ? `tile_block_${blockVariant(tx, ty, 3)}` : `tile_floor_${floorVariant(tx, ty)}`;
  const C = tr.cols, i = ty * C + tx;
  // A neighbor's kind, or -1 off the map.
  const up = ty > 0 ? K[i - C] : -1, down = ty + 1 < tr.rows ? K[i + C] : -1;
  const h = tileHash(tx, ty);
  switch (K[i]) {
    case GROUND.CRATE: return `tile_block_${blockVariant(tx, ty, 3)}`;
    case GROUND.WATER: {
      // The wharf's sides it meets: north (the quay's lip and shadow), west, and east. A slip is
      // at least 2 tiles wide (checkDocks), so a tile never meets both sides.
      const w = tx > 0 ? K[i - 1] : -1, e = tx + 1 < C ? K[i + 1] : -1;
      const edges = (up !== GROUND.WATER && up !== -1 ? 'n' : '') + (w !== GROUND.WATER && w !== -1 ? 'w' : '') + (e !== GROUND.WATER && e !== -1 ? 'e' : '');
      return edges ? `tile_water_${edges}` : `tile_water_${h % 2}`;
    }
    case GROUND.BRIDGE:
      if (up === GROUND.WATER) return 'tile_bridge_n';
      if (down === GROUND.WATER) return 'tile_bridge_s';
      return 'tile_bridge_0';
    case GROUND.SHED_ROOF: return `tile_roof_${(h >>> 3) % 5 === 0 ? 1 : 0}`;
    case GROUND.SHED_WALL: return 'tile_shed_wall_0';
    case GROUND.SHED_DOOR: return 'tile_shed_wall_1';
    case GROUND.WRECK: return `tile_hull_${(h >>> 2) % 3 === 0 ? 1 : 0}`;
    case GROUND.DECK: return `tile_deck_${(h >>> 6) % 4 === 0 ? 1 : 0}`;
    default:
      if (K[i] >= GROUND.SALT) return marshFrame(tr, tx, ty, i, h);
      return `tile_floor_${floorVariant(tx, ty)}`;
  }
}

/** Is tile i water now (a wet tile, or deep water)? Off the map counts as not water. */
function isWater(tr, i) {
  return tr.wet[i] === 1 || tr.kinds[i] === GROUND.DEEP;
}

/**
 * The Salt Marsh's tiles (kinds 9 to 17, sim/terrain.js GROUND). A tile under the water now
 * (terrain.wet) draws as water, with a bank on each side whose neighbor is dry; deep water the
 * same, darker. The creek mud's ripples run across the creek's flow: whichever way more mud runs
 * through the tile (seven tiles each way) is the creek's. A boardwalk's boards lie along the creek
 * (across the way you cross it); the landing's boards run north to south, their ends lit where
 * they stop over the deep pool or above the flats.
 */
function marshFrame(tr, tx, ty, i, h) {
  const K = tr.kinds, C = tr.cols, k = K[i];
  if (isWater(tr, i)) {
    let banks = 0;
    if (ty > 0 && !isWater(tr, i - C)) banks |= 1;
    if (tx + 1 < C && !isWater(tr, i + 1)) banks |= 2;
    if (ty + 1 < tr.rows && !isWater(tr, i + C)) banks |= 4;
    if (tx > 0 && !isWater(tr, i - 1)) banks |= 8;
    return k === GROUND.DEEP ? `tile_m_deep_${banks}` : `tile_m_water_${(h >>> 5) & 3}_${banks}`;
  }
  switch (k) {
    case GROUND.SALT: return `tile_m_salt_${(h >>> 7) % 4}`;
    case GROUND.REEDS: return `tile_m_reeds_${(h >>> 7) % 4}`;
    case GROUND.MUD: {
      const v = (h >>> 9) % 16, pick = v === 14 ? 3 : v === 15 ? 4 : v % 3;   // a heron's print one tile in eight
      return `tile_m_mud_${creekRuns(tr, tx, ty) === 'h' ? 'v' : 'h'}_${pick}`;
    }
    case GROUND.PEAT: return `tile_m_peat_${(h >>> 4) % 3}`;
    case GROUND.STUMP: {
      // On the island's peat if it stands among peat, else on the salt.
      const peat = (tx > 0 && K[i - 1] === GROUND.PEAT) || (tx + 1 < C && K[i + 1] === GROUND.PEAT);
      return `tile_m_stump_${peat ? 1 : 0}`;
    }
    case GROUND.CAUSEWAY: return `tile_m_causeway_${(h >>> 3) & 1}`;
    case GROUND.BOARDWALK: return `tile_m_boardwalk_${creekRuns(tr, tx, ty) === 'h' ? 'h' : 'v'}`;
    case GROUND.LANDING: {
      if (tx + 1 < C && K[i + 1] !== GROUND.LANDING) return 'tile_m_landing_e';
      if (ty + 1 < tr.rows && K[i + C] !== GROUND.LANDING) return 'tile_m_landing_s';
      return 'tile_m_landing_0';
    }
    default: return `tile_m_salt_${(h >>> 7) % 4}`;
  }
}

/** Which way the creek at a tile runs: 'h' (east to west) or 'v' (north to south), by the mud or boards each way. */
function creekRuns(tr, tx, ty) {
  const K = tr.kinds, C = tr.cols, R = tr.rows;
  const creek = (k) => k === GROUND.MUD || k === GROUND.BOARDWALK;
  let across = 0, down = 0;
  for (let d = -3; d <= 3; d++) {
    if (tx + d >= 0 && tx + d < C && creek(K[ty * C + tx + d])) across++;
    if (ty + d >= 0 && ty + d < R && creek(K[(ty + d) * C + tx])) down++;
  }
  // A boardwalk runs across its creek, so for one the boards' own run decides the other way.
  if (K[ty * C + tx] === GROUND.BOARDWALK) {
    let bh = 0, bv = 0;
    for (let d = -3; d <= 3; d++) {
      if (tx + d >= 0 && tx + d < C && K[ty * C + tx + d] === GROUND.MUD) bh++;
      if (ty + d >= 0 && ty + d < R && K[(ty + d) * C + tx] === GROUND.MUD) bv++;
    }
    return bh >= bv ? 'h' : 'v';
  }
  return across >= down ? 'h' : 'v';
}

/** Every frame groundFrame can name (the gate checks each is on the atlas page). */
export const GROUND_FRAMES = Object.freeze([
  'tile_floor_0', 'tile_floor_1', 'tile_floor_2', 'tile_floor_3', 'tile_block_0', 'tile_block_1', 'tile_block_2',
  'tile_water_0', 'tile_water_1', 'tile_water_n', 'tile_water_w', 'tile_water_e', 'tile_water_nw', 'tile_water_ne',
  'tile_bridge_0', 'tile_bridge_n', 'tile_bridge_s', 'tile_roof_0', 'tile_roof_1', 'tile_shed_wall_0', 'tile_shed_wall_1',
  'tile_hull_0', 'tile_hull_1', 'tile_deck_0', 'tile_deck_1',
  // The Salt Marsh's (marshFrame).
  ...[0, 1, 2, 3].map((v) => `tile_m_salt_${v}`), ...['h', 'v'].flatMap((d) => [0, 1, 2, 3, 4].map((v) => `tile_m_mud_${d}_${v}`)),
  ...[0, 1, 2, 3].map((v) => `tile_m_reeds_${v}`), 'tile_m_peat_0', 'tile_m_peat_1', 'tile_m_peat_2', 'tile_m_stump_0', 'tile_m_stump_1',
  'tile_m_causeway_0', 'tile_m_causeway_1', 'tile_m_boardwalk_h', 'tile_m_boardwalk_v', 'tile_m_landing_0', 'tile_m_landing_e', 'tile_m_landing_s',
  ...[0, 1, 2, 3].flatMap((v) => Array.from({ length: 16 }, (_, b) => `tile_m_water_${v}_${b}`)), ...Array.from({ length: 16 }, (_, b) => `tile_m_deep_${b}`),
]);
/** The Marsh's ground you walk on (kept as low in contrast as the boards, tests/art.test.js). */
export const WALK_FRAME = /^tile_(floor|bridge|deck|m_(salt|mud|reeds|peat|causeway|boardwalk|landing))_/;

/** A dazed enemy's wobble, radians: a quick sway (it's reeling), each at its own phase. */
export function dazeWobble(simSec, phase) {
  return 0.3 * Math.sin(simSec * 19 + phase * 6.283185307179586);
}
