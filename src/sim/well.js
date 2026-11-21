// The Salt Well (ARCHITECTURE §5.17; docs/design/SALT_MARSH.md, the elite event): with the run's
// 'well' layer, the Well Warden's muster comes at 15:00, and where he falls a well opens for the
// rest of the run, no timer. Its ring (`radius` px) fills while you're inside it, moving allowed
// (0.8.2: it was stand still), and at `openSec` the run stops for the choice: give up one relic
// you carry, or keep. It doesn't fill while you carry none. A relic given is gone for this run
// (everything it did to the run undone: sim/build.js removeRelic) and the result names it
// (`wellGiven`), so the Ferryman offers it in a Well slot on every map from then on (meta, B5).
// One relic a run; never while the Bog Torc has you sunk. 0.9.0 (W4, V3): it asks once a run on its
// own; after that it asks again only when you come back and stand still in its ring for openSec
// (ruling 16: it used to be a dash into the ring; the dash links to nothing).
// Without the run's 'well' layer no well opens, whichever muster's captain falls (the 15:00 Salt
// Well becomes an elite, and the overtime Salt Watch still comes but opens nothing).

import { DT } from './constants.js';
import { EV, SIGHT } from './events.js';
import { TILE } from './terrain.js';
import { removeRelic } from './build.js';
import { sightThing } from './sight.js';
import { fnv1a } from '../lib/hash.js';

/** The run's well: closed until the Well Warden falls. */
export function createWell() {
  return { open: false, x: 0, y: 0, armed: true, touch: 0, given: null, asked: false };
}

/** The Well Warden fell at (x, y): the well opens there (on ground you can stand on), with the run's 'well' layer only. */
export function openWell(world, x, y) {
  const W = world.well;
  if (W.open || world.layers.well !== true) return;
  const T = world.terrain;
  if (T.blockedAt(x, y)) { const o = world.scratch.open; if (T.nearestOpen(Math.floor(x / TILE), Math.floor(y / TILE), o)) { x = o[0]; y = o[1]; } }
  W.open = true; W.x = x; W.y = y; W.armed = true; W.touch = 0;
  world.events.push(EV.WELL, x, y, 1);
  sightThing(world, SIGHT.WELL);
}

/** Each tick, after you move: the open well's ring fills while you're inside and asks for a relic (once, until you leave the ring; after the first ask, only standing still fills it). */
export function wellStep(world) {
  const W = world.well;
  if (!W.open || W.given !== null) return;
  const T = world.tuning.well, p = world.player;
  const dx = p.x - W.x, dy = p.y - W.y;
  if (dx * dx + dy * dy > T.radius * T.radius) { W.armed = true; W.touch = 0; return; }
  if (!W.armed || world.build.relics.length === 0 || (world.torc !== null && world.torc.sinkUntil >= 0)) { W.touch = 0; return; }
  // The first time, the ring fills while you're inside (moving allowed). Asked once already, it
  // fills only while you stand still in it (walking through a fight never asks). The dash reads
  // nothing here (ruling 16).
  if (W.asked && (p.moving || p.dashTicks > 0)) { W.touch = 0; return; }
  W.touch += DT;
  if (W.touch + 1e-9 < T.openSec) return;
  W.armed = false; W.touch = 0; W.asked = true;
  world.halts.push({ kind: 'well', relics: world.build.relics.map((r) => r.id) });
}

/** The well's answer: { kind: 'give', id } gives that relic up; { kind: 'keep' } walks away. Returns true (done). */
export function wellDecide(world, h, d) {
  const W = world.well;
  if (d.kind === 'keep') { world.events.push(EV.WELL, W.x, W.y, 3); return true; }
  if (d.kind !== 'give') throw new Error(`well: expected "give" or "keep", got "${d.kind}"`);
  if (W.given !== null) throw new Error('well: a relic has already been given this run');
  const r = world.build.relics.find((x) => x.id === d.id);
  if (!r || !h.relics.includes(d.id)) throw new Error(`well: ${d.id} isn't carried`);
  removeRelic(world, r);
  W.given = r.id;
  world.result.wellGiven = r.id;
  world.events.push(EV.WELL, W.x, W.y, 2, world.relicDefs.indexOf(r));
  return true;
}

export function hashWell(W, h) {
  h.int(-13).int(W.open ? 1 : 0).int(W.armed ? 1 : 0).int(W.asked ? 1 : 0).float64(W.touch).float64(W.x).float64(W.y).int(W.given === null ? -1 : fnv1a(W.given));
}
