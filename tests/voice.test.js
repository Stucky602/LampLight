// The words the player reads, checked against docs/WRITING.md §8: every name, description, and
// line in the data, every string the text builders make from the shipped content, and the string
// literals in the screen code. What a machine can't judge (whether a line sounds like a person)
// is the review's job; what it can (a banned word, an exclamation mark, "at Library" without its "the", a stat line
// without its sign, a five-word button) fails here.
import { test } from 'node:test';
const TASK_KIND_BELL = 2;
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
import { runSummary, settingRefusal, haltView, noticeFor, ledgerLines } from '../src/app/runlogic.js';
import { actionLine, rewardText as rewardLabels } from '../src/ui/hubtext.js';
import * as W from '../src/meta/workshop.js';
import * as K from '../src/meta/skills.js';
import { setupRows, startChoice, rewardText, whyNotSetRun } from '../src/app/setup.js';
import { codexEntries } from '../src/meta/codex.js';
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
    ...DATA.dashes, ...DATA.research, ...DATA.upgrades, ...DATA.materials, ...DATA.npcs,
    ...DATA.enemies.filter((e) => !e.tags.includes('boss')), DATA.hub, DATA.hub.gate,
  ];
  const bad = named.filter((x) => /^The /.test(x.name)).map((x) => x.name);
  assert.deepEqual(bad, []);
  assert.ok(DATA.enemies.filter((e) => e.tags.includes('boss')).every((e) => /^The /.test(e.name)), 'bosses have titles');
});

test('voice: Phase 7\'s names and what you pick there: no "The", no "your", tags as names', () => {
  const named = [...DATA.recipes, ...DATA.consumables, ...DATA.trophies, ...DATA.curses, ...DATA.challenges, ...DATA.feats, ...DATA.skills, ...DATA.kits, ...DATA.affixes];
  assert.deepEqual(named.filter((x) => /^The /.test(x.name)).map((x) => x.name), []);
  const picks = [...DATA.consumables, ...DATA.trophies, ...DATA.curses, ...DATA.skills, ...DATA.kits, ...DATA.challenges, ...DATA.feats];
  assert.deepEqual(picks.filter((x) => /\byour\b/i.test(x.desc ?? '')).map((x) => `${x.id}: ${x.desc}`), []);
  assert.deepEqual(picks.filter((x) => /\d+(\.\d+)? seconds?\b/.test(x.desc ?? '')).map((x) => `${x.id}: ${x.desc}`), []);
  // A tag-scoped affix reads "Damage (Fire)" (§3), and at every tier its line leads with its sign.
  for (const a of DATA.affixes) {
    if (a.kind === 'hook' || a.kind === 'rule') continue;
    if (a.mod.tags) assert.match(a.name, /^[A-Z][\w ]+ \([A-Z][a-z]+\)$/, a.id);
    for (let t = 1; t <= 5; t++) assert.match(W.affixText(a, t), /^[+-][\d.]+%? [A-Z]/, `${a.id} at tier ${t}`);
  }
  // In a sentence, a building and the Ferryman take "the", the way people say them (§2.4).
  assert.deepEqual(dataLines().filter(([, t]) => bareName(t)).map(([k, t]) => `${k}: ${t}`), []);
});

/** A building or the Ferryman named mid-sentence without its "the" ("burns at Lamp Post"). */
const PLACES = ['Lamp Post', 'Library', 'Tavern', 'Docks', 'Smithy', 'Chapel', 'Market', 'Apothecary', 'Cartographer', 'Ferryman'];
const BARE_RE = new RegExp(`\\b(at|to|from|in|by|of|for|with|into|on) (${PLACES.join('|')})\\b(?! Lv)`);
function bareName(text) { return typeof text === 'string' && BARE_RE.test(text); }

test('voice: a description of something you pick says what it does, never "your" (§6)', () => {
  const forms = DATA.ascensions.flatMap((l) => l.options);
  const lines = DATA.weapons.flatMap((w) => [...(w.lines || []), ...(w.specials || [])]);
  const picks = [...DATA.weapons, ...DATA.passives, ...DATA.relics, ...DATA.dashes, ...DATA.characters, ...DATA.upgrades, ...forms, ...lines];
  const bad = picks.filter((x) => /\byour\b/i.test(x.desc)).map((x) => `${x.id}: ${x.desc}`);
  assert.deepEqual(bad, []);
  // "You" only as the target: never the one doing it ("You plant a rod").
  assert.deepEqual(picks.filter((x) => /(^|\. )You\b|\byou (walk|plant|leave|stand|fire|dash)\b/.test(x.desc)).map((x) => `${x.id}: ${x.desc}`), []);
  // Seconds as 45s (§3), never spelled out.
  assert.deepEqual(picks.filter((x) => /\d+(\.\d+)? seconds?\b/.test(x.desc)).map((x) => `${x.id}: ${x.desc}`), []);
  // Short: one or two sentences.
  // (Round 4, the director's call: a stat after the sentence, "+80% Damage." or "+50% Damage, +1 Spout.", is a stat line, not a sentence.)
  const sentences = (t) => t.split(/(?<=[.?])\s+/).filter((s) => s && !/^[+\-x][\d.]+(%|s|x)? [A-Z][\w ]*(, [+\-][\d.]+(%|s)? [A-Z][\w ]*)*\.$/.test(s) && !/^Can't be taken with [A-Z][\w' ]*\.$/.test(s)).length;   // (Ruling 23 WA: a Form's "Can't be taken with X." is a rule tag, like Breakers')
  const long = picks.filter((x) => sentences(x.desc) > 2).map((x) => `${x.id}: ${x.desc}`);
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
  // A weapon new, and each of its rolled upgrades at each rarity it rolls at, its lines, and its specials (ruling 14).
  const U = DATA.tuning.weaponUps, ids = DATA.rarities.map((r) => r.id);
  for (const w of DATA.weapons) {
    cards.push({ kind: 'weapon', id: w.id, level: 1, isNew: true });
    for (const u of w.numbers) {
      const t = DATA.weaponUps.find((x) => x.id === u);
      for (let r = t.min; r < 5; r++) {
        const v = U.value[u] * U.mul[r] / U.mul[t.min];
        cards.push({ kind: 'weapon', id: w.id, level: 2 + r, isNew: false, up: u, rarity: ids[r], value: t.whole ? Math.max(1, Math.round(v)) : v, now: 10, after: 10 * (1 + v), next: { axis: 'delivery', at: 5, left: 2 } });
      }
    }
    for (const l of w.lines || []) cards.push({ kind: 'weapon', id: w.id, level: 4, isNew: false, up: 'line', line: l.id, rarity: l.rarity, value: 0, opens: 'flight' });
    for (const x of w.specials || []) cards.push({ kind: 'weapon', id: w.id, level: 11, isNew: false, up: 'special', special: x.id, rarity: 'legendary', value: 0, deed: w.deed ? { have: 3, need: w.deed.count, done: false, text: w.deed.text } : null });
  }
  for (const d of DATA.dashes) cards.push({ kind: 'dash', id: d.id, level: 1, isNew: true }, { kind: 'dash', id: d.id, level: 2, isNew: false, up: 'dash_recharge', value: 0.12, now: 2.5, after: 2.2 });
  for (const p of DATA.passives) for (let L = 1; L <= p.maxLevel; L++) cards.push({ kind: 'passive', id: p.id, level: L, isNew: L === 1 });
  for (const r of DATA.relics) cards.push({ kind: 'relic', id: r.id });
  cards.push({ kind: 'heal', id: 'heal', amount: 30 }, { kind: 'coin', id: 'coin', amount: 10 });
  return cards.flatMap((c) => [cardInfo(c, DATA), cardInfo(c, DATA, build)].map((info) => [c, info]));
}

test('voice: every card, at every level', () => {
  const lines = [];
  for (const [c, info] of allCards()) for (const k of ['title', 'sub', 'desc', 'note', 'form']) lines.push([`${c.kind}:${c.id}:${c.level ?? ''}.${k}`, info[k]]);
  checkAll(lines, 'card');
  // A level-up that isn't the first is stat lines: a passive's lead with their sign (or x for a
  // multiplier); a weapon's or a dash's number is the stat, now and after ("Damage 24 → 29",
  // ruling 14); none has a period (§3). A line or a special is its name and a sentence.
  for (const [c, info] of allCards()) {
    if (!['weapon', 'passive', 'dash'].includes(c.kind) || c.isNew || c.up === 'special' || c.up === 'line') continue;
    if (c.kind !== 'passive') { assert.match(info.desc, /^[A-Z][A-Za-z ]+ [\d.]+(%|s)? → [\d.]+(%|s)?$/, `${c.id} Lv ${c.level}: "${info.desc}"`); continue; }
    for (const part of info.desc.split(/, | and /)) assert.match(part, /^[+\-x][\d.]+(%|s|x)? [A-Z]/, `${c.id} Lv ${c.level}: "${info.desc}"`);
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
    ...DATA.maps.flatMap((m) => (m.secrets || []).map((x) => ({ kind: 'codex', key: `secret:${x.id}`, unlocks: [{ what: 'relic', id: x.relic }] }))),
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
    // A verb and a name; a keeper's name comes with what they do.
    assert.match(p, /^(Start run|Use the [A-Z][\w ]+|Enter the [A-Z][\w ]+|Talk to [A-Z][\w' ]+(, the [a-z ]+)?)$/, `a prompt is a verb and a name: "${p}"`);
  }
  const everyone = withLevels(fresh(), Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  for (const n of [...DATA.npcs, ...DATA.characters]) { const l = lineFor(everyone, DATA, n.id); if (l) lines.push([`line ${n.id}`, l.name], [`line ${n.id}`, l.text]); }
  assert.ok(lines.length > 300, `${lines.length} lines built`);
  checkAll(lines, 'harbor');
  assert.deepEqual(lines.filter(([, t]) => bareName(t)).map(([k, t]) => `${k}: ${t}`), [], 'a building mid-sentence takes "the"');
  // Status and refusal lines are labels: no sentence about the player.
  const said = lines.map(([, t]) => t).filter((t) => typeof t === 'string');
  assert.deepEqual(said.filter((t) => /^(You|Your) /.test(t)), [], 'no line opens on "You"');
});

test('voice: Phase 7\'s panels, refusals, gate rows, purchases, and run screens', () => {
  const lines = [];
  const everyone = withLevels(withMats(fresh(), RICH), Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  everyone.profile.research.done = DATA.research.map((r) => r.id);
  everyone.profile.feats = DATA.feats.map((f) => f.id);
  everyone.profile.characters = Object.fromEntries(DATA.characters.map((c) => [c.id, { unlocked: true, masteryXp: DATA.meta.masteryRanks.at(-1), skills: [] }]));   // every mastery rank (0.9.0)
  for (const doc of [...profiles(), everyone]) {
    for (const r of DATA.recipes) lines.push([`whyNotCraft ${r.id}`, W.whyNotCraft(doc, DATA, r.id)]);
    for (const c of DATA.consumables) lines.push([`whyNotBuyConsumable ${c.id}`, W.whyNotBuyConsumable(doc, DATA, c.id)]);
    for (const s of DATA.skills) lines.push([`whyNotSkill ${s.id}`, K.whyNotSkill(doc, DATA, s.id)]);
    for (const f of DATA.feats.filter((x) => x.rules)) lines.push([`whyNotSetRun ${f.id}`, whyNotSetRun(doc, DATA, f)]);
    lines.push(['whyNotTrade', W.whyNotTrade(doc, DATA, 'coin', 'iron')], ['whyNotTrade same', W.whyNotTrade(doc, DATA, 'coin', 'coin')]);
    for (const ch of DATA.characters) {
      const choice = startChoice(doc, DATA, ch.id);
      for (const r of setupRows(doc, DATA, choice)) {
        lines.push([`setup ${r.key}`, r.label]);
        assert.ok(r.label.split(' ').length <= 4, `a gate row is a label: "${r.label}"`);
        for (const [, t] of r.choices || []) lines.push([`setup ${r.key} choice`, String(t)]);
        for (const it of r.items || []) { lines.push([`setup ${r.key} item`, it.label]); for (const t of [...(it.detail || []), it.why]) lines.push([`setup ${r.key} item line`, t]); }
        for (const t of r.detail || []) lines.push([`setup ${r.key} detail`, t]);
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
    { kind: 'consumable', id: 'smelling_salts', held: 2 },
    { kind: 'trade', give: 'coin', gave: 12, get: 'iron', got: 1 },
    ...DATA.skills.map((p) => ({ kind: 'skill', id: p.id })), { kind: 'skill_reset' },
  ];
  for (const c of kinds) { const t = actionLine(DATA, c); assert.ok(t, c.kind); lines.push([`action ${c.kind}`, t]); }
  const results = [
    { kind: 'glass_coin', count: 12, glass: 24 }, ...DATA.characters.map((c) => ({ kind: 'mastery', character: c.id, rank: 2 })),
    { kind: 'tide', level: 3 }, ...DATA.feats.map((f) => ({ kind: 'feat', id: f.id, unlocks: [], materials: { coin: 5 } })),
    ...DATA.feats.map((f) => ({ kind: 'feat_found', id: f.id })),
  ];
  for (const l of changeLines(DATA, results)) lines.push([`result ${l.kind}`, l.text]);
  for (const f of DATA.feats) { const t = rewardLabels(DATA, 'feat', f); assert.ok(t, f.id); lines.push([`feat reward ${f.id}`, t]); }
  for (const b of DATA.buildings) for (let lv = 1; lv <= b.levels.length; lv++) for (const e of levelEffects(DATA, b.id, lv)) lines.push([`${b.id} Lv ${lv}`, e.text]);
  // In a run: the relic pick, the Ferryman's stock, and the tasks' notices.
  const w = createWorld({ seed: 4, character: 'lamplighter', harbor: { ferry: 5 } }, DATA);
  for (const v of [haltView(w, { kind: 'relic', offer: DATA.relics.map((r) => r.id) }, DATA), haltView(w, { kind: 'ferry' }, DATA)]) {
    for (const x of v.relics || v.offers) lines.push([`${v.kind} ${x.id ?? x.name}`, x.name], [`${v.kind} desc`, x.desc], [`${v.kind} why`, x.why ?? null], [`${v.kind} tier`, x.tierName ?? null]);
  }
  const ev = { type: [], a: [], b: [], c: [], d: [] };
  const push = (type, a, b, c, dd) => { ev.type.push(type); ev.a.push(a); ev.b.push(b); ev.c.push(c); ev.d.push(dd); };
  // (0.9.0, W4: a crane or cairn says only that it's done.)
  w.tasks.forEach((t, i) => { if (t.kind <= TASK_KIND_BELL) push(EV.TASK, t.kind, 1, i, 0); push(EV.TASK, t.kind, 2, i, 6); });
  push(EV.NIGHT, 1, 0, 0, 0); push(EV.NIGHT, 0, 0, 0, 0); push(EV.FERRY, 3, 2, 1, 0); push(EV.GLASS, 5, 5, 0, 0);
  // 0.8.2's: Lantern Night banked, the vault and a Reliquary landing, the relic pool found, an
  // empty vault and Reliquary. (A lamp going out says nothing: lamps stay lit since 0.9.0.)
  push(EV.NIGHT, 2, 0, 1, 0); push(EV.DROP, 7, 0, 0, 0); push(EV.DROP, 6, 0, 1, 0);
  // W4's (0.9.0): an act, a bell waking near a place, a map event and its guard, a find, the Long Night, the dawn.
  push(EV.ACT, 2, 1, 5, 3); push(EV.ACT, 3, 0, 4, 3); push(EV.ARM, 2, 0, 2, 1);
  w.map.deck.forEach((e, k) => push(EV.MAP_EVENT, 1, k, 1, 0)); push(EV.MAP_EVENT, 2, 0, 1, 0);
  w.secrets.forEach((sc, k) => { if (sc.gift) push(EV.FIND, { pearls: 1, ember: 2, item: 3, materials: 4, heal: 5 }[sc.gift.kind], sc.gift.amount ?? 1, k, 0); });
  push(EV.FINALE, 1, 2, 0, 0); push(EV.FINALE, 3, 8, 0, 0);
  push(EV.RELIC_POOL, 1, 5, 5, 0); push(EV.VAULT_EMPTY, 1, 0, 0, 0); push(EV.VAULT_EMPTY, 2, 0, 0, 0);
  for (let i = 0; i < ev.type.length; i++) { const n = noticeFor(ev, i, w); if (!n && ev.type[i] === EV.TASK && ev.b[i] === 1 && w.trade?.P?.touch) continue;   /* (round 4: her lamp lights at a touch, so its start says nothing) */ assert.ok(n, `event ${ev.type[i]}`); for (const t of [].concat(n)) lines.push([`notice ${ev.type[i]}`, t]); }
  // The Fog Bell's pick (0.8.2): every weapon and passive card it can show, and the map's ledger.
  const bw = createWorld({ seed: 4, character: 'lamplighter' }, DATA);
  const opts = [{ kind: 'weapon', id: bw.slots[0].def.id, slot: 0, from: 1, to: 3 }];
  for (const x of haltView(bw, { kind: 'bellpick', options: opts }, DATA).options) lines.push(['bellpick name', x.name], ['bellpick sub', x.sub], ['bellpick desc', x.desc]);
  for (const [k, v] of ledgerLines({ lamps: { lit: 6, most: 4, total: 5 }, bells: { rung: 2, total: 3 }, ferry: { calls: 3, trades: 3, bought: 2 }, relics: { found: 4, total: 5 }, secrets: { found: [], total: 1 }, nights: 1 })) lines.push(['ledger label', k], ['ledger value', v]);
  checkAll(lines, 'phase 7');
  const said = lines.map(([, t]) => t).filter((t) => typeof t === 'string');
  assert.deepEqual(said.filter((t) => /^(You|Your) /.test(t)), [], 'no line opens on "You"');
  assert.deepEqual(lines.filter(([, t]) => bareName(t)).map(([k, t]) => `${k}: ${t}`), [], 'a building mid-sentence takes "the"');
  // A keeper is named with what they do, the first time a panel names them.
  for (const n of DATA.npcs) assert.ok(levelEffects(DATA, n.home, 4).some((e) => e.text.startsWith(`${n.name}, the ${n.role},`)), n.id);
  void TASK;
});

test('voice: the Salt Marsh\'s words: map cards, research on a map, the Well, first sightings, the water, and the field guide (0.8.0)', async () => {
  const { mapCard, researchRunsText } = await import('../src/ui/hubtext.js');
  const { mapNeedsText } = await import('../src/meta/runconfig.js');
  const { withSights, guideEntry } = await import('../src/app/runlogic.js');
  const { WELL_TEXT } = await import('../src/ui/menus.js');
  const { SIGHT, SIGHT_NAMES } = await import('../src/sim/events.js');
  const lines = [];
  const everyone = withLevels(withMats(fresh(), RICH), Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  everyone.profile.bestiary = { harbor_maw: 1, old_grey: 1 };
  everyone.profile.tides = Object.fromEntries(DATA.maps.map((m, i) => [m.id, i]));
  everyone.profile.research.active = DATA.research.slice(-4).map((r) => ({ id: r.id, runsLeft: 2 }));
  for (const doc of [fresh(), everyone]) for (const m of DATA.maps) {
    const c = mapCard(doc, DATA, m.id, [{ kind: 'research', id: 'brine_notes', missing: [{ id: 'marsh_herbs', need: 3 }] }, { kind: 'building', id: 'smithy', level: 3, missing: [{ id: 'salt_glass', need: 2 }] }]);
    lines.push([`map ${m.id}`, c.name], ...c.lines.map((l) => [`map ${m.id} line`, l]));
    lines.push([`map ${m.id} needs`, mapNeedsText(DATA, m.id, [].concat(m.unlock ?? []))]);
  }
  for (const r of DATA.research) for (const n of [1, 2]) lines.push([`runs ${r.id}`, researchRunsText(DATA, r, n)]);
  const results = [
    ...DATA.research.filter((r) => r.runsOn).map((r) => ({ kind: 'research_elsewhere', id: r.id, map: r.runsOn, runsLeft: 2 })),
    ...DATA.relics.map((r) => ({ kind: 'well', id: r.id })),
    { kind: 'sighted', map: 'salt_marsh', names: [...DATA.enemies.map((e) => `enemy:${e.id}`), ...Object.values(SIGHT_NAMES)] },
    ...DATA.maps.map((m) => ({ kind: 'map_open', id: m.id })), ...DATA.characters.map((c) => ({ kind: 'arrival', id: c.id })),
    ...DATA.maps.map((m) => ({ kind: 'tide', level: 2, map: m.id })),
  ];
  for (const l of changeLines(DATA, results)) lines.push([`result ${l.kind}`, l.text]);
  lines.push(['well', WELL_TEXT]);
  // In a run on the Marsh: every first sighting, the water's notices, the Eye, the Well opening.
  const w = createWorld({ seed: 4, map: 'salt_marsh', character: 'lamplighter' }, DATA);
  const ev = { type: [], a: [], b: [], c: [], d: [] };
  const push = (type, a, b, c, dd = 0) => { ev.type.push(type); ev.a.push(a); ev.b.push(b); ev.c.push(c); ev.d.push(dd); };
  DATA.enemies.forEach((_, k) => push(EV.FIRST_SIGHT, SIGHT.ENEMY, k, 0));
  for (const what of Object.keys(SIGHT_NAMES)) push(EV.FIRST_SIGHT, Number(what), 0, 0);
  for (const phase of [1, 3, 5]) push(EV.WATER, phase, phase === 1 ? 15 : 0, 0);
  push(EV.WATER, 1, 15, 1); push(EV.EYE, 1, 45, 0); push(EV.WELL, 1, 0, 0);
  for (let i = 0; i < ev.type.length; i++) { const n = noticeFor(ev, i, w); assert.ok(n, `event ${ev.type[i]} ${ev.a[i]}`); for (const t of [].concat(n)) lines.push([`notice ${ev.type[i]}`, t]); }
  w.result.sighted.push(...DATA.enemies.map((e) => `enemy:${e.id}`), ...Object.values(SIGHT_NAMES));
  // The codex for this map (the pause menu's): every entry's name and line.
  for (const g of codexEntries(withSights(fresh(), 'salt_marsh', w.result.sighted), DATA, 'salt_marsh')) lines.push([`codex ${g.id}`, g.name], [`codex ${g.id} line`, g.seen ? g.desc : g.hint]);
  for (const k of Object.values(SIGHT_NAMES)) assert.ok(guideEntry(DATA, k), `the field guide names ${k}`);
  // With the Marsh closed: the refusals and Next up's line for what waits on it, every unlock key
  // kind in words, the Tide refusals, and the map card's line above the Chapel's cap.
  const { whyNotResearch, whyNotRestore, unlockText, needText } = await import('../src/meta/actions.js');
  const { purchaseOptions } = await import('../src/meta/next.js');
  const { optionText } = await import('../src/ui/hubtext.js');
  const { runConfigFor } = await import('../src/meta/runconfig.js');
  const closed = withLevels(withMats(fresh(), { coin: 400, rum: 99, oil: 300 }), { lamp_post: 5, library: 3, tavern: 1, apothecary: 2, smithy: 2 });
  for (const r of DATA.research.filter((x) => x.runsOn || Object.keys(x.cost).some((id) => ['marsh_herbs', 'salt_glass'].includes(id)))) { const why = whyNotResearch(closed, DATA, r.id); if (why) lines.push([`closed research ${r.id}`, why]); }
  for (const b of DATA.buildings) { const why = whyNotRestore(closed, DATA, b.id); if (why) lines.push([`closed restore ${b.id}`, why]); }
  lines.push(['closed need', needText(closed, DATA, { marsh_herbs: 3, salt_glass: 2 })]);
  for (const o of purchaseOptions(closed, DATA).filter((x) => x.waits)) lines.push([`closed next ${o.id}`, optionText(DATA, o).waits]);
  for (const k of ['building:docks:1', 'boss:harbor_maw', 'feat:first_crossing', `research:${DATA.research[0].id}`, `challenge:${DATA.challenges[0].id}`, 'map:salt_marsh', `secret:${DATA.maps[0].secrets[0].id}`, 'weird:key']) lines.push([`unlock ${k}`, `Needs ${unlockText(DATA, k)}`]);
  const capped = withLevels(fresh(), { chapel: 1, docks: 1, tavern: 1 });
  capped.profile.bestiary = { harbor_maw: 1 }; capped.profile.tides = { salt_marsh: 3, drowned_docks: 1 };
  lines.push(...mapCard(capped, DATA, 'salt_marsh', []).lines.map((l) => ['capped card', l]));
  for (const tide of [1, 2, 3, 4, 11]) for (const map of ['salt_marsh', 'drowned_docks']) {
    try { runConfigFor(capped, DATA, { character: 'lamplighter', seed: 1, map, tide }); } catch (e) { lines.push([`tide ${map} ${tide}`, e.message]); }
  }
  checkAll(lines, 'salt marsh');
  assert.deepEqual(lines.filter(([, t]) => bareName(t)).map(([k, t]) => `${k}: ${t}`), [], 'a building mid-sentence takes "the"');
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
  assert.ok(bareName('Ready at Smithy') && bareName('Oil. Lamp Post burns it, ask Ferryman') === false && bareName('Opens at Chapel Lv 3') === false);
  assert.ok(bareName('sails in from Docks') && !bareName('Ready at the Smithy'));
  assert.deepEqual(literals("// 'Not a player line at all'\nconst a = 'Start run', b = 'ui_move', c = `Need ${n} Coin`, d = 'A run counts';"), ['Start run', 'Need ${n} Coin', 'A run counts']);
});

// ------------------------------------------------------------------------------ RULING-L1 (the language pass, Nov 19)

/** The words the game doesn't use (docs/WRITING.md 7.6), as reasons; object names keep a real gaff. */
const CUT_RE = /\b(Kindred|deeds?|capstones?|Capstones?|Spoils|[Dd]az(e|ed|es)|[Gg]aff(ed|s)?(?! (Hook|Hand|Coat))|Own weapon|own track|the trade|Hops?(?! at)|hop of|banked|banks|[Cc]hampions?|axis|axes|Warded|Tide Ward|wards?)\b/;
const WHAT_RE = /\bwhat(ever)? (stands|is near|is close|is under|it hits|they hit|it passes|it crosses|crosses|walks|wades|touches|lies|comes|dies|it bites|they cut|it cuts|it drags|it hauls|it throws|it leaves)/i;
const FRACTION_RE = /\b(half again|a quarter|a fifth|a third|two and a half)\b/i;
function langFaults(text, speech = false) {
  const out = [];
  const m = text.match(CUT_RE);
  if (m) out.push(`"${m[0]}" is a cut term (WRITING.md 7.6)`);
  if (!speech && WHAT_RE.test(text)) out.push('"what" as the target: say enemies');
  if (FRACTION_RE.test(text)) out.push('a fraction in words: say it in digits');
  return out;
}

test('voice (RULING-L1): no cut term, no "what" as a target, no fraction in words, in the data, on any card, or in the glossary', () => {
  const bad = [];
  for (const [label, text] of dataLines()) {
    const speech = /\.(text|hubLine)$/.test(label) || label.startsWith('npcs');
    for (const f of langFaults(text, speech)) bad.push(`data ${label}: ${f}: "${text}"`);
  }
  for (const [c, info] of allCards()) for (const k of ['desc', 'note', 'form', 'rule', 'kin', 'step']) if (typeof info[k] === 'string') for (const f of langFaults(info[k])) bad.push(`card ${c.kind}:${c.id}:${c.level}.${k}: ${f}: "${info[k]}"`);
  for (const e of DATA.glossary) for (const k of ['desc', 'more', 'short']) if (typeof e[k] === 'string') for (const f of langFaults(e[k])) bad.push(`glossary ${e.id}.${k}: ${f}: "${e[k]}"`);
  assert.deepEqual(bad, [], `${bad.length}:\n${bad.join('\n')}`);
});

test('voice (RULING-L1): a glossary entry is 40 words or fewer, and every system line on a card names a glossary entry', async () => {
  const { termsIn } = await import('../src/ui/glossary.js');
  for (const e of DATA.glossary) assert.ok(e.desc.split(/\s+/).length <= 40, `${e.id}: ${e.desc.split(/\s+/).length} words`);
  const build = { tags: { fire: 1 }, weapons: DATA.weapons.map((w) => w.id), passives: [], formSeen: true };
  for (const [c, info] of allCards()) for (const k of ['note', 'form', 'kin']) {
    const t = info[k];
    if (typeof t === 'string') assert.ok(termsIn(t, DATA).length > 0, `card ${c.kind}:${c.id}.${k} names no glossary entry: "${t}"`);
  }
  const fresh = cardInfo({ kind: 'weapon', id: 'flare_gun', level: 1, isNew: true }, DATA, build);
  assert.ok(termsIn(fresh.note, DATA).length > 0, fresh.note);
});

test('voice (RULING-L1): the checks catch what they are for', () => {
  assert.equal(langFaults('Her light burns what stands in it.').length, 1);
  assert.equal(langFaults('Kindred: +16%').length, 1);
  assert.equal(langFaults('It reaches half again as far.').length, 1);
  assert.equal(langFaults('Gaff Hook: the anchor hooks every enemy.').length, 0, 'an object called a gaff is fine');
  assert.equal(langFaults('Her light burns enemies in it.').length, 0);
});

// ------------------------------------------------------------------------------ round 2 (L4's guards, Nov 19)

/** Every text field of a thing (name, desc, who, gives, costs, card lines, a downside, a price), as [label, text]. */
function textsOf(x, at) {
  const out = [];
  for (const k of ['name', 'desc', 'who', 'gives', 'costs', 'downside', 'price', 'more', 'short', 'where']) if (typeof x?.[k] === 'string') out.push([`${at}.${k}`, x[k]]);
  for (const k of ['does', 'costs']) if (typeof x?.card?.[k] === 'string') out.push([`${at}.card.${k}`, x.card[k]]);
  if (typeof x?.trade?.deedText === 'string') out.push([`${at}.deedText`, x.trade.deedText]);
  return out;
}

test('voice (round 2): no "oil" in the Lamplighter\'s text: her meter is Fuel (Oil is the material)', async () => {
  const { TREE_ROWS } = await import('../src/data/skills.js');
  const her = DATA.characters.find((c) => c.id === 'lamplighter');
  const sig = DATA.weapons.find((w) => w.id === her.signature);
  const lines = [
    ...textsOf(her, 'lamplighter'),
    ...DATA.skills.filter((s) => s.character === her.id).flatMap((s) => textsOf(s, `skill ${s.id}`)),
    ...textsOf(sig, sig.id), ...[...(sig.lines || []), ...(sig.specials || [])].flatMap((x) => textsOf(x, `${sig.id} ${x.id}`)),
    ...DATA.ascensions.filter((l) => l.weapons.includes(sig.id)).flatMap((l) => l.options.flatMap((o) => textsOf(o, `form ${o.id}`))),
    ...DATA.glossary.filter((e) => e.only?.character === her.id).flatMap((e) => textsOf(e, `glossary ${e.id}`)),
    ...TREE_ROWS[her.id].map((t) => ['tree row', t]),
  ];
  assert.ok(lines.length > 30, `${lines.length} lines`);
  assert.deepEqual(lines.filter(([, t]) => /\boil\b/i.test(t)).map(([k, t]) => `${k}: ${t}`), []);
});

test('voice (round 2): no "tier" in relic text or on the relic screens (relics have rarities)', () => {
  const lines = [
    ...DATA.relics.flatMap((r) => textsOf(r, `relic ${r.id}`)),
    ...DATA.glossary.filter((e) => /relic|vault|reliquar/i.test(`${e.id} ${e.name} ${e.desc}`)).flatMap((e) => textsOf(e, `glossary ${e.id}`)),
  ];
  for (const b of DATA.buildings) for (let lv = 1; lv <= b.levels.length; lv++) for (const e of levelEffects(DATA, b.id, lv)) if (/relic/i.test(e.text)) lines.push([`${b.id} Lv ${lv}`, e.text]);
  for (const f of SCREEN_FILES) for (const s of literals(read(f))) if (/relic/i.test(s)) lines.push([f, s]);
  assert.ok(lines.length > 40, `${lines.length} lines`);
  assert.deepEqual(lines.filter(([, t]) => /\btiers?\b/i.test(t)).map(([k, t]) => `${k}: ${t}`), []);
});

/** Every name of content the player picks or meets, with its kind. */
function contentNames() {
  const kinds = ['weapons', 'passives', 'relics', 'dashes', 'skills', 'research', 'upgrades', 'recipes', 'consumables', 'trophies', 'curses', 'kits', 'characters', 'materials', 'npcs'];
  const out = kinds.flatMap((k) => (DATA[k] || []).filter((x) => typeof x?.name === 'string').map((x) => [k, x.name]));
  for (const l of DATA.ascensions) for (const o of l.options) out.push(['forms', o.name]);
  for (const w of DATA.weapons) for (const x of [...(w.lines || []), ...(w.specials || [])]) out.push(['traits', x.name]);
  for (const m of DATA.maps) for (const e of m.deck || []) out.push(['map events', e.name]);
  return out;
}

// The game's own one-word terms for a character's meter or a run system (the glossary's): no content
// name may use one as a word, since the name then reads as an upgrade of that system ("Fuel Line").
const SYSTEM_WORDS = ['Fuel', 'Momentum', 'Ember', 'Embers', 'Thrall', 'Thralls', 'Pearls', 'Shield', 'Form', 'Forms', 'Trait', 'Traits', 'Drawback', 'Signature', 'Reliquary', 'Overtime', 'Heirloom', 'Mastery'];

test('voice (round 2): no name shares a word with one of the game\'s system terms, and no two names are near-twins', () => {
  const terms = new Set(SYSTEM_WORDS.filter((w) => DATA.glossary.some((e) => [e.name, ...(e.aliases || [])].some((a) => a.toLowerCase() === w.toLowerCase()))));
  assert.ok(terms.size >= 10, [...terms].join(', '));
  const names = contentNames();
  // A name in that same system may use its word: her Fuel skill, a tin that holds an Ember.
  const SAME = new Set(['Spare Fuel', 'Ember Tin']);
  const bad = names.filter(([, n]) => !SAME.has(n) && n.split(/[\s']+/).some((w) => terms.has(w))).map(([k, n]) => `${k}: ${n}`);
  assert.deepEqual(bad, [], 'a name uses a system word');
  // Near-twins: two first words on one long stem (6 letters) where neither is the other plus an ending
  // (Lodestar beside Lodestone; Harpoon beside Harpooner is one family, and fine).
  const firsts = [...new Map(names.map(([k, n]) => [n.split(/[\s']+/)[0], `${k}: ${n}`]))];
  const twins = [];
  for (let i = 0; i < firsts.length; i++) for (let j = i + 1; j < firsts.length; j++) {
    const [a, x] = firsts[i], [b, y] = firsts[j], A = a.toLowerCase(), B = b.toLowerCase();
    if (A.length >= 6 && B.length >= 6 && A.slice(0, 6) === B.slice(0, 6) && !A.startsWith(B) && !B.startsWith(A) && !FAMILY.some((f) => f.includes(A) && f.includes(B))) twins.push(`${x} / ${y}`);
  }
  assert.deepEqual(twins, [], 'two names are near-twins');
});

// One family on purpose (the Lamplighter's own things; the Harpooner's own trait), not near-twins.
const FAMILY = [['lamplight', 'lamplit', 'lamplighter'], ['harpooner', 'harpooned']];

/** Names that were retired (renamed or cut); no player text may name them. */
const RETIRED = ['Barrow Wight', 'Wight\'s Shadow', 'Sunk Cost', 'Gaffed', 'Tide Marks', 'Tide of Bones', 'Bell Tide', 'Drowned Bells', 'Long Barrow', 'Burning Wards', 'Spare Oil', 'Fuel Line', 'Lodestar', 'Tide Pools', 'Tide Forging', 'The Rat Tide', 'Reaper\'s Wake', 'Encore', 'Conductor', 'Magnesium'];

test('voice (round 2): a skill names only things that exist, and nothing names a retired name', () => {
  const known = new Set([...contentNames().map(([, n]) => n.replace(/^The /, '')), ...DATA.glossary.flatMap((e) => [e.name, ...(e.aliases || [])]),
    ...DATA.maps.map((m) => m.name), ...DATA.buildings.map((b) => b.name), ...DATA.enemies.map((e) => e.name.replace(/^The /, '')),
    ...DATA.maps.flatMap((m) => (m.secrets || []).map((s) => s.name))].map((n) => n.toLowerCase()));
  const bad = [];
  for (const s of DATA.skills) {
    // A run of two or more capitalized words ("Sleigh Ride", "Punt Pole's") names a thing: it must be one.
    for (const m of s.desc.matchAll(/(?<![\w'])(?:[A-Z][\w]*(?:'s)?\s){1,3}[A-Z][\w]*(?:'s)?/g)) {
      const phrase = m[0].replace(/'s\b/g, '').replace(/^(When|While|After|Once|With|On|At|Her|His|Each|Every|A|An|The|In|For|Lighting|Touching|Standing)\s/, '');
      if (phrase.includes(' ') && !known.has(phrase.toLowerCase())) bad.push(`${s.id}: "${m[0]}" names nothing`);
    }
    if (/\bwight\b/i.test(s.desc)) bad.push(`${s.id}: "wight" (Barrow Wight is Barrow Keeper)`);
  }
  const retired = new RegExp(`\\b(${RETIRED.map((n) => n.replace(/'/g, "['’]")).join('|')})\\b`);
  for (const [label, text] of dataLines()) if (!/\.id$/.test(label) && retired.test(text)) bad.push(`${label}: "${text.match(retired)[0]}" was renamed: "${text}"`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('voice (round 2): the guards catch what they are for', () => {
  assert.ok(/\boil\b/i.test('When her oil runs out a flask fills it once.'));
  assert.ok(/\btiers?\b/i.test('Relics are offered a tier better.'));
  assert.ok('Fuel Line'.split(/[\s']+/).includes('Fuel') && SYSTEM_WORDS.includes('Fuel'));
  assert.ok('lodestar'.slice(0, 6) === 'lodestone'.slice(0, 6) && !'lodestone'.startsWith('lodestar'), 'Lodestar and Lodestone are twins');
  assert.ok(new RegExp(`\\b(${RETIRED.join('|').replace(/'/g, "['’]")})\\b`).test('Needs Barrow Wight.'));
});

// ------------------------------------------------------------------------------ round 4 (the director's calls, Nov 20)

/** Damage multiples one way (WRITING.md 7.6): +N% Damage for a lasting bonus, Nx for one hit; no stat tacked on with ", with". */
const MULTIPLE_RE = /\b(double|triple|quadruple) damage\b|\b\d+ times (the|its) damage\b|\bdamage times \d/i;
const TAIL_RE = /, with [+\-][\d.]+% Damage(\.|,| \+)/;

test('voice (round 4): damage multiples one way, and no ", with +N% Damage" tail', () => {
  const bad = [];
  for (const [label, text] of dataLines()) {
    if (MULTIPLE_RE.test(text)) bad.push(`${label}: a multiple in words (write 2x, 3x): "${text}"`);
    if (TAIL_RE.test(text)) bad.push(`${label}: end the sentence, then the stat: "${text}"`);
  }
  for (const e of DATA.glossary) for (const k of ['desc', 'more', 'short']) if (typeof e[k] === 'string' && MULTIPLE_RE.test(e[k])) bad.push(`glossary ${e.id}.${k}: "${e[k]}"`);
  assert.deepEqual(bad, [], bad.join('\n'));
  assert.ok(MULTIPLE_RE.test('bites for double damage') && TAIL_RE.test('Puddles creep, with +60% Damage.') && !TAIL_RE.test('Picks fly 60% farther, with +100% Damage on the way back.'));
});

test('voice (round 4): a character\'s notices and tips come from its own rules, where it has one', async () => {
  const { tipText, sightingLine } = await import('../src/app/runtips.js');
  const ev = () => { const e = { type: [], a: [], b: [], c: [], d: [], x: [], y: [], count: 0 }; e.push = (type, a, b, c, d = 0) => { e.type.push(type); e.a.push(a); e.b.push(b); e.c.push(c); e.d.push(d); e.x.push(0); e.y.push(0); e.count++; return e.count - 1; }; return e; };
  const lampOf = (w) => w.tasks.findIndex((t) => t.kind === TASK.LAMP && !t.twist);
  const bellOf = (w) => w.tasks.findIndex((t) => t.kind === TASK_KIND_BELL);
  const make = (character, extra = {}) => createWorld({ seed: 4, character, ...extra }, DATA);
  const lampKey = Object.entries(DATA.meta.fieldGuide).find(([, g]) => g.term === 'lamp')?.[0];

  // The Lamplighter: her lamp lights at a touch (no "stay in its circle"), it fills her Fuel, her Lantern Night has her crowd, her first sighting is her own.
  const her = make('lamplighter'), e1 = ev();
  const start = e1.push(EV.TASK, TASK.LAMP, 1, lampOf(her)), lit = e1.push(EV.TASK, TASK.LAMP, 2, lampOf(her)), night = e1.push(EV.NIGHT, 2, 0, 1);
  assert.equal(noticeFor(e1, start, her), null, 'no "stay in its circle" for her');
  assert.match(noticeFor(e1, lit, her), /your Fuel is full/);
  assert.match(noticeFor(e1, night, her), new RegExp(`starts when ${her.trade.P.crowd} enemies`));
  if (lampKey) assert.match(sightingLine(DATA, lampKey, her), /Walk to it to light it/);

  // Anyone else: the general lines.
  const other = make('harpooner'), e2 = ev();
  const s2 = e2.push(EV.TASK, TASK.LAMP, 1, lampOf(other)), n2 = e2.push(EV.NIGHT, 2, 0, 1);
  assert.match(noticeFor(e2, s2, other), /stay in its circle/);
  assert.match(noticeFor(e2, n2, other), new RegExp(`starts when ${DATA.tuning.tasks.night.crowd} enemies`));
  if (lampKey) assert.doesNotMatch(sightingLine(DATA, lampKey, other), /Walk to it to light it/);

  // The Punter crosses high water; walkers can't.
  const punter = make('punter', { map: 'salt_marsh' }), walker = make('harpooner', { map: 'salt_marsh' }), e3 = ev();
  const high = e3.push(EV.WATER, 3, 0, 0);
  assert.match(noticeFor(e3, high, punter), /You can cross/);
  assert.doesNotMatch(noticeFor(e3, high, walker), /You can cross/);

  // The Tide Priest: her crowd on the tip (Neap Priest's when she has it), and a bell that rings twice says so.
  const priest = make('tide_priest');
  assert.match(tipText('tide_call', priest), new RegExp(`Get ${priest.character.mechanic.params.crowd} enemies`));
  assert.match(tipText('tide_call', { ...priest, sk: { neap_priest: { crowd: 6 } } }), /Get 6 enemies/);
  const b = bellOf(priest), e4 = ev(), rung = e4.push(EV.TASK, TASK_KIND_BELL, 2, b);
  priest.tasks[b].state = 0;   // (sim/tasks.js: a bell that can ring again goes back to idle)
  assert.match(noticeFor(e4, rung, priest), /Start it again/);
  other.tasks[bellOf(other)].state = 2;
  const e5 = ev(), rung2 = e5.push(EV.TASK, TASK_KIND_BELL, 2, bellOf(other));
  assert.doesNotMatch(noticeFor(e5, rung2, other), /Start it again/);
});
