// The draft (§5.10), chests (§5.11), Form cards, the Dash slot (ruling 16), the slots, relic swaps (0.9.0), and hooks (§5.12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, give, givePassive, run, runCollect, DATA, IDLE, neutralPace, pastGates } from './helpers/simworld.js';
import { makeOffer, draftCandidates, draftFull, autoPick, skipPay } from '../src/sim/draft.js';
import { tagWeight, upgradeScore } from '../src/sim/weaponups.js';
import * as CH from '../src/sim/chests.js';
const { openChest, openCache, evolvableSlot, evolveOne, showsReady, canEvolve, bellOptions, CHEST_BOSS, CHEST_ELITE, CHEST_BELL } = CH;
import { buildSlot } from '../src/sim/weapons.js';
import { hurtPlayer, xpToNext } from '../src/sim/player.js';
import { registerBoss, BOSS_STATE } from '../src/sim/bosses.js';
import { decide, currentHalt, createWorld, stepWorld } from '../src/sim/world.js';
import { addRelic } from '../src/sim/build.js';
import { damageEnemy, applyStatus, midAttack, CHARGER, RANGED } from '../src/sim/enemies.js';
import { spawnGem } from '../src/sim/pickups.js';
import { heal } from '../src/sim/player.js';
import { HOOKS } from '../src/sim/hooks.js';
import { EV, GIFT } from '../src/sim/events.js';
import { TPS } from '../src/sim/constants.js';

function levelUp(w) {
  w.draftAt = 0;   // (tests step levels back to back: the 20 s gap between drafts has its own test)
  w.player.xp = w.player.xpNext;
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  return currentHalt(w);
}

/** Banish every upgrade type on the weapon in slot s (ruling 10: the only way a weapon carried has nothing to roll). */
function exhaust(w, s = 0) {
  const def = w.slots[s].def;
  for (const t of def.numbers) w.build.banished.add(`up:${def.id}:${t}`);
  for (const l of def.lines || []) w.build.banished.add(`up:${def.id}:line:${l.id}`);
  for (const x of def.specials || []) w.build.banished.add(`up:${def.id}:special:${x.id}`);
  return w.slots[s];
}

/** Give the weapon in slot s an option on every axis (nothing left for its level-ups to open). */
function allForms(w, s = 0) {
  const sl = w.slots[s];
  const opts = w.ascensionLines.get(sl.def.id).options;
  w.slots[s] = buildSlot(w, s, sl.def, sl.level, null, { ...sl, axes: 7, ascensions: ['delivery', 'flight', 'payoff'].map((a) => opts.find((o) => o.axis === a)) });
  return w.slots[s];
}

// ---------------------------------------------------------------- the draft

test('draft: 3 different cards (4 with the hub upgrade), drawn from what can actually be taken', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun');
  const h = levelUp(w);
  assert.equal(h.kind, 'draft');
  assert.equal(h.offer.length, 3);
  assert.equal(new Set(h.offer.map((c) => `${c.kind}:${c.id}`)).size, 3, 'no duplicates');
  const legal = new Set(draftCandidates(w).map((c) => `${c.kind}:${c.id}`));
  for (const c of h.offer) if (c.kind !== 'relic') assert.ok(legal.has(`${c.kind}:${c.id}`), `${c.kind}:${c.id} is a real option`);
  const w4 = makeWorld({ invulnerable: true, draftCards: 4 });
  give(w4, 'flare_gun');
  assert.equal(levelUp(w4).offer.length, 4);
});

test('draft: early on, one card is always a new weapon when possible', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const w = makeWorld({ seed, invulnerable: true });
    give(w, 'flare_gun');
    const offer = makeOffer(w);
    assert.ok(offer.some((c) => c.kind === 'weapon' && c.isNew), `seed ${seed}: ${offer.map((c) => c.id)}`);
  }
});

test('draft: picking applies the card; reroll, banish, and skip spend charges and are refused without them', () => {
  const w = makeWorld({ invulnerable: true, charges: { reroll: 0, banish: 0, skip: 0 } });
  give(w, 'flare_gun');
  const start = { ...w.charges };
  let h = levelUp(w);
  decide(w, { kind: 'reroll' });
  assert.equal(w.charges.reroll, start.reroll - 1);
  h = currentHalt(w);
  assert.equal(h.kind, 'draft', 'still choosing after a reroll');
  const banished = h.offer[0];
  decide(w, { kind: 'banish', index: 0 });
  assert.equal(w.charges.banish, start.banish - 1);
  assert.ok(!currentHalt(w).offer.some((c) => c.id === banished.id && c.kind === banished.kind), 'the banished card is gone');
  assert.ok(w.build.banished.has(`${banished.kind}:${banished.id}`));
  for (let k = 0; k < 60; k++) {
    const offer = makeOffer(w);
    assert.ok(!offer.some((c) => c.id === banished.id && c.kind === banished.kind), 'and never offered again this run');
  }
  const pick = currentHalt(w).offer[1];
  decide(w, { kind: 'pick', index: 1 });
  assert.equal(currentHalt(w), null);
  if (pick.kind === 'weapon') assert.ok(w.slots.some((s) => s && s.def && s.def.id === pick.id));
  if (pick.kind === 'passive') assert.ok(w.build.passives.some((p) => p.def.id === pick.id));
  // Out of charges.
  w.charges = { reroll: 0, banish: 0, skip: 0 };
  levelUp(w);
  assert.throws(() => decide(w, { kind: 'reroll' }), /no rerolls/);
  assert.throws(() => decide(w, { kind: 'banish', index: 0 }), /no banishes/);
  assert.throws(() => decide(w, { kind: 'skip' }), /no skips/);
  assert.throws(() => decide(w, { kind: 'pick', index: 9 }), /no card/);
  w.charges.skip = 1;
  decide(w, { kind: 'skip' });
  assert.equal(currentHalt(w), null);
});

test('draft: passives level up to their max; a weapon with every upgrade banished offers none; with autoFallback off, nothing to draw gives the fallback cards (heal, coin)', () => {
  const w = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun'], passives: ['wick_oil'], relics: [] }, tuning: { draft: { autoFallback: false } } });
  give(w, 'flare_gun', { level: 8 });
  allForms(w);
  givePassive(w, 'wick_oil', 5);
  assert.ok(makeOffer(w).every((c) => c.kind === 'weapon' && c.up), 'a weapon never runs dry by itself (damage never caps)');
  exhaust(w);
  const offer = makeOffer(w);
  assert.deepEqual(offer.map((c) => c.kind), ['heal', 'coin']);
  assert.throws(() => { levelUp(w); decide(w, { kind: 'banish', index: 0 }); }, /fallback cards cannot be banished/);
  const coin = w.materialIndex.get('coin');
  decide(w, { kind: 'pick', index: 1 });
  assert.equal(w.result.materialsRaw[coin], w.tuning.draft.fallbackCoin);
});

test('draft: a level-up with nothing left to level is paid without a stop: Food when hurt, Sea Glass with the Ferryman, else Coin; an Ember every 8th', () => {
  const maxed = (config = {}, dataOpts = {}) => {
    // (No Dash slot cards: a dash item could always be offered, so no level would be dry.)
    const w = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun'], passives: ['wick_oil'], relics: [] }, dashes: [], tuning: { dashes: { maxUps: 0 } }, ...config }, dataOpts);
    give(w, 'flare_gun', { level: 8 });
    allForms(w);
    exhaust(w);
    givePassive(w, 'wick_oil', 5);
    return w;
  };
  const gifts = (w) => { const out = []; for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.LEVEL_GIFT) out.push([w.events.a[i], w.events.b[i], w.events.c[i]]); return out; };
  const T = DATA.tuning.draft, coin = (w) => w.result.materialsRaw[w.materialIndex.get('coin')];
  // Coin: full health, no Ferryman.
  const w = maxed();
  assert.equal(levelUp(w), null, 'no screen: the run goes on');
  assert.deepEqual(gifts(w), [[GIFT.COIN, T.fallbackCoin, 2]], 'a LEVEL_GIFT names what, how much, and the level');
  assert.equal(coin(w), T.fallbackCoin);
  // Food: under autoHealBelow of max health.
  const hurt = maxed();
  hurt.player.hp = hurt.stats.maxHp * T.autoHealBelow - 1;
  const before = hurt.player.hp;
  assert.equal(levelUp(hurt), null);
  assert.deepEqual(gifts(hurt), [[GIFT.FOOD, T.fallbackHeal, 2]]);
  assert.equal(hurt.player.hp, before + T.fallbackHeal, 'healed');
  assert.equal(coin(hurt), 0);
  // Sea Glass while the Ferryman is in the run.
  const ferry = maxed({ harbor: { ferry: 1 } }, { mapExtra: { ferry: { at: [70, 64] } } });
  assert.ok(ferry.ferry, 'the Ferryman is in the run');
  assert.equal(levelUp(ferry), null);
  assert.deepEqual(gifts(ferry), [[GIFT.GLASS, T.autoGlass, 2]]);
  assert.equal(ferry.glass, T.autoGlass);
  // Two earned on one tick: the first now, the second after the gap between drafts (its XP kept).
  const many = maxed();
  many.player.xp = many.player.xpNext + xpToNext(many.tuning, 2) + 1;
  stepWorld(many, IDLE);
  assert.equal(currentHalt(many), null);
  assert.deepEqual(gifts(many).map((g) => g[2]), [2]);
  assert.equal(many.player.level, 2);
  for (let t = 0; t < T.cards * 0 + DATA.tuning.xp.draftGap * 60; t++) stepWorld(many, IDLE);
  assert.equal(many.player.level, 3, 'the second after the gap');
  // The 8th dry level brings an Ember, kept (no screen), while a weapon can take a Form (its
  // upgrades banished, so its levels are dry).
  const ember = maxed();
  ember.slots[0] = buildSlot(ember, 0, ember.slots[0].def, 8, null, { ...ember.slots[0], axes: 0, ascensions: [] });
  for (let k = 1; k < T.autoEmberEvery; k++) { assert.equal(levelUp(ember), null); assert.ok(gifts(ember).every((g) => g[0] !== GIFT.EMBER)); }
  assert.equal(levelUp(ember), null, 'still no screen');
  assert.deepEqual(gifts(ember).map((g) => g[0]), [GIFT.COIN, GIFT.EMBER]);
  assert.equal(ember.build.embers, 1, 'kept for the pause menu');
  // With every axis held an Ember can still switch one (ruling 14), so it is paid; with no weapon
  // that has Forms at all, none is.
  const done = maxed();
  for (let k = 0; k < T.autoEmberEvery; k++) levelUp(done);
  assert.equal(done.build.embers, 1, 'a switch is always there to buy');
  assert.equal(done.dryLevels, T.autoEmberEvery);
  const bare = maxed();
  bare.slots[0] = null;
  for (let k = 0; k < T.autoEmberEvery; k++) levelUp(bare);
  assert.equal(bare.build.embers, 0, 'nothing an Ember could do');
  // A level with something left to take still stops for its cards.
  const open = maxed({ pools: { weapons: ['flare_gun', 'lantern_orb'], passives: ['wick_oil'], relics: [] } });
  assert.equal(levelUp(open).kind, 'draft');
});

test('draft: the draft stream is its own: spawning differently never changes the cards', () => {
  const a = makeWorld({ seed: 77, invulnerable: true });
  const b = makeWorld({ seed: 77, invulnerable: true });
  give(a, 'flare_gun'); give(b, 'flare_gun');
  for (let k = 0; k < 50; k++) spawnAt(b, 'fog_wisp', 200 + k, 0); // uses the spawn stream
  b.rng.loot.next(); b.rng.combat.next();
  assert.deepEqual(makeOffer(a), makeOffer(b));
});

test('draft: relics are never cards, whatever is owned or open', () => {
  const w = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun'], passives: ['wick_oil'], relics: DATA.relics.map((r) => r.id) } });
  give(w, 'flare_gun');
  for (let k = 0; k < 30; k++) assert.ok(!makeOffer(w).some((c) => c.kind === 'relic'));
  assert.throws(() => { levelUp(w); w.halts[0].offer[0] = { kind: 'relic', id: 'brass_button' }; decide(w, { kind: 'pick', index: 0 }); }, /unknown card kind relic/);
});

// ---------------------------------------------------------------- chests, runes, evolutions

test('chests: an elite chest has one item; a boss chest has 1, 3, or 5', () => {
  const counts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const w = makeWorld({ seed, invulnerable: true });
    give(w, 'flare_gun'); give(w, 'lantern_orb'); givePassive(w, 'sea_legs');
    openChest(w, CHEST_ELITE, 0, 0);
    assert.equal(currentHalt(w).items.length, 1);
    w.halts.length = 0;
    openChest(w, CHEST_BOSS, 0, 0);
    counts.add(currentHalt(w).items.length);
  }
  for (const n of counts) assert.ok([1, 3, 5].includes(n));
  assert.ok(counts.size >= 2, `saw ${[...counts]}`);
});

test('rolled upgrades: a chest item and the bell\'s pick roll a weapon\'s levels; banish takes one type off one weapon; nothing evolves', () => {
  // A chest's item for a weapon: one rolled upgrade, a level.
  const e = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun'], passives: [], relics: [] } });
  give(e, 'flare_gun', { level: 1 });
  openChest(e, CHEST_ELITE, 0, 0);
  const [it] = currentHalt(e).items;
  assert.deepEqual([it.kind, it.id, it.slot, it.level, it.isNew], ['weapon', 'flare_gun', 0, 2, false]);
  assert.ok(e.slots[0].def.numbers.includes(it.up) || ['line', 'special'].includes(it.up), it.up);
  assert.ok(DATA.rarities.some((r) => r.id === it.rarity), it.rarity);
  assert.deepEqual([e.slots[0].level, e.slots[0].ups.length], [2, 1]);
  assert.equal(e.slots[0].def.id, 'flare_gun', 'it stays the Flare Gun');
  // The bell's pick: its levels, each rolled when picked.
  const b = makeWorld({ invulnerable: true });
  give(b, 'flare_gun', { level: 8 });
  give(b, 'tide_bell', { level: 3 });
  assert.deepEqual(bellOptions(b).map((o) => [o.kind, o.id, o.from, o.to]), [['weapon', 'flare_gun', 8, 10], ['weapon', 'tide_bell', 3, 5]]);
  openChest(b, CHEST_BELL, 0, 0);
  const bh = currentHalt(b);
  decide(b, { kind: 'pick', index: 0 });
  assert.deepEqual([b.slots[0].level, bh.rolled.length], [10, 2]);
  // The old evolution functions say nothing evolves (kept for the screens: W1-CONTRACT.md §4).
  givePassive(b, 'wick_oil', 5);
  assert.equal(evolvableSlot(b), -1); assert.equal(evolveOne(b, 'test'), -1); assert.equal(canEvolve(b, 0), false); assert.equal(showsReady(b, 0), false);
  assert.ok(!DATA.weapons.some((x) => x.evolution || x.unlock === 'evolution'), 'no weapon evolves, and none is an evolution');
  // Banish on a weapon's upgrade takes that type off that weapon for the run (up:<weapon>:<type>).
  const n = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun', 'tide_bell'], passives: [], relics: [] }, charges: { banish: 1 } });
  give(n, 'flare_gun', { level: 2 }); give(n, 'tide_bell', { level: 2 });
  const h = levelUp(n);
  const k = h.offer.findIndex((c) => c.id === 'flare_gun');
  const gone = h.offer[k].up;
  decide(n, { kind: 'banish', index: k });
  assert.ok(n.build.banished.has(`up:flare_gun:${gone}`));
  assert.equal(currentHalt(n).offer.length, 3, 'replaced');
  for (let r = 0; r < 40; r++) assert.ok(!makeOffer(n).some((c) => c.id === 'flare_gun' && c.up === gone), 'that type never again on that weapon');
  assert.ok(Array.from({ length: 40 }, () => makeOffer(n)).flat().some((c) => c.id === 'flare_gun'), 'the weapon still levels');
});

test('Pick for me: with the build full every card is a weapon\'s rolled upgrade, and it takes the one worth most to its weapon times the weapon\'s tag weight', () => {
  const w = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun', 'tide_bell', 'lantern_orb'], passives: ['wick_oil'], relics: [] } });
  give(w, 'flare_gun', { level: 8 }); give(w, 'tide_bell', { level: 8 }); give(w, 'lantern_orb', { level: 8 });
  givePassive(w, 'wick_oil', 5);
  const h = levelUp(w);
  assert.equal(h.kind, 'draft');
  assert.deepEqual(h.offer.map((c) => c.kind), ['weapon', 'weapon', 'weapon']);
  assert.equal(draftFull(w, h), true);
  // Rarity x tag weight: the Flare Gun and the Lantern Orb share Fire and Light (and Wick Oil Fire); the Tide Bell shares nothing.
  const card = (id, value) => ({ kind: 'weapon', id, slot: 0, level: 9, isNew: false, up: 'damage', rarity: 'common', value, worth: value });
  assert.equal(tagWeight(w, 'flare_gun'), 2, 'the Orb, and Wick Oil');
  assert.equal(tagWeight(w, 'tide_bell'), 1);
  const t = { kind: 'draft', offer: [card('tide_bell', 0.6), card('flare_gun', 0.25), card('lantern_orb', 0.44)] };
  assert.equal(autoPick(w, t), 2, '+44% on a weapon of two shared tags (0.44 x 2) over +60% on one of none (0.6 x 1)');
  assert.equal(upgradeScore(w, t.offer[0]), 0.6);
  const tie = { kind: 'draft', offer: [card('flare_gun', 0.44), card('lantern_orb', 0.44)] };
  assert.equal(autoPick(w, tie), 0, 'ties to the earlier card');
  assert.equal(draftFull(w, { kind: 'draft', offer: [card('flare_gun', 0.44), { kind: 'passive', id: 'wick_oil', level: 2, isNew: false }] }), false, 'a passive card: not full');
  decide(w, { kind: 'pick', index: autoPick(w, h) });
  assert.equal(w.result.weaponUps, 1);
});

test('slots: passives stop at the run\'s own passive slots; RunConfig checks every slot count', () => {
  const w = makeWorld({ invulnerable: true, passiveSlots: 2, weaponSlots: 2, relicSlots: 1 });
  assert.deepEqual([w.build.weaponSlots, w.build.passiveSlots, w.build.relicSlots], [2, 2, 1]);
  givePassive(w, 'wick_oil'); givePassive(w, 'lamp_glass');
  for (let k = 0; k < 30; k++) assert.ok(!makeOffer(w).some((c) => c.kind === 'passive' && c.isNew), 'no new passive past 2');
  assert.throws(() => makeWorld({ passiveSlots: 0 }), /passiveSlots must be a whole number from 1 to 8/);
  assert.throws(() => makeWorld({ relicSlots: 9 }), /relicSlots must be a whole number from 1 to 8/);
  assert.throws(() => makeWorld({ forms: 'all' }), /forms must be a list/);
  const d = makeWorld();
  assert.deepEqual([d.build.weaponSlots, d.build.passiveSlots, d.build.relicSlots], [6, 6, 6], 'tools and tests: 6 each');
  // Relics a run starts with stretch the slots to hold them.
  const r = makeWorld({ relicSlots: 1, relics: ['gull_feather', 'brass_button'] });
  assert.equal(r.build.relicSlots, 2);
});

test('relic slots: a full pick swaps one out or passes; the one given up goes back to the Ferryman; buying with the slots full needs a swap', () => {
  const w = makeWorld({ invulnerable: true, relicSlots: 2, harbor: { ferry: 1 } }, { mapExtra: { ferry: { at: [70, 64] } } });
  const R = (id) => DATA.relics.find((r) => r.id === id);
  addRelic(w, R('gull_feather')); addRelic(w, R('brass_button'));
  w.halts.push({ kind: 'relic', source: 'reliquary', offer: ['spark_flint', 'tide_clock'], x: 0, y: 0 });
  stepWorld(w, IDLE);  // (nothing steps while it waits; the halt is ready)
  decide(w, { kind: 'tune', path: 'draft.cards', value: 3 });
  const h = currentHalt(w);
  assert.equal(h.full, true);
  assert.throws(() => decide(w, { kind: 'pick', index: 0 }), /slots are full; give up a carried relic/);
  assert.throws(() => decide(w, { kind: 'pick', index: 0, swap: 'tide_clock' }), /isn't carried/);
  const mods = w.mods.length;
  decide(w, { kind: 'pick', index: 0, swap: 'brass_button' });
  assert.deepEqual(w.build.relics.map((r) => r.id), ['gull_feather', 'spark_flint']);
  assert.ok(w.mods.length < mods, 'the Brass Button\'s modifier is gone');
  assert.deepEqual(w.result.relicSwaps, ['brass_button']);
  assert.ok(!w.build.banished.has('relic:brass_button'), 'not banned: it can be found again');
  assert.deepEqual(w.build.returned, ['brass_button'], 'waiting for the Ferryman\'s next stock');
  // A pass keeps what you carry; it's refused with room to spare.
  w.halts.push({ kind: 'relic', source: 'vault', offer: ['tide_clock'], x: 0, y: 0, full: true });
  decide(w, { kind: 'pass' });
  assert.deepEqual(w.build.relics.map((r) => r.id), ['gull_feather', 'spark_flint']);
  const roomy = makeWorld({ invulnerable: true });
  roomy.halts.push({ kind: 'relic', source: 'vault', offer: ['tide_clock'], x: 0, y: 0, full: false });
  assert.throws(() => decide(roomy, { kind: 'pass' }), /only for when the relic slots are full/);
  // The Ferryman's next stock carries it back, at its tier's price; buying with the slots full needs a swap.
  w.ferry.nextCall = w.tick;
  run(w, 1, { halts: 'stop' });
  const back = w.ferry.offers.find((o) => o.returned);
  assert.equal(back?.id, 'brass_button');
  assert.deepEqual(w.build.returned, []);
  w.glass = 999;
  w.halts.push({ kind: 'ferry' });
  const k = w.ferry.offers.indexOf(back);
  assert.throws(() => decide(w, { kind: 'buy', index: k }), /relic slots are full/);
  decide(w, { kind: 'buy', index: k, swap: 'gull_feather' });
  assert.deepEqual(w.build.relics.map((r) => r.id), ['spark_flint', 'brass_button']);
  // ...and the Gull Feather is back in his stock at once, since he's tied up.
  assert.ok(w.ferry.offers.some((o) => o.returned && o.id === 'gull_feather'));
});

test('draft tools: a skip pays what a dry level pays; Relics with a downside carry it in their modifiers', () => {
  const w = makeWorld({ invulnerable: true, charges: { skip: 2 } });
  give(w, 'flare_gun');
  const T = DATA.tuning.draft;
  assert.deepEqual(skipPay(w), { kind: GIFT.COIN, amount: T.fallbackCoin });
  levelUp(w);
  decide(w, { kind: 'skip' });
  assert.equal(w.result.materialsRaw[w.materialIndex.get('coin')], T.fallbackCoin);
  assert.equal(w.result.skipGifts, 1);
  const off = makeWorld({ invulnerable: true, charges: { skip: 1 }, tuning: { draft: { skipPays: false } } });
  give(off, 'flare_gun');
  assert.equal(skipPay(off), null);
  levelUp(off); decide(off, { kind: 'skip' });
  assert.equal(off.result.materialsRaw[off.materialIndex.get('coin')], 0);
  for (const r of DATA.relics.filter((x) => x.downside)) {
    assert.equal(r.tier, 3, `${r.id}: a Relic`);
    assert.ok(r.desc.endsWith(`${r.downside}.`), `${r.id}: its description says its price`);
    assert.ok(r.mods?.some((m) => m.value < 0), `${r.id}: the price is a modifier`);
  }
  assert.ok(DATA.relics.filter((x) => x.downside).length >= 3);
});

test('hooks: every hook named in data exists, and adding an unknown one fails loudly', () => {
  // A relic changes a rule (a hook, or a build rule: ruling 14's) or a stat (modifiers), never neither.
  for (const r of DATA.relics) assert.ok(r.hook ? HOOKS[r.hook] : r.rule || r.mods?.length, `relic ${r.id}: hook ${r.hook}, rule, or mods`);
  for (const c of DATA.characters) if (c.mechanic) assert.ok(HOOKS[c.mechanic.hook], `character ${c.id}`);
  const w = makeWorld();
  assert.throws(() => addRelic(w, { id: 'x', hook: 'nope', params: {} }), /Unknown hook "nope"/);
});

test('hooks: the Lamplighter\'s light is her signature (it grows on its own track, ruling 14); the Harpooner gains armor in a crowd and pulls', () => {
  const lamp = createWorld({ seed: 3, character: 'lamplighter', invulnerable: true }, DATA);
  assert.equal(lamp.slots[0].def.id, 'lamplight');
  assert.ok(lamp.sigTrack, 'on its own track (sim/trades.js), not the draft');
  const harp = createWorld({ seed: 3, character: 'harpooner', invulnerable: true, map: 'drowned_docks' }, DATA);
  for (let k = 0; k < 20; k++) spawnAt(harp, 'drowned_sailor', 20 * Math.cos(k), 20 * Math.sin(k));
  for (let i = 0; i < harp.enemies.count; i++) harp.enemies.speed[i] = 0;
  stepWorld(harp, { mx: 0, my: 0, buttons: 0 });
  stepWorld(harp, { mx: 0, my: 0, buttons: 0 });
  for (let k = 0; k < 6; k++) stepWorld(harp, { mx: 0, my: 0, buttons: 0 });
  assert.ok(harp.player.bonusArmor > 2, `armor from the crowd: ${harp.player.bonusArmor}`);
  assert.ok(harp.player.bonusArmor <= 10, 'capped');
});

test('hooks: relics change the rules they say they change', () => {
  // Volatile Gems: collecting a gem sets off a blast around you.
  let w = makeWorld({ invulnerable: true });
  addRelic(w, DATA.relics.find((r) => r.id === 'volatile_gems'));
  const e = spawnAt(w, 'drowned_sailor', 15, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
  w.player.xpNext = 1e9;
  spawnGem(w, w.player.x + 3, w.player.y, 1);
  let blasts = runCollect(w, 2, EV.EXPLODE);
  assert.equal(blasts.length, 1);
  assert.ok(w.result.damageBySlot[9] > 0, 'the relic slot did damage');
  // Glass Lantern: healing becomes a shield (capped), and the shield takes hits first.
  w = makeWorld();
  addRelic(w, DATA.relics.find((r) => r.id === 'glass_lantern'));
  w.player.hp = 50;
  heal(w, 500);
  assert.equal(w.player.hp, 50, 'no healing');
  assert.equal(w.player.shield, w.stats.maxHp * 0.5, 'shield, capped at half your health');
  // Reaper's Wake: kills while you stand still drop double experience (ruling 16: never the dash).
  w = makeWorld({ invulnerable: true });
  addRelic(w, DATA.relics.find((r) => r.id === 'reapers_wake'));
  const d = spawnAt(w, 'drowned_sailor', 150, 0);
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  damageEnemy(w, d, 1e6, 0);
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(w.gems.value[0], 2 * w.enemyDefs[w.enemyIndex.get('drowned_sailor')].xp);
  // Seventh Bell: the 7th level-up gives an Ember (and its price: -10% XP).
  w = makeWorld({ invulnerable: true, tuning: { draft: { skipPays: false } } });
  addRelic(w, DATA.relics.find((r) => r.id === 'seventh_bell'));
  give(w, 'tide_bell', { level: 2 });
  for (let k = 0; k < 6; k++) { levelUp(w); decide(w, { kind: 'skip' }); w.charges.skip = 9; }
  assert.equal(w.build.embers, 0, 'not before the 7th');
  levelUp(w);
  assert.equal(w.build.embers, 1, 'an Ember on the 7th level-up');
  assert.ok(Math.abs(w.stats.growth - 0.9) < 1e-9, '-10% XP');
  // Tide Clock: a wave every 45 seconds.
  w = makeWorld({ invulnerable: true });
  addRelic(w, DATA.relics.find((r) => r.id === 'tide_clock'));
  const waves = runCollect(w, 45 * TPS + 2, EV.WAVE);
  assert.equal(waves.length, 1);
});

// ---------------------------------------------------------------- slot rules and edge cases

test('draft: full weapon or passive slots mean no new ones offered; skip spends a charge', () => {
  const w = makeWorld({ invulnerable: true });
  for (const id of ['flare_gun', 'lantern_orb', 'harpoon_chain', 'tide_bell']) give(w, id);
  w.build.weaponSlots = 4;
  for (const id of ['wick_oil', 'lamp_glass', 'ballast', 'undertow', 'sea_legs', 'thick_coat']) givePassive(w, id, 1);
  for (let k = 0; k < 40; k++) {
    const offer = makeOffer(w);
    assert.ok(!offer.some((c) => c.isNew && c.kind !== 'dash'), `nothing new with every slot full (a dash item swaps): ${offer.map((c) => c.id)}`);
  }
  const skips = w.charges.skip;
  levelUp(w);
  decide(w, { kind: 'skip' });
  assert.equal(w.charges.skip, skips - 1);
});

test('draft: a banish never brings back a card already showing, and keeps the early new-weapon rule', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const w = makeWorld({ seed, invulnerable: true, charges: { banish: 5 } });
    give(w, 'flare_gun');
    const h = levelUp(w);
    const k = h.offer.findIndex((c) => c.kind === 'weapon' && c.isNew);
    decide(w, { kind: 'banish', index: k });
    const offer = currentHalt(w).offer;
    assert.equal(new Set(offer.map((c) => `${c.kind}:${c.id}`)).size, offer.length, `seed ${seed}: no duplicates`);
    assert.ok(offer.some((c) => c.kind === 'weapon' && c.isNew), `seed ${seed}: still a new weapon (${offer.map((c) => c.id)})`);
  }
});

test('draft: with nothing to draw (every upgrade banished, every passive maxed), the heal and coin cards, and nothing else', () => {
  const w = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun'], passives: ['wick_oil'], relics: DATA.relics.map((r) => r.id) } });
  give(w, 'flare_gun', { level: 8 });
  allForms(w);
  exhaust(w);
  givePassive(w, 'wick_oil', 5);
  assert.deepEqual(makeOffer(w).map((c) => c.kind).sort(), ['coin', 'heal']);
});

// ---------------------------------------------------------------- chests and hooks, more closely

test('chests: luck buys bigger boss chests; relics never come out of chests; a rune\'s place is a Rare or better upgrade', () => {
  const avg = (luck) => {
    let n = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const w = makeWorld({ seed, invulnerable: true, mods: [{ stat: 'luck', op: 'add', value: luck - 1 }] });
      give(w, 'flare_gun');
      openChest(w, CHEST_BOSS, 0, 0);
      n += currentHalt(w).items.length;
    }
    return n / 150;
  };
  assert.ok(avg(4) > avg(1) + 0.5, 'luck 4 averages bigger chests');
  for (let seed = 1; seed <= 30; seed++) {
    const w = makeWorld({ seed, invulnerable: true, tuning: { chests: { bossItems: [[5, 1]] } } });
    give(w, 'flare_gun');
    openChest(w, CHEST_BOSS, 0, 0);
    assert.ok(!currentHalt(w).items.some((i) => i.kind === 'relic'), `seed ${seed}: no relic in a chest`);
  }
  // Where a chest held a rune, an item is a weapon upgrade at Rare or better (ruling 14).
  for (let seed = 1; seed <= 20; seed++) {
    const w = makeWorld({ seed, invulnerable: true, tuning: { chests: { rareChance: 1, bossItems: [[5, 1]] } } });
    give(w, 'flare_gun');
    openChest(w, CHEST_BOSS, 0, 0);
    for (const it of currentHalt(w).items.filter((i) => i.kind === 'weapon' && !i.isNew)) assert.ok(['rare', 'epic', 'legendary'].includes(it.rarity), `seed ${seed}: ${it.rarity}`);
    assert.ok(!currentHalt(w).items.some((i) => i.kind === 'rune'), 'no runes');
  }
});

test('hooks: Volatile Gems blasts at most every 0.1 s; the shield takes a hit before health', () => {
  const w = makeWorld({ invulnerable: true });
  addRelic(w, DATA.relics.find((r) => r.id === 'volatile_gems'));
  w.player.xpNext = 1e9;
  for (let k = 0; k < 5; k++) spawnGem(w, w.player.x + 1, w.player.y, 1);
  assert.equal(runCollect(w, 1, EV.EXPLODE).length, 1, 'five gems at once: one blast');
  const s = makeWorld();
  addRelic(s, DATA.relics.find((r) => r.id === 'glass_lantern'));
  heal(s, 20);
  const hp = s.player.hp;
  hurtPlayer(s, 12, s.player.x, s.player.y);
  assert.equal(s.player.hp, hp, 'the shield took it');
  assert.equal(s.player.shield, 8);
});

test('hooks: the Harpooner\'s weapons pull enemies toward her', () => {
  const w = createWorld({ seed: 3, character: 'harpooner', invulnerable: true }, DATA);
  const e = spawnAt(w, 'drowned_sailor', 60, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
  w.player.fx = 1; w.player.fy = 0;
  const x0 = w.enemies.x[e];
  let hitAt = -1;
  for (let t = 0; t < 60 && hitAt < 0; t++) { stepWorld(w, { mx: 0, my: 0, buttons: 0 }); if (w.result.damageBySlot[0] > 0) hitAt = t; }
  assert.ok(hitAt >= 0, 'the harpoon hit');
  for (let t = 0; t < 10; t++) stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.ok(w.enemies.x[e] < x0 - 3, `pulled in: ${x0.toFixed(1)} -> ${w.enemies.x[e].toFixed(1)}`);
});

test('hooks: what the Harpooner hits is dazed: it stands still and can\'t hurt her until it wears off; bosses shrug it off', () => {
  const w = createWorld(neutralPace({ seed: 3, character: 'harpooner' }), DATA);
  const E = w.enemies, p = w.player;
  const daze = DATA.characters.find((c) => c.id === 'harpooner').mechanic.params.daze;
  assert.ok(daze > 0);
  // Her harpoon hits a sailor: it's dazed for the listed time.
  const e = spawnAt(w, 'drowned_sailor', 60, 0);
  E.hp[e] = E.maxHp[e] = 1e6;
  p.fx = 1; p.fy = 0;
  let hit = false;
  for (let t = 0; t < 60 && !hit; t++) { stepWorld(w, { mx: 0, my: 0, buttons: 0 }); hit = w.result.damageBySlot[0] > 0; }
  assert.ok(hit, 'the harpoon hit');
  assert.ok(E.dazeT[e] > daze - 2 / 60 && E.dazeT[e] <= daze, `dazed for ${E.dazeT[e].toFixed(3)} s`);
  // Dazed and standing on her: no damage, but it's still pushed out of her.
  E.vx[e] = 0; E.vy[e] = 0;
  E.x[e] = p.x + 2; E.y[e] = p.y;
  E.dazeT[e] = 1;
  const hp = p.hp;
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(p.hp, hp, 'a dazed enemy does no contact damage');
  assert.ok(E.x[e] - p.x > 2, 'and is pushed out of her like any other');
  // It doesn't walk while dazed.
  E.x[e] = p.x + 50; E.y[e] = p.y; E.vx[e] = 0; E.vy[e] = 0;
  const x0 = E.x[e];
  for (let k = 0; k < w.build.weaponSlots; k++) w.slots[k] = null;   // no more harpoons, so nothing tugs it (the Harpoon Chain bends onto it too)
  for (let t = 0; t < 10; t++) stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(E.x[e], x0, 'it stands where it was');
  // It wears off, and then it walks and bites again.
  for (let t = 0; t < 60; t++) stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(E.dazeT[e], 0);
  assert.ok(E.x[e] < x0 - 5, 'walking again');
  E.x[e] = p.x + 2; E.y[e] = p.y; p.iframes = 0;
  const hp2 = p.hp;
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.ok(p.hp < hp2, 'and it hurts again');
  // Bosses aren't dazed: their attacks keep their own time.
  const boss = spawnAt(w, 'harbor_maw', 120, 0);
  for (const { fn, h } of w.hooks.onHit) fn(w, h, boss, 0);
  assert.equal(E.dazeT[boss], 0);
  // A Lamplighter's hits daze nothing.
  const l = createWorld({ seed: 3, character: 'lamplighter', invulnerable: true }, DATA);
  const s = spawnAt(l, 'drowned_sailor', 30, 0);
  l.enemies.hp[s] = l.enemies.maxHp[s] = 1e6;
  for (let t = 0; t < 120; t++) stepWorld(l, { mx: 0, my: 0, buttons: 0 });
  assert.equal(l.enemies.dazeT[s], 0);
});

test('hooks: the daze is refreshed by each hit, never added up', () => {
  const daze = DATA.characters.find((c) => c.id === 'harpooner').mechanic.params.daze;
  const w = makeWorld({ character: 'harpooner', invulnerable: true });
  w.slots.fill(null);
  const e = spawnAt(w, 'drowned_sailor', 60, 0);
  const hitHer = () => { for (const { fn, h } of w.hooks.onHit) fn(w, h, e, 0); };
  for (let k = 0; k < 20; k++) hitHer();
  assert.equal(w.enemies.dazeT[e], Math.fround(daze), 'twenty hits in one tick: one daze');
  for (let t = 0; t < 12; t++) stepWorld(w, IDLE);
  assert.ok(w.enemies.dazeT[e] < daze - 0.15, 'it wears off');
  hitHer();
  assert.equal(w.enemies.dazeT[e], Math.fround(daze), 'a new hit starts it again, from its full length');
  // A relic's hits (the relic slots) don't daze.
  w.enemies.dazeT[e] = 0;
  for (const { fn, h } of w.hooks.onHit) fn(w, h, e, 200);
  assert.equal(w.enemies.dazeT[e], 0);
});

// An attack that has been warned goes off when its warning says, whatever hits it (§5.13, §16.4).
// Twin worlds: in one, the Harpooner's hook hits the enemy every tick of its attack.
function attackTimes(id, dx, attacking, hitting) {
  const w = makeWorld({ character: 'harpooner', invulnerable: true });
  w.slots.fill(null);                                  // only the hook touches it
  const E = w.enemies, e = spawnAt(w, id, dx, 0);
  E.hp[e] = E.maxHp[e] = 1e6;
  w.eventsPerTick = true;                              // each tick's events on their own
  const changes = [], shots = [];
  let last = E.aiState[e];
  for (let t = 0; t < 900 && changes.length < 3; t++) {
    if (hitting && attacking(E.aiState[e])) {
      for (const { fn, h } of w.hooks.onHit) fn(w, h, e, 0);
      assert.equal(E.dazeT[e], 0, `${id} isn't dazed in the middle of its attack`);
      assert.ok(midAttack(E, e));
    }
    stepWorld(w, IDLE);
    if (E.aiState[e] !== last) { changes.push([w.tick, E.aiState[e]]); last = E.aiState[e]; }
    if (w.events.countOf(EV.ENEMY_SHOT) > 0) shots.push(w.tick);
  }
  return { changes, shots, w, e };
}

test('hooks: a crab winding up or dashing isn\'t dazed; it dashes when its warning ends', () => {
  const plain = attackTimes('mud_crab', 100, (s) => s === CHARGER.WINDUP || s === CHARGER.DASH, false);
  const hit = attackTimes('mud_crab', 100, (s) => s === CHARGER.WINDUP || s === CHARGER.DASH, true);
  assert.deepEqual(plain.changes.map((c) => c[1]), [CHARGER.WINDUP, CHARGER.DASH, CHARGER.RECOVER]);
  assert.deepEqual(hit.changes, plain.changes, 'winding up, dashing, and recovering on the same ticks');
  const [windup, dash] = plain.changes;
  const warn = Math.max(DATA.enemies.find((x) => x.id === 'mud_crab').ai.windup, DATA.tuning.enemies.telegraphMin);
  assert.ok(Math.abs(dash[0] - windup[0] - warn * TPS) <= 1, `the dash starts as the warning ends (${dash[0] - windup[0]} ticks)`);
  // Once the dash is over it can be dazed again.
  const { w, e } = hit;
  for (const { fn, h } of w.hooks.onHit) fn(w, h, e, 0);
  assert.ok(w.enemies.dazeT[e] > 0, 'recovering: dazed');
});

test('hooks: a gunner aiming isn\'t dazed; it fires when its warning ends', () => {
  const plain = attackTimes('wreck_gunner', 150, (s) => s === RANGED.WARN, false);
  const hit = attackTimes('wreck_gunner', 150, (s) => s === RANGED.WARN, true);
  assert.deepEqual(plain.changes.slice(0, 2).map((c) => c[1]), [RANGED.WARN, RANGED.WAIT]);
  assert.deepEqual(hit.changes.slice(0, 2), plain.changes.slice(0, 2), 'aims and fires on the same ticks');
  assert.ok(plain.shots.length >= 1 && plain.shots[0] === plain.changes[1][0], 'the shot goes off as the aim ends');
  assert.deepEqual(hit.shots, plain.shots, 'hit or not, it shoots on the same ticks');
});

test('freeze (the Brine Spring) never holds an attack that has been warned either', () => {
  const w = makeWorld({ invulnerable: true });
  const E = w.enemies;
  const freeze = DATA.weapons.find((x) => x.id === 'brine_spring').pipeline.onHit.find((f) => f.status === 'freeze');
  const crab = spawnAt(w, 'mud_crab', 100, 0), gun = spawnAt(w, 'wreck_gunner', -150, 0);
  for (const [e, busy, idle] of [[crab, CHARGER.WINDUP, CHARGER.APPROACH], [crab, CHARGER.DASH, CHARGER.RECOVER], [gun, RANGED.WARN, RANGED.WAIT]]) {
    E.freezeT[e] = 0;
    E.aiState[e] = busy; E.aiTimer[e] = 0.5;
    applyStatus(w, e, freeze, 0);
    assert.equal(E.freezeT[e], 0, 'mid-attack: not frozen');
    E.aiState[e] = idle;
    applyStatus(w, e, freeze, 0);
    assert.equal(E.freezeT[e], Math.fround(freeze.duration), 'otherwise frozen as usual');
  }
  // A boss warning or charging isn't frozen either; walking, it is (for a quarter as long).
  const maw = spawnAt(w, 'harbor_maw', 150, 0);
  registerBoss(w, maw, false);
  const b = w.bosses[w.bosses.length - 1];
  for (const st of [BOSS_STATE.WARN, BOSS_STATE.CHARGE]) {
    E.freezeT[maw] = 0; b.state = st;
    applyStatus(w, maw, freeze, 0);
    assert.equal(E.freezeT[maw], 0, `a boss in state ${st} isn't frozen`);
  }
  b.state = BOSS_STATE.WALK;
  applyStatus(w, maw, freeze, 0);
  assert.equal(E.freezeT[maw], Math.fround(freeze.duration * DATA.tuning.enemies.freezeBossFactor));
});

test('bosses: a warned charge runs its course on time, even if a freeze got in before it began', () => {
  const chargeTimes = (frozen) => {
    const w = makeWorld({ invulnerable: true });
    const maw = spawnAt(w, 'harbor_maw', 200, 0);
    registerBoss(w, maw, false);
    const b = w.bosses[0];
    let start = -1, end = -1;
    for (let t = 0; t < 6000 && end < 0; t++) {
      const was = b.state;
      stepWorld(w, IDLE);
      if (was !== BOSS_STATE.CHARGE && b.state === BOSS_STATE.CHARGE) { start = w.tick; if (frozen) w.enemies.freezeT[maw] = 1; }
      if (was === BOSS_STATE.CHARGE && b.state !== BOSS_STATE.CHARGE) end = w.tick;
    }
    return [start, end];
  };
  const plain = chargeTimes(false), held = chargeTimes(true);
  assert.ok(plain[0] > 0 && plain[1] > plain[0], `the Maw charged (${plain})`);
  assert.deepEqual(held, plain, 'frozen or not, the charge starts and ends on the same ticks');
});

test('kills made after deaths resolve (a relic blast while collecting gems) still count, drop, and end the run', () => {
  const w = makeWorld({ invulnerable: true });
  addRelic(w, DATA.relics.find((r) => r.id === 'volatile_gems'));
  w.player.xpNext = 1e9;
  const e = spawnAt(w, 'fog_wisp', 12, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = 1;
  spawnGem(w, w.player.x + 1, w.player.y, 1);
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(w.result.totalKills, 1, 'the blast kill counted');
  assert.equal(w.gems.count, 1, 'and dropped its gem');
  // The final boss killed the same way: its chest opens and the stay-or-leave choice comes.
  const b = makeWorld({ invulnerable: true });
  addRelic(b, DATA.relics.find((r) => r.id === 'volatile_gems'));
  b.player.xpNext = 1e9;
  const boss = spawnAt(b, 'harbor_maw', 30, 0);
  registerBoss(b, boss, true);
  pastGates(b.bosses[0]);   // (0.9.0: past its floor and its phase gates, so the blast can kill it)
  b.enemies.hp[boss] = 1; b.enemies.speed[boss] = 0;
  spawnGem(b, b.player.x + 1, b.player.y, 1);
  stepWorld(b, { mx: 0, my: 0, buttons: 0 });
  assert.equal(b.director.bossesAlive, 0);
  assert.deepEqual(b.result.bossesKilled.map((x) => x.id), ['harbor_maw']);
  assert.equal(b.result.cleared, true);
  assert.deepEqual(b.halts.map((h) => h.kind).filter((k) => k !== 'rune'), ['chest', 'overtime']);
});
