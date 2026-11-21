// The sweep's X1 batch (truth and names): one thing, one name, one description. These fail when
// a term is described in a second place, when a glossary number is typed instead of read from the
// data, when two things share a name, when an order can't be done or opens nothing real, when a
// merged order's old id stops counting, and when the Tide Priest is handed healing she can't use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { GLOSSARY, term, termShort, termLine, fieldGuideEntry, TAGS, ORDER_OPENS } from '../src/data/glossary.js';
import { termsIn } from '../src/ui/glossary.js';
import { levelEffects, mapCard, slotsText, changeLines, ordersKeptText, tideLine } from '../src/ui/hubtext.js';
import { guideEntry } from '../src/app/runlogic.js';
import { SIGHT_NAMES } from '../src/sim/events.js';
import { secretShut } from '../src/sim/trades.js';
import { featsDone, featsHeld, contentFrom, resolveContent, slotsFor, isUnlocked } from '../src/meta/state.js';
import { reconcileProfile } from '../src/meta/reconcile.js';
import { applyRunResult } from '../src/meta/apply.js';
import { restoreBuilding, whyNotResearch } from '../src/meta/actions.js';
import { runConfigFor, healOnly, noHealRefusal } from '../src/meta/runconfig.js';
import { kitsOf, gearForRun, raresLeft } from '../src/meta/workshop.js';
import { setupRows, startChoice, settleChoice } from '../src/app/setup.js';
import { codexEntries } from '../src/meta/codex.js';
import { createWorld } from '../src/sim/world.js';
import { levelSetPieces } from '../src/app/hublogic.js';
import { SLOT_NAMES } from '../src/data/gear.js';
import { RELIC_TIERS } from '../src/data/relics.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const fresh = (levels = {}, extra = {}) => { const d = defaultProfile(); d.profile.buildings = { ...levels }; Object.assign(d.profile, extra); return d; };
const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 1e6]));

// ------------------------------------------------------------------------------ one description

test('X1: the field guide describes nothing itself: every sighting names a glossary entry with a short line, and a first sighting says that line', () => {
  for (const [key, g] of Object.entries(DATA.meta.fieldGuide)) {
    assert.deepEqual(Object.keys(g), ['term'], `${key}: only the glossary entry's id (no name, no line of its own)`);
    const e = term(g.term);
    assert.ok(e && typeof e.short === 'string' && e.short.length < 140, `${key}: its entry ${g.term} has a short line`);
    assert.deepEqual(guideEntry(DATA, key), { name: e.name, line: e.short, term: e.id });   // (round 3: the term too, for the Lamplighter's own lamp line)
    assert.equal(fieldGuideEntry(DATA.meta, key).term, e.id);
  }
  for (const k of Object.values(SIGHT_NAMES)) assert.ok(guideEntry(DATA, k), `the field guide knows ${k}`);
  // A1: the lamp stays lit, and the bell is tolled from its small ring.
  assert.doesNotMatch(guideEntry(DATA, 'lamp').line, /boss|puts it out/);
  assert.match(guideEntry(DATA, 'lamp').line, /stays lit for the rest of the run/);
  assert.match(guideEntry(DATA, 'bell').line, /small circle/);   // (RULING-L1: the circle on the ground)
  assert.match(guideEntry(DATA, 'causeway').line, /Only the Bog Warden/);
});

test('X1: a building\'s level line, the gate\'s rows, and the results say a term in the glossary\'s words, and no screen file keeps a second copy', () => {
  const has = (b, lv, id, name) => assert.ok(levelEffects(DATA, b, lv).some((e) => e.text === termLine(id, name)), `${b} Lv ${lv}: ${termLine(id, name)}`);
  has('library', 1, 'research'); has('tavern', 1, 'feat'); has('tavern', 2, 'mastery'); has('smithy', 4, 'rune_stone', 'Rune stones');
  has('cartographer', 3, 'challenge', 'Challenge runs'); has('tavern', 3, 'heirloom'); has('apothecary', 1, 'consumable', 'Run tools'); has('cartographer', 4, 'short_run', 'Short runs');
  assert.ok(levelEffects(DATA, 'docks', 1)[0].text.endsWith(termShort('ferryman').replace(/\.$/, '')));
  assert.ok(levelEffects(DATA, 'chapel', 1)[0].text.includes(tideLine()));
  // A building's glossary entry is its panel's own description.
  for (const b of DATA.buildings) assert.ok(term(b.id).desc.startsWith(b.desc), `${b.id}: one description`);
  // An elite affix's entry is the enemy data's own line.
  for (const e of GLOSSARY.filter((x) => x.where.startsWith('An elite affix'))) assert.ok(DATA.enemies && e.desc.length > 10);
  // The sentences that used to be written twice are in no screen or data file but the glossary.
  const twice = ['Goals the townsfolk post', 'spend materials on a project', 'An arcana adds one rule', 'A boost for this run', 'harder runs that pay more materials',
    'set rules, and a reward you only get once', 'until the next boss puts it out', 'Stay by it to ring it', 'a harder version of the map that pays', 'ladder of kill counts'];
  for (const f of ['src/ui/hubtext.js', 'src/ui/hubscreens.js', 'src/app/setup.js', 'src/data/meta.js', 'src/app/runlogic.js', 'src/app/hublogic.js']) {
    const text = src(f);
    for (const t of twice) assert.ok(!text.includes(t), `${f} writes "${t}" itself: read the glossary entry`);
  }
});

test('X1: no number in the glossary is typed: each is read from the data it describes, and its lists are the data\'s lists', () => {
  // The entries' own source: outside ${...}, a string holds no digit but a term's own name (Act 2, Tide 1) or a button's (R1, L2).
  const file = src('src/data/glossary.js');
  const body = file.slice(file.indexOf('export const GLOSSARY = ['), file.indexOf('const BY_ID'));
  const strip = (s) => { let out = '', depth = 0; for (let i = 0; i < s.length; i++) { if (s[i] === '$' && s[i + 1] === '{') { depth++; i++; continue; } if (depth) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; continue; } out += s[i]; } return out; };
  const typed = strip(body).replace(/\b(Act|Tide) [123]\b|\b(R1|L2)\b/g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).filter((l) => /\d/.test(l));
  assert.deepEqual(typed, [], 'a typed number in a glossary entry: read it from the data');
  for (const b of DATA.buildings) assert.doesNotMatch(b.desc, /\d/, `${b.id}: its description holds no number`);
  // The affix lines are the enemy data's, so their numbers are held to the tuning here.
  const A = DATA.tuning.affixes, S = DATA.tuning.player.slow;
  assert.ok(term('warded').desc.includes(`${A.wardHits} hits`) && term('herald').desc.includes(`${A.herald} of`) && term('tethered').desc.includes(`${A.links} of`));
  assert.ok(term('brine_affix').desc.includes(`${Math.round(S.brine * 100)}% for ${S.brineSec}s`));
  // Lists built from the data (A6).
  const tags = new Set([...DATA.weapons, ...DATA.passives].flatMap((x) => x.tags || []));
  assert.deepEqual([...TAGS].sort(), [...tags].sort());
  for (const t of tags) assert.ok(term('tag').desc.includes(t.charAt(0).toUpperCase() + t.slice(1)), `the tags entry names ${t}`);
  assert.ok(ORDER_OPENS.length >= 8 && !term('feat').desc.includes('challenge run'), 'what orders open, from what is keyed to them');
  for (const what of ['recipe', 'kit', 'character', 'event']) assert.ok(DATA.feats.some((f) => contentFrom(DATA, `feat:${f.id}`)[0]?.what === what), what);
  for (const t of Object.keys(RELIC_TIERS)) assert.ok(term('relic').desc.includes(DATA.rarities[Number(t) - 1].name), 'relics say their rarities (RULING-L1: no tier names)');
  // A6's sixteen, each by the fact it got wrong.
  assert.match(term('weapon').where, /starts with two/);
  assert.equal(term('arcana'), undefined, 'arcana are relics now (ruling 11)'); assert.match(term('heirloom').where, /Tavern opens it at level 3/); assert.doesNotMatch(GLOSSARY.map((e) => `${e.desc} ${e.where} ${(e.aliases || []).join(' ')}`).join(' '), /\b[Ff]eats?\b/);
  assert.match(term('apothecary').where, /^Restore it with Rum, Oil, and Coin\./);
  assert.match(term('muster').where, /In overtime/); assert.match(term('muster').more, /cleared the Marsh/);   // (RULING-L1: Champion cut; its facts are the Muster's)
  assert.doesNotMatch(term('lantern_night').where, /at once/);
  assert.equal(term('rune'), undefined, 'runes are gone (ruling 14)');
  assert.match(term('form').more, /Some Final Forms/);
  assert.match(term('reliquary').where, new RegExp(`${DATA.tuning.relics.reliquaryPity} kills`));
  assert.match(term('skip').desc, /A skip pays/);
  assert.match(term('material').where, /storm/);
  // A2: the slots entry names the levels.
  assert.match(term('slots').where, /Lamp Post's Lv 3 and Lv 5.*Smithy's Lv 2 and Lv 4/);
});

// ------------------------------------------------------------------------------ one name

test('X1: no name sits on two kinds of thing, and no glossary word is another thing\'s name (B1)', () => {
  const names = new Map();
  const add = (kind, name) => { if (!name) return; const k = name.replace(/^[Tt]he /, '').toLowerCase(); if (!names.has(k)) names.set(k, new Set()); names.get(k).add(kind); };
  for (const w of DATA.weapons) { add('weapon', w.name); for (const x of [...(w.lines || []), ...(w.specials || [])]) add('line', x.name); }
  for (const l of DATA.ascensions) for (const o of l.options) add('Form', o.name);
  for (const [k, list] of [['passive', DATA.passives], ['relic', DATA.relics], ['dash item', DATA.dashes], ['trophy', DATA.trophies], ['consumable', DATA.consumables], ['gear', DATA.recipes], ['upgrade', DATA.upgrades], ['skill', DATA.skills],
    ['order', DATA.feats], ['research', DATA.research], ['enemy', DATA.enemies], ['curse', DATA.curses], ['character', DATA.characters], ['material', DATA.materials], ['map', DATA.maps], ['keeper', DATA.npcs]]) for (const x of list) add(k, x.name);
  for (const m of DATA.maps) for (const e of m.deck) add('map event', e.name);
  for (const v of Object.values(SLOT_NAMES)) add('gear slot', v);
  for (const v of Object.values(RELIC_TIERS)) add('relic tier', v);
  const shared = [...names].filter(([, v]) => v.size > 1).map(([k, v]) => `${k}: ${[...v].join(', ')}`);
  assert.deepEqual(shared, [], 'one name on two kinds of thing');
  // A glossary word that is some content's name. (The Lantern Orb's capstone was "Wards"; it is Lantern Wards now.)
  const WAITING = new Set();
  const words = new Map(GLOSSARY.flatMap((e) => [e.name, ...(e.aliases || [])].map((w) => [w.toLowerCase(), e.id])));
  const own = { building: 1 };
  const clash = [...names].filter(([k, v]) => words.has(k) && !WAITING.has(k) && !(words.get(k) === 'gear' && v.has('gear slot')) && !(['relic_tier', 'relic'].includes(words.get(k)) && v.has('relic tier')) && !own[[...v][0]]).map(([k]) => k);
  assert.deepEqual(clash, [], 'a glossary word that is also a thing\'s name');
  // The button lands on the right entry.
  assert.deepEqual(termsIn('Moon Pull', DATA), []);
  assert.deepEqual(termsIn('Little Lanterns', DATA), [], 'the Form'); assert.deepEqual(termsIn('A lit lamp and its light', DATA), ['lamp']);   // (RULING-L1: the lamp's ward is its light)
  assert.deepEqual(termsIn('Tide Shield', DATA), ['tide_ward']);
  assert.ok(!termsIn(DATA.characters[0].desc, DATA).includes('lamp'), 'the Lamplighter\'s Lamplight is no Wayside Lamp'); // (her spare flames are a term of their own: C2's)
  assert.deepEqual(termsIn('Gear slots: Lantern, Coat, Boots, and Keepsake', DATA), ['gear']);
  assert.deepEqual(termsIn('Bell rung: open its chest for 2 levels', DATA), ['bell', 'chest']);
  assert.deepEqual(termsIn('Iron and Map Scraps left to buy before your next run: 3 of 3', DATA), ['run']);
  // B2: nothing a player reads says "feat" or a gear "tier".
  for (const b of DATA.buildings) for (let n = 1; n <= b.levels.length; n++) for (const e of levelEffects(DATA, b.id, n)) if (b.id === 'smithy') assert.doesNotMatch(e.text, /\btier\b/, e.text);
  assert.doesNotMatch(DATA.buildings.find((b) => b.id === 'tavern').desc, /feat/);
});

// ------------------------------------------------------------------------------ slots, the causeway

test('X1: every level that adds a slot says so, with how many that makes; the gate\'s card says the run\'s slots (A2)', () => {
  for (const [k, word] of [['weapons', 'Weapon'], ['passives', 'Passive'], ['relics', 'Relic']]) {
    const r = DATA.slots[k];
    r.at.forEach((lv, i) => assert.equal(levelEffects(DATA, r.building, lv)[0].text, `+1 ${word} slot in every run (${r.base + i + 1} of ${r.base + r.at.length})`));
    for (let lv = 1; lv <= 5; lv++) if (!r.at.includes(lv)) assert.ok(!levelEffects(DATA, r.building, lv).some((e) => e.text.includes(`${word} slot`)));
  }
  const d = fresh({ lamp_post: 3, docks: 4 });
  const n = slotsFor(d, DATA);
  assert.equal(slotsText(d, DATA), `Slots: ${n.weapons} weapons, ${n.passives} passives, ${n.relics} relics`);
  assert.ok(mapCard(d, DATA, 'drowned_docks').lines.includes('Slots: 5 weapons, 4 passives, 5 relics'));
});

test('X1: the causeway answers only to the Bog Warden, and every text says so (A4); the data\'s owner is the sim\'s', () => {
  for (const m of DATA.maps) for (const s of m.secrets) {
    assert.equal(secretShut({ character: { id: '__nobody' } }, s), s.only !== undefined, `${s.id}: data/maps.js \`only\` matches sim/trades.js`);
    if (s.only) assert.equal(secretShut({ character: { id: s.only } }, s), false);
  }
  const sc = DATA.maps[1].secrets.find((s) => s.id === 'drowned_causeway');
  assert.match(sc.hint, /Only the Bog Warden/);
  assert.match(DATA.feats.find((f) => f.id === 'warden_causeway').desc, /as the Bog Warden/);
  assert.ok(!DATA.feats.some((f) => f.when.secret === 'drowned_causeway' && f.when.character !== 'bog_warden'), 'no order sends anyone else');
  assert.match(mapCard(fresh(), DATA, 'salt_marsh').lines.at(-1), /5 secrets, and a secret only the Bog Warden can find$/);
  assert.match(`${term('secret').desc} ${term('secret').more}`, /Drowned Causeway, and only the Bog Warden finds anything there/);   // (RULING-L1: detail under More; the last polish: anyone can walk it)
});

// ------------------------------------------------------------------------------ orders

test('X1: an order asks for no more lamps or bells than its map\'s acts hold (A3), and an order\'s words are its check (A7)', () => {
  const most = (key, map) => Math.max(...DATA.maps.filter((m) => !map || m.id === map).map((m) => m.acts.reduce((s, a) => s + a[key], 0)));
  for (const f of DATA.feats) {
    if (f.when.lamps) assert.ok(f.when.lamps <= most('lamps', f.when.map), `${f.id}: ${f.when.lamps} lamps`);
    // (The Tide Priest's bells ring twice.)
    if (f.when.bells) assert.ok(f.when.bells <= most('bells', f.when.map) * (f.when.character === 'tide_priest' ? 2 : 1), `${f.id}: ${f.when.bells} bells`);
    if (f.when.act && f.when.lamps) assert.ok(f.when.lamps <= DATA.maps.find((m) => m.id === f.when.map).acts.slice(0, f.when.act).reduce((s, a) => s + a.lamps, 0), `${f.id}: lit by the end of that act's lamps`);
  }
  const runner = DATA.feats.find((f) => f.id === 'lamp_runner');
  assert.equal(runner.when.lamps, 14); assert.equal(runner.when.map, 'drowned_docks'); assert.match(runner.desc, /all 14 Wayside Lamps/);
  assert.doesNotMatch(DATA.feats.find((f) => f.id === 'eye_of_the_storm').desc, /Eye/);
  assert.doesNotMatch(DATA.feats.find((f) => f.id === 'docks_ghost_ship').desc, /with 8/);
});

test('X1: merged orders (C6): one order for one goal, an old id still counts, and a save keeps what it had', () => {
  const ids = new Set(DATA.feats.map((f) => f.id));
  for (const old of ['bell_breaker', 'causeway']) assert.ok(!ids.has(old), `${old} is merged away`);
  const was = DATA.feats.flatMap((f) => (f.was || []).map((o) => [o, f.id]));
  // (ruling 19 PD: each drafted weapon's "Proven" became "Both Ways", data/orders-weapons.js)
  const both = DATA.weapons.filter((w) => !w.signature && !w.innate).map((w) => [`${w.id}_capstone`, `${w.id}_both`]);
  assert.deepEqual(was.sort(), [['bell_breaker', 'dawn'], ['causeway', 'warden_causeway'], ['kit_fulgurite', 'kit_fog_horn'], ...both].sort());   // (ruling 18 WD: the Fulgurite's order is the Fog Horn's)
  for (const [old] of was) assert.ok(!ids.has(old), 'an old id is never reused');
  // No two orders are the same order: no two share a condition.
  const seen = new Map();
  for (const f of DATA.feats) { const k = JSON.stringify(Object.entries(f.when).sort()); assert.ok(!seen.has(k), `${f.id} is ${seen.get(k)} over again`); seen.set(k, f.id); }
  // A save from before the merge: done under the old ids, some under both.
  const old = fresh({ tavern: 1 }, { feats: ['bell_breaker', 'causeway', 'dawn', 'maw_slayer'], featsFound: ['causeway'], orphans: { feats: ['bell_breaker'] } });
  assert.ok(featsDone(old, DATA).has('dawn') && featsDone(old, DATA).has('warden_causeway'), 'read before any reconcile');
  const r = reconcileProfile(old, DATA).doc;
  assert.deepEqual(r.profile.feats.sort(), ['dawn', 'maw_slayer', 'warden_causeway']);
  assert.deepEqual(r.profile.featsFound, ['warden_causeway']);
  assert.equal(r.profile.orphans?.feats, undefined, 'nothing of a merged order is set aside');
  assert.equal(r.profile.featsHeld, undefined);
  const c = resolveContent(r, DATA);
  assert.ok(c.consumables.includes('smelling_salts') && c.forms.includes('bog_kin'), 'what both old orders opened is still open');
  assert.deepEqual(reconcileProfile(r, DATA).doc.profile.feats.sort(), r.profile.feats.sort(), 'and again changes nothing');
  // Only the old id: the same.
  const only = reconcileProfile(fresh({}, { feats: ['bell_breaker'] }), DATA).doc;
  assert.deepEqual(only.profile.feats, ['dawn']);
  assert.ok(isUnlocked(only, DATA, 'feat:dawn'));
  // The props those orders opened still come out, as town dressing, not as a reward.
  for (const p of DATA.hub.props.filter((x) => String(x.from).startsWith('feat:'))) { assert.equal(p.unlock, undefined, p.id); assert.ok(ids.has(p.from.slice(5)), `${p.id}: ${p.from}`); }
});

test('X1: every order opens one real thing; a hard order never only a prop; no gear piece is another over again (D1)', () => {
  for (const f of DATA.feats) {
    const opens = contentFrom(DATA, `feat:${f.id}`);
    assert.equal(opens.length, 1, `${f.id} opens ${opens.map((x) => x.id).join(', ') || 'nothing'}`);
    if ((f.tier ?? 1) >= 3) assert.notEqual(opens[0].what, 'prop', `${f.id} (tier ${f.tier}) pays only a prop`);
  }
  const AF = new Map(DATA.affixes.map((a) => [a.id, a]));
  const piece = new Map(), own = new Map();
  for (const r of DATA.recipes) {
    const k = `${r.slot}|${r.base}`;
    assert.ok(!piece.has(k), `${r.id} is ${piece.get(k)} over again (same slot, same own bonus)`); piece.set(k, r.id);
    if (['rule', 'hook'].includes(AF.get(r.base).kind)) { assert.ok(!own.has(r.base), `${r.id} and ${own.get(r.base)}: worn together, one "${AF.get(r.base).name}" does nothing`); own.set(r.base, r.id); }
  }
  // The new rules reach the run.
  const d = fresh({ smithy: 5, chapel: 4, lamp_post: 5 }, { materials: { ...RICH } });
  const wear = (ids) => { const g = { inventory: [], equipped: {}, next: 1, rolls: 0 }; ids.forEach((id, i) => { const r = DATA.recipes.find((x) => x.id === id); g.inventory.push({ uid: i + 1, id, tier: 1, affixes: [r.base] }); g.equipped[r.slot] = i + 1; }); return { ...d, profile: { ...d.profile, gear: g, tides: {} } }; };
  const plain = runConfigFor(d, DATA, { character: 'lamplighter', seed: 's', curses: ['brittle', 'swarm'] });
  const cfg = runConfigFor(wear(['runners_ring', 'unlucky_penny', 'lightkeepers_pendant']), DATA, { character: 'lamplighter', seed: 's', curses: ['brittle', 'swarm'] });
  assert.equal(Math.round((cfg.harbor.lampSpeed - plain.harbor.lampSpeed) * 100), 25);
  assert.equal(Math.round((cfg.rewardMul - plain.rewardMul) * 100), 10, '5% a curse, 2 curses');
  assert.ok(cfg.mods.some((m) => m.stat === 'revival' && m.value === 1));
  assert.ok(createWorld(cfg, DATA));
  const tools = gearForRun(wear(['gull_charm', 'harbor_ring', 'counting_beads']), DATA).config;
  assert.deepEqual([tools.reroll, tools.banish, tools.skip], [1, 1, 1]);
  // The Lighthouse's stage 7: more of the Market's rares between runs, not a research slot nobody needs.
  assert.equal(raresLeft(fresh({ market: 1, lighthouse: 7 }), DATA), DATA.meta.marketRaresPerRun + 3);
  assert.equal(raresLeft(fresh({ market: 1, lighthouse: 6 }), DATA), DATA.meta.marketRaresPerRun);
});

test('X1: orders are judged from run 1, held until the Tavern keeps the board, and counted when it opens (D3)', () => {
  const run = { end: 'cleared', cleared: true, map: 'drowned_docks', character: 'lamplighter', timeSurvived: 1250, totalKills: 100, kills: {}, materials: {}, bossesKilled: [{ id: 'harbor_maw', weapons: [] }, { id: 'the_tidecaller', weapons: [] }] };
  const a = applyRunResult(fresh(), run, DATA);
  assert.deepEqual(a.doc.profile.feats, [], 'nothing counted yet');
  assert.ok(a.doc.profile.featsHeld.includes('maw_slayer') && a.doc.profile.featsHeld.includes('dawn'));
  assert.ok(!a.changes.some((c) => c.kind === 'feat' || c.kind === 'feat_found'));
  // A second run doesn't hold an order twice.
  const b = applyRunResult(a.doc, run, DATA);
  assert.equal(new Set(b.doc.profile.featsHeld).size, b.doc.profile.featsHeld.length);
  const held = [...featsHeld(b.doc, DATA)];
  // Restoring the Tavern counts them, opens what they open, and says so.
  b.doc.profile.materials = { ...RICH };
  const out = restoreBuilding(b.doc, DATA, 'tavern');
  const ch = out.changes[0];
  assert.deepEqual([...ch.orders].sort(), held.sort());
  assert.equal(out.doc.profile.featsHeld, undefined);
  for (const id of held) assert.ok(featsDone(out.doc, DATA).has(id), id);
  assert.ok(ch.unlocks.some((u) => u.what === 'consumable' && u.id === 'gull_bone'), 'what they opened is among the level\'s unlocks');
  assert.equal(ordersKeptText(DATA, held.length), `Bram kept count: ${held.length} orders done`);
  assert.equal(ordersKeptText(DATA, 1), 'Bram kept count: 1 order done');
  assert.ok(levelSetPieces(out.doc, DATA, ch).banner.lines.includes(`Bram kept count: ${held.length} orders done`));
  assert.ok(changeLines(DATA, [{ kind: 'orders_kept', ids: ['maw_slayer'] }]).some((l) => l.text === 'Bram kept count: 1 order done'));
  // Once the board is up, an order counts at once, and a restore with nothing held says nothing.
  const c = applyRunResult(fresh({ tavern: 1 }), run, DATA);
  assert.ok(c.doc.profile.feats.includes('maw_slayer') && c.doc.profile.featsHeld === undefined);
  const none = fresh({}, { materials: { ...RICH } });
  assert.equal(restoreBuilding(none, DATA, 'tavern').changes[0].orders, undefined);
  // A held order is kept through a reconcile, and one this build doesn't know is set aside.
  const kept = reconcileProfile(fresh({}, { featsHeld: ['maw_slayer', 'bell_breaker', 'not_yet'] }), DATA).doc;
  assert.deepEqual(kept.profile.featsHeld, ['maw_slayer', 'dawn']);
  assert.deepEqual(kept.profile.orphans.featsHeld, ['not_yet']);
});

test('X1: a project that finds things for a building in the fog needs that building (D2), and a find before its shop says where it will be', () => {
  for (const r of DATA.research) for (const x of contentFrom(DATA, `research:${r.id}`)) {
    const b = { recipe: 'smithy', consumable: 'apothecary' }[x.what];
    if (!b) continue;
    const root = (p) => (p.needs ? p : p.requires.map((q) => root(DATA.research.find((y) => y.id === q))).find(Boolean));
    assert.equal(root(r)?.needs, `building:${b}:1`, `${r.id} finds ${x.name}: it (or a project it requires) needs the ${b}`);
  }
  const d = fresh({ library: 1 }, { materials: { ...RICH } });
  assert.equal(whyNotResearch(d, DATA, 'smiths_ledger'), 'Restore the Smithy first');
  assert.equal(whyNotResearch(d, DATA, 'herb_notes'), 'Restore the Apothecary first');
  assert.equal(whyNotResearch(fresh({ library: 1, smithy: 1 }, { materials: { ...RICH } }), DATA, 'smiths_ledger'), null);
  const line = (doc) => changeLines(DATA, [{ kind: 'feat', id: 'maw_slayer', unlocks: [{ what: 'consumable', id: 'gull_bone' }], materials: {} }], doc).map((l) => l.text);
  assert.ok(line(fresh({ tavern: 1 })).includes('New run tool: Gull Bone (at the Apothecary, once it\'s restored)'));
  assert.ok(line(fresh({ tavern: 1, apothecary: 1 })).includes('New run tool: Gull Bone'));
});

// ------------------------------------------------------------------------------ the Tide Priest

test('X1: the Tide Priest is never sent out with, or dropped, healing she can\'t use (A5)', () => {
  const tp = DATA.characters.find((c) => c.id === 'tide_priest');
  assert.equal(tp.noHeal, true);
  assert.equal(DATA.characters.filter((c) => c.noHeal).length, 1);
  const heals = { relics: DATA.relics.filter(healOnly).map((x) => x.id), consumables: DATA.consumables.filter(healOnly).map((x) => x.id) };
  // (The sweep, ruling 11: Brine, once an arcana, is the relic Sea Rite; ruling 12: the Herb Salve only makes food heal more.)
  assert.deepEqual(heals, { relics: ['glass_lantern', 'brine'], consumables: ['herb_salve'] });
  const d = fresh(Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])), { feats: DATA.feats.map((f) => f.id), research: { done: DATA.research.map((r) => r.id), active: [] },
    codex: DATA.relics.map((r) => `relic:${r.id}`), consumables: { herb_salve: 1, gull_bone: 1 } });
  const cfg = runConfigFor(d, DATA, { character: 'tide_priest', seed: 's' });
  assert.equal(cfg.noHeal, true); assert.equal(cfg.noFood, true, 'no food drops');
  assert.ok(!cfg.pools.relics.includes('glass_lantern') && !cfg.pools.relics.includes('brine') && cfg.pools.relics.length > 5);
  const lamp = runConfigFor(d, DATA, { character: 'lamplighter', seed: 's' });
  assert.ok(lamp.pools.relics.includes('glass_lantern') && lamp.noHeal === undefined && lamp.noFood === undefined);
  assert.throws(() => runConfigFor(d, DATA, { character: 'tide_priest', seed: 's', heirloom: 'glass_lantern' }), /The Tide Priest can't heal: Glass Lantern would do nothing\./);
  assert.throws(() => runConfigFor(d, DATA, { character: 'tide_priest', seed: 's', consumables: ['herb_salve'] }), /can't heal/);
  assert.equal(noHealRefusal(DATA, 'lamplighter', DATA.relics.find((a) => a.id === 'brine')), null);
  // The gate leaves them out, and says why.
  const rows = setupRows(d, DATA, startChoice(d, DATA, 'tide_priest'));
  const heir = rows.find((r) => r.key === 'heirloom');
  assert.ok(!heir.choices.some(([id]) => id === 'brine' || id === 'glass_lantern') && heir.choices.length > 5);
  assert.ok(heir.detail.includes('The Tide Priest can\'t heal, so Glass Lantern and Sea Rite are left out.'));
  assert.ok(setupRows(d, DATA, startChoice(d, DATA, 'lamplighter')).find((r) => r.key === 'heirloom').choices.some(([id]) => id === 'brine'));
  assert.equal(settleChoice(d, DATA, { ...startChoice(d, DATA, 'tide_priest'), heirloom: 'brine' }).heirloom, '');
  // In the run: a find that holds food pays her Pearls or Coin, and the world takes the flag.
  const w = createWorld(cfg, DATA);
  assert.equal(w.config.noHeal, true);
  assert.throws(() => createWorld({ ...cfg, noHeal: 1 }, DATA), /noHeal/);
});

// ------------------------------------------------------------------------------ smaller truths (A7)

test('X1: a weapon order\'s kit is for any character; a codex blank for a signature weapon says whose', () => {
  // Every weapon order opens its weapon for every character whose first weapon it isn't.
  const d = fresh({ tavern: 2 }, { feats: DATA.feats.filter((f) => f.group === 'weapon').map((f) => f.id) });
  for (const c of DATA.characters) {
    const kits = kitsOf(d, DATA, c.id);
    for (const k of DATA.kits.filter((x) => x.character === '*' && x.start !== c.start)) assert.ok(kits.some((x) => x.start === k.start && x.open), `${c.id} can start with ${k.start}`);
  }
  assert.ok(!kitsOf(fresh({ tavern: 2 }), DATA, 'lamplighter').find((k) => k.id === 'lamplighter_orb').open, 'and without the order, their own kit waits for its rank');
  for (const e of codexEntries(fresh(), DATA).filter((x) => x.group === 'weapon' && !x.seen)) assert.doesNotMatch(e.hint, /not in this version/, e.id);
  assert.match(codexEntries(fresh(), DATA).find((x) => x.id === 'king_tide').hint, /^The Tide Priest's signature weapon/);
});
