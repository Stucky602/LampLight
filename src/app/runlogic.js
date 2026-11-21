// The run scene's decisions that don't need a screen (pure over the sim's state; tested):
// which events hold the sim (hit-stop) and which make a sound, what the menus show for each
// halt, the pause menu's build summary, the run-end summary, and the event log that goes into
// bug reports. The scene itself (scenes/run.js) wires these to the renderer, audio, and menus.

import { EV, EVENT_NAMES, PICK, END, TELE, SIGHT, SIGHT_NAMES, TWIST, FIND_GIFT } from '../sim/events.js';
import { WATER } from '../sim/marsh.js';
import { CHEST_BOSS, CHEST_SECRET } from '../sim/chests.js';
import * as chests from '../sim/chests.js';
import { characterTuning } from '../sim/dev.js';
import { cardInfo } from '../ui/describe.js';
import { computeWeaponStats } from '../sim/stats.js';
import { canAscend, axisState, optionChoices, isDrafted } from '../sim/ascend.js';
import { deedState } from '../sim/deeds.js';
import { trackState } from '../sim/trades.js';
import { dashCooldown } from '../sim/dash.js';
import { formatClock, formatCount } from '../render/hudtext.js';
import { TASK, PK, TASK_STATE } from '../sim/constants.js';
import * as tasks from '../sim/tasks.js';
import * as signsMod from '../sim/signs.js';
import { weaponLevelText, passiveLevelText, formLine, deedLine, upgradeText, AXIS_LABEL } from '../ui/describe.js';
import { haulMul } from '../sim/run-result.js';
import { FERRY_KINDS } from '../sim/relics.js';
import { NO_CHEST } from '../sim/enemies.js';
import { rarityOfTier } from '../data/rarity.js';
import { fireSound, dashSound } from '../audio/cues.js';
import * as draftMod from '../sim/draft.js';
import * as ascendMod from '../sim/ascend.js';
import { weaponLook } from '../data/ascensions.js';
import { unlockText } from '../meta/actions.js';
import * as enemyData from '../data/enemies.js';
import { fieldGuideEntry } from '../data/glossary.js';

/**
 * The longest hit-stop asked for by events [from, to) of the buffer (ms; 0 for none). 0.9.0 (W3's
 * contract): the sim asks for one only on a real hit, with EV.HIT_STOP (a = HITSTOP's kind); a
 * build without it falls back to the hits and kills as before.
 */
export function hitStopFor(events, from, to, hitStop) {
  let ms = 0;
  const own = EV.HIT_STOP !== undefined;
  for (let i = from; i < to; i++) {
    const t = events.type[i];
    let m = 0;
    if (own) {
      if (t === EV.HIT_STOP) {
        const k = events.a[i];
        m = k === 1 ? hitStop.playerHurt : k === 2 ? hitStop.bossSlam : k === 3 ? hitStop.eliteKill : k === 4 ? hitStop.bossKill : 0;
      }
    } else if (t === EV.PLAYER_HURT) m = hitStop.playerHurt;
    else if (t === EV.KILL) m = (events.b[i] & 2) !== 0 ? hitStop.bossKill : (events.b[i] & 1) !== 0 ? hitStop.eliteKill : 0;
    else if (t === EV.EXPLODE && events.b[i] < 0) m = hitStop.bossSlam;
    if (m > ms) ms = m;
  }
  return ms;
}

/**
 * The sound for event i, or null. `slots` is world.slots (weapon sounds come from the weapon's
 * data: sfx.fire and sfx.hit). `view` (optional): the camera's view, { x, y, halfW, halfH } in
 * world px, so a chest that lands out of sight knocks.
 */
export function soundFor(events, i, slots, view = null, dashId = null) {
  switch (events.type[i]) {
    case EV.HIT: { const s = slots[events.d[i]]; return s?.def?.sfx?.hit || 'hit_soft'; }
    case EV.FIRE: { const s = slots[events.a[i]]; return s?.def ? fireSound(s.def) : null; }   // each weapon its own (W6)
    case EV.KILL: return (events.b[i] & 3) !== 0 ? 'kill_big' : 'kill';
    case EV.PLAYER_HURT: return 'player_hurt';
    case EV.GEM: return 'gem';
    case EV.LEVEL_UP: return 'level_up';
    case EV.CHEST: return 'chest_open';
    case EV.BOSS_SPAWN: return 'boss_spawn';
    case EV.ELITE_SPAWN: return 'warn';
    case EV.MUSTER: return 'swarm';
    case EV.SECRET: return null; // the cache's reel sounds when it lands
    case EV.ASCEND: return events.b[i] === 1 ? 'capstone_pick' : 'form_pick';   // C3: a Form's own sound, a capstone's deeper
    // Boss-sized warnings (a slam ring, a shot fan, a summoning circle) always sound; the lines
    // of ordinary chargers and gunners share one rate-limited beep (sfx gapMs).
    case EV.TELEGRAPH: return events.a[i] === TELE.LINE || events.a[i] === TELE.CIRCLE ? 'warn' : 'warn_big';
    case EV.ENEMY_SHOT: return 'enemy_shot';
    case EV.DASH: return dashSound(dashId);   // each Dash slot item its own (C3)
    case EV.PICKUP: return events.a[i] === PICK.HEAL ? 'heal' : 'pickup';
    case EV.EXPLODE: return events.b[i] < 0 ? 'boss_slam' : 'explode_small';
    case EV.HEAL: return null; // the pickup already chimed
    case EV.REVIVE: return 'revive';
    case EV.EVOLVE: case EV.RELIC: case EV.RUNE: return 'evolve';
    case EV.SWARM: return 'swarm';
    case EV.BOSS_ATTACK: return null; // its warning already sounded; its shots sound as they fire
    // The map's things (0.8.2, proposal idea 9): each kind its own sound (data/sfx.js).
    case EV.TASK: {
      const bell = events.a[i] === TASK.BELL, b = events.b[i];
      if (b === 1) return bell ? 'bell_toll' : 'ui_confirm';
      if (b === 2) return bell ? 'bell_ring' : 'lamp_lit';
      if (b === 3) return 'lamp_out';
      if (b === 4) return 'swarm';
      return null;
    }
    case EV.BELL_COUNT: return 'bell_count';
    case EV.NIGHT: return events.a[i] === 1 ? 'night_falls' : events.a[i] === 2 ? 'night_banked' : null;
    case EV.FERRY: return events.a[i] === 2 ? 'pickup' : events.a[i] === 3 ? 'ferry_oar' : null;
    case EV.GLASS: return events.a[i] > 0 ? 'pearl' : null;
    case EV.DROP: {
      const k = events.a[i];
      if (k === PK.RELIQUARY) return 'reliquary_chime';
      if (k === PK.VAULT) return 'vault_rise';
      // A lit lamp watched it land (its ward): a chime, wherever it is.
      if (events.b[i] > 0) return 'ward_chime';
      if (k === PK.CHEST && view && (Math.abs(events.x[i] - view.x) > view.halfW || Math.abs(events.y[i] - view.y) > view.halfH)) return 'chest_knock';
      return null;
    }
    default: return growthSound(events, i);   // the growth core's and the characters' (C3: 81 to 95)
  }
}

/**
 * The growth core's and the characters' sounds (C3; events 81 to 95, work/cw/C1-CONTRACT.md section 9,
 * C2-DESIGN.md section 0). What a pick screen already played (a Legendary, a Form) sounds here too,
 * because "Pick for me" takes them without a screen; the screen's beat plays nothing of its own.
 */
export function growthSound(events, i) {
  const a = events.a[i], b = events.b[i];
  switch (events.type[i]) {
    case EV.DEED: return events.d[i] === 1 ? 'deed_done' : null;
    case EV.AXIS_OPEN: return 'axis_open';
    case EV.LEGENDARY: return 'legendary';
    case EV.UPGRADE: return events.c[i] === 1 ? 'line_taken' : null;   // a number's card: the menu's own confirm
    case EV.PLANT: return 'plant';
    case EV.LOOP: return 'glass_ring';
    case EV.TIDE: return a === 0 ? 'tide_ebb' : b === 1 ? 'tide_call' : null;   // the flood itself: King Tide's fire sound
    case EV.MOMENTUM: return a >= 4 ? 'momentum_full' : a > 0 ? 'momentum_step' : null;
    case EV.SIG_UP: return 'sig_up';
    case EV.LANTERN: return 'lantern_set';
    case EV.DIVE: return a === 1 ? 'sea_chest' : 'crate_up';
    case EV.OIL: return b === 1 ? 'oil_fill' : a === 0 ? 'oil_low' : null;
    case EV.CALL_DEAD: return 'dead_rise';
    case EV.HAUL: return a === 1 ? 'haul_elite' : a === 2 ? 'haul_loot' : a === 3 ? 'ferry_oar' : a === 4 ? 'haul_line' : null;
    case EV.SKILL: return 'skill';
    default: return null;
  }
}

/**
 * The pitch to play event i's sound at (1 = as written): a Fog Bell's count rises as its kills
 * left fall, up to an octave at the last (proposal idea 2: the toll rises with each kill).
 */
export function pitchFor(events, i) {
  // The Punter's Momentum ticks a step higher for each step (a fourth over the four).
  if (events.type[i] === EV.MOMENTUM) return 2 ** (Math.max(0, events.a[i] - 1) / 8);
  if (events.type[i] !== EV.BELL_COUNT) return 1;
  const need = events.c[i] > 0 ? events.c[i] : 1, left = Math.max(0, events.a[i]);
  return 2 ** ((need - left) / need);
}

/**
 * A short line for the middle of the screen, for the events that deserve one (or null; a few give
 * two, in order). `known` (0.8.0): what earlier runs have shown this profile on any map (a Set of
 * sighting names, meta/state.js seenAnywhere); a first sighting of one of those says nothing.
 */
export function noticeFor(events, i, world, known = null, { firstRun = false } = {}) {
  switch (events.type[i]) {
    case EV.BOSS_SPAWN: return world.enemyDefs[events.a[i]]?.name ?? 'Boss';
    case EV.ELITE_SPAWN:
      // An elite with an affix (W3, 0.9.0) is said once, with it, by the AFFIX that follows at once.
      if (EV.AFFIX !== undefined && i + 1 < events.count && events.type[i + 1] === EV.AFFIX && events.b[i + 1] === events.b[i]) return null;
      return `An elite ${world.enemyDefs[events.a[i]]?.name ?? 'enemy'}`;
    case EV.OVERTIME: return `Overtime: minute ${events.a[i]}`;
    // An overtime muster's c is -1 minus its index in map.overtime.repeat (B1's contract).
    // A muster: its name, then what it is and why (RULING-L1, L2, L3: a bare name said nothing).
    case EV.MUSTER: { const n = events.c[i] < 0 ? world.map.overtime?.repeat?.[-1 - events.c[i]]?.name ?? null : world.map.timeline.events[events.c[i]]?.name ?? null; return n ? `${n} and crew. Kill the captain for a chest` : null; }
    // A Form taken says nothing mid-fight (ruling 14 E): its screen said it, and its sound and rumble mark it.
    case EV.ASCEND: return null;
    case EV.PICKUP: return events.a[i] === PICK.EMBER ? 'Ember found' : null;
    case EV.SECRET: { const s = world.map.secrets?.[events.a[i]]; return s ? `Secret found: ${s.name}` : null; }
    case EV.TASK: return taskNotice(events, i, world);
    case EV.NIGHT:
      if (events.a[i] === 2) return nightReadyText(world);
      return events.a[i] === 1 ? `Lantern Night: enemies near you burn for ${Math.round(world.night?.sec ?? world.tuning.tasks.night.sec)}s` : 'Lantern Night is over';
    case EV.GLASS: return glassNotice(events, i, world);
    // Each call brings new stock on the same tick, so the call's line says it all.
    case EV.FERRY: return events.a[i] === 3 ? 'The Ferryman tied up nearby' : null;
    case EV.DROP:
      if (events.a[i] === PK.VAULT) return 'A vault rose ahead: walk over it for a better relic';
      if (events.a[i] === PK.RELIQUARY) return 'A Reliquary dropped nearby';
      return null;
    case EV.RELIC_POOL: return events.a[i] === 1 ? 'Every relic in the pool is found. Research, Harbor Orders, and secrets add more' : null;
    // a 1 the vault, 2 a Reliquary (the Ferryman sold the last relic after it dropped): an Ember instead.
    case EV.VAULT_EMPTY: return events.a[i] === 2 ? 'The Reliquary had no relic left: an Ember' : 'The vault had no relic left: an Ember';
    // The Salt Marsh (0.8.0).
    case EV.FIRST_SIGHT: return sightNotice(world, sightName(world, events.a[i], events.b[i]), known);
    case EV.WATER: return waterNotice(events, i, world);
    case EV.EYE: return events.a[i] === 1 ? `Eye of the storm: no enemies come for ${Math.round(events.b[i])}s` : null;
    case EV.WELL: return events.a[i] === 1 ? 'The Salt Well is open: stay in its circle to give up a relic' : events.a[i] === 3 ? 'To be asked again, stand still in the well\'s circle' : null;
    default:
      // The run's arc and the maps (0.9.0, W4): acts, bells waking, map events, finds, the Long Night.
      if (EV.ACT !== undefined && events.type[i] >= EV.ACT && events.type[i] <= EV.ARM) return arcNotice(events, i, world, firstRun);
      // W3 (0.9.0): an elite's affixes, by name: "An elite Drowned Sailor: Warded, Molten".
      if (EV.AFFIX !== undefined && events.type[i] === EV.AFFIX) {
        const names = affixNames(world, events.a[i]);
        return `An elite ${world.enemyDefs[events.c[i]]?.name ?? 'enemy'}${names.length ? `: ${names.join(', ')}` : ''}`;
      }
      // 0.7.3's run events (the sim adds them; this build may not have them yet).
      if (EV.MUSTER_SOON !== undefined && events.type[i] === EV.MUSTER_SOON) return `A muster in ${events.a[i] > 0 ? Math.round(events.a[i]) : MUSTER_WARN_SEC}s`;
      return null;
  }
}

/** "Bilge Rats", "Leeches", "Salted Dead": an enemy kind in the plural. */
const plural = (n) => (/Dead$/.test(n) ? n : /(ch|sh|s|x)$/.test(n) ? `${n}es` : `${n}s`);

/**
 * "Lantern Night is ready. It starts when 15 enemies are near you", with this run's own rule (round 4: the
 * Lamplighter's starts with 10 near her, and with Night Watch when she stands in a lit lamp's light).
 */
function nightReadyText(world) {
  const tr = world.trade, nw = world.sk?.night_watch;
  if (tr?.id === 'lamps' && nw) return `Lantern Night is ready. It starts when you stand in a lit lamp's light for ${nw.still}s`;
  const n = tr?.id === 'lamps' ? tr.P.crowd : world.tuning.tasks.night?.crowd ?? 15;
  return `Lantern Night is ready. It starts when ${n} enemies are near you`;
}

/** A map event's notice (round 3, the director's call): its name, what it is, and what to do, from its first event. */
function eventNotice(world, e) {
  const ev = e.events[0] ?? {}, foe = ev.enemy ? plural(world.enemyDefs[world.enemyIndex?.get?.(ev.enemy)]?.name ?? world.data?.enemies?.find?.((x) => x.id === ev.enemy)?.name ?? 'enemies') : 'enemies';
  switch (ev.event) {
    case 'cache': case 'trail': return `${e.name}: a guarded chest is out. Follow the chest arrow`;
    case 'wall': return `${e.name}: a wall of ${foe} sweeps across. Get out of its way`;
    case 'ring': return `${e.name}: a ring of ${foe} closes in. Break out of it`;
    case 'flock': return `${e.name}: flocks of ${foe} fly in`;
    case 'rising': return `${e.name}: ${ev.count} ${foe} come out${world.map.places?.find?.((p) => p.id === ev.place)?.name ? ` at ${world.map.places.find((p) => p.id === ev.place).name}` : ''}. Kill them for ${world.config?.noFood || world.noFood ? 'materials' : 'food and materials'}`;
    case 'muster': return `${e.name} and crew. Kill the captain for a chest`;
    case 'fire': return `${e.name}: a line of fire bursts through the crowd. Stay out of the rings`;
    default: return e.name;
  }
}

/** W4's notices (0.9.0): one short line each, said over the thing where it can be. */
function arcNotice(events, i, world, firstRun = false) {
  const t = events.type[i], a = events.a[i];
  const place = (k) => world.map.places?.[k]?.name ?? null;
  if (t === EV.ACT) {
    if (a <= 1) return null;
    const held = (events.b[i] & TWIST.HELD) !== 0 ? '. One is a slow lamp' : '';   // (round 3: the term, not "held")
    return a === 2 ? `${events.c[i]} new lamps are out${held}` : `${events.c[i]} last lamps are out${held}`;   // (round 4, main: the act's number was only a label)
  }
  if (t === EV.ARM) {
    if (a !== TASK.BELL) return null;   // a crane or cairn ready again: the act's line says it
    // (Round 2, L1 6: in run 1 a district's name means nothing yet; the arrow says where.)
    const pl = firstRun ? null : place(events.d[i]);
    return pl ? `A Fog Bell is ready near ${pl}. Follow the blue arrow` : 'A Fog Bell is ready. Follow the blue arrow';   // (round 3, L1 6: the lamps' arrows are orange)
  }
  if (t === EV.MAP_EVENT) {
    const e = world.map.deck?.[events.b[i]];
    if (!e) return null;
    if (a === 2) return 'Enemies rise to guard the chest';
    if (a !== 1) return null;
    const kind = e.events[0]?.event;
    return eventNotice(world, e);   // (round 3: a bare name said nothing)
  }
  if (t === EV.FIND) {
    const s = world.secrets?.[events.c[i]];
    if (!s) return null;
    const g = s.gift, n = Math.round(events.b[i]);
    if (a === FIND_GIFT.PEARLS) return world.ferry ? `Found: ${s.name}, ${pearlsText(n)}` : `Found: ${s.name}`;
    if (a === FIND_GIFT.EMBER) return `Found: ${s.name}, an Ember`;
    if (a === FIND_GIFT.MATERIALS) return `Found: ${s.name}, +${n} ${world.materialDefs.find((m) => m.id === g?.material)?.name ?? ''}`.trim();
    if (a === FIND_GIFT.HEAL) return `Found: ${s.name}, food`;
    return `Found: ${s.name}`;
  }
  if (t === EV.FINALE) {
    if (a === 1) return 'The Long Night: the bosses come back together. Kill them all and dawn breaks';
    if (a === 2) return null;
    if (a === 3) return 'Dawn: the fog lifts';
    return null;
  }
  return null;
}

/** An elite's affixes by name (W3: data/enemies.js AFFIXES, the bits on EV.AFFIX's a). */
function affixNames(world, bits) {
  const list = enemyData.ELITE_AFFIXES || [];
  return list.filter((a) => (bits & a.bit) !== 0).map((a) => a.name);
}

/** Seconds a muster is announced ahead (the sim's MUSTER_SOON comes 300 ticks before it). */
export const MUSTER_WARN_SEC = 5;

/**
 * Does event i's notice ask nothing of the player? Those go on the HUD's quiet line in the lower
 * third (hud.notice(lines, ms, now, { quiet: true })), and the middle line keeps what does: a boss,
 * an elite, a muster, a task to do, a chest to open (0.7.3). Quiet: a Form taken, a task done, the
 * Ferryman's new stock, Lantern Night ending, and a level's gift (createGiftNotices).
 */
export function quietNotice(events, i) {
  switch (events.type[i]) {
    case EV.FIRST_SIGHT: return true;
    case EV.EYE: return true;
    // High water's warning asks you to mind the creeks; the rest of the water's news is quiet.
    case EV.WATER: return !(events.a[i] === WATER.WARN && events.c[i] === 0);
    case EV.ASCEND: return true;
    case EV.FERRY: return events.a[i] !== 3;   // he tied up nearby: worth the walk (the middle line)
    // A lamp lit is news; a bell rung has a chest to open (the middle line). (b 3, a lamp going out,
    // no longer happens and has no line; it stays quiet should a build ever send one.)
    case EV.TASK: return events.b[i] === 3 || (events.b[i] === 2 && events.a[i] === TASK.LAMP);
    case EV.NIGHT: return events.a[i] !== 1;
    case EV.ARM: return true;      // a bell waking (W4): there when you want it
    case EV.FIND: return true;
    case EV.RELIC_POOL: return true;
    case EV.VAULT_EMPTY: return true;
    default: return false;
  }
}

/**
 * Does event i bring a chest within reach (an elite, a boss, a muster's captain)? The second elite
 * of a Tide's pair carries none (sim/enemies.js NO_CHEST), so it never counts (`world` given).
 */
export function chestSource(events, i, world = null) {
  const t = events.type[i];
  if (t === EV.ELITE_SPAWN && world?.enemies) {
    const E = world.enemies, k = E.resolve ? E.resolve(events.b[i]) : -1;
    if (k >= 0 && E.boss?.[k] === NO_CHEST) return false;
  }
  return t === EV.ELITE_SPAWN || t === EV.BOSS_SPAWN || t === EV.MUSTER;
}

// ---------------------------------------------------------------- a level's gift (0.7.3)

/** LEVEL_GIFT's kinds (the sim's event: a = kind, b = amount, c = the level). */
export const GIFT = Object.freeze({ FOOD: 1, COIN: 2, GLASS: 3, EMBER: 4 });

/** "+30 Coin", "+3 Pearls", "+1 Ember", "Food" for a gift of `n`. */
export function giftText(kind, n) {
  if (kind === GIFT.FOOD) return n > 1 ? `${n} Food` : 'Food';
  if (kind === GIFT.EMBER) return `+${n} ${n === 1 ? 'Ember' : 'Embers'}`;
  if (kind === GIFT.GLASS) return `+${pearlsText(n)}`;
  return `+${n} Coin`;
}

/**
 * Pearls as the player reads them: "1 Pearl", "12 Pearls" (0.8.2: Sea Glass is called Pearls on
 * every screen, so it can't be mistaken for the Marsh's Salt Glass; ids and saves keep "glass").
 */
export function pearlsText(n) { return `${formatCount(n)} ${n === 1 ? 'Pearl' : 'Pearls'}`; }

/**
 * A level-up with nothing left to level pays a gift without stopping the run, and a run late on
 * pays one a level: one line each would bury the quiet line. Gifts of one kind on levels in a row
 * collapse into one line ("Levels 54 to 56: +30 Coin", "Level 57: +10 Coin" alone), which goes out
 * once no gift of its kind has come for `holdMs` (or another kind breaks the row). add() takes the
 * event's numbers and the time in ms; take(now) returns the lines that are ready, oldest first.
 */
export function createGiftNotices(holdMs = 900) {
  let open = null;   // { kind, from, to, amount, at }
  const ready = [];
  const line = (g) => `${g.from === g.to ? `Level ${g.from}` : `Levels ${g.from} to ${g.to}`}: ${giftText(g.kind, g.amount)}`;
  const close = () => { if (open) { ready.push(line(open)); open = null; } };
  return {
    add(kind, amount, level, now) {
      if (!(amount > 0) || !Number.isFinite(level)) return;
      if (open && open.kind === kind && level === open.to + 1) { open.to = level; open.amount += amount; open.at = now; return; }
      close();
      open = { kind, from: level, to: level, amount, at: now };
    },
    take(now) {
      if (open && now - open.at >= holdMs) close();
      return ready.splice(0, ready.length);
    },
    /** Everything still held, now (a run's end). */
    flush() { close(); return ready.splice(0, ready.length); },
  };
}

// ---------------------------------------------------------------- first sightings (0.8.0)

/** A FIRST_SIGHT's name as the sim's result keeps it: 'enemy:<id>' or a thing's ('water', 'storm', ...). */
export function sightName(world, what, type) {
  if (what === SIGHT.ENEMY) { const d = world.enemyDefs[type]; return d ? `enemy:${d.id}` : null; }
  return SIGHT_NAMES[what] ?? null;
}

/**
 * What a first sighting says: { name, line }, or null for one this build can't name.
 * An enemy's are its own name and description (data/enemies.js); a thing's are its glossary entry's
 * name and short line (data/glossary.js fieldGuideEntry: one description, read here).
 */
export function guideEntry(data, key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('enemy:')) {
    const e = data.enemies.find((x) => x.id === key.slice(6));
    return e ? { name: e.name, line: e.desc } : null;
  }
  const g = fieldGuideEntry(data.meta, key);
  return g ? { name: g.name, line: g.line, term: g.term } : null;
}

/**
 * The quiet line's notice for something new (docs/design/SALT_MARSH.md rule 5): one line, "First
 * sighting: Mire Toad. Hops, landing in a warned ring." (0.9.0, V4: the two halves showed apart,
 * the flavor alone in mid-screen). Nothing for what earlier runs have shown. The run scene holds an
 * enemy's until one is on screen (app/runtips.js createSightings).
 */
function sightNotice(world, key, known) {
  if (!key || known?.has(key)) return null;
  const g = guideEntry(world.data, key);
  if (!g) return null;
  if (g.term === 'lamp' && world.trade?.id === 'lamps' && world.trade.P?.touch) return `First sighting: ${g.name}. Walk to it to light it. It stays lit, refills your Fuel, and its light burns enemies.`;   // (round 3, L3 1)
  const line = (g.line || '').trim();
  return line ? `First sighting: ${g.name}. ${line.charAt(0).toUpperCase()}${line.slice(1)}` : `First sighting: ${g.name}`;
}

/** High and low water: the warning (the middle line), high water and low water (quiet), overtime's flood. */
function waterNotice(events, i, world = null) {
  const phase = events.a[i], secs = Math.round(events.b[i]), overtime = events.c[i] === 1;
  if (phase === WATER.WARN) return overtime ? `High water in ${secs}s. It stays for the rest of the run` : `High water in ${secs}s: the creeks will flood`;
  if (overtime) return null;
  // (Round 4: the Punter crosses water, so "closed" alone was false for him.)
  if (phase === WATER.HIGH) return world?.trade?.id === 'pole' ? `High water: the creeks are closed to walkers. You can cross for ${world.trade.P.punt}s at a time` : 'High water: the creeks are closed';
  if (phase === WATER.LOW) return 'Low water: the creeks are open, with herbs on the mud';
  return null;
}

/**
 * A profile document with a map's sightings set to `names` (earlier runs' and this run's so far), for
 * the pause menu's codex of this map (meta/codex.js reads profile.seen). The profile isn't changed.
 */
export function withSights(doc, mapId, names) {
  const seen = { ...(doc?.profile?.seen || {}), [mapId]: [...new Set(names.filter((x) => typeof x === 'string'))] };
  return { ...doc, profile: { ...(doc?.profile || {}), seen } };
}

/**
 * A task's notice: what it asks when it starts, what it gave when it's done (0.8.2: a lit lamp is
 * a ward, so its line says so; Kindled is gone). A lit lamp stays lit (0.9.0, ruling 6), so nothing
 * is said of one going out. The bell's crew walking in says nothing (the bell's number over it does).
 */
function taskNotice(events, i, world) {
  const t = world.tasks[events.c[i]];
  if (!t) return null;
  const lamp = t.kind === TASK.LAMP, b = events.b[i];
  const pearls = events.d[i] > 0 && world.ferry ? `, ${pearlsText(events.d[i])}` : '';
  if (t.kind === TASK.CRANE) return b === 2 ? `Crane: its loads drop on the crowd${pearls}` : null;
  if (t.kind === TASK.CAIRN) return b === 2 ? `Salt Cairn: lightning strikes the crowds near it for ${world.tuning?.tasks?.cairn?.sec ?? 20}s${pearls}` : null;
  if (b === 1 && lamp && t.twist === TWIST.HELD) return 'Slow lamp: stay in its circle. Enemies will rush it';
  // (Round 4, L3: the Lamplighter lights a lamp at a touch, so its start line was false for her; the lit line says it.)
  if (b === 1 && lamp && world.trade?.id === 'lamps' && world.trade.P?.touch) return null;
  if (b === 1) return lamp ? 'Wayside Lamp: stay in its circle to light it' : `Fog Bell: kill ${t.need} enemies`;
  if (b !== 2) return null;
  if (lamp) {
    const lit = world.tasks.filter((x) => x.kind === TASK.LAMP && x.state === 2).length, all = world.tasks.filter((x) => x.kind === TASK.LAMP).length;
    if (t.twist === TWIST.HELD) return `Slow lamp lit: open its chest${pearls}`;
    return `Lamp ${lit} of ${all} lit: enemies in its light burn${world.trade?.id === 'lamps' ? ', and your Fuel is full' : ''}${pearls}`;
  }
  // (Round 4: for the Tide Priest a bell rings twice; the first ring says so.)
  const again = t.kind === TASK.BELL && world.trade?.id === 'bells' && t.state === TASK_STATE.IDLE ? '. Start it again for a bigger wave and a second chest' : '';
  return `Bell rung: its chest gives one item +${world.tuning.tasks.bell?.levels ?? 2} levels${pearls}${again}`;
}

/**
 * Where the next chest is (0.7.3: one lying on the map first, then a living elite or boss, then
 * the next on the timeline; sim/chests.js nextChestSource): "open the chest on the map", "kill the
 * elite Bloater for its chest", "the next chest comes at 7:30", or null when nothing is coming.
 */
export function nextChestText(world) {
  const n = chests.nextChestSource?.(world);
  if (!n) return null;
  const name = (id) => world.enemyDefs.find((d) => d.id === id)?.name;
  if (n.kind === 'chest') return 'open the chest on the map';
  if (n.kind === 'elite') return `kill the elite ${name(n.enemy) ?? 'enemy'} for its chest`;
  if (n.kind === 'boss') return `kill ${midName(name(n.enemy) ?? 'the boss')} for its chest`;
  if (n.kind === 'event' && Number.isFinite(n.at)) return `the next chest comes at ${formatClock(n.at)}`;
  return null;
}

/** What a chest source is called in a line ("the elite Bloater", "the Harbor Maw"), or null. */
export function chestSourceName(events, i, world) {
  const def = world.enemyDefs[events.a[i]];
  if (events.type[i] === EV.ELITE_SPAWN) return `the elite ${def?.name ?? 'enemy'}`;
  if (events.type[i] === EV.BOSS_SPAWN) return def ? midName(def.name) : 'the boss';
  if (events.type[i] === EV.MUSTER) return 'the muster\'s captain';
  return null;
}

/** A boss's name inside a sentence ("The Harbor Maw" -> "the Harbor Maw"). */
const midName = (n) => (n.startsWith('The ') ? `the ${n.slice(4)}` : n);

/**
 * Sea Glass the first time a run picks some up: what it's for. (Once a world: a WeakSet, so the
 * sim never carries it.)
 */
const toldGlass = new WeakSet();
function glassNotice(events, i, world) {
  // Before the Docks there is no one to spend it with: a system the player can't use yet says
  // nothing (0.7.3). (Glass left at the end is lost unless the Market buys it: the Docks' and
  // Market's panels say so.)
  if (events.a[i] <= 0 || toldGlass.has(world) || !world.ferry) return null;
  toldGlass.add(world);
  return 'Pearls: spend them with the Ferryman this run';
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
/**
 * extra.formSeen: the profile has seen a Form screen before (RULING-L1: a new weapon's card names its
 * Final Form only after that); this run's first Form counts too.
 */
export function buildContext(world, extra = {}) {
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
  // The passives the run can still offer: a weapon whose partner isn't among them says where it comes from.
  const pool = Array.isArray(world.pools?.passives) ? world.pools.passives.map((p) => (typeof p === 'string' ? p : p.id)) : undefined;
  // And the weapons it can offer: a passive whose capstone weapon isn't among them says where it comes from.
  const weaponPool = Array.isArray(world.pools?.weapons) ? world.pools.weapons.map((p) => (typeof p === 'string' ? p : p.id)) : undefined;
  // The capstones the profile has opened (RunConfig.forms), so a new weapon's card says truthfully what opens its.
  const formSeen = extra.formSeen === true || world.slots.some((sl) => sl && Array.isArray(sl.ascensions) && sl.ascensions.length > 0);
  return { tags, weapons, passives, pool, weaponPool, forms: world.config?.forms, formSeen };
}

/** Plain data for the screen that goes with a halt. */
export function haltView(world, halt, data, extra = {}) {
  const ctx = buildContext(world, extra);
  switch (halt.kind) {
    case 'draft':
      return {
        kind: 'draft', level: world.player.level,
        cards: (halt.offer || []).map((c) => ({ ...cardInfo(c, data, ctx), kind: c.kind })),
        charges: { ...world.charges },
        // What a skip pays (W1's contract §6): "+10 Coin", or null when skips pay nothing.
        skipPays: (() => { const p = typeof draftMod.skipPay === 'function' ? draftMod.skipPay(world) : null; return p ? giftText(p.kind, p.amount) : null; })(),
      };
    case 'chest':
      return { kind: 'chest', boss: halt.chestKind === CHEST_BOSS, secret: halt.chestKind === CHEST_SECRET, dawn: halt.dawn === true, items: halt.items.map((it) => ({ ...cardInfo(it, data, ctx), kind: it.kind })) };
    case 'ascend': {
      // A Form choice (work/cw/C1-CONTRACT.md 7.2). An axis that just opened (`direct`): that weapon,
      // that axis, its two options. An Ember, or the pause menu's Forms: every weapon you chose,
      // each with its three axes: what it holds, what it could take (free, or for an Ember), and
      // for the rest what opens it.
      const direct = Number.isInteger(halt.slot) && !!halt.axis;
      const weapons = [];
      for (let s = 0; s < world.build.weaponSlots; s++) {
        if (direct && s !== halt.slot) continue;
        const slot = world.slots[s];
        if (!slot || !slot.def || (!direct && !isDrafted(slot))) continue;
        const v = formsOf(world, s, direct ? halt.axis : null);
        if (!v || (!direct && !v.forms.some((f) => !f.taken && !f.why && (f.cost === 'free' || world.build.embers > 0)))) continue;
        weapons.push(v);
      }
      return { kind: 'ascend', embers: world.build.embers, weapons, direct, axis: direct ? halt.axis : null, why: halt.why ?? null };
    }
    case 'overtime': {
      const last = world.bosses.filter((b) => b.final).at(-1);
      return { kind: 'overtime', bossName: last ? world.enemyDefs[last.type].name : 'Boss' };
    }
    case 'relic': {
      // A Reliquary's or the vault's three (drawn when the halt came up).
      const relics = (halt.offer || []).map((id) => relicInfo(world, id));
      // How many of the run's pool are found (0.8.2, core 2.4): "Relics: 3 of 5 found".
      // The relic slots full (W1's contract §5): a pick gives up a carried relic, or passes.
      const full = !!halt.full;
      return { kind: 'relic', vault: halt.source === 'vault', relics, pool: poolOf(world), full, slots: slotsOf(world), carried: full ? world.build.relics.map((r) => relicInfo(world, r.id)) : [] };
    }
    case 'bellpick': {
      // The Fog Bell's chest (0.8.2, idea 3): one weapon or passive gains its levels. Each card says
      // what the levels add, one level's lines after the other's.
      const options = (halt.options || []).map((o, index) => {
        const weapon = o.kind === 'weapon';
        const def = weapon ? world.slots[o.slot]?.def : world.build.passives[o.slot]?.def;
        // A weapon's levels are rolled upgrades, rolled when it's picked: the card says how many, and its Form line.
        if (weapon) {
          const n = o.to - o.from;
          const f = formLineFor(world, o.slot);
          return { index, kind: 'weapon', id: o.id, name: def?.name ?? o.id, icon: def ? lookOf(world.slots[o.slot]).icon : '', sub: `Lv ${o.from} to ${o.to}`, desc: `+${n} ${n === 1 ? 'level' : 'levels'}, each with a rolled rarity.${f ? ` ${f}` : ''}` };
        }
        const lines = [];
        for (let lv = o.from + 1; lv <= o.to; lv++) lines.push(weapon ? weaponLevelText(def, lv) : passiveLevelText(def, lv));
        return {
          index, kind: o.kind, id: o.id, name: def?.name ?? o.id, icon: def?.icon ?? '',
          sub: `Lv ${o.from} to ${o.to}${def && o.to >= def.maxLevel ? ' MAX' : ''}`,
          // The same stat on both levels is said once, added up (0.9.0, V4: "+10% Area (Light),
          // +10% Area (Light)").
          desc: mergeStatLines(lines.filter(Boolean).join(', ')),
        };
      });
      return { kind: 'bellpick', levels: world.tuning.tasks.bell?.levels ?? 2, options };
    }
    case 'well': {
      // The Salt Well (0.8.0): the relics carried now, one to give, or keep them all.
      return { kind: 'well', relics: (halt.relics || []).filter((id) => world.build.relics.some((r) => r.id === id)).map((id) => relicInfo(world, id)) };
    }
    case 'ferry': {
      const F = world.ferry;
      // A relic found elsewhere since he stocked it is left off (0.8.2, core 2.4); `index` still
      // counts every row, as the sim's does.
      const offers = (F?.offers || []).map((o, index) => {
        if (o.gone) return null;
        const info = o.kind === FERRY_KINDS.relic ? { ...relicInfo(world, o.id), ...(o.well ? { well: true, tierName: `Well, ${relicInfo(world, o.id).tierName}` } : {}) }
          : o.kind === FERRY_KINDS.food ? { name: 'Food', desc: `Heals ${world.tuning.ferry.foodHeal} HP.`, icon: 'pk_heal', tier: null }
            : o.kind === FERRY_KINDS.reroll ? { name: 'Reroll', desc: 'One more reroll for level-up cards this run.', icon: 'item_bone', tier: null }
              : { name: 'Ember', desc: "Opens a weapon's next Form now, or swaps one it has.", icon: 'pk_ember', tier: null };
        const carried = o.kind === FERRY_KINDS.relic && world.build.relics.some((r) => r.id === o.id);
        const why = o.sold ? 'Sold' : carried ? 'You have it' : world.glass < o.price ? `Need ${pearlsText(o.price - world.glass).replace(/ /, ' more ')}` : null;
        return { index, ...info, relic: o.kind === FERRY_KINDS.relic, returned: !!o.returned, price: o.price, sold: o.sold, why };
      }).filter(Boolean);
      // A relic bought with the slots full gives up a carried one (W1's contract §5).
      const full = slotsOf(world).full;
      return { kind: 'ferry', glass: world.glass, offers, full, slots: slotsOf(world), carried: full ? world.build.relics.map((r) => relicInfo(world, r.id)) : [] };
    }
    default:
      throw new Error(`haltView: unknown halt "${halt.kind}"`);
  }
}

/**
 * Stat lines with the same stat added up, in the order each first appears: "+10% Area (Light),
 * +10% Area (Light), +1 Pierce" is "+20% Area (Light), +1 Pierce". A line that isn't a stat stays
 * as it is.
 */
export function mergeStatLines(text) {
  if (typeof text !== 'string' || !text) return text;
  const order = [];
  const sums = new Map();
  for (const part of text.split(', ')) {
    const m = /^([+-])(\d+(?:\.\d+)?)(%|s|x)? (.+)$/.exec(part);
    if (!m) { order.push({ raw: part }); continue; }
    const key = `${m[3] ?? ''}|${m[4]}`;
    const v = (m[1] === '-' ? -1 : 1) * Number(m[2]);
    if (sums.has(key)) { sums.get(key).v += v; continue; }
    const e = { key, v, unit: m[3] ?? '', name: m[4] };
    sums.set(key, e);
    order.push(e);
  }
  const num = (v) => String(Math.round(Math.abs(v) * 100) / 100);
  return order.map((e) => (e.raw !== undefined ? e.raw : `${e.v < 0 ? '-' : '+'}${num(e.v)}${e.unit} ${e.name}`)).join(', ');
}

/** { found, total } of the run's relic pool (sim/signs.js relicPool), or null before it exists. */
function poolOf(world) {
  const fn = signsMod?.relicPool;
  if (typeof fn !== 'function') return null;
  const out = { found: 0, total: 0 };
  fn(world, out);
  return out.total > 0 ? out : null;
}

/** A relic as a card shows it: its name, what it does, its icon, its tier by name, and any downside (W1). */
function relicInfo(world, id) {
  const r = world.relicDefs.find((x) => x.id === id);
  return { id, name: r?.name ?? id, desc: r?.desc ?? '', icon: r?.icon ?? '', tier: r?.tier ?? 1, tierName: rarityOfTier(r?.tier ?? 1).name, downside: r?.downside ?? null };   // (RULING-L1: relic tiers are rarity names)
}

/** The relic slots: { used, total, full } (W1: world.build.relicSlots; none set reads as never full). */
function slotsOf(world) {
  const total = Number.isInteger(world.build.relicSlots) ? world.build.relicSlots : Infinity;
  const used = world.build.relics.length;
  return { used, total, full: used >= total };
}

/**
 * One weapon's Forms for a screen: { slot, name, icon, level, taken: [names], forms: [{ id, name,
 * desc, price, axis, label, capstone, taken, cost: 'free' | 'ember' | null, switches (the name it
 * would replace), why (what opens it, when it can't be taken now) }] }, its options in axis order
 * (`only`: one axis's two).
 */
export function formsOf(world, s, only = null) {
  const slot = world.slots[s];
  const st = axisState(world, s);
  if (!slot || !st.length) return null;
  const choices = optionChoices(world, s);
  const forms = [];
  for (const a of st) {
    if (only && a.axis !== only) continue;
    for (const o of a.options) {
      const c = choices.find((x) => x.option === o) ?? null;
      const taken = a.taken === o;
      let why = null;
      if (!taken && (!c || (c.cost === 'ember' && world.build.embers <= 0))) why = axisWhy(world, slot, a, st, c);
      // (Ruling 25 WA: a Final Form option with a later project of its own, as Tether has, says that project.)
      if (!taken && o.capstone && typeof o.unlock === 'string' && Array.isArray(world.config.forms) && !world.config.forms.includes(o.id)) { const t = unlockText(world.data, o.unlock); why = t ? `Opens with ${t}` : 'Not open yet'; }
      forms.push({ id: o.id, name: o.name, desc: o.desc, price: o.price ?? null, axis: a.axis, label: AXIS_LABEL[a.axis], capstone: !!o.capstone, taken, cost: c ? c.cost : null, switches: c && c.switches ? c.switches.name : null, why });
    }
  }
  return { slot: s, name: slot.def.name, icon: lookOf(slot).icon, level: slot.level, taken: slot.ascensions.map((a) => a.name), forms };
}

/** Why an option can't be taken now, in plain words: what opens its axis, truthfully. */
function axisWhy(world, slot, a, st, c) {
  if (c && c.cost === 'ember') return c.switches ? `Swapping from ${c.switches.name} takes an Ember` : 'An Ember opens it now';
  if (a.open && a.taken) return `Has ${a.taken.name}. An Ember swaps it`;
  if (a.axis === 'payoff') {
    if (a.locked) { const t = unlockText(world.data, a.locked); return t ? `Opens with ${t}` : 'Not open yet'; }
    const d = a.deed;
    return d ? `Final Form goal: ${d.text.charAt(0).toLowerCase()}${d.text.slice(1)} (${Math.floor(d.have)}/${d.need})` : 'Opens as it levels up';
  }
  if (!isDrafted(slot)) return 'Opens as it levels up';
  return `New Form at Lv ${a.at + 1} (Lv ${slot.level} now)`;
}

/** The Form line of the weapon in slot s for the pause menu: the axis ahead, or its capstone's deed. */
function formLineFor(world, s) {
  const slot = world.slots[s];
  if (!slot || !slot.def || slot.def.innate) return null;
  const st = axisState(world, s), n = slot.ups.length;
  const nx = isDrafted(slot) ? st.find((a) => a.at !== null && !a.open) : null;
  if (nx) return formLine(world.data, { next: { axis: nx.axis, at: nx.at, left: Math.max(1, nx.at - n) } });
  const pay = st.find((a) => a.axis === 'payoff');
  if (!pay || pay.open) return null;
  return deedLine(world.data, pay.locked ? { locked: pay.locked } : deedState(world, s));
}

/**
 * A weapon's three axes as the stats screen says them (C3): what it holds on each, else when or how
 * that axis opens. "How it fires: Salvo", "How its shots travel: at its 10th upgrade (3 to go)",
 * "Capstone: Kill 60 enemies from far off with it (41/60)", "Capstone: a choice is waiting".
 */
function axesFor(world, s) {
  const slot = world.slots[s];
  if (!slot || !slot.def || slot.def.innate) return [];
  const n = slot.ups.length, out = [];
  for (const a of axisState(world, s)) {
    const label = AXIS_LABEL[a.axis] ?? a.axis;
    if (a.taken) { out.push(`${label}: ${a.taken.name}`); continue; }
    if (a.open) { out.push(`${label}: a Form is ready`); continue; }
    if (a.locked) { out.push(deedLine(world.data, { locked: a.locked })); continue; }
    if (a.axis === 'payoff') {
      const t = slot.def.signature && world.trade ? trackState(world) : null;
      const d = t && t.deed.need > 0 ? { text: world.character?.trade?.deedText ?? 'its deed', have: t.deed.have, need: t.deed.need, done: t.deed.done } : deedState(world, s);
      out.push(deedLine(world.data, d) ?? 'Final Form: locked');
      continue;
    }
    if (a.at !== null) out.push(`${label}: at Lv ${a.at + 1} (${Math.max(1, a.at - n)} to go)`);   // (RULING-L1: one count, its level)
  }
  return out.filter(Boolean);
}

function ordinal(n) { const t = n % 100, k = n % 10; return `${n}${t >= 11 && t <= 13 ? 'th' : k === 1 ? 'st' : k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'}`; }

const ordinalN = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// What each character does to level up their signature weapon, as the stats screen says it (round 3,
// the director's call: two short sentences, and the count says what it counts, from each one's trade
// numbers): [what levels it, what the count counts, what the extra bonus is counted in].
function trackWords(id, P) {
  switch (id) {
    case 'lamps': return ['each time she lights a lamp', `a lamp is ${P.per}, a lantern set down while her light is dimmed is 1`, 'lamps'];
    case 'hook': return ['as her hook pulls in elites and loot, and as her Grapnel pulls enemies', `an elite is ${P.perElite}; a chest, Reliquary, or Ember is ${P.perLoot}${P.haulDeed ? `; every ${P.haulDeed} Grapnel pulls is 1` : ''}`, 'pulls'];   // (Ruling 23 KE)
    case 'pole': return ['as he sweeps', `a sweep is 1${P.marshSweep ? `, ${P.marshSweep} on the Salt Marsh` : ''}; a floating chest is ${P.per * 2}`, 'sweeps'];
    case 'raise': return ['as she raises the dead', `an enemy she walks over is 1; a bog body or wreck crew is ${P.per}`, 'raised dead'];
    case 'cargo': return ['with each sunken crate he brings up', 'a crate is 1', 'crates'];
    case 'bells': return ['as she rings Fog Bells and floods crowds', `a Fog Bell is ${P.per}; a flood that hits ${P.catch} or more enemies is 1`, 'bells and floods'];
    default: return ['as the character plays', null, 'counts'];
  }
}

/**
 * The signature weapon's growth (C2's track, ruling 14 D10) as the stats screen's lines (round 3): "Levels
 * up every 3:00, and each time she lights a lamp." and "Next level: 1/3 (a lamp is 3, a lantern set down
 * while her light is dimmed is 1)", and, once above 0, "Extra lamps: +8% Damage (max +40%)".
 */
function trackLine(world) {
  const t = world.trade ? trackState(world) : null, P = world.trade?.P;
  if (!t || !P) return null;
  const [verb, counts, noun] = trackWords(world.trade.id, P);
  const when = [P.clock ? `every ${formatClock(P.clock)}` : null, P.lvEvery ? `every ${P.lvEvery === 1 ? '' : `${ordinalN(P.lvEvery)} `}level-up` : null].filter(Boolean).join(' and ');
  const lines = [`Levels up ${when ? `${when}, and ` : ''}${verb}.`];
  if (t.need > 0) lines.push(`Next level: ${Math.floor(t.have)}/${t.need}${counts ? ` (${counts})` : ''}.`);
  const past = P.pastCap > 0 ? Math.round((world.trade.s.pastN ?? 0) * P.pastCap * 100) : 0;
  if (past > 0) lines.push(`Extra ${noun}: +${past}% Damage (max +${Math.round(P.pastMax * 100)}%)`);
  if (P.grow > 0) lines.push(`+${Math.round(P.grow * 100)}% Damage each minute of the run (now +${Math.round(((world.trade.s.grow ?? 1) - 1) * 100)}%, max +${Math.round((P.growMax - 1) * 100)}%)`);
  return lines;
}

/** The Dash slot (ruling 16) as the stats screen says it: the item, what it does, and its numbers now. */
function dashView(world) {
  const d = world.dash;
  if (!d || !d.def) return null;
  const st = d.stats;
  return {
    name: d.def.name, icon: d.def.icon, desc: d.def.desc,
    lines: [['Charges', String(st.charges)], ['Recharge', `${num(dashCooldown(world), 2)}s`], ['Distance', `${Math.round((st.distance / (world.tuning.player.dash.distance || st.distance || 1)) * 100)}%`]],
  };
}

/** A weapon slot's look (W1: its capstone's once taken; data/ascensions.js weaponLook). */
function lookOf(slot) {
  return typeof weaponLook === 'function' ? weaponLook(slot.def, slot.ascensions || []) : { icon: slot.def.icon, sprite: slot.def.sprite };
}

/** The lines and specials a slot holds, by name. */
function marksOf(slot) {
  const def = slot.def;
  return [...(slot.lines || []).map((id) => (def.lines || []).find((x) => x.id === id)?.name), ...(slot.specials || []).map((id) => (def.specials || []).find((x) => x.id === id)?.name)].filter(Boolean);
}

/** A slot's three biggest number upgrades, as their card lines ("+44% Damage"). */
function topUps(world, slot) {
  const R = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  return (slot.ups || []).filter((u) => u.up !== 'line' && u.up !== 'special').slice().sort((a, b) => R.indexOf(b.rarity) - R.indexOf(a.rarity)).slice(0, 3).map((u) => upgradeText(world.data, slot.def, u));
}

/** The pause menu's summary of the build. */
export function pauseBuild(world) {
  const weapons = [];
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    if (slot && slot.def) {
      weapons.push({
        // A weapon never maxes (ruling 10): its level, and its Form progress line.
        name: slot.def.name, icon: lookOf(slot).icon, level: slot.level, max: false, desc: slot.def.desc,
        ascensions: slot.ascensions.map((a) => a.name),
        marks: marksOf(slot),
        form: formLineFor(world, s),
      });
    }
  }
  return {
    time: formatClock(world.tick / 60),
    embers: world.build.embers,
    // Only with nothing else waiting: an Ember can't be spent over a level-up or its own screen.
    // (An Ember kept, or an axis's choice kept for later.)
    canAscend: !world.halts.length && canAscend(world),
    weapons,
    passives: world.build.passives.map((p) => ({ name: p.def.name, icon: p.def.icon, level: p.level, max: p.level >= p.def.maxLevel, desc: p.def.desc })),
    relics: world.build.relics.map((r) => ({ name: r.name, icon: r.icon, desc: r.desc })),
    materials: materialsFound(world),
    // The map's ledger so far (0.8.2, idea 10): what the map holds and what this run did with it.
    ledger: ledgerLines(typeof tasks.runLedger === 'function' ? tasks.runLedger(world) : null),
  };
}

/**
 * The map's ledger as [label, value] rows (0.8.2, idea 10): the pause menu and the run's end
 * show the run against what the map holds. `L`: sim/tasks.js runLedger(world), or a RunResult's
 * `ledger`. [] for none.
 */
export function ledgerLines(L) {
  if (!L) return [];
  const out = [];
  // 0.9.0 (V4: "Lamps 0/5" beside "Relics 4 of 4 found"): every count says "of".
  if (L.lamps?.total > 0) out.push(['Lamps', `${L.lamps.most ?? L.lamps.lit} of ${L.lamps.total} lit`]);
  if (L.bells?.total > 0) out.push(['Bells', `${L.bells.rung} of ${L.bells.total} rung`]);
  if (L.ferry) out.push(['Ferryman trades', String(L.ferry.trades ?? 0)]);
  if (L.relics?.total > 0) out.push(['Relics', `${L.relics.found} of ${L.relics.total} found`]);
  if (L.secrets?.total > 0) {
    const n = L.secrets.found?.length ?? 0;
    out.push([L.secrets.total === 1 ? 'Secret' : 'Secrets', L.secrets.total === 1 ? (n ? 'Found' : 'Not found') : `${n} of ${L.secrets.total} found`]);
  }
  if (L.nights > 0) out.push(['Lantern Nights', String(L.nights)]);
  return out;
}

/** The materials found so far this run, in the data's order: [{ id, name, icon, count }] (only those with 1 or more). */
export function materialsFound(world) {
  const out = [], raw = world.result.materialsRaw, mul = haulMul(world);
  for (let i = 0; i < raw.length; i++) {
    const c = Math.floor(raw[i] * mul + 1e-9);
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
    ['XP Gain', pctFrom1(st.growth)],
    ['Materials', pctFrom1(st.greed)],
    ['Revivals', String(p.revivals ?? 0)],
    ['Rerolls', String(world.charges.reroll)],
    ['Banishes', String(world.charges.banish)],
    ['Skips', String(world.charges.skip)],
  ];
  // What reaches every weapon (a modifier with no tag): read off a plain probe weapon.
  const g = computeWeaponStats(world.tuning, GLOBAL_PROBE, 1, world.mods);
  // A weapon a modifier names for itself (the Bog Warden's Bog Hands, kept whole by her cost): the
  // line says the exception, so "every weapon" stays true (C3, ruling 18 P2).
  const apart = [...new Set((world.mods || []).filter((m) => m.weapon !== undefined && m.stat === 'might').map((m) => m.weapon))]
    .filter((id) => world.slots.some((sl) => sl && sl.def && sl.def.id === id))
    .map((id) => ({ id, d: computeWeaponStats(world.tuning, { ...GLOBAL_PROBE, id }, 1, world.mods).damage }))
    .filter((x) => Math.abs(x.d - g.damage) > 1e-9)
    .map((x) => `${world.weaponDefs[world.weaponIndex.get(x.id)]?.name ?? x.id} ${pctFrom1(x.d)}`);
  const allWeapons = [
    ['Damage', apart.length ? `${pctFrom1(g.damage)} (${apart.join(', ')})` : pctFrom1(g.damage)], ['Area', pctFrom1(g.area)], ['Cooldown', pctFrom1(g.cooldown)],
    ['Projectiles', `+${num(g.amount)}`], ['Duration', pctFrom1(g.duration)], ['Projectile Speed', pctFrom1(g.speed)],
    ['Crit Chance', `${Math.round(g.crit * 100)}%`],
  ];
  const weapons = [];
  for (let s = 0; s < world.slots.length; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.def) continue;
    const w = slot.stats;
    weapons.push({
      name: slot.def.name, icon: lookOf(slot).icon, level: slot.level, max: false, innate: !!slot.def.innate, signature: !!slot.def.signature,
      ascensions: (slot.ascensions || []).map((a) => a.name),
      // The build, not only the numbers: what it does, the lines and specials it holds, its biggest upgrades, and its Form line.
      desc: slot.def.desc, marks: marksOf(slot), ups: topUps(world, slot), form: null,
      // C3: its three axes, each what it holds or what opens it; the signature's own track.
      axes: axesFor(world, s), track: slot.def.signature ? trackLine(world) : null,
      // DPS and Total Damage first, side by side (the two the run has made), then its numbers.
      lines: [
        ['DPS', dpsText(world.result.realBySlot[s] || 0, (world.tick - (slot.since ?? 0)) / 60)],   // (health it took off enemies: no overkill, C1 Nov 17)
        ['Total Damage', formatCount(Math.round(world.result.realBySlot[s] || 0))],
        ['Damage', num(w.damage, 1)], ['Cooldown', `${num(w.cooldown, 2)}s`], ['Projectiles', num(w.amount)],
        ['Area', `${Math.round(w.area * 100)}%`], ['Pierce', w.pierce < 0 ? 'All' : num(w.pierce)],
        ['Duration', `${num(w.duration, 2)}s`], ['Crit Chance', `${Math.round(w.crit * 100)}%`],
        ...(w.hitCooldown > 0 ? [['Hit Delay', `${num(w.hitCooldown, 2)}s`]] : []), ...(w.knockback > 0 ? [['Knockback', num(w.knockback, 1)]] : []),
      ],
    });
  }
  const b = pauseBuild(world);
  const items = [
    ...b.passives.map((x) => ({ ...x, kind: 'passive' })),
    ...b.relics.map((x) => ({ ...x, kind: 'relic' })),
  ];
  // Who you are playing, what they do, and what it costs (the gate card's own lines).
  const c = world.character;
  const who = c && c.name ? { name: c.name, gives: c.card?.does ?? c.gives ?? null, costs: c.card?.costs ?? c.costs ?? null } : null;   // (C3: the gate card's short lines, so the column fits)
  // C3: the Dash slot, and the skills this run uses (ruling 15).
  const skills = Object.keys(world.sk || {}).map((id) => world.data.skills?.find((x) => x.id === id)?.name).filter(Boolean);
  return { who, character, allWeapons, weapons, items, materials: b.materials, dash: dashView(world), skills };
}

const END_TITLES = { died: 'Defeated', left: 'Run ended', cleared: 'Map cleared', dawn: 'Dawn' };

/** The run-end screen's content from a RunResult. */
export function runSummary(result, data) {
  const lines = [
    ['Time', formatClock(result.timeSurvived)],
    ['Level', String(result.level)],
    ['Kills', formatCount(result.totalKills)],
    ['Bosses', result.bossesKilled.length ? result.bossesKilled.map((b) => data.enemies.find((e) => e.id === b.id)?.name ?? b.id).join(', ') : 'None'],
  ];
  if (result.overtimeMinutes > 0) lines.push(['Overtime', `${result.overtimeMinutes} min`]);
  // The run's arc (0.9.0, W4): the act reached, the Long Night won, the dawn chest.
  if (result.dawn) lines.push(['Long Night', 'Won']);
  else if (result.longNight) lines.push(['Long Night', 'Died']);
  if (Array.isArray(result.dawnItems) && result.dawnItems.length) lines.push(['Boss chest at dawn', `${result.dawnItems.length} ${result.dawnItems.length === 1 ? 'item' : 'items'}`]);
  if (Array.isArray(result.finds) && result.finds.length) lines.push([result.finds.length === 1 ? 'Small secret' : 'Small secrets', String(result.finds.length)]);
  // Evolutions are gone (W1, ruling 1): a run's Forms say what changed its weapons.
  const forms = Array.isArray(result.ascensions) ? result.ascensions.length : 0;
  if (forms > 0) lines.push(['Forms taken', String(forms)]);
  // The map's ledger (0.8.2, idea 10): the run against what the map holds.
  lines.push(...ledgerLines(result.ledger));
  // What comes home, the minutes' pay included (0.9.0, V4: the end screen said 1184 Coin and the
  // results 1,264, the pay that explains it the last line of a scrolling list): the same sums the
  // harbor adds (meta/apply.js), and the pay on a line of its own.
  const pay = timePayOf(result, data);
  const totals = { ...result.materials };
  for (const [id, n] of Object.entries(pay.materials)) totals[id] = (totals[id] ?? 0) + n;
  const order = (id) => { const i = data.materials.findIndex((x) => x.id === id); return i < 0 ? 1e9 : i; };
  const materials = Object.entries(totals).filter(([, n]) => n > 0).sort((a, b) => order(a[0]) - order(b[0])).map(([id, count]) => {
    const m = data.materials.find((x) => x.id === id);
    return { icon: m?.icon ?? 'mat_coin', name: m?.name ?? id, count };
  });
  const payLine = Object.entries(pay.materials).length
    ? `Includes ${Object.entries(pay.materials).map(([id, n]) => `+${n.toLocaleString('en-US')} ${data.materials.find((x) => x.id === id)?.name ?? id}`).join(', ')} for ${pay.minutes} ${pay.minutes === 1 ? 'minute' : 'minutes'}`
    : null;
  // A death in overtime after the last boss still cleared the map (0.7.3).
  return { title: result.dawn ? END_TITLES.dawn : result.cleared ? END_TITLES.cleared : END_TITLES[result.end] || 'Run over', lines, materials, payLine };
}

/** What a run's minutes pay at home (meta/apply.js's rule, said before the harbor adds it): { minutes, materials }. */
export function timePayOf(result, data) {
  const t = Number(result?.timeSurvived);
  const secs = Number.isFinite(t) && t > 0 ? Math.floor(t + 1e-9) : 0;
  const minutes = Math.min(Math.floor(secs / 60), data.meta?.timePay?.capMinutes ?? 0);
  const materials = {};
  for (const [id, per] of Object.entries(data.meta?.timePay?.perMinute ?? {})) {
    const v = per * minutes, n = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    if (n > 0 && data.materials.some((m) => m.id === id)) materials[id] = n;
  }
  return { minutes, materials };
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
