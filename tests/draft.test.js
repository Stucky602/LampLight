// The draft (§5.10), chests, runes, evolutions (§5.8, §5.11), and hooks (§5.12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, give, givePassive, run, runCollect, DATA, IDLE } from './helpers/simworld.js';
import { makeOffer, draftCandidates } from '../src/sim/draft.js';
import { openChest, evolvableSlot, evolveOne, openSocketsFor, CHEST_BOSS, CHEST_ELITE } from '../src/sim/chests.js';
import { hurtPlayer } from '../src/sim/player.js';
import { registerBoss, BOSS_STATE } from '../src/sim/bosses.js';
import { decide, currentHalt, createWorld, stepWorld } from '../src/sim/world.js';
import { addRelic } from '../src/sim/build.js';
import { damageEnemy, applyStatus, midAttack, CHARGER, RANGED } from '../src/sim/enemies.js';
import { spawnGem } from '../src/sim/pickups.js';
import { heal } from '../src/sim/player.js';
import { HOOKS } from '../src/sim/hooks.js';
import { EV } from '../src/sim/events.js';
import { TPS, INNATE_SLOT } from '../src/sim/constants.js';

function levelUp(w) {
  w.player.xp = w.player.xpNext;
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  return currentHalt(w);
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

test('draft: owned items level up to their max; with everything maxed, fallback cards (heal, coin)', () => {
  const w = makeWorld({ invulnerable: true, pools: { weapons: ['flare_gun'], passives: ['wick_oil'], relics: [], runes: [] } });
  give(w, 'flare_gun', { level: 8 });
  givePassive(w, 'wick_oil', 5);
  const offer = makeOffer(w);
  assert.deepEqual(offer.map((c) => c.kind), ['heal', 'coin']);
  assert.throws(() => { levelUp(w); decide(w, { kind: 'banish', index: 0 }); }, /fallback cards cannot be banished/);
  const coin = w.materialIndex.get('coin');
  decide(w, { kind: 'pick', index: 1 });
  assert.equal(w.result.materialsRaw[coin], w.tuning.draft.fallbackCoin);
});

test('draft: the draft stream is its own: spawning differently never changes the cards', () => {
  const a = makeWorld({ seed: 77, invulnerable: true });
  const b = makeWorld({ seed: 77, invulnerable: true });
  give(a, 'flare_gun'); give(b, 'flare_gun');
  for (let k = 0; k < 50; k++) spawnAt(b, 'fog_wisp', 200 + k, 0); // uses the spawn stream
  b.rng.loot.next(); b.rng.combat.next();
  assert.deepEqual(makeOffer(a), makeOffer(b));
});

test('draft: a relic card shows up at most once per offer, and only relics you could take', () => {
  const w = makeWorld({ invulnerable: true, tuning: { draft: { relicChance: 10 } } });
  give(w, 'flare_gun');
  for (let k = 0; k < 30; k++) {
    const offer = makeOffer(w);
    assert.equal(offer.filter((c) => c.kind === 'relic').length, 1);
  }
  for (const r of DATA.relics) addRelic(w, r);
  assert.equal(makeOffer(w).filter((c) => c.kind === 'relic').length, 0, 'all owned: no relic card');
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

test('evolutions: max weapon + partner passive at level + boss chest; runes that still fit carry over', () => {
  const w = makeWorld({ invulnerable: true });
  const s = give(w, 'flare_gun', { level: 8, runes: ['backfire', 'splitting'] });
  givePassive(w, 'wick_oil', 4);
  assert.equal(evolvableSlot(w), -1, 'partner passive one level short');
  givePassive(w, 'wick_oil', 5);
  assert.equal(evolvableSlot(w), s.index);
  openChest(w, CHEST_ELITE, 0, 0);
  assert.equal(w.slots[s.index].def.id, 'flare_gun', 'an elite chest never evolves');
  w.halts.length = 0;
  openChest(w, CHEST_BOSS, 0, 0);
  const h = currentHalt(w);
  assert.equal(h.items[0].kind, 'evolution');
  assert.ok(h.items.slice(1).every((i) => i.kind !== 'evolution'), 'one weapon could evolve, so one did');
  assert.equal(w.slots[s.index].def.id, 'flare_barrage');
  assert.deepEqual(w.slots[s.index].runes.map((r) => r && r.id), ['backfire', 'splitting'], 'both still fit a nearest emitter');
  assert.ok(w.build.evolvedFrom.has('flare_gun'));
  assert.ok(!makeOffer(w).some((c) => c.id === 'flare_gun'), 'the old weapon is never offered again');
  assert.deepEqual(w.result.evolutions.map((e) => e.into), ['flare_barrage']);
});

test('runes: placement goes only to an open socket where the rune fits; discarding is allowed', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun');
  give(w, 'tide_bell');
  const orbiting = w.runeDefs.find((r) => r.id === 'orbiting');
  assert.deepEqual(openSocketsFor(w, orbiting), [0], 'not on the bell (a wave)');
  w.halts.push({ kind: 'rune', rune: 'orbiting' });
  assert.throws(() => decide(w, { kind: 'place', slot: 1 }), /can't go/);
  decide(w, { kind: 'place', slot: 0 });
  assert.equal(w.slots[0].runes[0].id, 'orbiting');
  assert.equal(w.slots[0].emit.type, 'orbit', 'the patch applied');
  w.halts.push({ kind: 'rune', rune: 'backfire' });
  decide(w, { kind: 'discard' });
  assert.equal(currentHalt(w), null);
});

// ---------------------------------------------------------------- hooks

test('hooks: every hook named in data exists, and adding an unknown one fails loudly', () => {
  for (const r of DATA.relics) assert.ok(HOOKS[r.hook], `relic ${r.id} hook ${r.hook}`);
  for (const c of DATA.characters) if (c.mechanic) assert.ok(HOOKS[c.mechanic.hook], `character ${c.id}`);
  const w = makeWorld();
  assert.throws(() => addRelic(w, { id: 'x', hook: 'nope', params: {} }), /Unknown hook "nope"/);
});

test('hooks: the Lamplighter\'s light grows with her level; the Harpooner gains armor in a crowd and pulls', () => {
  const lamp = createWorld({ seed: 3, character: 'lamplighter', invulnerable: true }, DATA);
  const r1 = lamp.slots[INNATE_SLOT].stats.area;
  lamp.player.level = 11;
  lamp.statsDirty = true;
  stepWorld(lamp, { mx: 0, my: 0, buttons: 0 });
  const r11 = lamp.slots[INNATE_SLOT].stats.area;
  assert.ok(Math.abs(r11 / r1 - (1 + 0.025 * 10)) < 1e-9, `area ${r1} -> ${r11}`);
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
  // Reaper's Wake: kills while dashing drop double experience.
  w = makeWorld({ invulnerable: true });
  addRelic(w, DATA.relics.find((r) => r.id === 'reapers_wake'));
  const d = spawnAt(w, 'drowned_sailor', 150, 0);
  stepWorld(w, { mx: 127, my: 0, buttons: 1 });
  damageEnemy(w, d, 1e6, 0);
  stepWorld(w, { mx: 127, my: 0, buttons: 1 });
  assert.equal(w.gems.value[0], 2 * w.enemyDefs[w.enemyIndex.get('drowned_sailor')].xp);
  // Seventh Bell: the 7th level-up evolves an eligible weapon.
  w = makeWorld({ invulnerable: true });
  addRelic(w, DATA.relics.find((r) => r.id === 'seventh_bell'));
  give(w, 'tide_bell', { level: 8 });
  givePassive(w, 'undertow', 5);
  for (let k = 0; k < 6; k++) { levelUp(w); decide(w, { kind: 'skip' }); w.charges.skip = 9; }
  assert.equal(w.slots[0].def.id, 'tide_bell', 'not before the 7th');
  levelUp(w);
  assert.equal(w.slots[0].def.id, 'storm_bell', 'evolved on the 7th level-up');
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
    assert.ok(!offer.some((c) => c.isNew && c.kind !== 'relic'), `nothing new with every slot full: ${offer.map((c) => c.id)}`);
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

test('draft: with everything maxed, a relic card comes with the heal and coin cards, never alone', () => {
  const w = makeWorld({ invulnerable: true, tuning: { draft: { relicChance: 10 } }, pools: { weapons: ['flare_gun'], passives: ['wick_oil'], relics: DATA.relics.map((r) => r.id), runes: [] } });
  give(w, 'flare_gun', { level: 8 });
  givePassive(w, 'wick_oil', 5);
  assert.deepEqual(makeOffer(w).map((c) => c.kind).sort(), ['coin', 'heal', 'relic']);
});

// ---------------------------------------------------------------- chests and hooks, more closely

test('chests: luck buys bigger boss chests; relics come out of chests; runes never outnumber sockets', () => {
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
  let relics = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const w = makeWorld({ seed, invulnerable: true, tuning: { chests: { relicChance: 1, runeChance: 0 } } });
    give(w, 'flare_gun');
    openChest(w, CHEST_ELITE, 0, 0);
    if (currentHalt(w).items[0].kind === 'relic') relics++;
  }
  assert.ok(relics >= 25, `${relics}/30 chests gave a relic at chance 1`);
  for (let seed = 1; seed <= 40; seed++) {
    const w = makeWorld({ seed, invulnerable: true, tuning: { chests: { runeChance: 1, bossItems: [[5, 1]] } } });
    give(w, 'flare_gun'); // two open sockets
    openChest(w, CHEST_BOSS, 0, 0);
    const runes = currentHalt(w).items.filter((i) => i.kind === 'rune').length;
    assert.ok(runes <= 2, `seed ${seed}: ${runes} runes for 2 sockets`);
  }
});

test('evolutions: a big boss chest evolves every weapon that can; never into one you own; gear lowers the partner level', () => {
  const w = makeWorld({ invulnerable: true, tuning: { chests: { bossItems: [[3, 1]] } } });
  give(w, 'flare_gun', { level: 8 }); givePassive(w, 'wick_oil', 5);
  give(w, 'tide_bell', { level: 8 }); givePassive(w, 'undertow', 5);
  openChest(w, CHEST_BOSS, 0, 0);
  assert.deepEqual(currentHalt(w).items.filter((i) => i.kind === 'evolution').map((i) => i.id).sort(), ['flare_barrage', 'storm_bell']);
  const o = makeWorld({ invulnerable: true });
  give(o, 'flare_gun', { level: 8 }); givePassive(o, 'wick_oil', 5);
  give(o, 'flare_barrage');
  assert.equal(evolveOne(o, 'test'), -1, 'the evolved weapon is already in the build');
  const g = makeWorld({ invulnerable: true, evolutionPassiveReduction: 2 });
  give(g, 'flare_gun', { level: 8 }); givePassive(g, 'wick_oil', 3);
  assert.equal(evolvableSlot(g), 0, 'wick oil 3 is enough with gear taking 2 off');
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
  const w = createWorld({ seed: 3, character: 'harpooner' }, DATA);
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
  w.slots[0] = null;                                 // no more harpoons, so nothing tugs it
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

test('freeze (the Storm Bell) never holds an attack that has been warned either', () => {
  const w = makeWorld({ invulnerable: true });
  const E = w.enemies;
  const freeze = DATA.weapons.find((x) => x.id === 'storm_bell').pipeline.onHit.find((f) => f.status === 'freeze');
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
  b.enemies.hp[boss] = 1; b.enemies.speed[boss] = 0;
  spawnGem(b, b.player.x + 1, b.player.y, 1);
  stepWorld(b, { mx: 0, my: 0, buttons: 0 });
  assert.equal(b.director.bossesAlive, 0);
  assert.deepEqual(b.result.bossesKilled.map((x) => x.id), ['harbor_maw']);
  assert.equal(b.result.cleared, true);
  assert.deepEqual(b.halts.map((h) => h.kind).filter((k) => k !== 'rune'), ['chest', 'overtime']);
});
