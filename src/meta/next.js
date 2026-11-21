// The next three things you can nearly afford (ARCHITECTURE §10.1 nextAffordable; brief §6.2:
// "there's always a one more run"). Pure; tested in Node. The harbor pins the list in a corner,
// and the results screen shows it after a run.

import { progress, missing } from './costs.js';
import { levelOf, rankOf, treeTier, researchTier, researchSlots, researchDone, researchActive, resolveContent, heldOf, levelEffect, contentFrom, isUnlocked } from './state.js';
import { nextLevelCost, nextRankCost, partOf, fogOver, levelNeeds, closedMapsFor } from './actions.js';
import { gearItems, gearEquipped, gearTierMax, upgradeCost } from './workshop.js';

/**
 * Everything that could be bought once it's affordable, each with how close it is: building
 * levels, upgrade ranks whose tier is open, research that could start, and Phase 7's goals (gear
 * not made yet, a worn item's next tier, a consumable
 * none of is held). Re-rolls are left out: they're bought again and again, so
 * they would always be "nearly affordable" and crowd out the goals.
 * [{ kind: 'building' | 'upgrade' | 'research' | 'craft' | 'gear_tier' | 'consumable', id, level?, rank?, uid?, tier?, cost, progress, missing, waits? }].
 * `waits` (0.8.0), only when there are any: the maps not open yet that an option waits on (a
 * project's `runsOn`, or the only map a material it's short of drops on), so the text can say so.
 */
export function purchaseOptions(doc, data) {
  const have = partOf(doc, 'materials');
  const out = [];
  const push = (o) => {
    const waits = closedMapsFor(doc, data, o.cost, o.kind === 'research' ? data.research.find((r) => r.id === o.id)?.runsOn : null);
    out.push({ ...o, progress: progress(have, o.cost), missing: missing(have, o.cost), ...(waits.length ? { waits } : {}) });
  };
  for (const b of data.buildings) {
    if (fogOver(doc, data, b.id) || levelNeeds(doc, data, b.id)) continue; // still in the fog, or its level waits on another (X3, D5)
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
      if (r.needs && !isUnlocked(doc, data, r.needs)) continue;   // waits for its building (data/research.js `needs`)
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
  if (levelOf(doc, 'apothecary', data) > 0) {
    for (const c of data.consumables || []) if (content.consumables.includes(c.id) && heldOf(doc, c.id) === 0) push({ kind: 'consumable', id: c.id, cost: c.cost });
  }
  return out;
}

/** What an option opens, as content (contentFrom): a building level's or a project's. [] for the rest. */
export function opensOf(data, o) {
  if (o.kind === 'building') return contentFrom(data, `building:${o.id}:${o.level}`);
  if (o.kind === 'research') return contentFrom(data, `research:${o.id}`);
  return [];
}

/**
 * Next up: the `n` options closest to affordable (0.7.3's rules, Kevin's playtest of 0.7.2):
 *   - closest first (affordable ones first, then by how much is in hand, then the cheaper);
 *   - the next building level out of the fog is always listed (the closest one), so the town's
 *     next step never drops off the list;
 *   - at most one upgrade rank (they're many and alike, and crowded out everything else);
 *   - no consumables (bought for a run, again and again, at the Apothecary);
 *   - one slot for something that opens content (a project or a level that adds things to your
 *     runs or the harbor), the closest such, marked with what it opens (`opens`: [{ what, id,
 *     name }]); the others carry no such line.
 */
export function nextAffordable(doc, data, n = 3) {
  const total = (c) => Object.values(c).reduce((s, v) => s + v, 0);
  const all = purchaseOptions(doc, data)
    .filter((o) => o.kind !== 'consumable')
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (b.o.progress - a.o.progress) || (total(a.o.cost) - total(b.o.cost)) || (a.i - b.i))
    .map(({ o }) => o);
  if (n <= 0) return [];
  const picked = [];
  const take = (o) => { if (o && !picked.includes(o) && picked.length < n) picked.push(o); };
  take(all.find((o) => o.kind === 'building'));
  const opener = all.find((o) => opensOf(data, o).length);
  take(opener);
  let upgrades = picked.filter((o) => o.kind === 'upgrade').length;
  for (const o of all) {
    if (picked.length >= n) break;
    if (picked.includes(o)) continue;
    if (o.kind === 'upgrade') { if (upgrades >= 1) continue; upgrades++; }
    // One opener: another that opens content takes a slot, but says nothing about it.
    picked.push(o);
  }
  return all.filter((o) => picked.includes(o)).map((o) => (o === opener ? { ...o, opens: opensOf(data, o).map(({ what, id, name }) => ({ what, id, name })) } : o));
}
