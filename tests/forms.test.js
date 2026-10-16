// Forms (sim/forms.js, data/ascensions.js; ARCHITECTURE §5.16): what each does, that all three of
// a line's combine on a weapon and its evolution, and that runes and Forms never cancel each other.
// (The Ember that buys one: tests/ascend.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { stepWorld, hashWorld } from '../src/sim/world.js';
import { buildSlot, runeFits } from '../src/sim/weapons.js';
import { openAscensions } from '../src/sim/ascend.js';
import { focusMul, fuelLink, focusBurn, stokePyre } from '../src/sim/forms.js';
import { damageEnemyR } from '../src/sim/enemies.js';
import { FORM_AXES } from '../src/data/ascensions.js';
import { EV } from '../src/sim/events.js';
import { EF, PF, MOTION, ZONE, ZF, ZSTYLE, MARKS } from '../src/sim/constants.js';
import { NO_HANDLE } from '../src/sim/pools.js';
import { BTN_DASH } from '../src/lib/inputframe.js';
import { makeWorld, give, spawnAt } from './helpers/simworld.js';

const MECHANICS = ['salvo', 'mortar', 'hang', 'eclipse', 'hunting', 'wards', 'lunge', 'skewer', 'tether', 'toll', 'breakers', 'riptide',
  'sweep', 'relay', 'focus', 'trail', 'cluster', 'fuel', 'rod', 'march', 'static', 'pyre', 'wisps', 'vigil'];
const lineOf = (id) => DATA.ascensions.find((l) => l.weapons.includes(id));
const formOf = (id) => DATA.ascensions.flatMap((l) => l.options).find((o) => o.id === id);
const subsets = (xs) => xs.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

/** A world with one weapon (by id) at a level, holding these Forms (ids, in order). */
function armed(id, forms = [], { level = 4, runes = [], seed = 1 } = {}) {
  const w = makeWorld({ invulnerable: true, seed });
  const s = give(w, id, { level, runes });
  if (forms.length) w.slots[0] = buildSlot(w, 0, s.def, s.level, s.runes, { ...s, ascensions: forms.map(formOf) });
  return w;
}

// A crowd that keeps coming: sailors, crabs, and lantern eaters in a ring, topped up; you walk a slow circle and dash
// every 2 seconds. `probe(w)` is asked every tick; the run returns true if it ever said yes.
const ENEMIES = ['drowned_sailor', 'mud_crab', 'lantern_eater'];
function fight(w, ticks, probe = () => false) {
  let seen = false;
  for (let t = 0; t < ticks; t++) {
    if (t % 30 === 0) {
      let alive = 0;
      for (let i = 0; i < w.enemies.count; i++) if ((w.enemies.flags[i] & EF.DEAD) === 0) alive++;
      for (let k = alive; k < 24; k++) {
        const a = (k * 2.399 + t * 0.01), r = 50 + (k % 6) * 22;
        spawnAt(w, ENEMIES[k % 3], Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    const a = t / 90;
    stepWorld(w, { mx: Math.round(Math.cos(a) * 60), my: Math.round(Math.sin(a) * 60), buttons: t % 120 === 60 ? BTN_DASH : 0 });
    while (w.halts.length) w.halts.shift();
    if (!seen && probe(w)) seen = true;
  }
  return seen;
}

const anyProj = (w, f) => { const P = w.projectiles; for (let i = 0; i < P.count; i++) if (P.slot[i] === 0 && (P.flags[i] & PF.DEAD) === 0 && f(P, i)) return true; return false; };
const anyZone = (w, f) => { const Z = w.zones; for (let z = 0; z < Z.count; z++) if (Z.slot[z] === 0 && Z.life[z] > 0 && f(Z, z)) return true; return false; };
const anyEvent = (w, type, f = () => true) => { const ev = w.events; for (let i = 0; i < ev.count; i++) if (ev.type[i] === type && f(ev, i)) return true; return false; };

// Each Form's own mark on a fight: something only it does.
const SIGNS = {
  salvo: (w) => anyEvent(w, EV.FIRE, (ev, i) => ev.a[i] === 0 && ev.b[i] === 8),
  mortar: (w) => anyProj(w, (P, i) => P.motion[i] === MOTION.arc),
  hanging_flare: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.GROUND && Z.style[z] === ZSTYLE.FLARE),
  eclipse: (w) => w.slots[0].fs.growth > 0 && anyProj(w, (P, i) => P.scale[i] >= 2),
  hunting_lights: (w) => anyProj(w, (P, i) => P.motion[i] === MOTION.homing),
  wards: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.GROUND && Z.style[z] === ZSTYLE.WARD),
  lunge: (w) => anyEvent(w, EV.FIRE, (ev, i) => ev.a[i] === 0 && ev.b[i] === 4),
  skewer: (w) => anyProj(w, (P, i) => P.carry[i] !== NO_HANDLE),
  tether: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.TETHER),
  great_toll: (w) => { const E = w.enemies; for (let i = 0; i < E.count; i++) if (E.freezeT[i] > 0) return true; return false; },
  breakers: (w) => anyZone(w, (Z, z) => (Z.flags[z] & ZF.REVERSE) !== 0),
  riptide: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.MARK && Z.style[z] === MARKS.RIPTIDE),
  full_circle: (w) => anyZone(w, (Z, z) => (Z.flags[z] & ZF.SWEEP) !== 0),
  relay: (w) => w.fxLists[w.slots[0].list].some((e) => e.type === 'chain') && anyEvent(w, EV.HIT, (ev, i) => ev.d[i] === 0),
  burning_glass: (w) => { const E = w.enemies; for (let i = 0; i < E.count; i++) if (E.focusN[i] >= 2 && E.burnT[i] > 0) return true; return false; },
  slick_trail: (w) => w.slots[0].fs.trailAt > 0,
  firebomb: (w) => anyProj(w, (P, i) => (P.flags[i] & PF.CHILD) !== 0 && P.motion[i] === MOTION.arc),
  fuel_line: (w) => anyZone(w, (Z, z) => (Z.flags[z] & ZF.FLARE) !== 0) || anyEvent(w, EV.EXPLODE, (ev, i) => ev.b[i] === 0),
  planted_rod: (w) => w.slots[0].fs.rodUntil > 0,
  storm_front: (w) => anyProj(w, (P, i) => (P.flags[i] & PF.MARCH) !== 0),
  static: (w) => anyEvent(w, EV.ZAP),
  pyre: (w) => w.slots[0].fs.pyre > 0,
  wisps: null, // seen in its own test below
  vigil: null,
};

test('forms: every line has one of each kind, a known mechanic, and real weapons (a base and its evolution)', () => {
  const ids = new Set();
  for (const line of DATA.ascensions) {
    assert.deepEqual(line.options.map((o) => o.axis), FORM_AXES, `${line.line}: delivery, flight, payoff`);
    const base = DATA.weapons.find((x) => x.id === line.weapons[0]);
    assert.ok(base && !base.innate, `${line.line}: a weapon you find`);
    if (line.weapons[1]) assert.equal(base.evolution?.into, line.weapons[1], `${line.line}: its evolution`);
    for (const o of line.options) {
      assert.ok(MECHANICS.includes(o.form), `${o.id}: a mechanic sim/forms.js knows`);
      assert.ok(!ids.has(o.id), `${o.id}: once`); ids.add(o.id);
      assert.ok(o.name && o.desc, `${o.id}: named and described`);
      assert.ok(o.id in SIGNS, `${o.id}: has a sign`);
    }
  }
  assert.equal(ids.size, 24);
  // A Form's name is its own: no weapon, passive, rune, or relic shares it, or is named after it.
  const others = ['weapons', 'passives', 'runes', 'relics'].flatMap((k) => DATA[k].map((x) => x.name.toLowerCase()));
  for (const o of DATA.ascensions.flatMap((l) => l.options)) {
    const n = o.name.toLowerCase();
    assert.ok(!others.some((x) => x.includes(n) || n.includes(x)), `${o.name} is a name of its own`);
  }
  // Every weapon you can find is on a line.
  for (const wdef of DATA.weapons) if (!wdef.innate) assert.ok(lineOf(wdef.id), `${wdef.id} can take Forms`);
});

test('forms: each one does its own thing in a fight, and nothing without it does', () => {
  for (const line of DATA.ascensions) {
    for (const o of line.options) {
      const sign = SIGNS[o.id];
      if (!sign) continue;
      assert.equal(fight(armed(line.weapons[0], [o.id]), 600, sign), true, `${o.id} shows`);
      assert.equal(fight(armed(line.weapons[0], []), 600, sign), false, `${o.id}'s sign is its own`);
    }
  }
});

test('forms: every combination on every weapon of a line runs, changes the fight, and keeps the pools in bounds', () => {
  for (const line of DATA.ascensions) {
    for (const id of line.weapons) {
      const plain = armed(id, []);
      fight(plain, 360);
      const h0 = hashWorld(plain);
      for (const set of subsets(line.options.map((o) => o.id))) {
        if (!set.length) continue;
        const w = armed(id, set, { level: 8 });
        assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), set);
        fight(w, 360);
        assert.notEqual(hashWorld(w), h0, `${id} + ${set.join(', ')} changes the fight`);
        const E = w.enemies, P = w.projectiles, Z = w.zones;
        for (let i = 0; i < E.count; i++) assert.ok(Number.isFinite(E.x[i]) && Number.isFinite(E.y[i]), `${id} + ${set}: enemies stay on the map`);
        for (let i = 0; i < P.count; i++) assert.ok(Number.isFinite(P.x[i]) && Number.isFinite(P.radius[i]), `${id} + ${set}: shots`);
        assert.equal(P.refused + Z.refused, 0, `${id} + ${set}: no shot or zone turned away`);
        assert.ok(w.slots[0].fs.marks >= 0 && w.slots[0].fs.wards >= 0);
      }
    }
  }
});

test('forms: the numbers they change (Mortar\'s slower throw, Eclipse\'s one orb, Great Toll\'s one ring, Planted Rod\'s extra strikes)', () => {
  const stat = (id, forms, k) => armed(id, forms).slots[0].stats[k];
  assert.ok(Math.abs(stat('flare_gun', ['mortar'], 'cooldown') - stat('flare_gun', [], 'cooldown') * 1.3) < 1e-6);
  const orbs = stat('lantern_orb', [], 'amount');
  assert.ok(orbs >= 2);
  assert.equal(stat('lantern_orb', ['eclipse'], 'amount'), 1);
  assert.ok(stat('lantern_orb', ['eclipse'], 'damage') > stat('lantern_orb', [], 'damage') * 1.2, 'one orb hits for the lot');
  assert.equal(stat('tide_bell', ['great_toll'], 'amount'), 1);
  assert.ok(stat('tide_bell', ['great_toll'], 'radius') > stat('tide_bell', [], 'radius') * 2);
  assert.equal(stat('lightning_rod', ['planted_rod'], 'amount'), stat('lightning_rod', [], 'amount') + 2);
  assert.equal(stat('signal_mirror', ['full_circle'], 'duration'), 1);
});

test('forms: Skewer carries its first enemy and bursts it; Tether sticks in the last; Lunge throws four on a dash', () => {
  const w = armed('harpoon_chain', ['skewer', 'tether']);
  const e = spawnAt(w, 'mud_crab', 40, 0);
  const h = w.enemies.handle(e);
  let carried = false, moved = 0, burst = false;
  const x0 = w.enemies.x[e];
  for (let t = 0; t < 240 && !burst; t++) {
    stepWorld(w, { mx: 0, my: 0, buttons: 0 });
    if (anyProj(w, (P, i) => P.carry[i] === h)) { carried = true; moved = Math.max(moved, Math.abs(w.enemies.x[w.enemies.resolve(h)] - x0)); }
    if (carried && anyEvent(w, EV.EXPLODE, (ev, i) => ev.b[i] === 0)) burst = true;
  }
  assert.ok(carried, 'carried');
  assert.ok(moved > 20, 'and moved with the harpoon');
  assert.ok(burst, 'and burst at the end');
  // Not an elite.
  const w2 = armed('harpoon_chain', ['skewer']);
  const el = w2.enemies.handle(spawnAt(w2, 'drowned_bosun', 40, 0, { elite: true }));
  for (let t = 0; t < 120; t++) { stepWorld(w2, { mx: 0, my: 0, buttons: 0 }); assert.equal(anyProj(w2, (P, i) => P.carry[i] === el), false); }
  // Lunge: on the dash's first tick, four harpoons square to it.
  const l = armed('harpoon_chain', ['lunge']);
  stepWorld(l, { mx: 80, my: 0, buttons: 0 });
  stepWorld(l, { mx: 80, my: 0, buttons: BTN_DASH });
  assert.ok(anyEvent(l, EV.FIRE, (ev, i) => ev.b[i] === 4));
});

test('forms: Pyre gathers and erupts; Wisps lure; Vigil leaves a flame where a kill fell', () => {
  const w = armed('corpse_candles', ['pyre']);
  const hold = formOf('pyre').hold;
  let most = 0, erupted = false;
  for (let t = 0; t < 1200 && !erupted; t++) {
    stepWorld(w, { mx: 0, my: 0, buttons: 0 });
    most = Math.max(most, w.slots[0].fs.pyre);
    if (anyEvent(w, EV.FIRE, (ev, i) => ev.a[i] === 0) && most > 0 && w.slots[0].fs.pyre === 0) erupted = anyProj(w, () => true);
  }
  assert.ok(most > 0 && most < hold + 1, 'gathers up to its hold');
  assert.ok(erupted, 'and lets them all go');
  // Wisps: an enemy near a flame is drawn to it, away from you.
  const pull = (forms) => {
    const x = armed('corpse_candles', forms);
    for (let t = 0; t < 90; t++) stepWorld(x, { mx: 0, my: 0, buttons: 0 });
    const e = spawnAt(x, 'mud_crab', 120, 0);
    const d0 = Math.hypot(x.enemies.x[e] - x.player.x, x.enemies.y[e] - x.player.y);
    for (let t = 0; t < 60; t++) stepWorld(x, { mx: 0, my: 0, buttons: 0 });
    const i = x.enemies.resolve(x.enemies.handle(e));
    return i < 0 ? 0 : d0 - Math.hypot(x.enemies.x[i] - x.player.x, x.enemies.y[i] - x.player.y);
  };
  assert.notEqual(pull(['wisps']), pull([]), 'wisps change how enemies come at you');
  // Vigil: more flames out after kills than without it.
  const flames = (forms) => { const x = armed('corpse_candles', forms, { level: 8 }); let most2 = 0; fight(x, 600, (y) => { let n = 0; anyProj(y, () => { n++; return false; }); most2 = Math.max(most2, n); return false; }); return most2; };
  assert.ok(flames(['vigil']) > flames([]), 'kills leave flames');
});

test('forms: Burning Glass sets fire that grows on an enemy the beam keeps finding and starts over after a gap; Fuel Line sets linked pools off', () => {
  const w = armed('signal_mirror', ['burning_glass']);
  const f = formOf('burning_glass');
  const e = spawnAt(w, 'lantern_eater', 30, 0);
  const steps = [];
  const E = w.enemies;
  // focusMul directly: each hit within `hold` adds a step, up to max.
  E.focusT[e] = -1000; E.focusN[e] = 0;
  {
    for (let k = 0; k < 14; k++) { steps.push(focusMul(w, f, e)); w.tick += 6; }
    assert.equal(steps[0], 1);
    assert.ok(Math.abs(steps[1] - (1 + f.per)) < 1e-6);
    assert.ok(Math.abs(steps.at(-1) - (1 + f.max)) < 1e-6, 'up to its most');
    w.tick += Math.round(f.hold * 60) + 2;
    assert.equal(focusMul(w, f, e), 1, 'a gap starts it over');
    // What it leaves: fire, at its share of the hit, hotter with each find (the hottest burn holds).
    const fx = w.fxLists[w.slots[0].list].find((x) => x.type === 'focus');
    assert.ok(fx, 'on the beam\'s own list');
    assert.ok(!w.fxLists[w.slots[0].childList].some((x) => x.type === 'focus'), 'not on its hops or pools');
    E.focusT[e] = -1000; E.burnDps[e] = 0;
    focusBurn(w, w.slots[0], fx, e, 10);
    assert.ok(Math.abs(E.burnDps[e] - 10 * f.burn) < 1e-6 && E.burnT[e] === f.duration);
    w.tick += 6; focusBurn(w, w.slots[0], fx, e, 10);
    assert.ok(Math.abs(E.burnDps[e] - 10 * f.burn * (1 + f.per)) < 1e-6, 'hotter');
    // Fuel Line: two touching pools and a third apart; a new pool touching the first sets off both.
    const o = armed('oil_flask', ['fuel_line']);
    const Z = o.zones;
    const pool = (x) => { const z = Z.alloc(); Z.kind[z] = ZONE.GROUND; Z.slot[z] = 0; Z.x[z] = x; Z.y[z] = 0; Z.radius[z] = 20; Z.life[z] = 2; Z.nextTick[z] = 1e9; return z; };
    const a = pool(0), b = pool(30), far = pool(300), n = pool(-25);
    assert.equal(fuelLink(o, o.slots[0], n), 3);
    for (const z of [a, b, n]) assert.ok((Z.flags[z] & ZF.FLARE) !== 0 && Z.nextTick[z] === o.tick);
    assert.equal(Z.flags[far] & ZF.FLARE, 0, 'not the one apart');
  }
});

test('forms and runes: a rune that would undo a Form is refused, and a Form a rune would undo is not offered', () => {
  const R = (id) => DATA.runes.find((r) => r.id === id);
  const def = (id) => DATA.weapons.find((x) => x.id === id);
  // Orbiting turns shots into orbits: no Skewer, Mortar, Salvo, or Lunge under it.
  for (const [wid, f] of [['harpoon_chain', 'skewer'], ['flare_gun', 'mortar'], ['flare_gun', 'salvo'], ['harpoon_chain', 'lunge']]) {
    assert.equal(runeFits(R('orbiting'), def(wid), [null, null], [formOf(f)]), false, `Orbiting under ${f}`);
    const w = armed(wid, [], { runes: ['orbiting'] });
    assert.ok(!openAscensions(w, 0).some((o) => o.id === f), `${f} not offered on an orbiting ${wid}`);
  }
  // The rest of the line still is, and a rune that keeps the Form working still fits.
  assert.ok(openAscensions(armed('harpoon_chain', [], { runes: ['orbiting'] }), 0).some((o) => o.id === 'tether'));
  assert.equal(runeFits(R('splitting'), def('flare_gun'), [null, null], [formOf('mortar'), formOf('salvo')]), true);
  // Firebomb needs a flask that's lobbed.
  assert.equal(formOf('firebomb').needs.motion[0], 'arc');
  assert.ok(openAscensions(armed('oil_flask'), 0).some((o) => o.id === 'firebomb'));
  // A Form and runes together: Splitting on a lobbed flare's direct hits, Backfire with a Salvo, a Hanging Flare where it bursts.
  const w = armed('flare_gun', ['mortar', 'salvo', 'hanging_flare'], { runes: ['splitting', 'backfire'] });
  assert.equal(w.slots[0].motion.type, 'arc');
  fight(w, 300);
  assert.ok(w.result.damageBySlot[0] > 0);
});

test('forms: Great Toll\'s kills bring the next ring sooner, but never sooner than half its wait', () => {
  const w = armed('storm_bell', ['great_toll'], { level: 8 });
  const s = w.slots[0], f = formOf('great_toll');
  const rings = [];
  for (let t = 0; t < 1800; t++) {
    if (t % 10 === 0) for (let k = 0; k < 30; k++) spawnAt(w, 'bilge_rat', Math.cos(k) * (30 + k), Math.sin(k) * (30 + k));
    stepWorld(w, { mx: 0, my: 0, buttons: 0 });
    while (w.halts.length) w.halts.shift();
    if (anyEvent(w, EV.FIRE, (ev, i) => ev.a[i] === 0)) rings.push(w.tick);
  }
  assert.ok(rings.length >= 3, 'it rang');
  const gaps = rings.slice(1).map((t, k) => t - rings[k]);
  const floor = Math.floor(s.stats.cooldown * (1 - f.maxCut) * 60) - 1;
  assert.ok(Math.min(...gaps) >= floor, `every ring waits at least ${floor} ticks (${gaps.join(', ')})`);
  assert.ok(Math.min(...gaps) < Math.round(s.stats.cooldown * 60) - 30, 'and kills did bring some sooner');
});

test('forms: every Form keeps working with every rune that fits beside it', () => {
  const R = (id) => DATA.runes.find((r) => r.id === id);
  for (const line of DATA.ascensions) {
    const def = DATA.weapons.find((x) => x.id === line.weapons[0]);
    for (const o of line.options) {
      const sign = SIGNS[o.id];
      if (!sign) continue;
      for (const rune of DATA.runes) {
        if (!runeFits(rune, def, new Array(def.runeSlots || 1).fill(null), [o])) continue;
        const w = armed(line.weapons[0], [o.id], { runes: [rune.id] });
        assert.equal(fight(w, 900, sign), true, `${o.id} with ${rune.id}`);
      }
    }
  }
  void R;
});

test('forms: Tether sticks where a killing harpoon\'s target fell, and an Orbiting harpoon\'s ring tethers as it\'s replaced', () => {
  const w = armed('harpoon_chain', ['tether']);
  spawnAt(w, 'fog_wisp', 40, 0);
  let stuck = false;
  for (let t = 0; t < 300 && !stuck; t++) { stepWorld(w, { mx: 0, my: 0, buttons: 0 }); stuck = anyZone(w, (Z, z) => Z.kind[z] === ZONE.TETHER); }
  assert.ok(stuck, 'a 5 HP wisp dies to the hit, and the tether still sticks');
  const o = armed('harpoon_chain', ['tether'], { runes: ['orbiting'] });
  assert.equal(fight(o, 900, SIGNS.tether), true);
});

test('forms: Wards come from the orb\'s own kills, Hanging Flares from the flare\'s own hits, Salvo counts shots, Pyre keeps every flame', () => {
  // A ward's pulse that kills makes no ward; an orb's kill does.
  const w = armed('lantern_orb', ['wards']);
  const s = w.slots[0];
  const e = spawnAt(w, 'fog_wisp', 200, 0);
  w.enemies.hp[e] = 0.001;
  w.zonePulse = 1; w.scratch.num[0] = 1; damageEnemyR(w, e, 0, false); w.zonePulse = 0;
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(s.fs.wards, 0, 'a pulse\'s kill leaves no ward');
  const e2 = spawnAt(w, 'fog_wisp', 200, 40);
  w.enemies.hp[e2] = 0.001;
  w.scratch.num[0] = 1; damageEnemyR(w, e2, 0, false);
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(s.fs.wards, 1, 'its own kill does');
  // Hanging Flare is the flare's own: a hop or a split doesn't hang one.
  const h = armed('flare_gun', ['hanging_flare']);
  assert.ok(!h.fxLists[h.slots[0].childList].some((x) => x.type === 'hang'));
  // Salvo: the Flare Barrage's 3-shot volleys ring every 4th shot, not every 4th volley.
  const b = armed('flare_barrage', ['salvo'], { level: 8 });
  const ring = formOf('salvo').count;
  let shots = 0, rings = 0;
  fight(b, 900, (x) => {
    const ev = x.events;
    for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.FIRE && ev.a[i] === 0) { if (ev.b[i] === ring) rings++; else shots += ev.b[i]; }
    return false;
  });
  assert.ok(Math.round(b.slots[0].stats.amount) >= 2 && shots >= 12);
  assert.equal(rings, Math.floor(shots / formOf('salvo').every), `${shots} shots: a ring each 4`);
  // Pyre: a volley that overfills it erupts everything gathered.
  const p = armed('corpse_candles', ['pyre']);
  p.slots[0].fs.pyre = formOf('pyre').hold - 1;
  const before = p.projectiles.count;
  assert.equal(stokePyre(p, p.slots[0], 3), formOf('pyre').hold + 2);
  assert.equal(p.projectiles.count - before, formOf('pyre').hold + 2);
});
