// The storm, the Eye, and the glass pillars (ARCHITECTURE §5.17; docs/design/SALT_MARSH.md).
//
// The storm (the map's `storm`, with the run's 'storm' layer: after the first kill of the Old
// Grey): in its windows (5:30 to 8:00 and 15:30 to 18:00 at high water) and all through overtime,
// bursts of warned rings land on the thickest crowd standing on salt. Each ring warns `warn` s
// (rule 1: a ring means something lands here), hits enemies hard and you lightly, and every
// `glassEvery`-th strike leaves Salt Glass. Its draws come from its own random stream ('storm'),
// so the storm never moves the spawns or the loot.
//
// The Eye (the map's `eye`, a timeline event with the same layer): spawns stop, warned rings fall
// on the leftover horde, and gems and Salt Glass cover the ground around you. Earned quiet before
// the last boss.
//
// Glass pillars: where the Salt Widow's lightning lands on salt, a pillar rises for `sec` s (at
// most `max` standing, never within `near` tiles of you, never on your path back to the landing:
// sim/marsh.js onPath), so they wall in the horde, not you. They fall on any map.
//
// A strike is a zone (ZONE.STRIKE) with its own fields: pdmg (what it does to you), src (STRIKE_SRC),
// gift (1 Salt Glass, 2 a pillar if it lands on salt). Strikes never hurt the Salt Widow (an enemy
// marked `stormproof`), who brings them.

import { DT, TPS, EF, EF_GONE, ZONE, RELIC_SLOT, PK } from './constants.js';
import { EV, TELE, SIGHT, STRIKE_SRC, TIER } from './events.js';
import { TILE, GROUND } from './terrain.js';
import { damageEnemyR } from './enemies.js';
import { hurtPlayer } from './player.js';
import { spawnGem, spawnPickup } from './pickups.js';
import { crowdPoint } from './holds.js';
import { onPath, groundDirty } from './marsh.js';
import { sightThing } from './sight.js';
import { sincosInto, TAU } from '../lib/fmath.js';
import { tellStrike } from './attacks.js';

const GIFT_GLASS = 1, GIFT_PILLAR = 2;

/** A map's storm and Eye data, checked: a plain message, or null. */
export function checkStorm(S, E) {
  if (S) {
    if (!Array.isArray(S.windows) || !S.windows.every((w) => w.to > w.from && w.every > 0 && Array.isArray(w.burst) && w.burst[1] >= w.burst[0] && w.burst[0] >= 1)) return 'storm windows need from, to, every, and a burst [min, max]';
    if (!(S.warn >= 0.8)) return 'a storm ring warns at least 0.8 s (rule 1)';
    for (const k of ['radius', 'damage', 'playerDamage', 'glassEvery']) if (!(S[k] > 0)) return `storm ${k} must be above 0`;
    if (S.overtime && !(S.overtime.every > 0 && S.overtime.burst[1] >= S.overtime.burst[0])) return 'storm overtime needs every and a burst';
  }
  if (E) {
    for (const k of ['sec', 'every', 'burst', 'radius', 'damage', 'warn']) if (!(E[k] > 0)) return `the Eye's ${k} must be above 0`;
    if (!(E.warn >= 0.8)) return "the Eye's rings warn at least 0.8 s (rule 1)";
  }
  return null;
}

/** The run's storm: on any map (pillars fall anywhere); its windows only with the map's storm and the run's 'storm' layer. */
export function createStorm(world) {
  const map = world.map, on = world.layers.storm === true;
  const bad = checkStorm(map.storm, map.eye);
  if (bad) throw new Error(`Map ${map.id}: ${bad}`);
  const scale = world.director.timeScale;
  const S = on && map.storm ? map.storm : null;
  // The storm's own picks buffer (x and y pairs), for its largest burst: the map's windows, its
  // overtime, and the Eye's (never another file's register).
  let most = map.eye ? map.eye.burst : 0;
  if (map.storm) {
    for (const w of map.storm.windows) most = Math.max(most, w.burst[1]);
    if (map.storm.overtime) most = Math.max(most, map.storm.overtime.burst[1]);
  }
  return {
    S, eye: map.eye || null, eyeOn: on,
    picks: new Float64Array(2 * Math.max(1, most)),
    windows: S ? S.windows.map((w) => ({ from: w.from * scale, to: w.to * scale, every: w.every, burst: w.burst })) : [],
    next: -1,               // the tick of the next burst (-1: not in a window yet)
    strikes: 0,             // storm strikes so far (every glassEvery-th leaves Salt Glass)
    eyeUntil: -1, eyeNext: 0,
    rng: world.rng.storm,
    pillarTile: new Int32Array(16).fill(-1), pillarUntil: new Int32Array(16), pillars: 0,
  };
}

/** The window the storm is in at run time t, or null (overtime: its own cadence). */
function windowAt(world, St, t) {
  for (const w of St.windows) if (t >= w.from && t < w.to) return w;
  if (world.director.overtime && St.S.overtime) return St.S.overtime;
  return null;
}

/** Step 12, after the director: the storm's bursts, the Eye's rings, and the pillars' time. */
export function stormStep(world) {
  const St = world.storm;
  pillarsStep(world, St);
  const t = world.tick * DT;
  if (St.eyeUntil >= 0) {
    if (world.tick >= St.eyeUntil) {
      St.eyeUntil = -1;
      world.events.push(EV.EYE, world.player.x, world.player.y, 0, 0);
    } else if (world.tick >= St.eyeNext) {
      St.eyeNext = world.tick + Math.round(St.eye.every * TPS);
      burst(world, St, St.eye.burst, St.eye, STRIKE_SRC.EYE, null);
    }
    return;
  }
  if (St.S === null) return;
  const w = windowAt(world, St, t);
  if (w === null) { St.next = -1; return; }
  if (St.next < 0) { St.next = world.tick + Math.round(w.every * TPS * 0.5); sightThing(world, SIGHT.STORM); }
  if (world.tick < St.next) return;
  St.next = world.tick + Math.round(w.every * TPS);
  const n = w.burst[0] + St.rng.int(w.burst[1] - w.burst[0] + 1);
  burst(world, St, n, St.S, STRIKE_SRC.STORM, onSalt);
}

/** The Eye begins (the director's 'eye' event): spawns stop, rings fall, gems and Salt Glass cover the ground. */
export function startEye(world, ev) {
  const St = world.storm, E = St.eye;
  if (!E || !St.eyeOn) return false;
  // Its length follows the run's clock (a short run's Eye is half as long, so it ends before the last boss).
  const sec = (ev.sec ?? E.sec) * world.director.timeScale;
  St.eyeUntil = world.tick + Math.round(sec * TPS);
  St.eyeNext = world.tick + Math.round(E.every * TPS);
  const p = world.player, rng = St.rng, sc = world.scratch.sc, T = world.terrain;
  const mi = world.materialIndex.get('salt_glass');
  for (let k = 0; k < E.gems + E.glass; k++) {
    sincosInto(rng.next() * TAU, sc, 0);
    const r = 40 + rng.next() * 160;
    let x = p.x + sc[1] * r, y = p.y + sc[0] * r;
    if (T.blockedAt(x, y) || x < 16 || y < 16 || x > T.width - 16 || y > T.height - 16) { x = p.x + sc[1] * 24; y = p.y + sc[0] * 24; }
    if (k < E.gems) spawnGem(world, x, y, E.gemXp);
    else if (mi !== undefined) spawnPickup(world, PK.MATERIAL, x, y, mi, 1);
  }
  world.events.push(EV.EYE, p.x, p.y, 1, sec);
  sightThing(world, SIGHT.EYE);
  return true;
}

/** Is the Eye on (the director stops spawning)? */
export function eyeOpen(world) { return world.storm !== null && world.storm.eyeUntil >= 0; }

function onSalt(world, e) {
  const T = world.terrain, E = world.enemies;
  if (T.kinds === null) return false;
  const tx = Math.floor(E.x[e] / TILE), ty = Math.floor(E.y[e] / TILE);
  return tx >= 0 && ty >= 0 && tx < T.cols && ty < T.rows && T.kinds[ty * T.cols + tx] === GROUND.SALT;
}

/**
 * n rings on the thickest crowds (kept apart), each warned, staggered a little. Every ring goes
 * through the crowd pick (the storm's filtered to enemies on salt) and every storm ring counts
 * toward its Salt Glass; with fewer crowds than rings, the burst is that much smaller.
 */
function burst(world, St, n, D, src, filter) {
  const out = world.scratch.v2, picks = St.picks;
  const most = picks.length >> 1;
  let made = 0;
  for (let k = 0; k < n && k < most; k++) {
    if (crowdPoint(world, out, D.radius, 32, picks, made, D.radius * 2, filter) < 0) break;
    picks[2 * made] = out[0]; picks[2 * made + 1] = out[1];
    made++;
    let gift = 0;
    if (src === STRIKE_SRC.STORM && ++St.strikes % D.glassEvery === 0) gift |= GIFT_GLASS;
    strikeAt(world, out[0], out[1], D.radius, D.warn + k * 0.15, D.damage, D.playerDamage ?? 0, src, gift);
  }
  return made;
}

/** A warned ring of lightning at (x, y): it lands after `warn` s (a STRIKE zone). Returns the zone, or -1. */
export function strikeAt(world, x, y, radius, warn, damage, pdmg, src, gift) {
  const Z = world.zones, z = Z.alloc();
  if (z < 0) return -1;
  const w = Math.max(warn, world.tuning.enemies.telegraphMin);
  Z.x[z] = x; Z.y[z] = y; Z.kind[z] = ZONE.STRIKE; Z.slot[z] = RELIC_SLOT; Z.list[z] = 0;
  Z.radius[z] = Z.maxRadius[z] = radius; Z.warn[z] = w; Z.life[z] = w + 0.3;
  Z.damage[z] = damage; Z.pdmg[z] = pdmg; Z.src[z] = src; Z.gift[z] = gift; Z.knockback[z] = 0;
  Z.def[z] = 0xffff;
  if (pdmg > 0) tellStrike(world, z, x, y, Math.round(w * TPS), radius);   // its warning (MAJOR) and who it's from (0.9.0, sim/attacks.js)
  else {
    // One that can't hurt you (W4: a crane's load, a cairn's storm): an ordinary dim tell, never a full one.
    world.events.push(EV.TELEGRAPH, x, y, TELE.RING, Math.round(w * TPS), radius, 0);
    world.events.push(EV.TELE_TIER, x, y, TIER.DIM, -1, Math.round(w * TPS), -1);
  }
  return z;
}

/** A strike's turn (zonesTick): it waits out its warning, then lands once. */
export function strikeZoneTick(world, z) {
  const Z = world.zones;
  if (Z.warn[z] < 0) return;            // landed: its scorch lingers a moment for the view
  Z.warn[z] -= DT;
  if (Z.warn[z] > 0) return;
  Z.warn[z] = -1;
  const x = Z.x[z], y = Z.y[z], r = Z.radius[z];
  const E = world.enemies, q = world.scratch.qreg, near = world.scratch.blast, stormproof = world.enemyStormproof;
  q[0] = x; q[1] = y; q[2] = r;
  const m = world.enemyHash.queryR(q, near, -1);
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF_GONE) !== 0 || stormproof[E.type[e]] === 1) continue;   // never the Salt Widow
    world.scratch.num[0] = Z.damage[z];
    damageEnemyR(world, e, RELIC_SLOT, false);
  }
  const p = world.player, dx = p.x - x, dy = p.y - y, rr = r + world.tuning.player.radius;
  if (Z.pdmg[z] > 0 && dx * dx + dy * dy <= rr * rr) hurtPlayer(world, Z.pdmg[z], x, y);
  let glass = 0, pillar = 0;
  if ((Z.gift[z] & GIFT_GLASS) !== 0) {
    const mi = world.materialIndex.get('salt_glass');
    if (mi !== undefined) { spawnPickup(world, PK.MATERIAL, x, y, mi, 1); glass = 1; }
  }
  if ((Z.gift[z] & GIFT_PILLAR) !== 0) pillar = raisePillar(world, Math.floor(x / TILE), Math.floor(y / TILE)) ? 1 : 0;
  world.events.push(EV.STRIKE, x, y, r, Z.src[z], glass, pillar);
}

/**
 * A glass pillar on tile (tx, ty), if it may rise there: salt, dry, no pillar yet, fewer than `max`
 * standing, at least `near` tiles from you, and not on your path back (rule 8). Returns true if it rose.
 */
export function raisePillar(world, tx, ty) {
  const St = world.storm, P = world.tuning.storm.pillar, T = world.terrain;
  if (T.kinds === null || tx < 0 || ty < 0 || tx >= T.cols || ty >= T.rows) return false;
  const i = ty * T.cols + tx;
  if (T.kinds[i] !== GROUND.SALT || T.wet[i] === 1 || T.pillar[i] === 1 || T.base[i] === 1) return false;
  if (St.pillars >= P.max) return false;
  const p = world.player, ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
  if (Math.max(Math.abs(tx - ptx), Math.abs(ty - pty)) < P.near) return false;
  if (onPath(world, i)) return false;
  let slot = 0;
  while (slot < St.pillarTile.length && St.pillarTile[slot] >= 0) slot++;
  if (slot >= St.pillarTile.length) return false;
  St.pillarTile[slot] = i; St.pillarUntil[slot] = world.tick + Math.round(P.sec * TPS); St.pillars++;
  T.pillar[i] = 1;
  groundDirty(world);
  world.events.push(EV.PILLAR, (tx + 0.5) * TILE, (ty + 0.5) * TILE, 1);
  sightThing(world, SIGHT.PILLAR);
  return true;
}

function pillarsStep(world, St) {
  if (St.pillars === 0) return;
  for (let k = 0; k < St.pillarTile.length; k++) {
    const i = St.pillarTile[k];
    if (i < 0 || world.tick < St.pillarUntil[k]) continue;
    dropPillar(world, St, k);
  }
}

function dropPillar(world, St, k) {
  const T = world.terrain, i = St.pillarTile[k];
  St.pillarTile[k] = -1; St.pillars--;
  T.pillar[i] = 0;
  groundDirty(world);
  world.events.push(EV.PILLAR, (i % T.cols + 0.5) * TILE, (Math.floor(i / T.cols) + 0.5) * TILE, 0);
}

/**
 * Rule 8 (sim/marsh.js pass): the held chain home now runs through a standing pillar (the search
 * counts pillars as open, since they fall): those pillars fall at once, so none stands on the way
 * home. Returns how many fell.
 */
export function pillarsOffPath(world) {
  const St = world.storm;
  if (St === null || St.pillars === 0) return 0;
  let fell = 0;
  for (let k = 0; k < St.pillarTile.length; k++) {
    const i = St.pillarTile[k];
    if (i >= 0 && onPath(world, i)) { dropPillar(world, St, k); fell++; }
  }
  return fell;
}

/** Hash the storm's state (world.js hashWorld). */
export function hashStorm(St, h) {
  h.int(-12).int(St.next).int(St.strikes).int(St.eyeUntil).int(St.eyeNext).int(St.pillars);
  for (let k = 0; k < St.pillarTile.length; k++) if (St.pillarTile[k] >= 0) h.int(St.pillarTile[k]).int(St.pillarUntil[k]);
}

export { GIFT_GLASS, GIFT_PILLAR };
