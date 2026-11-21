// The Dash slot (ruling 16; work/cw/C1-CONTRACT.md section 14; the items: data/dashes.js, C2's).
// The dash is an escape and nothing else: nothing fires from it, nothing refunds it. A run has one
// Dash slot holding one dash item, which sets how the dash goes (distance, time, recharge, charges,
// the moment after it you can't be hurt) and the plain mark it leaves (a slow or a knock, never damage).
//
// The draft offers another item like a new weapon (it replaces the one held: swap, not stack) and,
// a few times a run, a plain card for the one held (tuning.dashes: distance, recharge, charges, each
// capped hard). An item taken starts fresh: the cards were the old item's.
//
// world.dash = { def, index, ups: [{ up, value }], stats: { distance, time, cooldown, charges,
// iframesAfter }, list }. The player holds p.dashCharges (ready now) and p.dashCd (s until the next
// charge comes back). All of it is in the world hash.

import { DT, RELIC_SLOT, EF_GONE } from './constants.js';
import { compileList, groundAt } from './weapons.js';
import { impulseR } from './enemies.js';
import { EV } from './events.js';

/** The card types a dash item can roll, in the order a card lists them. */
export const DASH_UPS = Object.freeze(['dash_distance', 'dash_recharge', 'dash_charges']);

/** A run's dash item by id: that one, else the character's own, else the first. */
export function dashDefOf(world, id) {
  const list = world.dashDefs;
  return list.find((d) => d.id === id) ?? list.find((d) => d.character === world.character?.id) ?? list[0] ?? null;
}

/** The item's numbers after its cards: { distance, time, cooldown, charges, iframesAfter }. */
export function dashNumbers(tuning, def, ups) {
  const T = tuning.player.dash, D = tuning.dashes, d = def || {};
  const base = { distance: T.distance * (d.dist ?? 1), cooldown: T.cooldown * (d.cooldown ?? 1), charges: d.charges ?? 1 };
  let { distance, cooldown, charges } = base;
  for (const u of ups) {
    if (u.up === 'dash_distance') distance *= 1 + u.value;
    else if (u.up === 'dash_recharge') cooldown *= 1 - u.value;
    else if (u.up === 'dash_charges') charges += u.value;
  }
  distance = Math.min(distance, base.distance * D.caps.distance);
  cooldown = Math.max(cooldown, base.cooldown * D.caps.recharge);
  charges = Math.min(charges, Math.max(base.charges, D.caps.charges));
  return { distance, time: T.time * (d.time ?? 1), cooldown, charges, iframesAfter: d.guard ?? T.iframesAfter };
}

/** Put a dash item in the Dash slot (by id or data entry; the run's start, or a card taken): fresh, with full charges. */
export function setDash(world, idOrDef) {
  const def = typeof idOrDef === 'string' ? world.dashDefs.find((d) => d.id === idOrDef) : idOrDef;
  if (!def) throw new Error(`dash: unknown dash item "${idOrDef}"`);
  const prev = world.dash;
  const m = def.mark;
  world.dash = { def, index: world.dashDefs.indexOf(def), ups: [], stats: dashNumbers(world.tuning, def, []), list: -1 };
  if (m && m.kind === 'slow') world.dash.list = compileList(world, [{ type: 'status', status: 'slow', pct: m.pct, duration: 0.6 }]);
  const p = world.player;
  p.dashCharges = world.dash.stats.charges;
  p.dashCd = 0;
  if (prev) world.result.dashes.push({ id: def.id, tick: world.tick });
}

/** The dash's recharge in seconds now: the item's, times the dashCooldown stat, never under tuning.dashes.minCooldown. */
export function dashCooldown(world) {
  return Math.max(world.tuning.dashes.minCooldown, world.dash.stats.cooldown * world.stats.dashCooldown);
}

/** A tick of recharge: a charge comes back each dashCooldown seconds while you hold fewer than the item's. Time only. */
export function rechargeDash(world) {
  const p = world.player, max = world.dash.stats.charges;
  if (p.dashCharges >= max) { p.dashCd = 0; return; }
  if (p.dashCd > 0) p.dashCd -= DT;
  if (p.dashCd <= 0) {
    p.dashCharges++;
    p.dashCd = p.dashCharges < max ? dashCooldown(world) : 0;
  }
}

/** A dash begins: spend a charge, and start the recharge if it wasn't running. */
export function spendDash(world) {
  const p = world.player;
  p.dashCharges--;
  if (p.dashCd <= 0) p.dashCd = dashCooldown(world);
}

/** Shove everything within `radius` of (x, y) away from it (a knock mark: no damage, no hit). */
function knock(world, x, y, radius, strength) {
  const E = world.enemies, q = world.scratch.reg, near = world.scratch.lure, num = world.scratch.num;
  q[0] = x; q[1] = y; q[2] = radius;
  const n = world.enemyHash.queryR(q, near, -1);
  for (let k = 0; k < n; k++) {
    const e = near[k];
    if ((E.flags[e] & EF_GONE) !== 0) continue;
    const dx = E.x[e] - x, dy = E.y[e] - y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-3) continue;
    num[1] = dx / d; num[2] = dy / d; num[3] = strength;
    impulseR(world, e);
  }
}

/** Each tick (sim/world.js, after the player moves): the item's mark, along the dash or where it ends. */
export function dashGround(world) {
  const d = world.dash, p = world.player, m = d.def.mark;
  if (!m) return;
  const along = p.dashTicks > 0 || p.dashStart === world.tick, ends = p.dashEnd === world.tick;
  if (m.where === 'path' ? !(along && world.tick % 2 === 0) : !ends) return;
  if (m.kind === 'slow' && d.list >= 0) {
    groundAt(world, RELIC_SLOT, p.x, p.y, m.radius, m.sec, 0, 0.25, d.list);
  } else if (m.kind === 'knock') knock(world, p.x, p.y, m.radius, m.strength);
}

/** The card types still open for the held item: its own, under their caps, the item under tuning.dashes.maxUps. */
export function dashUpsOpen(world) {
  const d = world.dash, D = world.tuning.dashes;
  if (!d || d.ups.length >= D.maxUps) return [];
  const own = d.def.numbers || [];
  const base = dashNumbers(world.tuning, d.def, []), now = d.stats;
  return DASH_UPS.filter((t) => own.includes(t) && !world.build.banished.has(`dash:${d.def.id}:${t}`) && (
    t === 'dash_distance' ? now.distance < base.distance * D.caps.distance - 1e-6
      : t === 'dash_recharge' ? now.cooldown > base.cooldown * D.caps.recharge + 1e-6
        : now.charges < D.caps.charges));
}

/** Roll one card for the held item on `rng`: { up, value, now, after } (px, s, or a count, as the card shows them), or null. */
export function rollDashUp(world, rng) {
  const open = dashUpsOpen(world);
  if (!open.length) return null;
  const up = open[rng.int(open.length)], value = world.tuning.dashes.ups[up];
  const d = world.dash, after = dashNumbers(world.tuning, d.def, [...d.ups, { up, value }]);
  const pick = (s) => (up === 'dash_distance' ? s.distance : up === 'dash_recharge' ? s.cooldown : s.charges);
  return { up, value, now: pick(d.stats), after: pick(after) };
}

/** Take a card on the held item. */
export function takeDashUp(world, u) {
  const d = world.dash;
  if (!DASH_UPS.includes(u.up) || !(d.def.numbers || []).includes(u.up)) throw new Error(`dash: ${d.def.id} can't take "${u.up}"`);
  d.ups = [...d.ups, { up: u.up, value: u.value }];
  const was = d.stats.charges;
  d.stats = dashNumbers(world.tuning, d.def, d.ups);
  if (d.stats.charges > was) world.player.dashCharges += d.stats.charges - was;
  const p = world.player;
  world.events.push(EV.UPGRADE, p.x, p.y, -1, 0, 3);
}
