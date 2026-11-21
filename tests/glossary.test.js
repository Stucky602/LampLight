// The glossary (0.9.0, W7; Kevin, Nov 8: "I don't even know what the lamp that is being lit
// actually does now"): every term the screens use has one plain entry (data/glossary.js), the
// entries are sound and found in a line of text by their words (ui/glossary.js termsIn), the
// screen lists them and opens at a term, the glossary's button on any screen opens the focused
// element's term, and the title, the pause menu, and the harbor's menu each have a Glossary button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDocument } from './helpers/fakedom.js';
import { DATA } from '../src/data/index.js';
import { termsIn, glossaryEntry, glossaryGroups, glossaryScreen } from '../src/ui/glossary.js';
import { levelEffects } from '../src/ui/hubtext.js';
import { STAT_NAME } from '../src/ui/describe.js';
import { TIP_TEXT } from '../src/app/runtips.js';
import { SETTING_DESCS } from '../src/app/settings-flow.js';

const G = DATA.glossary;

test('glossary: every entry has an id, a name, a group, what it does, and where it comes from; no two share a word', () => {
  const kinds = new Set(DATA.glossaryKinds.map(([k]) => k));
  const ids = new Set(), words = new Map();
  for (const e of G) {
    assert.match(e.id, /^[a-z_]+$/, e.id);
    assert.ok(!ids.has(e.id), `${e.id} twice`); ids.add(e.id);
    assert.ok(kinds.has(e.kind), `${e.id}: group ${e.kind}`);
    assert.ok(typeof e.name === 'string' && e.name.length > 1, e.id);
    assert.match(e.desc, /^[A-Z].*\.$/s, `${e.id}: what it does is sentences`);
    assert.match(e.where, /^[A-Z].*\.$/s, `${e.id}: where it comes from is sentences`);
    for (const w of [e.name, ...(e.aliases || [])]) {
      const k = w.toLowerCase();
      assert.ok(!words.has(k), `"${w}" names both ${words.get(k)} and ${e.id}`);
      words.set(k, e.id);
    }
  }
  // Each group has something in it, and the screen lists every entry once.
  const listed = glossaryGroups(DATA, DATA.glossaryKinds).flatMap((g) => g.entries.map((e) => e.id));
  assert.deepEqual(listed.slice().sort(), [...ids].sort());
});

test('glossary: the terms Kevin listed, every building, and every relic tier have an entry', () => {
  const must = ['Tide', 'Pearls', 'Form', 'Ember', 'Tide Shield', 'Lantern Night', 'Reliquary', 'the Ferryman', 'the Well', 'Final Form goal', 'Dash slot', 'Common', 'materials', 'Wayside Lamp', 'Fog Bell', 'research', 'curse', 'Heirloom', 'run tool', 'challenge run', 'Hunt', 'codex', 'Tag bonus', 'Stunned', 'Hooked', 'Drawback', 'Fuel', 'Signature weapon', 'Repeat Damage cards'];   // (RULING-L1's names)
  for (const t of must) assert.equal(termsIn(`About ${t} here.`, DATA).length, 1, `"${t}" has an entry`);
  for (const b of DATA.buildings) assert.ok(glossaryEntry(DATA, b.id), `the ${b.name} has an entry`);
  // The lamp's entry says what a lit lamp does today (sim/tasks.js: its light burns, marks drops, pays Pearls, readies Lantern Night).
  const lampE = glossaryEntry(DATA, 'lamp'), lamp = `${lampE.desc} ${lampE.more}`;
  for (const w of ['light', 'burns', 'Pearls', 'Lantern Night', 'circle']) assert.ok(lamp.includes(w), `the lamp's entry says "${w}"`);
  assert.ok(lamp.includes(`${DATA.tuning.tasks.ward.killSec}s`), 'and how fast its light kills, from the tuning');
});

test('glossary: a line names a term by its words, the game\'s own content names masked (Tide Bell is a weapon, not a Tide)', () => {
  assert.deepEqual(termsIn('Tide 1 is open on the Drowned Docks. Pick it at the gate', DATA), ['tide', 'gate']);
  assert.deepEqual(termsIn('New weapon: Tide Bell', DATA), ['weapon']);
  assert.deepEqual(termsIn('Lamp 2 of 5 lit: enemies in its light burn, 6 Pearls', DATA), ['lamp', 'burn', 'pearls'], 'burn: a status (C3)');
  assert.deepEqual(termsIn('Lantern Night is ready. It falls when the crowd closes in', DATA), ['lantern_night']);
  assert.deepEqual(termsIn('Restore the Lamp Post to Lv 2', DATA), ['restore', 'lamp_post']);
  assert.deepEqual(termsIn('Lantern Orb Lv 3', DATA), [], 'a weapon named Lantern is no lamp');
  assert.deepEqual(termsIn('', DATA), []);
  assert.deepEqual(termsIn(null, DATA), []);
});

// ------------------------------------------------------------------------------ the screens' words

/** The game's own names: content (skills too: C2, ruling 19), materials, buildings, stats, tags, and the glossary's words. */
function knownWords() {
  const names = [];
  for (const k of ['weapons', 'passives', 'relics', 'runes', 'enemies', 'characters', 'maps', 'research', 'upgrades', 'recipes', 'consumables', 'trophies', 'curses', 'feats', 'perks', 'kits', 'affixes', 'npcs', 'materials', 'buildings', 'skills']) {
    for (const x of DATA[k] || []) if (x?.name) names.push(x.name);
  }
  for (const e of G) names.push(e.name, ...(e.aliases || []));
  names.push(...Object.values(STAT_NAME), 'Light', 'Fire', 'Sea', 'Steel', 'Echo', 'Frost', 'Rot', 'Tide');
  const words = new Set();
  for (const n of names) for (const w of n.replace(/^The /, '').split(/[\s,()]+/)) if (/^[A-Z]/.test(w)) words.add(w.replace(/'s$/, ''));
  return words;
}

/**
 * Words a screen capitalizes mid-sentence that aren't game terms: the controller's and keyboard's
 * buttons, units, the names of screens and their buttons, and plain words in a label. A new term
 * of the game's goes in data/glossary.js, never here.
 */
const PLAIN = new Set([
  'Lv', 'HP', 'XP', 'MAX', 'A', 'Confirm', 'Ctrl', 'DPS', 'Esc', 'Enter', 'Space', 'Shift', 'Tab', 'R1', 'RB', 'L1', 'LB', 'L2', 'LT', 'Hold', 'Options', 'Menu', 'Create', 'View',
  'PlayStation', 'Xbox', 'Keyboard', 'Controller', 'Auto', 'On', 'Off', 'F1', 'F3', 'F11', 'WASD', 'Downloads', 'Windows', 'Lamplight', 'Electron',
  'Start', 'Continue', 'Resume', 'Restore', 'Settings', 'Credits', 'Quit', 'Back', 'Cancel', 'Stay', 'Import', 'Export', 'Paste', 'Discard', 'Done', 'Glossary', 'Stats',
  'Results', 'Run', 'Ready', 'Complete', 'Need', 'New', 'Next', 'Tier', 'Level', 'Rank', 'Mastery', 'Up', 'Down', 'Left', 'Right', 'Change', 'Select', 'Close',
  'Fullscreen', 'Borderless', 'Windowed', 'Stretch', 'Reliquaries', 'Bells', 'Lamps', 'Relics', 'Secret', 'Secrets', 'Time', 'Kills', 'Bosses', 'Paused', 'Error',
  'Pick', 'Killed', 'Unseen', 'Nothing', 'None', 'Includes', 'Where', 'Lantern', 'Wayside', 'Fog', 'Bell', 'Salt', 'Well', 'Night', 'Lamp', 'Post', 'First', 'Old', 'Grey',
]);

/** Mid-sentence capitalized words in a line (after a lowercase word, so a sentence's first word and a label don't count). */
function midTerms(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?:^|[^.:!?]\s)[a-z][a-z'-]*\s+((?:the\s+)?[A-Z][A-Za-z'-]*)/g)) {
    const w = m[1].replace(/^the\s+/, '').replace(/'s$/, '');
    out.push(w);
  }
  return out;
}

const SCREEN_FILES = ['src/ui', 'src/app', 'src/app/scenes'].flatMap((dir) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`));
function literals(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const out = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const s = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\$\{[^}]*\}/g, 'x');
    if (/^[A-Z][a-z' ]/.test(s) && s.includes(' ')) out.push(s);
  }
  return out;
}

test('glossary: every term the screens use has an entry (a capitalized word mid-sentence is a name the game knows, or plain)', () => {
  const lines = [];
  for (const f of SCREEN_FILES) lines.push(...literals(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).map((t) => [f, t]));
  for (const b of DATA.buildings) {
    lines.push([`building ${b.id}`, b.desc]);
    for (let lv = 1; lv <= b.levels.length; lv++) for (const e of levelEffects(DATA, b.id, lv)) lines.push([`${b.id} Lv ${lv}`, e.text]);
  }
  for (const t of Object.values(TIP_TEXT)) lines.push(['tip', t]);
  for (const [k, t] of Object.entries(SETTING_DESCS)) lines.push([`setting ${k}`, t]);
  for (const e of G) lines.push([`glossary ${e.id}`, e.desc], [`glossary ${e.id}`, e.where]);
  assert.ok(lines.length > 200, `${lines.length} lines read`);
  const known = knownWords();
  const missing = new Map();
  for (const [where, t] of lines) for (const w of midTerms(t)) if (!known.has(w) && !PLAIN.has(w)) missing.set(w, `${where}: "${t}"`);
  assert.deepEqual([...missing.entries()].map(([w, at]) => `${w} (${at})`), [], 'a term with no glossary entry: add one to data/glossary.js');
});

test('glossary: the check catches a term with no entry', () => {
  assert.deepEqual(midTerms('Stay in the ring and Kindled burns them'), ['Kindled']);
  assert.ok(!knownWords().has('Kindled'));
  assert.deepEqual(midTerms('Pick it at the Chapel'), ['Chapel']);
});

// ------------------------------------------------------------------------------ the screen

function ctxFor() {
  return { ui: { glyph: (a) => { const s = document.createElement('span'); s.textContent = a; return s; } }, icon: () => document.createElement('span'), sound: () => {} };
}

test('glossary: the screen lists every entry by group and opens at a term, with its entry beside the list', () => {
  installFakeDocument();
  let backs = 0;
  const s = glossaryScreen(ctxFor(), { data: DATA, kinds: DATA.glossaryKinds, initial: 'lamp', onBack: () => backs++ });
  document.body.appendChild(s.el);
  s.scope.refresh();
  assert.equal(s.scope.current.dataset.focus, 't:lamp');
  const detail = s.el.querySelector('.gloss-detail').textContent;
  assert.ok(detail.startsWith('Wayside Lamp'), detail);
  assert.ok(detail.includes('Where: Each act brings 4 or 5'), detail);
  assert.equal(s.el.querySelectorAll('.gloss-row').length, G.length);
  s.onBack();
  assert.equal(backs, 1);
  // An id it doesn't know opens at the first entry.
  const t = glossaryScreen(ctxFor(), { data: DATA, kinds: DATA.glossaryKinds, initial: 'nope', onBack() {} });
  document.body.appendChild(t.el);
  t.scope.refresh();
  assert.equal(t.scope.current.dataset.focus, `t:${glossaryGroups(DATA, DATA.glossaryKinds)[0].entries[0].id}`);
});

test('glossary: the title, the pause menu, and the harbor\'s menu each have a Glossary button', async () => {
  installFakeDocument();
  const { titleScreen, pauseScreen } = await import('../src/ui/menus.js');
  const { hubMenuScreen } = await import('../src/ui/hubscreens.js');
  const opened = [];
  const ctx = ctxFor();
  const title = titleScreen(ctx, { build: 'Build x', onStart() {}, onSettings() {}, onCredits() {}, onGlossary: () => opened.push('title') });
  const pause = pauseScreen(ctx, { build: { time: '1:00', weapons: [], passives: [], relics: [], materials: [] }, onResume() {}, onSettings() {}, onReport() {}, onLeave() {}, onGlossary: () => opened.push('pause') });
  const hub = hubMenuScreen(ctx, { onResume() {}, onSetOut() {}, onSettings() {}, onTitle() {}, onGlossary: () => opened.push('harbor') });
  for (const s of [title, pause, hub]) s.el.querySelector('[data-focus="glossary"]').click();
  assert.deepEqual(opened, ['title', 'pause', 'harbor']);
});

test('glossary: its button on any screen opens the focused element\'s term (ui/screens.js), and a hint names it', async () => {
  installFakeDocument();
  const { createUi } = await import('../src/ui/screens.js');
  const { createFocusScope } = await import('../src/ui/focus.js');
  const fired = new Set();
  const input = { promptStyle: 'keyboard', fired: (a) => fired.has(a), nav: () => false, down: () => false, heldMs: () => 0, releaseAll() {}, glyph: (a) => (a === 'glossary' ? 'G' : a) };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = createUi({ root, input, doc: document });
  const opened = [];
  ui.setGlossary({ data: DATA, open: (id) => opened.push(id) });
  const el = document.createElement('div');
  const a = document.createElement('div'); a.dataset.focus = 'a'; a.textContent = 'Tide 1 is open on the Drowned Docks';
  const b = document.createElement('div'); b.dataset.focus = 'b'; b.textContent = 'Spend Pearls with the Ferryman';
  el.appendChild(a); el.appendChild(b);
  const scope = createFocusScope(el, { initial: 'b' });
  ui.push({ el, scope });
  ui.update(16);
  const hint = root.querySelector('.gloss-hint');
  assert.equal(hint.hidden, false);
  assert.ok(hint.textContent.includes('Glossary: Pearls'), hint.textContent);
  fired.add('glossary');
  ui.update(16);
  assert.deepEqual(opened, ['pearls']);
  // A screen that is the glossary doesn't open another.
  fired.clear();
  ui.push({ el: document.createElement('div'), scope: null, isGlossary: true });
  fired.add('glossary');
  ui.update(16);
  assert.deepEqual(opened, ['pearls']);
});
