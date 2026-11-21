// The run in three acts (0.9.0, W4; the lead's ruling 6; ARCHITECTURE §5.20; work/veteran/W4-NOTES.md).
//
//   Act 1  from 0:00 to the first boss's arrival
//   Act 2  from the first boss's arrival to the end of the run
//   Act 3  overtime, from Stay to the dawn (or your death)
//
// Lamps stay lit: the fog no longer takes them back. Instead each act brings its own lamps and
// Fog Bells at sites drawn for this run from the map's `sites` (spread over its `places`, never
// one used before this run), appended to world.tasks. An act's lamps are out from its start; its
// bells wake one at a time (`bellAt`, seconds into the act), each at a site away from you, so an
// act has a fight to choose every few minutes. No countdown on any task: a task waits for you.
// An act may bring twists (`twists`: how many of the map's): a held lamp (slower to light; the
// fog sends small crowds at it while you light it; it pays a chest), or a bell whose crew an elite
// leads. Each map's own task (the Docks' cranes, the Marsh's salt cairns) re-arms every act.
//
// Each act also draws events from the map's deck (`deck`: set pieces, caches, trails, risings;
// only the entries the profile has opened: RunConfig.mapEvents), placed in the act's `span`
// and fired by the director (sim/director.js) as timeline events.
//
// Small finds (a map's `secrets` with a `gift`): hidden at the map's edges; walking onto one
// gives its gift once a run. One with `from: 2` is there from Act 2.
//
// Overtime's shape (sim/director.js): elite pairs each minute, the first boss back at 5:00, and at
// 10:00 the Long Night: both bosses at once. Kill them all and dawn breaks: everything left
// crumbles, the spoils come to you, a dawn chest opens, and the run ends cleared (result.dawn).
//
// Randomness: the run's own stream 'acts' (a fork of the root: no other stream moves). Every pick
// is made when its act begins or its bell wakes, on the sim's tick, so replays stay exact.

import { TPS, TASK, TASK_STATE, PK, PF, EF, ZONE, HOSTILE, LEECH, BELL_CREW_MAX } from './constants.js';
import { EV, TWIST, FIND_GIFT, END, STRIKE_SRC } from './events.js';
import { TILE } from './terrain.js';
import { snapOpen } from './places.js';
import { addGlass, runMinute } from './relics.js';
import { spawnPickup, collectPickup } from './pickups.js';
import { openChest, CHEST_BOSS, CHEST_SECRET } from './chests.js';
import { crowdPoint } from './holds.js';
import { strikeAt } from './storm.js';
import { endRun } from './run-result.js';
import { spawnCrowd, spawnBoss } from './director.js';
import { fnv1a } from '../lib/hash.js';
import { floodsEver } from './marsh.js';

const KIND_BY_NAME = Object.freeze({ held: TWIST.HELD, elite_crew: TWIST.ELITE_CREW });
const GIFT_BY_NAME = Object.freeze({ pearls: FIND_GIFT.PEARLS, ember: FIND_GIFT.EMBER, item: FIND_GIFT.ITEM, materials: FIND_GIFT.MATERIALS, heal: FIND_GIFT.HEAL });
/** The finale's state (acts.finale.state). */
export const FINALE = Object.freeze({ NONE: 0, NIGHT: 1, DAWN: 2, OVER: 3 });

// ---------------------------------------------------------------- checks

/** A map's act data, checked: a plain message for the first thing wrong, or null. */
export function checkActs(map, deckEvent) {
  const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger);
  const at = (what) => `${what} of map ${map.id}`;
  if (map.acts === undefined) return null;
  if (!Array.isArray(map.acts) || map.acts.length !== 3) return `${at('acts')} must be a list of 3`;
  const S = map.sites;
  if (!S || !Array.isArray(S.lamp) || !Array.isArray(S.bell) || !S.lamp.every(pair) || !S.bell.every(pair)) return `${at('sites')} need lamp and bell lists of [col, row]`;
  if (S.cache !== undefined && !(Array.isArray(S.cache) && S.cache.every(pair))) return `${at('sites.cache')} must be a list of [col, row]`;
  let lamps = 0, bells = 0;
  for (const [k, a] of map.acts.entries()) {
    const here = `act ${k + 1} of map ${map.id}`;
    if (!(Number.isInteger(a.lamps) && a.lamps >= 0 && Number.isInteger(a.bells) && a.bells >= 0)) return `${here}: lamps and bells are whole numbers`;
    if (!(Array.isArray(a.bellAt) && a.bellAt.length === a.bells && a.bellAt.every((s) => s >= 0))) return `${here}: bellAt gives a second for each bell`;
    if (!(Number.isInteger(a.twists) && a.twists >= 0 && a.twists <= (map.twists || []).length)) return `${here}: twists is a whole number, at most the map's twists`;
    if (!(Number.isInteger(a.deck) && a.deck >= 0)) return `${here}: deck is a whole number of events`;
    if (!(Array.isArray(a.span) && a.span.length === 2 && a.span[1] > a.span[0] && a.span[0] >= 0)) return `${here}: span is [from, to] seconds`;
    lamps += a.lamps; bells += a.bells;
  }
  if (lamps > S.lamp.length || bells > S.bell.length) return `${at('sites')}: the acts need ${lamps} lamp and ${bells} bell sites`;
  for (const t of map.twists || []) if (KIND_BY_NAME[t] === undefined) return `${at('twists')}: unknown twist "${t}" (${Object.keys(KIND_BY_NAME).join(', ')})`;
  const ids = new Set();
  for (const e of map.deck || []) {
    if (typeof e.id !== 'string' || !/^[a-z0-9_]+$/.test(e.id) || ids.has(e.id)) return `${at('deck')}: each entry needs its own snake_case id`;
    ids.add(e.id);
    if (typeof e.name !== 'string' || !e.name) return `deck entry ${e.id} of map ${map.id}: needs a name`;
    if (!(Array.isArray(e.acts) && e.acts.length && e.acts.every((n) => n === 1 || n === 2 || n === 3))) return `deck entry ${e.id}: acts is a list of 1, 2, 3`;
    if (!(Array.isArray(e.events) && e.events.length)) return `deck entry ${e.id}: needs its events`;
    for (const ev of e.events) {
      if (ev.after !== undefined && !(ev.after >= 0)) return `deck entry ${e.id}: after is seconds, 0 or more`;
      const bad = deckEvent(ev, map);
      if (bad) return `deck entry ${e.id}: ${bad}`;
    }
  }
  for (const k of ['cranes', 'cairns']) if (map[k] !== undefined && !(Array.isArray(map[k]) && map[k].every(pair))) return `${at(k)} must be a list of [col, row]`;
  for (const s of map.secrets || []) {
    if (s.gift === undefined) continue;
    if (GIFT_BY_NAME[s.gift.kind] === undefined) return `secret ${s.id} of map ${map.id}: its gift's kind must be ${Object.keys(GIFT_BY_NAME).join(', ')}`;
    if ((s.gift.kind === 'pearls' || s.gift.kind === 'materials' || s.gift.kind === 'heal') && !(Number.isInteger(s.gift.amount) && s.gift.amount > 0)) return `secret ${s.id}: its gift needs a whole amount`;
    if (s.from !== undefined && !(s.from === 1 || s.from === 2 || s.from === 3)) return `secret ${s.id}: from is act 1, 2, or 3`;
    if (s.relic !== undefined) return `secret ${s.id}: a find gives its gift, not a relic`;
  }
  return null;
}

// ---------------------------------------------------------------- the run's acts

/** A task record (sim/tasks.js keeps the shape). */
export function makeTask(world, kind, tx, ty, act, place, twist) {
  const [x, y] = snapOpen(world, tx, ty);
  const crew = kind === TASK.BELL || twist === TWIST.HELD;
  return {
    kind, x, y, state: TASK_STATE.IDLE, progress: 0, need: 0, glass: 0, touch: 0,
    crewN: 0, crewX: crew ? new Float32Array(BELL_CREW_MAX) : null, crewY: crew ? new Float32Array(BELL_CREW_MAX) : null, crewTick: -1,
    outTick: -1, act, place, twist: twist | 0, wave: 0, uses: 0, next: 0,
  };
}

/** The place (index into map.places) nearest tile (tx, ty), or -1. */
export function placeAt(map, tx, ty) {
  let best = -1, bestD = Infinity;
  (map.places || []).forEach((p, i) => {
    const dx = p.at[0] - tx, dy = p.at[1] - ty, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/**
 * The run's acts on a world (sim/tasks.js createTasks calls it, after the map's fixed tasks if it
 * has any). A map without `acts` (test maps) stays in act 1 with its fixed tasks.
 */
export function createActs(world) {
  const map = world.map;
  const rng = world.rng.root.fork('acts');
  world.rng.acts = rng;
  const scale = world.director.timeScale;
  // The deck entries this run may draw: RunConfig.mapEvents (the profile's), or every entry.
  const open = world.config.mapEvents;
  if (open !== undefined && !(Array.isArray(open) && open.every((id) => typeof id === 'string'))) throw new Error('RunConfig: mapEvents must be a list of deck ids');
  const deck = (map.deck || []).map((e, i) => ({ e, i })).filter(({ e }) => open === undefined || open.includes(e.id));
  const A = {
    on: Array.isArray(map.acts), act: 1, scale, rng,
    usedLamp: new Uint8Array(map.sites?.lamp?.length ?? 0), usedBell: new Uint8Array(map.sites?.bell?.length ?? 0), usedCache: new Uint8Array(map.sites?.cache?.length ?? 0),
    bells: [],          // { tick, act, twist } bells still to wake
    deck, deckUsed: new Uint8Array((map.deck || []).length),
    caches: [],         // { x, y, guard, armed, deck, act }: a cache's guard waiting for you to come near
    held: [],           // task indices of held lamps
    finale: { state: FINALE.NONE, bosses: [], pending: [], dawnTick: -1, endTick: -1 },
    seen: new Set(),    // deck ids fired this run (the result's mapEvents)
  };
  world.acts = A;
  // Finds: the map's secrets with a gift (sim/pickups.js opens them through openFind).
  const defs = new Map((map.secrets || []).map((s) => [s.id, s]));
  for (const s of world.secrets) {
    const d = defs.get(s.id);
    s.name = d?.name ?? s.id;
    s.gift = d?.gift ?? null;
    s.from = d?.from ?? 1;
  }
  // The map's own task: its cranes or cairns, armed from 0:00 and again every act.
  for (const [k, kind] of [['cranes', TASK.CRANE], ['cairns', TASK.CAIRN]]) {
    for (const [tx, ty] of map[k] || []) world.tasks.push(makeTask(world, kind, tx, ty, 1, placeAt(map, tx, ty), 0));
  }
  if (A.on) beginAct(world, 1, true);
  return A;
}

/** Is the find (world.secrets[i]) out on the map yet? */
export function findOut(world, s) { return !s.gift || (world.acts?.act ?? 1) >= (s.from ?? 1); }

/**
 * Draw n sites of a kind for an act: each unused this run, at least `apart` tiles from the others
 * drawn now and `away` tiles from you, one place at a time while places are left. Returns
 * [{ tx, ty, place, site }]. Act 3 on a marsh keeps to ground overtime's flood never takes, and
 * that rule is never relaxed (X4: with dry sites short it fell back to drowned ones; fewer tasks
 * beat tasks under water). So acts 1 and 2 leave act 3 the dry sites it will need (`keep`: how
 * many of this kind act 3 asks for) while they have others to take.
 */
function drawSites(world, list, used, n, away, apart, keep = 0) {
  const A = world.acts, rng = A.rng, map = world.map, p = world.player;
  const ptx = p.x / TILE, pty = p.y / TILE;
  const marsh = world.marsh !== null;
  const keepDry = A.act === 3 && marsh;
  // Dry sites still unused (acts 1 and 2 on a marsh: they take one only while more than `keep` are left).
  let dryLeft = 0;
  if (marsh && A.act < 3 && keep > 0) for (let i = 0; i < list.length; i++) if (!used[i] && !floods(world, list[i][0], list[i][1])) dryLeft++;
  const order = [];
  for (let i = 0; i < list.length; i++) if (!used[i]) order.push(i);
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); const v = order[i]; order[i] = order[j]; order[j] = v; }
  const out = [], places = new Set();
  for (const pass of [0, 1, 2]) {
    for (const i of order) {
      if (out.length >= n) break;
      if (used[i]) continue;
      const [tx, ty] = list[i];
      const dp = (tx - ptx) * (tx - ptx) + (ty - pty) * (ty - pty);
      if (pass < 2 && dp < away * away) continue;
      if (pass < 1 && out.some((o) => (o.tx - tx) * (o.tx - tx) + (o.ty - ty) * (o.ty - ty) < apart * apart)) continue;
      const place = placeAt(map, tx, ty);
      if (pass < 1 && place >= 0 && places.has(place)) continue;
      if (keepDry && floods(world, tx, ty)) continue;
      if (dryLeft > 0 && !floods(world, tx, ty)) {
        if (pass < 2 && dryLeft <= keep) continue;   // act 3's
        dryLeft--;
      }
      used[i] = 1; places.add(place);
      out.push({ tx, ty, place, site: i });
    }
  }
  return out;
}

/**
 * Would overtime's flood ever take the open tile nearest (tx, ty)? (the Marsh; sim/marsh.js
 * floodsEver: the flood stops where its keepDry share of the ground is left, so the flats above
 * that level stay dry as the peat does.)
 */
function floods(world, tx, ty) {
  const T = world.terrain, o = world.scratch.open;
  if (!T.nearestOpen(tx, ty, o)) return true;
  return floodsEver(world, Math.floor(o[1] / TILE) * T.cols + Math.floor(o[0] / TILE));
}

/** An act begins: its lamps (and twists), its bells' clock, its deck, and the map's own tasks again. */
export function beginAct(world, act, first = false) {
  const A = world.acts, map = world.map;
  if (!A.on || (!first && act <= A.act)) return;
  A.act = act;
  if (act > world.result.act) world.result.act = act;
  const a = map.acts[act - 1], S = map.sites, T = world.tuning.tasks.acts;
  // Twists: drawn from the map's, at most one of each.
  const tw = (map.twists || []).slice();
  const twists = [];
  for (let k = 0; k < a.twists && tw.length; k++) twists.push(KIND_BY_NAME[tw.splice(A.rng.int(tw.length), 1)[0]]);
  let twistBits = 0;
  for (const t of twists) twistBits |= t;
  // The lamps, at sites away from you, spread over the places; a held lamp is the first drawn.
  const lamps = drawSites(world, S.lamp, A.usedLamp, a.lamps, T.lampAway, T.apart, map.acts[2].lamps);
  lamps.forEach((s, k) => {
    const held = k === 0 && twists.includes(TWIST.HELD) ? TWIST.HELD : 0;
    world.tasks.push(makeTask(world, TASK.LAMP, s.tx, s.ty, act, s.place, held));
    if (held) A.held.push(world.tasks.length - 1);
  });
  // The bells wake through the act (the first may wake at once); an elite leads one crew.
  const start = act === 3 ? world.director.overtimeStartTick : world.tick;
  const eliteAt = twists.includes(TWIST.ELITE_CREW) ? A.rng.int(Math.max(1, a.bells)) : -1;
  a.bellAt.forEach((sec, k) => A.bells.push({ tick: start + Math.round(sec * A.scale * TPS), act, twist: k === eliteAt ? TWIST.ELITE_CREW : 0 }));
  // The map's own tasks are ready again. One still at work (a crane with loads to drop, a cairn
  // whose storm isn't over) finishes first and is ready then (workStep; X4: re-armed mid-work it
  // dropped the loads it had left).
  for (let i = 0; i < world.tasks.length; i++) {
    const t = world.tasks[i];
    if ((t.kind === TASK.CRANE || t.kind === TASK.CAIRN) && t.state === TASK_STATE.DONE && t.wave >= t.need) rearm(world, t, i, act);
  }
  drawDeck(world, act, a, start);
  world.events.push(EV.ACT, world.player.x, world.player.y, act, twistBits, lamps.length, a.bells);
  bellsWake(world);
}

/** The act's events from the deck, in its window, as timeline events (sim/director.js fires them). */
function drawDeck(world, act, a, start) {
  const A = world.acts, rng = A.rng, D = world.director;
  let pool = A.deck.filter(({ e, i }) => e.acts.includes(act) && !A.deckUsed[i]);
  if (pool.length < a.deck) pool = A.deck.filter(({ e }) => e.acts.includes(act));   // a small deck repeats before it runs dry
  const n = Math.min(a.deck, pool.length);
  const t0 = act === 3 ? start / TPS : 0;
  const from = a.span[0] * A.scale, to = a.span[1] * A.scale, slice = (to - from) / Math.max(1, n);
  for (let k = 0; k < n; k++) {
    const j = rng.int(pool.length);
    const { e, i } = pool.splice(j, 1)[0];
    A.deckUsed[i] = 1;
    const at = t0 + from + slice * k + rng.next() * slice * 0.6;
    e.events.forEach((ev, q) => insertEvent(D, { ...ev, at: at + (ev.after ?? 0) * A.scale, index: -100 - i, deck: i, act, first: q === 0 }));
  }
}

/** Put an event into the director's list after the ones already fired, in time order. */
function insertEvent(D, ev) {
  let k = D.events.length;
  while (k > D.eventIdx && D.events[k - 1].at > ev.at) k--;
  D.events.splice(k, 0, ev);
  if (D.lastBossEvent >= k) D.lastBossEvent++;   // the last boss's index (sim/relics.js reads it) stays on it
}

/** Bells whose time has come wake at a site away from you. */
function bellsWake(world) {
  const A = world.acts, S = world.map.sites, T = world.tuning.tasks.acts;
  for (let k = 0; k < A.bells.length; k++) {
    const b = A.bells[k];
    if (world.tick < b.tick) continue;
    A.bells.splice(k--, 1);
    const [s] = drawSites(world, S.bell, A.usedBell, 1, T.bellAway, 0, world.map.acts[2].bells);
    if (!s) continue;
    world.tasks.push(makeTask(world, TASK.BELL, s.tx, s.ty, b.act, s.place, b.twist));
    const i = world.tasks.length - 1, t = world.tasks[i];
    world.events.push(EV.ARM, t.x, t.y, TASK.BELL, i, b.act, s.place);
  }
}

/** The first boss arrives (sim/tasks.js crowdArrives): act 2 begins. */
export function actsOnBoss(world) {
  const A = world.acts;
  if (A && A.on && A.act === 1) beginAct(world, 2);
}

/** You stay for overtime (sim/director.js overtimeDecide): act 3 begins. */
export function actsOnOvertime(world) {
  const A = world.acts;
  if (A && A.on && A.act < 3) beginAct(world, 3);
}

// ---------------------------------------------------------------- each tick

/** Each tick (sim/tasks.js tasksStep): bells waking, caches' guards, the held lamps' fog, the finale. */
export function actsStep(world) {
  const A = world.acts;
  if (A === null || A === undefined) return;
  if (A.bells.length) bellsWake(world);
  if (A.caches.length && world.tick % 6 === 0) cachesStep(world, A);
  finaleStep(world, A);
}

/** A cache's guard rises when you come near (out past the view's edge, so it rises unseen). */
function cachesStep(world, A) {
  const p = world.player, T = world.tuning.tasks.acts;
  for (const c of A.caches) {
    if (!c.armed) continue;
    const dx = c.x - p.x, dy = c.y - p.y;
    if (dx * dx + dy * dy > T.guardWake * T.guardWake) continue;
    c.armed = false;
    const g = c.guard;
    if (!g) continue;
    spawnCrowd(world, g.enemy, g.count, c.x, c.y, T.guardRadius, g.elite ?? null);
    world.events.push(EV.MAP_EVENT, c.x, c.y, 2, c.deck, c.act);
  }
}

/** A deck event begins (the director, its first event): the result notes it. */
export function deckFired(world, ev, x, y) {
  const A = world.acts, e = world.map.deck?.[ev.deck];
  if (!A || !e) return;
  if (ev.first) {
    if (!A.seen.has(e.id)) { A.seen.add(e.id); world.result.mapEvents.push(e.id); }
    world.events.push(EV.MAP_EVENT, x, y, 1, ev.deck, ev.act);
  }
}

/** A cache or a trail's end: a chest at a site away from you, its guard waiting. Returns [x, y]. */
export function placeCache(world, ev) {
  const A = world.acts, T = world.tuning.tasks.acts, list = world.map.sites?.cache || [];
  let at = null;
  const s = drawSites(world, list, A.usedCache, 1, T.cacheAway, 0)[0];
  if (s) at = snapOpen(world, s.tx, s.ty);
  else {
    // No site left: a spot far from you in the open.
    const p = world.player, o = world.scratch.open;
    const tx = Math.floor((p.x + (p.x < world.terrain.width / 2 ? 1 : -1) * T.cacheAway * TILE) / TILE);
    at = world.terrain.nearestOpen(tx, Math.floor(p.y / TILE), o) ? [o[0], o[1]] : [p.x, p.y];
  }
  const chest = Array.isArray(ev.chest) ? ev.chest[Math.min(ev.chest.length, ev.act ?? 1) - 1] : ev.chest;
  spawnPickup(world, PK.CHEST, at[0], at[1], chest === 'boss' ? CHEST_BOSS : 1, 0);
  if (ev.pearls) {
    if (world.pearlsOn) spawnPickup(world, PK.GLASS, at[0] + 10, at[1], ev.pearls, 0);
    else { const mi = world.materialIndex.get('coin'); if (mi !== undefined) spawnPickup(world, PK.MATERIAL, at[0] + 10, at[1], mi, ev.pearls); }
  }
  A.caches.push({ x: at[0], y: at[1], guard: ev.guard ?? null, armed: true, deck: ev.deck ?? -1, act: ev.act ?? A.act });
  return at;
}

// ---------------------------------------------------------------- the map's own tasks

/**
 * A crane swings (the Docks): `loads` loads, one every `gap` s, each on the thickest crowd within
 * `reach` of it, a warned ring (a strike that never hurts you: a DIM tell). A cairn calls the
 * storm (the Marsh): for `sec` s, every `every` s, `burst` strikes on the thickest crowds within
 * its reach (they never hurt you either).
 */
export function workDone(world, t) {
  const C = t.kind === TASK.CRANE ? world.tuning.tasks.crane : world.tuning.tasks.cairn;
  t.wave = 0;
  t.progress = 0;
  t.crewTick = world.tick;          // the next load or burst falls now
  t.need = t.kind === TASK.CRANE ? C.loads : Math.max(1, Math.round(C.sec / C.every));
  t.uses++;
  if (world.acts) t.act = world.acts.act;   // the act it works in (it is ready again in the next: workStep)
  world.result.works++;
}

/** A crane or a cairn that has done its work is ready again for act `act`. */
function rearm(world, t, i, act) {
  t.state = TASK_STATE.IDLE; t.touch = 0; t.progress = 0; t.act = act;
  world.events.push(EV.ARM, t.x, t.y, t.kind, i, act, t.place);
}

/**
 * A crane's loads or a cairn's storm, while they last (sim/tasks.js, each tick; i its task index).
 * Its work done in an act that has since given way to the next, it is ready again now.
 */
export function workStep(world, t, i) {
  if (t.wave >= t.need) {
    const A = world.acts;
    if (A && A.on && t.act < A.act && world.tick >= t.crewTick) rearm(world, t, i, A.act);
    return;
  }
  if (world.tick < t.crewTick) return;
  const crane = t.kind === TASK.CRANE;
  const C = crane ? world.tuning.tasks.crane : world.tuning.tasks.cairn;
  t.crewTick = world.tick + Math.max(1, Math.round((crane ? C.gap : C.every) * TPS));
  t.wave++;
  const reach2 = C.reach * C.reach, tx = t.x, ty = t.y, E = world.enemies;
  const near = (w, e) => { const dx = E.x[e] - tx, dy = E.y[e] - ty; return dx * dx + dy * dy <= reach2; };
  const out = world.scratch.v2, picks = workPicks;
  const n = crane ? 1 : C.burst;
  const dmg = C.damage * world.tuning.pace.hp * (1 + world.tuning.director.hpPerMinute * runMinute(world));
  let made = 0;
  for (let k = 0; k < n; k++) {
    if (crowdPoint(world, out, C.radius, 24, picks, made, C.radius * 2, near) < 0) break;
    picks[2 * made] = out[0]; picks[2 * made + 1] = out[1]; made++;
    strikeAt(world, out[0], out[1], C.radius, C.warn + k * 0.15, dmg, 0, crane ? STRIKE_SRC.CRANE : STRIKE_SRC.CAIRN, 0);
  }
}
const workPicks = new Float64Array(16);

// ---------------------------------------------------------------- finds

/** Walking onto a find (sim/pickups.js): its gift, once a run. */
export function openFind(world, i) {
  const s = world.secrets[i];
  if (s.open) return;
  s.open = true;
  const g = s.gift;
  let kind = GIFT_BY_NAME[g.kind];
  world.result.secrets.push(s.id);
  world.result.finds.push(s.id);
  let amount = g.amount ?? 1;
  // Food is nothing to a character who can't heal (RunConfig.noHeal, the Tide Priest): a find that
  // holds some pays her as a Pearls find does, a third of what it would have healed.
  if (kind === FIND_GIFT.HEAL && world.config.noHeal) { kind = FIND_GIFT.PEARLS; amount = Math.max(1, Math.round(amount / 3)); }
  switch (kind) {
    case FIND_GIFT.PEARLS:
      if (world.pearlsOn) addGlass(world, amount, s.x, s.y);
      else { const mi = world.materialIndex.get('coin'); if (mi !== undefined) spawnPickup(world, PK.MATERIAL, s.x, s.y, mi, amount); }
      break;
    case FIND_GIFT.EMBER: spawnPickup(world, PK.EMBER, s.x, s.y, 0, 0); break;
    case FIND_GIFT.MATERIALS: { const mi = world.materialIndex.get(g.material); if (mi !== undefined) spawnPickup(world, PK.MATERIAL, s.x, s.y, mi, amount); break; }
    case FIND_GIFT.HEAL: spawnPickup(world, PK.HEAL, s.x, s.y, amount, 0); break;
    default: amount = 1; openChest(world, CHEST_SECRET, s.x, s.y); break;
  }
  world.events.push(EV.FIND, s.x, s.y, kind, amount, i);
}

// ---------------------------------------------------------------- the Long Night and the dawn

/** The Long Night falls (the director's overtime 'long_night'): its bosses, the first now, the rest `gap` s apart. */
export function longNight(world, ev) {
  const F = world.acts.finale;
  if (F.state !== FINALE.NONE) return;
  F.state = FINALE.NIGHT;
  F.hpMul = ev.hpMul ?? 1;
  ev.enemies.forEach((id, k) => F.pending.push({ tick: world.tick + Math.round(k * (ev.gap ?? 0) * TPS), enemy: id }));
  world.result.longNight = true;
  world.events.push(EV.FINALE, world.player.x, world.player.y, 1, ev.enemies.length);
}

function finaleStep(world, A) {
  const F = A.finale;
  // (A run that ended this tick stays ended: a death on the tick the last boss fell is a death, not a dawn.)
  if (F.state === FINALE.NONE || F.state === FINALE.OVER || world.over) return;
  if (F.state === FINALE.NIGHT) {
    for (let k = 0; k < F.pending.length; k++) {
      if (world.tick < F.pending[k].tick) continue;
      const b = spawnBoss(world, F.pending[k].enemy, F.hpMul);
      F.pending.splice(k--, 1);
      if (b) F.bosses.push(b);
    }
    if (F.pending.length === 0 && F.bosses.length && F.bosses.every((b) => !b.alive)) dawn(world, F);
    return;
  }
  if (F.state === FINALE.DAWN && world.tick >= F.endTick) {
    F.state = FINALE.OVER;
    endRun(world, END.CLEARED);
  }
}

/**
 * Dawn: spawns stop, everything left alive crumbles (no kills, no loot), the spoils on the
 * ground come to you (chests open, Embers taken), the dawn chest opens, and a few seconds later
 * the run ends, cleared. From the dawn on nothing can hurt you (sim/player.js isInvulnerable reads
 * director.dawn): the Long Night is won when its last boss falls, so `result.dawn` and a death
 * can't both be true.
 */
function dawn(world, F) {
  const T = world.tuning.tasks.acts;
  F.state = FINALE.DAWN;
  world.director.dawn = true;
  world.result.dawn = true;
  crumbleAll(world);
  world.magnetAll = Math.max(world.magnetAll, T.dawnSec + 1);
  const P = world.pickups, p = world.player;
  for (let i = P.count - 1; i >= 0; i--) {
    const k = P.kind[i];
    if (k === PK.CHEST || k === PK.EMBER || k === PK.RELIQUARY || k === PK.VAULT) collectPickup(world, i);
  }
  const before = world.halts.length;
  openChest(world, CHEST_BOSS, p.x, p.y);
  const h = world.halts.slice(before).find((x) => x.kind === 'chest');
  if (h) { h.dawn = true; world.result.dawnItems = h.items.map((it) => ({ ...it })); }
  F.dawnTick = world.tick;
  F.endTick = world.tick + Math.round(T.dawnSec * TPS);
  world.events.push(EV.FINALE, p.x, p.y, 3, T.dawnSec);
}

/**
 * Everything alive crumbles (the dawn; X4: the boss that came back at 5:00, a toad in the air, and
 * a boss mid-leap were left standing, and the first two killed players inside the dawn): every
 * enemy, in the air or not, bosses included (their records closed without a kill: no chest, no
 * Ember, no result entry), every latched leech let go, a lure ended, and every hostile shot, pool,
 * and warned strike that could hurt you gone with them.
 */
function crumbleAll(world) {
  const E = world.enemies, latch = world.enemyLatch;
  for (let i = 0; i < E.count; i++) {
    const f = E.flags[i];
    if ((f & EF.DEAD) !== 0) continue;
    if (latch[E.type[i]] === 1 && E.aiState[i] === LEECH.LATCHED) { E.aiState[i] = LEECH.SWIM; world.latched--; }
    E.flags[i] = f | EF.DEAD | EF.VANISH | EF.RESOLVED;
  }
  for (const b of world.bosses) if (b.alive) { b.alive = false; world.director.bossesAlive--; }
  world.pull.ticks = 0;
  const P = world.projectiles;
  for (let i = 0; i < P.count; i++) if ((P.flags[i] & PF.HOSTILE) !== 0) P.flags[i] |= PF.DEAD;
  const Z = world.zones;
  for (let z = 0; z < Z.count; z++) {
    if (Z.kind[z] === ZONE.HAZARD && Z.slot[z] === HOSTILE) { Z.life[z] = 0; Z.warn[z] = 1e9; }
    else if (Z.kind[z] === ZONE.STRIKE && Z.pdmg[z] > 0 && Z.warn[z] > 0) { Z.life[z] = 0; Z.warn[z] = -1; }
  }
}

/** The finale's bosses alive now (the HUD may read it). */
export function finaleBosses(world) { return world.acts?.finale?.bosses ?? []; }

// ---------------------------------------------------------------- hash

export function hashActs(world, h) {
  const A = world.acts;
  if (!A) return;
  h.int(-30).int(A.act).int(A.bells.length).int(A.caches.length).int(A.finale.state).int(A.finale.endTick).int(A.finale.pending.length).int(A.finale.bosses.length);
  for (const v of A.rng.getState()) h.int(v);
  for (const b of A.bells) h.int(b.tick).int(b.twist);
  for (const c of A.caches) h.float64(c.x).float64(c.y).int(c.armed ? 1 : 0);
  for (const id of A.seen) h.int(fnv1a(id));
  for (const s of world.secrets) h.int(s.open ? 1 : 0);
  const D = world.director;
  h.int(D.dawn ? 1 : 0);
  for (const o of D.otOnce) h.int(o.tick).int(o.fired ? 1 : 0);
}

