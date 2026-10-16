// The weapon pipeline (ARCHITECTURE §5.8): emitter -> motion -> on-hit list.
//
// A weapon slot compiles its definition plus its runes into: an emitter (where and how it
// fires), a motion (how its shots move), an on-hit list (what happens on contact), and final
// stats (stats.js). Runes are patches on that composition, so they change behavior, not
// numbers. Nothing is ever aimed by the player: `nearest` and `strike` target automatically.
//
// Shots live in the projectile pool, lasting effects (auras, waves, beams, burning ground,
// enemy hazards) in the zone pool. Shots, the player's and the enemies' alike, fly over
// obstacles (crates and rubble are low, and in this genre weapons ignore terrain); only bodies
// collide with walls. Hit control: a slot with a hit cooldown can hit a given
// enemy again only after that cooldown (per enemy, per slot: auras, orbits, zones); a slot
// without one relies on each shot remembering the last 4 enemies it hit (piercing shots).

import { DT, TPS, EF, PF, MOTION, EMIT, FX, ZONE, ZF, HIT_SLOTS, RELIC_SLOT, HIT_RING, PARENT_ONLY_FX } from './constants.js';
import { NO_HANDLE } from './pools.js';
import { EV } from './events.js';
import { computeWeaponStats } from './stats.js';
import { damageEnemyR, impulseR, applyStatus } from './enemies.js';
import { hurtPlayer } from './player.js';
import { runHooks } from './hooks.js';
import { sincosInto, fcos, fatan2, TAU, PI } from '../lib/fmath.js';
import {
  buildForms, formStats, createFormState, formsTick, formsAfterVolley, crowdTarget, plantRod, stokePyre,
  eclipseScale, formsMove, skewerCatch, focusBurn, hangFlare, markEnemy, clusterFlasks, marchStrike, fuelLink,
  shotEnded, hasShotForm, hasKillForm, zoneGone, markTick,
} from './forms.js';

export const PROJ_FIELDS = {
  x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array, vx: Float32Array, vy: Float32Array,
  life: Float32Array, age: Float32Array,
  slot: Uint8Array, flags: Uint8Array,
  damage: Float32Array, radius: Float32Array, pierce: Int16Array, knockback: Float32Array,
  motion: Uint8Array, m0: Float32Array, m1: Float32Array, m2: Float32Array, m3: Float32Array,
  target: Int32Array,
  hits: [Int32Array, HIT_RING], hitPos: Uint8Array,
  list: Uint16Array,
  hops: Int8Array,
  def: Uint16Array,     // weapon definition index (render picks the sprite), 0xffff for enemy shots
  carry: Int32Array,    // Skewer: the enemy this shot carries (a handle; NO_HANDLE none)
  scale: Uint8Array,    // drawn this many times its size (0 or 1: as it is; an Eclipse orb grows)
};

export const ZONE_FIELDS = {
  x: Float32Array, y: Float32Array, radius: Float32Array, maxRadius: Float32Array,
  life: Float32Array, age: Float32Array, warn: Float32Array,
  kind: Uint8Array, slot: Uint8Array, list: Uint16Array,
  damage: Float32Array, knockback: Float32Array, thickness: Float32Array,
  dx: Float32Array, dy: Float32Array, length: Float32Array,
  interval: Int32Array,  // ground zones and marks: ticks between damage pulses
  nextTick: Int32Array,  // ground zones and marks: tick of the next pulse; hazards: tick the player can be hurt again
  def: Uint16Array,
  target: Int32Array,    // a tether's or a mark's enemy (a handle)
  flags: Uint8Array,     // ZF: a wave rolling inward, a beam sweeping
  style: Uint8Array,     // ground: ZSTYLE (how it looks); mark: MARKS (what it does)
  ang: Float32Array,     // a sweeping beam's starting angle
};

const EFFECT_TYPES = Object.keys(FX);
const EMIT_TYPES = Object.keys(EMIT);
const MOTION_TYPES = Object.keys(MOTION);

// ---------------------------------------------------------------- compiling a slot

/**
 * Compile an on-hit list into the world's list table and return its index. The same list
 * compiles to the same index (slots are rebuilt on every level-up, so without this the table
 * would grow all run); compiled lists are never changed after this.
 */
/** Zone effects one on-hit list may hold, each throttled on its own (`every`). */
export const ZONE_PACES = 4;

export function compileList(world, effects) {
  const key = JSON.stringify(effects);
  const known = world.fxListIndex.get(key);
  if (known !== undefined) return known;
  const out = [];
  for (const e of effects) {
    const t = FX[e.type];
    if (t === undefined) throw new Error(`Unknown on-hit effect "${e.type}" (known: ${EFFECT_TYPES.join(', ')})`);
    const c = { ...e, t };
    if (t === FX.zone) {
      // Each zone effect in a list keeps its own pace (a weapon's own pool and a rune's).
      c.zoneSlot = out.filter((x) => x.t === FX.zone).length;
      if (c.zoneSlot >= ZONE_PACES) throw new Error(`An on-hit list can leave at most ${ZONE_PACES} kinds of ground`);
      const sub = [{ type: 'damage' }];
      if (e.status) sub.push({ type: 'status', ...e.status });
      c.zoneList = compileList(world, sub);
    }
    out.push(c);
  }
  if (world.fxLists.length >= 0xffff) throw new Error('Too many different on-hit lists in one run');
  world.fxLists.push(out);
  world.fxListIndex.set(key, world.fxLists.length - 1);
  return world.fxLists.length - 1;
}

/** Is a rune valid on this emitter type? (A rune without validOn fits anything.) */
function validOnEmit(rune, emitType) {
  return !rune.validOn || !rune.validOn.emit || rune.validOn.emit.includes(emitType);
}

/** Which runes can go on a weapon with no runes yet (by its own emitter). */
export function runeValidOn(rune, def) {
  return validOnEmit(rune, def.pipeline.emit.type);
}

/** The emitters that fire along a line (fireAlong), so firing backward too means something there. */
export const MIRRORED_EMITS = Object.freeze(['nearest', 'facing', 'radial']);

/**
 * Does every part of Form `a` work on a weapon its runes have shaped so (runeShape)? A Form's
 * `needs` names a motion the weapon must have, or must not have: a Skewer needs a harpoon that
 * flies straight, a Firebomb a flask that's lobbed, a Mortar or a Salvo shots that aren't
 * circling you (an Orbiting rune).
 */
export function ascensionWorks(a, shape) {
  const n = a.needs;
  if (!n) return true;
  if (n.motion && !n.motion.includes(shape.motion)) return false;
  if (n.notMotion && n.notMotion.includes(shape.motion)) return false;
  return true;
}

/** What a weapon's runes make of it: { emit, motion (their types), mirrored }. */
export function runeShape(def, runes) {
  let emit = def.pipeline.emit.type, motion = def.pipeline.motion.type, mirrored = false;
  for (const r of runes) {
    if (!r) continue;
    if (r.patch.emit) emit = r.patch.emit.type;
    if (r.patch.motion) motion = r.patch.motion.type;
    if (r.patch.mirror) mirrored = true;
  }
  return { emit, motion, mirrored };
}

/**
 * Can this rune join the runes already socketed in a weapon (and its Forms)? It must fit the
 * emitter those runes have given the weapon (Orbiting turns a Flare Gun into an orbit, so Backfire
 * no longer fits), if it changes the emitter itself every rune already there must still fit the
 * new one, and every Form taken must still work after it (no Orbiting under a Skewer or a
 * Mortar). So a weapon never holds a rune that does nothing, nor loses what an Ember bought.
 */
export function runeFits(rune, def, socketed, ascensions = []) {
  // One copy of a rune per weapon: a second Backfire or Burning Ground would add nothing.
  for (const r of socketed) if (r && r.id === rune.id) return false;
  const before = runeShape(def, socketed);
  if (!validOnEmit(rune, before.emit)) return false;
  if (rune.patch.emit) for (const r of socketed) if (r && !validOnEmit(r, rune.patch.emit.type)) return false;
  if (ascensions.length) {
    const after = runeShape(def, [...socketed, rune]);
    for (const a of ascensions) if (!ascensionWorks(a, after)) return false;
  }
  return true;
}

// How a Form's on-hit numbers join an effect of the same kind the weapon's own pipeline already
// has (Great Toll's freeze on a bell that freezes, Relay on a weapon that chains). Runes come after
// Forms and add their own effects beside these: Relay and a Chain Link rune are two chains.
// The rules:
// amounts add (more hops, longer, harder); reaches take the larger; a per-hop multiplier is never
// added (a chain's hops would grow stronger than the hit); a slow never reaches a standstill.
// Every number an on-hit effect has is listed: a new one must be given its rule (an unlisted one
// throws, so a future reach or rate never adds by mistake).
const MERGE = Object.freeze({
  hops: 'add', duration: 'add', dps: 'add', damage: 'add', amp: 'add', strength: 'add', count: 'add', pct: 'add',
  radius: 'max', range: 'max', interval: 'keep', every: 'keep', ms: 'keep', spread: 'keep',
});
const MAX_SLOW = 0.8;

/**
 * Add a Form's on-hit effect to a list: onto the list's own effect of that type (a status:
 * of that status), its numbers joined by MERGE; or, with none, appended as a new one.
 */
export function addEffect(list, e) {
  const same = list.find((x) => x.type === e.type && (e.type !== 'status' || x.status === e.status));
  if (!same) { list.push(JSON.parse(JSON.stringify(e))); return; }
  for (const [k, v] of Object.entries(e)) {
    if (typeof v !== 'number') continue;
    const rule = k === 'damageMul' ? (e.type === 'chain' ? 'max' : 'add') : MERGE[k];
    if (!rule) throw new Error(`addEffect: no rule for joining "${k}" (${e.type}); give it one in MERGE`);
    if (rule === 'add') same[k] = (same[k] ?? 0) + v;
    else if (rule === 'max') same[k] = Math.max(same[k] ?? 0, v);
    else same[k] ??= v;
  }
  if (same.type === 'status' && same.status === 'slow') same.pct = Math.min(same.pct, MAX_SLOW);
}

/**
 * Build a weapon slot from a definition, level, and runes. The emitter, motion, and on-hit list
 * come from the definition, patched by each rune in socket order.
 */
export function buildSlot(world, index, def, level, runes, prev = null) {
  // Forms first (data/ascensions.js, sim/forms.js: an Ember's changes, kept through rebuilds and
  // an evolution), then the runes.
  const ascensions = prev && prev.ascensions ? prev.ascensions : [];
  const pipe = { emit: { ...def.pipeline.emit }, motion: { ...def.pipeline.motion }, onHit: def.pipeline.onHit.map((e) => ({ ...e })) };
  const fx = buildForms(pipe, ascensions);
  let emit = pipe.emit, motion = pipe.motion;
  const onHit = pipe.onHit;
  let mirror = false;
  const baseOverride = {};
  for (const rune of runes) {
    if (!rune) continue;
    const p = rune.patch;
    if (p.emit) emit = { ...p.emit };
    if (p.motion) motion = { ...p.motion };
    if (p.onHitAppend) for (const e of p.onHitAppend) onHit.push({ ...e });
    if (p.mirror) mirror = true;
    if (p.base) Object.assign(baseOverride, p.base);
  }
  if (EMIT[emit.type] === undefined) throw new Error(`Unknown emitter "${emit.type}" on ${def.id} (known: ${EMIT_TYPES.join(', ')})`);
  if (MOTION[motion.type] === undefined) throw new Error(`Unknown motion "${motion.type}" on ${def.id} (known: ${MOTION_TYPES.join(', ')})`);
  const effDef = Object.keys(baseOverride).length ? { ...def, base: { ...def.base, ...baseOverride } } : def;
  const stats = { ...computeWeaponStats(world.tuning, effDef, level, world.mods) };
  formStats(stats, fx, effDef);
  const list = compileList(world, onHit);
  const childList = compileList(world, onHit.filter((e) => !PARENT_ONLY_FX.includes(e.type)));
  const slot = {
    index, def, defIndex: world.weaponIndex.get(def.id), level, runes: runes.slice(),
    stats, emit, motion, emitType: EMIT[emit.type], motionType: MOTION[motion.type], mirror,
    list, childList,
    hitCdTicks: Math.round(stats.hitCooldown * TPS),
    // facing: shots may bend onto the nearest enemy within `assist` degrees of the facing way
    assistCos: emit.assist > 0 ? fcos((Math.min(emit.assist, 90) * PI) / 180) : 2,
    aimX: prev ? prev.aimX : 1, aimY: prev ? prev.aimY : 0,
    // firing state (kept across rebuilds so a level-up doesn't reset the cooldown)
    cd: prev ? prev.cd : 0,
    burst: prev ? prev.burst : 0,
    burstT: prev ? prev.burstT : 0,
    volley: prev ? prev.volley : 0,
    volleyTargets: prev ? prev.volleyTargets : new Int32Array(24).fill(NO_HANDLE),
    angle: prev ? prev.angle : 0,
    auraHandle: prev ? prev.auraHandle : NO_HANDLE,
    lastZoneTicks: prev ? prev.lastZoneTicks : new Float64Array(ZONE_PACES).fill(-1e9),
    ascensions,   // the Forms taken, in order (data/ascensions.js)
    fx,           // the same, by mechanic (sim/forms.js)
    fs: prev && prev.fs ? prev.fs : createFormState(),   // the Forms' running state
    shotForms: hasShotForm(fx),
    killForm: hasKillForm(fx),
    fired: prev ? prev.fired : 0,
    since: prev ? prev.since : world.tick,   // the tick this weapon (or the one it evolved from) was taken
  };
  return slot;
}

/** The slot relic effects (explosions, waves) hit with: its own hit cooldown, no crits. */
export function buildRelicSlot(world) {
  return {
    index: RELIC_SLOT, def: null, defIndex: 0xffff, level: 1, runes: [],
    stats: { damage: 0, crit: 0, critMult: 1, area: 1, knockback: 1, hitCooldown: 0 },
    emitType: -1, motionType: -1, mirror: false,
    list: compileList(world, [{ type: 'damage' }, { type: 'knockback' }]),
    childList: 0, hitCdTicks: 0, lastZoneTicks: new Float64Array(ZONE_PACES).fill(-1e9),
  };
}

// ---------------------------------------------------------------- spawning

// Shots are spawned from hot paths (a split or a chain hop on every hit), so spawnShot takes no
// fractional arguments (§17): its position, direction, and speed go in world.scratch.shot
// ([0] x, [1] y, [2] dir x, [3] dir y, [4] speed), and its options in the one reusable object
// that shotOpts() resets.
const SHOT = {
  life: -1, flags: 0, damage: -1, radius: -1, pierce: -2, motion: -1,
  m0: 0, m1: 0, m2: 0, m3: 0, target: NO_HANDLE, skip: NO_HANDLE, ringFrom: -1, list: -1, hops: -1,
};
export function shotOpts() {
  SHOT.life = -1; SHOT.flags = 0; SHOT.damage = -1; SHOT.radius = -1; SHOT.pierce = -2; SHOT.motion = -1;
  SHOT.m0 = 0; SHOT.m1 = 0; SHOT.m2 = 0; SHOT.m3 = 0;
  SHOT.target = NO_HANDLE; SHOT.skip = NO_HANDLE; SHOT.ringFrom = -1; SHOT.list = -1; SHOT.hops = -1;
  return SHOT;
}
export function shotAt(world, x, y, dirX, dirY, speed) {
  const r = world.scratch.shot;
  r[0] = x; r[1] = y; r[2] = dirX; r[3] = dirY; r[4] = speed;
}

/**
 * Spawn a shot (numbers in world.scratch.shot, options in SHOT; unset options take the slot's
 * own). Its hit ring starts empty, or as a copy of shot `ringFrom`'s (chain hops), plus `skip`.
 */
export function spawnShot(world, slot, opts) {
  const P = world.projectiles;
  const i = P.alloc();
  if (i < 0) return -1;
  const s = slot.stats, r = world.scratch.shot;
  const x = r[0], y = r[1], speed = r[4];
  P.x[i] = x; P.y[i] = y; P.px[i] = x; P.py[i] = y;
  P.vx[i] = r[2] * speed; P.vy[i] = r[3] * speed;
  P.life[i] = opts.life >= 0 ? opts.life : s.duration;
  P.slot[i] = slot.index;
  P.flags[i] = opts.flags;
  P.damage[i] = opts.damage >= 0 ? opts.damage : s.damage;
  P.radius[i] = opts.radius >= 0 ? opts.radius : s.radius * s.area;
  P.pierce[i] = opts.pierce >= -1 ? opts.pierce : s.pierce;
  P.knockback[i] = s.knockback;
  P.motion[i] = opts.motion >= 0 ? opts.motion : slot.motionType;
  P.m0[i] = opts.m0; P.m1[i] = opts.m1; P.m2[i] = opts.m2; P.m3[i] = opts.m3;
  P.target[i] = opts.target;
  const o = i * HIT_RING;
  let pos = 0;
  if (opts.ringFrom >= 0) {
    // A chain hop remembers everything the chain has hit so far.
    P.hits.copyWithin(o, opts.ringFrom * HIT_RING, opts.ringFrom * HIT_RING + HIT_RING);
    pos = P.hitPos[opts.ringFrom];
  } else {
    P.hits.fill(NO_HANDLE, o, o + HIT_RING);
  }
  if (opts.skip !== NO_HANDLE) { P.hits[o + pos] = opts.skip; pos = (pos + 1) % HIT_RING; }
  P.hitPos[i] = pos;
  P.list[i] = opts.list >= 0 ? opts.list : slot.list;
  P.hops[i] = opts.hops;
  P.def[i] = slot.defIndex ?? 0xffff;
  P.carry[i] = NO_HANDLE;
  return i;
}

/** Fire one shot of the slot's motion type from (x, y) along (dirX, dirY). Handles mirror twins. */
export function fireAlong(world, slot, x, y, dirX, dirY, target) {
  const m = slot.motion, s = slot.stats;
  const speed = (m.speed ?? 0) * s.speed;
  shotAt(world, x, y, dirX, dirY, speed);
  spawnShot(world, slot, motionOpts(world, slot, x, y, dirX, dirY, target));
  if (slot.mirror) {
    shotAt(world, x, y, -dirX, -dirY, speed);
    // A lobbed twin lands as far behind you as its pair lands ahead (the target gives the distance).
    spawnShot(world, slot, motionOpts(world, slot, x, y, -dirX, -dirY, slot.motionType === MOTION.arc ? target : NO_HANDLE));
  }
}

function motionOpts(world, slot, x, y, dirX, dirY, target) {
  const o = shotOpts();
  o.target = target;
  const m = slot.motion, s = slot.stats;
  switch (slot.motionType) {
    case MOTION.homing: o.m0 = m.turn ?? 4; o.m1 = m.range ?? 240; break;
    case MOTION.boomerang: o.m0 = s.duration; o.m1 = dirX; o.m2 = dirY; break;
    case MOTION.arc: {
      // Lobbed at the target where it stands now (a throw of at most `range`), or `range` along
      // the direction with no target; it lands when it arrives. Area widens the blast, not the throw.
      let reach = m.range ?? 120;
      const t = target === NO_HANDLE ? -1 : world.enemies.resolve(target);
      if (t >= 0) {
        const tx = world.enemies.x[t] - x, ty = world.enemies.y[t] - y, d = Math.sqrt(tx * tx + ty * ty);
        if (d < reach) reach = d;
      }
      o.m0 = x + dirX * reach; o.m1 = y + dirY * reach;
      o.m2 = m.flight ?? 0.6;
      o.life = o.m2 + DT;
      break;
    }
    case MOTION.bounce: o.m0 = m.bounces ?? 3; break;
    case MOTION.chain: o.m1 = m.range ?? 120; break;
    default: break;
  }
  return o;
}

// ---------------------------------------------------------------- step 3: weapons fire

/** Step 3: every slot's cooldown ticks; ready slots fire their emitter. */
export function weaponsFire(world) {
  const slots = world.slots;
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    if (slot === null || slot.emitType < 0) continue;
    if (slot.emitType === EMIT.aura) { keepAura(world, slot); continue; }
    if (slot.ascensions.length) formsTick(world, slot);
    const s = slot.stats;
    if (slot.burst > 0) {
      slot.burstT -= DT;
      while (slot.burst > 0 && slot.burstT <= 0) {
        if (!fireOne(world, slot)) { slot.burst = 0; break; }
        slot.burst--;
        slot.burstT += Math.max(DT, s.interval);
      }
    }
    slot.cd -= DT;
    if (slot.cd > 0 || slot.burst > 0) continue;
    if (!startVolley(world, slot)) { slot.cd = 0; continue; } // nothing to fire at yet: ready and waiting
    if (slot.ascensions.length) formsAfterVolley(world, slot, Math.max(1, Math.round(s.amount)));
    slot.cd += s.cooldown;
    if (slot.cd <= 0) slot.cd = s.cooldown;
  }
}

function startVolley(world, slot) {
  const s = slot.stats;
  const amount = s.amount;
  if (amount <= 0) return false;
  slot.volley = 0;
  slot.volleyTargets.fill(NO_HANDLE);
  const p = world.player;
  switch (slot.emitType) {
    case EMIT.orbit: {
      slot.angle += 0.61803398875 * TAU;
      if (slot.motionType !== MOTION.orbit) {
        // Hunting Lights: the orbs leave your side to chase, each for its duration.
        const sc = world.scratch.sc;
        for (let k = 0; k < amount; k++) {
          sincosInto(slot.angle + (k / amount) * TAU, sc, 0);
          const o = shotOpts();
          o.motion = MOTION.homing; o.m0 = slot.motion.turn ?? 6; o.m1 = slot.motion.range ?? 260; o.pierce = -1;
          o.radius = s.radius * s.area * eclipseScale(slot);
          const r0 = (slot.emit.radius ?? 36) * s.area;
          shotAt(world, p.x + sc[1] * r0, p.y + sc[0] * r0, sc[1], sc[0], (slot.motion.speed ?? 140) * s.speed);
          const i = spawnShot(world, slot, o);
          if (i >= 0 && slot.fx.eclipse) world.projectiles.scale[i] = eclipseScale(slot) >= 1.75 ? 3 : 2;
        }
        fired(world, slot, amount);
        return true;
      }
      clearSlotShots(world, slot.index, MOTION.orbit);
      const r = (slot.emit.radius ?? 36) * s.area;
      const w = (slot.motion.angularSpeed ?? 3) * s.speed;
      for (let k = 0; k < amount; k++) {
        const a = slot.angle + (k / amount) * TAU;
        const o = shotOpts();
        o.motion = MOTION.orbit; o.m0 = a; o.m1 = w; o.m2 = r;
        o.m3 = s.radius * s.area; // its size before an Eclipse grows it
        shotAt(world, p.x, p.y, 0, 0, 0);
        const i = spawnShot(world, slot, o);
        if (i >= 0 && slot.fx.eclipse) { world.projectiles.radius[i] = o.m3 * eclipseScale(slot); world.projectiles.scale[i] = eclipseScale(slot) >= 1.75 ? 3 : 2; }
      }
      fired(world, slot, amount);
      return true;
    }
    case EMIT.radial: {
      slot.angle += 2.399963229728653; // golden angle: never the same directions twice in a row
      const sc = world.scratch.sc;
      for (let k = 0; k < amount; k++) {
        sincosInto(slot.angle + (k / amount) * TAU, sc, 0);
        fireAlong(world, slot, p.x, p.y, sc[1], sc[0], NO_HANDLE);
      }
      fired(world, slot, amount);
      return true;
    }
    case EMIT.strike: {
      const n = strikeTargets(world, slot, amount);
      if (n === 0) return false;
      fired(world, slot, n);
      return true;
    }
    case EMIT.summon: {
      if (slot.fx.pyre) {
        // Pyre: the flames gather at your side until it erupts them all (it counts as firing).
        const n = stokePyre(world, slot, amount);
        if (n > 0) fired(world, slot, n);
        return true;
      }
      for (let k = 0; k < amount; k++) {
        const sc = world.scratch.sc;
        sincosInto((k / amount) * TAU, sc, 0);
        const o = shotOpts();
        o.motion = MOTION.homing; o.m0 = slot.motion.turn ?? 5; o.m1 = slot.motion.range ?? 260; o.pierce = -1;
        shotAt(world, p.x + sc[1] * 10, p.y + sc[0] * 10, sc[1], sc[0], (slot.motion.speed ?? 90) * s.speed);
        spawnShot(world, slot, o);
      }
      fired(world, slot, amount);
      return true;
    }
    default: {
      // nearest, facing, drop, wave, beam: a burst of `amount` shots, `interval` apart.
      if (!fireOne(world, slot)) return false;
      slot.burst = amount - 1;
      slot.burstT = Math.max(DT, s.interval);
      return true;
    }
  }
}

/** One shot of a burst. Returns false if there was nothing to fire at. */
function fireOne(world, slot) {
  const p = world.player, s = slot.stats;
  const k = slot.volley++;
  switch (slot.emitType) {
    case EMIT.nearest: {
      const e = slot.emit.aim === 'crowd' ? crowdTarget(world, slot.emit.range ?? 360) : nearestTarget(world, slot, slot.emit.range ?? 360);
      if (e < 0) return false;
      const E = world.enemies;
      const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (k < slot.volleyTargets.length) slot.volleyTargets[k] = E.handle(e);
      fireAlong(world, slot, p.x, p.y, dx / d, dy / d, E.handle(e));
      fired(world, slot, 1);
      return true;
    }
    case EMIT.facing: {
      // The volley's direction is fixed by its first shot, so a burst fans out evenly.
      if (k === 0) aimFacing(world, slot);
      const spread = ((slot.emit.spread ?? 10) * PI) / 180;
      const amount = s.amount;
      const off = (k - (amount - 1) / 2) * spread;
      const sc = world.scratch.sc;
      sincosInto(off, sc, 0);
      const ax = slot.aimX, ay = slot.aimY;
      const dx = ax * sc[1] - ay * sc[0], dy = ax * sc[0] + ay * sc[1];
      fireAlong(world, slot, p.x, p.y, dx, dy, NO_HANDLE);
      fired(world, slot, 1);
      return true;
    }
    case EMIT.drop: {
      const o = shotOpts();
      o.motion = slot.motionType === MOTION.linear ? MOTION.stationary : slot.motionType;
      shotAt(world, p.x, p.y, 0, 0, 0);
      spawnShot(world, slot, o);
      fired(world, slot, 1);
      return true;
    }
    case EMIT.wave: {
      const z = spawnZone(world, slot, ZONE.WAVE, p.x, p.y, 0, s.radius * s.area, s.duration);
      if (z >= 0 && slot.fx.breakers) {
        // Breakers: the ring starts at the screen's edge (or its own reach, if wider) and rolls in.
        const Z = world.zones;
        Z.flags[z] |= ZF.REVERSE;
        Z.maxRadius[z] = Math.max(Z.maxRadius[z], slot.fx.breakers.startRadius);
        Z.radius[z] = Z.maxRadius[z];
      }
      fired(world, slot, 1);
      return true;
    }
    case EMIT.beam: {
      // Each beam of a volley takes its own target (as `nearest` does), so +1 Projectile is
      // another beam somewhere else, not the same one again inside its hit cooldown.
      const e = nearestTarget(world, slot, (slot.stats.radius ?? 120) * s.area);
      let dx = p.fx, dy = p.fy;
      if (e >= 0) {
        const E = world.enemies;
        if (k < slot.volleyTargets.length) slot.volleyTargets[k] = E.handle(e);
        const ex = E.x[e] - p.x, ey = E.y[e] - p.y, d = Math.sqrt(ex * ex + ey * ey) || 1;
        dx = ex / d; dy = ey / d;
      }
      const z = spawnZone(world, slot, ZONE.BEAM, p.x, p.y, 0, 0, s.duration);
      if (z >= 0) {
        const Z = world.zones;
        Z.dx[z] = dx; Z.dy[z] = dy;
        Z.length[z] = s.radius * s.area;
        Z.thickness[z] = (slot.emit.width ?? 8) * s.area;
        if (slot.fx.sweep) { Z.flags[z] |= ZF.SWEEP; Z.ang[z] = fatan2(dy, dx); } // Full Circle: round from its target
      }
      fired(world, slot, 1);
      return true;
    }
    default:
      return false;
  }
}

function fired(world, slot, n) {
  slot.fired += n;
  const ev = world.events, i = ev.reserve(EV.FIRE);
  if (i >= 0) { ev.x[i] = world.player.x; ev.y[i] = world.player.y; ev.a[i] = slot.index; ev.b[i] = n; }
}

/**
 * Where a facing volley goes: the way the player faces, bent onto the nearest enemy within
 * `emit.assist` degrees of it and `emit.range` px (default 300), if there is one. A stick
 * can't point exactly, so this keeps "the way you face" honest without the player aiming.
 * Writes slot.aimX, slot.aimY.
 */
function aimFacing(world, slot) {
  const p = world.player, E = world.enemies;
  const fx = p.fx, fy = p.fy;
  slot.aimX = fx; slot.aimY = fy;
  if (slot.assistCos > 1) return;
  const range = slot.emit.range ?? 300;
  const q = world.scratch.qreg, near = world.scratch.near;
  q[0] = p.x; q[1] = p.y; q[2] = range;
  const m = world.enemyHash.queryR(q, near, -1);
  const cmin = slot.assistCos;
  let best = -1, bestD2 = range * range, bx = 0, by = 0;
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF.DEAD) !== 0) continue;
    const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d2 = dx * dx + dy * dy;
    if (d2 > bestD2 || d2 < 1e-6 || (d2 === bestD2 && e > best)) continue;
    const d = Math.sqrt(d2);
    if ((dx * fx + dy * fy) / d < cmin) continue;
    best = e; bestD2 = d2; bx = dx / d; by = dy / d;
  }
  if (best >= 0) { slot.aimX = bx; slot.aimY = by; }
}

/** The nearest live enemy in range that this volley hasn't already aimed at (else the nearest). */
function nearestTarget(world, slot, range) {
  const E = world.enemies, p = world.player, hash = world.enemyHash;
  const vt = slot.volleyTargets;
  let marked = 0;
  for (let k = 0; k < vt.length; k++) {
    const e = E.resolve(vt[k]);
    if (e >= 0) { E.flags[e] |= EF.MARK; marked++; }
  }
  let e = hash.nearest(p.x, p.y, range, E.flags, EF.DEAD | EF.MARK, -1);
  if (marked > 0) {
    for (let k = 0; k < vt.length; k++) {
      const m = E.resolve(vt[k]);
      if (m >= 0) E.flags[m] &= ~EF.MARK;
    }
    if (e < 0) e = hash.nearest(p.x, p.y, range, E.flags, EF.DEAD, -1);
  }
  return e;
}

/** Strike: `amount` random enemies on screen each take a hit where they stand. */
function strikeTargets(world, slot, amount) {
  const E = world.enemies, p = world.player, n = E.count;
  const cand = world.scratch.near;
  // Planted Rod: strikes fall around the rod instead of anywhere on screen.
  const rod = slot.fx.rod ? plantRod(world, slot) : false;
  const rx = slot.fs.rodX, ry = slot.fs.rodY, rr = rod ? slot.fx.rod.radius * slot.fx.rod.radius : 0;
  let m = 0;
  for (let i = 0; i < n && m < cand.length; i++) {
    if ((E.flags[i] & EF.DEAD) !== 0) continue;
    if (rod) { const dx = E.x[i] - rx, dy = E.y[i] - ry; if (dx * dx + dy * dy > rr) continue; }
    else if (Math.abs(E.x[i] - p.x) > 320 || Math.abs(E.y[i] - p.y) > 180) continue;
    cand[m++] = i;
  }
  const rng = world.rng.combat;
  const take = amount < m ? amount : m;
  const s = slot.stats;
  for (let k = 0; k < take; k++) {
    const j = k + rng.int(m - k);
    const e = cand[j]; cand[j] = cand[k]; cand[k] = e;
    const o = shotOpts();
    o.motion = MOTION.stationary; o.life = DT * 1.5; o.pierce = -1; o.radius = s.radius * s.area;
    shotAt(world, E.x[e], E.y[e], 0, 0, 0);
    spawnShot(world, slot, o);
  }
  return take;
}

/**
 * Remove a slot's shots of one motion (a new ring of orbit bodies replaces the old one). Each is
 * spent as any shot is, so a Skewer bursts and a Tether sticks (an Orbiting harpoon's ring).
 */
function clearSlotShots(world, slotIndex, motion) {
  const P = world.projectiles, slot = world.slots[slotIndex];
  const ends = slot && slot.fx && (slot.fx.skewer || slot.fx.tether);
  for (let i = P.count - 1; i >= 0; i--) {
    if (P.slot[i] === slotIndex && P.motion[i] === motion && (P.flags[i] & PF.CHILD) === 0) {
      if (ends) shotEnded(world, slot, i);
      P.remove(i);
    }
  }
}

/**
 * Burning ground (a ZONE.GROUND) at a point, for a relic's hook: it hurts in pulses every
 * `interval` s for `life` s with the on-hit list `list` (a compileList index). Cold path (a few a
 * second at most). Returns the zone's index, or -1 if the zone pool is full.
 */
export function groundAt(world, slotIndex, x, y, radius, life, damage, interval, list) {
  const Z = world.zones;
  const z = Z.alloc();
  if (z < 0) return -1;
  Z.x[z] = x; Z.y[z] = y;
  Z.kind[z] = ZONE.GROUND; Z.slot[z] = slotIndex; Z.list[z] = list;
  Z.radius[z] = Z.maxRadius[z] = radius;
  Z.life[z] = life;
  Z.damage[z] = damage;
  Z.knockback[z] = 0;
  Z.interval[z] = Math.max(1, Math.round(interval * TPS));
  Z.nextTick[z] = world.tick;
  Z.def[z] = 0xffff;
  return z;
}

function spawnZone(world, slot, kind, x, y, radius, maxRadius, life) {
  const Z = world.zones;
  const i = Z.alloc();
  if (i < 0) return -1;
  const s = slot.stats;
  Z.x[i] = x; Z.y[i] = y;
  Z.kind[i] = kind; Z.slot[i] = slot.index; Z.list[i] = slot.list;
  Z.radius[i] = radius; Z.maxRadius[i] = maxRadius;
  Z.life[i] = life;
  Z.damage[i] = s.damage;
  Z.knockback[i] = s.knockback;
  Z.thickness[i] = (slot.emit.thickness ?? 12) * s.area;
  Z.def[i] = slot.defIndex ?? 0xffff;
  return i;
}

function keepAura(world, slot) {
  const Z = world.zones, s = slot.stats, p = world.player;
  let z = Z.resolve(slot.auraHandle);
  if (z < 0) {
    z = spawnZone(world, slot, ZONE.AURA, p.x, p.y, s.radius * s.area, s.radius * s.area, 1e9);
    if (z < 0) return;
    slot.auraHandle = Z.handle(z);
  }
  // Stats can change any time (the Lamplighter's light grows with her level).
  Z.radius[z] = s.radius * s.area; Z.maxRadius[z] = Z.radius[z];
  Z.damage[z] = s.damage; Z.knockback[z] = s.knockback; Z.list[z] = slot.list;
}

// ---------------------------------------------------------------- step 4: shots move

/** Step 4: every shot ages and moves by its motion. Spent shots are flagged dead. */
export function moveProjectiles(world) {
  const P = world.projectiles, E = world.enemies, p = world.player, n = P.count;
  const sc = world.scratch.sc;
  for (let i = 0; i < n; i++) {
    P.px[i] = P.x[i]; P.py[i] = P.y[i];
    P.age[i] += DT;
    P.life[i] -= DT;
    const mo = P.motion[i];
    if (P.life[i] <= 0 && mo !== MOTION.arc) { P.flags[i] |= PF.DEAD; continue; }
    switch (mo) {
      case MOTION.linear:
        P.x[i] += P.vx[i] * DT; P.y[i] += P.vy[i] * DT;
        break;
      case MOTION.orbit: {
        const a = P.m0[i] + P.m1[i] * DT;
        P.m0[i] = a;
        sincosInto(a, sc, 0);
        P.x[i] = p.x + sc[1] * P.m2[i]; P.y[i] = p.y + sc[0] * P.m2[i];
        break;
      }
      case MOTION.homing: {
        let t = E.resolve(P.target[i]);
        if (t < 0 || (E.flags[t] & EF.DEAD) !== 0) {
          t = world.enemyHash.nearest(P.x[i], P.y[i], P.m1[i], E.flags, EF.DEAD, -1);
          P.target[i] = t >= 0 ? E.handle(t) : NO_HANDLE;
        }
        let vx = P.vx[i], vy = P.vy[i];
        let speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < 1) { speed = 60; vx = p.fx * speed; vy = p.fy * speed; }
        let step = 1;
        if (t >= 0) {
          const dx = E.x[t] - P.x[i], dy = E.y[t] - P.y[i], d = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = Math.min(1, P.m0[i] * DT);
          vx += (dx / d * speed - vx) * k; vy += (dy / d * speed - vy) * k;
          const s2 = Math.sqrt(vx * vx + vy * vy) || 1;
          vx = vx / s2 * speed; vy = vy / s2 * speed;
          // Slow down on arrival, so a lingering shot (a summon) stays on its target instead of
          // overshooting and circling back.
          const arrive = E.radius[t] + P.radius[i] + 12;
          if (d < arrive) step = d / arrive;
        }
        P.vx[i] = vx; P.vy[i] = vy;
        P.x[i] += vx * DT * step; P.y[i] += vy * DT * step;
        break;
      }
      case MOTION.boomerang: {
        const half = P.m0[i] * 0.5;
        const speed0 = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i]);
        if (P.age[i] < half) {
          // Out, slowing to a stop at the halfway point.
          const f = 1 - P.age[i] / half;
          P.x[i] += P.m1[i] * speed0 * f * DT; P.y[i] += P.m2[i] * speed0 * f * DT;
        } else {
          // Back to you, speeding up.
          if ((P.flags[i] & PF.RETURNING) === 0) {
            P.flags[i] |= PF.RETURNING;
            P.hits.fill(NO_HANDLE, i * HIT_RING, i * HIT_RING + HIT_RING); // can hit again on the way back
          }
          const dx = p.x - P.x[i], dy = p.y - P.y[i], d = Math.sqrt(dx * dx + dy * dy);
          if (d < 8) { P.flags[i] |= PF.DEAD; break; }
          const f = Math.min(1.5, (P.age[i] - half) / half + 0.2);
          P.x[i] += (dx / d) * speed0 * f * DT; P.y[i] += (dy / d) * speed0 * f * DT;
        }
        break;
      }
      case MOTION.stationary:
        break;
      case MOTION.arc: {
        if ((P.flags[i] & PF.LANDED) !== 0) { P.flags[i] |= PF.DEAD; break; }
        const tLeft = P.m2[i] - (P.age[i] - DT);
        if (tLeft <= DT) {
          P.x[i] = P.m0[i]; P.y[i] = P.m1[i];
          P.flags[i] |= PF.LANDED; // hits once, where it lands
        } else {
          P.x[i] += ((P.m0[i] - P.x[i]) / tLeft) * DT; P.y[i] += ((P.m1[i] - P.y[i]) / tLeft) * DT;
        }
        break;
      }
      case MOTION.bounce: {
        let nx = P.x[i] + P.vx[i] * DT, ny = P.y[i] + P.vy[i] * DT;
        // Bounce off the edges of the view around you.
        if ((nx < p.x - 320 && P.vx[i] < 0) || (nx > p.x + 320 && P.vx[i] > 0)) { P.vx[i] = -P.vx[i]; nx = P.x[i]; P.m0[i]--; }
        if ((ny < p.y - 180 && P.vy[i] < 0) || (ny > p.y + 180 && P.vy[i] > 0)) { P.vy[i] = -P.vy[i]; ny = P.y[i]; P.m0[i]--; }
        P.x[i] = nx; P.y[i] = ny;
        if (P.m0[i] < 0) P.flags[i] |= PF.DEAD;
        break;
      }
      case MOTION.chain: {
        let t = E.resolve(P.target[i]);
        if (t < 0 || (E.flags[t] & EF.DEAD) !== 0) {
          t = nearestUnhit(world, i, P.x[i], P.y[i], P.m1[i]);
          if (t < 0) { P.flags[i] |= PF.DEAD; break; }
          P.target[i] = E.handle(t);
        }
        const speed = Math.max(200, Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i]));
        const dx = E.x[t] - P.x[i], dy = E.y[t] - P.y[i], d = Math.sqrt(dx * dx + dy * dy) || 1;
        const step = Math.min(d, speed * DT);
        P.vx[i] = dx / d * speed; P.vy[i] = dy / d * speed;
        P.x[i] += dx / d * step; P.y[i] += dy / d * step;
        break;
      }
      default:
        P.x[i] += P.vx[i] * DT; P.y[i] += P.vy[i] * DT;
    }
    if (P.slot[i] < HIT_SLOTS) { const sl = world.slots[P.slot[i]]; if (sl && sl.shotForms) formsMove(world, sl, i); }
  }
}

/** Mark (or unmark) every enemy in shot pi's hit ring with EF.MARK. */
function markRing(world, pi, on) {
  const P = world.projectiles, E = world.enemies, o = pi * HIT_RING;
  for (let k = 0; k < HIT_RING; k++) {
    const e = E.resolve(P.hits[o + k]);
    if (e >= 0) { if (on) E.flags[e] |= EF.MARK; else E.flags[e] &= ~EF.MARK; }
  }
}

/** Nearest live enemy the shot hasn't hit (its hit ring), or -1. */
function nearestUnhit(world, pi, x, y, range) {
  const E = world.enemies;
  markRing(world, pi, true);
  const t = world.enemyHash.nearest(x, y, range, E.flags, EF.DEAD | EF.MARK, -1);
  markRing(world, pi, false);
  return t;
}

// ---------------------------------------------------------------- step 5: shots hit

function ringHas(P, i, h) {
  const o = i * HIT_RING;
  for (let k = 0; k < HIT_RING; k++) if (P.hits[o + k] === h) return true;
  return false;
}

/** Step 5: shots against enemies (and hostile shots against you). Spent shots are removed. */
export function projectileHits(world) {
  const P = world.projectiles, E = world.enemies, pl = world.player;
  const n = P.count, near = world.scratch.hits, tick = world.tick;
  const slots = world.slots;
  const pr = world.tuning.player.radius;
  const q = world.scratch.qreg, hit = world.scratch.hit;
  for (let i = 0; i < n; i++) {
    const f = P.flags[i];
    if ((f & PF.DEAD) !== 0) continue;
    if ((f & PF.HOSTILE) !== 0) {
      const dx = P.x[i] - pl.x, dy = P.y[i] - pl.y, rr = P.radius[i] + pr;
      if (dx * dx + dy * dy <= rr * rr) {
        hurtPlayer(world, P.damage[i], P.x[i], P.y[i]);
        P.flags[i] |= PF.DEAD;
      }
      continue;
    }
    if (P.motion[i] === MOTION.arc && (f & PF.LANDED) === 0) continue; // in the air
    const slot = slots[P.slot[i]];
    if (slot === null || slot === undefined) { P.flags[i] |= PF.DEAD; continue; }
    const cd = slot.hitCdTicks;
    q[0] = P.x[i]; q[1] = P.y[i]; q[2] = P.radius[i];
    const m = world.enemyHash.queryR(q, near, -1);
    for (let k = 0; k < m; k++) {
      const e = near[k];
      if ((E.flags[e] & EF.DEAD) !== 0) continue;
      const h = E.handle(e);
      const nh = e * HIT_SLOTS + P.slot[i];
      // A slot with a hit cooldown shares it across its shots; a shot without one (and every
      // split or chain child, which are shots of their own) goes by its own hit ring.
      const byCooldown = cd > 0 && (f & PF.CHILD) === 0;
      if (byCooldown) { if (E.nextHit[nh] > tick) continue; }
      else if (ringHas(P, i, h)) continue;
      // Direction of the hit: the shot's travel, or outward from you for shots that don't travel.
      let dx = P.vx[i], dy = P.vy[i];
      if (P.motion[i] === MOTION.orbit || P.motion[i] === MOTION.stationary || P.motion[i] === MOTION.arc || (dx === 0 && dy === 0)) {
        dx = E.x[e] - (P.motion[i] === MOTION.orbit ? pl.x : P.x[i]);
        dy = E.y[e] - (P.motion[i] === MOTION.orbit ? pl.y : P.y[i]);
      }
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-6) { dx /= d; dy /= d; } else { dx = pl.fx; dy = pl.fy; }
      if (byCooldown) E.nextHit[nh] = tick + cd;
      P.hits[i * HIT_RING + P.hitPos[i]] = h;
      P.hitPos[i] = (P.hitPos[i] + 1) % HIT_RING;
      hit[0] = P.damage[i]; hit[1] = P.knockback[i]; hit[2] = dx; hit[3] = dy; hit[4] = P.x[i]; hit[5] = P.y[i];
      applyHit(world, slot, P.list[i], e, i);
      if (slot.fx && slot.fx.skewer) skewerCatch(world, i, e);
      if (P.pierce[i] > 0) {
        P.pierce[i]--;
        if (P.pierce[i] === 0) { P.flags[i] |= PF.DEAD; break; }
      }
    }
    if (P.motion[i] === MOTION.arc) {
      // Landed: one blast, then gone. A Mortar bursts once where it lands; a Firebomb breaks into
      // small flasks (whatever it hit).
      if (slot.fx && (f & PF.CHILD) === 0) {
        if (slot.fx.mortar) {
          const b = slot.fx.mortar.burst;
          explodeAt(world, slot.index, P.x[i], P.y[i], b.radius * slot.stats.area, P.damage[i] * b.damageMul, slot.stats.knockback, -1);
          // A lobbed flare that lands among them hangs where it burst (the burst is not a hit).
          if (slot.fx.hang) hangFlare(world, slot, slot.fx.hang, P.x[i], P.y[i], P.damage[i]);
        }
        if (slot.fx.cluster) clusterFlasks(world, slot, slot.fx.cluster, P.x[i], P.y[i], P.damage[i], P.radius[i]);
      }
      P.flags[i] |= PF.DEAD;
    }
  }
  // Remove spent shots (walking backward: swap-with-last). A Skewer or a Tether acts as its shot ends.
  for (let i = P.count - 1; i >= 0; i--) {
    if ((P.flags[i] & PF.DEAD) === 0) continue;
    if (P.slot[i] < HIT_SLOTS) { const sl = slots[P.slot[i]]; if (sl && sl.fx && (sl.fx.skewer || sl.fx.tether)) shotEnded(world, sl, i); }
    P.remove(i);
  }
}

// ---------------------------------------------------------------- on-hit effects

/**
 * Apply an on-hit list to enemy e. `proj` is the projectile index (or -1 for zones and blasts).
 * Its numbers come in the hit register (world.scratch.hit): [0] damage, [1] knockback,
 * [2] push direction x, [3] push direction y, [4] hit x, [5] hit y. (Hot path: no fractional
 * arguments, see §17.)
 */
export function applyHit(world, slot, listRef, e, proj) {
  const hit = world.scratch.hit, num = world.scratch.num;
  const damage = hit[0], knock = hit[1], dirX = hit[2], dirY = hit[3], hx = hit[4], hy = hit[5];
  const list = world.fxLists[listRef];
  const E = world.enemies;
  const s = slot.stats;
  for (let k = 0; k < list.length; k++) {
    const fx = list[k];
    switch (fx.t) {
      case FX.damage: {
        let dmg = damage;
        let crit = false;
        if (s.crit > 0 && world.rng.combat.next() < s.crit) { dmg *= s.critMult; crit = true; }
        num[0] = dmg;
        damageEnemyR(world, e, slot.index, crit);
        // A strike's own hit (not a hop, a pool, or a split) says so in its event (c bit 2), so the
        // view draws its bolt from the sky there and nowhere else.
        if (proj >= 0 && slot.emitType === EMIT.strike && (world.projectiles.flags[proj] & PF.CHILD) === 0) {
          const ev = world.events, last = ev.count - 1;
          if (last >= 0 && ev.type[last] === EV.HIT && ev.b[last] === E.handle(e)) ev.c[last] += 2;
        }
        break;
      }
      case FX.knockback:
        if (knock > 0) {
          if (world.knockbackPulls && slot.index < RELIC_SLOT) {
            // The Harpooner: her weapons' knockback drags toward her instead.
            const p = world.player, dx = p.x - E.x[e], dy = p.y - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
            if (d > 1) { num[1] = dx / d; num[2] = dy / d; num[3] = knock; impulseR(world, e); }
          } else { num[1] = dirX; num[2] = dirY; num[3] = knock; impulseR(world, e); }
        }
        break;
      case FX.status:
        applyStatus(world, e, fx, slot.index);
        break;
      case FX.pull: {
        const p = world.player;
        const dx = p.x - E.x[e], dy = p.y - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) { num[1] = dx / d; num[2] = dy / d; num[3] = fx.strength ?? 1; impulseR(world, e); }
        break;
      }
      case FX.split:
        if (proj >= 0 && (world.projectiles.flags[proj] & PF.CHILD) === 0) splitShot(world, slot, proj, e, fx, hx, hy, damage);
        break;
      case FX.chain:
        chainFrom(world, slot, proj, e, fx, damage);
        break;
      case FX.explode: {
        const xr = world.scratch.xreg;
        xr[0] = hx; xr[1] = hy; xr[2] = (fx.radius ?? 20) * s.area; xr[3] = damage * (fx.damageMul ?? 0.5); xr[4] = 0.5;
        explodeR(world, slot.index, e);
        break;
      }
      case FX.zone: {
        const every = Math.round((fx.every ?? 0.25) * TPS);
        const lz = slot.lastZoneTicks;
        if (world.tick - lz[fx.zoneSlot] < every) break;
        lz[fx.zoneSlot] = world.tick;
        const Z = world.zones;
        const z = Z.alloc();
        if (z < 0) break;
        Z.x[z] = E.x[e]; Z.y[z] = E.y[e];
        Z.kind[z] = ZONE.GROUND; Z.slot[z] = slot.index; Z.list[z] = fx.zoneList;
        Z.radius[z] = Z.maxRadius[z] = (fx.radius ?? 14) * s.area;
        Z.life[z] = fx.duration ?? 2;
        Z.damage[z] = fx.damage ?? 2;
        Z.knockback[z] = 0;
        Z.interval[z] = Math.max(1, Math.round((fx.interval ?? 0.4) * TPS));
        Z.nextTick[z] = world.tick;
        Z.def[z] = slot.defIndex ?? 0xffff;
        if (slot.fx && slot.fx.fuel) fuelLink(world, slot, z); // Fuel Line
        break;
      }
      case FX.hang: hangFlare(world, slot, fx, hx, hy, damage); break;
      case FX.focus: focusBurn(world, slot, fx, e, damage); break;
      case FX.mark: markEnemy(world, slot, fx, e, damage); break;
      case FX.march:
        // A strike's own first hit marches on (not a hop, and not a marching strike itself).
        if (proj >= 0 && (world.projectiles.flags[proj] & PF.CHILD) === 0 && world.projectiles.hitPos[proj] === 1) marchStrike(world, slot, fx, hx, hy, damage, world.projectiles.radius[proj]);
        break;
      case FX.light: {
        const ev = world.events, i = ev.reserve(EV.LIGHT);
        if (i >= 0) { ev.x[i] = hx; ev.y[i] = hy; ev.a[i] = fx.radius ?? 16; ev.b[i] = fx.ms ?? 120; }
        break;
      }
      default:
        break;
    }
  }
  if (world.hooks.onHit.length > 0) runHooks(world, 'onHit', e, slot.index);
}

function splitShot(world, slot, proj, e, fx, hx, hy, damage) {
  const P = world.projectiles;
  const count = fx.count ?? 2;
  const spread = ((fx.spread ?? 45) * PI) / 180;
  let vx = P.vx[proj], vy = P.vy[proj];
  let speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < 1) {
    // A shot that wasn't moving (a strike, a landed flask, a drop): the pieces fly on outward,
    // away from you through the hit point (the way you face, if it's at your feet).
    speed = 180;
    const p = world.player, ox = hx - p.x, oy = hy - p.y, d = Math.sqrt(ox * ox + oy * oy);
    if (d > 1) { vx = ox / d; vy = oy / d; } else { vx = p.fx; vy = p.fy; }
  } else { vx /= speed; vy /= speed; }
  const sc = world.scratch.sc;
  const skip = world.enemies.handle(e);
  for (let k = 0; k < count; k++) {
    const off = count === 1 ? 0 : (k / (count - 1) - 0.5) * spread;
    sincosInto(off, sc, 0);
    const o = shotOpts();
    o.motion = MOTION.linear; o.flags = PF.CHILD; o.damage = damage * (fx.damageMul ?? 0.5); o.pierce = 1;
    o.life = Math.max(0.3, Math.min(0.8, P.life[proj])); o.list = slot.childList; o.skip = skip; o.radius = P.radius[proj];
    shotAt(world, hx, hy, vx * sc[1] - vy * sc[0], vx * sc[0] + vy * sc[1], speed);
    spawnShot(world, slot, o);
  }
}

function chainFrom(world, slot, proj, e, fx, damage) {
  const P = world.projectiles, E = world.enemies;
  const hopsLeft = proj >= 0 && P.hops[proj] >= 0 ? P.hops[proj] : (fx.hops ?? 3);
  if (hopsLeft <= 0) return;
  // Exclude this enemy and every enemy the chain (or the shot) has already hit.
  E.flags[e] |= EF.MARK;
  if (proj >= 0) markRing(world, proj, true);
  const t = world.enemyHash.nearest(E.x[e], E.y[e], fx.range ?? 90, E.flags, EF.DEAD | EF.MARK, -1);
  E.flags[e] &= ~EF.MARK;
  if (proj >= 0) markRing(world, proj, false);
  if (t < 0) return;
  const o = shotOpts();
  o.motion = MOTION.chain; o.flags = PF.CHILD; o.damage = damage * (fx.damageMul ?? 0.7); o.pierce = 1;
  o.life = 0.6; o.list = slot.childList; o.target = E.handle(t); o.skip = E.handle(e); o.hops = hopsLeft - 1;
  o.m1 = fx.range ?? 90; o.radius = 4; o.ringFrom = proj;
  const dx = E.x[t] - E.x[e], dy = E.y[t] - E.y[e], d = Math.sqrt(dx * dx + dy * dy) || 1;
  shotAt(world, E.x[e], E.y[e], dx / d, dy / d, 320);
  spawnShot(world, slot, o);
}

/** A blast: damage (and a push) to every live enemy within radius, except `exclude`. */
export function explodeAt(world, slotIndex, x, y, radius, damage, knockback, exclude) {
  const xr = world.scratch.xreg;
  xr[0] = x; xr[1] = y; xr[2] = radius; xr[3] = damage; xr[4] = knockback;
  explodeR(world, slotIndex, exclude);
}

/** explodeAt() with its numbers in xreg: [0] x, [1] y, [2] radius, [3] damage, [4] knockback. */
export function explodeR(world, slotIndex, exclude) {
  const xr = world.scratch.xreg, num = world.scratch.num;
  const x = xr[0], y = xr[1], radius = xr[2], damage = xr[3], knockback = xr[4];
  const E = world.enemies, near = world.scratch.blast;
  const m = world.enemyHash.queryR(xr, near, -1); // xr[0..2] is the circle
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if (e === exclude || (E.flags[e] & EF.DEAD) !== 0) continue;
    num[0] = damage;
    damageEnemyR(world, e, slotIndex, false);
    if (knockback > 0) {
      // Out from the blast, or (the Harpooner's weapons) in toward the player.
      const pulls = world.knockbackPulls && slotIndex < RELIC_SLOT;
      const cx = pulls ? world.player.x : x, cy = pulls ? world.player.y : y, sign = pulls ? -1 : 1;
      const dx = E.x[e] - cx, dy = E.y[e] - cy, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-3) { num[1] = sign * dx / d; num[2] = sign * dy / d; num[3] = knockback; impulseR(world, e); }
    }
  }
  const ev = world.events, i = ev.reserve(EV.EXPLODE);
  if (i >= 0) { ev.x[i] = x; ev.y[i] = y; ev.a[i] = radius; ev.b[i] = slotIndex; }
}

// ---------------------------------------------------------------- step 6: zones

/** Step 6: auras, waves, beams, burning ground, and enemy hazard pools. */
export function zonesTick(world) {
  const Z = world.zones, E = world.enemies, pl = world.player;
  const n = Z.count, near = world.scratch.hits, tick = world.tick, slots = world.slots;
  const pr = world.tuning.player.radius;
  const q = world.scratch.qreg, hit = world.scratch.hit;
  for (let z = 0; z < n; z++) {
    Z.age[z] += DT;
    Z.life[z] -= DT;
    const kind = Z.kind[z];
    if (kind === ZONE.HAZARD) {
      if (Z.warn[z] > 0) { Z.warn[z] -= DT; }
      else {
        const dx = pl.x - Z.x[z], dy = pl.y - Z.y[z], rr = Z.radius[z] + pr;
        if (dx * dx + dy * dy <= rr * rr && tick >= Z.nextTick[z]) {
          if (hurtPlayer(world, Z.damage[z], Z.x[z], Z.y[z]) > 0) Z.nextTick[z] = tick + 30;
        }
      }
      continue;
    }
    if (kind === ZONE.MARK) {
      // A mark rides its enemy (sim/forms.js): Static zaps, Riptide bursts when its time is up.
      const slot = slots[Z.slot[z]];
      if (slot) markTick(world, slot, z); else Z.life[z] = 0;
      continue;
    }
    if (Z.life[z] <= 0) continue;
    const slot = slots[Z.slot[z]];
    if (slot === null || slot === undefined) { Z.life[z] = 0; continue; }
    let qx = Z.x[z], qy = Z.y[z], qr = Z.radius[z];
    let inner = -1, reverse = false, damageMul = 1;
    if (kind === ZONE.AURA) {
      Z.x[z] = qx = pl.x; Z.y[z] = qy = pl.y;
    } else if (kind === ZONE.WAVE) {
      const dur = Z.age[z] + Z.life[z];
      const u = Math.min(1, Z.age[z] / (dur > 0 ? dur : 1));
      reverse = (Z.flags[z] & ZF.REVERSE) !== 0;
      if (reverse) {
        // Breakers: the ring rolls in from its reach toward you; it holds what's inside it.
        Z.x[z] = pl.x; Z.y[z] = pl.y; qx = pl.x; qy = pl.y;
        const r = Z.maxRadius[z] * (1 - u);
        Z.radius[z] = r;
        qr = r + Z.thickness[z];
        inner = r;
      } else {
        qr = Z.maxRadius[z] * u;
        Z.radius[z] = qr;
        inner = qr - Z.thickness[z];
      }
    } else if (kind === ZONE.BEAM) {
      Z.x[z] = pl.x; Z.y[z] = pl.y;
      if ((Z.flags[z] & ZF.SWEEP) !== 0) {
        // Full Circle: round once over the beam's life, from where it first pointed.
        const dur = Z.age[z] + Z.life[z];
        const sc = world.scratch.sc;
        sincosInto(Z.ang[z] + TAU * Math.min(1, Z.age[z] / (dur > 0 ? dur : 1)), sc, 0);
        Z.dx[z] = sc[1]; Z.dy[z] = sc[0];
      }
      qx = pl.x + Z.dx[z] * Z.length[z] * 0.5; qy = pl.y + Z.dy[z] * Z.length[z] * 0.5;
      qr = Z.length[z] * 0.5 + Z.thickness[z];
    } else if (kind === ZONE.TETHER) {
      // Tether: from you to the enemy the harpoon stuck in (where it fell, if it's dead).
      const t = world.enemies.resolve(Z.target[z]);
      if (t >= 0 && (E.flags[t] & EF.DEAD) === 0) { Z.x[z] = E.x[t]; Z.y[z] = E.y[t]; }
      const ex = Z.x[z] - pl.x, ey = Z.y[z] - pl.y, len = Math.sqrt(ex * ex + ey * ey);
      if (len < 1) continue;
      Z.dx[z] = ex / len; Z.dy[z] = ey / len; Z.length[z] = len;
      qx = pl.x + ex * 0.5; qy = pl.y + ey * 0.5;
      qr = len * 0.5 + Z.thickness[z];
    } else if (kind === ZONE.GROUND) {
      // Ground hurts in pulses, on its own interval; a Fuel Line flare is one pulse at flareMul.
      if (tick < Z.nextTick[z]) continue;
      Z.nextTick[z] = tick + Z.interval[z];
      if ((Z.flags[z] & ZF.FLARE) !== 0) { Z.flags[z] &= ~ZF.FLARE; damageMul = slot.fx && slot.fx.fuel ? slot.fx.fuel.flareMul : 1; }
    }
    // (A tether hits each enemy at most every 0.3 s, whatever its harpoon's own cooldown.)
    const cd = kind === ZONE.GROUND ? 0 : kind === ZONE.TETHER ? Math.max(18, slot.hitCdTicks) : slot.hitCdTicks;
    q[0] = qx; q[1] = qy; q[2] = qr;
    const m = world.enemyHash.queryR(q, near, -1);
    for (let k = 0; k < m; k++) {
      const e = near[k];
      if ((E.flags[e] & EF.DEAD) !== 0) continue;
      const ex = E.x[e], ey = E.y[e];
      let dx = ex - Z.x[z], dy = ey - Z.y[z];
      if (kind === ZONE.WAVE) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (reverse) {
          if (d + E.radius[e] < inner) continue; // the ring hasn't reached it yet
          dx = -dx; dy = -dy;                     // dragged in, toward you
        } else if (d + E.radius[e] < inner) continue; // the ring has passed it
      } else if (kind === ZONE.BEAM || kind === ZONE.TETHER) {
        // Distance from the enemy to the beam's (or the chain's) segment, from you.
        const bx = ex - pl.x, by = ey - pl.y;
        const t = Math.max(0, Math.min(Z.length[z], bx * Z.dx[z] + by * Z.dy[z]));
        const cx = pl.x + Z.dx[z] * t - ex, cy = pl.y + Z.dy[z] * t - ey;
        const w = Z.thickness[z] * 0.5 + E.radius[e];
        if (cx * cx + cy * cy > w * w) continue;
        dx = Z.dx[z]; dy = Z.dy[z];
      }
      const nh = e * HIT_SLOTS + Z.slot[z];
      if (kind === ZONE.WAVE) {
        // Each wave hits each enemy once (even one its push keeps ahead of the ring), whatever
        // the slot's hit cooldown, so every wave of a volley counts.
        const mark = Z.handle(z) + 1;
        if (E.waveHit[nh] === mark) continue;
        E.waveHit[nh] = mark;
      } else if (kind !== ZONE.GROUND) {
        // (Ground pulses on its own interval and leaves the slot's cooldown alone.)
        if (cd > 0 && E.nextHit[nh] > tick) continue;
        E.nextHit[nh] = tick + cd;
      }
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-6) { dx /= d; dy /= d; } else { dx = pl.fx; dy = pl.fy; }
      hit[0] = Z.damage[z] * damageMul; hit[1] = Z.knockback[z]; hit[2] = dx; hit[3] = dy; hit[4] = ex; hit[5] = ey;
      // A ground's pulse says so to the kill it makes (Wards come only from the weapon's own kills).
      world.zonePulse = kind === ZONE.GROUND ? 1 : 0;
      applyHit(world, slot, Z.list[z], e, -1);
      world.zonePulse = 0;
    }
  }
  for (let z = Z.count - 1; z >= 0; z--) {
    if (Z.life[z] > 0) continue;
    if (Z.slot[z] < HIT_SLOTS) { const sl = slots[Z.slot[z]]; if (sl && sl.fs) zoneGone(world, sl, z); }
    Z.remove(z);
  }
}

