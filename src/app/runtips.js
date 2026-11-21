// A run's first-hour help (0.9.0, W7; V4's "Tips arrive in a lump, and first sightings split in
// two", and "No cause of death"). Pure over the sim's state; tested.
//
// - World tips: one short line over the thing itself, the first time it's on screen, in place of
//   the first run's 9-line card (that card keeps only Move and Dash): "Stay in the ring to light
//   it" over the first lamp. Each kind shows in the first run that meets it (what earlier runs have
//   shown, meta/state.js seenAnywhere, says which are new), and goes once it's done or after
//   TIP_SEC.
// - First sightings: one line, "First sighting: Fog Wisp. Fog that drifts toward light.", held
//   until the enemy is on screen (the sim says when one first spawns, which is off screen).
// - The death recap: what killed you and what hurt you in the last 5s, from the sim's hurt log
//   (W3's world.hurtLog and PLAYER_HURT's source, c, and enemy type, d), or, from a build without
//   them, from the hurts the run scene saw, named by the enemy standing where the hurt came from.

import { EV, SIGHT_NAMES } from '../sim/events.js';
import { PK, TASK, TASK_STATE, EF, EF_GONE } from '../sim/constants.js';
import { guideEntry } from './runlogic.js';

/** How long a world tip stays up at most (seconds of run time). */
export const TIP_SEC = 10;
/** How long a first sighting waits for its enemy to come on screen before it's dropped (seconds). */
export const SIGHT_WAIT_SEC = 90;
/** The camera's half view, in world px (the 640 x 360 view). */
const HALF_W = 320, HALF_H = 180;

const onScreen = (cam, x, y, pad = 0) => Math.abs(x - cam.x) <= HALF_W - pad && Math.abs(y - cam.y) <= HALF_H - pad;

/**
 * A tip's words for this run's character (round 4: a general line is never false for one character):
 * the Tide Priest's crowd is her own number (6 with Neap Priest).
 */
export function tipText(kind, world) {
  if (kind === 'tide_call') {
    const n = world?.sk?.neap_priest ? world.sk.neap_priest.crowd : world?.character?.mechanic?.params?.crowd ?? 12;
    return `Get ${n} enemies close now and the flood comes at once`;
  }
  return TIP_TEXT[kind];
}

/** The words over each kind of thing. */
export const TIP_TEXT = Object.freeze({
  lamp: 'Stay in the circle to light it',
  bell: 'Stand in the small circle to start it. Kill the wave to finish it',
  reliquary: 'Walk over it for a relic',
  chest: 'Walk over it to open it',
  ember: "Ember: opens a weapon's next Form early. Walk over it",
  ferry: 'Stand in his circle to buy',
  vault: 'Walk over it for a relic',
  // Each character's first trade moment (ruling 14 item 13, C2), over the thing itself.
  lamp_touch: 'Your lamps light at a touch',
  lantern: 'Spare flames widen your light. Light a lamp to leave a lantern by it',
  hook: 'Face it and your hook takes it',
  water: 'You can cross water. Walk onto it',
  fresh_dead: 'Walk over the fresh dead to raise them',
  crate_mark: 'A sunken crate is marked. Walk to it',
  tide_call: 'Get 12 enemies close now and the flood comes at once',
});

/**
 * The tips' state for one run: known (a Set of sighting names earlier runs have shown: 'lamp',
 * 'bell', 'ferry', 'reliquary'), firstRun (chests and Embers get a tip in a first run only).
 */
export function createWorldTips({ known = null, firstRun = false } = {}) {
  return { known: known ?? new Set(), firstRun, shownAt: new Map(), done: new Set() };
}

/** Is the tip for `kind` still wanted (never shown out, never done, and new to this player)? */
function wanted(T, kind) {
  if (T.done.has(kind)) return false;
  if (kind === 'chest' || kind === 'ember') return T.firstRun;
  return !T.known.has(kind);
}

/**
 * The tips to draw now: [{ kind, x, y, text }] in world px (the thing's middle), at most one a
 * kind, only for what's on screen. `cam`: the camera's middle, world px. Call once a frame;
 * `now` is the run's seconds (a tip goes after TIP_SEC on screen).
 */
export function worldTips(T, world, cam, now) {
  const out = [];
  const take = (kind, x, y) => {
    if (!wanted(T, kind) || out.some((t) => t.kind === kind)) return;
    if (!T.shownAt.has(kind)) T.shownAt.set(kind, now);
    if (now - T.shownAt.get(kind) > TIP_SEC) { T.done.add(kind); return; }
    out.push({ kind, x, y, text: tipText(kind, world) });
  };
  // Done once one is: any lamp lit, any bell tolled or rung. (The Lamplighter's lamps light at a touch.)
  const own = world.character?.id === 'lamplighter';
  for (const t of world.tasks || []) {
    const kind = t.kind === TASK.LAMP ? (own ? 'lamp_touch' : 'lamp') : t.kind === TASK.BELL ? 'bell' : null;
    if (!kind) continue;
    if (t.state !== TASK_STATE.IDLE) { T.done.add(kind); continue; }
    if (onScreen(cam, t.x, t.y, 24)) take(kind, t.x, t.y);
  }
  const P = world.pickups;
  if (P) {
    for (let i = 0; i < P.count; i++) {
      const k = P.kind[i];
      const kind = k === PK.RELIQUARY ? 'reliquary' : k === PK.CHEST ? 'chest' : k === PK.EMBER ? 'ember' : k === PK.VAULT ? 'vault' : null;
      if (kind && onScreen(cam, P.x[i], P.y[i], 24)) take(kind, P.x[i], P.y[i]);
    }
  }
  const F = world.ferry;
  if (F && F.moored && onScreen(cam, F.x, F.y, 24)) take('ferry', F.x, F.y);
  tradeTips(T, world, cam, take);
  return out;
}

/** Each character's first trade moment (C2): a tip over the thing, done once the trade has done it. */
function tradeTips(T, world, cam, take) {
  const tr = world.trade, p = world.player;
  if (!tr) return;
  const s = tr.s;
  switch (world.character.id) {
    case 'lamplighter':
      if ((s.lanterns ?? 0) > 0) T.done.add('lantern');
      else if (s.flames > 0) take('lantern', p.x, p.y);
      break;
    case 'harpooner': {
      if ((s.yanks ?? 0) > 0) { T.done.add('hook'); break; }
      const E = world.enemies;
      for (let i = 0; i < E.count; i++) if ((E.flags[i] & EF.ELITE) !== 0 && (E.flags[i] & (EF.BOSS | EF_GONE)) === 0 && onScreen(cam, E.x[i], E.y[i], 24)) { take('hook', E.x[i], E.y[i]); break; }
      break;
    }
    case 'punter':
      if (s.wet === 1) T.done.add('water');
      else if (s.cacheOn === 1 && onScreen(cam, s.cacheX, s.cacheY, 24)) take('water', s.cacheX, s.cacheY);
      break;
    case 'bog_warden':
      if ((s.calls ?? 0) > 0) { T.done.add('fresh_dead'); break; }
      for (let k = 0; k < 12; k++) if (s[`c${k}t`] >= 0 && world.tick - s[`c${k}t`] < 60 && onScreen(cam, s[`c${k}x`], s[`c${k}y`], 24)) { take('fresh_dead', s[`c${k}x`], s[`c${k}y`]); break; }
      break;
    case 'drowned_man':
      if ((s.crates ?? 0) > 0) T.done.add('crate_mark');
      else if (s.markOn === 1 && onScreen(cam, s.markX, s.markY, 24)) take('crate_mark', s.markX, s.markY);
      break;
    case 'tide_priest':
      if ((s.calls ?? 0) > 0) T.done.add('tide_call');
      else if (s.tideEvery > 0) { const left = (s.tideEvery * 0.5) - (s.tideT % (s.tideEvery * 0.5)); if (left <= 5) take('tide_call', p.x, p.y); }
      break;
    default: break;
  }
}

/** A tip's thing was used (a chest opened, a relic taken): it goes. Event-driven, once a frame. */
export function tipsSeeEvents(T, events) {
  for (let i = 0; i < events.count; i++) {
    const t = events.type[i];
    if (t === EV.CHEST) T.done.add('chest');
    else if (t === EV.RELIC) { T.done.add('reliquary'); T.done.add('vault'); }
    else if (t === EV.PICKUP && events.a[i] === PK.EMBER) T.done.add('ember');
    else if (t === EV.FERRY && events.a[i] === 2) T.done.add('ferry');
  }
}

// ---------------------------------------------------------------- first sightings, one line

/**
 * First sightings waiting for their thing to be on screen. add(key, world) for each FIRST_SIGHT
 * ('enemy:<id>' or a thing's name); ready(world, cam) returns the lines whose enemy is now on
 * screen (a thing's line at once: the sim names a thing when you're at it), one line each.
 */
export function createSightings() {
  const waiting = [];   // { key, type, since }
  return {
    add(key, world, type = -1) { if (key && !waiting.some((w) => w.key === key)) waiting.push({ key, type, since: world.tick }); },
    ready(world, cam) {
      const out = [];
      for (let k = waiting.length - 1; k >= 0; k--) {
        const w = waiting[k];
        let show = w.type < 0;
        if (!show) show = enemyOnScreen(world, w.type, cam);
        if (show) { const line = sightingLine(world.data, w.key, world); if (line) out.unshift(line); waiting.splice(k, 1); } else if (world.tick - w.since > SIGHT_WAIT_SEC * 60) waiting.splice(k, 1);
      }
      return out;
    },
    get count() { return waiting.length; },
  };
}

/** Is an enemy of type index `type` alive on screen? */
export function enemyOnScreen(world, type, cam) {
  const E = world.enemies;
  if (!E) return true;
  for (let i = 0; i < E.count; i++) if (E.type[i] === type && onScreen(cam, E.x[i], E.y[i], 8)) return true;
  return false;
}

/** "First sighting: Mire Toad. Hops, landing in a warned ring." (one line); null for a name this build can't read. */
export function sightingLine(data, key, world = null) {
  const g = guideEntry(data, key);
  if (!g) return null;
  // (Round 3, L3 1: the Lamplighter lights lamps at a touch, and they refill her Fuel; she gets her own line.)
  if (g.term === 'lamp' && world?.trade?.id === 'lamps' && world.trade.P?.touch) return `First sighting: ${g.name}. Walk to it to light it. It stays lit, refills your Fuel, and its light burns enemies.`;
  const line = (g.line || '').trim();
  return line ? `First sighting: ${g.name}. ${line.charAt(0).toUpperCase()}${line.slice(1)}` : `First sighting: ${g.name}`;
}

/** A FIRST_SIGHT's key ('enemy:<id>' or a thing's name) and its enemy type (-1 for a thing). */
export function sightKey(world, events, i) {
  if (events.a[i] === 1) { const d = world.enemyDefs[events.b[i]]; return d ? { key: `enemy:${d.id}`, type: events.b[i] } : null; }
  const n = SIGHT_NAMES[events.a[i]];
  return n ? { key: n, type: -1 } : null;
}

// ---------------------------------------------------------------- the death recap

/** PLAYER_HURT's source kinds (W3's HURT in sim/events.js; c on the event). */
export const HURT_KIND = Object.freeze({ CONTACT: 1, SHOT: 2, BOSS: 3, STRIKE: 4, DRAIN: 5, HAZARD: 6, ATTACK: 7 });
/** The window the recap counts (seconds before the end). */
export const RECAP_SEC = 5;

/**
 * The hurts the run scene saw, kept for the recap (a ring of the last 32): add() each PLAYER_HURT
 * as the frame reads it (its tick, damage, source kind and enemy type when the sim gives them, and
 * the attack's name from world.lastHurt), naming a hurt the sim didn't name by the enemy standing
 * where it came from (a touch passes the toucher's place).
 */
export function createHurtLog(cap = 32) {
  const list = [];
  return {
    add(world, events, i) {
      let kind = events.c[i] | 0, type = Number.isFinite(events.d[i]) && kind > 0 ? events.d[i] | 0 : -1;
      let name = null;
      const L = world.lastHurt;
      if (L && L.tick === world.tick && (kind === HURT_KIND.BOSS || kind === HURT_KIND.ATTACK)) name = L.name ?? null;
      if (kind === 0) {
        // No source from the sim: the enemy at the hurt's place (a touch), else the nearest one.
        const g = nearestEnemy(world, events.x[i], events.y[i]);
        if (g) { type = g.type; kind = g.d2 < 1 ? HURT_KIND.CONTACT : 0; }
      }
      list.push({ tick: world.tick, damage: events.a[i], kind, type, name });
      if (list.length > cap) list.shift();
    },
    list: () => list.slice(),
    clear() { list.length = 0; },
  };
}

function nearestEnemy(world, x, y) {
  const E = world.enemies;
  if (!E) return null;
  let best = -1, bd = 48 * 48;
  for (let i = 0; i < E.count; i++) {
    const dx = E.x[i] - x, dy = E.y[i] - y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = i; }
  }
  return best < 0 ? null : { type: E.type[best], d2: bd };
}

/** "The Harbor Maw" in a sentence: "the Harbor Maw". */
const mid = (n) => (typeof n === 'string' && n.startsWith('The ') ? `the ${n.slice(4)}` : n);
/** "a Drowned Sailor", "an Eel" (an ordinary enemy in a sentence). */
const aName = (n) => `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`;

/**
 * A hurt's source in words: { who, how } ("the Tidecaller", "tide line"; "Drowned Sailor", "touch").
 * `defs`: world.enemyDefs.
 */
export function hurtSource(defs, h) {
  const def = h.type >= 0 ? defs[h.type] : null;
  const boss = !!def && (def.tags?.includes('boss') || /^The /.test(def.name));
  const who = def ? def.name : null;
  switch (h.kind) {
    case HURT_KIND.CONTACT: return { who, how: 'touch', boss };
    case HURT_KIND.SHOT: return { who, how: 'shot', boss };
    case HURT_KIND.BOSS: return { who, how: h.name || 'attack', boss: true };
    case HURT_KIND.ATTACK: return { who, how: h.name || 'attack', boss };
    case HURT_KIND.STRIKE: return { who: null, how: 'lightning', boss: false, what: 'the storm\'s lightning' };
    case HURT_KIND.DRAIN: return { who, how: 'drain', boss };
    case HURT_KIND.HAZARD: return { who, how: 'pool', boss, what: who ? null : 'burning ground' };
    default: return { who, how: who ? 'touch' : null, boss };
  }
}

/** A source as the recap's heading says it: "the Tidecaller's tide line", "a Drowned Sailor", "the storm's lightning". */
export function killerText(defs, h) {
  const s = hurtSource(defs, h);
  if (s.what) return s.what;
  if (!s.who) return 'something you didn\'t see';
  if (s.how === 'touch') return s.boss ? mid(s.who) : aName(s.who);
  return `${s.boss ? mid(s.who) : aName(s.who)}'s ${s.how}`;
}

/**
 * The death recap: { killer: "the Tidecaller's tide line", lines: ["Tidecaller, tide line: 2 hits, 84 damage", ...] }
 * (the last RECAP_SEC before `endTick`, biggest first), or null with nothing logged. `hurts`: the
 * sim's hurt log (W3: hurtLogList(world)) or the scene's (createHurtLog().list()).
 */
export function deathRecap(defs, hurts, endTick) {
  if (!hurts?.length) return null;
  const last = hurts[hurts.length - 1];
  const from = endTick - RECAP_SEC * 60;
  const groups = new Map();
  for (const h of hurts) {
    if (h.tick < from) continue;
    const s = hurtSource(defs, h);
    const label = s.what ? s.what.charAt(0).toUpperCase() + s.what.slice(1) : s.who ? `${s.who.replace(/^The /, '')}${s.how ? `, ${s.how}` : ''}` : 'Unseen';
    const g = groups.get(label) ?? { label, hits: 0, damage: 0 };
    g.hits++; g.damage += Number(h.damage) || 0;
    groups.set(label, g);
  }
  const lines = [...groups.values()].sort((a, b) => b.damage - a.damage)
    .map((g) => `${g.label}: ${g.hits} ${g.hits === 1 ? 'hit' : 'hits'}, ${Math.round(g.damage).toLocaleString('en-US')} damage`);
  return { killer: killerText(defs, last), lines };
}
