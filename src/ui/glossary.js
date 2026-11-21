// The glossary (0.9.0, W7): every term the game uses, one plain entry each (data/glossary.js),
// and the screen that lists them. Reachable from the pause menu, the harbor's menu, and the title,
// and from any card, notice, or panel that names a term with one button (the 'glossary' action:
// L2, LT, or G): termsIn finds the term in the focused element's words (ui/screens.js).
//
// termsIn is pure and tested: a whole-word match against every entry's name and aliases, longest
// first, with the names of the game's content masked out first, so "Tide Bell" (a weapon) never
// reads as "Tide", nor "Lantern Orb" as a lamp. A content name that is itself a glossary word
// written another way (a Form called "Wards", say, beside the term "wards") masks only its
// own spelling: "Wards" on a card is the Form, "wards" in a sentence the term (the sweep, B1; no
// other name is shared: tests/content.test.js).

import { h, fill } from './dom.js';
import { createFocusScope } from './focus.js';
import { hintRow, bandList } from './hints.js';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The content whose names mask glossary words (a weapon called "Tide Bell" isn't a Tide). */
function maskNames(data) {
  const lists = ['weapons', 'passives', 'relics', 'runes', 'enemies', 'characters', 'maps', 'research', 'upgrades', 'recipes', 'consumables', 'trophies', 'curses', 'feats', 'skills', 'kits', 'affixes', 'npcs'];
  const out = [];
  for (const k of lists) for (const x of data[k] || []) if (typeof x?.name === 'string' && x.name.length > 2) out.push(x.name.replace(/^The /, ''));
  // Forms, a weapon's own special, and a map's events are names on cards and notices too.
  for (const l of data.ascensions || []) for (const o of l.options || []) if (typeof o?.name === 'string' && o.name.length > 2) out.push(o.name);
  for (const w of data.weapons || []) if (typeof w?.special?.name === 'string') out.push(w.special.name);
  for (const m of data.maps || []) for (const e of m.deck || []) if (typeof e?.name === 'string') out.push(e.name.replace(/^The /, ''));
  return out;
}

const cache = new WeakMap();
/** The matcher for a data bundle: one regex over every term and every masked name, longest first. */
function matcherFor(data) {
  let m = cache.get(data);
  if (m) return m;
  const entries = data.glossary || [];
  const words = new Map();   // lower-cased phrase -> entry id, or '' for a masked content name
  const terms = new Set();
  for (const e of entries) for (const w of [e.name, ...(e.aliases || [])]) { const k = w.toLowerCase(); if (!words.has(k)) words.set(k, e.id); terms.add(k); }
  // The glossary's own spellings, and the content names that are a glossary word spelled another way.
  const spellings = new Set(entries.flatMap((e) => [e.name, ...(e.aliases || [])]));
  const exact = new Set();
  for (const n of maskNames(data)) { const k = n.toLowerCase(); if (!terms.has(k)) words.set(k, ''); else if (!spellings.has(n)) exact.add(n); }
  const list = [...words.keys()].sort((a, b) => b.length - a.length);
  const re = list.length ? new RegExp(`(?<![\\w'])(${list.map(escape).join('|')})(?![\\w'])`, 'gi') : null;
  m = { re, words, exact, byId: new Map(entries.map((e) => [e.id, e])) };
  cache.set(data, m);
  return m;
}

/** The glossary entries a line of text names, in the order they first appear (ids, each once). */
export function termsIn(text, data) {
  const { re, words, exact } = matcherFor(data);
  if (!re || typeof text !== 'string' || !text) return [];
  const out = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (exact.has(m[1])) continue;   // a content name in its own spelling ("Wards", the Form)
    const id = words.get(m[1].toLowerCase());
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// The words that name a kind of thing (on every card's sub-line: "New weapon", "Lv 3"), not what is hard
// about it: the button skips them when the line names anything else (RULING-L1: G on a card opens the
// card's hardest term, not "Weapon").
const GENERIC = new Set(['weapon', 'passive', 'relic', 'levelup', 'dash', 'dash_item', 'xp', 'run', 'chest', 'rarity', 'material']);

// The statuses and mechanics every bullet heaven shares (round 2, L3 1): a player who knows the genre
// knows these, so the button prefers the game's own words over them, and them over the stats.
const STATUS = new Set(['burn', 'slow', 'freeze', 'rot', 'daze', 'gaff', 'lost', 'chain', 'pierce', 'crit', 'hit_delay', 'knockback', 'reroll', 'banish', 'skip', 'elite', 'boss']);

/** How hard a term is for a new player: 0 the game's own words, 1 a status, 2 a stat, 3 a kind word. */
function rank(id, data) {
  if (GENERIC.has(id)) return 3;
  const e = matcherFor(data).byId.get(id);
  if (e?.kind === 'stat') return 2;
  return STATUS.has(id) ? 1 : 0;
}

/**
 * The term the glossary's button opens for a line (round 2, L3 1): the game's own words first (Tag
 * bonus, Final Form goal, Repeat Damage cards), then statuses, then stats, then kind words; within
 * one rank, the first in the line.
 */
export function hardestTerm(text, data) {
  const ids = termsIn(text, data);
  let best = null, bestRank = 9;
  for (const id of ids) { const r = rank(id, data); if (r < bestRank) { best = id; bestRank = r; } }
  return best;
}

/** One entry by id (null for none). */
export function glossaryEntry(data, id) {
  return matcherFor(data).byId.get(id) ?? null;
}

/** The entries in their groups' order (data/glossary.js GLOSSARY_KINDS), each group as the data lists it. */
export function glossaryGroups(data, kinds) {
  const entries = data.glossary || [];
  return kinds.map(([kind, label]) => ({ kind, label, entries: entries.filter((e) => e.kind === kind) })).filter((g) => g.entries.length);
}

/**
 * The glossary screen: the terms in their groups down the left, the focused one's entry on the
 * right (what it does, then where it comes from). `initial`: the entry to open at (an id), or the
 * first. Back closes it.
 */
export function glossaryScreen(ctx, { data, kinds, initial = null, onBack, seen = null }) {
  const groups = glossaryGroups(data, kinds);
  const detail = h('div', { class: 'gloss-detail' });
  const rows = [];
  // RULING-L1: an entry for a character or a map the profile hasn't met yet shows grayed, "Not seen
  // yet" (`seen(entry)`: the app's answer; without one, everything counts as seen).
  const isSeen = (e) => !e.only || !seen || seen(e);
  for (const g of groups) {
    rows.push(h('h2', { class: 'gloss-group' }, g.label));
    for (const e of g.entries) rows.push(h('div', { class: `list-row gloss-row${isSeen(e) ? '' : ' unseen'}`, data: { focus: `t:${e.id}` }, 'aria-disabled': 'true' }, h('span', { class: 'row-name' }, e.name)));
  }
  const show = (id) => {
    const e = glossaryEntry(data, id);
    if (!e) { fill(detail); return; }
    fill(detail, h('div', { class: 'gloss-name' }, e.name),
      isSeen(e) ? null : h('p', { class: 'gloss-where' }, 'Not seen yet.'),
      h('p', { class: 'gloss-desc' }, e.desc),
      e.more ? h('p', { class: 'gloss-desc gloss-more' }, h('span', { class: 'gloss-label' }, 'More: '), e.more) : null,
      e.where ? h('p', { class: 'gloss-where' }, h('span', { class: 'gloss-label' }, 'Where: '), e.where) : null);
  };
  const el = h('div', { class: 'screen glossary-screen' }, h('div', { class: 'panel' },
    h('h1', null, 'Glossary'),
    h('div', { class: 'gloss-body' }, h('div', { class: 'gloss-list' }, bandList({ class: 'list' }, ...rows)), detail),
    // A Back button on the screen (the sweep, S3b F10: with Back's button given away, nothing on the
    // pad closed the glossary). Down from the list reaches it.
    h('div', { class: 'action-row' }, h('button', { class: 'btn', type: 'button', data: { focus: 'back' }, onclick: () => onBack() }, 'Back')),
    hintRow(ctx, ['back', 'Back'])));
  const first = groups[0]?.entries[0]?.id;
  const start = initial && glossaryEntry(data, initial) ? initial : first;
  const scope = createFocusScope(el, {
    initial: start ? `t:${start}` : null,
    onFocus: (t) => { const k = t.dataset.focus || ''; if (k.startsWith('t:')) show(k.slice(2)); },
  });
  show(start);
  return { el, scope, onBack, isGlossary: true, ignoreMs: 150 };
}
