// The weapon pipeline (ARCHITECTURE §5.8): emitter -> motion -> on-hit list.
//
// A weapon slot compiles its definition, with its Forms and rolled lines, into: an emitter (where
// and how it fires), a motion (how its shots move), an on-hit list (what happens on contact), and
// final stats (stats.js). A Form is a patch on that composition, so it changes behavior, not just
// numbers. Nothing is ever aimed by the player: `nearest` and `strike` target automatically.
//
// Shots live in the projectile pool, lasting effects (auras, waves, beams, burning ground,
// enemy hazards) in the zone pool. Shots, the player's and the enemies' alike, fly over
// obstacles (crates and rubble are low, and in this genre weapons ignore terrain); only bodies
// collide with walls. Hit control: a slot with a hit cooldown can hit a given
// enemy again only after that cooldown (per enemy, per slot: auras, orbits, zones); a slot
// without one relies on each shot remembering the last 4 enemies it hit (piercing shots).

import { DT, TPS, EF, EF_GONE, PF, MOTION, EMIT, FX, ZONE, ZF, ZSTYLE, HIT_SLOTS, RELIC_SLOT, HIT_RING, PARENT_ONLY_FX } from './constants.js';
import { NO_HANDLE } from './pools.js';
import { EV } from './events.js';
import { computeWeaponStats, weaponOwnNumbers } from './stats.js';
import { seepPulse } from './holds.js';
import { damageEnemyR, impulseR, applyStatus, tarBurst } from './enemies.js';
import { spoutVolley, puddlePulse, quench, dazeEnemy, tarEnemy, feverEnemy, spill, spikeAt, spikeTick } from './holds.js';
import { strikeZoneTick } from './storm.js';
import { hurtPlayer } from './player.js';
import { runHooks } from './hooks.js';
import { sincosInto, fcos, fatan2, TAU, PI } from '../lib/fmath.js';
import {
  buildForms, formStats, createFormState, formsTick, formsAfterVolley, crowdTarget, plantRod, stokePyre,
  eclipseScale, formsMove, skewerCatch, focusBurn, hangFlare, markEnemy, clusterFlasks, marchStrike, fuelLink,
  shotEnded, hasShotForm, hasKillForm, hasEndForm, hasTickForm, zoneGone, markTick, originOf, potsLive, summonOpts,
  stickHit, latchOn, recoilRing, dazeAround,
} from './forms.js';

export const PROJ_FIELDS = {
  x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array, vx: Float32Array, vy: Float32Array,
  life: Float32Array, age: Float32Array,
  slot: Uint8Array, flags: Uint16Array,   // (PF: SPLIT needs the ninth bit)
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
  // A strike (the storm, the Eye, the Salt Widow's lightning: sim/storm.js) has its own: what it
  // does to you, where it came from, and whether it leaves Salt Glass or a pillar.
  pdmg: Float32Array, src: Uint8Array, gift: Uint8Array,
  hitN: Uint16Array,     // hits a wave, beam, or tether has made over its life (tuning.caps.weapon.zoneHits; C1 Nov 17)
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
      // Each zone effect in a list keeps its own pace (a weapon's own pool and a Form's).
      c.zoneSlot = out.filter((x) => x.t === FX.zone).length;
      if (c.zoneSlot >= ZONE_PACES) throw new Error(`An on-hit list can leave at most ${ZONE_PACES} kinds of ground`);
      const sub = [{ type: 'damage' }];
      if (e.status) sub.push({ type: 'status', ...e.status });
      if (e.slow > 0) sub.push({ type: 'status', status: 'slow', pct: e.slow, duration: 0.6 });   // Pitch
      if (e.fever > 0) sub.push({ type: 'fever', duration: e.fever });                             // Clinging Fire
      c.zoneList = compileList(world, sub);
    }
    out.push(c);
  }
  if (world.fxLists.length >= 0xffff) throw new Error('Too many different on-hit lists in one run');
  world.fxLists.push(out);
  world.fxListIndex.set(key, world.fxLists.length - 1);
  return world.fxLists.length - 1;
}

// How a Form's on-hit numbers join an effect of the same kind the weapon's own pipeline already
// has (Great Toll's freeze on a bell that freezes, Relay on a weapon that chains). The rules:
// amounts add (more hops, longer, harder); reaches take the larger; a per-hop multiplier is never
// added (a chain's hops would grow stronger than the hit); a slow never reaches a standstill.
// Every number an on-hit effect has is listed: a new one must be given its rule (an unlisted one
// throws, so a future reach or rate never adds by mistake).
const MERGE = Object.freeze({
  hops: 'add', duration: 'add', dps: 'add', damage: 'add', amp: 'add', strength: 'add', count: 'add', pct: 'add',
  radius: 'max', range: 'max', interval: 'keep', every: 'keep', ms: 'keep', spread: 'keep',
  dpsMul: 'add', slow: 'max', fever: 'max', toOrigin: 'max', max: 'max', life: 'max',
  bump: 'max', sec: 'max', mul: 'max', daze: 'max',   // (Low Note's lost bump, a bump's, a gaff's: ruling 19)
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
    if (typeof v === 'boolean') { same[k] = same[k] || v; continue; }   // (a switch: Gaff Hook's `any`)
    if (typeof v !== 'number') continue;
    const rule = k === 'damageMul' ? (e.type === 'chain' ? 'max' : 'add') : e.type === 'gaff' && k === 'amp' ? 'max' : MERGE[k];
    if (!rule) throw new Error(`addEffect: no rule for joining "${k}" (${e.type}); give it one in MERGE`);
    if (rule === 'add') same[k] = (same[k] ?? 0) + v;
    else if (rule === 'max') same[k] = Math.max(same[k] ?? 0, v);
    else same[k] ??= v;
  }
  if (same.type === 'status' && same.status === 'slow') same.pct = Math.min(same.pct, MAX_SLOW);
}

/**
 * Build a weapon slot from a definition. The emitter, motion, and on-hit list come from the
 * definition, patched by everything the weapon holds (sim/forms.js): its Form options
 * (prev.ascensions), its Rare and Epic lines (prev.lines), and its Legendary specials
 * (prev.specials). Its numbers come from its rolled upgrades (prev.ups, sim/weaponups.js); `level`
 * is 1 + how many it has taken. (`_unused`: where a weapon's runes were, before ruling 14.)
 */
export function buildSlot(world, index, def, level, _unused = null, prev = null) {
  const ascensions = prev && prev.ascensions ? prev.ascensions : [];
  const ups = prev && prev.ups ? prev.ups : [];
  const lines = prev && prev.lines ? prev.lines : [], specials = prev && prev.specials ? prev.specials : [];
  const pipe = { emit: { ...def.pipeline.emit }, motion: { ...def.pipeline.motion }, onHit: def.pipeline.onHit.map((e) => ({ ...e })) };
  const boosts = [];
  for (const id of lines) { const l = (def.lines || []).find((x) => x.id === id); if (l) boosts.push(l.boost); }
  for (const id of specials) { const x = (def.specials || []).find((y) => y.id === id); if (x) boosts.push(x.boost); }
  const built = buildForms(pipe, ascensions, boosts);
  const fx = built.fx, emit = pipe.emit, motion = pipe.motion, onHit = pipe.onHit;
  const tags = def.tags || [], rules = world.rules || {};
  // Rules the whole build carries (a passive's last level, a relic) that are an effect on a hit.
  if (rules.lampglass && tags.includes('light')) addEffect(onHit, { type: 'fever', duration: 2 });
  if (rules.undertow && tags.includes('sea')) addEffect(onHit, { type: 'status', status: 'slow', pct: 0.2, duration: 1.5 });
  if (rules.tarred && index < RELIC_SLOT) addEffect(onHit, { type: 'tar', duration: 4, damageMul: 0.5 });
  if (rules.marshfever && index < RELIC_SLOT) addEffect(onHit, { type: 'fever', duration: 3 });
  if (EMIT[emit.type] === undefined) throw new Error(`Unknown emitter "${emit.type}" on ${def.id} (known: ${EMIT_TYPES.join(', ')})`);
  if (MOTION[motion.type] === undefined) throw new Error(`Unknown motion "${motion.type}" on ${def.id} (known: ${MOTION_TYPES.join(', ')})`);
  const stats = { ...computeWeaponStats(world.tuning, def, def.levels ? level : ups, world.mods) };
  formStats(stats, fx, def, built.stats);
  // A weapon's late steps (data `steps`: the Harpoon Chain's, ruling 18 WB): at its `at`-th upgrade
  // and after, more Pierce and harder hits.
  if (def.steps) for (const st of def.steps) if (level > st.at) { stats.pierce += st.pierce ?? 0; stats.amount += st.amount ?? 0; stats.damage *= st.damageMul ?? 1; }
  // A capstone held does more for each level of the weapon's partner passive (ruling 14: the partner boosts, it no longer gates).
  if (def.partner && ascensions.some((a) => a.capstone)) {
    // (Worn gear's kinship counts as that many more levels of the partner.)
    const ps = world.build ? world.build.passives.find((x) => x.def.id === def.partner) : null;
    const lv = (ps ? ps.level : 0) + (world.config.evolutionPassiveReduction || 0);
    if (lv > 0) stats.damage *= 1 + (world.tuning.forms.partnerPer ?? 0) * lv;
  }
  // Kindred (C1, Nov 17): each other weapon or passive held that shares a tag with this weapon makes
  // it `kindred.per` stronger, up to `kindred.max` of them. Held, not earned: no loop.
  const K = world.tuning.weaponUps && world.tuning.weaponUps.kindred;
  if (K && world.build && index < RELIC_SLOT && tags.length) {
    const n = Math.min(K.max, kinCount(world, tags, index));
    if (n > 0) stats.damage *= 1 + K.per * n;
  }
  // Deep Anchor: damage from your Armor (player stats are rebuilt before the slots). The armor that
  // comes and goes during a run (the Harpooner's crowd armor, p.bonusArmor) is added at each hit
  // (projectileHits), so every point of Armor counts.
  const armorDamage = emit.armorDamage > 0 ? emit.armorDamage : 0;
  // (Deep Anchor's Armor counts up to emit.armorMax points in all, its own and a crowd's: ruling 25 WE.)
  const armorMax = emit.armorMax > 0 ? emit.armorMax : 1e9;
  if (armorDamage > 0 && world.stats) stats.damage += armorDamage * Math.min(armorMax, world.stats.armor);
  const own = weaponOwnNumbers(def, []).duration;   // its own Duration at level 1 (a status lasts as much longer as its Duration is above it)
  const list = compileList(world, onHit);
  const childList = compileList(world, onHit.filter((e) => !PARENT_ONLY_FX.includes(e.type)));
  const reach = fx.reach || null;
  const slot = {
    index, def, defIndex: world.weaponIndex.get(def.id), level, runes: [],
    stats, emit, motion, emitType: EMIT[emit.type], motionType: MOTION[motion.type], mirror: emit.mirror === true,
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
    ascensions,   // the Form options held, at most one per axis (data/ascensions.js)
    axes: prev && prev.axes ? prev.axes : 0,              // its open axes: 1 how it fires, 2 how its shots travel, 4 the capstone (sim/ascend.js)
    deed: prev && prev.deed ? prev.deed : 0,              // its capstone deed's count (sim/deeds.js)
    deedA: prev && prev.deedA ? prev.deedA : 0, deedB: prev && prev.deedB ? prev.deedB : 0,   // a 'multi' deed's window: its first kill's tick, and the kills in it
    legAt: prev && prev.legAt ? prev.legAt : 0,           // the upgrade at which a Legendary was last offered to it
    fx,           // everything it holds, by mechanic (sim/forms.js)
    fs: prev && prev.fs ? prev.fs : createFormState(),   // its running state
    pots: emit.pot ? (prev && prev.pots ? prev.pots : new Float64Array(9).fill(-1)) : null,   // the Eel Pot's pots: x, y, the tick each goes
    ups,          // its rolled upgrades, in order: { up, rarity, value, line?, special? } (sim/weaponups.js)
    lines, specials,   // the ids of the lines and specials it holds
    shotForms: hasShotForm(fx, emit),
    endForms: hasEndForm(fx, emit),
    killForm: hasKillForm(fx),
    tickForms: hasTickForm(fx, emit),
    // What a hit reads (hot paths): a status it hits harder (bonus), damage by distance (reach),
    // and the build's rules that are a multiplier on its hits.
    bonus: fx.bonus || null,
    reachNear2: reach && reach.within ? reach.within * reach.within : 0, reachNearMul: reach ? reach.nearMul ?? 1 : 1,
    reachFar2: reach ? (reach.beyond ? reach.beyond * reach.beyond : reach.beyondShare ? (reach.beyondShare * stats.radius * stats.area) * (reach.beyondShare * stats.radius * stats.area) : 0) : 0, reachFarMul: reach ? reach.farMul ?? 1 : 1,
    heavy: rules.ballast === true && tags.includes('steel'),
    deedHits: !!(def.deed && def.deed.kind === 'hits'), deedTick: -1,
    echoTag: rules.bittern === true && tags.includes('echo'),
    fired: prev ? prev.fired : 0,
    since: prev ? prev.since : world.tick,   // the tick this weapon was taken
    // The Marsh (§5.17): a Salted Dead's crust cracks under its hits; it quenches a burning enemy;
    // it's Steel (Cold Iron); its statuses last as much longer as its Duration is above its own;
    // its frozen kills shatter (Salt Crust); its spikes standing.
    cracks: tags.includes('frost') || tags.includes('sea') || tags.includes('steel'),
    quenches: tags.includes('frost') || tags.includes('sea'),
    steel: tags.includes('steel'),
    statusMul: own > 0 ? Math.max(0.5, stats.duration / own) : 1,
    shatter: emit.shatter || null,
    shardList: emit.shatter ? compileList(world, [{ type: 'damage' }, { type: 'status', status: 'slow', pct: emit.shatter.slow, duration: 1.5 }]) : 0,
    swellList: fx.swell ? compileList(world, [{ type: 'damage' }, { type: 'status', status: 'slow', pct: fx.swell.slow, duration: 0.8 }]) : 0,
    spikes: prev && prev.spikes !== undefined ? prev.spikes : 0,
    armorDamage, armorLeft: Math.max(0, armorMax - (world.stats ? world.stats.armor : 0)),
    // A spout's picks (x and y pairs), sized for its Amount now or its base plus
    // caps.weapon.maxExtraAmount, whichever is more (resized on a rebuild), so no spout is dropped.
    picks: emit.type === 'spout' ? spoutPicks(world, def, stats, prev) : null,
  };
  return slot;
}

function spoutPicks(world, def, stats, prev) {
  const most = Math.max(stats.amount, weaponOwnNumbers(def, []).amount + world.tuning.caps.weapon.maxExtraAmount);
  return prev && prev.picks && prev.picks.length >= 2 * most ? prev.picks : new Float64Array(2 * most);
}

/** The slot relic effects (explosions, waves) hit with: its own hit cooldown, no crits. */
export function buildRelicSlot(world) {
  return {
    index: RELIC_SLOT, def: null, defIndex: 0xffff, level: 1, runes: [],
    stats: { damage: 0, crit: 0, critMult: 1, area: 1, knockback: 1, hitCooldown: 0 },
    emitType: -1, motionType: -1, mirror: false,
    list: compileList(world, [{ type: 'damage' }, { type: 'knockback' }]),
    childList: 0, hitCdTicks: 0, lastZoneTicks: new Float64Array(ZONE_PACES).fill(-1e9),
    cracks: false, quenches: false, steel: false, statusMul: 1, shatter: null, shardList: 0, spikes: 0, fx: {}, fs: createFormState(), endForms: false,
    armorDamage: 0, armorLeft: 0, picks: null, bonus: null, reachNear2: 0, reachFar2: 0, reachNearMul: 1, reachFarMul: 1, heavy: false, pots: null,
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
  const fs = slot.fs;
  P.damage[i] = opts.damage >= 0 ? opts.damage : fs ? s.damage * fs.liveDmg : s.damage;
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

/**
 * The nearest live enemy within 260px of (x, y) on the far side from (dirX, dirY) (a back line's
 * twin), or -1; its unit direction is left in world.scratch.sc[0], [1].
 */
function behindTarget(world, x, y, dirX, dirY) {
  const E = world.enemies, q = world.scratch.reg, near = world.scratch.lure;
  q[0] = x; q[1] = y; q[2] = 260;
  const n = world.enemyHash.queryR(q, near, -1);
  let best = 1e18, bt = -1;
  for (let k = 0; k < n; k++) {
    const e = near[k];
    if ((E.flags[e] & EF_GONE) !== 0) continue;
    const dx = E.x[e] - x, dy = E.y[e] - y, d2 = dx * dx + dy * dy;
    if (dx * dirX + dy * dirY < 0 && d2 < best && d2 > 1) { best = d2; bt = e; }
  }
  if (bt >= 0) { const d = Math.sqrt(best), sc = world.scratch.sc; sc[0] = (E.x[bt] - x) / d; sc[1] = (E.y[bt] - y) / d; }
  return bt;
}

/** How many other weapons and passives held share a tag with `tags` (Kindred; the card's tag counts show the same). */
export function kinCount(world, tags, index = -1) {
  let n = 0;
  for (let s = 0; s < world.slots.length; s++) {
    const o = world.slots[s];
    if (s === index || s === RELIC_SLOT || !o || !o.def) continue;
    if ((o.def.tags || []).some((t) => tags.includes(t))) n++;
  }
  for (const ps of world.build.passives) if ((ps.def.tags || []).some((t) => tags.includes(t))) n++;
  return n;
}

/** Fire one shot of the slot's motion type from (x, y) along (dirX, dirY). Handles mirror twins. */
export function fireAlong(world, slot, x, y, dirX, dirY, target) {
  const m = slot.motion, s = slot.stats;
  const speed = (m.speed ?? 0) * s.speed;
  shotAt(world, x, y, dirX, dirY, speed);
  spawnShot(world, slot, motionOpts(world, slot, x, y, dirX, dirY, target));
  if (slot.mirror) {
    // The twin goes at the nearest enemy behind (within 260px of where it leaves), else straight back.
    // A lobbed twin lands as far behind you as its pair lands ahead (the target gives the distance).
    const bt = behindTarget(world, x, y, dirX, dirY), E = world.enemies, sc = world.scratch.sc;
    const bx = bt >= 0 ? sc[0] : -dirX, by = bt >= 0 ? sc[1] : -dirY;
    shotAt(world, x, y, bx, by, speed);
    const o = motionOpts(world, slot, x, y, bx, by, bt >= 0 ? E.handle(bt) : slot.motionType === MOTION.arc ? target : NO_HANDLE);
    // The twin is a second shot at half strength (it found a target behind you, Nov 17: at full it
    // doubled a whole build late).
    const sd = slot.stats.damage * (slot.fs ? slot.fs.liveDmg : 1);
    o.damage = (o.damage >= 0 ? o.damage : sd) * 0.5;
    spawnShot(world, slot, o);
  }
}

/** One shot of the slot's motion from (x, y) along (dirX, dirY) at a damage of its own (a fan on a dash, a buried bolt going off). No mirror twin. */
export function fireFrom(world, slot, x, y, dirX, dirY, target, damage) {
  shotAt(world, x, y, dirX, dirY, (slot.motion.speed ?? 0) * slot.stats.speed);
  const o = motionOpts(world, slot, x, y, dirX, dirY, target);
  o.damage = damage;
  return spawnShot(world, slot, o);
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
  const slots = world.slots, rules = world.rules, p = world.player;
  // Waders' rule: stand still a second and everything close is dazed, at most once every 4s (its own clock: ruling 16).
  if (rules.waders && p.stillT >= 1 && world.tick >= p.ruleAt) { p.ruleAt = world.tick + 4 * TPS; dazeAround(world, p.x, p.y, 40, 1); }
  // The Tallow Candle's rule: standing still, weapons fire faster.
  const still = rules.tallow && !p.moving && p.dashTicks === 0 ? 1.12 : 1;
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    if (slot === null || slot.emitType < 0) continue;
    if (slot.tickForms) formsTick(world, slot);
    if (slot.emitType === EMIT.aura) { keepAura(world, slot); continue; }
    const s = slot.stats, fs = slot.fs;
    if (slot.burst > 0) {
      slot.burstT -= DT;
      while (slot.burst > 0 && slot.burstT <= 0) {
        if (!fireOne(world, slot)) { slot.burst = 0; break; }
        slot.burst--;
        slot.burstT += Math.max(DT, s.interval);
      }
    }
    slot.cd -= DT * fs.liveRate * still;
    if (slot.cd > 0 || slot.burst > 0) continue;
    // An echo (Second Peal, Double Flash): this volley is the repeat when one is waiting.
    const echo = slot.fx.echo;
    if (echo) { if (fs.echoOn === 2) { fs.echoOn = 1; fs.liveDmg *= echo.mul; } else if (fs.echoOn === 1) { fs.echoOn = 0; fs.liveDmg /= echo.mul; } }
    if (!startVolley(world, slot)) { slot.cd = 0; if (echo && fs.echoOn === 1) { fs.echoOn = 2; fs.liveDmg /= echo.mul; } continue; } // nothing to fire at yet: ready and waiting
    formsAfterVolley(world, slot, Math.max(1, Math.round(s.amount)));
    if (echo && fs.echoOn === 0) { fs.echoOn = 2; slot.cd = echo.delay; continue; }
    slot.cd += echo ? Math.max(DT, s.cooldown - echo.delay) : s.cooldown;
    if (slot.cd <= 0) slot.cd = s.cooldown;
    // Great Toll (W4, Nov 17: was each kill): the more enemies inside the ring as it tolls, the
    // sooner the next, up to maxCut of the wait. Read once, as it fires.
    const tl = slot.fx && slot.fx.toll;
    if (tl) {
      const q = world.scratch.qreg, p = world.player;
      q[0] = p.x; q[1] = p.y; q[2] = s.radius * s.area;
      const n = world.enemyHash.queryR(q, world.scratch.near, -1);
      slot.cd -= Math.min(s.cooldown * tl.maxCut, n * (tl.cutPerEnemy ?? 0));
    }
    // Bittern's Call's rule: every 4th volley of an Echo weapon fires again at once.
    if (slot.echoTag && ++fs.bittern % 4 === 0) slot.cd = Math.min(slot.cd, 0.2);
  }
}

function startVolley(world, slot) {
  const s = slot.stats;
  // (String of Pots: every pot standing lunges.)
  const amount = slot.pots !== null ? s.amount * potsLive(world, slot) : s.amount;
  if (amount <= 0) return false;
  const og = world.scratch.open;
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
          originOf(world, slot, 0, og);
          shotAt(world, og[0] + sc[1] * r0, og[1] + sc[0] * r0, sc[1], sc[0], (slot.motion.speed ?? 140) * s.speed);
          const i = spawnShot(world, slot, o);
          if (i >= 0 && slot.fx.eclipse) world.projectiles.scale[i] = eclipseScale(slot) >= 1.75 ? 3 : 2;
        }
        fired(world, slot, amount);
        return true;
      }
      clearSlotShots(world, slot.index, MOTION.orbit);
      const r = (slot.emit.radius ?? 36) * s.area * (s.orbitMul ?? 1);
      const w = (slot.motion.angularSpeed ?? 3) * s.speed;
      // (Twin Rings: a second ring, the other way; sim/forms.js formsMove sets every ring's reach.)
      const rings = slot.fx.twin ? 2 : 1;
      for (let ring = 0; ring < rings; ring++) {
        for (let k = 0; k < amount; k++) {
          const a = slot.angle + ((k + ring * 0.5) / amount) * TAU;
          const o = shotOpts();
          o.motion = MOTION.orbit; o.m0 = a; o.m1 = ring === 1 ? -w : w; o.m2 = r;
          o.m3 = s.radius * s.area; // its size before an Eclipse grows it
          o.hops = ring === 1 ? -2 : -1;   // (the outer ring, by a hops below -1: a hops of 0 or more is a chain's count)
          if (ring === 1) o.damage = s.damage * (slot.fs ? slot.fs.liveDmg : 1) * (slot.fx.twin.damageMul ?? 1);   // (Twin Rings' outer ring)
          shotAt(world, p.x, p.y, 0, 0, 0);
          const i = spawnShot(world, slot, o);
          if (i >= 0 && slot.fx.eclipse) { world.projectiles.radius[i] = o.m3 * eclipseScale(slot); world.projectiles.scale[i] = eclipseScale(slot) >= 1.75 ? 3 : 2; }
        }
      }
      fired(world, slot, amount * rings);
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
    case EMIT.spout: {
      // Brine Spring: spouts under the thickest crowd on screen, a puddle each (sim/holds.js).
      const n = spoutVolley(world, slot, Math.min(amount, slot.picks.length >> 1));
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
      // Grave Lights: the flames rise where enemies last died (world.corpses), not from you; with
      // nothing dead nearby they rise from you, one fewer.
      const C = world.corpses, gl = slot.fx.corpse;
      let made = 0;
      for (let k = 0; k < amount; k++) {
        const sc = world.scratch.sc;
        sincosInto((k / amount) * TAU, sc, 0);
        let x = p.x + sc[1] * 10, y = p.y + sc[0] * 10;
        if (gl) {
          let found = false;
          const c = (C.n - 1 - k + 16 * C.t.length) % C.t.length;
          if (k < C.n && k < C.t.length && world.tick - C.t[c] <= gl.age * TPS) {
            const dx = C.x[c] - p.x, dy = C.y[c] - p.y;
            if (dx * dx + dy * dy <= gl.within * gl.within) { x = C.x[c]; y = C.y[c]; found = true; }
          }
          if (!found && k === amount - 1 && amount > 1) break;
        }
        const o = summonOpts(slot, k);
        shotAt(world, x, y, sc[1], sc[0], (slot.motion.speed ?? 90) * s.speed);
        spawnShot(world, slot, o);
        made++;
      }
      fired(world, slot, made);
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
      const og = world.scratch.open, fx = slot.fx, aim = slot.emit.aim;
      originOf(world, slot, k, og);
      const ox = og[0], oy = og[1];
      if (fx.mine) {
        // Buried Glass: the bolt is buried where you stand and waits (sim/forms.js formsMove).
        const o = shotOpts();
        o.motion = MOTION.stationary; o.flags = PF.MINE; o.life = fx.mine.life; o.pierce = -1;
        shotAt(world, p.x, p.y, 0, 0, 0);
        spawnShot(world, slot, o);
        fired(world, slot, 1);
        return true;
      }
      let dx, dy, h = NO_HANDLE;
      if (aim === 'facing' || aim === 'rear') {
        const sg = aim === 'rear' ? -1 : 1;
        // (A volley fans a little, so more flasks don't land on one spot.)
        const sc = world.scratch.sc;
        sincosInto((k - (s.amount - 1) / 2) * 0.3, sc, 0);
        dx = sg * (p.fx * sc[1] - p.fy * sc[0]); dy = sg * (p.fx * sc[0] + p.fy * sc[1]);
      } else {
        const e = aim === 'crowd' ? crowdTarget(world, slot.emit.range ?? 360) : nearestTarget(world, slot, slot.emit.range ?? 360, ox, oy);
        if (e < 0) return false;
        const E = world.enemies;
        dx = E.x[e] - ox; dy = E.y[e] - oy;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= d; dy /= d; h = E.handle(e);
        if (k < slot.volleyTargets.length) slot.volleyTargets[k] = h;
      }
      if (fx.sides) {
        // Broadside: to both sides of the aim, not along it.
        fireAlong(world, slot, ox, oy, -dy, dx, NO_HANDLE);
        fireAlong(world, slot, ox, oy, dy, -dx, NO_HANDLE);
      } else if (fx.pincer) {
        // Tongs: a pair, wide to each side of the target.
        const sc = world.scratch.sc;
        sincosInto((fx.pincer.angle * PI) / 180, sc, 0);
        const c = sc[1], sn = sc[0];
        fireAlong(world, slot, ox, oy, dx * c - dy * sn, dx * sn + dy * c, h);
        fireAlong(world, slot, ox, oy, dx * c + dy * sn, -dx * sn + dy * c, h);
      } else fireAlong(world, slot, ox, oy, dx, dy, h);
      // Muzzle Flash: each shot also scorches what is close in front of you.
      if (fx.muzzle) explodeAt(world, slot.index, ox + dx * fx.muzzle.radius * 0.7, oy + dy * fx.muzzle.radius * 0.7, fx.muzzle.radius * s.area, s.damage * fx.muzzle.damageMul * slot.fs.liveDmg, s.knockback, -1);
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
      if (slot.fx.sides) {
        fireAlong(world, slot, p.x, p.y, -dy, dx, NO_HANDLE);
        fireAlong(world, slot, p.x, p.y, dy, -dx, NO_HANDLE);
      } else fireAlong(world, slot, p.x, p.y, dx, dy, NO_HANDLE);
      fired(world, slot, 1);
      return true;
    }
    case EMIT.drop: {
      if (slot.emit.moving && !p.moving) return false; // Glass Caltrops: only where you walk
      const o = shotOpts();
      o.motion = slot.motionType === MOTION.linear ? MOTION.stationary : slot.motionType;
      const toss = slot.fx.toss;
      if (toss) {
        // Scatter: thrown ahead of you, in a fan.
        const sc = world.scratch.sc;
        sincosInto(((k % 3) - 1) * (toss.angle * PI) / 180, sc, 0);
        shotAt(world, p.x + (p.fx * sc[1] - p.fy * sc[0]) * toss.dist, p.y + (p.fx * sc[0] + p.fy * sc[1]) * toss.dist, 0, 0, 0);
      } else shotAt(world, p.x, p.y, 0, 0, 0);
      spawnShot(world, slot, o);
      fired(world, slot, 1);
      return true;
    }
    case EMIT.wave: {
      const og = world.scratch.open, fx = slot.fx, fs = slot.fs;
      const fixed = originOf(world, slot, k, og);
      const reach = s.radius * s.area * fs.liveArea;
      const z = spawnZone(world, slot, ZONE.WAVE, og[0], og[1], 0, reach, s.duration);
      if (z >= 0) {
        const Z = world.zones;
        if (fixed) Z.flags[z] |= ZF.FIXED;
        if (slot.emit.cone > 0) {
          // The Fog Horn: a cone, at the nearest enemy (or the way you face: Bow Horn), a volley fanned
          // `fan` degrees apart. `length` keeps the cosine of its half-angle (zonesTick).
          let dx = p.fx, dy = p.fy;
          if (slot.emit.aim === 'rear') { dx = -p.fx; dy = -p.fy; }   // (Bow Horn: back the way you came)
          else if (slot.emit.aim !== 'facing') {
            const e = nearestTarget(world, slot, reach * 1.5, og[0], og[1]);
            if (e >= 0) { const E = world.enemies, ex = E.x[e] - og[0], ey = E.y[e] - og[1], d = Math.sqrt(ex * ex + ey * ey) || 1; dx = ex / d; dy = ey / d; }
          }
          const fan = slot.emit.fan ?? 0, n = s.amount;
          if (fan > 0 && n > 1) {
            const sc = world.scratch.sc;
            sincosInto((k - (n - 1) * 0.5) * fan * PI / 180, sc, 0);
            const rx = dx * sc[1] - dy * sc[0], ry = dx * sc[0] + dy * sc[1]; dx = rx; dy = ry;
          }
          Z.flags[z] |= ZF.CONE; Z.dx[z] = dx; Z.dy[z] = dy;
          sincosInto(Math.min(180, slot.emit.cone) * PI / 180, world.scratch.sc, 0);
          Z.length[z] = world.scratch.sc[1];
        }
        if (fx.breakers) {
          // Breakers: the ring starts at the screen's edge (or its own reach, if wider) and rolls in.
          Z.flags[z] |= ZF.REVERSE;
          // (A Great Toll's ring rolls in from its own reach, not the screen's edge: ruling 19 RE, the
          // whole screen dragged in made it a runaway and slow on a boss.)
          if (!fx.toll) Z.maxRadius[z] = Math.max(Z.maxRadius[z], fx.breakers.startRadius);
          Z.radius[z] = Z.maxRadius[z];
        } else if (fx.stand) {
          // Slack Water: it stops at its reach and stands (zonesTick): `ang` keeps the time it travels.
          Z.flags[z] |= ZF.STAND; Z.ang[z] = s.duration; Z.life[z] = s.duration + fx.stand.sec;
        }
        if (fx.crowd) {
          // Crowded Water: harder for each enemy inside its reach as it starts.
          const q = world.scratch.qreg;
          q[0] = og[0]; q[1] = og[1]; q[2] = reach;
          const n = world.enemyHash.queryR(q, world.scratch.near, -1);
          Z.damage[z] *= 1 + Math.min(fx.crowd.max, fx.crowd.per * n);
        }
        // Ground Swell: the toll leaves standing water the size of its ring.
        if (fx.swell && k === 0) {
          const g = groundAt(world, slot.index, og[0], og[1], reach * fx.swell.radiusMul, fx.swell.life, s.damage * fx.swell.damageMul * fs.liveDmg, fx.swell.interval, slot.swellList);
          if (g >= 0) { Z.style[g] = ZSTYLE.WATER; Z.def[g] = slot.defIndex; }
        }
      }
      fired(world, slot, 1);
      return true;
    }
    case EMIT.beam: {
      // Each beam of a volley takes its own target (as `nearest` does), so +1 Beam is another beam
      // somewhere else, not the same one again inside its hit cooldown. Heliograph: the way you face.
      const fx = slot.fx, fs = slot.fs, len = s.radius * s.area * fs.liveArea;
      const facing = slot.emit.aim === 'facing';
      const e = facing ? -1 : nearestTarget(world, slot, len, p.x, p.y);
      let dx = p.fx, dy = p.fy;
      const E = world.enemies;
      if (facing && k > 0) {
        const sc = world.scratch.sc;
        sincosInto((k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * 0.35, sc, 0);
        dx = p.fx * sc[1] - p.fy * sc[0]; dy = p.fx * sc[0] + p.fy * sc[1];
      }
      if (e >= 0) {
        if (k < slot.volleyTargets.length) slot.volleyTargets[k] = E.handle(e);
        const ex = E.x[e] - p.x, ey = E.y[e] - p.y, d = Math.sqrt(ex * ex + ey * ey) || 1;
        dx = ex / d; dy = ey / d;
      }
      const twins = slot.mirror && !fx.sweep ? 2 : 1;
      for (let t = 0; t < twins; t++) {
        const z = spawnZone(world, slot, ZONE.BEAM, p.x, p.y, 0, 0, s.duration);
        if (z < 0) break;
        const Z = world.zones;
        if (t === 1) {
          // Back Glass: the second beam flashes at the nearest enemy behind, else straight back.
          const sc = world.scratch.sc, b = behindTarget(world, p.x, p.y, dx, dy);
          Z.dx[z] = b >= 0 ? sc[0] : -dx; Z.dy[z] = b >= 0 ? sc[1] : -dy;
          Z.damage[z] *= 0.5;   // (at half strength, as every back line's twin)
        } else { Z.dx[z] = dx; Z.dy[z] = dy; }
        // (Full Circle: a sweep covers a disc, so its length grows with the square root of Area,
        // and +Area is that much more ground covered, not its square: C1 Nov 17.)
        Z.length[z] = fx.sweep ? s.radius * Math.sqrt(s.area) * fs.liveArea : len;
        Z.thickness[z] = (slot.emit.width ?? 8) * s.area;
        if (fx.sweep) { Z.flags[z] |= ZF.SWEEP; Z.ang[z] = fatan2(dy, dx); } // Full Circle: round from its target
      }
      // Prism: at the first enemy the beam finds, it splits in two.
      if (fx.fork && !fx.sweep) {
        const t = e >= 0 ? e : world.enemyHash.nearest(p.x + dx * len * 0.5, p.y + dy * len * 0.5, len * 0.5, E.flags, EF_GONE, -1);
        if (t >= 0) {
          const sc = world.scratch.sc, tx = E.x[t], ty = E.y[t];
          for (let side = -1; side <= 1; side += 2) {
            const z = spawnZone(world, slot, ZONE.BEAM, tx, ty, 0, 0, s.duration);
            if (z < 0) break;
            const Z = world.zones;
            sincosInto(side * (fx.fork.angle * PI) / 180, sc, 0);
            Z.flags[z] |= ZF.FIXED;
            Z.dx[z] = dx * sc[1] - dy * sc[0]; Z.dy[z] = dx * sc[0] + dy * sc[1];
            Z.length[z] = len * fx.fork.lengthMul;
            Z.thickness[z] = (slot.emit.width ?? 8) * s.area;
            Z.damage[z] *= fx.fork.damageMul;
          }
        }
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
    if ((E.flags[e] & EF_GONE) !== 0) continue;
    const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d2 = dx * dx + dy * dy;
    if (d2 > bestD2 || d2 < 1e-6 || (d2 === bestD2 && e > best)) continue;
    const d = Math.sqrt(d2);
    if ((dx * fx + dy * fy) / d < cmin) continue;
    best = e; bestD2 = d2; bx = dx / d; by = dy / d;
  }
  if (best >= 0) { slot.aimX = bx; slot.aimY = by; }
}

/** The nearest live enemy in range that this volley hasn't already aimed at (else the nearest). */
function nearestTarget(world, slot, range, ox, oy) {
  const E = world.enemies, hash = world.enemyHash;
  const vt = slot.volleyTargets;
  let marked = 0;
  for (let k = 0; k < vt.length; k++) {
    const e = E.resolve(vt[k]);
    if (e >= 0) { E.flags[e] |= EF.MARK; marked++; }
  }
  let e = hash.nearest(ox, oy, range, E.flags, EF_GONE | EF.MARK, -1);
  if (marked > 0) {
    for (let k = 0; k < vt.length; k++) {
      const m = E.resolve(vt[k]);
      if (m >= 0) E.flags[m] &= ~EF.MARK;
    }
    if (e < 0) e = hash.nearest(ox, oy, range, E.flags, EF_GONE, -1);
  }
  return e;
}

/** Strike: `amount` random enemies on screen each take a hit where they stand. */
function strikeTargets(world, slot, amount) {
  const E = world.enemies, p = world.player, n = E.count;
  const cand = world.scratch.near;
  // The rod: strikes fall around it (sim/forms.js plantRod), not anywhere on screen (Storm Kite: no rod).
  const reach = slot.emit.rod || slot.emit.rodSelf ? plantRod(world, slot) : 0;
  const rod = reach > 0;
  const rx = slot.fs.rodX, ry = slot.fs.rodY, rr = reach * reach;
  let m = 0;
  for (let i = 0; i < n && m < cand.length; i++) {
    if ((E.flags[i] & EF_GONE) !== 0) continue;
    if (rod) { const dx = E.x[i] - rx, dy = E.y[i] - ry; if (dx * dx + dy * dy > rr) continue; }
    else if (Math.abs(E.x[i] - p.x) > 320 || Math.abs(E.y[i] - p.y) > 180) continue;
    cand[m++] = i;
  }
  const rng = world.rng.combat;
  const take = amount < m ? amount : m;
  const s = slot.stats;
  // Tall Rod: the first bolt of a volley falls on the biggest enemy in reach.
  let k0 = 0;
  if (slot.emit.rodBig && m > 0) {
    let b = 0;
    for (let q = 1; q < m; q++) if (E.maxHp[cand[q]] > E.maxHp[cand[b]]) b = q;
    const t = cand[b]; cand[b] = cand[0]; cand[0] = t; k0 = 1;
    const o = shotOpts();
    o.motion = MOTION.stationary; o.life = DT * 1.5; o.pierce = -1; o.radius = s.radius * s.area;
    shotAt(world, E.x[t], E.y[t], 0, 0, 0);
    spawnShot(world, slot, o);
  }
  for (let k = k0; k < take; k++) {
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
  const ends = slot && slot.endForms;
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
  // (A bad list fails here, at the call, not later in a pulse: zonesTick reads world.fxLists[list].)
  if (!(Number.isInteger(list) && list >= 0 && list < world.fxLists.length)) throw new Error(`groundAt: effect list ${list} out of range (0 to ${world.fxLists.length - 1})`);
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
  Z.damage[i] = slot.fs ? s.damage * slot.fs.liveDmg : s.damage;
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
  Z.damage[z] = s.damage * slot.fs.liveDmg; Z.knockback[z] = s.knockback; Z.list[z] = slot.list;
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
        // (Bow Lantern: the ring circles a point ahead of you.)
        const os = world.slots[P.slot[i]], oo = os && os.fx.origin && os.fx.origin.mode === 'ahead' ? os.fx.origin.dist : 0;
        P.x[i] = p.x + p.fx * oo + sc[1] * P.m2[i]; P.y[i] = p.y + p.fy * oo + sc[0] * P.m2[i];
        break;
      }
      case MOTION.follow: {
        // Procession: m0 samples back along the path you walked (world.path, one every 6 ticks).
        const path = world.path, N = path.x.length;
        const back = Math.min(P.m0[i], path.n - 1);
        if (back >= 0) {
          const k = (path.n - 1 - back + 16 * N) % N;
          P.x[i] += (path.x[k] - P.x[i]) * 0.2; P.y[i] += (path.y[k] - P.y[i]) * 0.2;
        }
        break;
      }
      case MOTION.homing: {
        let t = E.resolve(P.target[i]);
        if (t < 0 || (E.flags[t] & EF_GONE) !== 0) {
          t = world.enemyHash.nearest(P.x[i], P.y[i], P.m1[i], E.flags, EF_GONE, -1);
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
        if (t < 0 || (E.flags[t] & EF_GONE) !== 0) {
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
  const t = world.enemyHash.nearest(x, y, range, E.flags, EF_GONE | EF.MARK, -1);
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
    if ((P.motion[i] === MOTION.arc && (f & PF.LANDED) === 0) || (f & PF.MINE) !== 0) continue; // in the air, or buried and waiting
    const slot = slots[P.slot[i]];
    if (slot === null || slot === undefined) { P.flags[i] |= PF.DEAD; continue; }
    const cd = slot.hitCdTicks;
    q[0] = P.x[i]; q[1] = P.y[i]; q[2] = P.radius[i];
    const m = world.enemyHash.queryR(q, near, -1);
    for (let k = 0; k < m; k++) {
      const e = near[k];
      if ((E.flags[e] & EF_GONE) !== 0) continue;
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
      // Dredge: the anchor drags what it hits round with it (along its swing, and a little inward).
      if (slot.fx.dredge && P.motion[i] === MOTION.orbit) { const sg = P.m1[i] < 0 ? -1 : 1, tx = -dy * sg - dx * slot.fx.dredge.pull, ty = dx * sg - dy * slot.fx.dredge.pull; dx = tx; dy = ty; }
      if (byCooldown) E.nextHit[nh] = tick + cd;
      P.hits[i * HIT_RING + P.hitPos[i]] = h;
      P.hitPos[i] = (P.hitPos[i] + 1) % HIT_RING;
      hit[0] = P.damage[i]; hit[1] = P.knockback[i]; hit[2] = dx; hit[3] = dy; hit[4] = P.x[i]; hit[5] = P.y[i];
      // Sea Anchor: the armor that comes and goes (the Harpooner's crowd armor) counts at the hit.
      if (slot.armorDamage > 0 && (f & PF.CHILD) === 0) hit[0] += slot.armorDamage * Math.min(pl.bonusArmor, slot.armorLeft);
      // Damage by distance from you (Magnesium), and a returning pick's harder way back (Long Throw).
      if (slot.reachFar2 > 0 || slot.reachNear2 > 0) { const rx = E.x[e] - pl.x, ry = E.y[e] - pl.y, r2 = rx * rx + ry * ry; if (slot.reachFar2 > 0 && r2 > slot.reachFar2) hit[0] *= slot.reachFarMul; else if (r2 < slot.reachNear2) hit[0] *= slot.reachNearMul; }
      if ((f & PF.RETURNING) !== 0 && slot.fx.returnMul) hit[0] *= slot.fx.returnMul.mul;
      if (slot.fx.stick && (f & PF.CHILD) === 0) hit[0] *= slot.fx.stick.damageMul;
      // A Salt Pan shard's kill never shatters again (sim/holds.js shatterAt).
      world.shardHit = slot.shatter !== null && slot.shatter !== undefined && P.list[i] === slot.shardList ? 1 : 0;
      applyHit(world, slot, P.list[i], e, i);
      world.shardHit = 0;
      // Rime: a pick freezes what it hits on its way back (fx.returnFreeze, { status: 'freeze', duration }).
      if ((f & PF.RETURNING) !== 0 && slot.fx.returnFreeze) applyStatus(world, e, slot.fx.returnFreeze, slot.index);
      const sxf = slot.fx;
      if (sxf.skewer) skewerCatch(world, i, e);
      if (sxf.frenzy && E.rotT[e] > 0) { const fs = slot.fs; if (fs.frenzy < sxf.frenzy.max) fs.frenzy++; fs.frenzyUntil = tick + Math.round(sxf.frenzy.sec * TPS); }
      if (sxf.stick && (f & PF.CHILD) === 0) { stickHit(world, slot, i, e); break; }
      if (sxf.latch) latchOn(world, slot, i, e);
      if (P.pierce[i] > 0) {
        P.pierce[i]--;
        if (P.pierce[i] === 0) { P.flags[i] |= PF.DEAD; break; }
      }
    }
    if (P.motion[i] === MOTION.arc) {
      // Landed on open ground (it hit nothing): its pool lands all the same (a flask thrown behind
      // you, or at an enemy that walked away, still leaves its burning oil).
      if (P.hitPos[i] === 0 && (f & PF.CHILD) === 0) landPool(world, slot, P.x[i], P.y[i], P.damage[i]);
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
      // Skipping Flask: it bounces on and lands again, the way it was going.
      if (slot.fx.skip && ((f & PF.CHILD) === 0 || P.hops[i] > 0)) {
        const sk = slot.fx.skip, left = (f & PF.CHILD) === 0 ? sk.count : P.hops[i];
        let sx = P.x[i] - P.px[i], sy = P.y[i] - P.py[i];
        const sd = Math.sqrt(sx * sx + sy * sy);
        if (sd > 1e-3) { sx /= sd; sy /= sd; } else { sx = pl.fx; sy = pl.fy; }
        const o = shotOpts();
        o.motion = MOTION.arc; o.flags = PF.CHILD; o.list = slot.list; o.damage = P.damage[i]; o.radius = P.radius[i]; o.pierce = -1;
        o.m0 = P.x[i] + sx * sk.dist; o.m1 = P.y[i] + sy * sk.dist; o.m2 = sk.flight; o.life = sk.flight + DT; o.hops = left - 1;
        shotAt(world, P.x[i], P.y[i], sx, sy, 0);
        spawnShot(world, slot, o);
      }
      P.flags[i] |= PF.DEAD;
    }
  }
  // Remove spent shots (walking backward: swap-with-last). A Skewer or a Tether acts as its shot ends.
  for (let i = P.count - 1; i >= 0; i--) {
    if ((P.flags[i] & PF.DEAD) === 0) continue;
    if (P.slot[i] < HIT_SLOTS && (P.flags[i] & PF.HOSTILE) === 0) { const sl = slots[P.slot[i]]; if (sl && sl.endForms) shotEnded(world, sl, i); }
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
        // A status it hits harder (Dazzle, Hamstring, Shatter), and the build's rules on a hit.
        if (slot.bonus !== null) dmg *= bonusMul(E, e, slot.bonus);
        if (slot.heavy && (E.flags[e] & (EF.ELITE | EF.BOSS)) !== 0) dmg *= 1.25;                    // Ballast
        const R = world.rules, pp = world.player;
        if (R.stern && (E.x[e] - pp.x) * pp.fx + (E.y[e] - pp.y) * pp.fy < 0) dmg *= 1.25;           // the Stern Lantern
        if (R.sealegs && !crit && pp.moveT >= 2 && world.tick - slot.fs.critAt >= 2 * TPS && slot.index < RELIC_SLOT) { slot.fs.critAt = world.tick; dmg *= s.critMult; crit = true; }   // Sea Legs (moving, its own clock: ruling 16)
        // Death Knell: a wave finishes ordinary enemies low on health.
        if (slot.fx.knell && (E.flags[e] & (EF.ELITE | EF.BOSS)) === 0 && E.hp[e] < E.maxHp[e] * slot.fx.knell.below && dmg < E.hp[e]) dmg = E.hp[e] + 1;
        // A Sea or Frost hit on a burning enemy (the Quench Bucket; counted for its feat).
        if (slot.quenches && E.burnT[e] > 0) quench(world, e);
        num[0] = dmg;
        damageEnemyR(world, e, slot.index, crit);
        // Tar on it goes off when another weapon hits it (Tarred).
        if (E.tarT[e] > 0 && E.tarSlot[e] !== slot.index && slot.index < HIT_SLOTS && (E.flags[e] & EF.DEAD) === 0) tarBurst(world, e, 1);
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
        // (A burn as a share of the hit: Phosphor, Sunfire, a line's burning ground.)
        if (fx.dpsMul > 0) { BURNX.dps = damage * fx.dpsMul + (fx.dps ?? 0); BURNX.duration = fx.duration; applyStatus(world, e, BURNX, slot.index); }
        else applyStatus(world, e, fx, slot.index);
        break;
      case FX.pull: {
        const p = world.player;
        let tx = p.x, ty = p.y;
        if (fx.toOrigin > 0 && slot.pots !== null) { const og = world.scratch.open; originOf(world, slot, 0, og); tx = og[0]; ty = og[1]; }   // Drag Under: back to the pot
        const dx = tx - E.x[e], dy = ty - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) { num[1] = dx / d; num[2] = dy / d; num[3] = fx.strength ?? 1; impulseR(world, e); }
        break;
      }
      case FX.split:
        if (proj >= 0 && (world.projectiles.flags[proj] & (PF.CHILD | PF.SPLIT)) === 0 && (!fx.onReturn || (world.projectiles.flags[proj] & PF.RETURNING) !== 0)) { world.projectiles.flags[proj] |= PF.SPLIT; splitShot(world, slot, proj, e, fx, hx, hy, damage); }
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
        Z.damage[z] = fx.damageMul > 0 ? damage * fx.damageMul : fx.damage ?? 2;
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
      case FX.daze: world.scratch.hold[0] = fx.duration; dazeEnemy(world, e); break;
      // Knock-On, Heavy Iron: what it knocks back hurts the first enemy it meets for `mul` of the hit (sim/enemies.js).
      case FX.bump: if ((E.flags[e] & (EF.DEAD | EF.BOSS)) === 0) { E.bumpT[e] = fx.sec ?? 0.5; E.bumpDmg[e] = damage * (fx.mul ?? 0); E.bumpDaze[e] = fx.daze ?? 0; E.bumpSlot[e] = slot.index; } break;
      // Wide Spring: a frozen enemy a spout hits is thrown.
      case FX.heave: if (E.freezeT[e] > 0 && (E.flags[e] & (EF.DEAD | EF.BOSS)) === 0) { num[1] = dirX; num[2] = dirY; num[3] = fx.strength; impulseR(world, e); } break;
      // The Anchor Chain: a hit on a dazed enemy (one the Grapnel hauled in, or one stunned) gaffs it:
      // it takes `amp` more from everything for `sec` (ruling 19 RE: her hook and her anchor, one build).
      case FX.gaff: if ((fx.any || E.dazeT[e] > 0) && (E.flags[e] & EF.DEAD) === 0) { const G = world.tuning.status.gaff; if (E.openT[e] < G.sec) E.openT[e] = G.sec; if (E.openAmp[e] < G.amp) E.openAmp[e] = G.amp; } break;
      case FX.tar: if ((E.flags[e] & EF.DEAD) === 0) { world.scratch.hold[0] = damage; tarEnemy(world, slot, e, fx); } break;
      case FX.fever: if ((E.flags[e] & EF.DEAD) === 0) feverEnemy(world, e, fx); break;
      case FX.spill: spill(world, slot, e, fx, damage); break;
      case FX.spike:
        // Storm Glass: only a chain's hop leaves a spike (never the bolt's own hit).
        if (proj >= 0 && (world.projectiles.flags[proj] & PF.CHILD) !== 0 && world.projectiles.motion[proj] === MOTION.chain) {
          const hold = world.scratch.hold;
          hold[0] = hx; hold[1] = hy; hold[2] = damage;
          spikeAt(world, slot, fx);
        }
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

const BURNX = { status: 'burn', dps: 0, duration: 0 }; // reused: applyStatus copies what it keeps

/** What a slot's `bonus` multiplies a hit on enemy e by: more against one that is dazed, burning, slowed or frozen, or rotting. */
function bonusMul(E, e, b) {
  if (Array.isArray(b)) { let m = 1; for (let k = 0; k < b.length; k++) m *= bonusMul(E, e, b[k]); return m; }
  switch (b.status) {
    case 'daze': return E.dazeT[e] > 0 ? b.mul : 1;
    case 'burn': return E.burnT[e] > 0 ? b.mul : 1;
    case 'slow': return E.slowT[e] > 0 || E.freezeT[e] > 0 ? b.mul : 1;
    case 'freeze': return E.freezeT[e] > 0 ? b.mul : 1;
    case 'rot': return E.rotT[e] > 0 ? b.mul : 1;
    default: return 1;
  }
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
  // Copper Wire: +hops for anything that chains (the weapon's hops stat), on the chain's first hit.
  const hopsLeft = proj >= 0 && P.hops[proj] >= 0 ? P.hops[proj] : (fx.hops ?? 3) + (slot.stats.hops ?? 0);
  if (hopsLeft <= 0) {
    // The chain has run out: Closed Circuit hits everything it touched again; Copper Wire's rule bursts the last hop.
    if (proj >= 0 && P.hops[proj] >= 0) {
      if (slot.fx.recoil) recoilRing(world, slot, proj, damage);
      if (world.rules.copper) { const xr = world.scratch.xreg; xr[0] = E.x[e]; xr[1] = E.y[e]; xr[2] = 20; xr[3] = damage * 0.5; xr[4] = 0; explodeR(world, slot.index, e); }
    }
    return;
  }
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

/** The ground a lobbed shot leaves where it lands with no enemy under it: its list's first zone, as a hit would lay it. */
function landPool(world, slot, x, y, damage) {
  const list = world.fxLists[slot.list];
  for (let k = 0; k < list.length; k++) {
    const fx = list[k];
    if (fx.t !== FX.zone) continue;
    const z = groundAt(world, slot.index, x, y, (fx.radius ?? 14) * slot.stats.area, fx.duration ?? 2, fx.damageMul > 0 ? damage * fx.damageMul : fx.damage ?? 2, fx.interval ?? 0.4, fx.zoneList);
    if (z >= 0) { world.zones.def[z] = slot.defIndex ?? 0xffff; if (slot.fx && slot.fx.fuel) fuelLink(world, slot, z); }
    return;
  }
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
    if (e === exclude || (E.flags[e] & EF_GONE) !== 0) continue;
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

/** Move zone z toward the nearest live enemy within f.range, at f.speed px a second (Creeping Brine). */
function driftZone(world, z, f) {
  const Z = world.zones, E = world.enemies;
  const e = world.enemyHash.nearest(Z.x[z], Z.y[z], f.range, E.flags, EF_GONE, -1);
  if (e < 0) return;
  const dx = E.x[e] - Z.x[z], dy = E.y[e] - Z.y[z], d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) return;
  const step = f.speed * DT < d ? f.speed * DT : d;
  Z.x[z] += (dx / d) * step; Z.y[z] += (dy / d) * step;
  Z.flags[z] |= ZF.DRIFT;
}

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
    if (kind === ZONE.STRIKE) { strikeZoneTick(world, z); continue; }       // the storm's rings (sim/storm.js)
    if (kind === ZONE.PUDDLE) {
      // Creeping Brine: a weapon's puddles creep toward the nearest enemy.
      const ps = Z.slot[z] < HIT_SLOTS ? slots[Z.slot[z]] : null;
      if (ps && ps.fx && Z.life[z] > 0) {
        if (ps.fx.drift) driftZone(world, z, ps.fx.drift);
        // Seep: the puddle bursts again where it lies. Standing Water: one you stand in doesn't dry.
        if (ps.fx.seep && Z.age[z] > 0.2 && Math.round(Z.age[z] * TPS) % Math.round(ps.fx.seep.every * TPS) === 0) seepPulse(world, ps, z);
        if (ps.fx.wade && Z.age[z] < ps.stats.duration * ps.fx.wade.max) { const wx = pl.x - Z.x[z], wy = pl.y - Z.y[z]; if (wx * wx + wy * wy <= Z.radius[z] * Z.radius[z]) Z.life[z] += DT; }
      }
      // Brine puddles pulse together, on the world's clock, so two reaching one enemy freeze it.
      if (Z.life[z] > 0 && tick % Z.interval[z] === 0) puddlePulse(world, z);
      continue;
    }
    if (kind === ZONE.SPIKE) { if (Z.life[z] > 0) spikeTick(world, z); continue; }
    if (Z.life[z] <= 0) continue;
    const slot = slots[Z.slot[z]];
    if (slot === null || slot === undefined) { Z.life[z] = 0; continue; }
    let qx = Z.x[z], qy = Z.y[z], qr = Z.radius[z];
    let inner = -1, reverse = false, stand = false, damageMul = 1, bx0 = pl.x, by0 = pl.y;
    if (kind === ZONE.AURA) {
      Z.x[z] = qx = pl.x; Z.y[z] = qy = pl.y;
    } else if (kind === ZONE.WAVE) {
      stand = (Z.flags[z] & ZF.STAND) !== 0;
      const dur = stand ? Z.ang[z] : Z.age[z] + Z.life[z];
      const u = Math.min(1, Z.age[z] / (dur > 0 ? dur : 1));
      stand = stand && u >= 1;   // (Slack Water: at its reach it stands, and hurts what crosses it by the slot's own pace)
      reverse = (Z.flags[z] & ZF.REVERSE) !== 0;
      if (reverse) {
        // Breakers: the ring rolls in from its reach toward you (or its buoy); it holds what's inside it.
        if ((Z.flags[z] & ZF.FIXED) === 0) { Z.x[z] = pl.x; Z.y[z] = pl.y; }
        qx = Z.x[z]; qy = Z.y[z];
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
      // (A Prism's forks start at the enemy the beam split on, and stay there.)
      if ((Z.flags[z] & ZF.FIXED) === 0) { Z.x[z] = pl.x; Z.y[z] = pl.y; } else { bx0 = Z.x[z]; by0 = Z.y[z]; }
      if ((Z.flags[z] & ZF.SWEEP) !== 0) {
        // Full Circle: round once over the beam's life, from where it first pointed.
        const dur = Z.age[z] + Z.life[z];
        const sc = world.scratch.sc;
        sincosInto(Z.ang[z] + TAU * Math.min(1, Z.age[z] / (dur > 0 ? dur : 1)), sc, 0);
        Z.dx[z] = sc[1]; Z.dy[z] = sc[0];
      }
      qx = bx0 + Z.dx[z] * Z.length[z] * 0.5; qy = by0 + Z.dy[z] * Z.length[z] * 0.5;
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
      Z.hitN[z] = 0;   // (its hit cap is a pulse's)
      if ((Z.flags[z] & ZF.FLARE) !== 0) { Z.flags[z] &= ~ZF.FLARE; damageMul = slot.fx && slot.fx.fuel ? slot.fx.fuel.flareMul : 1; }
    }
    // (A tether hits each enemy at most every 0.3 s, whatever its harpoon's own cooldown.)
    const cd = kind === ZONE.GROUND ? 0 : kind === ZONE.TETHER ? Math.max(18, slot.hitCdTicks) : slot.hitCdTicks;
    // Like a shot's pierce: a wave, a beam, or a tether hits at most so many times over its life, and
    // a pool at most so many enemies a pulse, so a crowd of a thousand doesn't multiply what one of
    // them does (the late runaway, Nov 17: Ground Swell's pools under a 3.9x Area ring).
    const ZH = world.tuning.caps.weapon.zoneHits;
    const hitCap = !ZH ? 0 : kind === ZONE.WAVE ? ZH.wave : kind === ZONE.BEAM ? ZH.beam : kind === ZONE.TETHER ? ZH.tether : kind === ZONE.GROUND ? (ZH.ground ?? 0) : 0;
    if (hitCap > 0 && Z.hitN[z] >= hitCap) continue;
    q[0] = qx; q[1] = qy; q[2] = qr;
    const m = world.enemyHash.queryR(q, near, -1);
    for (let k = 0; k < m; k++) {
      const e = near[k];
      if ((E.flags[e] & EF_GONE) !== 0) continue;
      const ex = E.x[e], ey = E.y[e];
      let dx = ex - Z.x[z], dy = ey - Z.y[z];
      if (kind === ZONE.WAVE) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (reverse) {
          if (d + E.radius[e] < inner) continue; // the ring hasn't reached it yet
          dx = -dx; dy = -dy;                     // dragged in, toward you
        } else if (d + E.radius[e] < inner) continue; // the ring has passed it
        // A cone (the Fog Horn): only what lies within its half-angle of its way.
        if ((Z.flags[z] & ZF.CONE) !== 0 && d > E.radius[e] && (dx * Z.dx[z] + dy * Z.dy[z]) < Z.length[z] * d) continue;
      } else if (kind === ZONE.BEAM || kind === ZONE.TETHER) {
        // Distance from the enemy to the beam's (or the chain's) segment, from you.
        const bx = ex - bx0, by = ey - by0;
        const t = Math.max(0, Math.min(Z.length[z], bx * Z.dx[z] + by * Z.dy[z]));
        const cx = bx0 + Z.dx[z] * t - ex, cy = by0 + Z.dy[z] * t - ey;
        const w = Z.thickness[z] * 0.5 + E.radius[e];
        if (cx * cx + cy * cy > w * w) continue;
        dx = Z.dx[z]; dy = Z.dy[z];
      }
      const nh = e * HIT_SLOTS + Z.slot[z];
      if (kind === ZONE.WAVE && stand) {
        const scd = Math.max(1, Math.round(slot.fx.stand.every * TPS));
        if (E.nextHit[nh] > tick) continue;
        E.nextHit[nh] = tick + scd;
      } else if (kind === ZONE.WAVE) {
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
      hit[0] = Z.damage[z] * damageMul; hit[1] = stand ? 0 : Z.knockback[z]; hit[2] = dx; hit[3] = dy; hit[4] = ex; hit[5] = ey;
      if (slot.reachFar2 > 0 || slot.reachNear2 > 0) { const rx = ex - pl.x, ry = ey - pl.y, r2 = rx * rx + ry * ry; if (slot.reachFar2 > 0 && r2 > slot.reachFar2) hit[0] *= slot.reachFarMul; else if (r2 < slot.reachNear2) hit[0] *= slot.reachNearMul; }
      // A ground's pulse says so to the kill it makes (Wards come only from the weapon's own kills).
      world.zonePulse = kind === ZONE.GROUND ? 1 : 0;
      applyHit(world, slot, Z.list[z], e, -1);
      world.zonePulse = 0;
      // Icy Swell (C1b, ruling 23 WD): the far edge of a wave freezes what it catches there.
      if (kind === ZONE.WAVE && !reverse && !stand && slot.fx.crest && Z.radius[z] >= slot.fx.crest.from * Z.maxRadius[z]) {
        applyStatus(world, e, { status: 'freeze', duration: slot.fx.crest.freeze }, Z.slot[z]);
      }
      // Wrecker's Horn: what the note leaves lost walks to where the note ends, not away from you.
      if (kind === ZONE.WAVE && slot.fx.wreck && E.lostT[e] > 0 && (Z.flags[z] & ZF.CONE) !== 0) {
        E.lostX[e] = Math.max(1, Z.x[z] + Z.dx[z] * Z.maxRadius[z]); E.lostY[e] = Z.y[z] + Z.dy[z] * Z.maxRadius[z];
      }
      if (hitCap > 0 && ++Z.hitN[z] >= hitCap) break;
    }
    // Spreading Oil: a pool an enemy walked through spreads, up to `max` times its size.
    if (kind === ZONE.GROUND && slot.fx.poolGrow && m > 0 && Z.slot[z] === slot.index && Z.style[z] === ZSTYLE.OIL) {
      const g = slot.fx.poolGrow, top = Z.maxRadius[z] * g.max;
      if (Z.radius[z] < top) Z.radius[z] = Math.min(top, Z.radius[z] * (1 + g.per));
    }
  }
  for (let z = Z.count - 1; z >= 0; z--) {
    if (Z.life[z] > 0) continue;
    if (Z.slot[z] < HIT_SLOTS) {
      const sl = slots[Z.slot[z]];
      if (sl && sl.fs) zoneGone(world, sl, z);
      if (sl && Z.kind[z] === ZONE.SPIKE && sl.spikes > 0) sl.spikes--;
    }
    Z.remove(z);
  }
}

