// The level-up draft (ARCHITECTURE §5.10). Runs on the `draft` random stream only, so draft
// changes never reshuffle spawns or loot.
//
// 1. Candidates: level-ups of owned weapons and passives that aren't maxed; new weapons and
//    passives while slots are free.
// 2. Banished items are gone for the rest of the run.
// 3. A weighted draw without replacement gives 3 cards (4 with the hub upgrade).
// 4. Early on (until you own 2 weapons) at least one card is a new weapon when possible.
// 5. A rare relic card (chance times luck, at most one per offer) can replace a card.
// 6. With nothing left to level: fallback cards (heal, coin), next to a relic card if there is one.
// Reroll, banish, and skip spend charges (from the character, passives, and the hub).

import { PASSIVE_SLOTS } from './constants.js';
import { heal } from './player.js';
import { addMaterial } from './pickups.js';
import { addRelic, freeWeaponSlot, addWeapon, markStatsDirty, relicAvailable } from './build.js';

function banishKey(card) { return `${card.kind}:${card.id}`; }

/** Every card that could be offered right now, with weights. */
export function draftCandidates(world) {
  const out = [];
  const T = world.tuning.draft, b = world.build, ban = b.banished;
  for (let s = 0; s < b.weaponSlots; s++) {
    const slot = world.slots[s];
    if (!slot) continue;
    if (slot.level < slot.def.maxLevel && !ban.has(`weapon:${slot.def.id}`)) {
      out.push({ kind: 'weapon', id: slot.def.id, level: slot.level + 1, isNew: false, w: (slot.def.weight ?? 100) * T.ownedWeight });
    }
  }
  for (const ps of b.passives) {
    if (ps.level < ps.def.maxLevel && !ban.has(`passive:${ps.def.id}`)) {
      out.push({ kind: 'passive', id: ps.def.id, level: ps.level + 1, isNew: false, w: (ps.def.weight ?? 100) * T.ownedWeight });
    }
  }
  if (freeWeaponSlot(world) >= 0) {
    for (const def of world.pools.weapons) {
      if (def.innate || def.unlock === 'evolution' || !(def.weight > 0)) continue;
      if (ownsWeapon(world, def.id) || b.evolvedFrom.has(def.id) || ban.has(`weapon:${def.id}`)) continue;
      out.push({ kind: 'weapon', id: def.id, level: 1, isNew: true, w: def.weight });
    }
  }
  if (b.passives.length < PASSIVE_SLOTS) {
    for (const def of world.pools.passives) {
      if (!(def.weight > 0) || b.passives.some((p) => p.def.id === def.id) || ban.has(`passive:${def.id}`)) continue;
      out.push({ kind: 'passive', id: def.id, level: 1, isNew: true, w: def.weight });
    }
  }
  return out;
}

export function ownsWeapon(world, id) {
  for (let s = 0; s < world.slots.length; s++) if (world.slots[s] && world.slots[s].def && world.slots[s].def.id === id) return true;
  return false;
}


function drawCards(world, cands, n, exclude = null) {
  const rng = world.rng.draft;
  const weights = cands.map((c) => (exclude && exclude.has(banishKey(c)) ? 0 : c.w));
  const cards = [];
  for (let k = 0; k < n; k++) {
    const i = rng.weighted(weights);
    if (i < 0) break;
    weights[i] = 0;
    cards.push(cands[i]);
  }
  return cards;
}

function stripWeight(c) { return { kind: c.kind, id: c.id, level: c.level, isNew: c.isNew }; }

/** Build a new offer for the current level-up. */
export function makeOffer(world) {
  const T = world.tuning.draft;
  const n = world.config.draftCards ?? T.cards;
  const cands = draftCandidates(world);
  let cards = drawCards(world, cands, n);
  // Early rule: until you own a couple of weapons, make sure one card is a new weapon.
  const early = countWeapons(world) < T.earlyWeaponUntil;
  const isNewWeapon = (c) => c.kind === 'weapon' && c.isNew;
  if (early && cards.length > 0 && !cards.some(isNewWeapon)) {
    const newWeapons = cands.filter(isNewWeapon);
    if (newWeapons.length) {
      const pickW = drawCards(world, newWeapons, 1);
      if (pickW.length) cards[cards.length - 1] = pickW[0];
    }
  }
  // The rare relic card replaces the last card, but never the early rule's only new weapon.
  const relics = relicAvailable(world);
  if (relics.length && world.rng.draft.chance(T.relicChance * world.stats.luck)) {
    const i = world.rng.draft.weighted(relics.map((r) => r.weight ?? 100));
    const card = { kind: 'relic', id: relics[i].id, level: 1, isNew: true, w: 0 };
    if (cards.length < n) cards.push(card);
    else {
      let at = cards.length - 1;
      if (early && isNewWeapon(cards[at]) && cards.filter(isNewWeapon).length === 1) at--;
      if (at >= 0) cards[at] = card;
    }
  }
  // Nothing left to level (a lone relic card at most): the fallback cards join, so a relic is
  // never forced on you.
  if (!cards.some((c) => c.kind !== 'relic')) cards.push(...fallbackCards());
  return cards.map(stripWeight);
}

function fallbackCards() {
  return [{ kind: 'heal', id: 'heal', level: 0, isNew: false }, { kind: 'coin', id: 'coin', level: 0, isNew: false }];
}

function countWeapons(world) {
  let n = 0;
  for (let s = 0; s < world.build.weaponSlots; s++) if (world.slots[s]) n++;
  return n;
}

/**
 * Resolve a draft decision. Returns true if the draft is finished (picked or skipped), false if
 * it stays open (reroll, banish). Throws on a decision the rules don't allow (a replay that
 * doesn't match this build, or a UI bug), so it can never silently diverge.
 */
export function draftDecide(world, halt, d) {
  const ch = world.charges;
  const cards = halt.offer;
  switch (d.kind) {
    case 'pick': {
      const c = cards[d.index];
      if (!c) throw new Error(`draft: no card ${d.index}`);
      applyCard(world, c);
      return true;
    }
    case 'reroll':
      if (ch.reroll <= 0) throw new Error('draft: no rerolls left');
      ch.reroll--;
      world.result.rerolls++;
      halt.offer = makeOffer(world);
      return false;
    case 'banish': {
      const c = cards[d.index];
      if (!c) throw new Error(`draft: no card ${d.index}`);
      if (c.kind === 'heal' || c.kind === 'coin') throw new Error('draft: fallback cards cannot be banished');
      if (ch.banish <= 0) throw new Error('draft: no banishes left');
      ch.banish--;
      world.build.banished.add(banishKey(c));
      world.result.banished.push(banishKey(c));
      // Replace just that card, never with one already showing. Early on, if that took away the
      // offer's only new weapon, the replacement is a new weapon when one is left.
      const showing = new Set(cards.map(banishKey));
      const cands = draftCandidates(world);
      const isNewWeapon = (x) => x.kind === 'weapon' && x.isNew;
      const needWeapon = countWeapons(world) < world.tuning.draft.earlyWeaponUntil && isNewWeapon(c) &&
        !cards.some((x, i) => i !== d.index && isNewWeapon(x));
      let repl = needWeapon ? drawCards(world, cands.filter(isNewWeapon), 1, showing) : [];
      if (!repl.length) repl = drawCards(world, cands, 1, showing);
      if (repl.length) cards[d.index] = stripWeight(repl[0]);
      else cards.splice(d.index, 1);
      if (!cards.some((x) => x.kind !== 'relic')) halt.offer = [...cards, ...fallbackCards()];
      return false;
    }
    case 'skip':
      if (ch.skip <= 0) throw new Error('draft: no skips left');
      ch.skip--;
      world.result.skips++;
      return true;
    default:
      throw new Error(`draft: unknown decision "${d.kind}"`);
  }
}

/** Apply a card (from the draft or a chest). */
export function applyCard(world, c) {
  switch (c.kind) {
    case 'weapon': {
      if (c.isNew) {
        const def = world.weaponDefs[world.weaponIndex.get(c.id)];
        if (addWeapon(world, def) < 0) throw new Error(`no free weapon slot for ${c.id}`);
      } else {
        const slot = world.slots.find((s) => s && s.def && s.def.id === c.id);
        if (!slot) throw new Error(`weapon ${c.id} is not owned`);
        slot.level = Math.min(slot.def.maxLevel, slot.level + 1);
        world.result.noteWeaponLevel(c.id, slot.level);
      }
      break;
    }
    case 'passive': {
      const owned = world.build.passives.find((x) => x.def.id === c.id);
      if (owned) owned.level = Math.min(owned.def.maxLevel, owned.level + 1);
      else {
        if (world.build.passives.length >= PASSIVE_SLOTS) throw new Error('no free passive slot');
        const def = world.passiveDefs.find((x) => x.id === c.id);
        world.build.passives.push({ def, level: 1 });
      }
      break;
    }
    case 'relic':
      addRelic(world, world.relicDefs.find((r) => r.id === c.id));
      break;
    case 'heal':
      heal(world, world.tuning.draft.fallbackHeal);
      break;
    case 'coin':
      addMaterial(world, world.materialIndex.get('coin'), world.tuning.draft.fallbackCoin);
      break;
    default:
      throw new Error(`unknown card kind ${c.kind}`);
  }
  markStatsDirty(world);
}
