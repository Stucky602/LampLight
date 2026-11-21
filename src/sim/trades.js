// Trades (0.9.0, the lead's ruling 2, W2; rebuilt for ruling 14 section D, C2): the one thing each
// character does on the map that nobody else can, the signature weapon each carries
// (data/signatures.js), and the track that weapon grows on.
//
// Every trade fires on its own (ruling 16: never from the dash): from where the character walks
// and faces, what she is near, a meter, or a clock. No trade asks you to stand in a ring: the old
// sites that stay (bog bodies, wreck crews, sunken crates) are used at a touch.
//
//   lamps   (the Lamplighter) a lamp lights the moment she's in its ring. Kills in her light fill
//           spare flames; standing still with one sets a lantern down (the hook:
//           sim/hooks-characters.js). Lighting every lamp banks 2 Lantern Nights.
//   hook    (the Harpooner) every few seconds the trade hook throws itself the way she faces, at
//           the nearest marked thing in a wide cone (else the nearest elite or loot in reach): an
//           elite is yanked to her side, dazed and gaffed; a chest, Reliquary, the vault, or an
//           Ember is reeled in; a mooring post brings the Ferryman. Loot within reach drifts in.
//   pole    (the Punter) water is ground to him: the Marsh's creeks at high water and the Docks'
//           slips. Walkers can't follow. A punt lasts `punt` seconds (X4: water is a crossing, not
//           a home); spent, the water carries him to the nearest bank and is shut to him until the
//           pole is fresh. A punt cache floats out each high water (the Marsh) or act (the Docks).
//           His sweep and his Momentum are his hook's.
//   raise   (the Bog Warden) the fresh dead she walks over rise (the hook); the map's old dead
//           rise at a touch: a bog body on the Marsh, a wreck crew on the Docks, once each a run.
//           The Marsh's secret, the Drowned Causeway, opens only for her.
//   cargo   (the Drowned Man) a full purse marks a sunken crate nearby, and walking to it brings
//           it up (markCrate; the hook); every cache site of the map holds a sunken crate for
//           him, up at a touch.
//           Every second crate is a sea chest: a weapon slot and a weapon to put in it.
//   bells   (the Tide Priest) a Fog Bell rings a second time for her: a bigger crew and a second
//           chest, and each ring brings her flood at once. Her tide's clock is her hook's.
//
// The signature track (ruling 14, item 10): the signature weapon is not in the draft. It takes a
// rolled upgrade from the run's clock (every `clock` seconds) and from the trade (every `per`
// trade deeds: tradeDeed, at most one every `gap` seconds: deeds past that bank), on the run's `trade` stream. Its first two axes open at its 5th and
// 10th upgrade; its capstone axis opens when the character's own deed is done (`deed`: capDeed).
// The calls into the growth core are C1's (work/cw/C1-CONTRACT.md section 8).
//
// The character's hook sets the trade up in its `init` (setupTrade) and runs its tick
// (tradeStep). Its running state is numbers in that hook's `state` (the world hash walks it);
// `world.trade` points at it, with the trade's params and sites. The task, chest, pickup, and
// marsh code asks this module through the small functions below.
// What it touches per tick allocates nothing (ARCHITECTURE §17): sites are made once, the search
// buffer is the trade's own.

import { DT, TPS, EF, EF_GONE, PK, MAX_WEAPON_SLOTS } from './constants.js';
import { TILE, GROUND } from './terrain.js';
import { addWeapon, markStatsDirty } from './build.js';
import * as WU from './weaponups.js';
import * as AS from './ascend.js';
import { ownsWeapon } from './draft.js';
import { snapOpen } from './places.js';
import { openChest, CHEST_ELITE, CHEST_BOSS } from './chests.js';
import { ferryCall } from './relics.js';
import { raiseRisen } from './allies.js';
import { midAttack, MUSTER_CAPTAIN } from './enemies.js';
import { EV, TWIST } from './events.js';

/** What a trade ring is (sim/signs.js draws them as task rings; the view's color by kind). */
export const TRADE_RING = Object.freeze({ POST: 1, BODY: 2, CREW: 3, CRATE: 4, CACHE: 5 });

// ---------------------------------------------------------------- set up

/** Put the character's signature weapon in the first weapon slot (the hook's init: before the first weapon). */
export function giveSignature(world) {
  const id = world.character.signature;
  if (!id) return -1;
  const k = world.weaponIndex.get(id);
  if (k === undefined) throw new Error(`Character ${world.character.id}: no signature weapon "${id}"`);
  return addWeapon(world, world.weaponDefs[k]);
}

/**
 * The character's trade joins the run: world.trade = { id, P, s, sites, near, ... }. `h` is the
 * character hook's entry (its state holds the trade's numbers). Sites are snapped to open ground once.
 */
export function setupTrade(world, h) {
  const c = world.character, T = c.trade;
  if (!T) { world.trade = null; return null; }
  const s = h.state;
  s.sig = giveSignature(world);
  // A secret another character's trade owns isn't there for this one (the Drowned Causeway is the
  // Bog Warden's): it stays shut and says nothing, as a layer that's off.
  if (world.secrets.some((x) => secretShut(world, x))) world.secrets = world.secrets.filter((x) => !secretShut(world, x));
  const tr = { id: T.id, P: T.params || {}, s, sites: [], ring: 0, near: new Int32Array(512), reg: new Float64Array(3), grid: null, kind: 0, host: null, hp: h.params };
  const map = world.map.id;
  if (T.id === 'raise') {
    for (const at of T.sites?.[map] ?? []) { const o = snapOpen(world, at[0], at[1]); tr.sites.push({ x: o[0], y: o[1] }); }
    tr.ring = T.params.ring;
    tr.kind = map === 'salt_marsh' ? TRADE_RING.BODY : TRADE_RING.CREW;
  } else if (T.id === 'cargo') {
    for (const at of world.map.sites?.cache ?? []) { const o = snapOpen(world, at[0], at[1]); tr.sites.push({ x: o[0], y: o[1] }); }
    tr.ring = T.params.ring;
    tr.kind = TRADE_RING.CRATE;
  } else if (T.id === 'pole') {
    tr.grid = poleGrid(world);
    s.cacheOn = 0; s.cacheX = 0; s.cacheY = 0; s.cacheAt = -1;
    // The punt: seconds of pole left, whether the water is carrying him in (and for how many ticks,
    // toward where), and whether the tiring has been said this punt.
    if (world.sk.water_born) tr.P = { ...tr.P, punt: T.params.punt * world.sk.water_born.punt };
    s.punt = tr.P.punt; s.ashore = 0; s.ashoreT = 0; s.ashoreX = 0; s.ashoreY = 0; s.tiredSaid = 0; s.beached = 0;
  }
  s.thrownAt = -1; s.throwAt = 0; s.got = 0; s.gx = 0; s.gy = 0; s.tdx = 0; s.tdy = 0; s.watch = 0;
  s.used = 0; s.used2 = 0; s.fillK = -1; s.fillT = 0; s.uses = 0; s.nightsLeft = 0;
  // The signature's track: upgrades given, the clock's next tick, trade deeds toward the next
  // upgrade, and the capstone's deed (count, and 1 once its axis has been offered).
  s.sigN = 0; s.sigAt = Math.round((T.params.clock ?? 80) * TPS); s.sigUpAt = 0; s.grow = 1; s.pastN = 0; s.sigHave = 0; s.sigNeed = T.params.per ?? 1; s.deed = 0; s.deedNeed = T.params.deed ?? 0; s.deedDone = 0; s.lvSeen = 1; s.upA = -100000; s.upB = -100000;
  world.sigTrack = true;
  // (Ruling 18 KD, 21 KB: a weapon a character names in noDraft never comes in that character's draft.)
  const no = world.character?.noDraft;
  if (no && world.pools?.weapons) world.pools.weapons = world.pools.weapons.filter((d) => !no.includes(d.id ?? d));   // (C1's interim clock leaves this signature alone)
  world.trade = tr;
  return tr;
}

/**
 * What stops the Punter: the map's walls, but not its water. On the Marsh that's the swimmers'
 * grid (terrain.swimWall: kept up to date as the water comes and goes); on a map whose water never
 * moves (the Docks' slips), a grid made once with its water tiles open.
 */
function poleGrid(world) {
  const T = world.terrain;
  if (world.map.water) return T.swimWall;
  const g = T.solid.slice();
  if (T.kinds !== null) for (let i = 0; i < g.length; i++) if (T.kinds[i] === GROUND.WATER) g[i] = 0;
  return g;
}

// ---------------------------------------------------------------- what other code asks (W4, W1b)

/** How fast a lamp lights for this run's character (sim/tasks.js: progress times this). */
export function lampRate(world, t) {
  const tr = world.trade;
  if (!tr || tr.id !== 'lamps') return 1;
  return t.twist === TWIST.HELD ? 1 / tr.P.heldMul : 1e6;   // a held lamp a quarter of its time; else at a touch
}
/** A lit lamp's ward reach, times this (sim/tasks.js ward, wardAt, wardStep). */
export function wardMul(world) { const tr = world.trade; return tr && tr.id === 'lamps' ? tr.P.wardMul : 1; }
/** Lantern Nights banked when every lamp is lit (sim/tasks.js bankNight). */
export function nightsBanked(world) { const tr = world.trade; return tr && tr.id === 'lamps' ? tr.P.nights : 1; }
/** Every lamp lit: the nights past the first wait in the trade's state (sim/tasks.js bankNight). */
export function nightsBank(world) {
  const tr = world.trade;
  if (tr && tr.id === 'lamps') tr.s.nightsLeft = tr.P.nights - 1;
}
/** A Lantern Night ended: is another banked behind it? (Her second; sim/tasks.js nightStep.) */
export function nightAgain(world) {
  const tr = world.trade;
  if (!tr || tr.id !== 'lamps' || !(tr.s.nightsLeft > 0)) return false;
  tr.s.nightsLeft--;
  return true;
}
/** Enemies close by that bring a banked Lantern Night on (sim/tasks.js nightStep). */
export function nightCrowd(world) {
  const tr = world.trade;
  if (!tr || tr.id !== 'lamps') return world.tuning.tasks.night.crowd;
  // Night Watch: hers falls when she has stood in a lit lamp's ward (her hook sets s.watch), never for a crowd.
  if (world.sk.night_watch) return tr.s.watch === 1 ? 0 : 1e9;
  return tr.P.crowd;
}
/** Lantern Night's light reach, times this (sim/tasks.js nightStep). */
export function nightLight(world) { const tr = world.trade; return tr && tr.id === 'lamps' ? tr.P.lightMul : 1; }

/**
 * A Fog Bell (task index i) has just rung: does it ring again for this character? (The Tide Priest:
 * once more each.) True re-arms it (sim/tasks.js sets it idle) and marks it rung twice.
 */
export function bellAgain(world, i) {
  const tr = world.trade;
  if (!tr || tr.id !== 'bells' || bitGet(tr.s, i)) return false;
  bitSet(tr.s, i);
  tr.s.uses++;
  world.events.push(EV.TRADE, world.tasks[i].x, world.tasks[i].y, TRADE.BELL_AGAIN, i);
  return true;
}
/** A Fog Bell's crew size, times this (its second ring for the Tide Priest). */
export function bellCrewMul(world, i) {
  const tr = world.trade;
  return tr && tr.id === 'bells' && bitGet(tr.s, i) ? tr.P.crewMul : 1;
}

/** Is map secret s shut to this run's character? (One a character's trade owns: the Drowned Causeway is the Bog Warden's.) */
export function secretShut(world, s) {
  const owner = SECRET_OWNER[s.id];
  return owner !== undefined && owner !== world.character.id;
}
const SECRET_OWNER = Object.freeze({ drowned_causeway: 'bog_warden' });

/** Does the water stop this run's character? (False for the Punter: the Marsh's rule 8 needn't hold a way home dry for him.) */
export function polesWater(world) { const tr = world.trade; return !!tr && tr.id === 'pole'; }

/**
 * The player's move against the ground (sim/player.js): the Punter's own grid, slower on water.
 * reg: [x, y, r] to move to (changed in place). Returns true when it handled the move.
 */
export function poleMove(world, reg) {
  const tr = world.trade;
  if (!tr || tr.grid === null) return false;
  // Beached (the pole spent, not yet fresh): the water stops him as it stops anyone.
  if (tr.s.beached === 1) world.terrain.collideR(reg);
  else world.terrain.collideGridR(reg, tr.grid);
  return true;
}
/** His speed on the tile he stands on: the trade's `water` share on water; `winded` while beached; else 1. */
export function poleSpeed(world) {
  const tr = world.trade;
  if (afloat(world, tr)) return tr.P.water;
  return tr && tr.grid !== null && tr.s.beached === 1 ? tr.P.winded : 1;
}
/** Is the player on water now (the Punter poling)? For the view. */
export function onWater(world) { return afloat(world, world.trade); }

/** Is he on a tile that is water to walkers and ground to him? */
function afloat(world, tr) {
  if (!tr || tr.grid === null) return false;
  const p = world.player, T = world.terrain;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  if (tx < 0 || ty < 0 || tx >= T.cols || ty >= T.rows) return false;
  return T.solid[ty * T.cols + tx] === 1;
}

/** How much of the punt is left, 0 (spent) to 1 (a fresh pole); 1 for anyone else. For the view. */
export function puntLeft(world) {
  const tr = world.trade;
  if (!tr || tr.grid === null) return 1;
  const v = tr.s.punt / tr.P.punt;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
/** Is the pole spent: the water carrying him in, or he on the bank until it's fresh (winded, no pushing off)? For the view and the bots. */
export function puntSpent(world) { const tr = world.trade; return !!tr && tr.grid !== null && (tr.s.ashore === 1 || tr.s.beached === 1); }

/**
 * The punt's clock, each tick before he moves (sim/player.js): afloat, the pole tires (said once
 * when `tired` seconds are left: EV.TRADE, TRADE.PUNT, 1); spent, the water carries him to the
 * nearest ground a walker can stand on (TRADE.PUNT, 0), where he's beached: he steers again, but
 * winded, and the water is shut to him until the pole is fresh (TRADE.PUNT, 2). On land the pole
 * is fresh again after `rest` seconds. Returns true while he's being carried, with the way in
 * out[0], out[1] (px/s; the plain walking pace, whatever slows him).
 */
export function puntStep(world, out) {
  const tr = world.trade, s = tr.s, P = tr.P, p = world.player;
  const wet = afloat(world, tr);
  if (!wet) {
    if (s.ashore === 1) { s.ashore = 0; s.ashoreT = 0; s.beached = 1; }
    if (s.punt < P.punt) {
      s.punt += (DT * P.punt) / P.rest;
      if (s.punt >= P.punt) {
        s.punt = P.punt; s.tiredSaid = 0;
        if (s.beached === 1) { s.beached = 0; world.events.push(EV.TRADE, p.x, p.y, TRADE.PUNT, 2); }
      }
    }
    return false;
  }
  // (Beached and on water all the same: the Marsh's water rose over the bank he stood on. He's carried in again.)
  if (s.beached === 1 && s.ashore === 0) { s.ashore = 1; s.ashoreT = 0; }
  if (s.ashore === 0) {
    s.punt -= DT;
    if (s.tiredSaid === 0 && s.punt <= P.tired) { s.tiredSaid = 1; world.events.push(EV.TRADE, p.x, p.y, TRADE.PUNT, 1); }
    if (s.punt > 0) return false;
    s.punt = 0; s.ashore = 1; s.ashoreT = 0;
    world.events.push(EV.TRADE, p.x, p.y, TRADE.PUNT, 0);
  }
  // Carried in: toward the nearest open tile (looked for again a few times a second: the Marsh's
  // ground changes). One that can't be reached in 4 s (a wall in the way) and he is set down on it.
  const T = world.terrain, o = world.scratch.open;
  if (s.ashoreT % 15 === 0 && T.nearestOpen(Math.floor(p.x / TILE), Math.floor(p.y / TILE), o)) { s.ashoreX = o[0]; s.ashoreY = o[1]; }
  s.ashoreT++;
  const dx = s.ashoreX - p.x, dy = s.ashoreY - p.y, d = Math.sqrt(dx * dx + dy * dy);
  if (s.ashoreT > 4 * TPS && !T.blockedAt(s.ashoreX, s.ashoreY)) { p.x = s.ashoreX; p.y = s.ashoreY; out[0] = 0; out[1] = 0; return true; }
  const sp = world.tuning.player.speed;
  if (d > 1e-6) { out[0] = (dx / d) * sp; out[1] = (dy / d) * sp; } else { out[0] = 0; out[1] = 0; }
  return true;
}

/**
 * The trade's rings on the map now, for the view (sim/signs.js collectRings passes its own `ring`
 * filler, so a frame allocates nothing): each open site, the Harpooner's mooring posts while she
 * may call, and the Punter's cache. `kind` is the ring kind signs.js gives trades; the record's
 * `task` says which (TRADE_RING), its color its kind's. Returns the new count.
 */
export function tradeRingsInto(world, out, n, ring, kind) {
  const tr = world.trade;
  if (!tr) return n;
  const s = tr.s;
  if (tr.sites.length) {
    const color = tr.kind === TRADE_RING.CRATE ? 'cargo' : 'raise';
    for (let k = 0; k < tr.sites.length; k++) {
      if (bitGet(s, k)) continue;
      n = ring(out, n, kind, tr.sites[k].x, tr.sites[k].y, tr.ring, color, 0, -1, tr.kind);
    }
  }
  if (tr.id === 'hook' && world.ferry && hookCanCall(world, tr)) {
    const F = world.ferry, P = tr.P;
    for (let k = 0; k < F.moorings.length; k++) {
      if (F.moored && F.mooring === k) continue;
      n = ring(out, n, kind, F.moorings[k].x, F.moorings[k].y, P.postRadius, 'ferry', 0, -1, TRADE_RING.POST);
    }
  }
  if (tr.id === 'pole' && s.cacheOn === 1) n = ring(out, n, kind, s.cacheX, s.cacheY, tr.P.ring, 'chest', -1, -1, TRADE_RING.CACHE);
  if (tr.id === 'cargo' && s.markOn === 1) n = ring(out, n, kind, s.markX, s.markY, tr.P.ring, 'cargo', -1, -1, TRADE_RING.CRATE);
  return n;
}

/** The same rings as plain records (tests and tools; allocates). */
export function tradeRings(world, out = []) {
  const push = (o, k, kind, x, y, r, color, fill, count, sub) => { o.push({ kind: 'trade', ring: sub, x, y, r, color, fill }); return k + 1; };
  tradeRingsInto(world, out, out.length, push, 0);
  return out;
}

/**
 * (The bots, sim/bot.js's follow bot.) The nearest place the character's trade asks them to go,
 * as { x, y, r } (a ring to stand in), or null: an unused site (a body, a crew, a crate), the punt
 * cache, or, for the Harpooner with Pearls to spend and the Ferryman not tied up, the nearest post.
 * A cold path (the bot's), so it may allocate.
 */
export function tradeErrand(world) {
  const tr = world.trade;
  if (!tr) return null;
  const p = world.player, s = tr.s;
  let best = null, bd = Infinity;
  const consider = (x, y, r) => { const d = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y); if (d < bd) { bd = d; best = { x, y, r }; } };
  for (let k = 0; k < tr.sites.length; k++) if (!bitGet(s, k)) consider(tr.sites[k].x, tr.sites[k].y, tr.ring * 0.5);
  if (tr.id === 'pole' && s.cacheOn === 1) consider(s.cacheX, s.cacheY, 4);
  if (tr.id === 'cargo' && s.markOn === 1) consider(s.markX, s.markY, 4);
  const F = world.ferry;
  if (tr.id === 'hook' && F && world.glass >= 60 && hookCanCall(world, tr) && (!F.moored || (F.x - p.x) * (F.x - p.x) + (F.y - p.y) * (F.y - p.y) > 300 * 300)) {
    for (let k = 0; k < F.moorings.length; k++) consider(F.moorings[k].x, F.moorings[k].y, tr.P.postRadius * 0.5);
  }
  return best;
}

// ---------------------------------------------------------------- each tick (the character's onTick)

/** The trade's turn, each tick after you move (from the character's hook). */
export function tradeStep(world) {
  const tr = world.trade;
  if (!tr) return;
  trackStep(world, tr);
  switch (tr.id) {
    case 'hook': hookStep(world, tr); break;
    case 'raise': sitesStep(world, tr, raiseAt); break;
    case 'cargo': sitesStep(world, tr, haulAt); break;
    case 'pole': cacheStep(world, tr); break;
    default: break;
  }
}

/** A ring of sites (bodies, crews, crates): used the moment you step into it (no ring to stand in). */
function sitesStep(world, tr, use) {
  const p = world.player, s = tr.s, r = tr.ring + world.tuning.player.radius, r2 = r * r;
  for (let k = 0; k < tr.sites.length; k++) {
    if (bitGet(s, k)) continue;
    const dx = p.x - tr.sites[k].x, dy = p.y - tr.sites[k].y;
    if (dx * dx + dy * dy > r2) continue;
    bitSet(s, k);
    s.uses = (s.uses ?? 0) + 1;
    use(world, tr, tr.sites[k]);
    return;
  }
}

/** The Bog Warden raises the dead at a site: a bog body (the Marsh) or a wreck crew (the Docks). */
function raiseAt(world, tr, site) {
  const P = tr.P, old = world.sk.old_dead;
  // Ruling 25 KE: on the Salt Marsh, her home peat, her bog bodies stand `marshBody` times as long.
  const bodySec = old ? old.sec : P.bodySec * (world.marsh ? P.marshBody ?? 1 : 1), crewSec = old ? old.sec : P.crewSec;
  if (tr.kind === TRADE_RING.BODY) {
    const type = world.enemyIndex.get('salted_dead') ?? 0;
    raiseRisen(world, type, site.x, site.y, bodySec, P.bodyBite);
  } else {
    const type = world.enemyIndex.get('drowned_sailor') ?? 0;
    for (let k = 0; k < P.crewN; k++) {
      // Round the site, a quarter turn apart (a fixed table: no engine trig in the sim).
      const q = k % 4, ox = q === 0 ? 10 : q === 2 ? -10 : 0, oy = q === 1 ? 10 : q === 3 ? -10 : 0;
      raiseRisen(world, type, site.x + ox, site.y + oy, crewSec, P.crewBite);
    }
  }
  world.events.push(EV.TRADE, site.x, site.y, TRADE.RAISE, tr.kind);
  tradeDeed(world, tr.P.per);   // a site: one upgrade
}

/**
 * One of the map's sunken crates comes up for the Drowned Man: one item (a boss chest's worth with
 * Wreck Diver), and Sunk Cost fills the purse. It counts as a crate (crateUp).
 */
function haulAt(world, tr, site) {
  const s = tr.s;
  if (world.sk.sunk_cost) { const full = purseNeed(world); const to = s.purse + full * world.sk.sunk_cost.fill; s.purse = to < full ? to : full; }
  crateUp(world, site.x, site.y, world.sk.wreck_diver ? CHEST_BOSS : CHEST_ELITE, false);
}

/** Grave pennies a dive costs: the trade's `purse`, less Fleet's for each weapon past two, more with Wash Up. */
export function purseNeed(world) {
  const tr = world.trade, sk = world.sk;
  let n = tr.P.purse + (sk.wash_up ? sk.wash_up.more : 0);
  if (sk.fleet) {
    let w = 0;
    for (let k = 0; k < world.build.weaponSlots; k++) if (world.slots[k] && world.slots[k].def) w++;
    n -= sk.fleet.per * (w > 2 ? w - 2 : 0);
    if (n < sk.fleet.min) n = sk.fleet.min;
  }
  return n;
}

/**
 * A crate comes up at (x, y) for the Drowned Man: its chest opens there, the track takes an upgrade,
 * and every second crate (every crate with Wrecker's Hoard; any crate `owed` one) is a sea chest.
 */
export function crateUp(world, x, y, kind, owed) {
  const tr = world.trade, s = tr.s, sk = world.sk;
  s.crates = (s.crates ?? 0) + 1;
  s.uses = (s.uses ?? 0) + 1;
  const sea = owed || s.crates % (tr.P.seaEvery ?? 2) === 0;
  world.events.push(EV.TRADE, x, y, TRADE.HAUL, sea ? 1 : 0);
  world.events.push(EV.DIVE, x, y, sea ? 1 : 0);
  openChest(world, kind, x, y);
  tradeDeed(world, 1);
  capDeed(world, 1);
  if (sea) seaChest(world);
}

/**
 * A sea chest: a weapon slot, and a weapon to put in it with as many upgrades as his lowest
 * drafted weapon has (up to the run's slots plus one, two with Wrecker's Hoard). With Empty Hands:
 * no slot; upgrades for Grave Pennies and one more Penny.
 */
function seaChest(world) {
  const tr = world.trade, s = tr.s, sk = world.sk, b = world.build;
  if (sk.empty_hands) {
    s.seaN = (s.seaN ?? 0) + 1;
    for (let k = 0; k < sk.empty_hands.ups; k++) sigUpgrade(world, 1);
    markStatsDirty(world);
    return;
  }
  const max = Math.min(MAX_WEAPON_SLOTS, s.slots0 + (tr.P.over ?? 1) + (sk.wreckers_hoard ? sk.wreckers_hoard.slots : 0));
  if (b.weaponSlots >= max) {
    // Every sea chest pays (ruling 17 K5): with no slot left owed, it is upgrades for his pennies.
    s.seaN = (s.seaN ?? 0) + 1;
    for (let k = 0; k < (tr.P.seaUps ?? 2); k++) sigUpgrade(world, 1);
    markStatsDirty(world);
    world.events.push(EV.TRADE, world.player.x, world.player.y, TRADE.SLOT, 0);
    return;
  }
  b.weaponSlots++;
  s.seaN = (s.seaN ?? 0) + 1;
  markStatsDirty(world);
  world.events.push(EV.TRADE, world.player.x, world.player.y, TRADE.SLOT, b.weaponSlots);
  // The weapon: one of the run's pool he doesn't carry, drawn by weight on the trade's stream.
  const pool = world.pools.weapons.filter((d) => !ownsWeapon(world, d.id));
  if (!pool.length) return;
  let low = Infinity;
  for (let k = 0; k < MAX_WEAPON_SLOTS; k++) { const sl = world.slots[k]; if (k !== s.sig && sl && sl.def && sl.ups.length < low) low = sl.ups.length; }
  const def = pool[world.rng.trade.weighted(pool.map((d) => d.weight ?? 1))];
  const at = addWeapon(world, def);
  if (at < 0) return;
  for (let k = 0; k < (Number.isFinite(low) ? low : 0); k++) {
    const u = WU.rollUpgrade(world, at, world.rng.trade);
    if (u === null) break;
    give(world, at, u);
  }
}

/**
 * A full purse marks a sunken crate (the Drowned Man's hook): on open ground between markNear and
 * markFar (times `far`) from him, the way drawn on the trade stream. False when no draw found
 * open ground (it tries again next tick). Sets s.markOn, s.markX, s.markY.
 */
export function markCrate(world, far) {
  const tr = world.trade, s = tr.s, P = tr.P, p = world.player, T = world.terrain, o = world.scratch.open, rng = world.rng.trade;
  for (let tries = 0; tries < 6; tries++) {
    let dx = rng.next() * 2 - 1, dy = rng.next() * 2 - 1;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m < 0.2) continue;
    dx /= m; dy /= m;
    const d = (P.markNear + rng.next() * (P.markFar - P.markNear)) * far;
    const x = p.x + dx * d, y = p.y + dy * d;
    if (x < 16 || y < 16 || x > T.width - 16 || y > T.height - 16) continue;
    if (!T.nearestOpen(Math.floor(x / TILE), Math.floor(y / TILE), o, 4)) continue;
    s.markX = o[0]; s.markY = o[1]; s.markOn = 1;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- the signature's track

/** Take a rolled upgrade on slot k: C1's giveUpgrade when the growth core has it, else the older pair. */
function give(world, k, u) {
  if (typeof AS.giveUpgrade === 'function') AS.giveUpgrade(world, k, u);
  else { WU.takeUpgrade(world, k, u); markStatsDirty(world); }
}

/** The signature takes one rolled upgrade (src: 0 the clock, 1 the trade, 2 the run's level-ups), and opens an axis at its 5th and 10th. */
export function sigUpgrade(world, src) {
  const tr = world.trade, s = tr.s, k = s.sig;
  if (!(k >= 0) || !world.slots[k] || !world.slots[k].def) return;
  s.sigN++;
  if (typeof AS.giveUpgrade !== 'function' && legacyBehavior(world, k, s.sigN)) { /* a line or special, taken the old tree's way */ }
  else {
    const u = WU.rollUpgrade(world, k, world.rng.trade);
    if (u !== null) give(world, k, u);
  }
  const p = world.player;
  world.events.push(EV.SIG_UP, p.x, p.y, k, src, s.sigN);
  const at = world.tuning.forms?.at ?? AXIS_AT;
  if (s.sigN === (at[0] ?? 5)) offerAxis(world, k, 'delivery');
  else if (s.sigN === (at[1] ?? 10)) offerAxis(world, k, 'flight');
}
const AXIS_AT = Object.freeze([5, 10]);

/** The choice of an axis for the signature: C1's halt when it exists; else (tools, the older tree) the run's pick or option A. */
function offerAxis(world, k, axis) {
  if (typeof AS.offerAxis === 'function') { AS.offerAxis(world, k, axis); return; }
  const sl = world.slots[k];
  const line = world.data.ascensions.find((l) => l.weapons.includes(sl.def.id));
  const opts = line ? line.options.filter((o) => o.axis === axis) : [];
  const pick = world.config.sigPick?.[axis] === 'b' ? 1 : 0;
  if (opts[pick] && typeof AS.takeForm === 'function') AS.takeForm(world, k, opts[pick]);
}

/**
 * (The tree before C1's growth core only: tools and tests.) At the schedule C1's core keeps (a
 * line at each 3rd upgrade while one is left, a special at the 10th and 20th), put the signature's
 * next line or special on it as a Form, so its behavior can be measured. Returns true when it did.
 */
function legacyBehavior(world, k, n) {
  const sl = world.slots[k], def = sl.def;
  const has = (id) => sl.ascensions.some((a) => a.id === id);
  let thing = null;
  if (n % 10 === 0) { const sp = def.specials || [], first = world.config.sigPick?.special === 'b' ? 1 : 0; thing = !has(sp[first]?.id) ? sp[first] : sp.find((x) => !has(x.id)); }
  else if (n % 3 === 0) thing = (def.lines || []).find((x) => !has(x.id));
  if (!thing || typeof AS.takeForm !== 'function') return false;
  AS.takeForm(world, k, thing);
  return true;
}

/**
 * The trade did its thing n times: every `per` is an upgrade for the signature, at most one every
 * `gap` seconds (deeds past that bank, and trackStep pays them when the gap has passed), so no
 * kill rate can feed the signature faster (ruling 16, item 3).
 */
export function tradeDeed(world, n) {
  const s = world.trade.s;
  s.sigHave += n;
  payDeeds(world, world.trade);
}
function payDeeds(world, tr) {
  const s = tr.s;
  if (s.sigHave < s.sigNeed) return;
  // Ruling 19 KH: a cap on the trade's income too, at most 2 trade upgrades in any `span` s.
  const win = Math.round((tr.P.span ?? 0) * TPS);
  if (world.tick < s.sigUpAt || (win > 0 && world.tick < s.upA + win)) {
    // Past the gap (ruling 17 K2): the trade still pays, at a lower rate: each upgrade's worth of
    // deeds the gap holds back is `pastCap` more damage for the signature, up to `pastMax` (a
    // stated line on its stats; it counts deeds, each on its own trade clock, so it isn't a loop).
    const P = tr.P;
    if (!(P.pastCap > 0)) return;
    const n = Math.floor(s.sigHave / s.sigNeed);
    s.sigHave -= n * s.sigNeed;
    const was = s.pastN ?? 0, top = Math.floor((P.pastMax ?? 0) / P.pastCap + 1e-9);
    s.pastN = Math.min(top, was + n);
    if (s.pastN !== was) markStatsDirty(world);
    return;
  }
  s.sigHave -= s.sigNeed;
  s.sigUpAt = world.tick + Math.round((tr.P.gap ?? 0) * TPS);
  s.upA = s.upB; s.upB = world.tick;
  sigUpgrade(world, 1);
}

/** The capstone's deed moved on by n: done, the signature's capstone axis is offered (once). */
export function capDeed(world, n) {
  const s = world.trade.s;
  if (s.deedDone === 1) return;
  s.deed += n;
  if (s.deed < s.deedNeed) return;
  s.deed = s.deedNeed; s.deedDone = 1;
  if (s.sig >= 0) offerAxis(world, s.sig, 'payoff');
}

/** The track's clock, each tick (tradeStep). */
function trackStep(world, tr) {
  const s = tr.s;
  growStep(world, tr);
  if (s.sigHave >= s.sigNeed && world.tick >= s.sigUpAt) payDeeds(world, tr);
  // Ruling 17 follow-up: the signature grows with the run's level-ups too, an upgrade every `lvEvery`
  // of them (stated on its card), so the drafted weapons don't outgrow it late.
  const lv = tr.P.lvEvery ?? 0;
  if (lv > 0) while (world.player.level >= s.lvSeen + lv) { s.lvSeen += lv; sigUpgrade(world, 2); }
  if (world.tick < s.sigAt) return;
  s.sigAt += Math.round((tr.P.clock ?? 80) * TPS);
  sigUpgrade(world, 0);
}

/**
 * What the trade did this run, for the results and the character's ledger (meta/apply.js keeps the
 * best of each): { key: count }. The keys are ui/hubtext.js TRADE_WORDS'. A cold path.
 */
export function tradeResult(world) {
  const tr = world.trade;
  if (!tr) return null;
  const s = tr.s, e = world.hookEntries.find((x) => x.source === `character:${world.character.id}`), st = e ? e.state : {};
  const out = {};
  const put = (k, v) => { if (Number.isFinite(v) && v > 0) out[k] = Math.round(v); };
  switch (tr.id) {
    case 'lamps': put('lanterns', st.planted); put('lamps', world.result.lampsLit); break;
    case 'hook': put('elites', s.yanks); put('reeled', s.reeled); put('hauls', st.hauls); break;
    case 'pole': put('sweeps', st.sweeps); put('caches', s.caches); break;
    case 'raise': put('raised', world.allies.raised); put('deadDamage', world.allies.dealt); break;
    case 'cargo': put('crates', s.crates); put('slots', s.seaN); break;
    case 'bells': put('calls', st.calls); put('floods', st.bigFloods); put('bells', world.result.bellsRung); break;
    default: break;
  }
  put('sigLevel', s.sigN + 1);
  // Its share of the health taken off enemies, as the stats screen counts it (Ruling 21 PA: realBySlot,
  // no overkill, so the two screens agree).
  const real = world.result.realBySlot;
  let all = 0;
  for (let k = 0; k < real.length; k++) all += real[k];
  if (s.sig >= 0 && all > 0) put('sigShare', (100 * real[s.sig]) / all);
  return out;
}

/**
 * The signature's growth (C2, Nov 17; a stated rule, on its card and the stats screen): its damage
 * grows by the character's `grow` (a share a minute of the run) on top of its upgrades, from x1 at
 * 0:00 to at most `growMax`. Stepped once a minute (a stats rebuild, a cold path); it reads only the
 * run's clock, so nothing a player kills or picks up moves it.
 */
function growStep(world, tr) {
  if (world.tick % (60 * TPS) !== 0 || world.tick === 0) return;
  const s = tr.s, v = growAt(tr.P, Math.floor(world.tick / (60 * TPS)));
  if (v !== s.grow) { s.grow = v; markStatsDirty(world); }
}
/** The signature's growth after `minutes` of the run (its card and the stats screen read this). */
export function growAt(P, minutes) {
  const g = 1 + (P.grow ?? 0) * minutes, max = P.growMax ?? 3;
  return g > max ? max : g;
}
/** The signature's growth as a modifier on it (each character hook's modifyStats). */
export function growMods(world, mods) {
  const tr = world.trade;
  if (!tr || !(tr.s.sig >= 0)) return;
  const sl = world.slots[tr.s.sig];
  if (!sl || !sl.def) return;
  if (tr.s.grow > 1) mods.push({ stat: 'might', op: 'more', value: tr.s.grow - 1, weapon: sl.def.id });
  const past = tradeBonus(world);
  if (past > 0) mods.push({ stat: 'might', op: 'more', value: past, weapon: sl.def.id });
}
/** The signature's damage bonus from trade deeds past the gap (0 to pastMax). */
export function tradeBonus(world) {
  const tr = world.trade;
  return tr && tr.P.pastCap > 0 ? (tr.s.pastN ?? 0) * tr.P.pastCap : 0;
}

/** The track for the HUD and the cards: { level, have, need, deed: { have, need, done } }. */
export function trackState(world) {
  const tr = world.trade;
  if (!tr) return null;
  const s = tr.s;
  return { level: s.sigN + 1, have: s.sigHave, need: s.sigNeed, deed: { have: s.deed, need: s.deedNeed, done: s.deedDone === 1 } };
}

// ---------------------------------------------------------------- the Harpooner's hook

/** May she call the Ferryman now? Once each of his calls: not again until his schedule has brought him once more. */
function hookCanCall(world, tr) {
  const F = world.ferry;
  return !!F && F.calls >= (tr.s.called ?? -1) + 1 && world.tick >= F.tiedTick;
}

function hookStep(world, tr) {
  const P = tr.P, s = tr.s, p = world.player, sk = world.sk;
  const reach2 = P.reach * P.reach;
  // Loot within reach and on screen comes to her (a chest, a Reliquary, the vault, an Ember).
  // Salvager: every pickup she faces, from across the screen.
  const K = world.pickups, step = P.reel * DT, far = sk.salvager ? sk.salvager.reach : 0, far2 = far * far;
  for (let i = 0; i < K.count; i++) {
    const kind = K.kind[i];
    const loot = kind === PK.CHEST || kind === PK.RELIQUARY || kind === PK.VAULT || kind === PK.EMBER;
    if (!loot && far === 0) continue;
    const dx = p.x - K.x[i], dy = p.y - K.y[i];
    if (dx > 320 || dx < -320 || dy > 180 || dy < -180) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach2 && !(d2 <= far2 && -(dx * p.fx + dy * p.fy) > 0.5 * Math.sqrt(d2))) continue;
    if (!loot && d2 > far2) continue;
    const d = Math.sqrt(d2);
    if (d <= 1) continue;
    const m = step < d ? step : d;
    K.x[i] += (dx / d) * m; K.y[i] += (dy / d) * m;
  }
  // An elite yanked out of its crowd: it slides to her side over a few ticks, dazed.
  const E = world.enemies;
  if ((s.yankT ?? 0) > 0) {
    const e = E.resolve(s.yankH);
    if (e < 0 || (E.flags[e] & EF_GONE) !== 0) s.yankT = 0;
    else {
      const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const want = P.yankTo, k = 1 / s.yankT;
      const nx = E.x[e] - (dx / d) * (d - want) * k, ny = E.y[e] - (dy / d) * (d - want) * k;
      if (!world.terrain.blockedAt(nx, ny)) { E.x[e] = nx; E.y[e] = ny; }
      E.vx[e] = 0; E.vy[e] = 0;
      s.yankT--;
    }
  }
  // The throw: every `every` s (Hand Line, Gaff Hand: their own) the hook throws itself the way she
  // faces. With nothing to take it looks again a quarter second later. The hook reads what it got
  // (s.thrownAt, s.got, s.gx, s.gy, s.tdx, s.tdy).
  if (world.tick >= s.throwAt && (s.yankT ?? 0) <= 0) {
    const hand = sk.hand_line, gaff = sk.gaff_hand;
    const got = hookThrow(world, p.fx, p.fy, hand ? hand.reach : gaff ? gaff.reach : 1, tr.reg);
    if (got > 0 || gaff) {
      s.thrownAt = world.tick; s.got = got; s.gx = tr.reg[0]; s.gy = tr.reg[1]; s.tdx = p.fx; s.tdy = p.fy;
      s.throwAt = world.tick + Math.round((hand ? hand.every : gaff ? gaff.every : P.every) * TPS);
    } else s.throwAt = world.tick + Math.round(0.25 * TPS);
  }
}

/** The elite the hook would take: the nearest within `reach` (inside the cone of (dx, dy) when `cone`), not at her side already, not mid-attack. */
function hookElite(world, tr, dx, dy, reach, cone) {
  const E = world.enemies, p = world.player, P = tr.P, champ = world.sk.elite_hunter !== undefined;
  let best = -1, bestD = reach * reach;
  for (let i = 0; i < E.count; i++) {
    const f = E.flags[i];
    if ((f & EF.ELITE) === 0 || (f & (EF.BOSS | EF_GONE)) !== 0 || (E.boss[i] === MUSTER_CAPTAIN && !champ) || midAttack(E, i, world.bosses)) continue;
    const ex = E.x[i] - p.x, ey = E.y[i] - p.y, d2 = ex * ex + ey * ey;
    if (d2 >= bestD || d2 <= (P.yankTo + 16) * (P.yankTo + 16)) continue;
    if (cone && ex * dx + ey * dy < CONE * Math.sqrt(d2)) continue;
    bestD = d2; best = i;
  }
  return best;
}
const CONE = 0.5;   // the cosine of 60 degrees: the hook's cone, each side of the way she faces or dashes

/** Yank elite e to her side: dazed, gaffed (it takes `gaff` more for `gaffSec`), counted. */
function yank(world, tr, e) {
  const E = world.enemies, P = tr.P, s = tr.s;
  s.yankH = E.handle(e);
  s.yankT = Math.round(0.2 * TPS);
  s.yankAt = world.tick;
  if (E.dazeT[e] < P.yankDaze) E.dazeT[e] = P.yankDaze;
  if (E.openT[e] < P.gaffSec) E.openT[e] = P.gaffSec;
  if (E.openAmp[e] < P.gaff) E.openAmp[e] = P.gaff;
  s.yanks = (s.yanks ?? 0) + 1;
  s.uses = (s.uses ?? 0) + 1;
  world.events.push(EV.TRADE, E.x[e], E.y[e], TRADE.YANK, E.handle(e));
  world.events.push(EV.HAUL, E.x[e], E.y[e], 1);
  tradeDeed(world, P.perElite);
  capDeed(world, 1);
}

/**
 * The trade hook thrown along (dx, dy) (hookStep: the way she faces): the nearest marked thing
 * inside the cone, else the nearest in reach. An elite is yanked; a chest, Reliquary, the vault, or
 * an Ember is hauled to her; a mooring post brings the Ferryman. `reachMul` stretches the throw (Gaff
 * Hand) or shortens it (Hand Line). Returns what it took (0 nothing, 1 an elite, 2 loot, 3 a post), with where in out[0], out[1].
 */
export function hookThrow(world, dx, dy, reachMul, out) {
  const tr = world.trade, P = tr.P, s = tr.s, p = world.player;
  const reach = P.reach * reachMul, reach2 = reach * reach;
  for (let pass = 0; pass < 2; pass++) {
    const cone = pass === 0;
    // Ruling 18 KB: on the Marsh, elites can be yanked from `marshReach` times as far.
    const e = (s.yankT ?? 0) > 0 ? -1 : hookElite(world, tr, dx, dy, world.marsh ? reach * (P.marshReach ?? 1) : reach, cone);
    if (e >= 0) { const E = world.enemies; out[0] = E.x[e]; out[1] = E.y[e]; yank(world, tr, e); return 1; }
    const K = world.pickups;
    let best = -1, bestD = reach2;
    for (let i = 0; i < K.count; i++) {
      const kind = K.kind[i];
      if (kind !== PK.CHEST && kind !== PK.RELIQUARY && kind !== PK.VAULT && kind !== PK.EMBER) continue;
      const kx = K.x[i] - p.x, ky = K.y[i] - p.y, d2 = kx * kx + ky * ky;
      if (d2 >= bestD || d2 < 30 * 30 || (cone && kx * dx + ky * dy < CONE * Math.sqrt(d2))) continue;
      bestD = d2; best = i;
    }
    if (best >= 0) {
      out[0] = K.x[best]; out[1] = K.y[best];
      const kx = K.x[best] - p.x, ky = K.y[best] - p.y, d = Math.sqrt(bestD) || 1;
      K.x[best] = p.x + (kx / d) * 22; K.y[best] = p.y + (ky / d) * 22;
      s.reeled = (s.reeled ?? 0) + 1; s.uses = (s.uses ?? 0) + 1;
      world.events.push(EV.HAUL, out[0], out[1], 2);
      tradeDeed(world, P.perLoot);
      return 2;
    }
    const F = world.ferry;
    if (F && hookCanCall(world, tr)) {
      let at = -1, atD = reach2 * 2.25;   // a post from half again as far
      for (let k = 0; k < F.moorings.length; k++) {
        if (F.moored && F.mooring === k) continue;
        const mx = F.moorings[k].x - p.x, my = F.moorings[k].y - p.y, d2 = mx * mx + my * my;
        if (d2 >= atD || (cone && mx * dx + my * dy < CONE * Math.sqrt(d2))) continue;
        atD = d2; at = k;
      }
      if (at >= 0) {
        out[0] = F.moorings[at].x; out[1] = F.moorings[at].y;
        ferryCall(world, at);
        s.called = F.calls;
        s.reeled = (s.reeled ?? 0) + 1; s.uses = (s.uses ?? 0) + 1;
        world.events.push(EV.TRADE, F.x, F.y, TRADE.CALL, at);
        world.events.push(EV.HAUL, out[0], out[1], 3);
        tradeDeed(world, P.perLoot);
        return 3;
      }
    }
  }
  return 0;
}

// ---------------------------------------------------------------- the Punter's caches

/**
 * A punt cache floats out on the water: on the Marsh one each high water (gone when it ebbs), on
 * a map whose water stays (the Docks' slips) one each act. He opens it by reaching it (an elite's chest).
 */
function cacheStep(world, tr) {
  const s = tr.s, p = world.player, M = world.marsh;
  // When is there a new one to float out?
  let key = -1;
  // (Ruling 18 KB: one each `marshCache` s of high water, 3:00 to 8:00 and 13:00 to 18:00, about the Docks' one an act.)
  if (M) key = M.phase === WATER_HIGH ? 1000 + Math.floor(world.tick / (TPS * (tr.P.marshCache ?? 600))) : -1;
  else key = world.acts ? world.acts.act : 1;
  if (key < 0) { if (s.cacheOn === 1 && M) s.cacheOn = 0; return; }
  // (No water in reach yet: it tries again each second, as he moves.)
  if (key !== s.cacheAt && s.cacheOn === 0 && s.ashore === 0 && world.tick % TPS === 0) {
    if (placeCache(world, tr)) { s.cacheAt = key; world.events.push(EV.TRADE, s.cacheX, s.cacheY, TRADE.CACHE, 1); }
  }
  if (s.cacheOn !== 1) return;
  const r = tr.P.ring + world.tuning.player.radius, dx = p.x - s.cacheX, dy = p.y - s.cacheY;
  if (dx * dx + dy * dy > r * r) return;
  s.cacheOn = 0;
  s.uses = (s.uses ?? 0) + 1;
  s.caches = (s.caches ?? 0) + 1;
  world.events.push(EV.TRADE, s.cacheX, s.cacheY, TRADE.CACHE, 0);
  openChest(world, CHEST_ELITE, s.cacheX, s.cacheY);
  tradeDeed(world, tr.P.per * 2);   // a cache: two upgrades
  // Second Cache: another floats out, once each high water or act.
  if (world.sk.second_cache && s.cache2 !== key) { s.cache2 = key; s.cacheAt = -3; }
}
const WATER_HIGH = 3;   // sim/marsh.js WATER.HIGH

/**
 * A water tile he can reach, 160 to 480 px from him, drawn from the loot stream: every such tile
 * round him is counted, then one is drawn (a draw over the whole map almost never landed near him:
 * W2's bot runs floated no cache in 15:00 on the Marsh). It must lie within a punt of a bank (out
 * and back on one pole, with a third to spare: X4), so up to 6 draws are made for one that does.
 * False when there's none (it tries again in a second).
 */
function placeCache(world, tr) {
  const T = world.terrain, p = world.player, s = tr.s, g = tr.grid, o = world.scratch.open;
  const R = 30, cx = Math.floor(p.x / TILE), cy = Math.floor(p.y / TILE);
  const x0 = cx - R < 0 ? 0 : cx - R, x1 = cx + R >= T.cols ? T.cols - 1 : cx + R;
  const y0 = cy - R < 0 ? 0 : cy - R, y1 = cy + R >= T.rows ? T.rows - 1 : cy + R;
  // How far out a cache may float: a third of the water a fresh pole covers, in tiles (at least 2).
  const out = Math.max(2, Math.floor((tr.P.punt * world.tuning.player.speed * tr.P.water) / 3 / TILE));
  let n = 0;
  for (let pass = 0; pass < 7; pass++) {
    const pick = pass >= 1 ? Math.floor(world.rng.loot.next() * n) : -1;
    let k = 0;
    scan: for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const i = ty * T.cols + tx;
      if (T.solid[i] !== 1 || g[i] !== 0) continue;               // water: solid to walkers, open to him
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE, dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < 160 * 160 || d2 > 480 * 480) continue;
      if (pass === 0) { n++; continue; }
      if (k++ !== pick) continue;
      if (!T.nearestOpen(tx, ty, o, out + 1)) break scan;         // too far out: draw again
      s.cacheX = x; s.cacheY = y; s.cacheOn = 1;
      return true;
    }
    if (n === 0) return false;
  }
  return false;
}

// ---------------------------------------------------------------- small helpers

/** One bit of a site or bell flag in the trade's state (two 30-bit words: numbers, so the hash walks them). */
function bitGet(s, i) {
  const w = i < 30 ? s.used : s.used2, b = i < 30 ? i : i - 30;
  return Math.floor(w / POW2[b]) % 2 === 1;
}
function bitSet(s, i) {
  if (bitGet(s, i)) return;
  if (i < 30) s.used += POW2[i]; else if (i < 60) s.used2 += POW2[i - 30];
}
const POW2 = (() => { const a = new Float64Array(31); a[0] = 1; for (let k = 1; k < 31; k++) a[k] = a[k - 1] * 2; return a; })();

/** EV.TRADE's `a`: what happened (the view and sound read it). */
export const TRADE = Object.freeze({ YANK: 1, CALL: 2, RAISE: 3, HAUL: 4, CACHE: 5, BELL_AGAIN: 6, NET: 7, SLOT: 8, PUNT: 9, MARK: 10 });

export { bitGet as tradeSiteUsed };

/** Is the trade's site k (a bog body, a wreck crew, a sunken crate) still there to use? (sim/marsh.js: the flood leaves a way to it.) */
export function tradeSiteOpen(world, k) {
  const tr = world.trade;
  return !!tr && k < tr.sites.length && !bitGet(tr.s, k);
}
