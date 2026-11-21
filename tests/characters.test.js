// The six characters (ruling 14 section D, ruling 15, ruling 16; work/cw/C2-DESIGN.md v2): a
// signature weapon in slot 0 that grows on its own track, a trade that fires on its own (never from
// the dash), a cost, a starting dash item, and a skill tree whose refunds each have a clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createWorld, stepWorld, hashWorld, decide, currentHalt } from '../src/sim/world.js';
import { createKiteBot } from '../src/sim/bot.js';
import { spawnEnemy } from '../src/sim/enemies.js';
import { HOOKS, HOOK_POINTS } from '../src/sim/hooks.js';
import { CHARACTER_HOOKS } from '../src/sim/hooks-characters.js';
import { tradeDeed, trackState, purseNeed, TRADE } from '../src/sim/trades.js';
import { EF, EF_GONE } from '../src/sim/constants.js';
import { EV } from '../src/sim/events.js';
import { readFileSync } from 'node:fs';
import { fillText } from '../src/data/textnum.js';
import { raiseThrallAt, biteAt } from '../src/sim/allies.js';

const IDLE = Object.freeze({ mx: 0, my: 0, buttons: 0 });
const RIGHT = Object.freeze({ mx: 127, my: 0, buttons: 0 });
const TPS = 60;
const C = (id) => DATA.characters.find((c) => c.id === id);
const skillP = (id) => DATA.skills.find((s) => s.id === id).p;

/** An open field with nothing spawning, as `character`, unhurtable (the tests place what they need). */
function field(character, { skills = [], seed = 3 } = {}) {
  const map = {
    id: 'c2_field', name: 'Field', desc: 'For tests.', size: [128, 128], ambient: 0.5, layout: { kind: 'open' },
    materials: [], commonDrops: [], eliteDrops: [], pickups: null,
    timeline: { bands: [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [0, 0] }], events: [] },
    overtime: { densityPerMin: 1.12, hpPerMin: 1.15, materialsPerMin: 1.1 }, secrets: [],
  };
  const sk = Object.fromEntries(skills.map((id) => [id, skillP(id)]));
  return createWorld({
    seed, map: 'c2_field', character, invulnerable: true, skills: sk,
    tuning: { pace: { density: 1, maxAlive: 3000, speed: 1, hp: 1, contact: 1, xp: 1, drops: 1, events: 1 }, affixes: { perElite: 0, twoFromTide: 99 }, threat: { max: 1 } },
  }, { ...DATA, maps: [...DATA.maps, map] });
}
const hookOf = (w) => w.hookEntries.find((e) => e.source === `character:${w.character.id}`);
const run = (w, n, frame = IDLE) => { for (let i = 0; i < n; i++) stepWorld(w, frame); };
const spawn = (w, id, dx, dy) => spawnEnemy(w, w.enemyIndex.get(id), w.player.x + dx, w.player.y + dy, null);

test('characters: six, each with a signature in slot 0, a trade, a cost, a starting dash item, and a tree of 13', () => {
  assert.equal(DATA.characters.length, 6);
  for (const c of DATA.characters) {
    const w = field(c.id);
    assert.equal(w.slots[0].def.id, c.signature, `${c.id}: the signature in slot 0`);
    assert.ok(w.slots[0].def.signature === c.id && w.slots[0].def.unlock === 'innate', `${c.id}: never in a pool`);
    assert.ok(w.trade && w.sigTrack, `${c.id}: a trade, and the signature on its own track`);
    assert.ok(c.who && c.desc && c.gives && c.costs, `${c.id}: who, what, and what it costs`);
    for (const line of [c.who, c.desc, c.gives, c.costs]) assert.doesNotMatch(line, /\d+ ?px|\bpx\b|\bdash\b/i, `${c.id}: no pixels, and the dash is nobody's trade: ${line}`);
    assert.ok(DATA.dashes.some((d) => d.character === c.id), `${c.id}: a starting dash item`);
    assert.equal(w.dash.def.character, c.id, `${c.id}: the run starts with it`);
    const tree = DATA.skills.filter((s) => s.character === c.id);
    assert.equal(tree.length, 13, `${c.id}: 13 skills`);
    assert.equal(tree.filter((s) => s.rival).length, 6, `${c.id}: three forks`);
    assert.equal(tree.filter((s) => s.unlock).length, 2, `${c.id}: two by orders`);
    for (const s of tree) if (s.rival) assert.equal(DATA.skills.find((x) => x.id === s.rival).rival, s.id, `${s.id}: its fork is written both ways`);
  }
});

test('ruling 16: nothing of the characters fires from the dash, and no skill touches it', () => {
  assert.ok(!HOOK_POINTS.includes('onDash'));
  for (const [id, h] of Object.entries(CHARACTER_HOOKS)) {
    assert.equal(h.onDash, undefined, `${id}: no onDash`);
    assert.equal(HOOKS[id], h, `${id}: joined to the registry`);
    for (const fn of Object.values(h)) if (typeof fn === 'function') assert.doesNotMatch(String(fn), /dashCd|dashMul|noDash|dashTicks|dashDx|dashCharges/, `${id}: reads nothing of the dash`);
  }
  for (const s of DATA.skills) assert.doesNotMatch(s.desc, /\bdash/i, `${s.id}: ${s.desc}`);
  for (const w of DATA.weapons.filter((x) => x.signature)) for (const x of [...w.lines, ...w.specials]) assert.doesNotMatch(x.desc, /\bdash/i, `${x.id}`);
  for (const l of DATA.ascensions.filter((x) => DATA.weapons.find((w) => w.id === x.weapons[0])?.signature)) for (const o of l.options) assert.doesNotMatch(`${o.desc} ${o.price}`, /\bdash/i, o.id);
});

test('the track: an upgrade from the clock, and trade upgrades never closer than the gap at any kill rate', () => {
  const w = field('lamplighter');
  const P = w.trade.P;
  hookOf(w).params = { ...hookOf(w).params, darkEvery: 1e9 };   // (ruling 21 KE: no lanterns from the dark in this test, so only the clock moves the track)
  run(w, Math.round(P.clock * TPS) + 1);
  assert.equal(trackState(w).level, 2, 'the clock\'s first upgrade');
  const before = w.trade.s.sigN;
  tradeDeed(w, P.per * 50);   // fifty upgrades' worth of deeds at once
  assert.equal(w.trade.s.sigN, before + 1, 'one now, the rest banked');
  run(w, Math.round(P.gap * TPS) - 2);
  assert.equal(w.trade.s.sigN, before + 1, 'none inside the gap');
  run(w, 4);
  assert.equal(w.trade.s.sigN, before + 2, 'the next when the gap has passed');
});

test('Lamplighter (ruling 19 KJ): her spare flames widen and heat her light; standing sets a lantern only with Great Lamp; a lit lamp leaves one', () => {
  const w = field('lamplighter');
  const h = hookOf(w), lamp = () => w.slots.find((x) => x && x.def && x.def.id === 'lamplight').stats;
  h.state.flames = 0; w.statsDirty = true; run(w, 2);
  const a0 = lamp().area, d0 = lamp().damage;
  h.state.flames = 2; w.statsDirty = true; run(w, 2);
  const FP = C('lamplighter').mechanic.params;   // (Ruling 24: read the rule's numbers, not a copy of them)
  assert.ok(Math.abs(lamp().area / a0 - (1 + 2 * (h.state.mv === 1 ? FP.flameMoveArea : FP.flameArea))) < 0.01 && Math.abs(lamp().damage / d0 - (1 + 2 * FP.flameMight)) < 0.01, `two flames: area ${a0} -> ${lamp().area}, damage ${d0} -> ${lamp().damage}`);
  run(w, 2 * TPS, RIGHT); run(w, 2 * TPS);
  assert.equal(h.state.planted, 0, 'without Great Lamp, standing sets none');
  assert.equal(h.state.flames, 2);
  // A lamp lit: a lantern by it, no flame spent.
  w.result.lampsLit++; run(w, 2);
  assert.equal(h.state.planted, 1, 'a lantern at the lamp');
  // Great Lamp: standing still with a flame sets one down, spending it.
  const g = field('lamplighter', { skills: ['great_lamp'] }), gh = hookOf(g);
  gh.state.flames = 2;
  run(g, 2 * TPS, RIGHT);
  assert.equal(gh.state.planted, 0, 'walking sets none');
  run(g, 2 * TPS);
  assert.equal(gh.state.planted, 1, 'one after standing a second');
  assert.equal(gh.state.flames, 1);
});

test('Harpooner: the hook throws itself the way she faces, on its clock, and lands an elite', () => {
  const w = field('harpooner');
  // An elite close behind her, and one farther off ahead: the hook takes what she faces.
  const back = spawn(w, 'drowned_sailor', -130, 0), ahead = spawn(w, 'drowned_sailor', 180, 0);
  w.enemies.flags[back] |= EF.ELITE; w.enemies.flags[ahead] |= EF.ELITE;
  const aheadH = w.enemies.handle(ahead);
  w.trade.s.throwAt = w.tick + 30;
  run(w, 29, RIGHT);
  assert.equal(w.trade.s.yanks ?? 0, 0, 'not before its clock');
  run(w, 2, RIGHT);
  assert.equal(w.trade.s.yanks, 1, 'on its clock');
  assert.equal(w.trade.s.yankH, aheadH, 'the one she faces, not the nearer one behind');
  const at = w.trade.s.throwAt - w.tick;
  assert.ok(at > 5 * TPS, 'the next throw waits its clock');
});

test('Punter: full Momentum sweeps on its clock; standing still empties it and costs him', () => {
  const w = field('punter');
  const h = hookOf(w);
  run(w, 6 * TPS, RIGHT);
  assert.equal(h.state.step, C('punter').mechanic.params.steps, 'full after real movement');
  assert.ok(h.state.sweepAt > 0, 'the turn has gone off');
  run(w, 3 * TPS);
  assert.equal(h.state.step, 0, 'standing still empties it');
  const sweptStill = h.state.sweepAt;
  run(w, 4 * TPS);
  assert.equal(h.state.sweepAt, sweptStill, 'no sweep without Momentum');
});

test('Punter: each step of Momentum lengthens the Punt Pole\'s reach, and only the pole\'s', () => {
  const w = field('punter'), P = C('punter').mechanic.params;
  assert.ok(P.reachPerStep > 0);
  const other = w.slots.findIndex((s, i) => i > 0 && s && s.def);
  assert.ok(other > 0, 'his starting weapon is there to compare');
  const still = w.slots[0].stats.area, otherStill = w.slots[other].stats.area;
  run(w, 6 * TPS, RIGHT);
  assert.equal(hookOf(w).state.step, P.steps);
  const ratio = w.slots[0].stats.area / still;
  assert.ok(Math.abs(ratio - (1 + P.reachPerStep * P.steps)) < 0.01, `reach x${ratio.toFixed(2)} at full Momentum`);
  assert.ok(Math.abs(w.slots[other].stats.area - otherStill) < 1e-9, 'his other weapons keep their reach');
  run(w, 3 * TPS);
  assert.ok(Math.abs(w.slots[0].stats.area - still) < 1e-9, 'back to its own reach when he stops');
});

test('Harpooner: when the Grapnel\'s last bite killed, the hook comes back with the nearest enemy there (C2b, Nov 20)', () => {
  const w = field('harpooner'), h = hookOf(w), st = h.state;
  run(w, 20);
  const dead = spawn(w, 'drowned_sailor', 400, 0), deadH = w.enemies.handle(dead);
  const live = spawn(w, 'drowned_sailor', 410, 10), liveH = w.enemies.handle(live);
  w.enemies.hp[dead] = 0; w.enemies.flags[dead] |= EF_GONE;
  st.candH = deadH; st.cand2 = -1; st.candX = w.player.x + 400; st.candY = w.player.y; st.candAt = w.tick - 10;   // (out of the Grapnel's own reach, so no new bite resets it)
  const before = st.hauls;
  run(w, 1);
  assert.equal(st.hauls, before + 1, 'a haul, though the one it bit is dead');
  const k = [0, 1, 2].find((i) => st[`ht${i}`] > 0);
  assert.equal(st[`hh${k}`], liveH, 'the living one where it bit');
  // Farther than catchRadius from the bite: nothing to catch.
  const w2 = field('harpooner'), st2 = hookOf(w2).state;
  run(w2, 20);
  spawn(w2, 'drowned_sailor', 400 + C('harpooner').mechanic.params.catchRadius + 40, 0);
  st2.candH = -1; st2.candX = w2.player.x + 400; st2.candY = w2.player.y; st2.candAt = w2.tick - 10;
  run(w2, 1);
  assert.equal(st2.hauls, 0);
});

test('Bog Warden: walking over the fresh dead raises them, one every half second', () => {
  const w = field('bog_warden');
  const h = hookOf(w), st = h.state;
  for (let k = 0; k < 3; k++) { st[`c${k}x`] = w.player.x + 60; st[`c${k}y`] = w.player.y; st[`c${k}t`] = w.tick; st[`c${k}e`] = w.enemyIndex.get('drowned_sailor'); }
  run(w, 20);
  assert.equal(w.allies.raised, 0, 'not from afar');
  w.player.x += 60;
  run(w, 3);
  assert.equal(w.allies.raised, 1);
  run(w, 20);
  assert.equal(w.allies.raised, 1, 'the next waits half a second');
  run(w, 20);
  assert.equal(w.allies.raised, 2);
});

test('Bog Warden: her dead go first for what comes at her, and their bite holds it (C2b, Nov 20)', () => {
  const w = field('bog_warden'), P = C('bog_warden').mechanic.params;
  run(w, 2);
  assert.equal(w.allies.guard, 1); assert.equal(w.allies.hold, P.hold);
  spawn(w, 'drowned_sailor', 60, 0);
  spawn(w, 'drowned_sailor', -200, 0);   // nearer the thrall, farther from her
  const k = raiseThrallAt(w, w.enemyIndex.get('drowned_sailor'), w.player.x - 150, w.player.y, { max: 6, sec: 30, every: 0.5, damage: 1 }, false);
  const x0 = w.allies.x[k];
  run(w, 10);
  assert.ok(w.allies.x[k] > x0, 'it heads for the one coming at her, not the nearer one behind it');
  const fresh = spawn(w, 'drowned_sailor', 0, 300);   // (a new one: Bog Hands may have had the first)
  biteAt(w, w.allies, k, fresh);
  assert.ok(w.enemies.dazeT[fresh] >= P.hold - 1e-6, 'held');
});

test('Ruling 25 KA: her spare flames widen her light more while she walks than while she stands', () => {
  const w = field('lamplighter'), h = hookOf(w), P = C('lamplighter').mechanic.params;
  const lamp = () => w.slots.find((x) => x && x.def && x.def.id === 'lamplight').stats;
  run(w, 2 * TPS);
  h.state.flames = 0; w.statsDirty = true; run(w, 2);
  const a0 = lamp().area;
  h.state.flames = 2; w.statsDirty = true; run(w, TPS, RIGHT);
  assert.ok(Math.abs(lamp().area / a0 - (1 + 2 * P.flameMoveArea)) < 0.02, `walking x${(lamp().area / a0).toFixed(2)}`);
  h.state.flames = 2; run(w, 2 * TPS);
  assert.ok(Math.abs(lamp().area / a0 - (1 + 2 * P.flameArea)) < 0.02, `standing x${(lamp().area / a0).toFixed(2)}`);
});

test('Ruling 23 KB: the Punter starts with the Glass Caltrops, and each step of Momentum drops them faster', () => {
  const w = field('punter'), P = C('punter').mechanic.params;
  const k = w.slots.findIndex((x) => x?.def?.id === 'glass_caltrops');
  assert.ok(k > 0, 'his start weapon');
  const cd0 = w.slots[k].stats.cooldown;
  run(w, 6 * TPS, RIGHT);
  assert.equal(hookOf(w).state.step, P.steps);
  assert.ok(Math.abs(w.slots[k].stats.cooldown / cd0 - (1 - P.glassPerStep * P.steps)) < 0.01);
});

test('Ruling 23 KA: Sea\'s Armor reads no hit; its shield is bigger instead', () => {
  const w = field('tide_priest', { skills: ['seas_armor'] }), h = hookOf(w), st = h.state;
  run(w, 2);
  w.player.shield = 10; st.shieldWas = 10;
  const t = st.t;
  w.player.shield = 4;
  CHARACTER_HOOKS.tide_priest.onHurt(w, h, 6);
  assert.equal(st.t, t, 'a hit on her shield moves no clock');
  assert.equal(skillP('seas_armor').mul > 1, true);
});

test('Ruling 23 KE: a fuller purse weighs the pennies (a quarter at a time)', () => {
  const w = field('drowned_man'), P = C('drowned_man').mechanic.params, s = w.trade.s;
  run(w, 2);
  const d0 = w.slots[0].stats.damage;
  s.purse = purseNeed(w);
  run(w, 2);
  assert.ok(Math.abs(w.slots[0].stats.damage / d0 - (1 + P.purseMight)) < 0.01, `x${(w.slots[0].stats.damage / d0).toFixed(2)} with a full purse`);
  s.purse = 0; run(w, 2);
  assert.ok(Math.abs(w.slots[0].stats.damage - d0) < 1e-6, 'empty, back');
});

test('Ruling 23 KE: every few Grapnel hauls is a deed on her track', () => {
  const w = field('harpooner'), st = hookOf(w).state, per = w.trade.P.haulDeed;
  assert.ok(per > 0);
  run(w, 20);
  const before = w.trade.s.haulDeeds ?? 0;
  for (let i = 0; i < per; i++) { const e = spawn(w, 'drowned_sailor', 400 + 5 * i, 0); st.candH = w.enemies.handle(e); st.candAt = w.tick - 10; run(w, 1); for (let k = 0; k < 3; k++) st[`ht${k}`] = 0; }
  assert.equal(st.hauls >= per, true);
  assert.equal((w.trade.s.haulDeeds ?? 0) - before, Math.floor(st.hauls / per) - Math.floor((st.hauls - per) / per));
});

test('Drowned Man: a full purse marks a crate nearby; walking to it brings it up; one mark in its gap', () => {
  const w = field('drowned_man');
  const s = w.trade.s;
  run(w, 2);
  s.purse = purseNeed(w);
  run(w, 1);
  assert.equal(s.markOn, 1, 'marked');
  assert.equal(s.purse, 0, 'the purse paid it');
  const d = Math.hypot(s.markX - w.player.x, s.markY - w.player.y);
  assert.ok(d > 80, `a walk away (${d.toFixed(0)})`);
  w.player.x = s.markX; w.player.y = s.markY;
  run(w, 1);
  assert.equal(s.crates, 1, 'brought up');
  s.purse = purseNeed(w);
  run(w, 2);
  assert.equal(s.markOn, 0, 'the next waits its gap');
});

test('Tide Priest: a crowd close in the last seconds before a beat calls it; she cannot heal', () => {
  const w = field('tide_priest');
  const h = hookOf(w);
  for (let k = 0; k < 14; k++) spawn(w, 'drowned_sailor', 20 + (k % 7) * 6, (k < 7 ? -20 : 20));
  for (let i = 0; i < w.enemies.count; i++) { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e9; }
  for (let k = 1; k < w.slots.length; k++) if (w.slots[k]) w.slots[k].cd = 1e9;   // (her start weapon held, so only the call moves them)
  const every = C('tide_priest').mechanic.params.every;
  // Before the call window: nothing.
  h.state.t = every * 0.5 - 8;
  run(w, 6);
  assert.equal(h.state.ebbed, 0);
  h.state.t = every * 0.5 - 3;
  run(w, 7);
  assert.equal(h.state.ebbed, 1, 'the ebb, called early');
  assert.equal(h.state.calls, 1);
  const hp = w.player.hp = 50;
  HOOKS.tide_priest.onHeal(w, h, 10);
  assert.equal(HOOKS.tide_priest.onHeal(w, h, 10), 0, 'no heal reaches her');
  assert.equal(w.player.hp, hp);
});

test('loops: at a kill rate past 600 a minute, nothing a skill refunds outruns its clock', () => {
  // The Harpooner's Coil (readies the Grapnel on a yank) and the trade upgrades are the two refunds; a
  // crowd that dies as fast as it stands is set on each character with its refund skills.
  for (const [ch, skills] of [['harpooner', ['gaffed', 'coil', 'hand_line', 'salvager']], ['drowned_man', ['charons_change', 'wash_up', 'cold_hands']], ['bog_warden', ['thrall_fetch', 'the_host']]]) {
    const w = field(ch, { skills });
    const bot = createKiteBot({ archetype: 'projectile_storm' });
    let kills = 0;
    const T = 60 * TPS;
    for (let t = 0; t < T; t++) {
      if (t % 4 === 0) for (let k = 0; k < 3; k++) { const e = spawn(w, 'fog_wisp', 30 + k * 4, 0); if (t % 120 === 0 && k === 0) w.enemies.flags[e] |= EF.ELITE; }
      stepWorld(w, IDLE);
      for (let g = 0; currentHalt(w) && g < 100; g++) decide(w, bot.decide(w, currentHalt(w)));
      kills = w.result.totalKills;
    }
    const s = w.trade.s;
    assert.ok(s.sigN <= Math.floor(60 / w.trade.P.gap) + Math.floor(60 / w.trade.P.clock) + 1, `${ch}: ${s.sigN} upgrades in a minute`);
    if (ch === 'drowned_man') assert.ok((s.crates ?? 0) <= Math.floor(60 / w.trade.P.markGap) + 1, `${ch}: ${s.crates} crates in a minute`);
    assert.ok(kills >= 600, `${ch}: ${kills} kills in the minute`);
  }
});

test('determinism: each character replays to the same hash, with skills', () => {
  for (const c of DATA.characters) {
    const skills = DATA.skills.filter((s) => s.character === c.id && s.row === 'build' && !s.needs).slice(0, 1).map((s) => s.id);
    const a = field(c.id, { skills, seed: 9 }), b = field(c.id, { skills, seed: 9 });
    for (let k = 0; k < 4; k++) { spawn(a, 'drowned_sailor', 60 + k * 10, 10); spawn(b, 'drowned_sailor', 60 + k * 10, 10); }
    for (let t = 0; t < 20 * TPS; t++) { const f = t % 240 < 160 ? RIGHT : IDLE; stepWorld(a, f); stepWorld(b, f); }
    assert.equal(hashWorld(a), hashWorld(b), c.id);
  }
});

test('results: her dead have their own row, and the trade says what it did', async () => {
  const { buildRunResult } = await import('../src/sim/run-result.js');
  const w = field('bog_warden');
  w.allies.dealt = 1234;
  const r = buildRunResult(w);
  assert.equal(r.thrallDamage, 1234);
  assert.equal(r.trade.deadDamage, 1234);
  assert.ok(r.trade.sigLevel >= 1);
  assert.ok(TRADE.MARK === 10 && EF_GONE > 0);
});

test('the trade pays past the wait: each upgrade the gap holds back is a stated damage bonus, up to its top', async () => {
  const { tradeBonus } = await import('../src/sim/trades.js');
  const w = field('lamplighter');
  const P = w.trade.P, s = w.trade.s;
  tradeDeed(w, s.sigNeed);              // one upgrade now; the gap starts
  assert.equal(tradeBonus(w), 0);
  tradeDeed(w, s.sigNeed * 3);          // three more inside the gap
  assert.ok(Math.abs(tradeBonus(w) - 3 * P.pastCap) < 1e-9, 'three steps of bonus');
  tradeDeed(w, s.sigNeed * 1000);
  assert.ok(Math.abs(tradeBonus(w) - P.pastMax) < 1e-9, 'held at its top');
});

// C3's crash (ruling 18): Mire Grip made its ground with list -1, which a zone's Uint16 list keeps as
// 65535, so the zone's pulse read world.fxLists[65535]. Every zone's on-hit list must exist when made.
const zoneListsOk = (w) => {
  const Z = w.zones;
  for (let z = 0; z < Z.count; z++) if (w.fxLists[Z.list[z]] === undefined) return `zone ${z} has list ${Z.list[z]}`;
  return null;
};
test('zones: the Bog Warden run C3 found (Mire Grip on Bog Hands) runs past 8:00, every zone with a list that exists', async () => {
  const { measureConfig } = await import('../tools/pacing/measure.mjs');
  const cfg = { ...measureConfig(100, false, 'drowned_docks', 0), character: 'bog_warden' }; delete cfg.startWeapon;
  const w = createWorld(cfg, DATA);
  const bot = createKiteBot({ archetype: 'projectile_storm', follow: true, picker: 'careful' });
  let bad = null;
  while (w.tick < 8 * 3600 + 600 && !w.over && bad === null) {
    stepWorld(w, bot.input(w));
    for (let g = 0; currentHalt(w) && g < 100; g++) decide(w, bot.decide(w, currentHalt(w)));
    if (w.tick % 30 === 0) bad = zoneListsOk(w);
  }
  assert.equal(bad, null);
  assert.ok(w.tick > 8 * 3600 || w.over, `reached ${w.tick}`);
});

test('zones: every signature Form option, held alone in a crowd, makes zones whose lists exist', async () => {
  const { SIGNATURE_FORMS } = await import('../src/data/signature-forms.js');
  const { takeForm } = await import('../src/sim/ascend.js');
  for (const c of DATA.characters) {
    const line = SIGNATURE_FORMS.find((l) => l.weapons.includes(c.signature));
    for (const o of line.options) {
      const w = createWorld({ seed: `zones ${o.id}`, character: c.id, invulnerable: true }, DATA);
      const k = w.slots.findIndex((x) => x && x.def && x.def.id === c.signature);
      takeForm(w, k, o);
      const bot = createKiteBot({});
      let bad = null;
      for (let t = 0; t < 600 && bad === null; t++) {
        if (t % 20 === 0) for (let q = 0; q < 4; q++) { const e = spawn(w, 'drowned_sailor', 40 + q * 12, (q - 2) * 14); if (e >= 0) w.enemies.speed[e] = 0; }
        stepWorld(w, { mx: 0, my: 0, buttons: 0 });
        for (let g = 0; currentHalt(w) && g < 100; g++) decide(w, bot.decide(w, currentHalt(w)));
        bad = zoneListsOk(w);
      }
      assert.equal(bad, null, `${c.id} ${o.id}`);
    }
  }
});

test('text numbers: placeholders fill from the data, and a wrong name fails at load', () => {
  const scope = { m: { steps: 4, perStep: 0.1, empty: -0.25, rate: -0.375 }, b: { maxHp: 130, moveSpeed: 0.85 }, s: { maxHp: 100 }, t: { marshCache: 300, over: -1 } };
  assert.equal(fillText('+{m.steps*perStep%} Damage', scope, 't'), '+40% Damage');
  assert.equal(fillText('{-m.empty%} less, -{1-b.moveSpeed%} Move Speed, +{b.maxHp-s.maxHp} Max HP', scope, 't'), '25% less, -15% Move Speed, +30 Max HP');
  assert.equal(fillText('every {t.marshCache/60} minutes, {m.steps+t.over} back, {1/(1+m.rate)-1%} faster', scope, 't'), 'every 5 minutes, 3 back, 60% faster');
  assert.equal(fillText('every {m.steps#} crate, {m.steps|level}, {s.one|level}, the {s.eleven#} time, the {s.two#}', { ...scope, s: { one: 1, eleven: 11, two: 22 } }, 't'), 'every 4th crate, 4 levels, 1 level, the 11th time, the 22nd');
  assert.throws(() => fillText('{m.nope%}', scope, 'here'), /here: \{m\.nope%\} names no number/);
});

test('text numbers: no character, signature, or Form line types a number by hand (main, Nov 19)', () => {
  // A number in these lines is a placeholder that reads the data (data/textnum.js). The few digits
  // left are rules fixed in the code, not numbers in the data:
  const fixed = [
    'about 1 every',                // one cache at a time (sim/trades.js)
    'A sharp turn loses 1 step',    // a turn bleeds exactly one step (hooks-characters.js: 1 / P.steps)
    '+1 Penny for each sea chest',  // Full Purse adds one Penny a chest (hooks-characters.js: s.seaN)
  ];
  const found = [];
  for (const f of ['characters', 'signatures', 'signature-forms']) {
    const src = readFileSync(new URL(`../src/data/${f}.js`, import.meta.url), 'utf8').split('\n')
      .filter((l) => !l.trim().startsWith('//')).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
      const text = m[1];
      if (!text.includes(' ')) continue;   // ids, keys, and sprite names
      let bare = text.replace(/\{[^{}]*\}/g, '');
      for (const ok of fixed) bare = bare.replace(ok, '');
      if (/\d/.test(bare)) found.push(`${f}: ${text}`);
    }
  }
  assert.deepEqual(found, [], 'write the number as a placeholder (data/textnum.js), or name the fixed rule here');
  // And every placeholder was filled.
  const lines = [];
  for (const c of DATA.characters) lines.push(c.who, c.desc, c.gives, c.costs, c.card.does, c.card.costs, c.trade.deedText);
  for (const w of DATA.weapons.filter((x) => x.signature)) lines.push(w.desc, ...w.lines.map((x) => x.desc), ...w.specials.map((x) => x.desc));
  const forms = DATA.ascensions.filter((x) => DATA.weapons.some((w) => w.signature && x.weapons?.includes(w.id))).flatMap((l) => l.options);
  assert.equal(forms.length, 36, 'the six signatures\' Form options');
  for (const o of forms) lines.push(o.desc, o.price);
  assert.deepEqual(lines.filter((t) => typeof t === 'string' && /[{}]/.test(t)), []);
});

test('text numbers: the Lamplighter\'s lantern line follows lanternUp', () => {
  const c = C('lamplighter');
  assert.match(c.gives, new RegExp(`gives Lamplight \\+${Math.round(c.mechanic.params.lanternUp * 100)}% Damage while it stands`));
});

