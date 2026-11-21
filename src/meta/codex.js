// The codex (0.9.0, W5; brief §6.8: "every weapon, relic, and passive, with blanks for
// undiscovered ones"; the veteran round's meta judge: no codex or collection screen). Read at the
// Library. Pure; tested in Node.
//
// Seven groups: weapons, passives, relics (seen once a run's build carried them: the
// profile's codex keys), enemies and bosses (seen once killed: the bestiary), and maps (seen once
// open). A thing not seen yet is a blank with a hint: where it comes from, in the same words the
// harbor uses for an unlock key (meta/actions.js unlockText). Its line once seen is its own
// description, and its flavor (`lore`, or the Library project that found it).
//
// The sweep, ruling 13 (two books: the glossary says what a term does, the codex what you've found).
// An enemy's and a boss's entry carries `kills` (over every run; the bestiary screen went) and, when
// the enemy has a Hunt on the Harbor Orders board, `hunt: { name, count, done }`. And the codex can
// be read for one map (`map`): that map's enemies, bosses, and secrets, and first the things it has
// shown (lamps, bells, high water: profile.seen, each a glossary entry by data/meta.js fieldGuide).
// That is the pause menu's book in a run; the field guide was a second copy of these entries.

import { killsOf, mapOpen, mapMissing, contentOpen, secretsOf, seenOn, seenAnywhere, featsDone, weaponPieces, contentFrom } from './state.js';
import { fieldGuideEntry } from '../data/glossary.js';
import { unlockText, mapKeysText } from './actions.js';

export const CODEX_GROUPS = Object.freeze([
  ['weapon', 'Weapons'], ['passive', 'Passives'], ['relic', 'Relics'],
  ['enemy', 'Enemies'], ['boss', 'Bosses'], ['map', 'Maps'], ['secret', 'Secrets'],
]);
/** The groups of one map's codex (the pause menu's): what the map has shown first. */
export const MAP_CODEX_GROUPS = Object.freeze([['place', 'On this map'], ['enemy', 'Enemies'], ['boss', 'Bosses'], ['secret', 'Secrets']]);

const isBoss = (e) => !!e.boss || (e.tags || []).includes('boss');

/** Where an enemy is met: the maps whose timeline names it (a band's roster or an event). */
function mapsOf(data, enemyId) { return mapsWith(data, enemyId).map((m) => m.name); }
function mapsWith(data, enemyId) {
  return data.maps.filter((m) => {
    const t = m.timeline || {};
    const bands = Array.isArray(t) ? t : [...(t.bands || []), ...(t.events || [])];
    return bands.some((b) => b.enemy === enemyId || (b.roster && Object.prototype.hasOwnProperty.call(b.roster, enemyId)));
  });
}

/** The flavor a thing has: its own `lore`, else the Library project that found it ("From Orbwright's Notes: ..."). */
function loreOf(data, x) {
  if (typeof x.lore === 'string') return x.lore;
  const r = typeof x.unlock === 'string' && x.unlock.startsWith('research:') ? data.research.find((p) => p.id === x.unlock.slice(9)) : null;
  return r ? `From ${r.name}: ${r.desc}` : null;
}

/** How a blank says where it comes from. */
function hintFor(doc, data, x) {
  // A character's own weapon (the sweep, A7: its blank read "something not in this version").
  const owner = x.signature ? data.characters.find((c) => c.id === x.signature || c.signature === x.id) : null;
  if (owner) return `The ${owner.name}'s signature weapon. Play a run as the ${owner.name} to see it`;
  if (x.unlock === 'starter' || contentOpen(doc, data, x.unlock)) return 'Can turn up in your runs now';
  const where = unlockText(data, x.unlock);
  return where ? `Opens with ${where}` : 'Not found yet';
}

/**
 * Every codex entry for this profile: [{ group, id, name, seen, icon, desc, lore, hint, kills?, hunt? }],
 * in the groups' order and each group in the data's order. A blank has `seen: false`, no name ('???'
 * shows), and its hint. With `map` (a map id): that map's codex (MAP_CODEX_GROUPS).
 */
export function codexEntries(doc, data, map = null) {
  const keys = new Set(Array.isArray(doc?.profile?.codex) ? doc.profile.codex : []);
  const met = seenAnywhere(doc), done = featsDone(doc, data);
  const out = [];
  const add = (group, x, seen, extra, more = null) => out.push({ group, id: x.id, name: x.name, seen, icon: x.icon ?? x.sprite ?? null, desc: seen ? (x.desc ?? '') : '', lore: seen ? loreOf(data, x) : null, hint: seen ? null : extra, ...(more || {}) });
  /** An enemy's count and its Hunt (data/trophies.js: the order whose `when.enemyTotal` names it). */
  const tally = (e) => {
    const hunt = (data.feats || []).find((f) => f.when?.enemyTotal && Object.prototype.hasOwnProperty.call(f.when.enemyTotal, e.id));
    return { kills: killsOf(doc, e.id), ...(hunt ? { hunt: { name: hunt.name, count: hunt.when.enemyTotal[e.id], done: done.has(hunt.id) } } : {}) };
  };
  const enemySeen = (e) => killsOf(doc, e.id) > 0 || met.has(`enemy:${e.id}`);
  const here = (e) => !map || mapsWith(data, e.id).some((m) => m.id === map);
  if (map) {
    // What this map has shown, in the order met: each thing's glossary entry (one description).
    for (const key of seenOn(doc, map)) {
      if (key.startsWith('enemy:')) continue;
      const g = fieldGuideEntry(data.meta, key);
      if (g) add('place', { id: key, name: g.name, desc: g.line }, true, null);
    }
  } else {
    for (const w of data.weapons.filter((x) => !x.innate)) add('weapon', w, keys.has(`weapon:${w.id}`), hintFor(doc, data, w));
    for (const p of data.passives) add('passive', p, keys.has(`passive:${p.id}`), hintFor(doc, data, p));
    for (const r of data.relics) add('relic', r, keys.has(`relic:${r.id}`), hintFor(doc, data, r));
  }
  for (const e of data.enemies.filter((x) => !isBoss(x) && here(x))) {
    const where = mapsOf(data, e.id);
    add('enemy', e, enemySeen(e), where.length ? `Found on the ${where.join(' and the ')}` : 'Not met yet', tally(e));
  }
  for (const e of data.enemies.filter((x) => isBoss(x) && here(x))) {
    const where = mapsOf(data, e.id);
    add('boss', e, enemySeen(e), where.length ? `Waits on the ${where.join(' and the ')}` : 'Not met yet', tally(e));
  }
  if (!map) {
    for (const m of data.maps) {
      const missing = mapMissing(doc, data, m.id);
      add('map', m, mapOpen(doc, data, m.id), missing.length ? `Opens with ${mapKeysText(data, missing)}` : 'Open');
    }
  }
  const secrets = map ? (data.maps.find((m) => m.id === map)?.secrets || []) : secretsOf(data);
  for (const sc of secrets) add('secret', { ...sc, desc: sc.hint ?? '' }, keys.has(`secret:${sc.id}`), 'Somewhere off the paths. The Cartographer has hints');
  return out;
}

/** How much of the codex (or of one map's) is seen: { seen, of, groups: [{ group, name, seen, of }] }. */
export function codexCount(doc, data, map = null) {
  const all = codexEntries(doc, data, map);
  const groups = (map ? MAP_CODEX_GROUPS : CODEX_GROUPS).map(([group, name]) => {
    const g = all.filter((x) => x.group === group);
    return { group, name, seen: g.filter((x) => x.seen).length, of: g.length };
  }).filter((g) => g.of > 0);
  return { seen: all.filter((x) => x.seen).length, of: all.length, groups };
}

/** How each Form axis reads on a weapon's page (the screens' words). */
const AXIS_NAME = Object.freeze({ delivery: 'First Form', flight: 'Second Form', payoff: 'Final Form' });

/**
 * A weapon's codex page (C3, ruling 18 P1): what it can take in a run, each ticked once a run has
 * taken it (profile.codex 'took:<weapon>:<id>', meta/apply.js), and its three Harbor Orders.
 * { id, name, icon, desc, seen, axes: [{ axis, label, options: [{ id, name, desc, price, taken }] }],
 *   specials: [{ id, name, desc, taken }], lines: [{ id, name, desc, rarity, shared, taken }],
 *   orders: [{ id, name, desc, done, opens }], taken, of }.
 */
export function weaponPage(doc, data, weaponId) {
  const w = data.weapons.find((x) => x.id === weaponId);
  if (!w) return null;
  const keys = new Set(Array.isArray(doc?.profile?.codex) ? doc.profile.codex : []), done = featsDone(doc, data);
  const took = (id) => keys.has(`took:${weaponId}:${id}`);
  const pieces = weaponPieces(data, weaponId).map((x) => ({ ...x, taken: took(x.id) }));
  const axes = ['delivery', 'flight', 'payoff'].map((axis) => ({ axis, label: AXIS_NAME[axis], options: pieces.filter((x) => x.kind === 'option' && x.axis === axis) })).filter((a) => a.options.length);
  const orderIds = [`kit_${weaponId}`, `${weaponId}_both`, `${weaponId}_master`];
  const orders = orderIds.map((id) => (data.feats || []).find((f) => f.id === id)).filter(Boolean).map((f) => {
    const opens = contentFrom(data, `feat:${f.id}`)[0] ?? null;
    return { id: f.id, name: f.name, desc: f.desc, done: done.has(f.id), opens: opens ? opens.name : null };
  });
  return {
    id: w.id, name: w.name, icon: w.icon, desc: w.desc, seen: keys.has(`weapon:${w.id}`), axes,
    specials: pieces.filter((x) => x.kind === 'special'), lines: pieces.filter((x) => x.kind === 'line'), orders,
    taken: pieces.filter((x) => x.taken).length, of: pieces.length,
  };
}
