// Rumble by kind (0.8.2, proposal idea 9; DECISIONS-I1 8): the controller shakes briefly for a
// few things on the map, most of all ones that happen out of sight (a Reliquary dropping, the
// Ferryman tying up), and (0.9.0, the veteran round: V1 "rumble isn't used for combat") for the
// fight itself: a hit taken (scaled by its damage), a boss's or champion's attack landing, an elite
// or boss falling, a level-up, a Form taken (a capstone harder), and a slow pulse while your health
// is low. The controller only, never the screen (Kevin, 0.7.1). On by default at half strength;
// Settings has the switch and the strength (save/schema.js controls.rumble,
// controls.rumbleStrength). The kinds and their shakes are data (data/sfx.js RUMBLE). Moved here
// from app/rumble.js in 0.9.0 (that file re-exports it); it lives with the view, the other reader of
// the sim's events (ARCHITECTURE §4: audio/ reads only data).
//
// Through the Gamepad API's vibrationActuator ('dual-rumble'), which Chromium and Electron have
// for XInput pads; a pad without one (or the keyboard) does nothing.

import { EV, PICK, HITSTOP } from '../sim/events.js';
import { TASK } from '../sim/constants.js';

/** A hit's share of your health that shakes at full (a quarter of it, or more, is the whole shake). */
export const HURT_FULL_SHARE = 0.25;
/** The least a hit taken shakes (a scratch is still felt). */
export const HURT_MIN_SCALE = 0.3;
/** Low health: below this share of your health the pad pulses, every PULSE_MS. */
export const LOW_HEALTH = 0.3;
export const PULSE_MS = 1100;

/** How hard a hit of `damage` shakes, 0.3 to 1, against your health `maxHp`. Pure. */
export function hurtScale(damage, maxHp) {
  const s = (damage > 0 ? damage : 0) / ((maxHp > 0 ? maxHp : 100) * HURT_FULL_SHARE);
  return s < HURT_MIN_SCALE ? HURT_MIN_SCALE : s > 1 ? 1 : s;
}

/**
 * Which rumble an event asks for (a RUMBLE key), or null. Pure. The fight's (0.9.0) come from the
 * sim's hit-stop requests (W3: EV.HIT_STOP, real hits only, never a leech's drain or a missed
 * slam), a level-up that offered cards (not a dry one: `gifted` is the set of levels a LEVEL_GIFT
 * paid this frame), and a Form taken (EV.ASCEND; b = 1 a capstone).
 */
export function rumbleFor(events, i, gifted = null) {
  switch (events.type[i]) {
    case EV.HIT_STOP: {
      const k = events.a[i];
      if (k === HITSTOP.HURT) return 'hurt';
      if (k === HITSTOP.BOSS_HIT) return 'bossHit';
      if (k === HITSTOP.ELITE_KILL) return 'eliteKill';
      if (k === HITSTOP.BOSS_KILL) return 'bossKill';
      return null;
    }
    case EV.LEVEL_UP: return gifted && gifted.has(events.a[i] | 0) ? null : 'levelUp';
    case EV.ASCEND: return events.b[i] === 1 ? 'capstone' : 'form';
    case EV.DROP:
      if (events.a[i] === PICK.RELIQUARY) return 'reliquary';
      if (events.a[i] === PICK.VAULT) return 'vault';
      return null;
    case EV.FERRY: return events.a[i] === 3 ? 'ferry' : null;
    case EV.TASK:
      if (events.b[i] !== 2) return null;
      return events.a[i] === TASK.BELL ? 'bell' : 'lamp';
    case EV.NIGHT: return events.a[i] === 1 ? 'night' : null;
    // C3 (ruling 14 E): a Legendary taken, a capstone's deed done, a sea chest, an elite yanked to
    // the Harpooner, a tide the Tide Priest called.
    case EV.LEGENDARY: return 'legendary';
    case EV.DEED: return events.d[i] === 1 ? 'deedDone' : null;
    case EV.DIVE: return events.a[i] === 1 ? 'seaChest' : null;
    case EV.HAUL: return events.a[i] === 1 ? 'haul' : null;
    case EV.TIDE: return events.a[i] === 1 && events.b[i] === 1 ? 'tideCall' : null;
    default: return null;
  }
}

/**
 * A shake's motors and length at a strength (0 to 1, Settings' slider): { duration, strongMagnitude,
 * weakMagnitude } in the shape playEffect takes, written into `out`. Strength 0.5 is the data's
 * own values; 1 doubles them (held to 1); 0 is still.
 */
export function rumbleEffect(def, strength, out = {}, scale = 1) {
  const k = Math.max(0, Math.min(1, strength)) * 2 * scale;
  out.startDelay = 0;
  out.duration = def.ms;
  out.strongMagnitude = Math.min(1, def.strong * k);
  out.weakMagnitude = Math.min(1, def.weak * k);
  return out;
}

/**
 * @param {object} o
 * @param {object} o.table RUMBLE (data/sfx.js)
 * @param {()=>object} o.settings the live controls settings ({ rumble, rumbleStrength })
 * @param {()=>ArrayLike<any>} [o.getGamepads]
 * @param {()=>number|null} o.activePad the index of the pad in use (input.activePad), null for none
 * @param {()=>string} o.device what the player is using now (input.device: 'gamepad' to rumble)
 * @param {()=>number} [o.now]
 */
export function createRumble({ table, settings, getGamepads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []), activePad, device, now = () => performance.now() }) {
  const fx = {};
  let busyUntil = -Infinity, playingW = 0, pulseAt = -Infinity;
  const gifted = new Set();
  function pad() {
    if (device() !== 'gamepad') return null;
    const idx = activePad();
    if (idx === null || idx === undefined) return null;
    const list = getGamepads() || [];
    for (let i = 0; i < list.length; i++) { const gp = list[i]; if (gp && (gp.index ?? i) === idx) return gp; }
    return null;
  }
  const api = {
    /**
     * Shake for a kind (a RUMBLE key). One shake at a time: a stronger one cuts in, a weaker one
     * while another runs is dropped (three drops on one tick are one shake, not three). Returns
     * whether it shook.
     */
    play(kind, { force = false, scale = 1 } = {}) {
      const s = settings();
      const def = table[kind];
      if (!def || (!force && !s?.rumble)) return false;
      const t = now();
      const w = (def.strong + def.weak) * scale;
      if (t < busyUntil && playingW >= w) return false;
      const gp = pad();
      const act = gp?.vibrationActuator;
      if (!act || typeof act.playEffect !== 'function') return false;
      rumbleEffect(def, s?.rumbleStrength ?? 0.5, fx, scale);
      if (!(fx.strongMagnitude > 0 || fx.weakMagnitude > 0)) return false;
      try { const p = act.playEffect('dual-rumble', fx); p?.catch?.(() => {}); } catch { return false; }
      busyUntil = t + def.ms; playingW = w;
      return true;
    },
    /**
     * Read a frame's events and shake for the one that asks the most (the run scene calls it). With
     * the world: a hit taken shakes by its damage against your health, and while your health is low
     * the pad pulses slowly (stronger the lower it is), whenever nothing else is shaking and the
     * run isn't stopped (opts.stopped).
     */
    events(ev, world = null, { stopped = false } = {}) {
      gifted.clear();
      if (EV.LEVEL_GIFT !== undefined) for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.LEVEL_GIFT) gifted.add(ev.c[i] | 0);
      const maxHp = world?.stats?.maxHp ?? 100;
      let best = null, bestW = 0, bestScale = 1;
      for (let i = 0; i < ev.count; i++) {
        const k = rumbleFor(ev, i, gifted);
        if (!k || !table[k]) continue;
        // A hit taken shakes by its damage (EV.HIT_STOP b); a boss's or champion's never less than 0.6.
        let sc = k === 'hurt' || k === 'bossHit' ? hurtScale(ev.b[i], maxHp) : 1;
        if (k === 'bossHit' && sc < 0.6) sc = 0.6;
        const w = (table[k].strong + table[k].weak) * sc;
        if (w > bestW) { best = k; bestW = w; bestScale = sc; }
      }
      if (best) return api.play(best, { scale: bestScale });
      // Low health: a slow pulse, like a heartbeat. Never while the run is stopped (`stopped`: the
      // pause menu, a level-up or any choice waiting, the loop paused; the sweep, S3b F14).
      const p = world?.player;
      if (p && !stopped && !world.over && table.lowHealth && maxHp > 0 && p.hp > 0 && p.hp / maxHp < LOW_HEALTH) {
        const t = now();
        if (t - pulseAt >= PULSE_MS) {
          pulseAt = t;
          return api.play('lowHealth', { scale: 0.6 + 0.4 * (1 - p.hp / maxHp / LOW_HEALTH) });
        }
      }
      return false;
    },
  };
  return api;
}
