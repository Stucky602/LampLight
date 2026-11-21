// The sweep's batch X2 (work/sweep/X2.md): the lead's rulings 11 to 13 (fewer systems), the gate at
// six rows, D5's stagger, and the leftovers in the builds batch's files. Saves first: each ruling
// has a migration test built from a profile shaped as the code before the sweep wrote it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { reconcileProfile } from '../src/meta/reconcile.js';
import { retireOld, RETIRED_ARCANA, RETIRED_CONSUMABLES, RETIRED_VERSION } from '../src/meta/retired.js';
import { resolveContent, featsDone, heirloomOpen, heirloomChoices, cursesAvailable, levelEffect, contentFrom, completion } from '../src/meta/state.js';
import { runConfigFor } from '../src/meta/runconfig.js';
import { bestiaryBonus, whyNotBuyConsumable, consumableSlots } from '../src/meta/workshop.js';
import { applyRunResult } from '../src/meta/apply.js';
import { setupRows, startChoice } from '../src/app/setup.js';
import { retiredNoteText } from '../src/app/hublogic.js';
import { codexEntries, MAP_CODEX_GROUPS } from '../src/meta/codex.js';
import { cardInfo, whereFrom } from '../src/ui/describe.js';
import { createWorld } from '../src/sim/world.js';
import { addRelic, removeRelic } from '../src/sim/build.js';
import { rollUpgrade } from '../src/sim/weaponups.js';
import { openChest } from '../src/sim/chests.js';
import { skipPay, levelGift, makeOffer } from '../src/sim/draft.js';
import { GIFT } from '../src/sim/events.js';
import { makeWorld, give } from './helpers/simworld.js';
import { HUNT_COUNTS } from '../src/data/trophies.js';   // (X3)

/** A profile as a build before the sweep saved it: the default shape (setup.arcana, challenges, bestiaryClaimed) with `extra` over it. */
function old(levels = {}, extra = {}) {
  const d = defaultProfile();
  Object.assign(d.profile.buildings, levels);
  const { setup, research, ...rest } = extra;
  Object.assign(d.profile, rest);
  if (setup) Object.assign(d.profile.setup, setup);
  if (research) d.profile.research.done = research;
  return d;
}
const load = (doc) => reconcileProfile(doc, DATA).doc;
const twice = (doc) => { const a = load(doc); assert.deepEqual(load(a), a, 'a second load changes nothing'); return a; };

// ------------------------------------------------------------------------------ ruling 11

test('X2 ruling 11: the arcana list is gone, five relics came of it, and the Heirloom is a relic found before, in a slot', () => {
  assert.equal(DATA.arcana, undefined);
  assert.ok(!existsSync(new URL('../src/data/arcana.js', import.meta.url)));
  assert.equal(DATA.glossary.find((e) => e.id === 'arcana'), undefined);
  for (const id of ['moon_pull', 'brine', 'kindling', 'glassblower', 'long_beam']) assert.ok(DATA.relics.some((r) => r.id === id), id);
  for (const [id, row] of Object.entries(RETIRED_ARCANA)) assert.ok(DATA.relics.some((r) => r.id === row.relic), `${id} became a relic this build has`);
  assert.equal(Object.keys(RETIRED_ARCANA).length, 14);
  assert.doesNotMatch(readFileSync(new URL('../src/sim/world.js', import.meta.url), 'utf8'), /cfg\.arcana|arcanaDef/);
  // What opened an arcana opens something real: no order and no Lighthouse stage is left empty.
  for (const row of Object.values(RETIRED_ARCANA)) {
    const key = row.was.replace(/^challenge:/, 'feat:');
    const lh = /^building:lighthouse:(\d+)$/.exec(key);
    const lv = lh ? DATA.buildings.find((b) => b.id === 'lighthouse').levels[lh[1] - 1] : null;
    assert.ok(contentFrom(DATA, key).some((x) => x.what !== 'prop') || (lv && (lv.bellRingAdd || lv.lampSpeedAdd)), `${row.was} opens something real`);
  }
  // The Heirloom opens at the Tavern's level 3, offers only relics the codex has, and takes a slot.
  const d = old({ tavern: 3 }, { codex: ['relic:tide_clock'] });
  assert.equal(heirloomOpen(old({ tavern: 2 }), DATA), false);
  assert.deepEqual(heirloomChoices(d, DATA), ['tide_clock']);
  const w = createWorld(runConfigFor(d, DATA, { character: 'lamplighter', seed: 3, heirloom: 'tide_clock' }), DATA);
  assert.deepEqual([w.build.relics.map((r) => r.id), w.build.relicSlots, w.config.heirloom], [['tide_clock'], 3, 'tide_clock']);
});

test('X2 ruling 11, a save: the gate\'s arcana is its relic as the Heirloom, and every arcana opened stays as the relic it became', () => {
  const before = old({ tavern: 1, lighthouse: 8, cartographer: 3 }, {
    research: ['moon_tables'], feats: ['lantern_night', 'docks_tide_10', 'collector', 'untouchable'], challenges: ['lamp_only'],
    setup: { character: 'lamplighter', arcana: 'spring_tide' },
  });
  const d = twice(before);
  assert.equal(d.profile.setup.heirloom, 'tide_clock', 'Spring Tide was the Tide Clock turned up');
  assert.equal(d.profile.setup.arcana, undefined);
  assert.equal(d.profile.retired, RETIRED_VERSION);
  const pool = resolveContent(d, DATA).relics;
  // Moon Pull (research), Kindling (the Lamp Only challenge, an order now), Glassblower (an order), Long Beam (the Lighthouse),
  // and the relics four of the nine were: the Glass Lantern (Salt Shell), the Volatile Gems (Powder Gems), the Barnacle Shell.
  for (const id of ['moon_pull', 'kindling', 'glassblower', 'long_beam', 'glass_lantern', 'tide_clock', 'volatile_gems', 'barnacle_shell']) assert.ok(pool.includes(id), `${id} is in the pool`);
  assert.ok(!resolveContent(before, DATA).relics.includes('glass_lantern'), '(the Tavern at Lv 1 alone would not open it)');
  assert.ok(!pool.includes('brine'), 'an arcana never opened is not handed out');
  // Each can be the Heirloom, with the Tavern still at level 1: an arcana could be picked at the gate before.
  assert.equal(heirloomOpen(d, DATA), true);
  for (const id of ['moon_pull', 'kindling', 'glassblower', 'long_beam', 'glass_lantern', 'tide_clock', 'volatile_gems', 'barnacle_shell']) assert.ok(heirloomChoices(d, DATA).includes(id), `${id} can be carried`);
  const row = setupRows(d, DATA, startChoice(d, DATA, 'lamplighter')).find((r) => r.key === 'heirloom');
  assert.equal(row.value, 'tide_clock');
  assert.ok(createWorld(runConfigFor(d, DATA, { character: 'lamplighter', seed: 1, heirloom: 'tide_clock' }), DATA));
  // A profile that never opened one gets nothing.
  const none = twice(old({ tavern: 1 }));
  assert.deepEqual([heirloomOpen(none, DATA), none.profile.heirloomHeld, none.profile.codex], [false, undefined, []]);
});

// ------------------------------------------------------------------------------ ruling 12

test('X2 ruling 12: about eight run tools and no tonic; each Apothecary level does something; what paid a tonic pays something real', () => {
  assert.equal(DATA.consumables.length, 8);
  for (const id of Object.keys(RETIRED_CONSUMABLES)) assert.ok(!DATA.consumables.some((c) => c.id === id), `${id} is gone`);
  assert.equal(Object.keys(RETIRED_CONSUMABLES).length, 37);
  for (const c of DATA.consumables) {
    assert.ok(!(c.mods || []).some((m) => !['reroll', 'banish', 'skip', 'revival'].includes(m.stat)), `${c.id}: no stat for a run`);
    assert.doesNotMatch(c.desc, /!|\byour\b/);
  }
  const ap = DATA.buildings.find((b) => b.id === 'apothecary');
  assert.deepEqual(ap.levels.map((l) => [l.consumableSlots ?? 0, l.foodHeal ?? 0]), [[1, 0], [0, 0.25], [2, 0], [0, 0.5], [3, 0]]);
  // Research that found tonics finds a tool; the Lighthouse's stages 1 and 9 too.
  assert.deepEqual(contentFrom(DATA, 'research:herb_notes').map((x) => x.id), ['black_pebble']);
  assert.deepEqual(contentFrom(DATA, 'building:lighthouse:9').map((x) => x.id), ['ember_tin']);
  assert.equal(DATA.buildings.find((b) => b.id === 'lighthouse').levels[0].lampSpeedAdd, 0.25);
  // No unlock key names a thing that went.
  const keys = [DATA.weapons, DATA.passives, DATA.relics, DATA.dashes, DATA.recipes, DATA.consumables, DATA.kits, DATA.skills, DATA.trophies].flat().map((x) => x.unlock).filter(Boolean);
  for (const k of keys) assert.doesNotMatch(String(k), /^(bestiary|challenge):/, k);
});

test('X2 ruling 12, a save: tonics held are paid back at their price, once, with a line for the harbor; tools held stay', () => {
  const before = old({ apothecary: 2, lighthouse: 9 }, {
    materials: { coin: 10, oil: 5 },
    consumables: { tallow_tonic: 2, lighthouse_lens: 1, wisp_jar: 1, smelling_salts: 3, gull_bone: 1, 'rune:splitting': 2 },
    setup: { consumables: ['tallow_tonic', 'smelling_salts'] },
  });
  const d = twice(before);
  assert.deepEqual(d.profile.consumables, { smelling_salts: 3, gull_bone: 1 }, 'tools kept; the rune stones paid back by ruling 14\'s step (tests/save.test.js)');
  // 2 Tallow Tonics (120 Coin, 45 Oil each), a Lighthouse Lens (410 Coin, 7 Salt Glass), a Wisp Jar (150 Coin, 60 Oil).
  // (And 2 rune stones at the cutting price: 4 Iron, 6 Salt Glass, 70 Drowned Pages, 230 Coin each.)
  assert.deepEqual(d.profile.materials, { coin: 10 + 240 + 410 + 150 + 460, oil: 5 + 90 + 60, salt_glass: 7 + 12, iron: 8, drowned_pages: 140 });
  assert.deepEqual(d.profile.retiredNote, { tonics: 4, refund: { coin: 800, oil: 150, salt_glass: 7 }, stones: 2, stoneRefund: { iron: 8, salt_glass: 12, drowned_pages: 140, coin: 460 } });
  assert.deepEqual(d.profile.setup.consumables, ['smelling_salts']);
  assert.equal(d.profile.orphans?.consumables, undefined, 'nothing of a tonic is set aside to come back');
  const note = retiredNoteText(DATA, d.profile.retiredNote);
  assert.deepEqual(note.lines, ['The Apothecary sells run tools now. It bought back your 4 tonics: 800 Coin, 150 Oil, 7 Salt Glass', 'Runes are gone: their effects are Rare and Epic traits on weapons now. The Smithy bought back your 2 rune stones: 460 Coin, 140 Drowned Pages, 8 Iron, 12 Salt Glass']);
  // The tools its Apothecary sold are still on the shelf (they open with an order or a project now).
  for (const id of ['smelling_salts', 'gull_bone', 'black_pebble', 'driftwood_token']) assert.notEqual(whyNotBuyConsumable(d, DATA, id), 'Not found yet', id);
  assert.equal(whyNotBuyConsumable(twice(old({ apothecary: 1 })), DATA, 'gull_bone'), 'Not found yet', 'a harbor that never had it earns it the new way');
  assert.equal(consumableSlots(d, DATA), 2, 'the Apothecary\'s one and the Lighthouse\'s');
  // A tonic set aside by an older build is paid back too.
  const aside = twice(old({}, { orphans: { consumables: { sea_salt: 1 } } }));
  assert.deepEqual([aside.profile.materials.coin, aside.profile.materials.rum, aside.profile.orphans?.consumables], [120, 9, undefined]);
  // A profile made on this build is never paid: a run marks it as it plays.
  const fresh = applyRunResult(defaultProfile(), { end: 'died', timeSurvived: 30, kills: { fog_wisp: 400 }, totalKills: 400, materials: {}, bossesKilled: [] }, DATA).doc;
  assert.equal(fresh.profile.retired, RETIRED_VERSION);
  assert.equal(load(fresh).profile.retiredNote, undefined);
});

// ------------------------------------------------------------------------------ ruling 13

test('X2 ruling 13: one board. Set runs and Hunts are orders that open one real thing each; no claim screen, no challenge list of its own', () => {
  const runs = DATA.feats.filter((f) => f.rules), hunts = DATA.feats.filter((f) => f.group === 'hunt');
  assert.equal(runs.length, 14); assert.equal(hunts.length, 15);
  assert.deepEqual(DATA.challenges.map((c) => c.id), runs.map((f) => f.id), 'the set runs\' rules are read from the orders');
  for (const f of [...runs, ...hunts]) {
    const opens = contentFrom(DATA, `feat:${f.id}`);
    assert.equal(opens.length, 1, f.id);
    assert.notEqual(opens[0].what, 'prop', `${f.id} opens a real thing`);
    assert.ok(DATA.npcs.some((n) => n.id === f.by));
  }
  assert.ok(!completion(defaultProfile(), DATA).parts.some((p) => p.name === 'challenges'));
  const cart = DATA.buildings.find((b) => b.id === 'cartographer');
  assert.deepEqual(cart.levels.map((l) => Object.keys(l).filter((k) => k !== 'cost')), [['tasksOnMap'], ['findsOnMap'], ['challenges'], ['shortRuns'], ['secretsOnMap']]);
  // Two books: no field guide and no bestiary in the glossary; the codex says it holds the counts.
  for (const id of ['field_guide', 'bestiary', 'arcana']) assert.equal(DATA.glossary.find((e) => e.id === id), undefined, id);
  assert.match(DATA.glossary.find((e) => e.id === 'codex').desc, /counts your kills/);
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  assert.doesNotMatch(src('ui/hubscreens.js'), /bestiaryScreen|claimBestiary|whyNotClaim/);
  assert.doesNotMatch(src('ui/menus.js'), /fieldGuideScreen/);
  // The codex for one map: what it has shown, its enemies with kills, its bosses, its secrets.
  const d = old({}, { bestiary: { leech: 12 }, seen: { salt_marsh: ['water', 'enemy:leech', 'bell'] } });
  const marsh = codexEntries(d, DATA, 'salt_marsh');
  assert.deepEqual([...new Set(marsh.map((e) => e.group))], MAP_CODEX_GROUPS.map(([g]) => g));
  assert.deepEqual(marsh.filter((e) => e.group === 'place').map((e) => e.name), ['High water', 'Fog Bell']);
  assert.deepEqual(marsh.find((e) => e.id === 'leech').kills, 12);
  assert.deepEqual(marsh.find((e) => e.id === 'leech').hunt, { name: 'Leech Hunt', count: HUNT_COUNTS.leech, done: false }   /* (X3: the count from the data) */);
  assert.ok(!marsh.some((e) => e.id === 'bilge_rat' || e.group === 'weapon'));
  assert.equal(marsh.find((e) => e.id === 'water').desc, DATA.glossary.find((e) => e.id === 'high_water').short, 'the same entry the glossary holds');
});

test('X2 ruling 13, a save: challenges won and trophies claimed are their orders, done; rungs reached and unclaimed are paid; curses stay', () => {
  const before = old({ cartographer: 3, tavern: 1, chapel: 2 }, {
    materials: { coin: 0 },
    challenges: ['lamp_only', 'flood', 'bare_hands'],
    bestiary: { fog_wisp: 40000, gull: 200000, bilge_rat: 3500, mud_crab: 3000, harbor_maw: 3 },
    bestiaryClaimed: { fog_wisp: 3, gull: 4, bilge_rat: 1 },
    setup: { mode: 'challenge', challenge: 'flood', curses: ['brittle', 'swarm', 'dull_edge'] },
  });
  const d = twice(before);
  const done = featsDone(d, DATA);
  for (const id of ['lamp_only', 'bare_hands', 'hunt_fog_wisp', 'hunt_gull', 'hunt_mud_crab']) assert.ok(done.has(id), id);
  assert.ok(!done.has('hunt_bilge_rat'), '3,500 Bilge Rats, short of its Hunt');
  assert.deepEqual(d.profile.orphans.feats, ['flood'], 'Swarm Tide went (it paid only materials, and they were paid); its win is kept aside');
  // (X5: once mapped, the emptied lists leave the profile; a new profile has neither.)
  assert.deepEqual([d.profile.challenges, d.profile.bestiaryClaimed], [undefined, undefined]);
  assert.deepEqual(d.profile.bestiary, before.profile.bestiary, 'the counts are untouched');
  // What they opened: the Kindling relic and Bosun's Coat, and a trophy for each Hunt done.
  const c = resolveContent(d, DATA);
  assert.ok(c.relics.includes('kindling') && c.recipes.includes('bosun_coat'));
  assert.deepEqual(bestiaryBonus(d, DATA), { fog_wisp: 0.05, gull: 0.05, mud_crab: 0.05 }, 'the fourth rung\'s 3% is a trophy\'s 5% now');
  // Rungs reached and not claimed: the Bilge Rat's second (60 Coin, 6 Pages), the Mud Crab's three
  // (20, 60 and 6 Pages, 150 and 2 Iron), the Harbor Maw's two (20, 60 and 6 Pages).
  assert.deepEqual(d.profile.retiredNote, { rungs: { coin: 60 + 230 + 80, drowned_pages: 18, iron: 2 } });
  assert.deepEqual(d.profile.materials, { coin: 370, drowned_pages: 18, iron: 2 });
  assert.match(retiredNoteText(DATA, d.profile.retiredNote).lines[0], /^Kill counts are in the codex now\. The rungs you had reached paid: 370 Coin, 18 Drowned Pages, 2 Iron$/);
  // The gate's last choice was a challenge: it is a full run now, and the set run is on the board.
  assert.deepEqual([d.profile.setup.mode, d.profile.setup.challenge], ['standard', '']);
  // D5: the Chapel at Lv 2 had opened three curses; they stay, though a new Chapel opens them at Lv 4.
  assert.equal(d.profile.cursesHeld, 3);
  assert.deepEqual(cursesAvailable(d, DATA).map((x) => x.id), ['brittle', 'swarm', 'hunger']);
  assert.deepEqual(cursesAvailable(twice(old({ chapel: 3 }, { retired: 1 })), DATA), [], 'a harbor built after the change earns them at Lv 4');
  assert.ok(runConfigFor(d, DATA, { character: 'lamplighter', seed: 1, curses: ['brittle', 'swarm'] }));
  // retireOld on its own: nothing to do the second time.
  const again = structuredClone(d);
  assert.deepEqual(retireOld(again, DATA), []);
  assert.deepEqual(again, d);
});

// ------------------------------------------------------------------------------ the gate, and D5

test('X2: the gate ends at six rows for a finished harbor, where it had fourteen', () => {
  const d = defaultProfile();
  for (const b of DATA.buildings) d.profile.buildings[b.id] = b.levels.length;
  d.profile.research.done = DATA.research.map((r) => r.id);
  d.profile.feats = DATA.feats.map((f) => f.id);
  d.profile.codex = DATA.relics.map((r) => `relic:${r.id}`);
  d.profile.tides = Object.fromEntries(DATA.maps.map((m) => [m.id, 10]));
  d.profile.characters = Object.fromEntries(DATA.characters.map((c) => [c.id, { unlocked: true, masteryXp: 9999, perks: [] }]));
  d.profile.consumables = Object.fromEntries(DATA.consumables.map((c) => [c.id, 2]));
  const rows = setupRows(d, DATA, startChoice(d, DATA, 'lamplighter'));
  assert.deepEqual(rows.map((r) => r.label), ['Map', 'Character', 'Starting weapon', 'Heirloom', 'Run tools', 'Difficulty']);
  d.profile.consumables['rune:splitting'] = 1;
  assert.deepEqual(setupRows(d, DATA, startChoice(d, DATA, 'lamplighter')).map((r) => r.key), ['map', 'character', 'kit', 'heirloom', 'tools', 'difficulty'], 'no Rune stone row (ruling 14)');
  assert.equal(rows.find((r) => r.key === 'tools').items.length, 8);
  assert.equal(rows.find((r) => r.key === 'difficulty').items.length, 2 + DATA.curses.length);
  assert.equal(consumableSlots(d, DATA), 4);
});

test('X2, D5: level gates stagger what a new harbor is handed (curses after Tides, the Heirloom and set runs later)', () => {
  const lv = (b, key) => DATA.buildings.find((x) => x.id === b).levels.findIndex((l) => l[key]) + 1;
  assert.deepEqual([lv('chapel', 'tideMax'), lv('chapel', 'curses')], [1, 4], 'Tides first; curses three levels on');
  assert.deepEqual([lv('tavern', 'feats'), lv('tavern', 'mastery'), lv('tavern', 'heirloom')], [1, 2, 3], 'the board, then mastery, then the Heirloom');
  assert.equal(lv('cartographer', 'challenges'), 3);
  // What each early building level hands over, as systems: no level carries two.
  const SYSTEMS = ['tree', 'researchSlots', 'feats', 'mastery', 'heirloom', 'ferry', 'gearSlots', 'tideMax', 'curses', 'market', 'consumableSlots', 'challenges', 'shortRuns'];
  for (const b of DATA.buildings) {
    const first = new Set();
    b.levels.forEach((l, i) => {
      const fresh = SYSTEMS.filter((k) => l[k] && !first.has(k));
      fresh.forEach((k) => first.add(k));
      assert.ok(fresh.length <= 1, `${b.id} Lv ${i + 1} opens ${fresh.join(' and ')}`);
    });
  }
  assert.equal(levelEffect(old({ chapel: 3 }), DATA, 'chapel', 'curses'), 0);
});

// ------------------------------------------------------------------------------ the builds batch's files (X1's, S1's, and X4's leftovers)

test('X2 leftovers: a spent Bog Torc swapped out and bought back stays spent; a Try-Pot comes back as it left', () => {
  const w = makeWorld({ invulnerable: true });
  const torc = DATA.relics.find((r) => r.id === 'bog_torc'), pot = DATA.relics.find((r) => r.id === 'try_pot');
  addRelic(w, torc);
  assert.equal(w.torc.ready, 1);
  removeRelic(w, torc); addRelic(w, torc);
  assert.equal(w.torc.ready, 1, 'unspent, it comes back ready');
  w.torc.ready = 0; w.torcSpent = true;   // as sim/player.js does when it saves you
  removeRelic(w, torc);
  assert.equal(w.torc, null);
  addRelic(w, torc);
  assert.equal(w.torc.ready, 0, 'once a run means once');
  assert.match(readFileSync(new URL('../src/sim/player.js', import.meta.url), 'utf8'), /torc\.ready = 0;\s+world\.torcSpent = true;/);
  addRelic(w, pot);
  w.tryPot.armed = 1;
  removeRelic(w, pot); addRelic(w, pot);
  assert.equal(w.tryPot.armed, 1);
});

test('X2 leftovers: a chest\'s reel is queued ahead of a Form choice its item earned', () => {
  let seen = 0;
  for (let seed = 1; seed <= 40 && seen < 3; seed++) {
    const w = makeWorld({ invulnerable: true, seed });
    give(w, 'flare_gun');
    w.slots[0].ups = Array.from({ length: DATA.tuning.forms.at[0] - 1 }, () => ({ up: 'damage', rarity: 'common', value: 0.2 }));   // the next upgrade opens its first axis
    w.halts.length = 0;
    openChest(w, 1, w.player.x, w.player.y);
    const kinds = w.halts.map((h) => h.kind);
    if (!kinds.includes('ascend')) continue;
    seen++;
    assert.ok(kinds.indexOf('chest') < kinds.indexOf('ascend'), kinds.join(', '));
  }
  assert.ok(seen > 0, 'a chest that earned a Form was opened');
});

test('X2 leftovers: a character who can\'t heal is never paid or offered food; the cards say an order by its name and never another character\'s weapon', () => {
  const w = makeWorld({ invulnerable: true, noHeal: true });
  w.player.hp = 1;
  assert.notEqual(skipPay(w)?.kind, GIFT.FOOD);
  levelGift(w, 2);
  assert.equal(w.player.hp, 1);
  const heals = makeWorld({ invulnerable: true });
  heals.player.hp = 1;
  assert.equal(skipPay(heals).kind, GIFT.FOOD);
  // With nothing left to level, her fallback is Coin alone.
  const dry = makeWorld({ invulnerable: true, noHeal: true, pools: { weapons: [], passives: [], relics: [] }, dashes: [], tuning: { dashes: { maxUps: 0 } } });
  dry.slots.fill(null);
  assert.deepEqual(makeOffer(dry).map((c) => c.kind), ['coin']);
  // Text: the order named; no "feat"; the evolution card gone; four capstones say their Damage.
  const caltrops = DATA.weapons.find((x) => x.id === 'glass_caltrops');
  assert.equal(whereFrom(DATA, caltrops.unlock), 'the Halfway Across order at the Tavern');
  assert.throws(() => cardInfo({ kind: 'evolution', id: 'flare_gun' }, DATA), /unknown card kind/);
  const forms = DATA.ascensions.flatMap((l) => l.options);
  assert.equal(forms.find((o) => o.id === 'wards').name, 'Little Lanterns');
  // A passive's card names only weapons this run could carry: never another character's own.
  for (const p of DATA.passives) {
    const note = cardInfo({ kind: 'passive', id: p.id, level: 1, isNew: true }, DATA, { tags: {}, weapons: [], passives: [] }).note ?? '';
    for (const sig of DATA.weapons.filter((x) => x.signature)) assert.ok(!note.includes(sig.name), `${p.name}: ${note}`);
  }
  // X4's text: the Brine Vat, the punt, and the Tide Priest's bell order.
  assert.match(DATA.relics.find((r) => r.id === 'brine_vat').desc, /not bosses or captains/);
  assert.match(DATA.glossary.find((e) => e.id === 'punt_cache').desc, /a crossing lasts 5s.*slowed for 3s/);
  assert.match(DATA.feats.find((f) => f.id === 'tide_priest_bells').desc, /6 times.*each bell twice/);
});
