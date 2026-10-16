// The run scene's decisions that don't need a screen (pure over the sim's state; tested):
// which events hold the sim (hit-stop) and which make a sound, what the menus show for each
// halt, the pause menu's build summary, the run-end summary, and the event log that goes into
// bug reports. The scene itself (scenes/run.js) wires these to the renderer, audio, and menus.

import { EV, EVENT_NAMES, PICK, END, TELE } from '../sim/events.js';
import { openSocketsFor, CHEST_BOSS, CHEST_SECRET } from '../sim/chests.js';
import { characterTuning } from '../sim/dev.js';
import { cardInfo } from '../ui/describe.js';
import { computeWeaponStats } from '../sim/stats.js';
import { openAscensions, canAscend } from '../sim/ascend.js';
import { formatClock, formatCount } from '../render/hudtext.js';
import { TASK } from '../sim/constants.js';
import { FERRY_KINDS } from '../sim/relics.js';
import { RELIC_TIERS } from '../data/relics.js';

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
    case EV.MUSTER: return 'swarm';
    case EV.SECRET: return null; // the cache's reel sounds when it lands
    case EV.ASCEND: return 'evolve';
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
    // Phase 7: a task started and done, Lantern Night, the Ferryman, Sea Glass.
    case EV.TASK: return events.b[i] === 2 ? (events.a[i] === TASK.BELL ? 'bell_ring' : 'level_up') : 'ui_confirm';
    case EV.NIGHT: return events.a[i] === 1 ? 'evolve' : null;
    case EV.FERRY: return events.a[i] === 2 ? 'pickup' : null;
    case EV.GLASS: return events.a[i] > 0 ? 'gem' : null;
    default: return null;
  }
}

/** A short line for the middle of the screen, for the events that deserve one (or null). */
export function noticeFor(events, i, world) {
  switch (events.type[i]) {
    case EV.BOSS_SPAWN: return world.enemyDefs[events.a[i]]?.name ?? 'Boss';
    case EV.ELITE_SPAWN: return `Elite: ${world.enemyDefs[events.a[i]]?.name ?? 'enemy'}`;
    case EV.OVERTIME: return `Overtime: ${events.a[i]} min`;
    case EV.MUSTER: return world.map.timeline.events[events.c[i]]?.name ?? null;
    case EV.ASCEND: { const s = world.slots[events.a[i]]; return s?.def ? `Ascended: ${s.def.name}` : null; }
    case EV.PICKUP: return events.a[i] === PICK.EMBER ? 'Ember found' : null;
    case EV.SECRET: { const s = world.map.secrets?.[events.a[i]]; return s ? `Secret found: ${s.name}` : null; }
    case EV.EVOLVE: { const s = world.slots[events.a[i]]; return s?.def ? `Evolved: ${s.def.name}` : null; }
    case EV.TASK: return taskNotice(events, i, world);
    case EV.NIGHT: return events.a[i] === 1 ? 'Lantern Night' : 'The night ends';
    case EV.FERRY: return events.a[i] === 1 && events.b[i] > 0 ? 'Ferryman: new stock' : null;
    default: return null;
  }
}

/** A task's notice: what it asks when it starts, what it gave when it's done. */
function taskNotice(events, i, world) {
  const t = world.tasks[events.c[i]];
  if (!t) return null;
  const lamp = t.kind === TASK.LAMP;
  if (events.b[i] === 1) return lamp ? 'Wayside Lamp: stand by it to light it' : `Fog Bell: ${t.need} kills inside its ring`;
  const glass = events.d[i] > 0 ? `, +${events.d[i]} Sea Glass` : '';
  if (lamp) {
    const lit = world.tasks.filter((x) => x.kind === TASK.LAMP && x.state === 2).length, all = world.tasks.filter((x) => x.kind === TASK.LAMP).length;
    return `Lamp lit ${lit}/${all}: Kindled${glass}`;
  }
  return `Fog Bell rung${glass}`;
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
      return { kind: 'chest', boss: halt.chestKind === CHEST_BOSS, secret: halt.chestKind === CHEST_SECRET, items: halt.items.map((it) => ({ ...cardInfo(it, data, ctx), kind: it.kind })) };
    case 'rune': {
      const rune = world.runeDefs.find((r) => r.id === halt.rune);
      const options = openSocketsFor(world, rune).map((s) => {
        const slot = world.slots[s];
        return { slot: s, name: slot.def.name, icon: slot.def.icon, runes: slot.runes.filter(Boolean).map((r) => r.name) };
      });
      return { kind: 'rune', rune: cardInfo({ kind: 'rune', id: rune.id }, data, ctx), options };
    }
    case 'ascend': {
      // The weapons that can still take a Form, each with its line's three in the order of their
      // kinds: taken, open, or kept off by a rune (and which).
      const weapons = [];
      for (let s = 0; s < world.build.weaponSlots; s++) {
        const open = openAscensions(world, s);
        if (!open.length) continue;
        const slot = world.slots[s];
        const line = world.ascensionLines.get(slot.def.id);
        const order = ['delivery', 'flight', 'payoff'];
        const forms = [...line.options].sort((a, b) => order.indexOf(a.axis) - order.indexOf(b.axis)).map((o) => {
          const taken = slot.ascensions.includes(o);
          const why = taken || open.includes(o) ? null : `Not with ${runeNames(slot)}`;
          return { id: o.id, name: o.name, desc: o.desc, axis: o.axis, taken, why };
        });
        weapons.push({ slot: s, name: slot.def.name, icon: slot.def.icon, level: slot.level, taken: slot.ascensions.map((a) => a.name), forms });
      }
      return { kind: 'ascend', embers: world.build.embers, weapons };
    }
    case 'overtime': {
      const last = world.bosses.filter((b) => b.final).at(-1);
      return { kind: 'overtime', bossName: last ? world.enemyDefs[last.type].name : 'Boss' };
    }
    case 'relic': {
      // A Reliquary's or the vault's three (drawn when the halt came up).
      const relics = (halt.offer || []).map((id) => relicInfo(world, id));
      return { kind: 'relic', vault: halt.source === 'vault', relics };
    }
    case 'ferry': {
      const F = world.ferry;
      const offers = (F?.offers || []).map((o, index) => {
        const info = o.kind === FERRY_KINDS.relic ? relicInfo(world, o.id)
          : o.kind === FERRY_KINDS.food ? { name: 'Food', desc: `Heals ${world.tuning.ferry.foodHeal} HP.`, icon: 'pk_heal', tier: null }
            : o.kind === FERRY_KINDS.reroll ? { name: 'Reroll', desc: '+1 Reroll.', icon: 'item_bone', tier: null }
              : { name: 'Ember', desc: 'An Ember: a new Form for a weapon.', icon: 'pk_ember', tier: null };
        const carried = o.kind === FERRY_KINDS.relic && world.build.relics.some((r) => r.id === o.id);
        const why = o.sold ? 'Sold' : carried ? 'Carried' : world.glass < o.price ? `Need ${o.price - world.glass} more Sea Glass` : null;
        return { index, ...info, price: o.price, sold: o.sold, why };
      });
      return { kind: 'ferry', glass: world.glass, offers };
    }
    default:
      throw new Error(`haltView: unknown halt "${halt.kind}"`);
  }
}

/** A relic as a card shows it: its name, what it does, its icon, and its tier by name. */
function relicInfo(world, id) {
  const r = world.relicDefs.find((x) => x.id === id);
  return { id, name: r?.name ?? id, desc: r?.desc ?? '', icon: r?.icon ?? '', tier: r?.tier ?? 1, tierName: RELIC_TIERS[r?.tier ?? 1] };
}

/** A slot's runes by name, for a refusal ("Orbiting", "Orbiting and Backfire"). */
function runeNames(slot) {
  const n = slot.runes.filter(Boolean).map((r) => r.name);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n[0] ?? 'its runes';
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
        ascensions: slot.ascensions.map((a) => a.name),
      });
    }
  }
  return {
    time: formatClock(world.tick / 60),
    embers: world.build.embers,
    // Only with nothing else waiting: an Ember can't be spent over a level-up or its own screen.
    canAscend: world.build.embers > 0 && !world.halts.length && canAscend(world),
    weapons,
    passives: world.build.passives.map((p) => ({ name: p.def.name, icon: p.def.icon, level: p.level, max: p.level >= p.def.maxLevel, desc: p.def.desc })),
    relics: world.build.relics.map((r) => ({ name: r.name, icon: r.icon, desc: r.desc })),
    materials: materialsFound(world),
  };
}

/** The materials found so far this run, in the data's order: [{ id, name, icon, count }] (only those with 1 or more). */
export function materialsFound(world) {
  const out = [], raw = world.result.materialsRaw;
  for (let i = 0; i < raw.length; i++) {
    const c = Math.floor(raw[i] + 1e-9);
    if (c > 0) { const m = world.materialDefs[i]; out.push({ id: m.id, name: m.name, icon: m.icon, count: c }); }
  }
  return out;
}

/** A share as a signed percent from 1 ("+12%", "-6%", "0%"). */
const pctFrom1 = (v) => { const p = Math.round((v - 1) * 100); return p === 0 ? '0%' : `${p > 0 ? '+' : ''}${p}%`; };
const num = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toString();

/**
 * A weapon's damage per second since it was taken (its first second counts as a whole one): one
 * decimal under 10, a whole number from there (§20 call 78).
 */
export function dpsText(total, seconds) {
  const dps = total / Math.max(1, seconds);
  return dps >= 10 ? formatCount(Math.round(dps)) : num(dps, 1);
}
const GLOBAL_PROBE = Object.freeze({ id: '__stats', tags: [], maxLevel: 1, levels: [null], base: { damage: 1, cooldown: 1, amount: 0, area: 1, speed: 1, duration: 1, pierce: 0, knockback: 1, crit: 0, critMult: 1 } });

/**
 * The stats screen's content (pause, Stats): your character's numbers as the run has them now,
 * the bonuses that reach every weapon, each weapon's own numbers with its DPS and Total Damage
 * (the character's own weapon too), the materials found, and the passives and relics you carry.
 * Plain data: [[label, value]] lists, worded as the cards word stats.
 */
export function statsView(world) {
  const st = world.stats, p = world.player;
  const character = [
    ['HP', `${Math.ceil(Math.max(0, p.hp))}/${Math.round(st.maxHp)}`],
    ['HP Regen', `${num(st.regen, 1)}/s`],
    ['Armor', num(st.armor + (p.bonusArmor || 0))],
    ['Move Speed', pctFrom1(st.moveSpeed)],
    ['Pickup Range', pctFrom1(st.magnet)],
    ['Luck', pctFrom1(st.luck)],
    ['XP', pctFrom1(st.growth)],
    ['Materials', pctFrom1(st.greed)],
    ['Dash Cooldown', pctFrom1(st.dashCooldown)],
    ['Revivals', String(p.revivals ?? 0)],
    ['Rerolls', String(world.charges.reroll)],
    ['Banishes', String(world.charges.banish)],
    ['Skips', String(world.charges.skip)],
  ];
  // What reaches every weapon (a modifier with no tag): read off a plain probe weapon.
  const g = computeWeaponStats(world.tuning, GLOBAL_PROBE, 1, world.mods);
  const allWeapons = [
    ['Damage', pctFrom1(g.damage)], ['Area', pctFrom1(g.area)], ['Cooldown', pctFrom1(g.cooldown)],
    ['Projectiles', `+${num(g.amount)}`], ['Duration', pctFrom1(g.duration)], ['Projectile Speed', pctFrom1(g.speed)],
    ['Crit Chance', `${Math.round(g.crit * 100)}%`],
  ];
  const weapons = [];
  for (let s = 0; s < world.slots.length; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.def) continue;
    const w = slot.stats;
    weapons.push({
      name: slot.def.name, icon: slot.def.icon, level: slot.level, max: slot.level >= slot.def.maxLevel, innate: !!slot.def.innate,
      runes: slot.runes.filter(Boolean).map((r) => r.name),
      ascensions: (slot.ascensions || []).map((a) => a.name),
      // DPS and Total Damage first, side by side (the two the run has made), then its numbers.
      lines: [
        ['DPS', dpsText(world.result.damageBySlot[s] || 0, (world.tick - (slot.since ?? 0)) / 60)],
        ['Total Damage', formatCount(Math.round(world.result.damageBySlot[s] || 0))],
        ['Damage', num(w.damage, 1)], ['Cooldown', `${num(w.cooldown, 2)}s`], ['Projectiles', num(w.amount)],
        ['Area', `${Math.round(w.area * 100)}%`], ['Pierce', w.pierce < 0 ? 'All' : num(w.pierce)],
        ['Duration', `${num(w.duration, 2)}s`], ['Crit Chance', `${Math.round(w.crit * 100)}%`],
      ],
    });
  }
  const b = pauseBuild(world);
  const items = [
    ...b.passives.map((x) => ({ ...x, kind: 'passive' })),
    ...b.relics.map((x) => ({ ...x, kind: 'relic' })),
  ];
  return { character, allWeapons, weapons, items, materials: b.materials };
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
  EV.RUN_END, EV.OVERTIME, EV.SHIELD_HIT, EV.SECRET, EV.MUSTER, EV.ASCEND]);

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
