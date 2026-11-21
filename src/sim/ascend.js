// Forms and Embers (ARCHITECTURE §5.16; ruling 14, C1: work/cw/C1-CONTRACT.md sections 4 to 8; the
// options themselves: data/ascensions.js, their mechanics: sim/forms.js).
//
// A weapon has three axes and two options on each, and holds ONE option per axis:
//   delivery  how it fires          opens at its 5th upgrade   (tuning.forms.at[0])
//   flight    how its shots travel  opens at its 10th upgrade  (tuning.forms.at[1])
//   payoff    the capstone          opens when its deed is done (sim/deeds.js), if the profile has
//                                   the weapon's capstone axis (a line's capstoneUnlock; RunConfig.forms)
// When an axis opens the run stops for the choice (it can be kept for later: the pause menu's Forms).
// An Ember (every boss, a muster's captain, now and then an elite) does one of two things to a
// drafted weapon: it opens the weapon's next shut axis early (the capstone only once the other two
// are held), or it switches the option on an axis for the other one. Leveling earns no Embers.
// A character's own weapon (def.signature) is out of all of this: its track calls giveUpgrade,
// openAxis, offerAxis, and takeOption itself (section 8). (In the code a Form option is an
// "ascension", as it was when an Ember was the only way to one.)

import { EV } from './events.js';
import { PK, TPS } from './constants.js';
import { buildSlot } from './weapons.js';
import { markStatsDirty } from './build.js';
import { rollUpgrade, takeUpgrade } from './weaponups.js';
import { deedState } from './deeds.js';

export const AXES = Object.freeze(['delivery', 'flight', 'payoff']);
const BIT = Object.freeze({ delivery: 1, flight: 2, payoff: 4 });
const WHY = Object.freeze({ level: 0, deed: 1, ember: 2, track: 3 });

/** weaponId -> its line of options (data.ascensions), for a world's data. */
export function ascensionLines(data) {
  const m = new Map();
  for (const line of data.ascensions || []) for (const id of line.weapons) m.set(id, line);
  return m;
}

/** A weapon's capstone, for its card: { forms: [its capstone options], passive (its partner), deed } or null. */
export function capstoneOf(data, weaponId) {
  const line = (data.ascensions || []).find((l) => l.weapons.includes(weaponId));
  const forms = line ? line.options.filter((x) => x.capstone) : [];
  if (!forms.length) return null;
  const def = data.weapons.find((w) => w.id === weaponId);
  return { forms, passive: data.passives.find((p) => p.id === def?.partner) ?? null, deed: def?.deed ?? null };
}

/** Is the weapon in this slot one the draft, chests, and Embers grow (not a character's own)? */
export function isDrafted(slot) {
  return !!slot && !!slot.def && !slot.def.innate && !slot.def.signature;
}

/** The slot of the character's signature weapon, or -1. */
export function signatureSlot(world) {
  for (let s = 0; s < world.build.weaponSlots; s++) if (world.slots[s] && world.slots[s].def && world.slots[s].def.signature) return s;
  return -1;
}

/** The research or order key that still keeps this line's capstone axis shut in this run, or null. */
function capstoneShut(world, line) {
  const open = world.config.forms;
  if (!line.capstoneUnlock || !Array.isArray(open)) return null;
  // (C1b, ruling 25 WA: a capstone option can have its own later unlock, as Tether does; the axis is
  // shut only while none of its options is open.)
  const caps = line.options.filter((o) => o.capstone);
  return caps.length && !caps.some((o) => open.includes(o.id)) ? line.capstoneUnlock : null;
}

/** Is option o a capstone this run hasn't opened (RunConfig.forms)? (Its own `unlock`: ruling 25 WA.) */
function optionShut(world, o) {
  const open = world.config.forms;
  return !!o.capstone && Array.isArray(open) && !open.includes(o.id);
}

/**
 * The three axes of the weapon in slot s, for a card or a screen: [{ axis, open, taken, options,
 * locked (an unlock key the profile lacks), at (the upgrade count that opens it), left (upgrades to
 * go), deed ({ have, need, done, text }) }], or [] for a weapon with no line.
 */
export function axisState(world, s) {
  const slot = world.slots[s];
  const line = slot && slot.def ? world.ascensionLines.get(slot.def.id) : null;
  if (!line) return [];
  const at = world.tuning.forms.at, n = slot.ups.length;
  return AXES.map((axis, i) => {
    const options = line.options.filter((o) => o.axis === axis);
    const taken = slot.ascensions.find((o) => o.axis === axis) ?? null;
    const open = (slot.axes & BIT[axis]) !== 0;
    return {
      axis, open, taken, options,
      locked: axis === 'payoff' ? capstoneShut(world, line) : null,
      at: i < 2 ? at[i] : null,
      left: i < 2 && !open ? Math.max(0, at[i] - n) : 0,
      deed: axis === 'payoff' ? deedState(world, s) : null,
    };
  }).filter((a) => a.options.length > 0);
}

/**
 * The options the weapon in slot s could take now: [{ option, cost: 'free' | 'ember', switches }].
 * Free: its axis is open and empty. An Ember: the other option on an axis it has filled (a switch),
 * or an option on its next shut axis (the capstone only with both others held).
 */
/** Is option o kept out by what the slot holds (its `excludes`, either way round), leaving aside the option it would replace? */
export function excluded(slot, o, replaces = null) {
  for (const h of slot.ascensions || []) {
    if (h === replaces || h === o) continue;
    if ((o.excludes || []).includes(h.id) || (h.excludes || []).includes(o.id)) return true;
  }
  return false;
}

export function optionChoices(world, s) {
  const slot = world.slots[s];
  if (!slot || !slot.def || slot.def.innate) return [];
  const st = axisState(world, s), out = [];
  const drafted = isDrafted(slot);
  let nextShut = null;
  for (const a of st) {
    if (a.open || nextShut) continue;
    if (a.axis === 'payoff' && (a.locked || st.some((b) => b.axis !== 'payoff' && !b.taken))) continue;
    nextShut = a.axis;
  }
  for (const a of st) {
    for (const o of a.options) {
      if (a.taken === o) continue;
      if (excluded(slot, o, a.taken) || optionShut(world, o)) continue;
      if (a.open && !a.taken) out.push({ option: o, cost: 'free', switches: null });
      else if (!drafted) continue;   // an Ember never goes on a character's own weapon
      else if (a.open && a.taken) out.push({ option: o, cost: 'ember', switches: a.taken });
      else if (a.axis === nextShut) out.push({ option: o, cost: 'ember', switches: null });
    }
  }
  return out;
}

/** Can any weapon take an option now (a free one waiting, or one an Ember held would buy)? */
export function canAscend(world) {
  for (let s = 0; s < world.build.weaponSlots; s++) {
    for (const c of optionChoices(world, s)) if (c.cost === 'free' || world.build.embers > 0) return true;
  }
  return false;
}

/** Could an Ember do anything now (some weapon has an option it could buy)? */
export function emberUseful(world) {
  for (let s = 0; s < world.build.weaponSlots; s++) if (optionChoices(world, s).length) return true;
  return false;
}

/** Is this ascend halt still worth showing? (One for an axis: that axis is open and empty. A general one: something can be taken.) */
export function ascendLive(world, h) {
  if (Number.isInteger(h.slot) && h.axis) {
    const slot = world.slots[h.slot];
    return !!slot && (slot.axes & BIT[h.axis]) !== 0 && !slot.ascensions.some((o) => o.axis === h.axis) && optionChoices(world, h.slot).some((c) => c.option.axis === h.axis);
  }
  return canAscend(world);
}

/** Open an axis of the weapon in slot s. A drafted weapon's choice stops the run; a signature's waits for its track (offerAxis). */
export function openAxis(world, s, axis, why = 'level') {
  const slot = world.slots[s];
  if (!slot || !BIT[axis] || (slot.axes & BIT[axis]) !== 0) return false;
  slot.axes |= BIT[axis];
  const p = world.player;
  world.events.push(EV.AXIS_OPEN, p.x, p.y, s, AXES.indexOf(axis), WHY[why] ?? 0);
  if (isDrafted(slot) && why !== 'ember' && optionChoices(world, s).some((c) => c.option.axis === axis)) world.halts.push({ kind: 'ascend', slot: s, axis, why });
  return true;
}

/** Open an axis of the weapon in slot s if it is shut, and raise its choice (a character's track: section 8). */
export function offerAxis(world, s, axis) {
  const slot = world.slots[s];
  if (!slot || !BIT[axis]) return false;
  if ((slot.axes & BIT[axis]) === 0) { slot.axes |= BIT[axis]; const p = world.player; world.events.push(EV.AXIS_OPEN, p.x, p.y, s, AXES.indexOf(axis), WHY.track); }
  if (!optionChoices(world, s).some((c) => c.option.axis === axis && c.cost === 'free')) return false;
  world.halts.push({ kind: 'ascend', slot: s, axis, why: 'track' });
  return true;
}

/** A drafted weapon's level-up (a card, a chest item, a Fog Bell's level): the axis its upgrade count opens, if any. */
export function levelUpAxis(world, s) {
  const slot = world.slots[s];
  if (!isDrafted(slot)) return;
  const at = world.tuning.forms.at, n = slot.ups.length;
  if (n >= at[0]) openAxis(world, s, 'delivery', 'level');
  if (n >= at[1]) openAxis(world, s, 'flight', 'level');
}

/** The axis the weapon in slot s opens by reaching `n` upgrades, or null (a card's "Opens: ..."). */
export function axisAt(world, s, n) {
  const slot = world.slots[s];
  if (!isDrafted(slot) || !world.ascensionLines.get(slot.def.id)) return null;
  const at = world.tuning.forms.at;
  if (n === at[0] && (slot.axes & 1) === 0) return 'delivery';
  if (n === at[1] && (slot.axes & 2) === 0) return 'flight';
  return null;
}

/** An upgrade that didn't come from a card (a chest, the Fog Bell, a character's track): taken, its axis checked, stats marked. */
export function giveUpgrade(world, s, u) {
  takeUpgrade(world, s, u);
  levelUpAxis(world, s);
  markStatsDirty(world);
}

/** An Ember picked up: count it, and stop for the choice if it could do anything. */
export function collectEmber(world, x, y) {
  world.build.embers++;
  world.result.embers++;
  world.events.push(EV.PICKUP, x, y, PK.EMBER, world.build.embers);
  if (canAscend(world)) world.halts.push({ kind: 'ascend' });
}

/**
 * The ascend halt's answer: { kind: 'ascend', slot, id } takes that option on that weapon (free
 * where its axis is open and empty, else for an Ember), { kind: 'keep' } leaves it for later.
 * Returns true (the halt is done).
 */
export function ascendDecide(world, d) {
  if (d.kind === 'keep') return true;
  if (d.kind !== 'ascend') throw new Error(`ascend: expected "ascend" or "keep", got "${d.kind}"`);
  const s = d.slot;
  if (!Number.isInteger(s) || s < 0 || s >= world.build.weaponSlots) throw new Error(`ascend: no weapon slot ${s}`);
  const c = optionChoices(world, s).find((x) => x.option.id === d.id);
  if (!c) throw new Error(`ascend: the weapon in slot ${s} can't take "${d.id}"`);
  if (c.cost === 'ember') {
    if (world.build.embers <= 0) throw new Error('ascend: no Ember to spend');
    world.build.embers--;
    world.result.embersSpent++;
    const slot = world.slots[s];
    if ((slot.axes & BIT[c.option.axis]) === 0) openAxis(world, s, c.option.axis, 'ember');
  }
  takeOption(world, s, d.id);
  return true;
}

/** Put option `id` on the weapon in slot s, in place of the one on its axis if it holds one. No cost, no checks but that it is the weapon's. */
export function takeOption(world, s, id) {
  const slot = world.slots[s];
  const line = slot && slot.def ? world.ascensionLines.get(slot.def.id) : null;
  const a = line ? line.options.find((o) => o.id === id) : null;
  if (!a) throw new Error(`form: the weapon in slot ${s} has no option "${id}"`);
  if (excluded(slot, a, slot.ascensions.find((o) => o.axis === a.axis) ?? null)) throw new Error(`form: "${id}" can't be held with what the weapon in slot ${s} holds`);
  takeForm(world, s, a);
}

/** Put option `a` on the weapon in slot s (takeOption by its data entry; a dev command, a retired evolution a save names). */
export function takeForm(world, s, a) {
  const slot = world.slots[s];
  if (slot.ascensions.includes(a)) return;
  const was = slot.ascensions.find((o) => o.axis === a.axis);
  const next = { ...slot, axes: slot.axes | (BIT[a.axis] ?? 0), ascensions: [...slot.ascensions.filter((o) => o.axis !== a.axis), a] };
  world.slots[s] = buildSlot(world, s, slot.def, slot.level, null, next);
  const rec = { weapon: slot.def.id, id: a.id, tick: world.tick };
  if (a.capstone) rec.capstone = true;
  if (was) rec.switched = was.id;
  world.result.ascensions.push(rec);
  const p = world.player;
  world.events.push(EV.ASCEND, p.x, p.y, s, a.capstone ? 1 : 0, was ? 1 : 0);
  markStatsDirty(world);
}

/**
 * The pause menu's Forms: open the choice now (an Ember kept, or an axis's choice kept for later).
 * Throws when nothing can be taken.
 */
export function emberDecide(world) {
  if (!canAscend(world)) throw new Error(world.build.embers <= 0 ? 'ember: no Ember kept, and no choice waiting' : 'ember: no weapon can take a Form');
  if (world.halts.length) throw new Error('ember: wait until nothing else is waiting');
  world.halts.push({ kind: 'ascend' });
}

/**
 * Once a tick (sim/world.js): the deeds done this tick open their capstone axes, and, until the
 * characters' own track lands (world.sigTrack; tuning.weaponUps.sigEvery 0 switches this off), the
 * interim clock: a signature weapon takes one rolled upgrade every sigEvery seconds on the loot
 * stream, and the first option of an axis at its 5th, 10th, and 15th upgrade.
 */
export function formsStep(world) {
  if (world.deedsDone.length) {
    for (const s of world.deedsDone) {
      const slot = world.slots[s];
      const line = slot && slot.def ? world.ascensionLines.get(slot.def.id) : null;
      if (line && !capstoneShut(world, line)) openAxis(world, s, 'payoff', 'deed');
    }
    world.deedsDone.length = 0;
  }
  const every = world.tuning.weaponUps.sigEvery;
  if (!(every > 0) || world.sigTrack || world.tick === 0 || world.tick % Math.round(every * TPS) !== 0) return;
  const s = signatureSlot(world);
  if (s < 0) return;
  const u = rollUpgrade(world, s, world.rng.loot);
  if (!u) return;
  giveUpgrade(world, s, u);
  const slot = world.slots[s], line = world.ascensionLines.get(slot.def.id), F = world.tuning.forms;
  if (!line) return;
  const n = slot.ups.length;
  const axis = n === F.at[0] ? 'delivery' : n === F.at[1] ? 'flight' : n === F.sigCapstoneAt ? 'payoff' : null;
  const o = axis ? line.options.find((x) => x.axis === axis) : null;
  if (o && !slot.ascensions.some((x) => x.axis === axis)) { openAxis(world, s, axis, 'track'); takeForm(world, s, o); }
}
