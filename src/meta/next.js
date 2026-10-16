// The next three things you can nearly afford (ARCHITECTURE §10.1 nextAffordable; brief §6.2:
// "there's always a one more run"). Pure; tested in Node. The harbor pins the list in a corner,
// and the results screen shows it after a run.

import { progress, missing } from './costs.js';
import { levelOf, rankOf, treeTier, researchTier, researchSlots, researchDone, researchActive, resolveContent, heldOf, levelEffect, perksOf, masteryOf } from './state.js';
import { nextLevelCost, nextRankCost, partOf, fogOver } from './actions.js';
import { gearItems, gearEquipped, gearTierMax, upgradeCost } from './workshop.js';

/**
 * Everything that could be bought once it's affordable, each with how close it is: building
 * levels, upgrade ranks whose tier is open, research that could start, and Phase 7's goals (gear
 * not made yet, a worn item's next tier, a perk its character has the rank for, a consumable
 * none of is held). Re-rolls and rune stones are left out: they're bought again and again, so
 * they would always be "nearly affordable" and crowd out the goals.
 * [{ kind: 'building' | 'upgrade' | 'research' | 'craft' | 'gear_tier' | 'perk' | 'consumable', id, level?, rank?, uid?, tier?, cost, progress, missing }].
 */
export function purchaseOptions(doc, data) {
  const have = partOf(doc, 'materials');
  const out = [];
  const push = (o) => out.push({ ...o, progress: progress(have, o.cost), missing: missing(have, o.cost) });
  for (const b of data.buildings) {
    if (fogOver(doc, data, b.id)) continue; // still in the fog
    const cost = nextLevelCost(doc, data, b.id);
    if (cost) push({ kind: 'building', id: b.id, level: levelOf(doc, b.id, data) + 1, cost });
  }
  const tier = treeTier(doc, data);
  for (const u of data.upgrades) {
    if (u.tier > tier) continue;
    const cost = nextRankCost(doc, data, u.id);
    if (cost) push({ kind: 'upgrade', id: u.id, rank: rankOf(doc, u.id) + 1, cost });
  }
  const done = researchDone(doc), active = researchActive(doc);
  if (active.length < researchSlots(doc, data)) {
    const rt = researchTier(doc, data);
    for (const r of data.research) {
      if (done.has(r.id) || active.some((a) => a.id === r.id) || r.tier > rt || !r.requires.every((q) => done.has(q))) continue;
      push({ kind: 'research', id: r.id, cost: r.cost });
    }
  }
  // Phase 7.
  const content = resolveContent(doc, data);
  if (levelOf(doc, 'smithy', data) > 0) {
    const held = new Set(gearItems(doc).map((x) => x.id));
    for (const r of data.recipes || []) if (content.recipes.includes(r.id) && !held.has(r.id)) push({ kind: 'craft', id: r.id, cost: r.cost });
    const worn = new Set(Object.values(gearEquipped(doc))), top = gearTierMax(doc, data);
    for (const it of gearItems(doc)) {
      if (!worn.has(it.uid) || it.tier >= top) continue;
      const cost = upgradeCost(data, it);
      if (cost) push({ kind: 'gear_tier', id: it.id, uid: it.uid, tier: it.tier + 1, cost });
    }
  }
  if (levelEffect(doc, data, 'tavern', 'mastery')) {
    for (const p of data.perks || []) {
      if (!content.characters.includes(p.character) || perksOf(doc, p.character).has(p.id) || masteryOf(doc, data, p.character).rank < p.rank) continue;
      push({ kind: 'perk', id: p.id, cost: p.cost });
    }
  }
  if (levelOf(doc, 'apothecary', data) > 0) {
    for (const c of data.consumables || []) if (content.consumables.includes(c.id) && heldOf(doc, c.id) === 0) push({ kind: 'consumable', id: c.id, cost: c.cost });
  }
  return out;
}

/** The `n` options closest to affordable: affordable ones first, then by how much is in hand. */
export function nextAffordable(doc, data, n = 3) {
  const total = (c) => Object.values(c).reduce((s, v) => s + v, 0);
  return purchaseOptions(doc, data)
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (b.o.progress - a.o.progress) || (total(a.o.cost) - total(b.o.cost)) || (a.i - b.i))
    .slice(0, n)
    .map(({ o }) => o);
}
