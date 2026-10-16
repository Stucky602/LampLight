// The harbor's guide for a new player (ARCHITECTURE §10.4): one plain goal at a time, and where
// it is. Pure: what the profile has done decides the step. It ends once the Lamp Post is
// restored; after that the Next up panel says what's within reach.
//
//   no run yet                       -> go to the gate (the bottom left of town) and start a run
//   a run, no Lamp Post, can pay     -> restore the Lamp Post on the square
//   a run, no Lamp Post, can't pay   -> back out through the gate for more

import { levelOf } from './state.js';
import { canPay } from './costs.js';
import { shortText } from './actions.js';

/**
 * The guide's step for this profile: { id, text, target: { kind: 'gate' } | { kind: 'door', id } },
 * or null when there's nothing left to point at.
 */
export function guideStep(doc, data) {
  const runs = Number(doc?.stats?.runs) || 0;
  if (runs === 0) return { id: 'first_run', text: 'Go to the gate at the bottom left of town to start a run', target: { kind: 'gate' } };
  const lamp = data.buildings.find((b) => b.id === 'lamp_post');
  if (lamp && levelOf(doc, 'lamp_post', data) === 0) {
    if (canPay(doc?.profile?.materials ?? {}, lamp.levels[0].cost)) {
      return { id: 'lamp_post', text: 'Restore the Lamp Post with what you brought home', target: { kind: 'door', id: 'lamp_post' } };
    }
    const short = shortText(data, doc?.profile?.materials ?? {}, lamp.levels[0].cost);
    return { id: 'more', text: `Lamp Post needs ${short}. Go back out through the gate`, target: { kind: 'gate' } };
  }
  return null;
}
