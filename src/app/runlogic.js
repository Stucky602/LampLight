// The run scene's decisions that don't need a screen (pure over the sim's state; tested):
// which events hold the sim (hit-stop) and which make a sound, what the menus show for each
// halt, the pause menu's build summary, the run-end summary, and the event log that goes into
// bug reports. The scene itself (scenes/run.js) wires these to the renderer, audio, and menus.

import { EV, EVENT_NAMES, PICK, END, TELE } from '../sim/events.js';
import { openSocketsFor } from '../sim/chests.js';
import { characterTuning } from '../sim/dev.js';
import { cardInfo } from '../ui/describe.js';
import { formatClock, formatCount } from '../render/hudtext.js';

/** The longest hit-stop asked for by events [from, to) of the buffer (ms; 0 for none). */
export function hitStopFor(events, from, to, hitStop) {
  let ms = 0;
  for (let i = from; i < to; i++) {
    const t = events.type[i];
    let m = 0;
    if (t === EV.PLAYER_HURT) m = hitStop.playerHurt;
    else if (t === EV.KILL) m = (events.b[i] & 2) !== 0 ? hitStop.bossKill : (events.b[i] & 1) !== 0 ? hitStop.eliteKill : 0;
    else if (t === EV.EXPLODE && events.b[i] < 0) m = hitStop.bossSlam;
    if (m > ms) ms = m;
  }
  return ms;
}


/**
 * The sound for event i, or null. `slots` is world.slots (weapon sounds come from the weapon's
 * data: sfx.fire and sfx.hit).
 */
export function soundFor(events, i, slots) {
  switch (events.type[i]) {
    case EV.HIT: { const s = slots[events.d[i]]; return s?.def?.sfx?.hit || 'hit_soft'; }
    case EV.FIRE: { const s = slots[events.a[i]]; return s?.def?.sfx?.fire || null; }
    case EV.KILL: return (events.b[i] & 3) !== 0 ? 'kill_big' : 'kill';
    case EV.PLAYER_HURT: return 'player_hurt';
    case EV.GEM: return 'gem';
    case EV.LEVEL_UP: return 'level_up';
    case EV.CHEST: return 'chest_open';
    case EV.BOSS_SPAWN: return 'boss_spawn';
    case EV.ELITE_SPAWN: return 'warn';
    // Boss-sized warnings (a slam ring, a shot fan, a summoning circle) always sound; the lines
    // of ordinary chargers and gunners share one rate-limited beep (sfx gapMs).
    case EV.TELEGRAPH: return events.a[i] === TELE.LINE || events.a[i] === TELE.CIRCLE ? 'warn' : 'warn_big';
    case EV.ENEMY_SHOT: return 'enemy_shot';
    case EV.DASH: return 'dash';
    case EV.PICKUP: return events.a[i] === PICK.HEAL ? 'heal' : 'pickup';
    case EV.EXPLODE: return events.b[i] < 0 ? 'boss_slam' : 'explode_small';
    case EV.HEAL: return null; // the pickup already chimed
    case EV.REVIVE: return 'revive';
    case EV.EVOLVE: case EV.RELIC: case EV.RUNE: return 'evolve';
    case EV.SWARM: return 'swarm';
    case EV.BOSS_ATTACK: return null; // its warning already sounded; its shots sound as they fire
    default: return null;
  }
}

/** A short line for the middle of the screen, for the events that deserve one (or null). */
export function noticeFor(events, i, world) {
  switch (events.type[i]) {
    case EV.BOSS_SPAWN: return world.enemyDefs[events.a[i]]?.name ?? 'Boss';
    case EV.ELITE_SPAWN: return `Elite: ${world.enemyDefs[events.a[i]]?.name ?? 'enemy'}`;
    case EV.OVERTIME: return `Overtime: ${events.a[i]} min`;
    case EV.EVOLVE: { const s = world.slots[events.a[i]]; return s?.def ? `Evolved: ${s.def.name}` : null; }
    default: return null;
  }
}

/**
 * What the tuning panel shows and copies: the run's tuning plus its character's own numbers
 * under "character" (so "character.harpooner.daze" sits beside "player.speed").
 */
export function panelTuning(world, data) {
  return {
    defaults: { ...data.tuning, character: characterTuning(world, false) },
    current: { ...world.tuning, character: characterTuning(world) },
  };
}

/** What the draft cards need to know about the build: tag counts and owned ids. */
export function buildContext(world) {
  const tags = {}, weapons = [], passives = [];
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.def) continue;
    weapons.push(slot.def.id);
    for (const t of slot.def.tags || []) tags[t] = (tags[t] || 0) + 1;
  }
  for (const ps of world.build.passives) {
    passives.push(ps.def.id);
    for (const t of ps.def.tags || []) tags[t] = (tags[t] || 0) + 1;
  }
  return { tags, weapons, passives };
}

/** Plain data for the screen that goes with a halt. */
export function haltView(world, halt, data) {
  const ctx = buildContext(world);
  switch (halt.kind) {
    case 'draft':
      return {
        kind: 'draft', level: world.player.level,
        cards: (halt.offer || []).map((c) => ({ ...cardInfo(c, data, ctx), kind: c.kind })),
        charges: { ...world.charges },
      };
    case 'chest':
      return { kind: 'chest', boss: halt.chestKind === 2, items: halt.items.map((it) => ({ ...cardInfo(it, data, ctx), kind: it.kind })) };
    case 'rune': {
      const rune = world.runeDefs.find((r) => r.id === halt.rune);
      const options = openSocketsFor(world, rune).map((s) => {
        const slot = world.slots[s];
        return { slot: s, name: slot.def.name, icon: slot.def.icon, runes: slot.runes.filter(Boolean).map((r) => r.name) };
      });
      return { kind: 'rune', rune: cardInfo({ kind: 'rune', id: rune.id }, data, ctx), options };
    }
    case 'overtime': {
      const last = world.bosses.filter((b) => b.final).at(-1);
      return { kind: 'overtime', bossName: last ? world.enemyDefs[last.type].name : 'Boss' };
    }
    default:
      throw new Error(`haltView: unknown halt "${halt.kind}"`);
  }
}

/** The pause menu's summary of the build. */
export function pauseBuild(world) {
  const weapons = [];
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    if (slot && slot.def) {
      weapons.push({
        name: slot.def.name, icon: slot.def.icon, level: slot.level, max: slot.level >= slot.def.maxLevel, desc: slot.def.desc,
        runes: slot.runes.filter(Boolean).map((r) => r.name),
      });
    }
  }
  return {
    time: formatClock(world.tick / 60),
    weapons,
    passives: world.build.passives.map((p) => ({ name: p.def.name, icon: p.def.icon, level: p.level, max: p.level >= p.def.maxLevel, desc: p.def.desc })),
    relics: world.build.relics.map((r) => ({ name: r.name, icon: r.icon, desc: r.desc })),
  };
}

const END_TITLES = { died: 'Defeated', left: 'Run ended', cleared: 'Map cleared' };

/** The run-end screen's content from a RunResult. */
export function runSummary(result, data) {
  const lines = [
    ['Time', formatClock(result.timeSurvived)],
    ['Level', String(result.level)],
    ['Kills', formatCount(result.totalKills)],
    ['Bosses', result.bossesKilled.length ? result.bossesKilled.map((b) => data.enemies.find((e) => e.id === b.id)?.name ?? b.id).join(', ') : 'None'],
  ];
  if (result.overtimeMinutes > 0) lines.push(['Overtime', `${result.overtimeMinutes} min`]);
  if (result.evolutions.length) lines.push(['Evolved', result.evolutions.map((id) => data.weapons.find((w) => w.id === id)?.name ?? id).join(', ')]);
  const materials = Object.entries(result.materials).map(([id, count]) => {
    const m = data.materials.find((x) => x.id === id);
    return { icon: m?.icon ?? 'mat_coin', name: m?.name ?? id, count };
  });
  return { title: END_TITLES[result.end] || 'Run over', lines, materials };
}

/**
 * Why a settings change can't happen here (a sentence), or null. Switching to or from the
 * borderless window reopens the window (and reloads the page), so it's only offered where a
 * reload loses nothing: the title and the harbor (§13.2, DECISIONS Phase 1).
 */
export function settingRefusal(key, value, current, atTitleOrHarbor) {
  if (key === 'display.mode' && (value === 'borderless' || current === 'borderless') && value !== current && !atTitleOrHarbor) {
    return 'Borderless can only be changed in the harbor or on the main menu (the window reopens).';
  }
  return null;
}

/** END code to the RunResult name (for the scene). */
export const END_NAME = { [END.DIED]: 'died', [END.LEFT]: 'left', [END.CLEARED]: 'cleared' };

// Event types worth keeping in a report (the frequent ones would push everything else out).
const LOGGED = new Set([EV.KILL, EV.PLAYER_HURT, EV.LEVEL_UP, EV.CHEST, EV.BOSS_SPAWN, EV.TELEGRAPH, EV.DASH, EV.PICKUP,
  EV.EXPLODE, EV.SWARM, EV.BOSS_ATTACK, EV.HEAL, EV.REVIVE, EV.ELITE_SPAWN, EV.EVOLVE, EV.RELIC, EV.RUNE, EV.WAVE,
  EV.RUN_END, EV.OVERTIME, EV.SHIELD_HIT]);

/** The last `cap` events that matter, with the tick they were read on (typed arrays; no garbage). */
export function createEventLog(cap = 300) {
  const tick = new Int32Array(cap), type = new Uint8Array(cap);
  const x = new Float32Array(cap), y = new Float32Array(cap), a = new Float32Array(cap), b = new Float32Array(cap);
  let next = 0, count = 0;
  return {
    /** Log what matters from events [from, to) of the buffer, read at sim tick `t`. */
    add(events, from, to, t) {
      for (let i = from; i < to; i++) {
        const ty = events.type[i];
        if (!LOGGED.has(ty)) continue;
        tick[next] = t; type[next] = ty; x[next] = events.x[i]; y[next] = events.y[i]; a[next] = events.a[i]; b[next] = events.b[i];
        next = (next + 1) % cap;
        if (count < cap) count++;
      }
    },
    /** Oldest first, as plain objects (for the report). */
    list() {
      const out = [];
      for (let k = 0; k < count; k++) {
        const i = (next - count + k + cap) % cap;
        out.push({ tick: tick[i], type: EVENT_NAMES[type[i]], x: Math.round(x[i]), y: Math.round(y[i]), a: a[i], b: b[i] });
      }
      return out;
    },
    get count() { return count; },
    clear() { next = 0; count = 0; },
  };
}
