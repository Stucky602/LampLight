// How boss rigs move (ARCHITECTURE §5.13, §6.4): each part's pose from what the boss is doing.
// The layout is render/rigs.js. Pure: tested in Node; render/runview.js feeds it each frame.
//
// The Harbor Maw breathes (the jaw works, the body swells, the lure sways); its jaw drops as a
// slam's warning fills, it leans into a charge, its fins spread while it calls up a summon, and
// its lure's bulb swells and flickers fast while it lures.
// The Tidecaller's robe sways and its tentacles curl; its bell swings hard while it rings up a
// fan or a summon, the robe rises before a slam, the tentacles reach out before its pools (and
// further, with the staff raised, before its tide lanes), and it leans the staff into a charge.
// The Old Grey (0.8.0) stalks, its legs stepping in turn; draws its neck back into the S before it
// stabs and thrusts it out after; leaps with its wings spread (its only time they show), neck
// folded and legs trailing; calls its summons with its bill up; and stuck in the mud, sinks to its
// knees with its head down. The Salt Widow sways; raises her arm toward you as her lightning
// marches, sweeps it as she throws, lifts both to summon, rises before a slam, and kneels, low and
// still, while she's weak.

import { RIGS } from './rigs.js';
import { BOSS_STATE, warnTime, bossWeak } from '../sim/bosses.js';
import { TPS } from '../sim/constants.js';

/** The boss states, straight from the sim (a rig reads them; it never keeps its own copy). */
export const RIG_STATE = BOSS_STATE;

/**
 * Each rig's own light, for the light map: the part it shines from (an index into the rig's
 * parts), a point inside that part (`at`, in the part's frame; default its pivot), its radius in
 * pixels, and its color. Here rather than in rigs.js, so a "the lure glows too wide" tweak never
 * needs the art packs.
 */
export const RIG_LIGHTS = Object.freeze({
  boss_maw: Object.freeze({ part: 6, radius: 44, color: 'lamp-5' }),                   // the lure's bulb, warm like a lamp (it's a lure)
  boss_tidecaller: Object.freeze({ part: 5, radius: 36, at: [19, 13], color: 'sea-6' }), // the eyes, a cold green in the hood
  boss_salt_widow: Object.freeze({ part: 1, radius: 34, at: [18, 11], color: 'gem-4' }),  // her pale eyes in the hood
});

/**
 * Where a rig's own light is, relative to the boss (before the facing flip): the light's part's
 * pivot, or a point inside that part (`at`), scaled, mirrored, and turned with the part.
 * Writes [x, y] into `out`; returns false for a rig with no light. `at` is rigPlace's output.
 */
export function rigLightAt(id, pose, at, out) {
  const rig = RIGS[id], light = RIG_LIGHTS[id];
  if (!rig || !light) return false;
  const k = light.part, p = rig.parts[k], o = k * 5;
  let lx = 0, ly = 0;
  if (light.at) {
    const ux = (light.at[0] - p.px) * pose[o + 3] * (p.flip ? -1 : 1), uy = (light.at[1] - p.py) * pose[o + 4];
    const c = Math.cos(pose[o + 2]), sn = Math.sin(pose[o + 2]);
    lx = ux * c - uy * sn; ly = ux * sn + uy * c;
  }
  out[0] = at[k * 2] + lx;
  out[1] = at[k * 2 + 1] + ly;
  return true;
}

function put(pose, k, dx, dy, rot, sx, sy) {
  const o = k * 5;
  pose[o] = dx; pose[o + 1] = dy; pose[o + 2] = rot; pose[o + 3] = sx; pose[o + 4] = sy;
}

/**
 * Work out a rig's pose. No allocation: writes into `pose` (render/rigs.js createPose).
 * @param {string} id  'boss_maw' or 'boss_tidecaller'
 * @param {{ t: number, state: number, attack: string, u: number }} s  t: seconds of sim time
 *   (plus a per-boss offset); state: RIG_STATE; attack: the attack's type ('' if none); u: 0..1
 *   through the warning
 * @param {Float64Array} pose
 */
export function rigPose(id, s, pose) {
  if (!RIGS[id]) throw new Error(`No rig "${id}"`);
  const t = s.t, u = Math.min(1, Math.max(0, s.u || 0));
  const warn = s.state === RIG_STATE.WARN, charging = s.state === RIG_STATE.CHARGE;
  if (id === 'boss_maw') {
    // Breathing: the jaw works a little and the body swells; the lure sways.
    let jaw = 1 + Math.sin(t * 1.7);
    let rise = 0, fin = 0.25 * Math.sin(t * 3), lean = 0, lure = 1;
    const swell = 0.02 * Math.sin(t * 2.4) + (warn && s.attack === 'slam_ring' ? 0.05 * u : 0);
    if (warn) {
      if (s.attack === 'slam_ring') { jaw = 2 + 6 * u; rise = -2 * u; }
      else if (s.attack === 'charge_line') { jaw = 3 + 2 * u; lean = 0.08 * u; fin = 0.5; }
      else if (s.attack === 'lure') { jaw = 3 + 3 * u; fin = 0.1 * Math.sin(t * 6); lure = 1 + 0.6 * u + 0.15 * Math.sin(t * 12); }
      else { jaw = 2 + 4 * u; fin = -0.6 * u + 0.15 * Math.sin(t * 9); }
    } else if (charging) { jaw = 6; fin = 0.6; lean = 0.1; }
    else if (s.state === RIG_STATE.RECOVER) jaw = 3;
    put(pose, 0, 0, rise, -fin, 1, 1);                                   // left fin
    put(pose, 1, 0, rise, fin, 1, 1);                                    // right fin
    put(pose, 2, 0, rise + jaw * 0.3, 0, 1, Math.max(0.2, jaw / 7));     // the dark of the mouth
    put(pose, 3, 0, rise + jaw, lean * 0.5, 1, 1);                       // the jaw
    put(pose, 4, 0, rise, lean, 1 + swell, 1 + swell);                   // the body
    put(pose, 5, 0, rise, 0.12 * Math.sin(t * 1.3) + lean, 1, 1);        // the lure's stalk
    // The bulb glows; while luring it swells and flickers fast (the lure is what draws you in).
    const glow = (1 + 0.12 * Math.sin(t * 4)) * lure;
    put(pose, 6, 0, 0, 0, glow, glow);                                   // the bulb
  } else if (id === 'boss_old_grey') {
    greyPose(s, t, u, warn, pose);
  } else if (id === 'boss_salt_widow') {
    widowPose(s, t, u, warn, pose);
  } else {
    let bell = 0.14 * Math.sin(t * 2), rise = Math.sin(t * 2) * 0.8, staffUp = 0, staffRot = 0.03 * Math.sin(t * 1.5), reach = 0;
    if (warn) {
      if (s.attack === 'projectile_fan' || s.attack === 'summon_wave') { bell = 0.6 * Math.sin(t * 14); staffUp = -4 * u; staffRot = -0.15 * u; }
      else if (s.attack === 'slam_ring') { rise = -3 * u; bell = 0.35 * Math.sin(t * 10); }
      else if (s.attack === 'hazard_pools') { reach = 0.5 * u; bell = 0.2 * Math.sin(t * 6); }
      else if (s.attack === 'tide_lanes') { reach = 0.8 * u; staffUp = -2 * u; bell = 0.5 * Math.sin(t * 8); }
      else staffRot = 0.2 * u;
    } else if (charging) { staffRot = 0.35; bell = 0.5; rise = -1; }
    for (let k = 0; k < 5; k++) {
      const side = k < 2 ? -1 : k > 2 ? 1 : 0;
      put(pose, k, 0, 0, 0.35 * Math.sin(t * 3 + k * 1.3) + side * 0.25 * reach, 1, 1 + reach * 0.4);
    }
    put(pose, 5, 0, rise, 0.04 * Math.sin(t * 2), 1, 1);                // the robe
    put(pose, 6, 0, rise + staffUp, staffRot, 1, 1);                    // the staff
    put(pose, 7, 0, 0, 0, 1, 1);                                        // the hand, on the staff
    put(pose, 8, 0, 0, bell, 1, 1);                                     // the bell, on the crook
  }
  return pose;
}

/** The Old Grey's pose (parts: wingFar, legFar, body, legNear, neck, head, wingNear). */
function greyPose(s, t, u, warn, pose) {
  const step = Math.sin(t * 4);
  let legF = 0.14 * step, legN = -0.14 * step, legS = 1, rise = 0.6 * Math.sin(t * 8);
  let neckR = 0.05 * Math.sin(t * 1.5), neckS = 1, headR = 0.04 * Math.sin(t * 1.1), wing = 0, wingR = 0, lean = 0;
  if (s.stuck) {
    // Stuck fast in the mud: sunk to its joints, still, head hung.
    legF = 0; legN = 0; legS = 0.55; rise = 8; neckR = 0.25; headR = 0.35;
  } else if (warn && s.attack === 'leap') {
    // In the air: wings spread and beating, neck folded back, legs trailing behind.
    wing = 1; wingR = -0.35 + 0.55 * Math.sin(t * 11); legF = 1.1; legN = 1.0; neckR = -0.45; neckS = 0.55; headR = 0.15; lean = 0.12;
  } else if (warn && s.attack === 'stab_line') {
    // Drawing the neck back into a tight S, the bill held level at you.
    neckR = -0.4 * u; neckS = 1 - 0.18 * u; headR = 0.35 * u; lean = -0.05 * u; legF = 0; legN = 0;
  } else if (s.state === RIG_STATE.RECOVER && s.attack === 'stab_line') {
    // The stab: the neck thrust out forward, the bill driven along it (not raised).
    neckR = 1.05; neckS = 1.2; headR = 0.25; lean = 0.1; legF = 0; legN = 0;
  } else if (warn && s.attack === 'summon_wave') {
    // Calling: the bill raised.
    neckR = -0.12; headR = -0.7 - 0.1 * Math.sin(t * 9); legF = 0; legN = 0;
  } else if (warn) { neckR = -0.2 * u; legF = 0; legN = 0; }
  put(pose, 0, 0, rise - 2, wingR - 0.3, wing, wing);   // the far wing, a little behind and higher
  put(pose, 1, 0, 0, legF, 1, legS);
  put(pose, 2, 0, rise, lean, 1, 1);
  put(pose, 3, 0, 0, legN, 1, legS);
  put(pose, 4, 0, 0, neckR, 1, neckS);
  put(pose, 5, 0, 0, headR, 1, 1);
  put(pose, 6, 0, 0, wingR, wing, wing);
}

/** The Salt Widow's pose (parts: armBack, cloak, crown, armFront). */
function widowPose(s, t, u, warn, pose) {
  let rise = Math.sin(t * 2) * 0.8, sway = 0.03 * Math.sin(t * 1.6), squash = 1;
  let front = 0.08 * Math.sin(t * 1.3), back = -0.06 * Math.sin(t * 1.3 + 1);
  if (s.weak) {
    // Kneeling: lower and shorter, arms hanging, still.
    rise = 6; squash = 0.86; sway = 0; front = 0.1; back = -0.05;
  } else if (warn && s.attack === 'lightning_march') { front = -1.45 * u; back = -0.4 * u; }
  else if (warn && s.attack === 'projectile_fan') { front = -1.1 + 0.5 * Math.sin(t * 7); back = -0.2; }
  else if (warn && s.attack === 'summon_wave') { front = -2.5 * u; back = -2.2 * u; }
  else if (warn && s.attack === 'slam_ring') { rise = -3 * u; front = -0.7 * u; back = 0.5 * u; }
  else if (warn) front = -0.5 * u;
  put(pose, 0, 0, rise, back, 1, 1);
  put(pose, 1, 0, rise, sway, 1, squash);
  put(pose, 2, 0, 0, -sway, 1, 1);
  put(pose, 3, 0, 0, front, 1, 1);
}

/**
 * What a rig is posed from, read off the sim's boss (world.bosses[k]). `u` uses the sim's own
 * warning time, so the Maw's jaw is fully open on the tick its slam lands.
 * @param {object} world
 * @param {object} b      the boss's state (world.bosses[k])
 * @param {number} phase  0..1, the enemy's own animation offset
 * @param {object} out    { t, state, attack, u, stuck, weak }, written in place
 */
export function rigInput(world, b, phase, out) {
  out.t = world.tick / TPS + phase * 10;
  out.state = b.state;
  out.attack = b.attack ? b.attack.type : '';
  out.u = b.state === BOSS_STATE.WARN && b.attack ? 1 - b.timer / warnTime(world, b.attack) : 0;
  out.stuck = world.tick < b.stuckUntil ? 1 : 0;   // the Old Grey stuck in the mud
  out.weak = bossWeak(world, b) ? 1 : 0;           // a weak window (the Salt Widow kneels)
  return out;
}
