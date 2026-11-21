// Deeds (ruling 14, C1; work/cw/C1-CONTRACT.md section 5): the thing done with a weapon, in the
// run, that opens its capstone axis. A weapon's data names it: `deed: { kind, count, text, ... }`.
//
//   kills   kills by this weapon; with `near` or `far` (px from you), `moving`, `still`, `status`
//           (the enemy was burning, rotting, slowed, or frozen), or `origin` (px from its pot).
//   multi   times it killed `n` enemies within `within` s
//   hits    enemies it struck
//
// slot.deed is the count (in the world hash). At `count` the slot is queued (world.deedsDone) and
// sim/ascend.js opens the axis on the same tick. A character's own weapon has no deed.

import { TPS } from './constants.js';
import { EV } from './events.js';
import { originOf } from './forms.js';

/** Is the weapon in this slot still counting toward its deed? */
function counting(slot) {
  const d = slot.def.deed;
  return !!d && (slot.axes & 4) === 0 && slot.deed < d.count;
}

function add(world, slot, n) {
  const d = slot.def.deed, p = world.player;
  slot.deed = Math.min(d.count, slot.deed + n * (world.rules.lostlight ? 2 : 1));
  const done = slot.deed >= d.count;
  if (slot.deedTick !== world.tick || done) {
    slot.deedTick = world.tick;   // (the view's throttle only: one event a tick per weapon)
    world.events.push(EV.DEED, p.x, p.y, slot.index, slot.deed, d.count, done ? 1 : 0);
  }
  if (done) world.deedsDone.push(slot.index);
}

/** A kill by the weapon in `slot`: enemy e (dead, still in its place). */
export function deedKill(world, slot, e) {
  if (!counting(slot)) return;
  const d = slot.def.deed, E = world.enemies, p = world.player;
  if (d.kind === 'multi') {
    if (world.tick - slot.deedA > d.within * TPS) { slot.deedA = world.tick; slot.deedB = 0; }
    if (++slot.deedB === d.n) add(world, slot, 1);
    return;
  }
  if (d.kind !== 'kills') return;
  const dx = E.x[e] - p.x, dy = E.y[e] - p.y, r2 = dx * dx + dy * dy;
  if (d.near && r2 > d.near * d.near) return;
  if (d.far && r2 < d.far * d.far) return;
  if (d.moving && !(p.moving || p.dashTicks > 0)) return;
  if (d.still && (p.moving || p.dashTicks > 0)) return;
  if (d.status) {
    const held = E.held[e];
    const had = d.status === 'burn' ? E.burnT[e] > 0 : d.status === 'rot' ? E.rotT[e] > 0 : d.status === 'freeze' ? (held & 1) !== 0 || E.freezeT[e] > 0 : held !== 0 || E.slowT[e] > 0 || E.freezeT[e] > 0;
    if (!had) return;
  }
  if (d.origin) {
    const og = world.scratch.open;
    originOf(world, slot, 0, og);
    let ox = E.x[e] - og[0], oy = E.y[e] - og[1], ok = ox * ox + oy * oy <= d.origin * d.origin;
    // (String of Pots: any pot standing counts.)
    for (let k = 1; k < 3 && !ok && slot.pots !== null; k++) { originOf(world, slot, k, og); ox = E.x[e] - og[0]; oy = E.y[e] - og[1]; ok = ox * ox + oy * oy <= d.origin * d.origin; }
    if (!ok) return;
  }
  add(world, slot, 1);
}

/** An enemy struck by the weapon in `slot` (a 'hits' deed; sim/enemies.js damageEnemyR). */
export function deedHit(world, slot) {
  if (counting(slot)) add(world, slot, 1);
}

/** The deed of the weapon in slot s, for a card or the HUD: { have, need, done, text }, or null. */
export function deedState(world, s) {
  const slot = world.slots[s];
  const d = slot && slot.def ? slot.def.deed : null;
  if (!d) return null;
  const done = (slot.axes & 4) !== 0 || slot.deed >= d.count;
  return { have: done ? d.count : slot.deed, need: d.count, done, text: d.text };
}
