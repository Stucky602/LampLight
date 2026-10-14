// Gems, the magnet, and pickups (ARCHITECTURE §5.3, §6.3, §10.3).
//
// Gems: every kill drops experience. Inside the magnet radius a gem is pulled in: it pops away
// for a moment, then accelerates toward you (the "XP vacuum"). Past gemMergeAt gems on the
// field, new experience goes into one big gem instead, so a long run can't flood the pool.
// Pickups: materials (pulled like gems), healing, the magnet (pulls every gem on the map), and
// chests (walk over them; they don't move).

import { DT, EF, PK } from './constants.js';
import { NO_HANDLE } from './pools.js';
import { EV, PICK } from './events.js';
import { gainXp, heal } from './player.js';
import { runHooks } from './hooks.js';
import { openChest } from './chests.js';
import { sincosInto, TAU } from '../lib/fmath.js';

export const GEM_FIELDS = {
  x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array,
  value: Float32Array, state: Uint8Array, speed: Float32Array, big: Uint8Array,
};

export const PICKUP_FIELDS = {
  x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array,
  kind: Uint8Array, a: Float32Array, b: Float32Array, state: Uint8Array, speed: Float32Array,
};

/** Drop experience at (x, y). */
export function spawnGem(world, x, y, value) {
  const G = world.gems;
  if (G.count >= world.tuning.xp.gemMergeAt) {
    let m = G.resolve(world.mergeGem);
    if (m < 0) {
      m = G.alloc();
      if (m < 0) { gainXp(world, value); return; }
      G.x[m] = x; G.y[m] = y; G.px[m] = x; G.py[m] = y;
      G.big[m] = 1;
      world.mergeGem = G.handle(m);
    }
    G.value[m] += value;
    return;
  }
  const i = G.alloc();
  if (i < 0) { gainXp(world, value); return; }
  G.x[i] = x; G.y[i] = y; G.px[i] = x; G.py[i] = y;
  G.value[i] = value;
}

// Pool slots materials never take, so heals, magnets, and chests always have room.
export const PICKUP_RESERVE = 32;

/**
 * Drop a pickup: a material (a = material index, b = amount), a heal (a = amount), the magnet,
 * or a chest (a = chest kind). When the pool is full, materials past the reserve go straight
 * into the haul, a chest opens where it fell, and a heal or magnet takes the place of the heal
 * or magnet lying farthest from you. (Only if all 256 slots held chests and materials would a
 * heal be dropped; the pool counts it in `refused`.)
 * Returns the pickup's index, or -1 if it was applied at once or dropped.
 */
export function spawnPickup(world, kind, x, y, a = 0, b = 0) {
  const P = world.pickups;
  if (kind === PK.MATERIAL && P.count >= P.capacity - PICKUP_RESERVE) {
    addMaterial(world, a, b);
    world.events.push(EV.PICKUP, x, y, PICK.MATERIAL, a);
    return -1;
  }
  if (P.count >= P.capacity) {
    if (kind === PK.CHEST) { openChest(world, a, x, y); return -1; }
    const far = farthestLoose(world); // (materials never get here: they stop at the reserve)
    if (far < 0) { P.refused++; return -1; }
    P.remove(far);
  }
  const i = P.alloc();
  P.x[i] = x; P.y[i] = y; P.px[i] = x; P.py[i] = y;
  P.kind[i] = kind; P.a[i] = a; P.b[i] = b;
  return i;
}

/** The heal or magnet lying farthest from the player, or -1 (ties: the lower index). */
function farthestLoose(world) {
  const P = world.pickups, p = world.player;
  let best = -1, bestD2 = -1;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] !== PK.HEAL && P.kind[i] !== PK.MAGNET) continue;
    const dx = P.x[i] - p.x, dy = P.y[i] - p.y, d2 = dx * dx + dy * dy;
    if (d2 > bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

/** Material drops from a kill: the enemy's own table, then the map's common drops (regular enemies) or elite drops. */
export function rollDrops(world, e, def, flags) {
  const E = world.enemies;
  const rng = world.rng.loot;
  const luck = world.stats.luck;
  const x = E.x[e], y = E.y[e];
  if ((flags & EF.SWARM) === 0 || (flags & EF.ELITE) !== 0) {
    dropTable(world, def.drops, x, y, rng, luck);
    const map = world.map;
    if ((flags & EF.ELITE) !== 0) dropTable(world, map.eliteDrops, x, y, rng, luck);
    else if ((flags & (EF.BOSS | EF.MINION)) === 0) dropTable(world, map.commonDrops, x, y, rng, luck);
  }
  // Healing and the magnet: rare, from regular enemies only.
  if ((flags & (EF.BOSS | EF.MINION | EF.SWARM)) === 0) {
    const pk = world.map.pickups;
    if (pk) {
      if (rng.chance(pk.heal * luck)) spawnPickup(world, PK.HEAL, x, y, pk.healAmount ?? 30, 0);
      else if (rng.chance(pk.magnet * luck)) spawnPickup(world, PK.MAGNET, x, y, 0, 0);
    }
  }
}

function dropTable(world, table, x, y, rng, luck) {
  if (!table) return;
  const sc = world.scratch.sc;
  for (let k = 0; k < table.length; k++) {
    const d = table[k];
    const chance = d.chance >= 1 ? 1 : d.chance * luck;
    if (!rng.chance(chance)) continue;
    const lo = d.amount ? d.amount[0] : 1, hi = d.amount ? d.amount[1] : 1;
    const amount = lo + rng.int(hi - lo + 1);
    const mi = world.materialIndex.get(d.material);
    // Spread multiple drops a little so they don't stack on one pixel.
    sincosInto(rng.next() * TAU, sc, 0);
    spawnPickup(world, PK.MATERIAL, x + sc[1] * 6, y + sc[0] * 6, mi, amount);
  }
}

/**
 * Materials collected count toward the run's haul, multiplied by greed and the overtime
 * multiplier as they are when you pick them up (greed taken at 19:59 doesn't grow the whole run).
 */
export function addMaterial(world, materialIndex, amount) {
  world.result.materialsRaw[materialIndex] += amount * world.stats.greed * world.director.materialMul;
}

/** Step 10: gems and pickups: the magnet pulls, touching collects. */
export function pickupsStep(world) {
  const p = world.player, G = world.gems;
  const X = world.tuning.xp, T = world.tuning.player;
  const magR = X.magnetRadius * world.stats.magnet;
  const magR2 = magR * magR;
  const pick = T.pickupRadius + T.radius;
  const pick2 = pick * pick;
  const all = world.magnetAll > 0;
  if (all) world.magnetAll -= DT;
  const accel = X.magnetAccel * DT, maxSp = X.magnetMaxSpeed, pop = -X.magnetPop;

  for (let i = G.count - 1; i >= 0; i--) {
    G.px[i] = G.x[i]; G.py[i] = G.y[i];
    const dx = p.x - G.x[i], dy = p.y - G.y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 <= pick2) { collectGem(world, i); continue; }
    if (G.state[i] === 0) {
      if (d2 > magR2 && !all) continue;
      G.state[i] = 1;
      G.speed[i] = pop;
    }
    let sp = G.speed[i] + accel;
    if (sp > maxSp) sp = maxSp;
    G.speed[i] = sp;
    const d = Math.sqrt(d2);
    const step = sp * DT;
    if (step >= d) { collectGem(world, i); continue; }
    G.x[i] += (dx / d) * step; G.y[i] += (dy / d) * step;
  }

  const P = world.pickups;
  for (let i = P.count - 1; i >= 0; i--) {
    P.px[i] = P.x[i]; P.py[i] = P.y[i];
    const dx = p.x - P.x[i], dy = p.y - P.y[i];
    const d2 = dx * dx + dy * dy;
    const kind = P.kind[i];
    if (d2 <= pick2) { collectPickup(world, i); continue; }
    // Materials, healing, and the magnet fly to you like gems; chests stay put.
    if (kind === PK.CHEST) continue;
    if (P.state[i] === 0) {
      if (d2 > magR2) continue;
      P.state[i] = 1;
      P.speed[i] = pop;
    }
    let sp = P.speed[i] + accel;
    if (sp > maxSp) sp = maxSp;
    P.speed[i] = sp;
    const d = Math.sqrt(d2);
    const step = sp * DT;
    if (step >= d) { collectPickup(world, i); continue; }
    P.x[i] += (dx / d) * step; P.y[i] += (dy / d) * step;
  }
}

function collectGem(world, i) {
  const G = world.gems;
  const x = G.x[i], y = G.y[i], v = G.value[i];
  if (G.big[i] !== 0) world.mergeGem = NO_HANDLE;
  G.remove(i);
  gainXp(world, v);
  world.result.gems++;
  // Many gems a tick: the event is written in place, and hooks take no number arguments (§17).
  const ev = world.events, k = ev.reserve(EV.GEM);
  if (k >= 0) { ev.x[k] = x; ev.y[k] = y; ev.a[k] = v; }
  if (world.hooks.onGemCollect.length > 0) runHooks(world, 'onGemCollect');
}

function collectPickup(world, i) {
  const P = world.pickups;
  const kind = P.kind[i], x = P.x[i], y = P.y[i], a = P.a[i], b = P.b[i];
  P.remove(i);
  if (kind === PK.MATERIAL) {
    addMaterial(world, a, b);
    world.events.push(EV.PICKUP, x, y, PICK.MATERIAL, a);
  } else if (kind === PK.HEAL) {
    heal(world, a);
    world.events.push(EV.PICKUP, x, y, PICK.HEAL, a);
  } else if (kind === PK.MAGNET) {
    world.magnetAll = world.tuning.xp.magnetItemPull;
    world.events.push(EV.PICKUP, x, y, PICK.MAGNET, 0);
  } else if (kind === PK.CHEST) {
    world.events.push(EV.PICKUP, x, y, PICK.CHEST, a);
    openChest(world, a, x, y);
  }
}
