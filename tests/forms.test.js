// Forms (sim/forms.js, data/ascensions.js; ruling 14, C1: three axes, two options on each, one held
// an axis): what each does, that a weapon's options combine, and (ruling 16) that nothing fires from
// the dash. (Choosing them, deeds, and Embers: tests/ascend.test.js. Every option changing what its
// weapon does, and every line's and special's run: tests/content.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { stepWorld, hashWorld } from '../src/sim/world.js';
import { focusMul, fuelLink, focusBurn, stokePyre, FORM_KEYS } from '../src/sim/forms.js';
import { damageEnemyR } from '../src/sim/enemies.js';
import { FORM_AXES } from '../src/data/ascensions.js';
import { SIGNATURE_MECHANICS } from '../src/data/signature-forms.js';
import { EV } from '../src/sim/events.js';
import { EF, PF, MOTION, ZONE, ZF, ZSTYLE, MARKS } from '../src/sim/constants.js';
import { NO_HANDLE } from '../src/sim/pools.js';
import { BTN_DASH } from '../src/lib/inputframe.js';
import { makeWorld, give, spawnAt } from './helpers/simworld.js';

// The lines of the weapons you find (a signature weapon's are C2's: tests/characters.test.js).
const FIND_LINES = DATA.ascensions.filter((l) => !DATA.weapons.find((w) => w.id === l.line)?.signature);
const lineOf = (id) => DATA.ascensions.find((l) => l.weapons.includes(id));
const formOf = (id) => DATA.ascensions.flatMap((l) => l.options).find((o) => o.id === id);
const fxOf = (id, k) => formOf(id).boost.fx[k];

/** A world with one weapon (by id) at a level, holding these Form options (ids). */
function armed(id, forms = [], { level = 4, seed = 1, ups = null, specials = [] } = {}) {
  const w = makeWorld({ invulnerable: true, seed });
  give(w, id, { level, ups, forms, specials, slot: 0 });
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

// Each option's own mark on a fight: something only it does.
const freezes = (w) => { const E = w.enemies; for (let i = 0; i < E.count; i++) if (E.freezeT[i] > 0) return true; return false; };
const SIGNS = {
  salvo: (w) => anyEvent(w, EV.FIRE, (ev, i) => ev.a[i] === 0 && ev.b[i] === fxOf('salvo', 'salvo').count),
  mortar: (w) => anyProj(w, (P, i) => P.motion[i] === MOTION.arc),
  hanging_flare: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.GROUND && Z.style[z] === ZSTYLE.FLARE),
  eclipse: (w) => w.slots[0].fs.growth > 0 && anyProj(w, (P, i) => P.scale[i] >= 2),
  hunting_lights: (w) => anyProj(w, (P, i) => P.motion[i] === MOTION.homing),
  wards: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.GROUND && Z.style[z] === ZSTYLE.WARD),
  lunge: (w) => anyEvent(w, EV.FIRE, (ev, i) => ev.a[i] === 0 && ev.b[i] === fxOf('lunge', 'lunge').count),
  skewer: (w) => anyProj(w, (P, i) => P.carry[i] !== NO_HANDLE),
  tether: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.TETHER),
  great_toll: freezes,
  breakers: (w) => anyZone(w, (Z, z) => (Z.flags[z] & ZF.REVERSE) !== 0),
  riptide: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.MARK && Z.style[z] === MARKS.RIPTIDE),
  full_circle: (w) => anyZone(w, (Z, z) => (Z.flags[z] & ZF.SWEEP) !== 0),
  burning_glass: (w) => { const E = w.enemies; for (let i = 0; i < E.count; i++) if (E.focusN[i] >= 1 && E.burnT[i] > 0) return true; return false; },
  slick_trail: (w) => w.slots[0].fs.trailAt > 0,
  firebomb: (w) => anyProj(w, (P, i) => (P.flags[i] & PF.CHILD) !== 0 && P.motion[i] === MOTION.arc),
  fuel_line: (w) => anyZone(w, (Z, z) => (Z.flags[z] & ZF.FLARE) !== 0) || anyEvent(w, EV.EXPLODE, (ev, i) => ev.b[i] === 0),
  storm_front: (w) => anyProj(w, (P, i) => (P.flags[i] & PF.MARCH) !== 0),
  static: (w) => anyEvent(w, EV.ZAP),
  pyre: (w) => w.slots[0].fs.pyre > 0,
  creeping_brine: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.PUDDLE && (Z.flags[z] & ZF.DRIFT) !== 0),
  rime: freezes,
  starburst: (w) => anyEvent(w, EV.FIRE, (ev, i) => ev.a[i] === 0 && ev.b[i] === fxOf('starburst', 'salvo').count),
  glass_spikes: (w) => anyZone(w, (Z, z) => Z.kind[z] === ZONE.SPIKE),
  conger: (w) => { const E = w.enemies; for (let i = 0; i < E.count; i++) if (E.dazeT[i] > 0) return true; return false; },
  shatterfield: (w) => anyEvent(w, EV.EXPLODE, (ev, i) => ev.b[i] === 0),
};

test('forms: every line has an option on each axis, known mechanics, a real weapon, and names of its own', () => {
  const ids = new Set();
  for (const line of DATA.ascensions) {
    const base = DATA.weapons.find((x) => x.id === line.weapons[0]);
    assert.ok(base && !base.innate, `${line.line}: a weapon you find or a character's own`);
    assert.deepEqual(line.weapons, [line.line], `${line.line}: one weapon (nothing evolves)`);
    for (const ax of FORM_AXES) assert.ok(line.options.some((o) => o.axis === ax), `${line.line}: an option on ${ax}`);
    for (const o of line.options) {
      assert.equal(!!o.capstone, o.axis === 'payoff', `${o.id}: the capstone axis's options are capstones`);
      for (const k of Object.keys(o.boost?.fx || {})) assert.ok(FORM_KEYS.includes(k) || SIGNATURE_MECHANICS.includes(k), `${o.id}: mechanic ${k}`);
      if (o.form) assert.ok(SIGNATURE_MECHANICS.includes(o.form) || FORM_KEYS.includes(o.form), `${o.id}: a mechanic the sim or its character's hook knows`);
      assert.ok(!ids.has(o.id), `${o.id}: once`); ids.add(o.id);
      assert.ok(o.name && o.desc, `${o.id}: named and described`);
    }
  }
  // A Form's name is its own: no weapon, passive, or relic is called the same.
  const others = ['weapons', 'passives', 'relics'].flatMap((k) => DATA[k].map((x) => x.name.toLowerCase()));
  for (const o of DATA.ascensions.flatMap((l) => l.options)) assert.ok(!others.includes(o.name.toLowerCase()), `${o.name} is a name of its own`);
  for (const wdef of DATA.weapons) if (!wdef.innate) assert.ok(lineOf(wdef.id), `${wdef.id} can take Forms`);
  for (const [id, r] of Object.entries(DATA.retiredWeapons)) {
    assert.ok(!DATA.weapons.some((x) => x.id === id), `${id} is retired`);
    assert.ok(lineOf(r.weapon)?.options.find((o) => o.id === r.form)?.capstone, `${id}: ${r.weapon}'s capstone`);
  }
});

test('forms: each one does its own thing in a fight, and nothing without it does', () => {
  for (const line of FIND_LINES) {
    for (const o of line.options) {
      const sign = SIGNS[o.id];
      if (!sign) continue;
      assert.equal(fight(armed(line.weapons[0], [o.id]), 600, sign), true, `${o.id} shows`);
      assert.equal(fight(armed(line.weapons[0], []), 600, sign), false, `${o.id}'s sign is its own`);
    }
  }
});

test('forms: every full set a weapon can hold (one option an axis) runs, changes the fight, and keeps the pools in bounds', () => {
  for (const line of FIND_LINES) {
    const id = line.weapons[0];
    const plain = armed(id, []);
    fight(plain, 300);
    const h0 = hashWorld(plain);
    const by = (ax) => line.options.filter((o) => o.axis === ax).map((o) => o.id);
    for (const d of by('delivery')) for (const f of by('flight')) for (const c of by('payoff')) {
      const set = [d, f, c];
      const w = armed(id, set, { level: 8 });
      assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), set);
      fight(w, 300);
      assert.notEqual(hashWorld(w), h0, `${id} + ${set.join(', ')} changes the fight`);
      const E = w.enemies, P = w.projectiles, Z = w.zones;
      for (let i = 0; i < E.count; i++) assert.ok(Number.isFinite(E.x[i]) && Number.isFinite(E.y[i]), `${id} + ${set}: enemies stay on the map`);
      for (let i = 0; i < P.count; i++) assert.ok(Number.isFinite(P.x[i]) && Number.isFinite(P.radius[i]), `${id} + ${set}: shots`);
      assert.equal(P.refused + Z.refused, 0, `${id} + ${set}: no shot or zone turned away`);
    }
  }
});

test('forms: the numbers they change (Mortar\'s slower throw, Eclipse\'s one orb, Great Toll\'s one ring, Star Shell\'s pierce)', () => {
  const stat = (id, forms, k) => armed(id, forms).slots[0].stats[k];
  assert.ok(Math.abs(stat('flare_gun', ['mortar'], 'cooldown') - stat('flare_gun', [], 'cooldown') * 1.25) < 1e-6, 'its price, as stated');
  assert.equal(stat('flare_gun', ['star_shell'], 'pierce'), 3);   // (ruling 18 WA: 8 made the Flare Gun's B trio)
  assert.ok(stat('lantern_orb', [], 'amount') >= 2);
  assert.equal(stat('lantern_orb', ['eclipse'], 'amount'), 1);
  assert.equal(stat('tide_bell', ['great_toll'], 'amount'), 1);
  assert.ok(Math.abs(stat('tide_bell', ['great_toll'], 'radius') - stat('tide_bell', [], 'radius') * fxOf('great_toll', 'toll').areaMul) < 1e-6, 'one ring, wider');
  assert.equal(stat('signal_mirror', ['full_circle'], 'duration'), 1);
});

test('forms: Skewer carries its first enemy and bursts it; Tether sticks in the last; Lunge throws its count while you keep moving, on its own clock', () => {
  const w = armed('harpoon_chain', ['skewer', 'tether']);
  const e = spawnAt(w, 'mud_crab', 40, 0);
  w.enemies.hp[e] = w.enemies.maxHp[e] = 1e4;   // (0.9.0's harpoon hits hard: it lives to be carried)
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
  // Lunge (ruling 16: not on a dash): while you keep moving, its harpoons evenly around you, once each `every` seconds.
  const l = armed('harpoon_chain', ['lunge']);
  const L = fxOf('lunge', 'lunge');
  const at = [];
  for (let t = 0; t < 600; t++) { stepWorld(l, { mx: 80, my: 0, buttons: 0 }); if (anyEvent(l, EV.FIRE, (ev, i) => ev.a[i] === 0 && ev.b[i] === L.count)) at.push(l.tick); }
  assert.ok(at.length >= 3, `it threw: ${at}`);
  assert.ok(at.slice(1).every((t, k) => t - at[k] >= Math.round(L.every * 60)), 'never sooner than its clock');
});

test('forms: Pyre gathers and erupts; Wisps lure; Vigil leaves a flame where a kill fell', () => {
  const w = armed('corpse_candles', ['pyre']);
  const hold = fxOf('pyre', 'pyre').hold;
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
    // (0.7.3: the flames fly and hit 1.8x harder, so by 1.5 s they're farther out, and the crab
    // has to live to be lured.)
    const e = spawnAt(x, 'mud_crab', 160, 0);
    x.enemies.hp[e] = x.enemies.maxHp[e] = 1e6;
    const d0 = Math.hypot(x.enemies.x[e] - x.player.x, x.enemies.y[e] - x.player.y);
    for (let t = 0; t < 60; t++) stepWorld(x, { mx: 0, my: 0, buttons: 0 });
    const i = x.enemies.resolve(x.enemies.handle(e));
    return i < 0 ? 0 : d0 - Math.hypot(x.enemies.x[i] - x.player.x, x.enemies.y[i] - x.player.y);
  };
  assert.ok(pull(['wisps']) < pull([]), 'wisps hold enemies back from you');
  // Vigil: more flames out after kills than without it.
  const flames = (forms) => { const x = armed('corpse_candles', forms, { level: 8 }); let most2 = 0; fight(x, 600, (y) => { let n = 0; anyProj(y, () => { n++; return false; }); most2 = Math.max(most2, n); return false; }); return most2; };
  assert.ok(flames(['vigil']) > flames([]), 'kills leave flames');
});

test('forms: Burning Glass sets fire that grows on an enemy the beam keeps finding and starts over after a gap; Fuel Line sets linked pools off', () => {
  const w = armed('signal_mirror', ['burning_glass']);
  const f = fxOf('burning_glass', 'focus');
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
    // Fuel Line: two touching pools and a third apart; a new pool touching the first sets off its
    // nearest links, as many as the option's `max` (C1b, Nov 20: 1), never the one apart.
    const o = armed('oil_flask', ['fuel_line']);
    const Z = o.zones, max = fxOf('fuel_line', 'fuel').max;
    const pool = (x) => { const z = Z.alloc(); Z.kind[z] = ZONE.GROUND; Z.slot[z] = 0; Z.x[z] = x; Z.y[z] = 0; Z.radius[z] = 20; Z.life[z] = 2; Z.nextTick[z] = 1e9; return z; };
    const a = pool(0), b = pool(30), far = pool(300), n = pool(-25);
    assert.equal(fuelLink(o, o.slots[0], n), 1 + Math.min(2, max));
    for (const z of [n, a, b].slice(0, 1 + Math.min(2, max))) assert.ok((Z.flags[z] & ZF.FLARE) !== 0 && Z.nextTick[z] === o.tick);
    if (max < 2) assert.equal(Z.flags[b] & ZF.FLARE, 0, 'past its max');
    assert.equal(Z.flags[far] & ZF.FLARE, 0, 'not the one apart');
  }
});

test('forms: Great Toll\'s kills bring the next ring sooner, but never sooner than half its wait', () => {
  const w = armed('tide_bell', ['great_toll'], { level: 8 });
  const s = w.slots[0], f = fxOf('great_toll', 'toll');
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

test('forms: Tether sticks where a killing harpoon\'s target fell', () => {
  const w = armed('harpoon_chain', ['tether']);
  spawnAt(w, 'fog_wisp', 40, 0);
  let stuck = false;
  for (let t = 0; t < 300 && !stuck; t++) { stepWorld(w, { mx: 0, my: 0, buttons: 0 }); stuck = anyZone(w, (Z, z) => Z.kind[z] === ZONE.TETHER); }
  assert.ok(stuck, 'a 5 HP wisp dies to the hit, and the tether still sticks');
});

test('ruling 16: the dash fires nothing; what fired from it fires from walking, standing still, or its own clock', () => {
  // Each piece that once read the dash: the same back-and-forth walk with and without dashing.
  // Dashing moves you farther, so the fight differs a little; what can't happen is a burst of
  // shots or ground from the dash itself.
  const pieces = [['harpoon_chain', ['lunge'], []], ['lightning_rod', ['ground_rod'], []], ['anchor_chain', ['cast_anchor'], []], ['glass_caltrops', ['kicked_glass'], []],
    ['flare_gun', [], ['parting_shot']], ['oil_flask', [], ['wake_of_fire']], ['ice_picks', [], ['cold_snap']], ['eel_pot', [], ['chum']]];
  for (const [id, forms, specials] of pieces) {
    const runWith = (dash) => {
      const w = armed(id, forms, { specials });
      for (let k = 0; k < 6; k++) { const e = spawnAt(w, 'mud_crab', 30 + k * 12, (k % 3) * 15 - 15); w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; }
      let made = 0;
      for (let t = 0; t < 400; t++) {
        stepWorld(w, { mx: t % 20 < 10 ? 127 : -127, my: 0, buttons: dash && t % 20 === 0 ? BTN_DASH : 0 });
        for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.FIRE && w.events.a[i] === 0) made += w.events.b[i];
      }
      return made;
    };
    const plain = runWith(false), dashing = runWith(true);
    assert.ok(dashing <= plain * 1.5 + 4, `${id} ${[...forms, ...specials]}: ${plain} shots walking, ${dashing} dashing`);
  }
  // Ground Rod plants where you stand still a second, not where a dash lands.
  const r = armed('lightning_rod', ['ground_rod']);
  for (let t = 0; t < 30; t++) stepWorld(r, { mx: 127, my: 0, buttons: t === 10 ? BTN_DASH : 0 });
  for (let t = 0; t < 90; t++) stepWorld(r, { mx: 0, my: 0, buttons: 0 });
  assert.ok(Math.abs(r.slots[0].fs.rodX - r.player.x) < 1 && Math.abs(r.slots[0].fs.rodY - r.player.y) < 1, 'planted where you stood');
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
  // Salvo: a maxed Flare Gun's 4-shot volleys ring every 8th shot, not every 8th volley.
  // (Ruling 10: three projectile upgrades and nothing else, so its volleys are 4 shots at its own pace.)
  const b = armed('flare_gun', ['salvo'], { ups: [1, 2, 3].map(() => ({ up: 'amount', rarity: 'rare', value: 1 })) });
  const ring = fxOf('salvo', 'salvo').count;
  let shots = 0, rings = 0;
  fight(b, 900, (x) => {
    const ev = x.events;
    for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.FIRE && ev.a[i] === 0) { if (ev.b[i] === ring) rings++; else shots += ev.b[i]; }
    return false;
  });
  assert.ok(Math.round(b.slots[0].stats.amount) >= 2 && shots >= 12);
  assert.equal(rings, Math.floor(shots / fxOf('salvo', 'salvo').every), `${shots} shots: a ring each ${fxOf('salvo', 'salvo').every}`);
  // Pyre: a volley that overfills it erupts everything gathered.
  const p = armed('corpse_candles', ['pyre']);
  p.slots[0].fs.pyre = fxOf('pyre', 'pyre').hold - 1;
  const before = p.projectiles.count;
  assert.equal(stokePyre(p, p.slots[0], 3), fxOf('pyre', 'pyre').hold + 2);
  assert.equal(p.projectiles.count - before, fxOf('pyre', 'pyre').hold + 2);
});

test('forms: Well-Trodden: glass walked back over is fresh again and sharper', () => {
  const w = armed('glass_caltrops', [], { specials: ['well_trodden'] });
  const base = w.slots[0].stats.damage;
  for (let t = 0; t < 90; t++) stepWorld(w, { mx: 60, my: 0, buttons: 0 });
  for (let t = 0; t < 90; t++) stepWorld(w, { mx: -60, my: 0, buttons: 0 });
  assert.ok(anyProj(w, (P, i) => P.damage[i] > base * 1.2), 'some glass is sharper');
});
