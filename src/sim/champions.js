// Champions (0.9.0, W3; the veteran round, V1: "turn the 5:00 and 15:00 musters into named
// champions with one warned attack each, so every five minutes ends on a fight"). A muster event
// with `champion: { name, attack }` (data/maps.js) makes its captain a champion: an elite with a
// name, more health (tuning.champions.hpMul), no affixes, and one attack it throws every `every`
// seconds while you're within `reach` px, always warned (at least telegraphMin) as a MAJOR warning:
//   anchor     a ring where you stand; then an anchor lands in it
//   rope_drag  a line from him toward you; then the rope whips down it: on it, you're hurt and
//              dragged along it toward him (world.pull, which a dash is free of)
//   scythe     a ring round him; then the scythe sweeps it
//   salt_wall  a row of brine pools across your way (square to the line from him to you, through
//              where you stand), warned, then burning for `last` s
// While it warns he stands where the warning was drawn (EF.WARNING: anchored, never held).

import { DT, TPS, EF, EF_GONE } from './constants.js';
import { EV, TELE, HURT } from './events.js';
import { hurtPlayer } from './player.js';
import { tell, setSource, spawnHazard, HAZARD_LOOK, lineCrossesPlayer } from './attacks.js';
import { fatan2 } from '../lib/fmath.js';

export const CHAMPION_ATTACK = Object.freeze({ anchor: 1, rope_drag: 2, scythe: 3, salt_wall: 4 });
const NEED = { anchor: ['radius', 'damage'], rope_drag: ['length', 'width', 'damage', 'drag', 'dragSec'], scythe: ['radius', 'damage'], salt_wall: ['length', 'spacing', 'radius', 'last', 'damage'] };

/** A muster's champion data, checked when the run starts (sim/director.js checkEvent): a plain message, or null. */
export function checkChampion(c) {
  if (!c || typeof c !== 'object') return 'a champion is { name, attack }';
  if (typeof c.name !== 'string' || !c.name) return 'a champion needs a name';
  const a = c.attack;
  if (!a || CHAMPION_ATTACK[a.type] === undefined) return `a champion's attack needs a type (${Object.keys(CHAMPION_ATTACK).join(', ')})`;
  if (typeof a.name !== 'string' || !a.name) return "a champion's attack needs a name";
  for (const k of ['warn', 'every', 'reach', ...NEED[a.type]]) if (!(Number.isFinite(a[k]) && a[k] > 0)) return `the champion's ${a.type}: ${k} must be above 0`;
  if (c.chest !== undefined && c.chest !== 'elite' && c.chest !== 'boss') return "a champion's chest is 'elite' or 'boss'";
  return null;
}

/** Make the captain at index e the champion of muster event `ev` (its timeline index `index`). */
export function makeChampion(world, e, ev, index) {
  const E = world.enemies, c = ev.champion, a = c.attack;
  E.hp[e] = E.maxHp[e] = E.maxHp[e] * world.tuning.champions.hpMul;
  const rec = {
    handle: E.handle(e), type: E.type[e], name: c.name, attackName: a.name, event: index, chest: c.chest ?? 'boss',
    // The attack as what hurt you reads it (sim/player.js noteHurt): its key and name, and that it's a champion's.
    info: Object.freeze({ key: a.type, name: a.name, champion: true }),
    attack: a, code: CHAMPION_ATTACK[a.type],
    state: 1, phase: 0, timer: a.every * 0.5, ax: 0, ay: 0, ux: 0, uy: 0,
  };
  world.champions.push(rec);
  world.events.push(EV.CHAMPION, E.x[e], E.y[e], 1, rec.handle, index, rec.code);
  return rec;
}

/** The champion record for enemy index e, or null. */
export function championOf(world, e) {
  const h = world.enemies.handle(e);
  for (const c of world.champions) if (c.handle === h) return c;
  return null;
}

/** Every champion's turn (step 7, after the enemies act). */
export function championsStep(world) {
  const list = world.champions;
  if (list.length === 0) return;
  const E = world.enemies, p = world.player;
  for (const c of list) {
    if (c.state !== 1) continue;
    const e = E.resolve(c.handle);
    if (e < 0 || (E.flags[e] & EF_GONE) !== 0) {
      c.state = 0;
      if (e >= 0) E.flags[e] &= ~EF.WARNING;
      world.events.push(EV.CHAMPION, e >= 0 ? E.x[e] : p.x, e >= 0 ? E.y[e] : p.y, 0, c.handle, c.event, c.code);
      continue;
    }
    const a = c.attack, x = E.x[e], y = E.y[e];
    c.timer -= DT;
    if (c.phase === 0) {
      const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
      if (c.timer > 0 || d2 > a.reach * a.reach || E.freezeT[e] > 0 || E.dazeT[e] > 0 || E.saltT[e] > 0) continue;
      startAttack(world, c, e, Math.sqrt(d2) || 1, dx, dy);
      continue;
    }
    if (c.timer <= 0) { execute(world, c, e); E.flags[e] &= ~EF.WARNING; c.phase = 0; c.timer = a.every; }
  }
}

function startAttack(world, c, e, d, dx, dy) {
  const E = world.enemies, p = world.player, a = c.attack;
  const warn = Math.max(a.warn, world.tuning.enemies.telegraphMin), ticks = Math.round(warn * TPS);
  const x = E.x[e], y = E.y[e];
  c.ux = dx / d; c.uy = dy / d; c.ax = p.x; c.ay = p.y;
  c.phase = 1; c.timer = warn;
  E.flags[e] |= EF.WARNING;
  const ang = fatan2(c.uy, c.ux);
  switch (a.type) {
    case 'anchor': tell(world, p.x, p.y, TELE.RING, ticks, a.radius, 0, e, true, true); break;
    case 'scythe': tell(world, x, y, TELE.RING, ticks, a.radius, 0, e, true, true); break;
    case 'rope_drag': tell(world, x, y, TELE.LINE, ticks, a.length, ang, e, true, true); break;
    case 'salt_wall': {
      // Square to the line from him to you, through where you stand.
      const px = -c.uy, py = c.ux, per = Math.max(2, Math.round(a.length / a.spacing));
      for (let j = 0; j < per; j++) {
        const along = (j - (per - 1) / 2) * a.spacing;
        setSource(world, HURT.ATTACK, e, c.info, HAZARD_LOOK.BRINE, true);
        spawnHazard(world, p.x + px * along, p.y + py * along, a.radius, warn, a.last, a.damage);
      }
      break;
    }
    default: break;
  }
  world.events.push(EV.CHAMPION, x, y, 2, c.handle, c.event, c.code);
}

function execute(world, c, e) {
  const E = world.enemies, p = world.player, a = c.attack, pr = world.tuning.player.radius;
  const x = E.x[e], y = E.y[e];
  switch (a.type) {
    case 'anchor': {
      const dx = p.x - c.ax, dy = p.y - c.ay, rr = a.radius + pr;
      if (dx * dx + dy * dy <= rr * rr) hurtPlayer(world, a.damage * world.director.contactMul, c.ax, c.ay, HURT.ATTACK, c.type, c.info);
      world.events.push(EV.EXPLODE, c.ax, c.ay, a.radius, -1);
      break;
    }
    case 'scythe': {
      const dx = p.x - x, dy = p.y - y, rr = a.radius + pr;
      if (dx * dx + dy * dy <= rr * rr) hurtPlayer(world, a.damage * world.director.contactMul, x, y, HURT.ATTACK, c.type, c.info);
      world.events.push(EV.EXPLODE, x, y, a.radius, -1);
      break;
    }
    case 'rope_drag': {
      if (lineCrossesPlayer(world, x, y, c.ux, c.uy, a.length, a.width) && hurtPlayer(world, a.damage * world.director.contactMul, p.x, p.y, HURT.ATTACK, c.type, c.info) > 0) {
        const P = world.pull;
        P.x = x; P.y = y; P.speed = a.drag / a.dragSec; P.ticks = Math.round(a.dragSec * TPS); P.boss = c.handle;
      }
      world.events.push(EV.EXPLODE, x + c.ux * a.length, y + c.uy * a.length, a.width, -1);
      break;
    }
    default: break; // the salt wall's pools were laid when it warned
  }
}

/** The chest a fallen champion pays: 'boss' (with an Ember) or 'elite'. */
export function championChest(world, e) {
  const c = championOf(world, e);
  return c ? c.chest : 'boss';
}
