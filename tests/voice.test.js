// The words the player reads, checked against docs/WRITING.md §8: every name, description, and
// line in the data, every string the text builders make from the shipped content, and the string
// literals in the screen code. What a machine can't judge (whether a line sounds like a person)
// is the review's job; what it can (a banned word, an exclamation mark, "The Library", a stat line
// without its sign, a five-word button) fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { cardInfo } from '../src/ui/describe.js';
import { levelEffects, changeLines, optionText, costText, researchState, upgradeState } from '../src/ui/hubtext.js';
import { whyNotRestore, whyNotUpgrade, whyNotResearch, startResearch } from '../src/meta/actions.js';
import { purchaseOptions } from '../src/meta/next.js';
import { waitingReason } from '../src/meta/apply.js';
import { promptFor, runHeading, lineFor } from '../src/app/hublogic.js';
import { runSummary, settingRefusal } from '../src/app/runlogic.js';

// §1: the house voice's banned words and constructions. ("unlock" is the game verb here, so it
// isn't on the list; "navigate" as a metaphor is, and no screen needs the literal one.)
const BANNED = [
  'delve', 'leverage', 'robust', 'seamless', 'crucial', 'ensure', 'comprehensive', 'foster', 'streamline',
  'journey', 'empower', 'pivotal', 'navigate', 'harness', 'elevate', 'realm', 'tapestry', 'testament',
  "it's important to note", 'moreover', 'furthermore', 'additionally', 'ultimately', 'the key is',
  'not just', 'not only', 'think of it as', 'genuinely',
];
const BANNED_RE = new RegExp(`\\b(${BANNED.map((w) => w.replace(/'/g, "['’]")).join('|')})\\b`, 'i');

/** Everything wrong with one line under §1 and §2, as reasons (empty when it's fine). */
function faults(text) {
  const out = [];
  const m = text.match(BANNED_RE);
  if (m) out.push(`"${m[1]}" is on the banned list`);
  if (text.includes('!')) out.push('an exclamation mark');
  if (text.includes('—')) out.push('an em dash');
  if (/\b(you|your) (held out|came back|cleared|reached|longest)\b/i.test(text)) out.push('narrates the player (§2.3)');
  if (/\bClaude\b/.test(text)) out.push('names Claude (a game\'s screens name no helper; the credits do)');
  if (/\((fire|light|steel|tide|echo|frost)\b/.test(text)) out.push('a tag in lowercase (tags are names: "(Fire)")');
  return out;
}

function checkAll(lines, where) {
  const bad = [];
  for (const [label, text] of lines) {
    if (typeof text !== 'string') continue;
    for (const f of faults(text)) bad.push(`${where} ${label}: ${f}: "${text}"`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
}

// ------------------------------------------------------------------------------ the data

const TEXT_KEYS = new Set(['name', 'desc', 'hubLine', 'text']);
const SKIP = new Set(['tuning', 'hubTuning', 'sfx', 'palette']);

function dataLines() {
  const out = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${x?.id ?? i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && TEXT_KEYS.has(k)) out.push([`${path}.${k}`, x]);
      else if (typeof x === 'object') walk(x, `${path}.${k}`);
    }
  };
  for (const [k, v] of Object.entries(DATA)) if (!SKIP.has(k)) walk(v, k);
  return out;
}

test('voice: every name, description, and line in the data', () => {
  const lines = dataLines();
  assert.ok(lines.length > 150, `${lines.length} lines read`);
  checkAll(lines, 'data');
});

test('voice: the credits', async () => {
  const { CREDITS } = await import('../src/data/credits.js');
  const lines = CREDITS.flatMap((c) => [['what', c.what], ['who', c.who.replace(/\bClaude\b/, 'C')], ['license', c.license]]);
  checkAll(lines, 'credits');
  assert.deepEqual(CREDITS.filter((c) => /^[a-z]/.test(c.who) || /^[a-z]/.test(c.license)).map((c) => c.what), [], 'a credit is a list entry, capitalized');
});

test('voice: buildings, maps, characters, and everything you pick go by their names without "The"; bosses keep theirs', () => {
  const named = [
    ...DATA.buildings, ...DATA.maps, ...DATA.characters, ...DATA.weapons, ...DATA.passives, ...DATA.relics,
    ...DATA.runes, ...DATA.research, ...DATA.upgrades, ...DATA.materials, ...DATA.npcs,
    ...DATA.enemies.filter((e) => !e.tags.includes('boss')), DATA.hub, DATA.hub.gate,
  ];
  const bad = named.filter((x) => /^The /.test(x.name)).map((x) => x.name);
  assert.deepEqual(bad, []);
  assert.ok(DATA.enemies.filter((e) => e.tags.includes('boss')).every((e) => /^The /.test(e.name)), 'bosses have titles');
});

test('voice: a description of something you pick says what it does, never "your" (§6)', () => {
  const picks = [...DATA.weapons, ...DATA.passives, ...DATA.relics, ...DATA.runes, ...DATA.characters, ...DATA.upgrades];
  const bad = picks.filter((x) => /\byour\b/i.test(x.desc)).map((x) => `${x.id}: ${x.desc}`);
  assert.deepEqual(bad, []);
  // Short: one or two sentences.
  const long = picks.filter((x) => (x.desc.match(/[.?]( |$)/g) ?? []).length > 2).map((x) => `${x.id}: ${x.desc}`);
  assert.deepEqual(long, []);
});

// ------------------------------------------------------------------------------ the builders

const fresh = () => defaultProfile();
function withMats(doc, mats) { const d = structuredClone(doc); Object.assign(d.profile.materials, mats); return d; }
function withLevels(doc, levels) { const d = structuredClone(doc); Object.assign(d.profile.buildings, levels); return d; }
const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 99999]));

/** Every card the level-up screen and a chest can show, at every level. */
function allCards() {
  const build = { tags: { fire: 1 }, weapons: DATA.weapons.map((w) => w.id), passives: DATA.passives.map((p) => p.id) };
  const cards = [];
  for (const w of DATA.weapons) for (let L = 1; L <= w.maxLevel; L++) cards.push({ kind: 'weapon', id: w.id, level: L, isNew: L === 1 });
  for (const p of DATA.passives) for (let L = 1; L <= p.maxLevel; L++) cards.push({ kind: 'passive', id: p.id, level: L, isNew: L === 1 });
  for (const r of DATA.relics) cards.push({ kind: 'relic', id: r.id });
  for (const r of DATA.runes) cards.push({ kind: 'rune', id: r.id });
  for (const w of DATA.weapons.filter((x) => x.unlock === 'evolution')) cards.push({ kind: 'evolution', id: w.id });
  cards.push({ kind: 'heal', id: 'heal', amount: 30 }, { kind: 'coin', id: 'coin', amount: 10 });
  return cards.flatMap((c) => [cardInfo(c, DATA), cardInfo(c, DATA, build)].map((info) => [c, info]));
}

test('voice: every card, at every level', () => {
  const lines = [];
  for (const [c, info] of allCards()) for (const k of ['title', 'sub', 'desc', 'note']) lines.push([`${c.kind}:${c.id}:${c.level ?? ''}.${k}`, info[k]]);
  checkAll(lines, 'card');
  // A level-up that isn't the first is stat lines: each leads with its sign (or x for a
  // multiplier) and has no period (§3).
  for (const [c, info] of allCards()) {
    if (!['weapon', 'passive'].includes(c.kind) || c.isNew) continue;
    for (const part of info.desc.split(', ')) assert.match(part, /^[+\-x][\d.]+(%|s|x)? [A-Z]/, `${c.id} Lv ${c.level}: "${info.desc}"`);
    assert.doesNotMatch(info.desc, /\.$/, `${c.id} Lv ${c.level}: no period on a stat line`);
  }
});

/** A spread of profiles: fresh, rich, every building at every level, research running and done. */
function profiles() {
  const out = [fresh(), withMats(fresh(), RICH), withMats(fresh(), { coin: 3, oil: 1 })];
  for (const b of DATA.buildings) for (let lv = 1; lv <= b.levels.length; lv++) {
    out.push(withLevels(fresh(), { [b.id]: lv }), withLevels(withMats(fresh(), RICH), { [b.id]: lv }));
  }
  const busy = startResearch(withLevels(withMats(fresh(), RICH), { library: 1 }), DATA, DATA.research[0].id).doc;
  const done = structuredClone(busy); done.profile.research.done = DATA.research.map((r) => r.id);
  out.push(busy, done);
  const maxed = withLevels(withMats(fresh(), RICH), Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  for (const u of DATA.upgrades) maxed.profile.upgrades[u.id] = u.ranks;
  out.push(maxed);
  return out;
}

test('voice: the harbor\'s panels, refusals, prompts, next-up lines, and results', () => {
  const lines = [];
  for (const b of DATA.buildings) for (let lv = 1; lv <= b.levels.length; lv++) {
    for (const e of levelEffects(DATA, b.id, lv)) lines.push([`${b.id} Lv ${lv} (${e.kind})`, e.text]);
    lines.push([`${b.id} Lv ${lv} cost`, costText(DATA, b.levels[lv - 1].cost)]);
  }
  for (const doc of profiles()) {
    for (const b of DATA.buildings) lines.push([`whyNotRestore ${b.id}`, whyNotRestore(doc, DATA, b.id)]);
    for (const u of DATA.upgrades) lines.push([`whyNotUpgrade ${u.id}`, whyNotUpgrade(doc, DATA, u.id)], [`upgradeState ${u.id}`, upgradeState(doc, DATA, u).why]);
    for (const r of DATA.research) lines.push([`whyNotResearch ${r.id}`, whyNotResearch(doc, DATA, r.id)], [`researchState ${r.id}`, researchState(doc, DATA, r).why]);
    for (const o of purchaseOptions(doc, DATA)) {
      const t = optionText(DATA, { ...o, missing: o.missing ?? [], progress: 0 });
      for (const k of ['title', 'where', 'readyAt', 'need']) lines.push([`option ${o.kind}:${o.id}.${k}`, t[k]]);
    }
  }
  // The results: one of every kind of change, for every id it can name.
  const changes = [
    ...DATA.materials.map((m) => ({ kind: 'material', id: m.id, count: 5 })),
    ...DATA.research.map((r) => ({ kind: 'research_step', id: r.id, runsLeft: 1 })),
    ...DATA.research.map((r) => ({ kind: 'research_done', id: r.id, unlocks: [] })),
    ...DATA.research.map((r) => ({ kind: 'research_started', id: r.id, runs: r.runs })),
    { kind: 'research_waiting', reason: waitingReason(DATA.meta) },
    ...DATA.weapons.map((w) => ({ kind: 'codex', key: `weapon:${w.id}` })),
    ...DATA.passives.map((x) => ({ kind: 'codex', key: `passive:${x.id}` })),
    ...DATA.relics.map((x) => ({ kind: 'codex', key: `relic:${x.id}` })),
    ...DATA.runes.map((x) => ({ kind: 'codex', key: `rune:${x.id}` })),
    ...DATA.maps.flatMap((m) => (m.secrets || []).map((x) => ({ kind: 'codex', key: `secret:${x.id}`, unlocks: [{ what: 'relic', id: x.relic }] }))),
    ...DATA.enemies.map((e) => ({ kind: 'bestiary', id: e.id, kills: 1000 })),
    { kind: 'best_time', seconds: 431, previous: 300 },
    ...DATA.buildings.map((b) => ({ kind: 'building_level', id: b.id, level: 2 })),
    ...DATA.upgrades.map((u) => ({ kind: 'upgrade_rank', id: u.id, rank: 2 })),
  ];
  for (const l of changeLines(DATA, changes)) lines.push([`result ${l.kind}`, l.text]);
  for (const end of ['died', 'left', 'cleared']) for (const runs of [1, 3]) {
    const h = runHeading({ end, timeSurvived: 431, map: 'drowned_docks' }, runs, DATA);
    lines.push([`heading ${end} x${runs}`, h.title], [`heading ${end} x${runs}`, h.line]);
  }
  for (const near of [{ kind: 'gate' }, ...DATA.buildings.map((b) => ({ kind: 'door', id: b.id })), ...DATA.npcs.map((n) => ({ kind: 'npc', id: n.id }))]) {
    const p = promptFor(DATA, near);
    lines.push([`prompt ${near.kind}:${near.id ?? ''}`, p]);
    assert.ok(p.split(' ').length <= 4, `a prompt is a verb and a name: "${p}"`);
  }
  const everyone = withLevels(fresh(), Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  for (const n of [...DATA.npcs, ...DATA.characters]) { const l = lineFor(everyone, DATA, n.id); if (l) lines.push([`line ${n.id}`, l.name], [`line ${n.id}`, l.text]); }
  assert.ok(lines.length > 300, `${lines.length} lines built`);
  checkAll(lines, 'harbor');
  // Status and refusal lines are labels: no sentence about the player.
  const said = lines.map(([, t]) => t).filter((t) => typeof t === 'string');
  assert.deepEqual(said.filter((t) => /^(You|Your) /.test(t)), [], 'no line opens on "You"');
});

test('voice: the run\'s end screen and the settings refusal', () => {
  const lines = [];
  for (const end of ['died', 'left', 'cleared']) {
    const s = runSummary({ end, timeSurvived: 431, level: 12, totalKills: 900, bossesKilled: [], overtimeMinutes: 2, evolutions: [], materials: {} }, DATA);
    lines.push([`end ${end}`, s.title], ...s.lines.map(([k, v]) => [`end ${end} ${k}`, `${k} ${v}`]));
  }
  lines.push(['refusal', settingRefusal('display.mode', 'borderless', 'fullscreen', false)]);
  checkAll(lines, 'run');
});

// ------------------------------------------------------------------------------ the screen code

const SCREEN_FILES = [
  ...['src/ui', 'src/app', 'src/app/scenes'].flatMap((dir) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`)),
  'src/main.js', 'desktop/shell.cjs', 'src/meta/guide.js',
];
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/** A file with its comments taken out (block comments, whole-line ones, and ones after code). */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/([;,)}{\]])\s+\/\/ .*$/, '$1')).join('\n');
}

/** The string literals in a file that read as words to a player: a capitalized word, then more. */
function literals(src) {
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of code(src).matchAll(re)) {
    const s = (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'");
    if (/^[A-Z][a-z' ]/.test(s) && s.includes(' ')) out.push(s);
  }
  return out;
}

test('voice: the string literals in the screen code', () => {
  const lines = SCREEN_FILES.flatMap((f) => literals(read(f)).map((s) => [f, s]));
  assert.ok(lines.length > 60, `${lines.length} literals read`);
  checkAll(lines, 'code');
});

test('voice: a heading or a button is four words at most, and no heading or button is a sentence', () => {
  const found = [];
  for (const f of SCREEN_FILES) {
    const src = code(read(f));
    for (const m of src.matchAll(/h\('h[12]', null, '([^']+)'\)/g)) found.push([f, 'heading', m[1]]);
    for (const m of src.matchAll(/\bbutton\('([^']+)'/g)) found.push([f, 'button', m[1]]);
    for (const m of src.matchAll(/\b(yes|no): '([^']+)'/g)) found.push([f, 'button', m[2]]);
  }
  assert.ok(found.length > 20, `${found.length} headings and buttons found`);
  const bad = found.filter(([, , t]) => t.split(/\s+/).length > 4 || /\.$/.test(t)).map((x) => x.join(': '));
  assert.deepEqual(bad, []);
});

test('voice: the checks catch what they are for', () => {
  // So a check that stopped matching can't pass quietly.
  assert.deepEqual(faults('A seamless journey!'), ['"seamless" is on the banned list', 'an exclamation mark']);
  assert.deepEqual(faults('Fast — and rude'), ['an em dash']);
  assert.deepEqual(faults('You held out for 7:11.'), ['narrates the player (§2.3)']);
  assert.deepEqual(faults('It\'s important to note this.'), ['"It\'s important to note" is on the banned list']);
  assert.deepEqual(faults('Unlocks: Tide Bell'), []);
  assert.deepEqual(faults('Save a report so Claude can see it.'), ['names Claude (a game\'s screens name no helper; the credits do)']);
  assert.deepEqual(faults('+12% Damage (fire)'), ['a tag in lowercase (tags are names: "(Fire)")']);
  assert.deepEqual(literals("// 'Not a player line at all'\nconst a = 'Start run', b = 'ui_move', c = `Need ${n} Coin`, d = 'A run counts';"), ['Start run', 'Need ${n} Coin', 'A run counts']);
});
