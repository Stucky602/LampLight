// The level-up draft (ARCHITECTURE §5.10). Runs on the `draft` random stream only, so draft
// changes never reshuffle spawns or loot.
//
// 1. Candidates: each weapon carried (ruling 10, W1b: a weapon has no level table and no max
//    level; its card is one rolled upgrade at a rarity, sim/weaponups.js), passives you carry that
//    aren't maxed, and new weapons and passives while slots are free (world.build.weaponSlots,
//    passiveSlots: 0.9.0, they grow with the harbor).
// 2. Banished items are gone for the rest of the run (a weapon upgrade card's banish takes that
//    type off that weapon: up:<weapon>:<type>).
// 3. A weighted draw without replacement gives 3 cards (4 with the hub upgrade); each weapon card
//    drawn rolls its upgrade. With fewer candidates than cards, a weapon can show twice, with two
//    different upgrades, so a build with a weapon never sees a short draft.
// 4. Early on (until you own 2 weapons) at least one card is a new weapon when possible.
// 5. With nothing at all to draw (no weapon carried and nothing else), the level is paid without
//    stopping the run (levelGift, 0.7.3: tuning.draft.autoFallback). The fallback cards (heal,
//    coin) remain for an offer a banish empties.
// A weapon's 5th and 10th upgrade open an axis of its Forms (sim/ascend.js levelUpAxis).
// Relics are never cards: they come from Reliquaries, the vault, and the Ferryman (sim/relics.js).
// Reroll (it rolls the rarities again too), banish, and skip spend charges (from the character,
// passives, and the hub). A skip pays what a dry level pays (0.9.0, tuning.draft.skipPays).
// With the build full (every card a weapon upgrade), the app may answer for the player ("Pick for
// me", a setting): autoPick is the rule, and the app sends it as an ordinary logged pick.

import { EV, GIFT } from './events.js';
import { TPS } from './constants.js';
import { kinCount } from './weapons.js';
import { heal } from './player.js';
import { addMaterial } from './pickups.js';
import { freeWeaponSlot, addWeapon, markStatsDirty } from './build.js';
import { canAscend, emberUseful, levelUpAxis, axisAt, axisState, isDrafted } from './ascend.js';
import { deedState } from './deeds.js';
import { addGlass } from './relics.js';
import { upsOpen, rollUpgrade, takeUpgrade, upgradeScore, noteLegendaryOffered, UP_TYPES } from './weaponups.js';
import { setDash, dashUpsOpen, rollDashUp, takeDashUp } from './dash.js';

/** A card's banish key: a weapon upgrade's is its type on that weapon. */
function banishKey(card) {
  if (card.kind === 'dash') return card.isNew ? `dash:${card.id}` : `dash:${card.id}:${card.up}`;
  if (card.kind === 'weapon' && !card.isNew && card.up === 'line') return `up:${card.id}:line:${card.line}`;
  if (card.kind === 'weapon' && !card.isNew && card.up === 'special') return `up:${card.id}:special:${card.special}`;
  if (card.kind === 'weapon' && !card.isNew && card.up) return `up:${card.id}:${card.up}`;
  return `${card.kind}:${card.id}`;
}
/** A candidate's key: one per weapon carried, new weapon, or passive. */
function candKey(c) { return `${c.kind}:${c.id}:${c.isNew ? 1 : 0}`; }

/** Every card that could be offered right now, with weights (a weapon carried: one candidate, rolled when drawn). */
export function draftCandidates(world) {
  const out = [];
  const T = world.tuning.draft, b = world.build, ban = b.banished;
  for (let s = 0; s < b.weaponSlots; s++) {
    const slot = world.slots[s];
    if (!isDrafted(slot)) continue;   // (a character's own weapon grows on its own track: ruling 14)
    if (upsOpen(world, slot).length) out.push({ kind: 'weapon', id: slot.def.id, slot: s, level: slot.level + 1, isNew: false, w: (slot.def.weight ?? 100) * T.ownedWeight });
  }
  for (const ps of b.passives) {
    if (ps.level < ps.def.maxLevel && !ban.has(`passive:${ps.def.id}`)) {
      out.push({ kind: 'passive', id: ps.def.id, level: ps.level + 1, isNew: false, w: (ps.def.weight ?? 100) * T.ownedWeight });
    }
  }
  if (freeWeaponSlot(world) >= 0) {
    for (const def of world.pools.weapons) {
      if (def.innate || def.signature || !(def.weight > 0)) continue;   // (W2: a character's signature weapon is never drawn)
      if (ownsWeapon(world, def.id) || b.evolvedFrom.has(def.id) || ban.has(`weapon:${def.id}`)) continue;
      out.push({ kind: 'weapon', id: def.id, level: 1, isNew: true, w: def.weight });
    }
  }
  if (b.passives.length < b.passiveSlots) {
    for (const def of world.pools.passives) {
      if (!(def.weight > 0) || b.passives.some((p) => p.def.id === def.id) || ban.has(`passive:${def.id}`)) continue;
      out.push({ kind: 'passive', id: def.id, level: 1, isNew: true, w: def.weight * (T.newPassiveMul ?? 1) });
    }
  }
  // The Dash slot (ruling 16): another dash item in place of the one held, and a plain card for
  // the one held (a few a run), from the fromLevel-th level-up. The new items share newWeight.
  const D = world.tuning.dashes;
  if (world.dash && world.player.level + 1 >= D.fromLevel) {
    const others = world.dashPool.filter((d) => d !== world.dash.def && !ban.has(`dash:${d.id}`));
    for (const d of others) out.push({ kind: 'dash', id: d.id, level: 1, isNew: true, w: (D.newWeight * (d.weight ?? 100)) / (100 * others.length) });
    if (dashUpsOpen(world).length) out.push({ kind: 'dash', id: world.dash.def.id, level: world.dash.ups.length + 2, isNew: false, w: D.upWeight });
  }
  // The Try-Pot, after a skip: only what you own, while there is any (it never locks the draft).
  if (world.tryPot !== null && world.tryPot.armed === 1) {
    const owned = out.filter((c) => !c.isNew);
    if (owned.length) return owned;
  }
  return out;
}

export function ownsWeapon(world, id) {
  for (let s = 0; s < world.slots.length; s++) if (world.slots[s] && world.slots[s].def && world.slots[s].def.id === id) return true;
  return false;
}

function drawCards(world, cands, n, exclude = null) {
  const rng = world.rng.draft;
  const weights = cands.map((c) => (exclude && exclude.has(candKey(c)) ? 0 : c.w));
  const cards = [];
  for (let k = 0; k < n; k++) {
    const i = rng.weighted(weights);
    if (i < 0) break;
    weights[i] = 0;
    cards.push(cands[i]);
  }
  return cards;
}

/** What a card or a slot's shown upgrade is, as a key (so a weapon's second card shows something else). */
function upKey(c) { return c.up === 'line' ? `line:${c.line}` : c.up === 'special' ? `special:${c.special}` : c.up; }

/** A drawn candidate as a card: a weapon carried rolls its upgrade now (`skip`: what is already showing for it). */
function toCard(world, c, skip = null, opts = null) {
  if (c.kind === 'weapon' && !c.isNew) {
    const u = rollUpgrade(world, c.slot, world.rng.draft, skip, opts);
    if (!u) return null;
    if (u.up === 'special') noteLegendaryOffered(world, c.slot);
    const slot = world.slots[c.slot], n = slot.ups.length + 1;
    const card = { kind: 'weapon', id: c.id, slot: c.slot, level: c.level, isNew: false, ...u };
    card.kin = Math.min(world.tuning.weaponUps.kindred?.max ?? 99, kinCount(world, slot.def.tags || [], c.slot));   // (ruling 21 WC: only the kin that count)
    // A late step this upgrade reaches (data `steps`: the Harpoon Chain's), said on its card the way
    // an axis that opens is (ruling 19 RE), not in the weapon's description.
    const step = (slot.def.steps || []).find((x) => x.at === n);
    if (step) card.step = { pierce: step.pierce ?? 0, amount: step.amount ?? 0, damageMul: step.damageMul ?? 1 };
    // What the level opens, what is next, and its capstone's deed (the card's lines: work/cw/C1-CONTRACT.md 7.1).
    card.opens = axisAt(world, c.slot, n);
    const nx = axisState(world, c.slot).find((a) => a.at !== null && !a.open && a.at > n);
    card.next = nx ? { axis: nx.axis, at: nx.at, left: nx.at - n } : null;
    const pay = axisState(world, c.slot).find((a) => a.axis === 'payoff');
    card.deed = pay ? (pay.locked ? { locked: pay.locked } : deedState(world, c.slot)) : null;
    return card;
  }
  if (c.kind === 'dash' && !c.isNew) {
    const u = rollDashUp(world, world.rng.draft);
    return u ? { kind: 'dash', id: c.id, level: c.level, isNew: false, ...u } : null;
  }
  const card = { kind: c.kind, id: c.id, level: c.level, isNew: c.isNew };
  if (c.kind === 'weapon') { const def = world.weaponDefs[world.weaponIndex.get(c.id)]; card.kin = Math.min(world.tuning.weaponUps.kindred?.max ?? 99, kinCount(world, def.tags || [], -1)); }
  if (c.kind === 'passive') {
    const def = world.passiveDefs.find((x) => x.id === c.id);
    if (def && def.keystone && c.level >= def.maxLevel) card.keystone = true;   // this level adds the passive's rule
  }
  return card;
}

/** What is already showing for the weapon in slot s. */
function shownFor(cards, s) {
  const out = new Set();
  for (const c of cards) if (c.kind === 'weapon' && !c.isNew && c.slot === s) out.add(upKey(c));
  return out;
}

/** Fill a short offer with more upgrades of weapons carried (each a type not already showing for it). */
function fillUps(world, cards, n) {
  const b = world.build;
  while (cards.length < n) {
    const open = [];
    for (let s = 0; s < b.weaponSlots; s++) {
      const slot = world.slots[s];
      if (!isDrafted(slot)) continue;
      const shown = shownFor(cards, s);
      // (A Legendary never sits beside a number on the same weapon: a weapon showing its special shows nothing else.)
      if ([...shown].some((k) => k.startsWith('special:'))) continue;
      if (upsOpen(world, slot).some((t) => !shown.has(t.id))) open.push(s);
    }
    if (!open.length) return;
    const s = open[world.rng.draft.int(open.length)];
    const card = toCard(world, { kind: 'weapon', id: world.slots[s].def.id, slot: s, level: world.slots[s].level + 1, isNew: false }, shownFor(cards, s), { noSpecial: true });
    if (!card) return;
    cards.push(card);
  }
}

/** Is every card on this draft a weapon upgrade (the build is full: "Pick for me" may answer it)? */
export function draftFull(world, halt) {
  return !!halt && halt.kind === 'draft' && Array.isArray(halt.offer) && halt.offer.length > 0 && halt.offer.every((c) => c.kind === 'weapon' && !c.isNew && !!c.up);
}

/**
 * The card "Pick for me" takes: the weapon upgrade with the highest upgradeScore (its rarity's
 * multiplier x the weapon's tag weight), ties to the earlier card; with no weapon upgrade, the first
 * card. Pure: the app sends { kind: 'pick', index }.
 */
export function autoPick(world, halt) {
  let best = 0, bestS = -Infinity;
  halt.offer.forEach((c, i) => {
    if (!(c.kind === 'weapon' && !c.isNew && c.up)) return;
    const sc = upgradeScore(world, c);
    if (sc > bestS) { best = i; bestS = sc; }
  });
  return best;
}

/** What a skip pays now ({ kind: GIFT.*, amount }), or null when skips pay nothing (tuning.draft.skipPays). */
export function skipPay(world) {
  const T = world.tuning.draft;
  if (!T.skipPays) return null;
  // (The sweep, A5: food does nothing for a character who can't heal. She is paid Pearls or Coin.)
  if (!world.config.noHeal && world.player.hp < world.stats.maxHp * T.autoHealBelow) return { kind: GIFT.FOOD, amount: T.fallbackHeal };
  if (world.ferry) return { kind: GIFT.GLASS, amount: T.autoGlass };
  return { kind: GIFT.COIN, amount: T.fallbackCoin };
}

/** Does this card change the build (C1's measure): a new piece, a line, a Legendary, an axis, a keystone, a dash card? */
export function changesBuild(c) {
  return (c.kind === 'weapon' && (c.isNew || c.up === 'line' || c.up === 'special' || !!c.opens)) || (c.kind === 'passive' && (c.isNew || !!c.keystone)) || c.kind === 'dash';
}

/** W6: put one build-changing card in place of the last plain one. */
function lateSwap(world, cards, cands) {
  const b = world.build, at = cards.length - 1;
  for (let s = 0; s < b.weaponSlots; s++) {
    const slot = world.slots[s];
    if (!isDrafted(slot)) continue;
    const u = rollUpgrade(world, s, world.rng.draft, shownFor(cards, s), { min: 2 });
    if (u && (u.up === 'line' || u.up === 'special')) {
      if (u.up === 'special') noteLegendaryOffered(world, s);
      cards[at] = { kind: 'weapon', id: slot.def.id, slot: s, level: slot.level + 1, isNew: false, ...u, opens: axisAt(world, s, slot.ups.length + 1), next: null, deed: null };
      return;
    }
  }
  const other = cands.filter((c) => c.isNew || c.kind === 'dash');
  if (other.length) { const c = toCard(world, drawCards(world, other, 1)[0]); if (c) cards[at] = c; }
}

/** Build a new offer for the current level-up. */
export function makeOffer(world) {
  const T = world.tuning.draft;
  const n = world.config.draftCards ?? T.cards;
  const cands = draftCandidates(world);
  let picks = drawCards(world, cands, n);
  // Early rule: until you own a couple of weapons, make sure one card is a new weapon.
  const early = countWeapons(world) < T.earlyWeaponUntil;
  const isNewWeapon = (c) => c.kind === 'weapon' && c.isNew;
  if (early && picks.length > 0 && !picks.some(isNewWeapon)) {
    const newWeapons = cands.filter(isNewWeapon);
    if (newWeapons.length) {
      const pickW = drawCards(world, newWeapons, 1);
      if (pickW.length) picks[picks.length - 1] = pickW[0];
    }
  }
  // W6: at most one new passive a draft (the rest are drawn again from what isn't one).
  const isNewPassive = (c) => c.kind === 'passive' && c.isNew;
  if (picks.filter(isNewPassive).length > 1) {
    const keep = new Set(picks.map(candKey));
    let first = true;
    picks = picks.filter((c) => { if (!isNewPassive(c)) return true; if (first) { first = false; return true; } return false; });
    const more = drawCards(world, cands.filter((c) => !isNewPassive(c) && !keep.has(candKey(c))), n - picks.length);
    picks.push(...more);
  }
  // W8: on the draft of each level in dashAt, one card is another dash item (a real dash choice).
  const D = world.tuning.dashes;
  if ((T.dashAt || []).includes(world.player.level + 1) && world.dash && !picks.some((c) => c.kind === 'dash' && c.isNew)) {
    const items = cands.filter((c) => c.kind === 'dash' && c.isNew);
    if (items.length && picks.length) picks[picks.length - 1] = drawCards(world, items, 1)[0];
  }
  const cards = picks.map((c) => toCard(world, c)).filter(Boolean);
  if (cands.length) fillUps(world, cards, n);
  // W6: from lateFrom, never three plain numbers: one card becomes a line or a Legendary on a
  // weapon carried, else a new piece or a dash card.
  if (world.tick >= (T.lateFrom ?? 1e9) * TPS && cards.length && !cards.some(changesBuild)) lateSwap(world, cards, cands);
  // Nothing left to level: the fallback cards.
  if (!cards.length) cards.push(...fallbackCards(world));
  return cards;
}

/**
 * A level-up with nothing left to level (no card to draw), paid on the spot with no screen
 * (tuning.draft): Food when below autoHealBelow of max health, else autoGlass Sea Glass while
 * the Ferryman is in the run, else Coin; and every autoEmberEvery-th such level an Ember, kept
 * for the pause menu, while a weapon can still take a Form. Each is a LEVEL_GIFT event (c: the level).
 */
export function levelGift(world, level) {
  const T = world.tuning.draft, p = world.player;
  world.dryLevels++;
  let kind, amount;
  if (!world.config.noHeal && p.hp < world.stats.maxHp * T.autoHealBelow) {
    kind = GIFT.FOOD; amount = T.fallbackHeal;
    heal(world, amount);
  } else if (world.ferry) {
    kind = GIFT.GLASS; amount = T.autoGlass;
    addGlass(world, amount, p.x, p.y);
  } else {
    kind = GIFT.COIN; amount = T.fallbackCoin;
    addMaterial(world, world.materialIndex.get('coin'), amount);
  }
  world.events.push(EV.LEVEL_GIFT, p.x, p.y, kind, amount, level);
  if (T.autoEmberEvery > 0 && world.dryLevels % T.autoEmberEvery === 0 && emberUseful(world)) {
    world.build.embers++;
    world.result.embers++;
    world.events.push(EV.LEVEL_GIFT, p.x, p.y, GIFT.EMBER, 1, level);
  }
}

/** Is this draft dry (nothing to draw) and paid without a stop? */
export function draftIsDry(world) {
  return world.tuning.draft.autoFallback === true && draftCandidates(world).length === 0;
}

function fallbackCards(world) {
  // (No heal card for a character who can't heal: the sweep, A5.)
  if (world.config.noHeal) return [{ kind: 'coin', id: 'coin', level: 0, isNew: false }];
  return [{ kind: 'heal', id: 'heal', level: 0, isNew: false }, { kind: 'coin', id: 'coin', level: 0, isNew: false }];
}

function countWeapons(world) {
  let n = 0;
  // (Weapons the draft gave or can grow: a character's own doesn't count toward the early rule.)
  for (let s = 0; s < world.build.weaponSlots; s++) if (isDrafted(world.slots[s])) n++;
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
      // The Try-Pot: the pick after a skip gains its levels (a passive capped at its max; a weapon's
      // the same upgrade again while it's open, else one rolled on the draft stream).
      const TP = world.tryPot;
      if (TP !== null && TP.armed === 1) {
        TP.armed = 0;
        if (!c.isNew && (c.kind === 'weapon' || c.kind === 'passive')) {
          for (let k = 1; k < TP.levels; k++) {
            if (c.kind === 'weapon') {
              const slot = world.slots[c.slot];
              const same = c.up !== 'line' && c.up !== 'special' && upsOpen(world, slot).includes(UP_TYPES.get(c.up));
              const u = same ? null : rollUpgrade(world, c.slot, world.rng.draft);
              if (same || u) applyCard(world, { ...c, ...(u || {}), level: slot.level + 1 });
            } else applyCard(world, { ...c, level: c.level + k });
          }
          world.result.tryPotLevels += TP.levels;
        }
      }
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
      // Replace just that card, never with another already showing (a weapon's other card may
      // be redrawn with a new roll: the banished type is gone for it). Early on, if that took away
      // the offer's only new weapon, the replacement is a new weapon when one is left.
      const others = cards.filter((x, i) => i !== d.index);
      const showing = new Set(others.map((x) => candKey(x)));
      const cands = draftCandidates(world);
      const isNewWeapon = (x) => x.kind === 'weapon' && x.isNew;
      const needWeapon = countWeapons(world) < world.tuning.draft.earlyWeaponUntil && isNewWeapon(c) &&
        !others.some(isNewWeapon);
      let repl = needWeapon ? drawCards(world, cands.filter(isNewWeapon), 1, showing) : [];
      if (!repl.length) repl = drawCards(world, cands, 1, showing);
      let card = repl.length ? toCard(world, repl[0]) : null;
      if (!card) {
        // Only weapons already showing are left: another upgrade for one of them.
        const tmp = others.slice();
        fillUps(world, tmp, others.length + 1);
        if (tmp.length > others.length) card = tmp[tmp.length - 1];
      }
      if (card) cards[d.index] = card;
      else cards.splice(d.index, 1);
      if (!cards.length) halt.offer = fallbackCards(world);
      return false;
    }
    case 'skip':
      if (ch.skip <= 0) throw new Error('draft: no skips left');
      ch.skip--;
      world.result.skips++;
      if (world.tryPot !== null) world.tryPot.armed = 1;   // the next level-up is the Try-Pot's
      // A skip pays what a dry level pays (and counts toward its Embers).
      if (world.tuning.draft.skipPays) { levelGift(world, halt.level ?? world.player.level); world.result.skipGifts++; }
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
        // A rolled upgrade: onto that weapon, and the axis its count opens, if any.
        const s = Number.isInteger(c.slot) && world.slots[c.slot]?.def?.id === c.id ? c.slot : world.slots.findIndex((x) => x && x.def && x.def.id === c.id);
        if (s < 0) throw new Error(`weapon ${c.id} is not owned`);
        if (!c.up) throw new Error(`weapon ${c.id}: a level-up card names its upgrade`);
        takeUpgrade(world, s, c);
        levelUpAxis(world, s);
      }
      break;
    }
    case 'passive': {
      const owned = world.build.passives.find((x) => x.def.id === c.id);
      if (owned) owned.level = Math.min(owned.def.maxLevel, owned.level + 1);
      else {
        if (world.build.passives.length >= world.build.passiveSlots) throw new Error('no free passive slot');
        const def = world.passiveDefs.find((x) => x.id === c.id);
        world.build.passives.push({ def, level: 1 });
      }
      break;
    }
    case 'dash':
      // The Dash slot holds one: a new item takes its place (fresh), a card goes on the one held.
      if (c.isNew) setDash(world, c.id);
      else takeDashUp(world, c);
      break;
    case 'heal':
      // (A replay from before the guard can still name the card: it pays Coin for a character who can't heal.)
      if (world.config.noHeal) addMaterial(world, world.materialIndex.get('coin'), world.tuning.draft.fallbackCoin);
      else heal(world, world.tuning.draft.fallbackHeal);
      break;
    case 'coin':
      addMaterial(world, world.materialIndex.get('coin'), world.tuning.draft.fallbackCoin);
      break;
    default:
      throw new Error(`unknown card kind ${c.kind}`);
  }
  markStatsDirty(world);
}
