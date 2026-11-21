// What the sweep's rulings 11 to 13 retired, and what a save that held any of it gets instead
// (ARCHITECTURE §10.1, §12.2). Pure; tested (tests/sweep-x2.test.js). meta/reconcile.js calls
// retireOld on every load, before it fits the rest; it does its work once per save
// (profile.retired counts the tables' version) and nothing a profile earned is dropped:
//
//   arcana (ruling 11)       an arcana chosen at the gate (setup.arcana) is its relic as the Heirloom
//                            (setup.heirloom). An arcana the profile had opened stays as the relic it
//                            became: that relic is in the pool (profile.kept holds its key when the
//                            profile hasn't met it the relic's own way), it counts as found (the codex),
//                            so it can be an Heirloom, and the Heirloom row is open (profile.heirloomHeld)
//                            even below the Tavern level that opens it for a new harbor.
//   tonics (ruling 12)       every retired consumable held is paid back at the price it was bought
//                            for, in materials.
//   challenges (ruling 13)   a challenge run won is its Harbor Order done (same id).
//   the bestiary (ruling 13) a trophy rung claimed, or reached, is that enemy's Hunt done. Rungs
//                            reached and not yet claimed pay what they would have paid.
//   curses (D5)              the Chapel's levels open curses later; a save keeps the count its
//                            level gave before (profile.cursesHeld).
//   runes (ruling 14)        rune stones held are paid back at the cutting price; a rune the codex had
//                            seen is the relic it became, or goes (its effect is a line on weapons now).
//   perks (ruling 15)        a trained mastery perk is paid back at its price, and its rank's skill
//                            point is there to spend on the character's tree (meta/skills.js). Its own
//                            mark (profile.perksRetired), so it runs once whatever the tables' version.
// What was paid is left in profile.retiredNote for the harbor to say once (app/hublogic.js).
//
// The tables are the old data, kept here because the data files no longer have it. Rows are only
// ever added; a new retirement raises RETIRED_VERSION and adds a step guarded by it.

import { retirePerks } from './skills.js';
import { countOf } from './costs.js';

export const RETIRED_VERSION = 2;

/** Each arcana of 0.9.0's first builds: the relic it became, and the key it opened on. */
export const RETIRED_ARCANA = Object.freeze({
  high_water: { relic: 'moon_pull', was: 'research:moon_tables' },
  brine: { relic: 'brine', was: 'research:brine_rites' },
  kindling: { relic: 'kindling', was: 'challenge:lamp_only' },
  glassblower: { relic: 'glassblower', was: 'feat:lantern_night' },
  long_beam: { relic: 'long_beam', was: 'building:lighthouse:3' },
  // The nine that were a relic's rule with bigger numbers: each is that relic.
  tide_ward: { relic: 'glass_lantern', was: 'building:lighthouse:8' },
  spring_tide: { relic: 'tide_clock', was: 'feat:docks_tide_10' },
  powder_gems: { relic: 'volatile_gems', was: 'feat:collector' },
  blood_tide: { relic: 'bloodied_hook', was: 'feat:elite_hunter' },
  pyre_walk: { relic: 'wreck_lantern', was: 'feat:wildfire_night' },
  toll_keeper: { relic: 'drowned_bell', was: 'feat:marsh_tide_10' },
  flint_heart: { relic: 'spark_flint', was: 'feat:dash_killer' },
  barnacle_skin: { relic: 'barnacle_shell', was: 'feat:untouchable' },
  ember_tithe: { relic: 'seventh_bell', was: 'feat:ember_keeper' },
});

/** The consumables that went, with the price each was bought for (data/consumables.js before the sweep). */
export const RETIRED_CONSUMABLES = Object.freeze({
  tallow_tonic: { coin: 120, oil: 45 }, tar_salve: { coin: 95, marsh_herbs: 25 }, lodestone_dust: { coin: 85, rope: 8 },
  sea_salt: { coin: 120, rum: 9 }, bosun_rum: { coin: 130, rum: 9 }, tar_torch: { coin: 200, oil: 80 }, brine_flask: { coin: 200, timber: 40 },
  lamp_black: { coin: 200, oil: 80 }, whetstone: { coin: 200, rope: 15 }, frost_salt: { coin: 200, marsh_herbs: 50 }, grave_dirt: { coin: 200, marsh_herbs: 50 },
  bell_wax: { coin: 200, drowned_pages: 40 }, cork_float: { coin: 60, marsh_herbs: 15 }, compass_needle: { coin: 80, drowned_pages: 15 },
  iron_ration: { coin: 95, rum: 6 }, dark_tonic: { coin: 160, marsh_herbs: 40 }, wreck_charm: { coin: 190, timber: 40 }, driftglass: { coin: 280, salt_glass: 5 },
  storm_oil: { coin: 100, oil: 40 }, beacon_oil: { coin: 70, oil: 30 }, lighthouse_lens: { coin: 410, salt_glass: 7 }, glass_pouch: { coin: 60, rum: 4 },
  wisp_jar: { coin: 150, oil: 60 }, sailors_bell: { coin: 95, rope: 9 }, gull_quill: { coin: 75, timber: 15 }, crab_shell: { coin: 95, rope: 8 },
  bloater_gland: { coin: 70, rum: 5 }, rat_tail: { coin: 60, oil: 25 }, moth_dust: { coin: 170, oil: 70 }, gunners_fuse: { coin: 75, timber: 15 },
  bosun_whistle: { coin: 160, rum: 10 }, midge_net: { coin: 75, marsh_herbs: 20 }, salt_crust: { coin: 95, marsh_herbs: 25 }, toad_stone: { coin: 65, marsh_herbs: 15 },
  eel_skin: { coin: 70, marsh_herbs: 15 }, leech_jar: { coin: 70, marsh_herbs: 15 }, wardens_key: { coin: 130, salt_glass: 2 },
});

/** The bestiary's ladders of lifetime kills, and what each rung paid when claimed (data/meta.js before the sweep). */
const L3 = [300, 3000, 30000, 300000], L2 = [100, 1000, 10000, 100000], L1 = [30, 300, 3000, 30000], L0 = [10, 100, 1000, 10000], LB = [1, 3, 10, 30];
export const RETIRED_LADDERS = Object.freeze({
  fog_wisp: L3, drowned_sailor: L3, bilge_rat: L3, gull: L2, bloater: L1, mud_crab: L1, lantern_eater: L0, wreck_gunner: L0,
  drowned_bosun: LB, harbor_maw: LB, the_tidecaller: LB,
  midge_cloud: L3, salted_dead: L3, leech: L2, mire_toad: L1, creek_eel: [5, 50, 500, 5000], well_warden: LB, old_grey: LB, salt_widow: LB,
});
export const RETIRED_RUNG_PAY = Object.freeze([{ coin: 20 }, { coin: 60, drowned_pages: 6 }, { coin: 150, iron: 2 }, { coin: 400, map_scraps: 3 }]);
/** The rung (1-based) that opened an enemy's trophy. */
const TROPHY_RUNG = 3;
/** The curses each Chapel level opened before the sweep moved them to its levels 4 and 5. */
const RETIRED_CURSES = [0, 2, 3, 4, 5, 5];

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (v) => countOf(typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * Fit a profile document (changed in place; reconcile passes its own copy) to the sweep's rulings.
 * Returns the list of what it did, as 'kind:id' strings (reconcile adds them to `moved`).
 */
export function retireOld(doc, data) {
  const P = doc.profile, did = [];
  if (!isObj(P)) return did;
  const from = num(P.retired);
  if (from < RETIRED_VERSION) {
    if (from < 1) retireSweep(doc, data, did);
    if (from < 2) retireRunes(doc, data, did);
    P.retired = RETIRED_VERSION;
  }
  // Ruling 15 (C2): mastery perks are skill trees. Its own mark (P.perksRetired), so it runs once
  // whatever the tables' version: trained perks are paid back and their ranks' points are there to spend.
  if (num(P.perksRetired) < 1) {
    const r = retirePerks(P, data);
    P.perksRetired = 1;
    did.push(...r.did);
    if (r.perks > 0) P.retiredNote = { ...(isObj(P.retiredNote) ? P.retiredNote : {}), perks: r.perks, points: r.points, perkRefund: r.refund };
  }
  return did;
}

/** Version 1: the sweep's rulings 11 to 13 and D5. */
function retireSweep(doc, data, did) {
  const P = doc.profile;
  const O = isObj(P.orphans) ? P.orphans : {};
  if (!isObj(P.materials)) P.materials = {};
  const paid = {};
  const pay = (cost, times, into) => { for (const [id, n] of Object.entries(cost)) { P.materials[id] = num(P.materials[id]) + n * times; into[id] = (into[id] ?? 0) + n * times; } };
  const feats = new Set(strs(P.feats));
  const level = (id) => num(isObj(P.buildings) ? P.buildings[id] : 0);
  // An old unlock key, read against the save as its build wrote it.
  const met = (key) => {
    const [kind, id, n] = key.split(':');
    if (kind === 'feat') return feats.has(id);
    if (kind === 'challenge') return wonBefore.has(id);
    if (kind === 'building') return level(id) >= Number(n);
    if (kind === 'research') return strs(P.research?.done).includes(id);
    return false;
  };

  // ---- ruling 13: a challenge won is its order done (first: an arcana's old key can be a challenge's).
  const wonBefore = new Set([...strs(P.challenges), ...strs(O.challenges)]);
  for (const id of [...strs(P.challenges), ...strs(O.challenges)]) if (!feats.has(id)) { feats.add(id); did.push(`challenge:${id}`); }
  P.challenges = [];
  delete O.challenges;

  // ---- ruling 11: arcana are relics.
  const relicIds = new Set(data.relics.map((r) => r.id));
  const kept = new Set(strs(P.kept)), codex = new Set(strs(P.codex));
  let anyArcana = false;
  for (const [id, row] of Object.entries(RETIRED_ARCANA)) {
    if (!met(row.was) || !relicIds.has(row.relic)) continue;
    anyArcana = true;
    const relic = data.relics.find((r) => r.id === row.relic);
    // In the pool: the relic's own key, held when the save hasn't met it the relic's way. (A key
    // already met needs no holding; one that is 'starter' never does.)
    if (relic.unlock !== 'starter' && relic.unlock !== row.was && !met(relic.unlock) && !codex.has(`secret:${relic.unlock.split(':')[1]}`)) kept.add(relic.unlock);
    // Found: an arcana could be picked at the gate without ever meeting its relic in a run.
    if (!codex.has(`relic:${row.relic}`)) { codex.add(`relic:${row.relic}`); did.push(`arcana:${id}`); }
  }
  if (anyArcana) { P.kept = [...kept]; P.codex = [...codex]; P.heirloomHeld = true; }
  if (isObj(P.setup)) {
    const row = RETIRED_ARCANA[P.setup.arcana];
    if (row && relicIds.has(row.relic) && !P.setup.heirloom) { P.setup.heirloom = row.relic; did.push(`setup:${P.setup.arcana}`); }
    delete P.setup.arcana;
    if (P.setup.mode === 'challenge') P.setup.mode = 'standard';
    P.setup.challenge = '';
  }

  // ---- ruling 13: the bestiary's rungs. A trophy rung claimed or reached is the Hunt done; rungs
  // reached and not claimed pay what they would have.
  const claimed = isObj(P.bestiaryClaimed) ? P.bestiaryClaimed : {};
  const asideClaims = isObj(O.bestiaryClaimed) ? O.bestiaryClaimed : {};
  const rungs = {};
  for (const [enemy, ladder] of Object.entries(RETIRED_LADDERS)) {
    const kills = num(isObj(P.bestiary) ? P.bestiary[enemy] : 0);
    const had = Math.min(ladder.length, Math.max(num(claimed[enemy]), num(asideClaims[enemy])));
    const reached = ladder.filter((n) => kills >= n).length;
    for (let k = had; k < reached; k++) pay(RETIRED_RUNG_PAY[k], 1, rungs);
    const hunt = `hunt_${enemy}`;
    if (Math.max(had, reached) >= TROPHY_RUNG && (data.feats || []).some((f) => f.id === hunt) && !feats.has(hunt)) { feats.add(hunt); did.push(`hunt:${enemy}`); }
  }
  P.bestiaryClaimed = {};
  delete O.bestiaryClaimed;
  if (feats.size) P.feats = [...feats];

  // ---- ruling 12: tonics held are paid back.
  const refund = {};
  let tonics = 0;
  for (const held of [isObj(P.consumables) ? P.consumables : {}, isObj(O.consumables) ? O.consumables : {}]) {
    for (const [id, cost] of Object.entries(RETIRED_CONSUMABLES)) {
      const n = num(held[id]);
      if (n > 0) { pay(cost, n, refund); tonics += n; did.push(`consumable:${id}`); }
      delete held[id];
    }
  }

  // ---- D5: curses a Chapel level had opened stay open.
  const had = RETIRED_CURSES[Math.min(RETIRED_CURSES.length - 1, level('chapel'))];
  const chapel = data.buildings.find((b) => b.id === 'chapel');
  let now = 0;
  for (let i = 0; i < Math.min(level('chapel'), chapel?.levels.length ?? 0); i++) now = Math.max(now, chapel.levels[i].curses ?? 0);
  if (had > now) P.cursesHeld = had;

  // What the harbor says once, on the next visit.
  if (tonics > 0 || Object.keys(rungs).length) P.retiredNote = { ...(tonics > 0 ? { tonics, refund } : {}), ...(Object.keys(rungs).length ? { rungs } : {}) };
}

/** What a rune stone cost to cut at the Smithy (data/gear.js RUNE_STONE_COST, before ruling 14). */
export const RETIRED_RUNE_STONE = Object.freeze({ iron: 4, salt_glass: 6, drowned_pages: 70, coin: 230 });
/** The nine runes (ruling 14): the relic each became, or null where its effect is now a line on the weapons it fit. */
export const RETIRED_RUNES = Object.freeze({
  splitting: null, burning_ground: null, orbiting: null, backfire: null, chain_link: null, familiar: null, spillway: null,
  tarred: 'tarred', marsh_fever: 'marsh_fever',
});

/**
 * Version 2: ruling 14 removed runes. Every rune stone held is paid back at what it cost to cut,
 * the gate's last stone is cleared, and a rune the codex had seen is the relic it became (Tarred,
 * Marsh Fever) or goes: the other seven are lines on weapons now, with no entry of their own. The
 * keys that opened runes open relics now, under the same keys, so nothing a profile opened is lost.
 */
function retireRunes(doc, data, did) {
  const P = doc.profile;
  const O = isObj(P.orphans) ? P.orphans : {};
  if (!isObj(P.materials)) P.materials = {};
  const refund = {};
  let stones = 0;
  for (const held of [isObj(P.consumables) ? P.consumables : {}, isObj(O.consumables) ? O.consumables : {}]) {
    for (const key of Object.keys(held)) {
      if (!key.startsWith('rune:')) continue;
      const n = num(held[key]);
      if (n > 0) {
        for (const [id, c] of Object.entries(RETIRED_RUNE_STONE)) { P.materials[id] = num(P.materials[id]) + c * n; refund[id] = (refund[id] ?? 0) + c * n; }
        stones += n;
        did.push(`rune_stone:${key.slice(5)}`);
      }
      delete held[key];
    }
  }
  if (isObj(P.setup)) P.setup.rune = '';
  const relicIds = new Set(data.relics.map((r) => r.id));
  for (const bucket of [P, O]) {
    if (!Array.isArray(bucket.codex)) continue;
    const out = [];
    for (const k of bucket.codex) {
      if (typeof k !== 'string' || !k.startsWith('rune:')) { out.push(k); continue; }
      const relic = RETIRED_RUNES[k.slice(5)];
      if (relic && relicIds.has(relic) && !out.includes(`relic:${relic}`) && !strs(P.codex).includes(`relic:${relic}`)) { out.push(`relic:${relic}`); did.push(`rune:${k.slice(5)}`); }
    }
    bucket.codex = out;
  }
  if (stones > 0) P.retiredNote = { ...(isObj(P.retiredNote) ? P.retiredNote : {}), stones, stoneRefund: refund };
}
