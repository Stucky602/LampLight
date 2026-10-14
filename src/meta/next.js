// The next three things you can nearly afford (ARCHITECTURE §10.1 nextAffordable; brief §6.2:
// "there's always a one more run"). Pure; tested in Node. The harbor pins the list in a corner,
// and the results screen shows it after a run.

import { progress, missing } from './costs.js';
import { levelOf, rankOf, treeTier, researchTier, researchSlots, researchDone, researchActive } from './state.js';
import { nextLevelCost, nextRankCost, partOf } from './actions.js';

/**
 * Everything that could be bought once it's affordable (building levels, upgrade ranks whose tier
 * is open, research that could start), each with how close it is:
 * [{ kind: 'building' | 'upgrade' | 'research', id, level?, rank?, cost, progress, missing }].
 */
export function purchaseOptions(doc, data) {
  const have = partOf(doc, 'materials');
  const out = [];
  const push = (o) => out.push({ ...o, progress: progress(have, o.cost), missing: missing(have, o.cost) });
  for (const b of data.buildings) {
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
