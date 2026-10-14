// What the run view remembers between frames, and how events change it (pure; tested in Node).
//
// The sim's event buffer says what happened; this turns that into things to draw for a while:
// sparks, the pop of a dying enemy, damage numbers, warning shapes, short-lived lights, scorch
// marks, screen shake, and the squash of a hit enemy. render/runview.js draws from it. Keeping
// this out of the Pixi code lets the gate check it.
//
// Per-enemy state (facing, when it was last hit, when it appeared) is kept per pool slot id, and
// a slot is known to hold a new enemy when its handle changes. Nothing here allocates per frame.

import { EV, TELE, PICK } from '../sim/events.js';
import { TPS } from '../sim/constants.js';
import { color as pal } from '../data/palette.js';
import { createShake, createNumbers, createParticles } from './feel.js';

export const MAX_TELEGRAPHS = 96;
export const MAX_DYING = 512;
export const MAX_DECALS = 192;
export const MAX_LIGHTS = 96;
export const NUMBERS_CAP = 400;   // the most tuning.feel.numbers.max can ask for
export const MAX_TICK_MARKS = 32; // sim ticks read in one rendered frame (the loop runs at most 5)

/** Particle frames, by index (runview maps them to atlas frames). */
export const PF_FRAME = Object.freeze({ DOT: 0, SPARK: 1, PLUS: 2, DISC: 3, RING: 4 });

/** Colors the effects use (0xrrggbb). */
export const FX_COLOR = Object.freeze({
  spark: pal('lamp-6'), ember: pal('lamp-4'), gem: pal('gem-3'), blood: pal('fog-2'), heal: pal('moss-4'),
  hurt: pal('rot-4'), warn: pal('rot-3'), warnHot: pal('rot-4'), lamp: pal('lamp-5'), cool: pal('sea-6'), violet: pal('violet-4'),
});

export function createViewState({ slots = 4096, rand = Math.random } = {}) {
  const st = {
    slots, rand,
    slotHandle: new Int32Array(slots).fill(-2),
    facing: new Int8Array(slots).fill(1),
    hitAt: new Float64Array(slots).fill(-1e9),
    bornAt: new Float64Array(slots).fill(-1e9),
    sparks: createParticles(4096),
    numbers: createNumbers(NUMBERS_CAP, slots),
    shake: createShake(),
    dying: { n: 0, x: new Float32Array(MAX_DYING), y: new Float32Array(MAX_DYING), t: new Float64Array(MAX_DYING), type: new Uint16Array(MAX_DYING), big: new Uint8Array(MAX_DYING), face: new Int8Array(MAX_DYING) },
    decals: { n: 0, next: 0, x: new Float32Array(MAX_DECALS), y: new Float32Array(MAX_DECALS), t: new Float64Array(MAX_DECALS), size: new Uint8Array(MAX_DECALS) },
    tele: { n: 0, shape: new Uint8Array(MAX_TELEGRAPHS), x: new Float32Array(MAX_TELEGRAPHS), y: new Float32Array(MAX_TELEGRAPHS), size: new Float32Array(MAX_TELEGRAPHS), ang: new Float32Array(MAX_TELEGRAPHS), end: new Int32Array(MAX_TELEGRAPHS), total: new Int32Array(MAX_TELEGRAPHS) },
    lights: { n: 0, next: 0, x: new Float32Array(MAX_LIGHTS), y: new Float32Array(MAX_LIGHTS), r: new Float32Array(MAX_LIGHTS), t: new Float64Array(MAX_LIGHTS), ms: new Float32Array(MAX_LIGHTS), col: new Uint32Array(MAX_LIGHTS) },
    // Which sim tick wrote which events: the run scene marks the buffer's end after each tick.
    marks: { n: 0, end: new Int32Array(MAX_TICK_MARKS), tick: new Int32Array(MAX_TICK_MARKS) },
    hurtAt: -1e9,
    levelAt: -1e9,
  };
  return st;
}

/** Forget everything (a new run). */
export function resetViewState(st) {
  st.slotHandle.fill(-2); st.facing.fill(1); st.hitAt.fill(-1e9); st.bornAt.fill(-1e9);
  st.sparks.clear(); st.numbers.clear(); st.shake.reset();
  st.dying.n = 0; st.decals.n = 0; st.decals.next = 0; st.tele.n = 0; st.lights.n = 0; st.lights.next = 0; st.marks.n = 0;
  st.hurtAt = -1e9; st.levelAt = -1e9;
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

export function addLight(st, x, y, r, ms, rgb, now) {
  const L = st.lights;
  let i;
  if (L.n < MAX_LIGHTS) i = L.n++;
  else { i = L.next; L.next = (L.next + 1) % MAX_LIGHTS; } // full: replace the oldest-placed
  L.x[i] = x; L.y[i] = y; L.r[i] = r; L.t[i] = now; L.ms[i] = ms; L.col[i] = rgb;
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
  if (T.n >= MAX_TELEGRAPHS) return;
  const i = T.n++;
  T.shape[i] = shape; T.x[i] = x; T.y[i] = y; T.size[i] = size; T.ang[i] = ang;
  T.total[i] = total; T.end[i] = endTick;
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
 *   slotOf(handle) }.
 */
export function consumeEvents(st, ev, ctx) {
  const F = ctx.feel, C = FX_COLOR, now = ctx.now;
  st.numbers.setLimit(Math.min(NUMBERS_CAP, F.numbers.max));
  const busy = st.sparks.count > F.particles.busyAt; // a screen already full of sparks: hits add none
  for (let i = 0; i < ev.count; i++) {
    const t = ev.type[i], x = ev.x[i], y = ev.y[i];
    switch (t) {
      case EV.HIT: {
        const h = ev.b[i], s = ctx.slotOf(h);
        if (s >= 0 && s < st.slots) st.hitAt[s] = now;
        if (ctx.numbersOn && ev.a[i] >= F.numbers.minShown) st.numbers.hit(s, h, x, y, ev.a[i], ev.c[i] === 1 ? 1 : 0, now, F.numbers.groupMs);
        if (!busy && F.particles.hit > 0) burst(st, x, y, F.particles.hit, C.spark, 60, 160, PF_FRAME.DOT);
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
          st.shake.add(big === 2 ? F.shake.bossKill : F.shake.eliteKill);
        }
        break;
      }
      case EV.PLAYER_HURT:
        st.shake.add(F.shake.playerHurt);
        st.hurtAt = now;
        if (ctx.numbersOn) st.numbers.hit(-1, -1, ctx.playerX, ctx.playerY - 10, ev.a[i], 2, now, 0);
        burst(st, ctx.playerX, ctx.playerY, 6, C.hurt, 90, 300, PF_FRAME.SPARK);
        break;
      case EV.GEM:
        if (F.particles.gem > 0) burst(st, x, y, F.particles.gem, C.gem, 50, 260, PF_FRAME.DOT);
        break;
      case EV.LEVEL_UP:
        st.levelAt = now;
        burst(st, x, y, F.particles.levelUp, C.lamp, 160, 700, PF_FRAME.SPARK);
        addLight(st, x, y, 140, 600, C.lamp, now);
        break;
      case EV.CHEST:
        burst(st, x, y, F.particles.chest, C.lamp, 120, 600, PF_FRAME.SPARK);
        addLight(st, x, y, 90, 500, C.lamp, now);
        break;
      case EV.BOSS_SPAWN:
        st.shake.add(F.shake.bossSpawn);
        break;
      case EV.TELEGRAPH: {
        // Hazard pools (CIRCLE) are drawn from the zone itself. The others end a set number of
        // ticks after the tick that wrote them, so a warning freezes with the sim and never
        // outlives its hit.
        if (ev.a[i] === TELE.CIRCLE) break;
        const ticks = Math.max(1, ev.b[i] | 0);
        addTelegraph(st, ev.a[i], x, y, tickOfEvent(st, i, ctx.tick) + ticks, ticks, ev.c[i], ev.d[i]);
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
        st.shake.add(boss ? F.shake.bossSlam : F.shake.explode);
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
        st.shake.add(F.shake.explode * 2);
        break;
      case EV.HEAL:
        if (ctx.numbersOn) st.numbers.hit(-1, -1, x, y - 10, ev.a[i], 3, now, 0);
        burst(st, x, y, 8, C.heal, 50, 400, PF_FRAME.DOT, -30);
        break;
      case EV.REVIVE:
        burst(st, x, y, 60, C.lamp, 200, 800, PF_FRAME.SPARK);
        addLight(st, x, y, 160, 800, C.lamp, now);
        st.shake.add(0.5);
        break;
      case EV.EVOLVE: case EV.RELIC: case EV.RUNE:
        burst(st, x, y, F.particles.boon, C.violet, 140, 700, PF_FRAME.SPARK);
        addLight(st, x, y, 100, 600, C.violet, now);
        break;
      case EV.SHIELD_HIT:
        burst(st, x, y, 6, C.cool, 80, 260, PF_FRAME.SPARK);
        break;
      default: break;
    }
  }
  st.marks.n = 0;
}

/** Drop warnings whose tick has come (call each frame with the world's tick). */
export function expireTelegraphs(st, tick) {
  const T = st.tele;
  for (let k = T.n - 1; k >= 0; k--) {
    if (tick < T.end[k]) continue;
    const last = --T.n;
    if (k === last) continue;
    T.shape[k] = T.shape[last]; T.x[k] = T.x[last]; T.y[k] = T.y[last]; T.size[k] = T.size[last];
    T.ang[k] = T.ang[last]; T.end[k] = T.end[last]; T.total[k] = T.total[last];
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
export const LOOK = Object.freeze({ PLAIN: 0, WARN: 1, FROZEN: 2, BURN: 3, SLOW: 4, ROT: 5, DAZED: 6 });

/**
 * An enemy about to act (a charger winding up, a gunner aiming) pulses warm; otherwise the
 * strongest status shows: dazed (untinted, so it keeps its contrast; it wobbles instead, see
 * dazeWobble), frozen, burning (flickering), slowed, rotting. `now` is in milliseconds (the run
 * view passes sim time, so the flicker holds while the sim does); `pulse` is 0..1.
 */
export function enemyLook(E, i, now, pulse, isWarned) {
  if (isWarned(E, i)) return pulse > 0.5 ? LOOK.WARN : LOOK.PLAIN;
  if (E.dazeT[i] > 0) return LOOK.DAZED;
  if (E.freezeT[i] > 0) return LOOK.FROZEN;
  if (E.burnT[i] > 0) return ((now / 90) | 0) % 2 === 0 ? LOOK.BURN : LOOK.PLAIN;
  if (E.slowT[i] > 0) return LOOK.SLOW;
  if (E.rotT[i] > 0) return LOOK.ROT;
  return LOOK.PLAIN;
}

/** Tint colors for each LOOK (0xrrggbb; PLAIN is white). */
export const LOOK_COLOR = Object.freeze([0xffffff, pal('rot-4'), pal('gem-4'), pal('lamp-5'), pal('sea-6'), pal('moss-4'), 0xffffff]);

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

/** A dazed enemy's wobble, radians: a quick sway (it's reeling), each at its own phase. */
export function dazeWobble(simSec, phase) {
  return 0.3 * Math.sin(simSec * 19 + phase * 6.283185307179586);
}
