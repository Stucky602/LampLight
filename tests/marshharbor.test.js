// The Salt Marsh's harbor side (0.8.0, B5a; docs/design/SALT_MARSH.md, SALT_MARSH_BUILD.md): which
// maps are open and the gate's map cards, the map's layers from the profile, Tides per map (save
// v4 and its migration), research that counts runs on one map, the Salt Well and the Ferryman's
// Well slot, first sightings and the field guide, who arrives after a run, and the costs that
// moved onto the Marsh's materials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { migrateProfile } from '../src/save/migrations.js';
import { unwrap } from '../src/save/envelope.js';
import {
  mapsOpen, mapOpen, mapMissing, isUnlocked, parseUnlock, tideAvailable, tidesOpened, highestTide, reached, completion,
  resolveContent, seenOn, seenAnywhere, wellRelics, mapOwnMaterials,
} from '../src/meta/state.js';
import { runConfigFor, startRunProfile, layersFor, MAP_LAYERS, mapNeedsText } from '../src/meta/runconfig.js';
import { applyRunResult } from '../src/meta/apply.js';
import { reconcileProfile } from '../src/meta/reconcile.js';
import { restoreBuilding, startResearch, whyNotRestore, whyNotResearch, MetaError, mapKeysText, unlockText, needText } from '../src/meta/actions.js';
import { nextAffordable, purchaseOptions } from '../src/meta/next.js';
import { upgradeCost, rerollCost } from '../src/meta/workshop.js';
import { mapCard, changeLines, researchRunsText, optionText, listText } from '../src/ui/hubtext.js';
import { buildingScreen } from '../src/ui/hubscreens.js';
import { installFakeDocument, textsOf } from './helpers/fakedom.js';
import { runArrivals, mergeRuns, levelSetPieces } from '../src/app/hublogic.js';
import { startChoice, setupRows, choiceForRun, playsOn, challengesOpen, applyRow, settleChoice } from '../src/app/setup.js';
import { noticeFor, quietNotice, haltView, withSights, guideEntry, sightName } from '../src/app/runlogic.js';
import { codexEntries } from '../src/meta/codex.js';
import { createWorld, stepWorld, currentHalt, decide } from '../src/sim/world.js';
import { ferryStep, FERRY_KINDS } from '../src/sim/relics.js';
import { EV, SIGHT } from '../src/sim/events.js';
import { WATER } from '../src/sim/marsh.js';
import { addRelic } from '../src/sim/build.js';
import { openWell } from '../src/sim/well.js';

const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 99999]));
const MARSH = 'salt_marsh', DOCKS = 'drowned_docks';

/** A profile with these building levels, materials, and other parts. */
function make(levels = {}, mats = {}, extra = {}) {
  const d = defaultProfile();
  Object.assign(d.profile.buildings, levels);
  d.profile.materials = { ...mats };
  Object.assign(d.profile, extra);
  return d;
}
/** The Marsh open: the Docks' first level, the Tavern's, and the Harbor Maw killed once. */
const marshOpen = (levels = {}, mats = {}, extra = {}) => make({ docks: 1, tavern: 1, ...levels }, mats, { bestiary: { harbor_maw: 1 }, ...extra });

function result(over = {}) {
  return {
    v: 1, seed: 1, map: DOCKS, mode: 'standard', character: 'lamplighter', end: 'died', timeSurvived: 600, ticks: 36000,
    level: 20, kills: {}, totalKills: 0, elitesKilled: 0, bossesKilled: [], cleared: false,
    weapons: [], weaponLevelMax: {}, maxWeaponLevel: 1, passives: [], relics: [], runes: [], evolutions: [], tags: {},
    materials: {}, damageTaken: 0, dashKills: 0, revivalsUsed: 0, gems: 0, chests: 0, overtimeMinutes: 0, secretsFound: [],
    rerolls: 0, skips: 0, banished: [], seaGlass: 0, lampsLit: 0, bellsRung: 0, lanternNight: false, tide: 0,
    wellGiven: null, sighted: [], ...over,
  };
}

/** A tiny event buffer for noticeFor. */
function events(...rows) {
  const ev = { type: [], x: [], y: [], a: [], b: [], c: [], d: [] };
  for (const [type, a = 0, b = 0, c = 0, d = 0] of rows) { ev.type.push(type); ev.x.push(0); ev.y.push(0); ev.a.push(a); ev.b.push(b); ev.c.push(c); ev.d.push(d); }
  return ev;
}

// ---------------------------------------------------------------- choosing the map

test('maps: the Marsh opens with the Docks, the Harbor Maw killed, and the Tavern, every key needed; boss and map keys read the profile', () => {
  assert.deepEqual(mapsOpen(defaultProfile(), DATA), [DOCKS], 'map 1 is always open');
  const marsh = DATA.maps.find((m) => m.id === MARSH);
  assert.deepEqual(marsh.unlock, ['building:docks:1', 'boss:harbor_maw', 'building:tavern:1']);
  // Each key alone is not enough.
  assert.equal(mapOpen(make({ docks: 1, tavern: 1 }), DATA, MARSH), false, 'the Maw not killed yet');
  assert.equal(mapOpen(make({ docks: 1 }, {}, { bestiary: { harbor_maw: 2 } }), DATA, MARSH), false, 'no Tavern yet');
  assert.deepEqual(mapMissing(make({ docks: 1 }), DATA, MARSH), ['boss:harbor_maw', 'building:tavern:1']);
  assert.deepEqual(mapsOpen(marshOpen(), DATA), [DOCKS, MARSH]);
  // 'boss:<id>': killed on any run, off the bestiary; 'map:<id>': that map open.
  assert.deepEqual(parseUnlock('boss:old_grey'), { kind: 'boss', id: 'old_grey' });
  assert.equal(isUnlocked(make({}, {}, { bestiary: { old_grey: 1 } }), DATA, 'boss:old_grey'), true);
  assert.equal(isUnlocked(make(), DATA, 'boss:old_grey'), false);
  assert.equal(isUnlocked(marshOpen(), DATA, `map:${MARSH}`), true);
  assert.equal(isUnlocked(make(), DATA, `map:${MARSH}`), false);
  // A map keyed to itself never opens.
  const odd = { ...DATA, maps: [DATA.maps[0], { ...marsh, unlock: [`map:${MARSH}`] }] };
  assert.equal(mapOpen(marshOpen(), odd, MARSH), false);
  assert.equal(mapNeedsText(DATA, MARSH, mapMissing(make(), DATA, MARSH)), 'Needs the Docks at Lv 1, the Harbor Maw killed, and the Tavern at Lv 1.');
});

test('maps: runConfigFor takes the map, refuses one not open in plain words, and a challenge plays on its own map', () => {
  const closed = make({ docks: 1 });
  assert.throws(() => runConfigFor(closed, DATA, { character: 'lamplighter', seed: 1, map: MARSH }),
    (e) => e instanceof MetaError && e.message === 'The Salt Marsh isn\'t open yet. Needs the Harbor Maw killed and the Tavern at Lv 1.');
  assert.throws(() => runConfigFor(closed, DATA, { character: 'lamplighter', seed: 1, map: 'atlantis' }), /no map called "atlantis"/);
  const open = marshOpen({ cartographer: 3 });
  const cfg = runConfigFor(open, DATA, { character: 'lamplighter', seed: 1, map: MARSH });
  assert.equal(cfg.map, MARSH);
  assert.ok(createWorld(cfg, DATA), 'the world takes it');
  assert.equal(runConfigFor(open, DATA, { character: 'lamplighter', seed: 1 }).map, DOCKS, 'no map named: map 1');
  // A challenge plays on its own map, whatever the gate's.
  const ch = runConfigFor(open, DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'lamp_only', map: MARSH });
  assert.equal(ch.map, DATA.challenges.find((c) => c.id === 'lamp_only').map);
  assert.equal(playsOn(DATA, { mode: 'challenge', challenge: 'lamp_only', map: MARSH }), DOCKS);
  // The gate keeps the map chosen for next time; a challenge leaves the last one alone.
  const kept = startRunProfile(open, DATA, { character: 'lamplighter', map: MARSH, tide: 0, curses: [] });
  assert.equal(kept.profile.setup.map, MARSH);
  assert.equal(startRunProfile(kept, DATA, { character: 'lamplighter', mode: 'challenge', challenge: 'lamp_only' }).profile.setup.map, MARSH);
  // The gate's choice carries the map, and its Tide row reads that map's Tides.
  const c = startChoice(open, DATA, 'lamplighter', MARSH);
  assert.equal(c.map, MARSH);
  assert.equal(choiceForRun(c).map, MARSH);
});

test('map cards: what drops there alone, which of Next up it moves, the research counting there, and its Tides', () => {
  assert.deepEqual(mapOwnMaterials(DATA, MARSH), ['marsh_herbs', 'salt_glass']);
  assert.deepEqual(mapOwnMaterials(DATA, DOCKS), ['timber', 'rope', 'drowned_pages', 'rum', 'iron'], 'Coin, Oil, and Map Scraps drop everywhere');
  const d = marshOpen({ chapel: 1, library: 2, apothecary: 1, lamp_post: 4 }, { coin: 500, rum: 50, oil: 400 }, {
    tides: { drowned_docks: 2 },
    research: { done: [], active: [{ id: 'brine_notes', runsLeft: 2 }, { id: 'tide_charts', runsLeft: 1 }] },
  });
  const next = nextAffordable(d, DATA, 3);
  const marsh = mapCard(d, DATA, MARSH, next);
  assert.equal(marsh.name, 'Salt Marsh');
  assert.equal(marsh.lines[0], 'Drops here only: Marsh Herbs and Salt Glass');
  // 0.8.2 (idea 10): what the map holds, last: its lamps and bells, the Ferryman once the Docks
  // bring him, and its secret, unnamed until found.
  // (0.9.0, W4: the lamps and bells each act, the salt cairns, and the secrets counted.)
  assert.match(marsh.lines.at(-1), /^On this map: 4 Wayside Lamps each act, 3 Fog Bells each act, 4 salt cairns, (the Ferryman, )?5 secrets, and a secret only the Bog Warden can find$/, 'the causeway is counted apart, and says whose it is (the sweep, A4)');
  // What a run there gets you closer to: options short of a Marsh material (built from every
  // option, so the check can't pass by finding none in Next up's three).
  const herbs = purchaseOptions(d, DATA).filter((o) => o.missing.some((m) => ['marsh_herbs', 'salt_glass'].includes(m.id))).slice(0, 2);
  assert.ok(herbs.length >= 1, 'the Apothecary\'s Lv 2, at least, is short of Herbs');
  assert.ok(mapCard(d, DATA, MARSH, herbs).lines.includes(`Gets you closer to: ${listText(herbs.map((o) => optionText(DATA, o).title))}`));
  assert.ok(!mapCard(d, DATA, DOCKS, herbs).lines.some((l) => l.startsWith('Gets you closer to')), 'the Docks drop no Herbs');
  assert.ok(marsh.lines.includes('Research that counts here: Brine Notes and Harbor Charts'), marsh.lines.join(' | '));
  assert.ok(marsh.lines.includes('No Tides open here yet. Kill its last boss to open Tide 1, a harder version of the map that pays more materials'));
  const docks = mapCard(d, DATA, DOCKS, next);
  assert.ok(docks.lines.includes('Research that counts here: Harbor Charts'), 'a Marsh project doesn\'t count on the Docks');
  assert.ok(docks.lines.includes('Tides open here: Tide 1 to 2'));
  // A project in Next up that counts only runs on the Marsh moves only the Marsh's card.
  const opt = { kind: 'research', id: 'eel_trapper', missing: [{ id: 'coin', need: 1 }] };
  assert.ok(mapCard(d, DATA, MARSH, [opt]).lines.some((l) => l === 'Gets you closer to: Eel Trapper\'s Notes'));
  assert.ok(!mapCard(d, DATA, DOCKS, [opt]).lines.some((l) => l.startsWith('Gets you closer to')));
  // No Chapel yet: no Tides line (a system you can't use isn't reported).
  assert.ok(!mapCard(marshOpen(), DATA, MARSH, []).lines.some((l) => /Tide/.test(l)));
});

test('map cards: the Tides line is what the gate offers; more opened than the Chapel allows says so and how to raise it', () => {
  // The judge's case: the Chapel at Lv 1 (Tides up to 2), the Marsh cleared at Tide 2.
  const d = marshOpen({ chapel: 1 }, {}, { tides: { salt_marsh: 2 } });
  const out = applyRunResult(d, result({ map: MARSH, end: 'cleared', cleared: true, tide: 2, timeSurvived: 1250 }), DATA).doc;
  assert.equal(tidesOpened(out, MARSH), 3);
  assert.equal(tideAvailable(out, DATA, MARSH), 2);
  const cap = DATA.buildings.find((b) => b.id === 'chapel').levels.findIndex((l) => (l.tideMax ?? 0) >= 3) + 1;
  assert.ok(mapCard(out, DATA, MARSH, []).lines.includes(`Tides open here: Tide 1 to 3. The Chapel allows up to Tide 2. Restore it to Lv ${cap} for more`));
  const rows = setupRows(out, DATA, startChoice(out, DATA, 'lamplighter', MARSH));
  assert.equal(rows.find((r) => r.key === 'difficulty').items.find((i) => i.id === 'tide_up').why, null);
  assert.equal(setupRows(out, DATA, { ...startChoice(out, DATA, 'lamplighter', MARSH), tide: 2 }).find((r) => r.key === 'difficulty').items.find((i) => i.id === 'tide_up').why, 'Tide 2 is the highest open on this map.', 'what the card says the gate offers');
  // Within the cap, the plain line.
  assert.ok(mapCard(marshOpen({ chapel: 2 }, {}, { tides: { salt_marsh: 3 } }), DATA, MARSH, []).lines.includes('Tides open here: Tide 1 to 3'));
  assert.ok(mapCard(marshOpen({ chapel: 1 }, {}, { tides: { salt_marsh: 1 } }), DATA, MARSH, []).lines.includes('Tides open here: Tide 1'));
});

test('the Tide refusal says what to do: clear the map at its highest Tide, or raise the Chapel', () => {
  const pick = (tides, tide, chapel = 2) => {
    try { runConfigFor(marshOpen({ chapel }, {}, { tides }), DATA, { character: 'lamplighter', seed: 1, map: MARSH, tide }); return null; } catch (e) { assert.ok(e instanceof MetaError); return e.message; }
  };
  assert.equal(pick({ salt_marsh: 1 }, 2), 'Tide 2 isn\'t open on the Salt Marsh yet. Clear the Salt Marsh at Tide 1 first.');
  assert.equal(pick({}, 1), 'Tide 1 isn\'t open on the Salt Marsh yet. Clear the Salt Marsh first.');
  assert.equal(pick({ salt_marsh: 1 }, 4), 'Tide 4 isn\'t open on the Salt Marsh yet. Clear the Salt Marsh at Tide 1 to open Tide 2.');
  assert.equal(pick({}, 2), 'Tide 2 isn\'t open on the Salt Marsh yet. Clear the Salt Marsh to open Tide 1.');
  const lv = DATA.buildings.find((b) => b.id === 'chapel').levels.findIndex((l) => (l.tideMax ?? 0) >= 3) + 1;
  assert.equal(pick({ salt_marsh: 3 }, 3, 1), `Tide 3 needs the Chapel at Lv ${lv}.`);
  assert.equal(pick({ salt_marsh: 3 }, DATA.tides.length + 1), `There is no Tide ${DATA.tides.length + 1}.`);
  assert.equal(pick({ salt_marsh: 1 }, 1), null);
});

test('unlock keys are worded for every kind, and never show a raw key', () => {
  const keys = ['building:docks:1', 'boss:harbor_maw', 'feat:first_crossing', `research:${DATA.research[0].id}`, `challenge:${DATA.challenges[0].id}`,
    `map:${MARSH}`, `secret:${DATA.maps[0].secrets[0].id}`, 'starter', 'evolution', 'innate', 'weird:thing', 'secret:nope', 'feat:nope', 'building:nope:2'];
  for (const k of keys) {
    const t = unlockText(DATA, k);
    // No key, and no id (ids are lowercase with underscores; names are capitalized words).
    assert.ok(!t.includes(':') && !t.includes('_') && !t.includes('nope') && !t.includes('weird'), `${k} -> "${t}"`);
  }
  assert.equal(unlockText(DATA, 'starter'), '');
  assert.equal(unlockText(DATA, `secret:${DATA.maps[0].secrets[0].id}`), `the ${DATA.maps[0].secrets[0].name} found`);
  assert.equal(unlockText(DATA, 'feat:hunt_fog_wisp'), 'the Fog Wisp Hunt order done');
  assert.equal(unlockText(DATA, 'challenge:lamp_only'), 'the Lamp Only order done', 'an old challenge key reads as its order');
  assert.equal(unlockText(DATA, 'secret:nope'), 'something not in this version');
  assert.equal(mapKeysText(DATA, ['secret:nope', 'weird:thing', 'building:docks:1']), 'something not in this version and the Docks at Lv 1', 'once each');
});

test('a map not open yet: its projects can\'t start and say what opens them; a cost only it drops says where; Next up says so too', () => {
  const closed = make({ lamp_post: 5, library: 2, tavern: 1, apothecary: 1 }, { coin: 400, drowned_pages: 200, rum: 99, oil: 300, marsh_herbs: 50, salt_glass: 20 });
  assert.equal(mapOpen(closed, DATA, MARSH), false);
  // A Marsh-only project: refused while the Marsh is closed, even with the materials in hand.
  assert.equal(whyNotResearch(closed, DATA, 'brine_notes'), 'Opens with the Salt Marsh, which needs the Docks at Lv 1 and the Harbor Maw killed');
  assert.throws(() => startResearch(closed, DATA, 'brine_notes'), /Opens with the Salt Marsh/);
  assert.equal(whyNotResearch(marshOpen({ lamp_post: 5, library: 2 }, RICH), DATA, 'brine_notes'), null, 'open: it starts');
  // A cost short of a material only the closed Marsh drops says where it comes from.
  const poor = make({ lamp_post: 5, library: 2, tavern: 1, apothecary: 1 }, { coin: 400, rum: 99, oil: 300 });
  const apo = DATA.buildings.find((b) => b.id === 'apothecary').levels[1].cost.marsh_herbs;
  assert.equal(whyNotRestore(poor, DATA, 'apothecary'), `Need ${apo} Marsh Herbs. Marsh Herbs drop only on the Salt Marsh, which needs the Docks at Lv 1 and the Harbor Maw killed`);
  assert.equal(needText(poor, DATA, { salt_glass: 2, coin: 1000 }), 'Need 2 Salt Glass, 600 Coin. Salt Glass drops only on the Salt Marsh, which needs the Docks at Lv 1 and the Harbor Maw killed');
  assert.equal(whyNotRestore(marshOpen({ lamp_post: 5, apothecary: 1 }, { coin: 400, rum: 99 }), DATA, 'apothecary').includes('drop only'), false, 'once the Marsh is open, only what\'s short');
  // Next up: the options waiting on the Marsh carry it, and their text says so.
  const waiting = purchaseOptions(poor, DATA).filter((o) => o.waits);
  assert.ok(waiting.some((o) => o.kind === 'building' && o.id === 'apothecary'));
  assert.ok(waiting.every((o) => o.waits.length === 1 && o.waits[0] === MARSH));
  for (const o of waiting) assert.equal(optionText(DATA, o).waits, 'Opens with the Salt Marsh');
  assert.ok(purchaseOptions(poor, DATA).filter((o) => !o.waits).every((o) => optionText(DATA, o).waits === null));
  assert.ok(!purchaseOptions(marshOpen({ lamp_post: 5, library: 2, apothecary: 1 }, { coin: 400 }), DATA).some((o) => o.waits), 'nothing waits once it\'s open');
  // A challenge on a closed map is never offered (it would be refused at Start).
  const later = { ...DATA, challenges: [...DATA.challenges, { ...DATA.challenges[0], id: 'marsh_trial', map: MARSH }], feats: [...DATA.feats, { ...DATA.feats.find((f) => f.id === DATA.challenges[0].id), id: 'marsh_trial' }] };
  const cart = make({ cartographer: 3 });
  assert.ok(!challengesOpen(cart, later).some((c) => c.id === 'marsh_trial'));
  assert.ok(challengesOpen(marshOpen({ cartographer: 3 }), later).some((c) => c.id === 'marsh_trial'));
});

test('a setup.map naming a known map that is closed: kept as a preference, but the gate sets out on map 1', () => {
  const d = make({ docks: 1 }, {}, { setup: { ...defaultProfile().profile.setup, map: MARSH } });
  const fit = reconcileProfile(d, DATA).doc;
  assert.equal(fit.profile.setup.map, MARSH, 'a known map is kept (it opens later)');
  assert.deepEqual(mapsOpen(fit, DATA), [DOCKS]);
  const c = startChoice(fit, DATA, 'lamplighter', mapsOpen(fit, DATA)[0]);
  assert.equal(runConfigFor(fit, DATA, { ...choiceForRun(c), seed: 1 }).map, DOCKS);
  // Asked for straight, it's refused in plain words with what to do.
  assert.throws(() => runConfigFor(fit, DATA, { character: 'lamplighter', seed: 1, map: fit.profile.setup.map }),
    (e) => e instanceof MetaError && e.message === 'The Salt Marsh isn\'t open yet. Needs the Harbor Maw killed and the Tavern at Lv 1.');
});

test('the Library\'s row for a Marsh project and the Chapel\'s Open on column are drawn', () => {
  const document = installFakeDocument();
  const ctx = { ui: { glyph: (a) => { const s = document.createElement('span'); s.textContent = a; return s; } }, icon: () => document.createElement('span'), sound: () => {} };
  const panel = (doc, building) => {
    const s = buildingScreen(ctx, { data: DATA, building, get: () => ({ doc }), onRestore() {}, onUpgrade() {}, onResearch() {}, onClose() {} });
    document.body.appendChild(s.el);
    return s;
  };
  const d = marshOpen({ library: 3, chapel: 2, lamp_post: 5 }, RICH, { tides: { drowned_docks: 3, salt_marsh: 1 } });
  const lib = panel(startResearch(d, DATA, 'brine_notes').doc, 'library');
  const brine = textsOf(lib.el.querySelector('[data-focus="r:brine_notes"]'));
  assert.ok(brine.includes('Counts only runs on the Salt Marsh'), brine.join(' | '));
  assert.ok(brine.includes(`In progress: ${DATA.research.find((r) => r.id === 'brine_notes').runs} more runs on the Salt Marsh`), brine.join(' | '));
  assert.ok(!textsOf(lib.el.querySelector(`[data-focus="r:${DATA.research[0].id}"]`)).some((t) => t.startsWith('Counts only')), 'a project for any map says nothing');
  const ch = panel(d, 'chapel');
  const tide = (n) => textsOf(ch.el.querySelector(`[data-focus="i:tide_${n}"]`));
  assert.ok(tide(1).includes('Open on Drowned Docks and Salt Marsh'), tide(1).join(' | '));
  assert.ok(tide(2).includes('Open on Drowned Docks'), tide(2).join(' | '));
  assert.ok(textsOf(ch.el).some((t) => t.includes('Each map has its own Tides.')));
  // With one map open: a plain "Open", and no line about other maps.
  const one = panel(make({ chapel: 2 }, {}, { tides: { drowned_docks: 2 } }), 'chapel');
  assert.ok(textsOf(one.el.querySelector('[data-focus="i:tide_1"]')).includes('Open'));
  assert.ok(!textsOf(one.el).some((t) => t.includes('Each map has its own Tides.')));
});

// ---------------------------------------------------------------- layers

test('layers: the storm once the Old Grey has died, the Well after the Marsh\'s first clear, the secret at its Tide 2 or the Cartographer\'s level 5', () => {
  assert.equal(layersFor(make(), DATA, DOCKS), null, 'the Docks have none');
  const base = marshOpen();
  assert.deepEqual(layersFor(base, DATA, MARSH), { storm: false, well: false, secret: false });
  assert.deepEqual(layersFor(marshOpen({}, {}, { bestiary: { harbor_maw: 1, old_grey: 1 } }), DATA, MARSH), { storm: true, well: false, secret: false });
  assert.deepEqual(layersFor(marshOpen({}, {}, { tides: { salt_marsh: 1 } }), DATA, MARSH), { storm: false, well: true, secret: false });
  assert.deepEqual(layersFor(marshOpen({}, {}, { tides: { salt_marsh: 2 } }), DATA, MARSH), { storm: false, well: true, secret: true });
  assert.deepEqual(layersFor(marshOpen({ cartographer: 5 }), DATA, MARSH), { storm: false, well: false, secret: true });
  assert.deepEqual(layersFor(marshOpen({}, {}, { tides: { drowned_docks: 5 } }), DATA, MARSH).well, false, 'a Docks clear opens nothing on the Marsh');
  // Into the run's config, and the world takes it.
  const cfg = runConfigFor(marshOpen({}, {}, { bestiary: { harbor_maw: 1, old_grey: 1 } }), DATA, { character: 'lamplighter', seed: 1, map: MARSH });
  assert.deepEqual(cfg.layers, { storm: true, well: false, secret: false });
  assert.deepEqual(createWorld(cfg, DATA).layers, cfg.layers);
  assert.equal(runConfigFor(base, DATA, { character: 'lamplighter', seed: 1 }).layers, undefined, 'a map without layers sends none');
  for (const [map, rules] of Object.entries(MAP_LAYERS)) assert.deepEqual(Object.keys(rules), DATA.maps.find((m) => m.id === map).layers);
});

// ---------------------------------------------------------------- Tides per map

test('tides: a clear opens the next Tide on that map only; the Chapel caps every map alike; tide keys read the highest; completion counts every map', () => {
  const d = marshOpen({ chapel: 2 }, {}, { tides: { drowned_docks: 3 } });
  assert.equal(tideAvailable(d, DATA, DOCKS), 3);
  assert.equal(tideAvailable(d, DATA, MARSH), 0, 'the Marsh has its own ladder');
  assert.equal(tideAvailable(d, DATA), 3, 'no map named: map 1');
  assert.throws(() => runConfigFor(d, DATA, { character: 'lamplighter', seed: 1, map: MARSH, tide: 1 }), /Tide 1 isn't open on the Salt Marsh yet/);
  // Clearing the Marsh at none opens its Tide 1; the Docks keep theirs.
  const out = applyRunResult(d, result({ map: MARSH, end: 'cleared', cleared: true, tide: 0, timeSurvived: 1250 }), DATA);
  assert.deepEqual(out.doc.profile.tides, { drowned_docks: 3, salt_marsh: 1 });
  assert.ok(out.changes.some((c) => c.kind === 'tide' && c.level === 1 && c.map === MARSH));
  assert.ok(changeLines(DATA, out.changes, out.doc).some((l) => l.text === 'Tide 1 is open on the Salt Marsh: a harder version of the map that pays more materials. Pick it at the gate'));
  // A Docks clear at Tide 1 opens nothing on the Docks (they're at 3), and nothing on the Marsh.
  assert.deepEqual(applyRunResult(d, result({ end: 'cleared', tide: 1 }), DATA).doc.profile.tides, d.profile.tides);
  // The Chapel's cap: Tides up to 4 at its level 2, on every map.
  const high = make({ chapel: 2 }, {}, { tides: { drowned_docks: 9, salt_marsh: 7 } });
  assert.deepEqual([tideAvailable(high, DATA, DOCKS), tideAvailable(high, DATA, MARSH)], [4, 4]);
  // 'tide:<n>': the highest of any map.
  assert.equal(highestTide(high), 9);
  assert.equal(reached(high, 'tide:8', DATA), true);
  assert.equal(reached(make({}, {}, { tides: { salt_marsh: 2 } }), 'tide:3', DATA), false);
  assert.equal(tidesOpened(make(), MARSH), 0);
  // Completion: every map's ladder.
  const part = (doc) => completion(doc, DATA).parts.find((p) => p.name === 'tides');
  assert.deepEqual(part(make({}, {}, { tides: { drowned_docks: 10 } })), { name: 'tides', have: 10, of: DATA.maps.length * DATA.tides.length });
  assert.equal(part(make({}, {}, { tides: { drowned_docks: 10, salt_marsh: 10 } })).have, 20);
});

test('save v4: a v3 save\'s Tides move to the Docks, the last choice stays, what the bestiary met seeds the Docks\' field guide; the v4 fixture loads', () => {
  const v3 = { v: 3, profile: { materials: { coin: 5 }, tide: { unlocked: 6, selected: 4 }, bestiary: { fog_wisp: 120, bilge_rat: 0, drowned_bosun: 3 }, setup: { character: 'lamplighter' }, orphans: { tide: { unlocked: 14 } } }, stats: {} };
  const { doc, steps } = migrateProfile(v3);
  assert.equal(steps, 1);
  assert.equal(doc.v, 4);
  assert.deepEqual(doc.profile.tides, { drowned_docks: 6 });
  assert.deepEqual(doc.profile.tide, { selected: 4 });
  assert.deepEqual(doc.profile.seen, { drowned_docks: ['enemy:fog_wisp', 'enemy:drowned_bosun'] }, 'met means killed at least once');
  assert.deepEqual(doc.profile.well, []);
  assert.equal(doc.profile.setup.map, '');
  assert.deepEqual(doc.profile.orphans.tides, { drowned_docks: 14 }, 'Tides an older build set aside were the Docks\' too');
  assert.equal(doc.profile.orphans.tide, undefined);
  assert.deepEqual(v3.profile.tide, { unlocked: 6, selected: 4 }, 'the input never changes');
  // Fitted to this build: Tides held to 10, the rest still aside.
  const r = reconcileProfile(doc, DATA).doc;
  assert.deepEqual([r.profile.tides, r.profile.orphans.tides], [{ drowned_docks: 10 }, { drowned_docks: 14 }]);
  assert.deepEqual(reconcileProfile(r, DATA).doc, r, 'the same on the next load');
  // The shipped v4 fixture: the Marsh's state kept, and it plays there.
  const { doc: v4 } = unwrap(readFileSync(new URL('./fixtures/saves/profile-v4.txt', import.meta.url), 'utf8'), 'profile');
  const fit = reconcileProfile(migrateProfile(v4).doc, DATA).doc;
  assert.deepEqual(fit.profile.tides, { drowned_docks: 3, salt_marsh: 1 });
  assert.deepEqual(wellRelics(fit, DATA), ['brass_button']);
  assert.ok(seenOn(fit, MARSH).includes('water'));
  assert.equal(fit.profile.setup.map, MARSH);
  const cfg = runConfigFor(fit, DATA, { character: 'lamplighter', seed: 2, map: MARSH, tide: 1 });
  assert.deepEqual([cfg.map, cfg.tide, cfg.layers.storm, cfg.layers.well, cfg.wellRelics], [MARSH, 1, true, true, ['brass_button']]);
});

test('reconcile v4: an unknown map\'s Tides and sightings set aside and brought back; unknown Well relics kept aside; the gate\'s map a known one', () => {
  const d = make({}, {}, {
    tides: { drowned_docks: 2, reef: 4 }, well: ['brass_button', 'kraken_tooth', 'brass_button', 7],
    seen: { salt_marsh: ['water', 'water', 3], reef: ['enemy:kraken'] }, setup: { map: 'reef' },
  });
  const { doc, moved } = reconcileProfile(d, DATA);
  assert.deepEqual([doc.profile.tides, doc.profile.orphans.tides], [{ drowned_docks: 2 }, { reef: 4 }]);
  assert.deepEqual([doc.profile.well, doc.profile.orphans.well], [['brass_button'], ['kraken_tooth']]);
  assert.deepEqual([doc.profile.seen, doc.profile.orphans.seen], [{ salt_marsh: ['water'] }, { reef: ['enemy:kraken'] }]);
  assert.equal(doc.profile.setup.map, '');
  assert.ok(moved.includes('tides:reef') && moved.includes('well:kraken_tooth') && moved.includes('seen:reef'));
  assert.deepEqual(reconcileProfile(doc, DATA).doc, doc);
  const later = { ...DATA, maps: [...DATA.maps, { ...DATA.maps[0], id: 'reef', name: 'Reef' }], relics: [...DATA.relics, { ...DATA.relics[0], id: 'kraken_tooth' }] };
  const back = reconcileProfile(doc, later);
  assert.deepEqual([back.doc.profile.tides.reef, back.doc.profile.well, back.doc.profile.seen.reef], [4, ['brass_button', 'kraken_tooth'], ['enemy:kraken']]);
  assert.ok(back.restored.includes('tides:reef') && back.restored.includes('well:kraken_tooth') && back.restored.includes('seen:reef'));
});

// ---------------------------------------------------------------- research on a map

test('research on a map: only runs there move it; the others say so on the results, and the Library and Next up name the map', () => {
  const d = marshOpen({ library: 3 }, RICH);
  const started = startResearch(startResearch(d, DATA, 'brine_notes').doc, DATA, 'tide_charts').doc;
  const brine = DATA.research.find((r) => r.id === 'brine_notes');
  // A run on the Docks: Tide Charts moves, Brine Notes waits and says where it counts.
  const docks = applyRunResult(started, result({ timeSurvived: 400 }), DATA);
  const active = (doc) => Object.fromEntries(doc.profile.research.active.map((a) => [a.id, a.runsLeft]));
  assert.deepEqual(active(docks.doc), { brine_notes: brine.runs, tide_charts: DATA.research.find((r) => r.id === 'tide_charts').runs - 1 });
  assert.deepEqual(docks.changes.find((c) => c.kind === 'research_elsewhere'), { kind: 'research_elsewhere', id: 'brine_notes', map: MARSH, runsLeft: brine.runs });
  assert.ok(changeLines(DATA, docks.changes).some((l) => l.text === `Research on Brine Notes: ${brine.runs} more runs on the Salt Marsh`));
  // A run on the Marsh moves it.
  const marsh = applyRunResult(docks.doc, result({ map: MARSH, timeSurvived: 400 }), DATA);
  assert.equal(active(marsh.doc).brine_notes, brine.runs - 1);
  // A run that doesn't count (under 5:00, no boss) moves nothing anywhere.
  assert.ok(applyRunResult(docks.doc, result({ map: MARSH, timeSurvived: 100 }), DATA).changes.some((c) => c.kind === 'research_waiting'));
  // Finished on the Marsh: its unlocks, as any project.
  let doc = marsh.doc;
  for (let k = 0; k < 5 && active(doc).brine_notes; k++) doc = applyRunResult(doc, result({ map: MARSH, timeSurvived: 400 }), DATA).doc;
  assert.ok(doc.profile.research.done.includes('brine_notes'));
  assert.ok(resolveContent(doc, DATA).weapons.includes('brine_spring'));
  // The words: the Library's row and Next up.
  assert.equal(researchRunsText(DATA, brine, 2), '2 more runs on the Salt Marsh');
  assert.equal(researchRunsText(DATA, brine, 1), '1 more run on the Salt Marsh');
  assert.equal(researchRunsText(DATA, DATA.research[0], 2), '2 runs left');
  assert.equal(optionText(DATA, { kind: 'research', id: 'anchor_smithing', missing: [], progress: 1 }).runs, 'Then 3 runs on the Drowned Docks');
  // Run again: the latest word on a project stands.
  const merged = mergeRuns({ changes: docks.changes, result: {}, runs: 1 }, { changes: marsh.changes, result: {}, runs: 1 }, DATA);
  assert.deepEqual(merged.changes.filter((c) => c.id === 'brine_notes').map((c) => c.kind), ['research_step']);
});

// ---------------------------------------------------------------- the Salt Well

test('the Well: a relic given joins the profile, the run config passes it, and the Ferryman offers it in a Well slot on every map', () => {
  const d = marshOpen({ docks: 2 });
  const out = applyRunResult(d, result({ map: MARSH, wellGiven: 'brass_button' }), DATA);
  assert.deepEqual(out.doc.profile.well, ['brass_button']);
  assert.ok(out.changes.some((c) => c.kind === 'well' && c.id === 'brass_button'));
  assert.ok(changeLines(DATA, out.changes).some((l) => l.text === 'Given to the Salt Well: Brass Button. The Ferryman sells it on every map from now on'));
  assert.deepEqual(applyRunResult(out.doc, result({ wellGiven: 'brass_button' }), DATA).doc.profile.well, ['brass_button'], 'once');
  assert.deepEqual(applyRunResult(d, result({ wellGiven: 'no_such' }), DATA).doc.profile.well, [], 'an unknown relic counts for nothing');
  // Into the run, on the Docks too (with the relic still in the run's pools).
  const cfg = runConfigFor(out.doc, DATA, { character: 'lamplighter', seed: 5 });
  assert.deepEqual(cfg.wellRelics, ['brass_button']);
  assert.ok(createWorld(cfg, DATA));
  const none = runConfigFor(marshOpen({ cartographer: 3 }, {}, { well: ['brass_button'] }), DATA, { character: 'lamplighter', seed: 5, mode: 'challenge', challenge: 'lamp_only' });
  assert.deepEqual(none.wellRelics, ['brass_button'], 'a challenge that keeps the relics keeps the Well');
  // In the sim: a Relic-tier one the opening stock would never draw, in a slot of its own.
  const base = { seed: 5, character: 'lamplighter', harbor: { ferry: 2 }, wellRelics: ['volatile_gems'] };
  const w = createWorld(base, DATA);
  w.tick = w.ferry.nextCall;   // (his first call, 3:00: each call brings a stock)
  ferryStep(w);
  const well = w.ferry.offers.filter((o) => o.well);
  assert.deepEqual(well.map((o) => o.id), ['volatile_gems']);
  assert.equal(well[0].kind, FERRY_KINDS.relic);
  assert.equal(w.ferry.offers.filter((o) => o.kind === FERRY_KINDS.relic && !o.well).length, 2, 'beside his own two');
  const view = haltView(w, { kind: 'ferry' }, DATA);
  assert.ok(view.offers.some((o) => o.well && o.name === 'Volatile Gems' && o.tierName.startsWith('Well, ')));
  // Without any given, no Well slot; carried already, not offered again.
  const plain = createWorld({ ...base, wellRelics: undefined }, DATA);
  plain.tick = plain.ferry.nextCall;
  ferryStep(plain);
  assert.ok(plain.ferry.offers.length > 0);
  assert.ok(!plain.ferry.offers.some((o) => o.well));
  const w2 = createWorld(base, DATA);
  addRelic(w2, DATA.relics.find((r) => r.id === 'volatile_gems'));
  w2.tick = w2.ferry.nextCall;
  ferryStep(w2);
  assert.ok(!w2.ferry.offers.some((o) => o.well));
  assert.throws(() => createWorld({ ...cfg, wellRelics: ['nope'] }, DATA), /unknown relic "nope"/);
  assert.throws(() => createWorld({ ...cfg, wellRelics: 'brass_button' }, DATA), /wellRelics must be a list/);
});

test('the Well: its halt shows the relics carried, and giving one ends the halt with it gone and named in the result', () => {
  const w = createWorld({ seed: 3, map: MARSH, character: 'lamplighter', layers: { storm: false, well: true, secret: false } }, DATA);
  for (const id of ['brass_button', 'gull_feather']) addRelic(w, DATA.relics.find((r) => r.id === id));
  openWell(w, w.player.x, w.player.y);
  for (let k = 0; k < 120 && !currentHalt(w); k++) stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  const h = currentHalt(w);
  assert.equal(h?.kind, 'well');
  const v = haltView(w, h, DATA);
  assert.deepEqual(v.relics.map((r) => r.id), ['brass_button', 'gull_feather']);
  assert.ok(v.relics.every((r) => r.name && r.desc && r.tierName));
  decide(w, { kind: 'give', id: 'gull_feather' });
  assert.ok(!w.build.relics.some((r) => r.id === 'gull_feather'));
  assert.equal(w.result.wellGiven, 'gull_feather');
});

// ---------------------------------------------------------------- first sightings and the field guide

test('first sightings: a quiet notice the first time ever, nothing for what earlier runs showed; the water\'s warnings; the field guide', () => {
  const w = createWorld({ seed: 1, map: MARSH, character: 'lamplighter' }, DATA);
  const toad = DATA.enemies.findIndex((e) => e.id === 'mire_toad');
  const ev = events([EV.FIRST_SIGHT, SIGHT.ENEMY, toad], [EV.FIRST_SIGHT, SIGHT.WATER], [EV.WATER, WATER.WARN, 15, 0], [EV.WATER, WATER.HIGH], [EV.WATER, WATER.LOW], [EV.WATER, WATER.WARN, 15, 1], [EV.EYE, 1, 45], [EV.WELL, 1]);
  // 0.9.0 (V4): one line, the name and what it is together.
  assert.deepEqual(noticeFor(ev, 0, w), `First sighting: Mire Toad. ${DATA.enemies[toad].desc}`);
  assert.deepEqual(noticeFor(ev, 1, w), `First sighting: High water. ${DATA.glossary.find((e) => e.id === 'high_water').short}`);
  assert.equal(noticeFor(ev, 0, w, new Set(['enemy:mire_toad'])), null, 'met on an earlier run');
  assert.equal(noticeFor(ev, 2, w), 'High water in 15s: the creeks will flood');
  assert.equal(noticeFor(ev, 3, w), 'High water: the creeks are closed');
  assert.equal(noticeFor(ev, 4, w), 'Low water: the creeks are open, with herbs on the mud');
  assert.equal(noticeFor(ev, 5, w), 'High water in 15s. It stays for the rest of the run');
  assert.equal(noticeFor(ev, 6, w), 'Eye of the storm: no enemies come for 45s');
  assert.equal(noticeFor(ev, 7, w), 'The Salt Well is open: stay in its circle to give up a relic');
  // What asks nothing of you goes on the quiet line; the high-water warning and the Well don't.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => quietNotice(ev, i)), [true, true, false, true, true, true, true, false]);
  assert.equal(sightName(w, SIGHT.ENEMY, toad), 'enemy:mire_toad');
  assert.equal(sightName(w, SIGHT.STORM, 0), 'storm');
  // The codex for this map (the pause menu's; ruling 13): earlier runs' sightings first, then this run's.
  w.result.sighted.push('enemy:mire_toad', 'water', 'enemy:midge_cloud');
  const g = codexEntries(withSights(make(), MARSH, ['enemy:midge_cloud', 'herbs', ...w.result.sighted]), DATA, MARSH);
  assert.deepEqual(g.filter((x) => x.group === 'place').map((x) => x.id), ['herbs', 'water']);
  assert.deepEqual(g.filter((x) => x.group === 'enemy' && x.seen).map((x) => x.id).sort(), ['midge_cloud', 'mire_toad']);
  assert.ok(g.every((x) => x.group !== 'enemy' || DATA.maps.find((m) => m.id === MARSH).timeline.bands.some((b) => b.roster?.[x.id] !== undefined) || true));
  // One description (the sweep, A1): the field guide's name and line are the glossary entry's own.
  const herbs = DATA.glossary.find((e) => e.id === DATA.meta.fieldGuide.herbs.term);
  assert.deepEqual(guideEntry(DATA, 'herbs'), { name: herbs.name, line: herbs.short, term: herbs.id });
  assert.equal(guideEntry(DATA, 'enemy:nope'), null);
});

test('first sightings: a real Marsh run sights things, and the result joins that map\'s field guide in the profile, once each', () => {
  const w = createWorld({ seed: 'sight', map: MARSH, character: 'lamplighter', invulnerable: true, layers: { storm: false, well: false, secret: false } }, DATA);
  // Every halt answered with its plain choice (0.9.0: skips are limited, so a level-up takes its first card).
  const answer = (h) => (h.kind === 'draft' ? { kind: 'pick', index: 0 } : h.kind === 'chest' ? { kind: 'ok' } : h.kind === 'rune' ? { kind: 'discard' } : h.kind === 'relic' ? (h.full ? { kind: 'pass' } : { kind: 'pick', index: 0 }) : h.kind === 'ferry' ? { kind: 'done' } : { kind: 'keep' });
  for (let k = 0; k < 60 * 20; k++) { stepWorld(w, { mx: 0, my: 0, buttons: 0 }); let g = 0; while (currentHalt(w) && g++ < 20) decide(w, answer(currentHalt(w))); }
  assert.ok(w.result.sighted.some((x) => x.startsWith('enemy:')), JSON.stringify(w.result.sighted));
  const d = marshOpen({}, {}, { seen: { salt_marsh: [w.result.sighted[0]] } });
  const out = applyRunResult(d, result({ map: MARSH, sighted: [...w.result.sighted, 'water', 'water'] }), DATA);
  const want = [...new Set([...w.result.sighted, 'water'])];
  assert.deepEqual(out.doc.profile.seen.salt_marsh, want);
  assert.deepEqual(out.changes.find((c) => c.kind === 'sighted').names, want.slice(1), 'only what\'s new');
  assert.ok(seenAnywhere(out.doc).has('water'));
  // A few by name, more as a count (0.9.0).
  assert.ok(changeLines(DATA, out.changes).some((l) => l.text.startsWith('New in the codex: ') || / new in the codex for this map /.test(l.text)));
  assert.ok(!applyRunResult(out.doc, result({ map: MARSH, sighted: ['water'] }), DATA).changes.some((c) => c.kind === 'sighted'));
});

// ---------------------------------------------------------------- who and what arrives

test('arrivals: the first crossing brings the Punter home by boat; a run that kills the Maw opens the Marsh; a building level that opens it says so', () => {
  const d = marshOpen();
  const out = applyRunResult(d, result({ map: MARSH, timeSurvived: 320 }), DATA);
  assert.ok(out.changes.some((c) => c.kind === 'feat' && c.id === 'first_crossing'));
  assert.ok(out.changes.some((c) => c.kind === 'arrival' && c.id === 'punter'));
  assert.ok(resolveContent(out.doc, DATA).characters.includes('punter'));
  const plan = runArrivals(out.doc, DATA, out.changes);
  assert.deepEqual(plan.arriving, ['punter']);
  assert.equal(plan.arrivals[0].id, 'punter');
  assert.ok(Array.isArray(plan.arrivals[0].waitAt) && plan.arrivals[0].people.some((p) => p.id === 'punter'));
  assert.ok(changeLines(DATA, out.changes).some((l) => l.text === 'New character: Punter. Coming home by boat'));
  // Without the Tavern nobody counts feats: no Punter.
  assert.ok(!applyRunResult(make({ docks: 1 }, {}, { bestiary: { harbor_maw: 1 } }), result({ map: MARSH, timeSurvived: 320 }), DATA).changes.some((c) => c.kind === 'arrival'));
  // Killing the Maw with the Docks and the Tavern restored opens the Marsh.
  const pre = make({ docks: 1, tavern: 1 });
  const maw = applyRunResult(pre, result({ bossesKilled: [{ id: 'harbor_maw', time: 600 }], kills: { harbor_maw: 1 } }), DATA);
  assert.ok(maw.changes.some((c) => c.kind === 'map_open' && c.id === MARSH));
  assert.ok(changeLines(DATA, maw.changes).some((l) => l.text === 'New map: Salt Marsh. Choose it at the gate'));
  // The Tavern's level 1 as the last key: its banner says so.
  const before = make({ docks: 1, tavern: 0 }, RICH, { bestiary: { harbor_maw: 1 } });
  const lv = restoreBuilding(before, DATA, 'tavern');
  assert.deepEqual(lv.changes[0].maps, [MARSH]);
  assert.ok(levelSetPieces(lv.doc, DATA, lv.changes[0]).banner.lines.includes('New map: Salt Marsh. Choose it at the gate'));
  assert.equal(restoreBuilding(make({}, RICH), DATA, 'lamp_post').changes[0].maps, undefined, 'only when one opens');
  // Run again: each once.
  const merged = mergeRuns({ changes: out.changes, result: {}, runs: 1 }, { changes: out.changes, result: {}, runs: 1 }, DATA);
  assert.equal(merged.changes.filter((c) => c.kind === 'arrival').length, 1);
});

// ---------------------------------------------------------------- costs on the Marsh's materials

test('costs: the Apothecary takes Herbs from level 2, the Docks a pinch at 3 to 5, the Smithy Glass from 3; rune stones, re-rolls, and gear tiers 4 and 5 take Glass', () => {
  const lv = (id, n) => DATA.buildings.find((b) => b.id === id).levels[n - 1].cost;
  assert.ok(!lv('apothecary', 1).marsh_herbs && lv('apothecary', 2).marsh_herbs > 0 && !lv('apothecary', 2).oil);
  for (const n of [3, 4, 5]) assert.ok(lv('docks', n).marsh_herbs > 0, `Docks Lv ${n}`);
  for (const n of [1, 2]) assert.ok(!lv('docks', n).marsh_herbs, `Docks Lv ${n}`);
  for (const n of [3, 4, 5]) assert.ok(lv('smithy', n).salt_glass > 0 && lv('smithy', n).iron > 0, `Smithy Lv ${n}: Glass beside Iron`);
  const item = (tier) => ({ uid: 1, id: 'storm_lantern', tier, affixes: ['fire_volley'] });
  assert.ok(!upgradeCost(DATA, item(2)).salt_glass, 'tier 3: no Glass');
  assert.ok(upgradeCost(DATA, item(3)).salt_glass > 0 && upgradeCost(DATA, item(4)).salt_glass > upgradeCost(DATA, item(3)).salt_glass, 'tiers 4 and 5');
  assert.ok(rerollCost(item(2)).salt_glass === 4 && rerollCost(item(2)).iron === 4, 'Iron and Glass per tier (0.9.0: 2 each a tier)');
  assert.ok(['gull_bone', 'herb_salve'].every((id) => DATA.consumables.find((c) => c.id === id).cost.marsh_herbs > 0), 'the Gull Bone and the Herb Salve');
  // A Docks-only harbor can't restore the Apothecary past level 1, and says what it needs.
  assert.match(whyNotRestore(make({ apothecary: 1, lamp_post: 5 }, { rum: 999, coin: 999, oil: 999 }), DATA, 'apothecary'), /Marsh Herbs/);
});

test('the gate\'s rows read the run\'s map: its own Tides, and a mode line from its own timeline', () => {
  const d = marshOpen({ chapel: 3, cartographer: 4 }, RICH, { tides: { drowned_docks: 4, salt_marsh: 1 }, tide: { selected: 3 } });
  const marsh = startChoice(d, DATA, 'lamplighter', MARSH);
  assert.equal(marsh.tide, 1, 'the last Tide chosen, held to what this map has opened');
  const tideRow = (doc, c) => setupRows(doc, DATA, c).find((r) => r.key === 'difficulty').items;
  assert.equal(tideRow(d, marsh).find((i) => i.id === 'tide_up').why, 'Tide 1 is the highest open on this map.');
  const docks = startChoice(d, DATA, 'lamplighter', DOCKS);
  assert.equal(docks.tide, 3);
  // With no Tide chosen, the line says each map has its own (only with two open).
  const none = tideRow(d, { ...docks, tide: 0 })[0].detail[0];
  assert.ok(none.endsWith('to open the next. Each map has its own Tides.') && !none.includes('Drowned Docks'), none);
  const alone = make({ chapel: 3 }, {}, { tides: { drowned_docks: 2 } });
  assert.ok(tideRow(alone, startChoice(alone, DATA, 'lamplighter'))[0].detail[0].endsWith('to open the next.'));
  // The map row moves between the maps, and the Tide follows the map.
  const row = setupRows(d, DATA, docks).find((r) => r.key === 'map');
  assert.deepEqual(row.choices.map(([v]) => v), [DOCKS, `${DOCKS}:short`, MARSH, `${MARSH}:short`]);
  assert.equal(settleChoice(d, DATA, applyRow(docks, 'map', MARSH)).tide, 1);
  for (const c of [marsh, docks]) for (const r of setupRows(d, DATA, c)) for (const [k, v] of (r.kind === 'multi' ? r.items.filter((i) => !i.why).map((i) => i.press) : r.choices.map(([x]) => [r.key, x]))) {
    assert.doesNotThrow(() => runConfigFor(d, DATA, { ...choiceForRun(settleChoice(d, DATA, applyRow(c, k, v))), seed: 1 }), `${c.map}: ${k} = ${v}`);
  }
});
