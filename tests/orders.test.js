// W5, the meta (0.9.0): the Harbor Orders board, Tide clears opening content per map, the
// Lighthouse's stages, the codex and the title's completion line, mastery's ranks 2, 6, 8, and 10,
// the townsfolk's milestone lines, the Salt Marsh's challenges, the new arcana beside their relics,
// gear tiers as rarities, and old saves keeping what they earned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { featMet, judgeFeats, FEAT_KEYS } from '../src/meta/feats.js';
import { applyRunResult } from '../src/meta/apply.js';
import { featsDone, isUnlocked, resolveContent, contentFrom, researchSlots, levelOf, completion, npcLine, shownProps, mapEventsOpen, parseUnlock } from '../src/meta/state.js';
import { consumableSlots, kitsOf, raresCap } from '../src/meta/workshop.js';
import { unlockText, restoreBuilding } from '../src/meta/actions.js';
import { codexEntries, codexCount } from '../src/meta/codex.js';
import { reconcileProfile } from '../src/meta/reconcile.js';
import { runConfigFor } from '../src/meta/runconfig.js';
import { challengesOpen } from '../src/app/setup.js';
import { completionText } from '../src/app/hublogic.js';
import { mapCard, ordersFor, loadoutText, levelEffects, tierName, joinsTexts, changeLines } from '../src/ui/hubtext.js';
import { RARITIES, rarityOfTier } from '../src/data/rarity.js';
import { addRelic } from '../src/sim/build.js';
import { HOOKS } from '../src/sim/hooks.js';
import { EV } from '../src/sim/events.js';
import { makeWorld, runCollect } from './helpers/simworld.js';

const TPS = 60;
const fresh = () => defaultProfile();
const withLevels = (doc, levels) => { const d = structuredClone(doc); Object.assign(d.profile.buildings, levels); return d; };
const result = (r = {}) => ({ map: 'drowned_docks', end: 'died', timeSurvived: 400, bossesKilled: [], ...r });

test('orders: every new condition is read from the result, and an unknown one never holds', () => {
  const maxOf = (id) => DATA.passives.find((p) => p.id === id)?.maxLevel ?? Infinity;
  const r = result({
    character: 'harpooner', weaponLevelMax: { flare_gun: 8 }, capstones: ['flare_gun'], level: 90, totalKills: 5000, kills: { gull: 130 },
    elitesKilled: 7, bossesKilled: [{ id: 'harbor_maw', weapons: ['flare_gun'] }], lanternNights: 2, lampsLit: 11, relics: ['gull_feather', 'tide_clock'],
    passives: [{ id: 'wick_oil', level: 5 }, { id: 'lodestone', level: 2 }], ferryBought: 3, reliquaries: 4, embers: 9, dashKills: 300, damageTaken: 40,
    overtimeMinutes: 6, curses: ['brittle', 'swarm'], heirloom: 'kindling', challenge: 'lamp_only', mode: 'short', secretsFound: ['wreck_cache'], wellGiven: 'tide_clock',
    tags: { fire: 4 }, thralls: 12, herbsPicked: 14, act: 2, dawn: true, finds: ['a', { id: 'b' }], mapEvents: [{ id: 'ghost_ship' }],
  });
  const yes = { character: 'harpooner', weapon: 'flare_gun', capstone: 'flare_gun', level: 90, kills: 5000, enemy: { gull: 130 }, elites: 7, bosses: 1, nights: 2,
    lamps: 11, relics: 2, relic: 'tide_clock', passivesMax: 1, trades: 3, reliquaries: 4, embers: 9, dashKills: 300, damageTakenMax: 40, overtime: 6, curses: 2,
    curse: 'swarm', heirloom: true, run: 'lamp_only', mode: 'short', secret: 'wreck_cache', well: true, tag: { fire: 4 }, thralls: 12, herbs: 14, act: 2, dawnWon: true, finds: 2, find: 'b', mapEvent: 'ghost_ship' };
  for (const [k, v] of Object.entries(yes)) {
    assert.ok(FEAT_KEYS.includes(k), k);
    assert.equal(featMet({ [k]: v }, r, { kills: 0 }, maxOf), true, `${k} holds`);
  }
  const no = { character: 'punter', weapon: 'tide_bell', capstone: 'oil_flask', level: 91, kills: 5001, enemy: { gull: 131 }, elites: 8, bosses: 2, nights: 3,
    lamps: 12, relics: 3, relic: 'brass_button', passivesMax: 2, trades: 4, reliquaries: 5, embers: 10, dashKills: 301, damageTakenMax: 39, overtime: 7, curses: 3,
    curse: 'hunger', heirloom: 'glassblower', run: 'bare_hands', enemyTotal: { gull: 1 }, mode: 'standard', secret: 'drowned_causeway', tag: { fire: 5 }, thralls: 13, herbs: 15, act: 3, finds: 3, find: 'c', mapEvent: 'peat_fire' };
  for (const [k, v] of Object.entries(no)) assert.equal(featMet({ [k]: v }, r, { kills: 0 }, maxOf), false, `${k} doesn't hold`);
  // A Hunt reads the kills of every run (the lifetime numbers, not the result).
  assert.equal(featMet({ enemyTotal: { gull: 1000 } }, r, { kills: 0, enemyKills: { gull: 1000 } }, maxOf), true);
  assert.equal(featMet({ enemyTotal: { gull: 1000 } }, r, { kills: 0, enemyKills: { gull: 999 } }, maxOf), false);
  assert.equal(featMet({ well: true }, result()), false, 'no relic given');
  assert.equal(featMet({ dawnWon: true }, result()), false, 'no dawn');
  assert.equal(featMet({ damageTakenMax: 100 }, result()), false, 'a result with no damage count isn\'t met');
  assert.equal(featMet({ passivesMax: 1 }, r, { kills: 0 }), false, 'with no max levels to read, nothing is maxed');
  assert.equal(featMet({ swims: 1 }, r, { kills: 0 }), false, 'a key this build can\'t judge');
});

test('orders: about 80 on the board, each opening exactly one thing, posted by someone, in a section', () => {
  assert.ok(DATA.feats.length >= 75, `${DATA.feats.length} orders`);
  for (const f of DATA.feats) {
    assert.equal(contentFrom(DATA, `feat:${f.id}`).length, 1, f.id);
    assert.ok(DATA.npcs.some((n) => n.id === f.by), `${f.id}: by`);
  }
  // Their reward is shown as a "New ..." line; each kind reads as a person would say it.
  const kinds = new Set(DATA.feats.map((f) => contentFrom(DATA, `feat:${f.id}`)[0].what));
  for (const k of ['recipe', 'consumable', 'trophy', 'skill', 'kit', 'prop', 'relic', 'character']) assert.ok(kinds.has(k), `an order opens a ${k}`);
  assert.deepEqual(joinsTexts([{ what: 'prop', name: 'Square lamp' }]), ['New in the harbor: Square lamp']);
  assert.deepEqual(joinsTexts([{ what: 'kit', name: 'Flare Gun Kit' }]), ['New starting weapon: Flare Gun Kit']);
});

test('orders: judged from the first run; before the Tavern keeps the board they are held (the Chapel\'s Tide orders count at once); results say "Order done"', () => {
  const r = result({ end: 'cleared', cleared: true, tide: 2, bossesKilled: [{ id: 'harbor_maw', weapons: [] }, { id: 'the_tidecaller', weapons: [] }], timeSurvived: 1250 });
  const before = withLevels(fresh(), { chapel: 1 });
  before.profile.tides = { drowned_docks: 2 };
  const a = applyRunResult(before, r, DATA);
  assert.deepEqual(a.doc.profile.feats, ['docks_tide_2'], 'only the Tide order counts before the Tavern');
  // D3: the rest are judged all the same, and held until the board is up.
  assert.ok(a.doc.profile.featsHeld.includes('maw_slayer') && a.doc.profile.featsHeld.includes('dawn'), a.doc.profile.featsHeld.join(','));
  assert.ok(!a.changes.some((c) => c.kind === 'feat' && c.id !== 'docks_tide_2') && !a.changes.some((c) => c.kind === 'feat_found'), 'nothing is said of them yet');
  assert.ok(!resolveContent(a.doc, DATA).consumables.includes('gull_bone'), 'and nothing of theirs opens yet');
  assert.ok(resolveContent(a.doc, DATA).recipes.includes('cinder_coat'), 'and it opens the Cinder Coat');
  const b = applyRunResult(withLevels(before, { tavern: 1 }), r, DATA);
  assert.ok(b.doc.profile.feats.includes('maw_slayer') && b.doc.profile.feats.includes('dawn') && !b.doc.profile.feats.includes('bell_breaker'), 'Bell Breaker is the order dawn now (C6)');
  assert.equal(b.doc.profile.featsHeld, undefined);
  const lines = changeLines(DATA, b.changes, b.doc).map((l) => l.text);
  assert.ok(lines.includes('Order done: Maw Slayer') && lines.includes('New run tool: Gull Bone (at the Apothecary, once it\'s restored)'), lines.join(' | '));
  assert.ok(lines.includes('Order done: Bell Breaker'), 'the merged order by its name');
});

test('orders: old saves keep what they earned (a split order is done with the one it came from), and an unknown order is set aside', () => {
  const old = fresh();
  old.profile.feats = ['first_crossing', 'eel_season', 'some_future_order'];
  const doc = reconcileProfile(old, DATA).doc;
  assert.deepEqual(doc.profile.orphans.feats, ['some_future_order'], 'an order this build doesn\'t know is set aside, not lost');
  const done = featsDone(doc, DATA);
  for (const id of ['first_crossing', 'glass_underfoot', 'wet_feet', 'eel_season', 'lost_lights']) assert.ok(done.has(id), id);
  const c = resolveContent(doc, DATA);
  assert.ok(c.weapons.includes('glass_caltrops') && c.passives.includes('waders') && c.relics.includes('stray_light') && c.characters.includes('punter'), 'the content they opened before 0.9.0 (Lost Lights\' rune is the Stray Light relic now: ruling 14)');
  // Applying a run writes the derived ones in, so they stay (the board says Done).
  const next = applyRunResult(withLevels(doc, { tavern: 1 }), result({ bossesKilled: [{ id: 'harbor_maw', weapons: [] }] }), DATA).doc;
  assert.ok(featsDone(next).has('wet_feet'));
});

test('orders: the gate\'s map card names 3 to do there, and the gear you wear (rarity named)', () => {
  const d = withLevels(fresh(), { tavern: 1, smithy: 1 });
  const here = ordersFor(d, DATA, 'drowned_docks');
  assert.equal(here.length, 3);
  assert.ok(here.every((f) => f.group !== 'marsh' && f.when.map !== 'salt_marsh'));
  assert.equal(loadoutText(d, DATA), 'Wearing no gear. Make some at the Smithy');
  d.profile.gear = { inventory: [{ uid: 1, id: 'storm_lantern', tier: 3, affixes: ['fire_volley', 'might', 'vigor'] }], equipped: { lantern: 1 }, next: 2, rolls: 0 };
  assert.equal(loadoutText(d, DATA), 'Wearing: Storm Lantern (Rare)');
  const card = mapCard(d, DATA, 'drowned_docks');
  assert.ok(card.lines.some((l) => l.startsWith('Orders here: ')) && card.lines.includes('Wearing: Storm Lantern (Rare)'));
  assert.equal(loadoutText(fresh(), DATA), null, 'nothing before the Smithy');
});

test('rarity: one table for the game, gear tiers named by it', () => {
  assert.deepEqual(RARITIES.map((r) => r.name), ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
  assert.deepEqual([1, 2, 3, 4, 5].map(tierName), ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
  assert.equal(rarityOfTier(9).id, 'legendary');
  assert.ok(DATA.glossary.some((g) => g.id === 'rarity'));
});

test('tide clears: each map\'s Tides 2, 4, 6, 8, and 10 open one thing tied to it', () => {
  for (const map of ['docks', 'marsh']) {
    for (const n of [2, 4, 6, 8, 10]) {
      const f = DATA.feats.find((x) => x.id === `${map}_tide_${n}`);
      assert.ok(f && f.group === 'tide' && f.when.tide === n && f.when.cleared, `${map} ${n}`);
      assert.equal(contentFrom(DATA, `feat:${f.id}`).length, 1);
    }
  }
});

test('the Lighthouse: ten named stages, a big mix from both maps, a consumable slot at 4, more of the Market\'s Iron and Map Scraps at 7, a thing at each, a ruin until the Lamp Post\'s last level', () => {
  const L = DATA.buildings.find((b) => b.id === 'lighthouse');
  assert.equal(L.levels.length, 10);
  for (let n = 1; n <= 10; n++) {
    const lv = L.levels[n - 1];
    assert.equal(lv.stage, n);
    const total = Object.values(lv.cost).reduce((a, c) => a + c, 0);
    assert.ok(total > 3000, `stage ${n} is a sink (${total})`);
    if (n > 1) assert.ok(lv.cost.marsh_herbs > 0 && lv.cost.salt_glass > 0 && lv.cost.drowned_pages > 0, `stage ${n}: both maps`);
    // Each stage shows: the tower's stages to 5, then props, then the beam (render/hubtiles.js).
    const shows = n <= 5 || DATA.hub.props.some((p) => p.from === `lighthouse:${n}`) || n === 10;
    // (The sweep, D1: stage 7 was a research slot when every project was long done; it's the Market's rares now.)
    assert.equal(lv.researchSlotsAdd, undefined, `stage ${n}: no research slot`);
    const opens = contentFrom(DATA, `building:lighthouse:${n}`).length + (lv.consumableSlotsAdd ? 1 : 0) + (lv.marketRaresAdd ? 1 : 0) + (lv.lampSpeedAdd ? 1 : 0) + (lv.bellRingAdd ? 1 : 0);
    assert.ok(shows && opens === 1, `stage ${n}: shows and opens one thing`);
    assert.ok(levelEffects(DATA, 'lighthouse', n).some((e) => e.text.startsWith(`Stage ${n} of 10: `)));
  }
  const plot = DATA.hub.plots.find((p) => p.building === 'lighthouse');
  assert.equal(plot.openAt, 'lamp_post:5');
  // Stage 4 a consumable more (once the Apothecary sells any); stage 7 more of the Market's rares between runs.
  const d = withLevels(fresh(), { apothecary: 3, library: 5, lighthouse: 7 });
  assert.equal(consumableSlots(d, DATA), 3);
  assert.equal(researchSlots(d, DATA), 3, 'the Library\'s own: no stage adds one now');
  assert.equal(raresCap(d, DATA), DATA.meta.marketRaresPerRun + 3);
  assert.equal(raresCap(withLevels(fresh(), { lighthouse: 6 }), DATA), DATA.meta.marketRaresPerRun);
  assert.deepEqual(levelEffects(DATA, 'lighthouse', 7).map((e) => e.text), ['Stage 7 of 10: Set the lens', 'The Market sells 3 more Iron or Map Scraps between runs (6 in all)']);
  assert.equal(consumableSlots(withLevels(fresh(), { lighthouse: 7 }), DATA), 0);
  // Restoring a stage: the fog is gone with the Lamp Post at 5, and it costs what it says.
  const rich = withLevels(fresh(), { lamp_post: 5 });
  rich.profile.materials = Object.fromEntries(DATA.materials.map((m) => [m.id, 1e6]));
  const out = restoreBuilding(rich, DATA, 'lighthouse');
  assert.equal(levelOf(out.doc, 'lighthouse', DATA), 1);
  // (The sweep, X2: stage 1 sold a tonic; it speeds the Wayside Lamps now, on top of the Lamp Post's.)
  assert.equal(runConfigFor(out.doc, DATA, { character: 'lamplighter', seed: 1 }).harbor.lampSpeed, 0.75);
  assert.ok(shownProps(withLevels(fresh(), { lamp_post: 5, lighthouse: 6 }), DATA).some((p) => p.id === 'lighthouse_lamp'));
});

test('the codex: six kinds and the secrets, blanks with where each comes from, and the title\'s line', () => {
  const d = fresh();
  const all = codexEntries(d, DATA);
  const count = codexCount(d, DATA);
  assert.equal(count.of, all.length);
  assert.deepEqual(count.groups.map((g) => g.group), ['weapon', 'passive', 'relic', 'enemy', 'boss', 'map', 'secret']);
  assert.equal(count.seen, 1, 'the first map is open');
  const rod = all.find((e) => e.id === 'lightning_rod');
  assert.equal(rod.seen, false);
  assert.equal(rod.hint, `Opens with ${unlockText(DATA, 'research:storm_glass')}`);
  assert.equal(all.find((e) => e.id === 'flare_gun').hint, 'Can turn up in your runs now');
  assert.ok(all.find((e) => e.id === 'salt_marsh').hint.startsWith('Opens with '));
  // Seen: carried, killed, open; its lore once seen (a Library project's flavor).
  const s = structuredClone(d);
  s.profile.codex = ['weapon:lightning_rod'];
  s.profile.bestiary = { fog_wisp: 3, harbor_maw: 1 };
  const e = codexEntries(s, DATA);
  const r2 = e.find((x) => x.id === 'lightning_rod');
  assert.ok(r2.seen && r2.desc && r2.lore.startsWith('From Weatherglass: '));
  assert.ok(e.find((x) => x.id === 'fog_wisp').seen && e.find((x) => x.id === 'harbor_maw').seen && e.find((x) => x.id === 'harbor_maw').group === 'boss');
  // The title: nothing on a new profile, then the completion and the codex.
  assert.equal(completionText(d, DATA), null);
  s.stats.runs = 1;
  assert.match(completionText(s, DATA), /^Completion \d+%\. Codex 4 of \d+$/);
  assert.ok(completion(s, DATA).parts.some((p) => p.name === 'bestiary' && p.have === 2));
});

test('mastery: every rank opens something; ranks 2 and 10 for each character, 6 a recipe, 8 a challenge', () => {
  const R = DATA.meta.masteryRanks;
  for (const c of DATA.characters) {
    const at = (rank) => { const d = withLevels(fresh(), { tavern: 2, cartographer: 3 }); d.profile.characters = { [c.id]: { unlocked: true, masteryXp: R[rank - 1], perks: [] } }; return d; };
    assert.ok(DATA.kits.some((k) => k.character === c.id && k.rank === 2), `${c.id}: a kit at 2`);
    assert.ok(DATA.recipes.some((r) => r.unlock === `mastery:${c.id}:6`), `${c.id}: a recipe at 6`);
    assert.ok(DATA.challenges.some((x) => x.unlock === `mastery:${c.id}:8`), `${c.id}: a challenge at 8`);
    assert.ok(DATA.skills.filter((s) => s.character === c.id).length === 13, `${c.id}: a tree of 13 skills`);
    const r6 = DATA.recipes.find((r) => r.unlock === `mastery:${c.id}:6`).id;
    assert.ok(!resolveContent(at(5), DATA).recipes.includes(r6) && resolveContent(at(6), DATA).recipes.includes(r6));
    assert.equal(unlockText(DATA, `mastery:${c.id}:6`), `the ${c.name} at mastery rank 6`);
  }
  assert.deepEqual(parseUnlock('mastery:punter:8'), { kind: 'mastery', id: 'punter', level: 8 });
  // A rank 8 challenge is offered once the rank is reached and the character has arrived.
  const d = withLevels(fresh(), { cartographer: 3 });
  assert.ok(!challengesOpen(d, DATA).some((x) => x.id === 'lamplighter_trial'));
  d.profile.characters = { lamplighter: { unlocked: true, masteryXp: R[7], perks: [] } };
  assert.ok(challengesOpen(d, DATA).some((x) => x.id === 'lamplighter_trial'));
});

test('kits: a weapon order\'s kit is anyone\'s, never a character\'s own first weapon, and the run starts with it', () => {
  const d = withLevels(fresh(), { tavern: 1, lamp_post: 2 });
  assert.ok(!kitsOf(d, DATA, 'harpooner').find((k) => k.id === 'any_oil_flask').open);
  d.profile.feats = ['kit_oil_flask'];
  const k = kitsOf(d, DATA, 'harpooner').find((x) => x.id === 'any_oil_flask');
  assert.ok(k.open);
  assert.ok(!kitsOf(d, DATA, 'lamplighter').some((x) => x.start === 'flare_gun' && x.id), 'the Lamplighter\'s own Flare Gun is her standard kit');
  assert.ok(isUnlocked(d, DATA, 'feat:kit_oil_flask'));
  assert.equal(runConfigFor(d, DATA, { character: 'harpooner', seed: 1, kit: 'any_oil_flask' }).startWeapon, 'oil_flask');
});

test('the Salt Marsh has challenges of its own', () => {
  assert.ok(DATA.challenges.filter((c) => c.map === 'salt_marsh' && !c.unlock).length >= 4);
});

test('townsfolk: lines key to run milestones (orders, bosses, secrets, Tides, runs), the newest showing', () => {
  const d = withLevels(fresh(), { tavern: 5 });
  const base = npcLine(d, DATA, 'innkeeper');
  d.profile.feats = ['dawn'];
  assert.notEqual(npcLine(d, DATA, 'innkeeper'), base);
  assert.match(npcLine(d, DATA, 'innkeeper'), /Tidecaller's bell has stopped/);
  d.profile.bestiary = { salt_widow: 1 };
  assert.match(npcLine(d, DATA, 'innkeeper'), /Salt Widow/);
  const keys = DATA.npcs.flatMap((n) => n.lines.map((l) => l.when.split(':')[0]));
  for (const k of ['feat', 'boss', 'secret', 'tide', 'runs', 'lighthouse']) assert.ok(keys.includes(k), k);
});

test('map events (W4): a deck entry an order opens joins the content, and RunConfig lists the open ones', () => {
  const DECK = { ...DATA, maps: DATA.maps.map((m, i) => (i === 0 ? { ...m, deck: [{ id: 'open_one', name: 'Low Fog' }, { id: 'ghost_ship', name: 'Ghost Ship', unlock: 'feat:maw_slayer' }] } : m)) };
  assert.deepEqual(contentFrom(DECK, 'feat:maw_slayer').find((x) => x.what === 'event'), { what: 'event', id: 'ghost_ship', name: 'Ghost Ship' });
  assert.deepEqual(mapEventsOpen(fresh(), DECK, 'drowned_docks'), ['open_one']);
  const d = fresh(); d.profile.feats = ['maw_slayer'];
  assert.deepEqual(mapEventsOpen(d, DECK, 'drowned_docks'), ['open_one', 'ghost_ship']);
  assert.equal(mapEventsOpen(d, { ...DATA, maps: DATA.maps.map(({ deck, ...m }) => m) }, 'salt_marsh'), null, 'no deck: RunConfig leaves it out');
  assert.deepEqual(joinsTexts([{ what: 'event', name: 'Ghost Ship' }]), ['New map event: Ghost Ship']);
});

test('relics that were arcana (ruling 11): two relics on one hook both work, and each price is in its line', () => {
  const w = makeWorld({ invulnerable: true, relics: ['long_beam'], heirloom: 'long_beam' });
  assert.equal(w.build.relics.length, 1, 'an Heirloom is a relic carried from 0:00, in a slot');
  addRelic(w, DATA.relics.find((r) => r.id === 'moon_pull'));
  const pulls = runCollect(w, 61 * TPS, EV.WAVE).filter((e) => e.c === 40 || e.a === 40);
  assert.equal(pulls.length, 3, 'Long Beam at 30s and 60s, Moon Pull at 60s');
  for (const id of ['moon_pull', 'brine', 'kindling', 'glassblower', 'long_beam']) {
    const r = DATA.relics.find((x) => x.id === id);
    assert.ok(r && HOOKS[r.hook], `${id}: a relic with a hook`);
    if (r.mods) assert.ok(r.downside && r.desc.includes(r.downside), `${id}: its price is said`);
  }
  assert.equal(DATA.arcana, undefined, 'the arcana list is gone');
});

test('prices: gear, consumables, and perks are goals against a run\'s haul (a consumable 5% to 35% of a run, by what it measurably adds)', () => {
  // A practiced run at the half-harbor stage (work/veteran/W5/income.txt).
  const RUN = { coin: 1931, oil: 1151, timber: 620, rope: 259, drowned_pages: 575, rum: 200, iron: 22, map_scraps: 8, marsh_herbs: 715, salt_glass: 50 };
  // The share of a run each price was set at (work/veteran/W5/tools/reprice.py): its Coin is that
  // share of a run's Coin times 0.6 (a consumable, a perk) or 0.5 (a recipe).
  const share = (cost, k) => (cost.coin ?? 0) / RUN.coin / k;
  for (const c of DATA.consumables) assert.ok(share(c.cost, 0.6) >= 0.045 && share(c.cost, 0.6) <= 0.36, `${c.id}: ${share(c.cost, 0.6).toFixed(3)}`);
  for (const r of DATA.recipes) assert.ok(share(r.cost, 0.5) >= 0.4, `${r.id}: ${share(r.cost, 0.5).toFixed(3)}`);
  // Nothing in the Apothecary is free against an hour of play (the 0.8.2 Smelling Salts were 20 Coin).
  assert.ok(DATA.consumables.every((c) => (c.cost.coin ?? 0) >= 50));
});
