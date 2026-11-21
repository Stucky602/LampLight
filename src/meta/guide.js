// The harbor's guide for a new player (ARCHITECTURE §10.4): one plain goal at a time, and where
// it is. Pure: what the profile has done decides the step. It ends once the Lamp Post is
// restored; after that the Next up panel says what's within reach.
//
//   no run yet                       -> go to the gate (the bottom left of town) and start a run
//   a run, no Lamp Post, can pay     -> restore the Lamp Post on the square
//   a run, no Lamp Post, can't pay   -> back out through the gate for more
//
// After that (0.7.3), when a run opened something at a restored building (a gear pattern at the
// Smithy, a run tool at the Apothecary, a skill point to spend at the Tavern), the guide says "New at the
// Smithy" and points at its door until the player goes in (`newAt`, kept by the harbor scene).

import { SKILL_RANKS } from '../data/skills.js';
import { levelOf, levelEffect } from './state.js';
import { canPay } from './costs.js';
import { shortText } from './actions.js';

/**
 * The guide's step for this profile: { id, text, target: { kind: 'gate' } | { kind: 'door', id } },
 * or null when there's nothing left to point at.
 */
export function guideStep(doc, data, newAt = []) {
  const runs = Number(doc?.stats?.runs) || 0;
  if (runs === 0) return { id: 'first_run', text: 'Go to the gate at the bottom left of town to start a run', target: { kind: 'gate' } };
  const lamp = data.buildings.find((b) => b.id === 'lamp_post');
  if (lamp && levelOf(doc, 'lamp_post', data) === 0) {
    if (canPay(doc?.profile?.materials ?? {}, lamp.levels[0].cost)) {
      return { id: 'lamp_post', text: 'Restore the Lamp Post with what you brought home', target: { kind: 'door', id: 'lamp_post' } };
    }
    const short = shortText(data, doc?.profile?.materials ?? {}, lamp.levels[0].cost);
    return { id: 'more', text: `The Lamp Post still needs ${short}. Go back out through the gate for more`, target: { kind: 'gate' } };
  }
  const at = newAt.find((id) => levelOf(doc, id, data) > 0 && data.buildings.some((b) => b.id === id));
  if (at) return { id: 'new_at', text: `New at the ${data.buildings.find((b) => b.id === at).name}`, target: { kind: 'door', id: at } };
  return null;
}

/** Where a kind of content is found in the harbor, when it's at a building (a recipe at the Smithy). */
const AT = Object.freeze({ recipe: 'smithy', consumable: 'apothecary' });

/**
 * The restored buildings where a run's changes (applyRunResult's, and a results screen's after Run
 * again) opened something to use there, in the order the changes said them: a gear pattern
 * to make at the Smithy, a run tool at the Apothecary, a skill point to spend or an order
 * newly listed at the Tavern. `doc` is the profile
 * after the run.
 */
export function newsAt(doc, data, changes) {
  const out = [];
  const add = (id) => { if (id && levelOf(doc, id, data) > 0 && !out.includes(id)) out.push(id); };
  for (const c of changes || []) {
    for (const u of c.unlocks || []) {
      add(AT[u.what]);
    }
    if (c.kind === 'mastery' && levelEffect(doc, data, 'tavern', 'mastery') && SKILL_RANKS.includes(c.rank)) add('tavern');
    if (c.kind === 'feat_found' && levelEffect(doc, data, 'tavern', 'feats')) add('tavern');
  }
  return out;
}
