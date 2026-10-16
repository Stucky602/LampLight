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
import { runSummary, settingRefusal, haltView, noticeFor } from '../src/app/runlogic.js';
import { actionLine, rewardText as rewardLabels } from '../src/ui/hubtext.js';
import * as W from '../src/meta/workshop.js';
import { setupRows, startChoice, rewardText } from '../src/app/setup.js';
import { createWorld } from '../src/sim/world.js';
import { EV } from '../src/sim/events.js';
import { TASK } from '../src/sim/constants.js';

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

test('voice: Phase 7\'s names and what you pick there: no "The", no "your", tags as names', () => {
  const named = [...DATA.recipes, ...DATA.consumables, ...DATA.arcana, ...DATA.curses, ...DATA.challenges, ...DATA.feats, ...DATA.perks, ...DATA.kits, ...DATA.affixes];
  assert.deepEqual(named.filter((x) => /^The /.test(x.name)).map((x) => x.name), []);
  const picks = [...DATA.consumables, ...DATA.arcana, ...DATA.curses, ...DATA.perks, ...DATA.kits, ...DATA.challenges, ...DATA.feats];
  assert.deepEqual(picks.filter((x) => /\byour\b/i.test(x.desc ?? '')).map((x) => `${x.id}: ${x.desc}`), []);
  assert.deepEqual(picks.filter((x) => /\d+(\.\d+)? seconds?\b/.test(x.desc ?? '')).map((x) => `${x.id}: ${x.desc}`), []);
  // A tag-scoped affix reads "Damage (Fire)" (§3), and at every tier its line leads with its sign.
  for (const a of DATA.affixes) {
    if (a.kind === 'hook' || a.kind === 'rule') continue;
    if (a.mod.tags) assert.match(a.name, /^[A-Z][\w ]+ \([A-Z][a-z]+\)$/, a.id);
    for (let t = 1; t <= 5; t++) assert.match(W.affixText(a, t), /^[+-][\d.]+%? [A-Z]/, `${a.id} at tier ${t}`);
  }
  // No sentence anywhere opens on a building, map, or character with "The" before it.
  const names = [...DATA.buildings, ...DATA.maps, ...DATA.characters].map((x) => x.name).concat('Ferryman');
  const theName = new RegExp(`(^|[.:] )The (${names.join('|')})\\b`);
  // (A keeper's speech is a person talking, and people say "the Ferryman".)
  assert.deepEqual(dataLines().filter(([k, t]) => !/^npcs\[/.test(k) && theName.test(t)).map(([k, t]) => `${k}: ${t}`), []);
});

test('voice: a description of something you pick says what it does, never "your" (§6)', () => {
  const forms = DATA.ascensions.flatMap((l) => l.options);
  const picks = [...DATA.weapons, ...DATA.passives, ...DATA.relics, ...DATA.runes, ...DATA.characters, ...DATA.upgrades, ...forms];
  const bad = picks.filter((x) => /\byour\b/i.test(x.desc)).map((x) => `${x.id}: ${x.desc}`);
  assert.deepEqual(bad, []);
  // "You" only as the target: never the one doing it ("You plant a rod").
  assert.deepEqual(picks.filter((x) => /(^|\. )You\b|\byou (walk|plant|leave|stand|fire|dash)\b/.test(x.desc)).map((x) => `${x.id}: ${x.desc}`), []);
  // Seconds as 45s (§3), never spelled out.
  assert.deepEqual(picks.filter((x) => /\d+(\.\d+)? seconds?\b/.test(x.desc)).map((x) => `${x.id}: ${x.desc}`), []);
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

test('voice: Phase 7\'s panels, refusals, gate rows, purchases, and run screens', () => {
  const lines = [];
  const everyone = withLevels(withMats(fresh(), RICH), Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  everyone.profile.research.done = DATA.research.map((r) => r.id);
  everyone.profile.feats = DATA.feats.map((f) => f.id);
  everyone.profile.challenges = DATA.challenges.map((c) => c.id);
  for (const doc of [...profiles(), everyone]) {
    for (const r of DATA.recipes) lines.push([`whyNotCraft ${r.id}`, W.whyNotCraft(doc, DATA, r.id)]);
    for (const r of DATA.runes) lines.push([`whyNotCutRune ${r.id}`, W.whyNotCutRune(doc, DATA, r.id)]);
    for (const c of DATA.consumables) lines.push([`whyNotBuyConsumable ${c.id}`, W.whyNotBuyConsumable(doc, DATA, c.id)]);
    for (const p of DATA.perks) lines.push([`whyNotTrain ${p.id}`, W.whyNotTrain(doc, DATA, p.id)]);
    for (const e of DATA.enemies) lines.push([`whyNotClaim ${e.id}`, W.whyNotClaim(doc, DATA, e.id)]);
    lines.push(['whyNotTrade', W.whyNotTrade(doc, DATA, 'coin', 'iron')], ['whyNotTrade same', W.whyNotTrade(doc, DATA, 'coin', 'coin')]);
    for (const ch of DATA.characters) {
      const choice = startChoice(doc, DATA, ch.id);
      for (const r of setupRows(doc, DATA, choice)) {
        lines.push([`setup ${r.key}`, r.label]);
        assert.ok(r.label.split(' ').length <= 4, `a gate row is a label: "${r.label}"`);
        for (const [, t] of r.choices || []) lines.push([`setup ${r.key} choice`, String(t)]);
      }
      lines.push(['reward', rewardText(DATA, { ...choice, tide: 3, curses: DATA.curses.map((c) => c.id) })]);
    }
  }
  // An item at every tier, its refusals, and every purchase's line.
  let d = everyone;
  for (const r of DATA.recipes) d = W.craftGear(d, DATA, r.id).doc;
  for (const it of W.gearItems(d)) {
    lines.push([`whyNotUpgradeGear ${it.id}`, W.whyNotUpgradeGear(d, DATA, it.uid)], [`whyNotEquip ${it.id}`, W.whyNotEquip(d, DATA, it.uid)]);
    for (const at of [0, 1, 5]) lines.push([`whyNotReroll ${it.id} ${at}`, W.whyNotReroll(d, DATA, it.uid, at)]);
    for (const a of it.affixes) lines.push([`affix ${a}`, W.affixText(DATA.affixes.find((x) => x.id === a), it.tier)]);
  }
  const kinds = [
    { kind: 'gear_made', id: 'storm_lantern', worn: true }, { kind: 'gear_tier', id: 'storm_lantern', tier: 3 },
    { kind: 'gear_reroll', id: 'storm_lantern', was: 'might', now: 'swift' }, { kind: 'gear_worn' }, { kind: 'gear_off' },
    { kind: 'rune_stone', id: 'splitting' }, { kind: 'consumable', id: 'smelling_salts', held: 2 },
    { kind: 'trade', give: 'coin', gave: 12, get: 'iron', got: 1 }, { kind: 'bestiary_claim', id: 'fog_wisp', kills: 1000 },
    ...DATA.perks.map((p) => ({ kind: 'perk', id: p.id })),
  ];
  for (const c of kinds) { const t = actionLine(DATA, c); assert.ok(t, c.kind); lines.push([`action ${c.kind}`, t]); }
  const results = [
    { kind: 'glass_coin', count: 12, glass: 24 }, ...DATA.characters.map((c) => ({ kind: 'mastery', character: c.id, rank: 2 })),
    { kind: 'tide', level: 3 }, ...DATA.feats.map((f) => ({ kind: 'feat', id: f.id, unlocks: [], materials: { coin: 5 } })),
    ...DATA.challenges.map((c) => ({ kind: 'challenge', id: c.id, unlocks: [] })), ...DATA.feats.map((f) => ({ kind: 'feat_found', id: f.id })),
  ];
  for (const l of changeLines(DATA, results)) lines.push([`result ${l.kind}`, l.text]);
  for (const f of DATA.feats) { const t = rewardLabels(DATA, 'feat', f); assert.ok(t, f.id); lines.push([`feat reward ${f.id}`, t]); }
  for (const c of DATA.challenges) { const t = rewardLabels(DATA, 'challenge', c); assert.ok(t, c.id); lines.push([`challenge reward ${c.id}`, t]); }
  for (const b of DATA.buildings) for (let lv = 1; lv <= b.levels.length; lv++) for (const e of levelEffects(DATA, b.id, lv)) lines.push([`${b.id} Lv ${lv}`, e.text]);
  // In a run: the relic pick, the Ferryman's stock, and the tasks' notices.
  const w = createWorld({ seed: 4, character: 'lamplighter', harbor: { ferry: 5 } }, DATA);
  for (const v of [haltView(w, { kind: 'relic', offer: DATA.relics.map((r) => r.id) }, DATA), haltView(w, { kind: 'ferry' }, DATA)]) {
    for (const x of v.relics || v.offers) lines.push([`${v.kind} ${x.id ?? x.name}`, x.name], [`${v.kind} desc`, x.desc], [`${v.kind} why`, x.why ?? null], [`${v.kind} tier`, x.tierName ?? null]);
  }
  const ev = { type: [], a: [], b: [], c: [], d: [] };
  const push = (type, a, b, c, dd) => { ev.type.push(type); ev.a.push(a); ev.b.push(b); ev.c.push(c); ev.d.push(dd); };
  w.tasks.forEach((t, i) => { push(EV.TASK, t.kind, 1, i, 0); push(EV.TASK, t.kind, 2, i, 6); });
  push(EV.NIGHT, 1, 0, 0, 0); push(EV.NIGHT, 0, 0, 0, 0); push(EV.FERRY, 1, 2, 0, 0);
  for (let i = 0; i < ev.type.length; i++) { const n = noticeFor(ev, i, w); assert.ok(n, `event ${ev.type[i]}`); lines.push([`notice ${ev.type[i]}`, n]); }
  checkAll(lines, 'phase 7');
  const said = lines.map(([, t]) => t).filter((t) => typeof t === 'string');
  assert.deepEqual(said.filter((t) => /^(You|Your) /.test(t)), [], 'no line opens on "You"');
  assert.deepEqual(said.filter((t) => /^The (Market|Smithy|Chapel|Docks|Apothecary|Cartographer|Ferryman|Tavern|Library|Lamp Post)\b/.test(t)), []);
  void TASK;
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
