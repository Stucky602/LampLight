// Boss rigs, the layout (ARCHITECTURE §5.13, §6.4): a big boss is several atlas sprites (body,
// jaw, fins, lure; robe, staff, hand, bell, tentacles) moved by code, which is how a small sprite
// set makes big bosses that breathe, open their mouths, and ring their bells. This file says what
// the parts are and where they sit; render/rigpose.js says how they move; render/rigview.js draws
// them, and where each rig's own light shines. The atlas builder reads only this file (the resting
// pose as one frame), so changing how a rig moves or glows never makes the atlas out of date.
// Pure, tested in Node.
//
// Layout, per part (drawn in this order, back to front):
//   frame    the atlas frame (its #flash twin is used during the hit flash)
//   x, y     where the part's pivot sits, relative to the boss's position (its body's center)
//   px, py   the pivot inside the frame, in pixels (the part turns around it)
//   flip     mirrored left to right (a left fin drawn from the right one)
//   follow   attach to an earlier part's point: [index of that part, x, y in its frame]

export const RIGS = Object.freeze({
  boss_maw: {
    parts: [
      { name: 'finL', frame: 'boss_maw:fin', x: -21, y: 1, px: 1, py: 7, flip: true },
      { name: 'finR', frame: 'boss_maw:fin', x: 21, y: 1, px: 1, py: 7 },
      { name: 'mouth', frame: 'boss_maw:mouth', x: 0, y: 3, px: 20, py: 0 },
      { name: 'jaw', frame: 'boss_maw:jaw', x: 0, y: 5, px: 23, py: 3 },
      { name: 'body', frame: 'boss_maw:body', x: 0, y: -7, px: 25, py: 18 },
      { name: 'stalk', frame: 'boss_maw:stalk', x: -3, y: -22, px: 2, py: 16 },
      { name: 'bulb', frame: 'boss_maw:bulb', x: 0, y: 0, px: 3, py: 3, follow: [5, 12, 4] },
    ],
  },
  boss_tidecaller: {
    parts: [
      { name: 't0', frame: 'boss_tidecaller:tentacle', x: -13, y: 5, px: 3, py: 1, flip: true },
      { name: 't1', frame: 'boss_tidecaller:tentacle', x: -6, y: 6, px: 3, py: 1, flip: true },
      { name: 't2', frame: 'boss_tidecaller:tentacle', x: 1, y: 6, px: 3, py: 1 },
      { name: 't3', frame: 'boss_tidecaller:tentacle', x: 8, y: 6, px: 3, py: 1 },
      { name: 't4', frame: 'boss_tidecaller:tentacle', x: 14, y: 5, px: 3, py: 1 },
      { name: 'robe', frame: 'boss_tidecaller:robe', x: 0, y: -10, px: 19, py: 28 },
      { name: 'staff', frame: 'boss_tidecaller:staff', x: 14, y: -15, px: 2, py: 24 },
      { name: 'hand', frame: 'boss_tidecaller:hand', x: 0, y: 0, px: 3, py: 2, follow: [6, 2, 22] },
      { name: 'bell', frame: 'boss_tidecaller:bell', x: 0, y: 0, px: 8, py: 1, follow: [6, 9, 7] },
    ],
  },
});

/** Problems with a rig's layout, as sentences (a follower must come after the part it follows). */
export function checkRig(id, rig = RIGS[id]) {
  const out = [];
  if (!rig) return [`no rig "${id}"`];
  rig.parts.forEach((p, k) => {
    if (!p.frame || !Number.isFinite(p.px) || !Number.isFinite(p.py)) out.push(`${id} part ${k}: needs a frame and a pivot`);
    if (p.follow && !(Number.isInteger(p.follow[0]) && p.follow[0] >= 0 && p.follow[0] < k)) out.push(`${id} part ${p.name}: follows part ${p.follow[0]}, which isn't an earlier part`);
  });
  return out;
}

/** A pose buffer for the rig: 5 numbers per part (dx, dy, turn, scale x, scale y). */
export function createPose(rig) {
  return new Float64Array(rig.parts.length * 5);
}

/** The resting pose: every part where the layout puts it, unturned, full size. */
export function restPose(rig, pose = createPose(rig)) {
  for (let k = 0; k < rig.parts.length; k++) { const o = k * 5; pose[o] = 0; pose[o + 1] = 0; pose[o + 2] = 0; pose[o + 3] = 1; pose[o + 4] = 1; }
  return pose;
}

/**
 * Where each part's pivot ends up (relative to the boss), after its pose, following the parts it
 * is attached to. Writes x, y pairs into `out` (2 numbers per part). The facing flip is applied
 * by the caller (the whole rig mirrors).
 */
export function rigPlace(id, pose, out) {
  const rig = RIGS[id];
  for (let k = 0; k < rig.parts.length; k++) {
    const p = rig.parts[k], o = k * 5;
    if (p.follow) {
      const j = p.follow[0], q = rig.parts[j], oj = j * 5;
      // The followed point, in that part's frame, relative to its pivot, scaled and turned.
      let lx = (p.follow[1] - q.px) * pose[oj + 3];
      const ly = (p.follow[2] - q.py) * pose[oj + 4];
      if (q.flip) lx = -lx;
      const c = Math.cos(pose[oj + 2]), sn = Math.sin(pose[oj + 2]);
      out[k * 2] = out[j * 2] + lx * c - ly * sn + p.x + pose[o];
      out[k * 2 + 1] = out[j * 2 + 1] + lx * sn + ly * c + p.y + pose[o + 1];
    } else {
      out[k * 2] = p.x + pose[o];
      out[k * 2 + 1] = p.y + pose[o + 1];
    }
  }
  return out;
}
