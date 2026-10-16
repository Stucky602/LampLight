// Content (ARCHITECTURE §11, §14.1): every data file against its schema, every reference
// resolves, every hook exists, the evolution graph is sound, and every weapon with every rune
// that fits it actually runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { buildMap } from '../src/sim/terrain.js';
import { HOOKS } from '../src/sim/hooks.js';
import { checkModifier, combine, WEAPON_DEFAULTS, PLAYER_STAT_IDS } from '../src/sim/stats.js';
import { EMIT, MOTION, FX, AI, STATUS_IDS } from '../src/sim/constants.js';
import { runeValidOn, runeFits } from '../src/sim/weapons.js';
import { makeWorld, give, spawnAt, run } from './helpers/simworld.js';
import { HUB_TERRAIN } from '../src/data/hub.js';
import { MAX_BUILDING_LEVEL } from '../src/data/buildings.js';
import { parseUnlock, npcLine, hubPeople, contentFrom } from '../src/meta/state.js';
import { defaultProfile } from '../src/save/schema.js';
import { buildHubMap, clearTiles, solidTiles, reachableFrom, segmentOpen, arrivalPath } from '../src/hub/map.js';
import { createHubTuning, checkHubTune, hubTuneRange } from '../src/hub/tuning.js';
import { HUB_TUNING_RANGE } from '../src/data/tuning.js';
import { lookColor } from '../src/render/hubtiles.js';
import { BUILDINGS_LAYOUT } from '../art/manifest.js';
import { openings } from '../art/draw/hub.js';
import { RUNE_STONE_COST, REROLL_COST, GEAR_SLOTS, TIER_MUL, RULE_SLOTS } from '../src/data/gear.js';
import { TASK } from '../src/sim/constants.js';
import { GROUND } from '../src/sim/terrain.js';
import { featMet } from '../src/meta/feats.js';
import { createWorld } from '../src/sim/world.js';

const ID_RE = /^[a-z][a-z0-9_]*$/;
const ids = (list) => new Set(list.map((x) => x.id));
const W = ids(DATA.weapons), P = ids(DATA.passives);
const EN = ids(DATA.enemies), MAT = ids(DATA.materials), BOSS = ids(DATA.bosses);

test('content: ids are unique, permanent-looking (snake_case), and every entry has a name and plain description', () => {
  for (const [kind, list] of Object.entries(DATA)) {
    // ascensions: their own test (lines of options); tides go by level, not id (data/tide.js).
    if (!Array.isArray(list) || kind === 'ascensions' || kind === 'tides') continue;
    const seen = new Set();
    for (const x of list) {
      assert.ok(ID_RE.test(x.id), `${kind}: bad id "${x.id}"`);
      assert.ok(!seen.has(x.id), `${kind}: duplicate id "${x.id}"`);
      seen.add(x.id);
      if (kind === 'recipes' || kind === 'affixes') { assert.equal(typeof x.name, 'string', `${kind} ${x.id}: name`); continue; }
      if (kind !== 'bosses') {
        assert.equal(typeof x.name, 'string', `${kind} ${x.id}: name`);
        assert.ok(typeof x.desc === 'string' && x.desc.length > 3 && x.desc.length < 140, `${kind} ${x.id}: desc`);
      }
    }
  }
});

test('content: weapons have valid numbers, pipelines, levels, and evolutions', () => {
  const baseKeys = new Set(Object.keys(WEAPON_DEFAULTS));
  for (const w of DATA.weapons) {
    const at = `weapon ${w.id}`;
    assert.ok(Array.isArray(w.tags) && w.tags.length >= 1 && w.tags.length <= 3, `${at}: 1 to 3 tags (brief §5.3)`);
    for (const [k, v] of Object.entries(w.base)) {
      assert.ok(baseKeys.has(k), `${at}: unknown base stat ${k}`);
      assert.ok(Number.isFinite(v), `${at}: base ${k} = ${v}`);
    }
    assert.ok(w.base.cooldown > 0, `${at}: cooldown`);
    assert.ok(Number.isInteger(w.maxLevel) && w.maxLevel >= 1);
    assert.equal(w.levels.length, w.maxLevel, `${at}: levels has one entry per level (levels[0] is null)`);
    assert.equal(w.levels[0], null);
    for (const lv of w.levels.slice(1)) for (const [k, v] of Object.entries(lv)) assert.ok(baseKeys.has(k) && Number.isFinite(v), `${at}: level adds ${k}`);
    assert.ok(EMIT[w.pipeline.emit.type] !== undefined, `${at}: emitter ${w.pipeline.emit.type}`);
    assert.ok(MOTION[w.pipeline.motion.type] !== undefined, `${at}: motion ${w.pipeline.motion.type}`);
    assert.ok(w.pipeline.onHit.length >= 1 && w.pipeline.onHit.every((e) => FX[e.type] !== undefined), `${at}: on-hit list`);
    for (const e of w.pipeline.onHit) if (e.type === 'status') assert.ok(STATUS_IDS.includes(e.status), `${at}: status ${e.status}`);
    assert.ok(Number.isInteger(w.runeSlots) && w.runeSlots >= 0 && w.runeSlots <= 2, `${at}: rune sockets (brief: 2)`);
    // Anything that stays on enemies (an aura, a beam, bodies that never run out) needs a hit
    // cooldown, or it would hit every tick.
    const lasting = ['aura', 'beam', 'summon', 'orbit'].includes(w.pipeline.emit.type) || w.base.pierce === -1;
    if (lasting) assert.ok(w.base.hitCooldown > 0, `${at}: lasting hits need a hitCooldown`);
    if (w.evolution) {
      assert.ok(P.has(w.evolution.passive), `${at}: evolution partner ${w.evolution.passive}`);
      assert.ok(W.has(w.evolution.into), `${at}: evolves into ${w.evolution.into}`);
      const into = DATA.weapons.find((x) => x.id === w.evolution.into);
      assert.equal(into.unlock, 'evolution', `${at}: its evolution is only reachable by evolving`);
      assert.ok(!into.evolution, `${at}: evolutions don't evolve again`);
      const partner = DATA.passives.find((p) => p.id === w.evolution.passive);
      assert.ok(w.evolution.passiveLevel >= 1 && w.evolution.passiveLevel <= partner.maxLevel, `${at}: partner level reachable`);
    }
  }
  // Every evolved weapon has exactly one way in.
  for (const w of DATA.weapons.filter((x) => x.unlock === 'evolution')) {
    const from = DATA.weapons.filter((x) => x.evolution && x.evolution.into === w.id);
    assert.equal(from.length, 1, `evolution ${w.id} has one base weapon`);
    assert.equal(w.weight, 0, `${w.id} is never offered in a draft`);
  }
});

test('content: passives, runes, relics, characters, enemies, bosses, and maps are all well formed', () => {
  for (const p of DATA.passives) {
    assert.equal(p.levels.length, p.maxLevel, `passive ${p.id}: one modifier list per level`);
    for (const list of p.levels) {
      assert.ok(Array.isArray(list) && list.length >= 1, `passive ${p.id}: each level adds something`);
      for (const m of list) assert.equal(checkModifier(m), null, `passive ${p.id}: ${JSON.stringify(m)}`);
    }
  }
  for (const r of DATA.runes) {
    for (const e of r.validOn.emit) assert.ok(EMIT[e] !== undefined, `rune ${r.id}: valid on ${e}`);
    const p = r.patch;
    assert.ok(p.onHitAppend || p.emit || p.motion || p.mirror, `rune ${r.id} changes behavior (brief: runes change behavior, not numbers)`);
    for (const e of p.onHitAppend || []) assert.ok(FX[e.type] !== undefined, `rune ${r.id}: effect ${e.type}`);
    if (p.emit) assert.ok(EMIT[p.emit.type] !== undefined);
    if (p.motion) assert.ok(MOTION[p.motion.type] !== undefined);
    assert.ok(DATA.weapons.some((w) => w.runeSlots > 0 && runeValidOn(r, w)), `rune ${r.id} fits at least one weapon`);
  }
  const paramsOk = (who, hook, params) => {
    for (const k of HOOKS[hook].needs || []) assert.ok(Number.isFinite(params?.[k]), `${who}: hook ${hook} needs a number for "${k}"`);
  };
  for (const r of DATA.relics) {
    // A hook, stat modifiers, or both; a tier (Trinket, Charm, Relic).
    assert.ok(r.hook || (r.mods && r.mods.length), `relic ${r.id}: does something`);
    assert.ok([1, 2, 3].includes(r.tier), `relic ${r.id}: tier 1, 2, or 3`);
    if (r.hook) { assert.ok(HOOKS[r.hook], `relic ${r.id}: hook ${r.hook} exists`); paramsOk(`relic ${r.id}`, r.hook, r.params); }
    for (const m of r.mods || []) assert.equal(checkModifier(m), null);
  }
  for (const a of DATA.arcana) {
    assert.ok(HOOKS[a.hook], `arcana ${a.id}: hook ${a.hook} exists`);
    paramsOk(`arcana ${a.id}`, a.hook, a.params);
    for (const m of a.mods || []) assert.equal(checkModifier(m), null);
  }
  for (const c of DATA.characters) {
    if (c.start) assert.ok(W.has(c.start), `character ${c.id}: start ${c.start}`);
    if (c.innate) {
      assert.ok(W.has(c.innate), `character ${c.id}: innate ${c.innate}`);
      assert.equal(DATA.weapons.find((w) => w.id === c.innate).innate, true, `${c.innate} is marked innate`);
    }
    assert.ok(c.mechanic && HOOKS[c.mechanic.hook], `character ${c.id}: a unique mechanic (brief §5.4), hook exists`);
    paramsOk(`character ${c.id}`, c.mechanic.hook, c.mechanic.params);
    for (const [k, v] of Object.entries(c.base || {})) assert.ok(PLAYER_STAT_IDS.includes(k) && Number.isFinite(v), `character ${c.id}: base stat "${k}"`);
  }
  // Bosses only come from boss events (which give them their attacks), never from a roster,
  // a wall or ring, a split, or a summon.
  const isBoss = (id) => DATA.enemies.find((x) => x.id === id)?.ai.type === 'boss';
  for (const e of DATA.enemies) {
    for (const k of ['hp', 'speed', 'contact', 'mass', 'radius', 'xp']) assert.ok(Number.isFinite(e[k]) && e[k] > 0, `enemy ${e.id}: ${k}`);
    assert.ok(AI[e.ai.type] !== undefined, `enemy ${e.id}: ai ${e.ai.type}`);
    if (e.ai.type === 'splitter') assert.ok(EN.has(e.ai.into) && !isBoss(e.ai.into), `enemy ${e.id}: splits into ${e.ai.into}`);
    if (e.ai.type === 'boss') assert.ok(BOSS.has(e.boss), `enemy ${e.id}: boss pattern ${e.boss}`);
    if (e.ai.type === 'charger') assert.ok(e.ai.windup >= DATA.tuning.enemies.telegraphMin, `enemy ${e.id}: winds up at least 0.8 s`);
    if (e.ai.warn !== undefined) assert.ok(e.ai.warn >= DATA.tuning.enemies.telegraphMin, `enemy ${e.id}: warns at least 0.8 s`);
    for (const d of e.drops) assert.ok(MAT.has(d.material));
  }
  for (const b of DATA.bosses) {
    for (const ph of b.phases) for (const a of ph.attacks) assert.ok(b.attacks[a], `boss ${b.id}: attack ${a}`);
    for (const [name, a] of Object.entries(b.attacks)) {
      assert.ok(a.warn >= DATA.tuning.enemies.telegraphMin, `boss ${b.id} ${name}: warns at least 0.8 s`);
      if (a.enemy) assert.ok(EN.has(a.enemy) && !isBoss(a.enemy), `boss ${b.id} ${name}: summons ${a.enemy}`);
    }
    assert.equal(b.phases[0].from, 1, `boss ${b.id}: first phase starts at full HP`);
    for (let k = 1; k < b.phases.length; k++) assert.ok(b.phases[k].from < b.phases[k - 1].from, `boss ${b.id}: phases listed from full health down`);
  }
  for (const m of DATA.maps) {
    let t = 0;
    for (const band of m.timeline.bands) {
      assert.equal(band.from, t, `map ${m.id}: bands are contiguous`);
      assert.ok(band.to > band.from);
      t = band.to;
      for (const id of Object.keys(band.roster)) assert.ok(EN.has(id) && !isBoss(id), `map ${m.id}: roster ${id}`);
    }
    assert.ok(t >= 1200, `map ${m.id}: the timeline reaches 20:00`);
    const bosses = m.timeline.events.filter((e) => e.event === 'boss').map((e) => e.at);
    assert.deepEqual(bosses, [600, 1200], `map ${m.id}: bosses at 10:00 and 20:00 (brief §5.1)`);
    for (const e of m.timeline.events) {
      assert.ok(EN.has(e.enemy), `map ${m.id}: event enemy ${e.enemy}`);
      assert.equal(isBoss(e.enemy), e.event === 'boss', `map ${m.id}: ${e.event} at ${e.at} s with ${e.enemy} (boss events, and only they, spawn bosses)`);
    }
    assert.equal(m.timeline.events.filter((e) => e.event === 'elite').length >= 1, true, `map ${m.id}: an elite event (brief §5.1)`);
  }
});

test('content: pierce is capped at what a shot can remember', async () => {
  const { HIT_RING } = await import('../src/sim/constants.js');
  assert.ok(DATA.tuning.caps.weapon.maxPierce <= HIT_RING, `maxPierce ${DATA.tuning.caps.weapon.maxPierce} must be at most HIT_RING ${HIT_RING}`);
});

test('content: every tuning value is a finite number (or a list of them)', () => {
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      const at = `${path}.${k}`;
      if (Array.isArray(v)) v.flat(2).forEach((x) => assert.ok(Number.isFinite(x), at));
      else if (v && typeof v === 'object') walk(v, at);
      else if (typeof v !== 'boolean') assert.ok(Number.isFinite(v), `${at} = ${v}`);
    }
  };
  walk(DATA.tuning, 'tuning');
  assert.ok(DATA.tuning.enemies.telegraphMin >= 0.8, 'brief: playable half-watching TV');
});

test('content: the harbor\'s tuning: every number has a range and sits in it, brightness and shares within 0..1, colors from the palette or a #rrggbb tint', () => {
  const live = createHubTuning();
  const numbers = new Map();   // path -> default
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      const at = path ? `${path}.${k}` : k;
      if (typeof v === 'number') numbers.set(at, v);
      else if (Array.isArray(v)) assert.ok(at === 'look.ambient' && v.length === 3 && v.every((c) => c >= 0 && c <= 1), `${at}: the one list, red, green, and blue`);
      else if (v && typeof v === 'object') walk(v, at);
      else {
        assert.match(k, /^color$|Color$/, `${at}: only colors are text`);
        assert.doesNotThrow(() => lookColor(v), `${at} = ${v}`);
      }
    }
  };
  walk(DATA.hubTuning, '');
  // Every number has its range, and every range is a number's: a new number is placed on purpose.
  const ranged = [];
  const walkRanges = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      const at = path ? `${path}.${k}` : k;
      if (typeof v === 'string') { assert.ok(['above0', 'min0', 'unit', 'any'].includes(v), `${at}: "${v}" is a range`); ranged.push(at); } else walkRanges(v, at);
    }
  };
  walkRanges(HUB_TUNING_RANGE, '');
  assert.deepEqual([...ranged].sort(), [...numbers.keys()].sort(), 'every harbor number has a range, and every range a number');
  for (const [at, v] of numbers) assert.equal(checkHubTune(live, at, v), null, `${at} = ${v} sits in its range`);
  // Every brightness, thickness, and share is 0 to 1 (the view multiplies by them).
  const unit = [...numbers.keys()].filter((at) => /Light$/.test(at)).concat([
    'look.lampDim', 'look.fogDensity', 'look.fogFray', 'look.fogCreep', 'look.wisps', 'look.flicker', 'look.flickerSlowShare',
    'look.boatNight', 'look.boatInFog', 'look.boatGlow', 'look.boatGlowInFog', 'look.puffs.alpha',
  ]);
  for (const at of unit) assert.equal(hubTuneRange(at), 'unit', `${at} is 0 to 1`);
  // Every other range's kind, on purpose. Above 0: what the harbor divides by, and what a
  // ceremony, a boat, or a walk waits on (0 would give NaN or never end), and the walk-off's push
  // (0 would set out at a touch of the edge). Any: only where the sign
  // is a direction or a darkening. Everything else is 0 or more (a reach, a pause, a count, a size).
  const above0 = [
    'timing.panIn', 'timing.build', 'timing.fogPeel', 'timing.panOut', 'timing.boatSpeed', 'timing.walkSpeed', 'timing.arriveSpeed', 'timing.walkOff',
    'look.flickerSlowMs', 'look.flickerFastMs', 'look.boatBobMs', 'look.waterFrameMs', 'look.waterDriftMs', 'look.hopStepsPerSec', 'look.popSec',
  ];
  const any = ['look.ambientBoost', 'look.wispDriftX', 'look.wispDriftY', 'look.cameraLift', 'look.dust.rise', 'look.smoke.drift', 'look.smoke.rise'];
  for (const at of numbers.keys()) {
    const kind = above0.includes(at) ? 'above0' : any.includes(at) ? 'any' : unit.includes(at) ? 'unit' : 'min0';
    assert.equal(hubTuneRange(at), kind, `${at} is held to "${kind}"`);
  }
  const { look } = DATA.hubTuning;
  assert.ok(look.boatGlow + look.boatGlowInFog <= 1, 'the boat\'s halo at full fog');
});

function sweepWorld(seed) {
  const w = makeWorld({ seed, invulnerable: true });
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 6.283185307179586;
    const i = spawnAt(w, k % 3 === 0 ? 'mud_crab' : 'drowned_sailor', 60 + (k % 4) * 30 * Math.cos(a), 60 * Math.sin(a) + (k % 5) * 10);
    w.enemies.hp[i] = w.enemies.maxHp[i] = 400;
  }
  return w;
}

function finite(w) {
  const p = w.player;
  if (![p.x, p.y, p.hp].every(Number.isFinite)) return 'player';
  for (const [name, fields] of [['enemies', ['x', 'y', 'hp', 'vx']], ['projectiles', ['x', 'y', 'vx', 'damage']], ['zones', ['x', 'y', 'radius']]]) {
    const pool = w[name];
    for (const f of fields) for (let i = 0; i < pool.count; i++) if (!Number.isFinite(pool[f][i])) return `${name}.${f}`;
  }
  return null;
}

test('content: every weapon with every rune that fits runs 600 ticks cleanly, and every rune changes what it does', () => {
  const weapons = DATA.weapons;
  let combos = 0;
  weapons.forEach((def, wi) => {
    const runeSets = [[]];
    if (def.runeSlots > 0) for (const r of DATA.runes) if (runeValidOn(r, def)) runeSets.push([r.id]);
    let bare = null;
    for (const runes of runeSets) {
      // The same seed and crowd for the bare weapon and each rune, so a rune that does nothing
      // shows as the same damage to the hit point (§5.8: no socketed rune ever does nothing).
      const w = sweepWorld(100 + wi);
      give(w, def.id, { slot: def.innate ? 8 : 0, level: def.maxLevel, runes });
      run(w, 600, { mx: 60, my: 30, buttons: 0 }, { halts: 'pass' });
      assert.equal(finite(w), null, `${def.id} + [${runes}]: something went non-finite`);
      assert.ok(w.result.damageBySlot.some((d) => d > 0), `${def.id} + [${runes}]: never hurt anything`);
      const dealt = w.result.damageBySlot.reduce((x, y) => x + y, 0).toFixed(3);
      if (runes.length === 0) bare = dealt;
      else assert.notEqual(dealt, bare, `${def.id} + [${runes}]: does exactly what the bare weapon does`);
      combos++;
    }
  });
  assert.ok(combos >= 30, `${combos} combinations`);
});

// Every pair of runes that can share a weapon, in socket order (the rule the chests use), on
// every weapon with two sockets: 120 ticks each.
test('content: every weapon with both sockets filled, every allowed pair, runs cleanly', () => {
  let pairs = 0;
  for (const def of DATA.weapons.filter((w) => w.runeSlots >= 2)) {
    for (const a of DATA.runes) {
      if (!runeFits(a, def, [null, null])) continue;
      for (const b of DATA.runes) {
        if (!runeFits(b, def, [a, null])) continue;
        const w = sweepWorld(1000 + pairs);
        give(w, def.id, { level: def.maxLevel, runes: [a.id, b.id] });
        run(w, 120, { mx: -40, my: 70, buttons: 0 }, { halts: 'pass' });
        assert.equal(finite(w), null, `${def.id} + [${a.id}, ${b.id}]`);
        pairs++;
      }
    }
  }
  assert.ok(pairs >= 60, `${pairs} pairs`);
});

// ---------------------------------------------------------------- the meta layer's content (Phase 5)

const B = ids(DATA.buildings), RES = ids(DATA.research);
function checkCost(where, cost) {
  assert.ok(cost && typeof cost === 'object' && Object.keys(cost).length >= 1, `${where}: a cost`);
  for (const [id, n] of Object.entries(cost)) {
    assert.ok(MAT.has(id), `${where}: material ${id}`);
    assert.ok(Number.isInteger(n) && n > 0, `${where}: ${id} costs a whole number above 0`);
  }
}

const GROWING = ['tree', 'researchTier', 'researchSlots', 'lampSpeed', 'ferry', 'gearSlots', 'gearTier', 'tideMax', 'curses', 'market', 'glassToCoin', 'consumableSlots'];
const FLAGS = ['feats', 'mastery', 'reroll', 'runeCrafting', 'bellRing', 'tasksOnMap', 'bestiary', 'challenges', 'shortRuns', 'secretsOnMap'];

test('content: buildings have five levels, real costs, and effects that only grow', () => {
  for (const b of DATA.buildings) {
    assert.equal(b.levels.length, MAX_BUILDING_LEVEL, `${b.id}: five levels (brief §6.1)`);
    assert.ok(MAT.has(b.material), `${b.id}: its material ${b.material}`);
    assert.ok(DATA.npcs.some((n) => n.id === b.npc && n.home === b.id), `${b.id}: its keeper ${b.npc} lives there`);
    // Numbers that only grow (data/buildings.js), and flags a level turns on.
    const seen = Object.fromEntries(GROWING.map((k) => [k, 0]));
    b.levels.forEach((lv, i) => {
      checkCost(`${b.id} level ${i + 1}`, lv.cost);
      assert.ok(lv.cost[b.material] > 0, `${b.id} level ${i + 1} uses its own material, ${b.material}`);
      for (const k of Object.keys(lv)) assert.ok(k === 'cost' || GROWING.includes(k) || FLAGS.includes(k), `${b.id} level ${i + 1}: unknown effect "${k}"`);
      for (const k of FLAGS) if (lv[k] !== undefined) assert.ok(Number.isFinite(lv[k]) && lv[k] > 0, `${b.id} level ${i + 1}: ${k}`);
      for (const k of Object.keys(seen)) {
        if (lv[k] === undefined) continue;
        assert.ok(Number.isFinite(lv[k]) && lv[k] > seen[k], `${b.id} level ${i + 1}: ${k} grows`);
        seen[k] = lv[k];
      }
      if (i > 0) assert.ok(Object.values(lv.cost).reduce((a, c) => a + c, 0) > Object.values(b.levels[i - 1].cost).reduce((a, c) => a + c, 0), `${b.id} level ${i + 1} costs more than the one before`);
    });
  }
});

test('content: research sits in a tier the Library opens, needs only earlier work, and each adds something', () => {
  const maxTier = Math.max(...DATA.buildings.find((b) => b.id === 'library').levels.map((l) => l.researchTier || 0));
  const byId = new Map(DATA.research.map((r) => [r.id, r]));
  for (const r of DATA.research) {
    assert.ok(Number.isInteger(r.tier) && r.tier >= 1 && r.tier <= maxTier, `${r.id}: tier ${r.tier} is one the Library opens`);
    assert.ok(Number.isInteger(r.runs) && r.runs >= 1 && r.runs <= 5, `${r.id}: finishes after 1 to 5 runs`);
    checkCost(`research ${r.id}`, r.cost);
    for (const q of r.requires) {
      assert.ok(byId.has(q), `${r.id} requires ${q}`);
      assert.ok(byId.get(q).tier <= r.tier, `${r.id}: requires ${q}, which is not in a later tier`);
    }
    const adds = [DATA.weapons, DATA.passives, DATA.relics, DATA.runes, DATA.characters, DATA.recipes, DATA.consumables, DATA.arcana].flat().filter((x) => x.unlock === `research:${r.id}`);
    assert.ok(adds.length >= 1, `${r.id} adds something to your runs`);
  }
  // No cycles: every project can be reached by finishing what it needs first.
  const done = new Set();
  let progressMade = true;
  while (progressMade) {
    progressMade = false;
    for (const r of DATA.research) if (!done.has(r.id) && r.requires.every((q) => done.has(q))) { done.add(r.id); progressMade = true; }
  }
  assert.equal(done.size, DATA.research.length, 'the research tree has no loops');
});

test('content: Lamp Post upgrades are few, small, capped, and real modifiers', () => {
  const maxTier = Math.max(...DATA.buildings.find((b) => b.id === 'lamp_post').levels.map((l) => l.tree || 0));
  for (const u of DATA.upgrades) {
    assert.ok(Number.isInteger(u.tier) && u.tier >= 1 && u.tier <= maxTier, `${u.id}: tier ${u.tier}`);
    assert.ok(Number.isInteger(u.ranks) && u.ranks >= 1 && u.ranks <= 5, `${u.id}: 1 to 5 ranks (capped, brief §6)`);
    checkCost(`upgrade ${u.id}`, u.cost);
    assert.ok(u.mods.length >= 1);
    for (const m of u.mods) assert.equal(checkModifier(m), null, `upgrade ${u.id}: ${JSON.stringify(m)}`);
    // A run gets each modifier times the ranks bought (meta/runconfig.js upgradeMods), and stacks
    // those on one stat as sim/stats.js combine does. What one upgrade does to one stat, at its last
    // rank, all its modifiers on that stat together:
    const last = u.mods.map((m) => ({ ...m, value: m.value * u.ranks }));
    for (const stat of new Set(u.mods.map((m) => m.stat))) {
      const mine = last.filter((m) => m.stat === stat), ops = new Set(mine.map((m) => m.op));
      for (const op of ops) if (!['add', 'pct', 'more'].includes(op)) assert.fail(`upgrade ${u.id}: no cap written for the op "${op}"; add one here`);
      if (!ops.has('add')) {
        // A share of the stat ("pct" and "more"): at most 25% either way.
        const share = Math.abs(combine(1, mine, stat) - 1);
        assert.ok(share <= 0.25 + 1e-9, `upgrade ${u.id}: at most 25% on ${stat} at its last rank, not ${Math.round(share * 100)}%`);
      } else if (stat === 'maxHp') {
        const base = DATA.tuning.player.stats.maxHp;
        assert.ok(combine(base, mine, stat) - base <= base * 0.25 + 1e-9, `upgrade ${u.id}: at most a quarter of the base health`);
      } else if (ops.size > 1) assert.fail(`upgrade ${u.id}: no cap written for a flat ${stat} with a share of it; add one here`);
      else if (stat === 'armor') {
        // A quarter of the first enemy's hit (the map's first band).
        const first = DATA.enemies.find((e) => e.id === Object.keys(DATA.maps[0].timeline.bands[0].roster)[0]);
        const total = combine(0, mine, stat);
        assert.ok(total <= first.contact * 0.25, `upgrade ${u.id}: ${total} armor is more than a quarter of a ${first.name}'s ${first.contact}`);
      } else if (stat === 'revival') {
        assert.equal(u.ranks, 1, `${u.id}: the one revival, the capstone`);
        assert.equal(combine(0, mine, stat), 1, `${u.id}: one revival`);
      } else assert.fail(`upgrade ${u.id}: no cap written for a flat ${stat}; add one here`);
    }
  }
  // One revival in the whole tree, and it's the capstone: the last tier's (Second Wind).
  const revivals = DATA.upgrades.filter((u) => u.mods.some((m) => m.stat === 'revival'));
  assert.deepEqual(revivals.map((u) => u.tier), [maxTier], 'one revival upgrade, in the last tier');
  // Every tier the Lamp Post opens has something in it.
  for (let t = 1; t <= maxTier; t++) assert.ok(DATA.upgrades.some((u) => u.tier === t), `tier ${t} has an upgrade`);
});

test('content: every unlock key names research, a building level, or a map secret that exists', () => {
  const SECRETS = new Map(DATA.maps.flatMap((m) => (m.secrets || []).map((x) => [x.id, x])));
  // Every secret is well formed: an id unique across maps (its codex key), a name (the notice),
  // a radius it opens within, a relic that exists, and a tile inside its map.
  const ids = new Set();
  for (const m of DATA.maps) for (const x of m.secrets || []) {
    assert.ok(typeof x.id === 'string' && !ids.has(x.id), `secret ${x.id}: a unique id`); ids.add(x.id);
    assert.ok(typeof x.name === 'string' && x.name.length > 0, `secret ${x.id}: a name`);
    assert.ok(Number.isFinite(x.radius) && x.radius > 0, `secret ${x.id}: a radius`);
    assert.ok(DATA.relics.some((r) => r.id === x.relic), `secret ${x.id}: relic ${x.relic}`);
    assert.ok(Array.isArray(x.at) && x.at[0] >= 0 && x.at[1] >= 0 && x.at[0] < m.size[0] && x.at[1] < m.size[1], `secret ${x.id}: inside ${m.id}`);
    const g = buildMap(m.layout, m.size[0], m.size[1]);
    assert.equal(g.solid[x.at[1] * m.size[0] + x.at[0]], 0, `secret ${x.id}: on open ground (every open tile is reachable)`);
  }
  for (const [kind, list] of [['weapon', DATA.weapons], ['passive', DATA.passives], ['relic', DATA.relics], ['rune', DATA.runes], ['character', DATA.characters]]) {
    for (const x of list) {
      const u = parseUnlock(x.unlock);
      assert.notEqual(u.kind, 'unknown', `${kind} ${x.id}: unlock "${x.unlock}"`);
      if (u.kind === 'research') assert.ok(RES.has(u.id), `${kind} ${x.id}: research ${u.id}`);
      if (u.kind === 'building') {
        assert.ok(B.has(u.id), `${kind} ${x.id}: building ${u.id}`);
        assert.ok(u.level <= DATA.buildings.find((b) => b.id === u.id).levels.length, `${kind} ${x.id}: level ${u.level}`);
      }
      // A secret's relic is what its cache holds: the cache is how you meet it the first time.
      if (u.kind === 'secret') assert.ok(SECRETS.has(u.id) && kind === 'relic' && SECRETS.get(u.id).relic === x.id, `${kind} ${x.id}: the secret ${u.id} holds it`);
      if (kind === 'character') assert.ok(['starter', 'building', 'research'].includes(u.kind), `character ${x.id} can be reached`);
    }
  }
  assert.ok(DATA.characters.some((c) => c.unlock === 'starter'), 'someone to play from the start');
  assert.ok(DATA.weapons.filter((w) => w.unlock === 'starter').length >= 2, 'at least two weapons from the start');
});

/**
 * What can really drop on a map, from the drop tables the sim uses (sim/pickups.js): the map's
 * common drops (regular enemies) and elite drops, and the own table of every enemy that can appear
 * there (its bands, its events, and what splitters burst into).
 */
function droppable(map, enemies = DATA.enemies) {
  const out = new Set();
  const add = (table) => { for (const d of table || []) if (d.chance > 0) out.add(d.material); };
  add(map.commonDrops); add(map.eliteDrops);
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const e = enemies.find((x) => x.id === id);
    if (!e) return;
    add(e.drops);
    if (e.ai.into) visit(e.ai.into);
  };
  for (const b of map.timeline.bands) for (const id of Object.keys(b.roster)) visit(id);
  for (const ev of map.timeline.events) if (ev.enemy) visit(ev.enemy);
  return out;
}

test('content: the MVP economy has no dead ends: map 1 pays for everything, and everything it drops has a use', () => {
  // From the real drop tables: a material a map only claims to drop doesn't count.
  const can = new Set(DATA.maps.flatMap((m) => [...droppable(m)]));
  const dropsHere = (id) => can.has(id);
  const onMap = (m, mapId) => m.maps.includes('*') || m.maps.includes(mapId);
  const built = DATA.maps.map((m) => m.id);
  // A material's own `maps` agrees with the drop tables on every map that's built.
  for (const m of DATA.materials) for (const map of DATA.maps) {
    assert.equal(droppable(map).has(m.id), onMap(m, map.id), `${m.id} ${onMap(m, map.id) ? 'says it drops' : 'drops'} on ${map.id}${onMap(m, map.id) ? ', but nothing there drops it' : ', but its maps don\'t say so'}`);
  }
  const costs = [
    ...DATA.buildings.flatMap((b) => b.levels.map((l, i) => [`${b.id} level ${i + 1}`, l.cost])),
    ...DATA.research.map((r) => [`research ${r.id}`, r.cost]),
    ...DATA.upgrades.map((u) => [`upgrade ${u.id}`, u.cost]),
    // Phase 7: gear and what it costs to raise and re-roll, rune stones, consumables, perks.
    ...DATA.recipes.map((r) => [`gear ${r.id}`, r.cost]),
    ['rune stones', RUNE_STONE_COST], ['re-rolls', REROLL_COST],
    ...DATA.consumables.map((c) => [`consumable ${c.id}`, c.cost]),
    ...DATA.perks.map((p) => [`perk ${p.id}`, p.cost]),
  ];
  const used = new Set();
  for (const [where, cost] of costs) for (const id of Object.keys(cost)) {
    assert.ok(dropsHere(id), `${where} needs ${id}, which no map in the game drops yet`);
    used.add(id);
  }
  // The MVP harbor (§10.5) is paid for from map 1 alone, whatever later maps drop: its buildings'
  // levels, the Lamp Post's upgrades, and the research of the tiers its Library opens.
  const mvp = DATA.meta.mvpBuildings;
  assert.deepEqual(mvp.filter((id) => !DATA.buildings.some((b) => b.id === id)), [], 'the MVP buildings exist');
  const mvpTier = Math.max(...DATA.buildings.find((b) => b.id === 'library').levels.map((l) => l.researchTier ?? 0));
  const map1 = droppable(DATA.maps[0]);
  const mvpCosts = [
    ...DATA.buildings.filter((b) => mvp.includes(b.id)).flatMap((b) => b.levels.map((l, i) => [`${b.id} level ${i + 1}`, l.cost])),
    ...DATA.upgrades.map((u) => [`upgrade ${u.id}`, u.cost]),
    ...DATA.research.filter((r) => r.tier <= mvpTier).map((r) => [`research ${r.id}`, r.cost]),
  ];
  for (const [where, cost] of mvpCosts) for (const id of Object.keys(cost)) assert.ok(map1.has(id), `${where} needs ${id}, which map 1 (${DATA.maps[0].id}) doesn't drop`);
  // Every material a built map drops is wanted by something.
  for (const m of DATA.materials) if (built.some((mapId) => droppable(DATA.maps.find((x) => x.id === mapId)).has(m.id))) assert.ok(used.has(m.id), `${m.id} drops but nothing uses it`);
  // And every drop names a real material.
  for (const e of DATA.enemies) for (const d of e.drops) assert.ok(DATA.materials.some((m) => m.id === d.material), `${e.id} drops ${d.material}`);
  // A rare material comes from elites and bosses only: never a map's common drops or a regular
  // enemy's own; and somewhere it does come from one of them.
  for (const m of DATA.materials.filter((x) => x.rare)) {
    for (const map of DATA.maps) assert.ok(!map.commonDrops.some((d) => d.material === m.id), `${m.id} is rare, but ${map.id} drops it from anything`);
    for (const e of DATA.enemies.filter((x) => !x.boss)) assert.ok(!e.drops.some((d) => d.material === m.id), `${m.id} is rare, but a ${e.name} drops it`);
    const from = [...DATA.maps.flatMap((x) => x.eliteDrops), ...DATA.enemies.filter((x) => x.boss).flatMap((x) => x.drops)];
    assert.ok(from.some((d) => d.material === m.id), `${m.id} is rare: an elite or a boss drops it`);
  }
  assert.ok(DATA.materials.some((x) => x.rare) && DATA.materials.every((x) => x.rare === undefined || x.rare === true), 'rare is marked plainly (true), on some');
  // The check can fail: take rum out of every table that drops it (its enemies' own), and the
  // Tavern's costs have a dead end.
  const dryEnemies = DATA.enemies.map((e) => ({ ...e, drops: e.drops.filter((d) => d.material !== 'rum') }));
  assert.ok(droppable(DATA.maps[0]).has('rum'));
  assert.ok(!droppable(DATA.maps[0], dryEnemies).has('rum'), 'with no table dropping it, rum is not droppable');
  assert.ok(DATA.buildings.find((b) => b.id === 'tavern').levels.some((l) => l.cost.rum > 0), 'and the Tavern would ask for it');
});

test('content: Phase 7: gear, consumables, Tides, curses, arcana, challenges, feats, mastery, the Market, and the map\'s tasks', () => {
  const unlockOk = (where, ref) => {
    const u = parseUnlock(ref);
    assert.ok(['starter', 'building', 'research', 'feat', 'challenge'].includes(u.kind), `${where}: unlock "${ref}"`);
    if (u.kind === 'research') assert.ok(RES.has(u.id), `${where}: research ${u.id}`);
    if (u.kind === 'building') assert.ok(B.has(u.id) && u.level <= MAX_BUILDING_LEVEL, `${where}: building ${u.id}:${u.level}`);
    if (u.kind === 'feat') assert.ok(DATA.feats.some((f) => f.id === u.id && f.reward?.unlock), `${where}: feat ${u.id} unlocks`);
    if (u.kind === 'challenge') assert.ok(DATA.challenges.some((c) => c.id === u.id && c.reward?.unlock), `${where}: challenge ${u.id} unlocks`);
  };
  // Relics' new unlock kinds too.
  for (const r of DATA.relics) if (/^(feat|challenge):/.test(r.unlock)) unlockOk(`relic ${r.id}`, r.unlock);
  // Gear: each affix one of the four kinds, well formed (a stat's or a build's modifier the sim
  // accepts at every tier, a hook that exists with every param it needs and its grown ones among
  // them, a rule that says what it changes); each recipe in a slot, its own affix one that changes
  // the build (brief §6.3: "affixes that change builds, not flat stats"), a pool of real affixes
  // without its own, and rules only on the small things you carry.
  const AF = new Map(DATA.affixes.map((a) => [a.id, a]));
  for (const a of DATA.affixes) {
    assert.ok(['stat', 'build', 'hook', 'rule'].includes(a.kind), `affix ${a.id}: kind ${a.kind}`);
    if (a.kind === 'stat' || a.kind === 'build') for (const t of TIER_MUL) assert.equal(checkModifier({ ...a.mod, value: a.value * t }), null, `affix ${a.id} at x${t}`);
    if (a.kind === 'build') assert.ok(a.mod.tags?.length, `affix ${a.id}: a build affix is a tag's`);
    if (a.kind === 'hook') {
      assert.ok(HOOKS[a.hook], `affix ${a.id}: hook ${a.hook}`);
      for (const k of HOOKS[a.hook].needs || []) assert.ok(Number.isFinite(a.params[k]), `affix ${a.id}: ${k}`);
      assert.ok((a.grow || []).every((k) => k in a.params), `affix ${a.id}: grows what it has`);
    }
    if (a.kind === 'rule') assert.ok(a.config && Object.keys(a.config).length, `affix ${a.id}: a rule says what it changes`);
  }
  for (const r of DATA.recipes) {
    assert.ok(GEAR_SLOTS.includes(r.slot), `gear ${r.id}: slot ${r.slot}`);
    assert.ok(AF.has(r.base) && AF.get(r.base).kind !== 'stat', `gear ${r.id}: its own affix ${r.base} changes the build`);
    assert.ok(r.pool.length >= 4 && r.pool.every((id) => AF.has(id)) && !r.pool.includes(r.base), `gear ${r.id}: a pool of real affixes, not its own`);
    for (const id of [r.base, ...r.pool]) if (AF.get(id).kind === 'rule') assert.ok(RULE_SLOTS.includes(r.slot), `gear ${r.id}: a rule affix only on a ${RULE_SLOTS.join(', ')}`);
    unlockOk(`gear ${r.id}`, r.unlock);
  }
  for (const slot of GEAR_SLOTS) assert.ok(DATA.recipes.some((r) => r.slot === slot), `something to wear in the ${slot} slot`);
  for (const c of DATA.consumables) {
    assert.ok((c.mods && c.mods.length) || c.start, `consumable ${c.id}: does something`);
    for (const m of c.mods || []) assert.equal(checkModifier(m), null, `consumable ${c.id}`);
    unlockOk(`consumable ${c.id}`, c.unlock);
  }
  // Tides: 10, numbered, each harder than the one before and paying more.
  assert.deepEqual(DATA.tides.map((t) => t.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let k = 1; k < DATA.tides.length; k++) for (const key of ['hpMul', 'damageMul', 'densityMul', 'speedMul', 'rewardMul']) assert.ok(DATA.tides[k][key] > DATA.tides[k - 1][key], `Tide ${k + 1}: ${key} grows`);
  for (const c of DATA.curses) {
    assert.ok(c.rewardMul > 0 && (c.mods || c.densityMul || c.speedMul || c.noFood), `curse ${c.id}: costs something and pays`);
    for (const m of c.mods || []) assert.equal(checkModifier(m), null);
  }
  assert.ok(DATA.buildings.find((b) => b.id === 'chapel').levels.some((l) => l.curses >= DATA.curses.length - 1), 'the Chapel opens the curses');
  for (const a of DATA.arcana) unlockOk(`arcana ${a.id}`, a.unlock);
  for (const c of DATA.challenges) {
    assert.ok(W.has(DATA.characters.find((x) => x.id === c.character)?.start), `challenge ${c.id}: a character`);
    assert.ok(c.goal.surviveSec > 0 || DATA.enemies.some((e) => e.id === c.goal.boss), `challenge ${c.id}: a goal`);
    for (const p of c.pools || []) assert.ok(['weapons', 'passives', 'relics', 'runes'].includes(p));
    for (const id of c.curses || []) assert.ok(DATA.curses.some((x) => x.id === id));
    assert.ok(!c.tide || c.tide <= DATA.tides.length);
    assert.ok(c.reward.unlock || c.reward.materials, `challenge ${c.id}: a reward`);
    if (c.reward.unlock) assert.ok(contentFrom(DATA, `challenge:${c.id}`).length >= 1, `challenge ${c.id}: opens something`);
  }
  // Feats: a visibility, conditions the meta layer can judge (an impossible one would never be
  // met), and a reward; an unlocking feat opens something.
  const always = { end: 'cleared', cleared: true, tide: 10, bossesKilled: DATA.enemies.filter((e) => e.boss).map((e) => ({ id: e.id })), lanternNight: true, bellsRung: 99, maxForms: 3, untouchedSec: 9999, timeSurvived: 9999, seaGlassMax: 9999 };
  for (const f of DATA.feats) {
    assert.ok(['visible', 'after_found', 'hidden'].includes(f.visibility), `feat ${f.id}: visibility`);
    assert.ok(Object.keys(f.when || {}).length > 0, `feat ${f.id}: a condition (an empty one is always met)`);
    assert.ok(!featMet(f.when, { end: 'died', timeSurvived: 0 }, { kills: 0 }), `feat ${f.id}: not met by a run that did nothing`);
    assert.ok(featMet(f.when, always, { kills: 1e9 }), `feat ${f.id}: can be done`);
    if (f.visibility === 'after_found') assert.ok(f.found && featMet(f.found, always, { kills: 1e9 }), `feat ${f.id}: can be found`);
    assert.ok(f.reward.unlock || f.reward.materials, `feat ${f.id}: a reward`);
    if (f.reward.unlock) assert.ok(contentFrom(DATA, `feat:${f.id}`).length >= 1, `feat ${f.id}: opens something`);
  }
  // Mastery: perks at ranks the tuning has, for real characters; kits start with real weapons.
  const ranks = DATA.tuning.mastery.ranks;
  for (let k = 1; k < ranks.length; k++) assert.ok(ranks[k] > ranks[k - 1]);
  for (const p of DATA.perks) {
    assert.ok(DATA.characters.some((c) => c.id === p.character) && p.rank >= 1 && p.rank <= ranks.length, `perk ${p.id}`);
    for (const m of p.mods) assert.equal(checkModifier(m), null);
  }
  for (const k of DATA.kits) assert.ok(W.has(k.start) && DATA.characters.some((c) => c.id === k.character && c.start !== k.start) && k.rank <= ranks.length, `kit ${k.id}`);
  // The Market deals in materials map 1 drops.
  for (const id of [...DATA.market.common, ...DATA.market.rare]) assert.ok(droppable(DATA.maps[0]).has(id), `the Market trades ${id}`);
  // A map's tasks and skiff: each on open ground you can walk to from the start, at least one of
  // each kind, none on another's ring; the skiff tied up at the water's edge.
  for (const m of DATA.maps) {
    if (!m.tasks) continue;
    const w = createWorld({ seed: 1, map: m.id, character: DATA.characters[0].id, harbor: { ferry: 1 } }, DATA);
    const T = w.terrain, reach = new Uint8Array(T.cols * T.rows);
    const start = [Math.floor(w.player.x / T.tile), Math.floor(w.player.y / T.tile)];
    const queue = [start];
    reach[start[1] * T.cols + start[0]] = 1;
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (T.blocked(nx, ny) || reach[ny * T.cols + nx]) continue;
        reach[ny * T.cols + nx] = 1;
        queue.push([nx, ny]);
      }
    }
    const reachable = (px, py) => reach[Math.floor(py / T.tile) * T.cols + Math.floor(px / T.tile)] === 1;
    const kinds = new Set(w.tasks.map((t) => t.kind));
    assert.ok(kinds.has(TASK.LAMP) && kinds.has(TASK.BELL), `${m.id}: lamps and bells`);
    w.tasks.forEach((t, i) => assert.ok(reachable(t.x, t.y), `${m.id}: task ${i} on ground you can walk to`));
    for (let i = 0; i < w.tasks.length; i++) for (let j = i + 1; j < w.tasks.length; j++) {
      const a = w.tasks[i], b = w.tasks[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2 * DATA.tuning.tasks.bell.radius * 1.25, `${m.id}: tasks ${i} and ${j} apart`);
    }
    if (m.ferry) {
      const F = w.ferry;
      assert.ok(reachable(F.x, F.y), `${m.id}: the skiff's landing on ground you can walk to`);
      assert.ok(T.kinds[Math.floor(F.by / T.tile) * T.cols + Math.floor(F.bx / T.tile)] === GROUND.WATER, `${m.id}: the skiff on the water`);
      assert.equal(Math.hypot(F.x - F.bx, F.y - F.by), T.tile, `${m.id}: the skiff beside its landing`);
    }
  }
  // A task or a skiff placed off the tile grid is a plain error, not a crash.
  const off = (mapExtra) => () => createWorld({ seed: 1, map: 'odd', character: DATA.characters[0].id, harbor: { ferry: 1 } }, { ...DATA, maps: [{ ...DATA.maps[0], id: 'odd', ...mapExtra }] });
  assert.throws(off({ tasks: [{ kind: 'lamp' }] }), /needs `at: \[col, row\]`/);
  assert.throws(off({ ferry: { at: [1.5, 3] } }), /needs `at: \[col, row\]`/);
  assert.throws(off({ tasks: [{ kind: 'well', at: [10, 10] }] }), /unknown task "well"/);
});

test('content: every line a keeper has can be heard, and everyone waiting on the square has one', () => {
  // A keeper is out from their home's level 4 and says the last line in their list whose milestone
  // is reached. Each line needs a state where they're out and it's the one: the least such state
  // (home at 4, the line's own milestone reached) has none of the later lines reached. Levels only
  // go up, so if a later line is reached there, it's reached everywhere this one could be.
  for (const n of DATA.npcs) {
    n.lines.forEach((l, i) => {
      const levels = { [n.home]: 4 };
      if (l.when !== 'start') { const [b, lv] = l.when.split(':'); levels[b] = Math.max(levels[b] ?? 0, Number(lv)); }
      const doc = defaultProfile();
      Object.assign(doc.profile.buildings, levels);
      assert.ok(hubPeople(doc, DATA).some((p) => p.id === n.id), `${n.id} is out at ${JSON.stringify(levels)}`);
      assert.equal(npcLine(doc, DATA, n.id), l.text, `${n.id}'s line ${i + 1} ("${l.text}") can be heard once they're out`);
    });
  }
  // The check can fail: a line keyed before its keeper comes out is never heard.
  const early = { ...DATA.npcs[2], lines: [{ when: 'tavern:2', text: 'Never heard.' }, ...DATA.npcs[2].lines] };
  const doc = defaultProfile(); doc.profile.buildings.tavern = 4;
  assert.notEqual(npcLine(doc, { ...DATA, npcs: [early] }, early.id), 'Never heard.');
  for (const c of DATA.characters) if (c.id !== DATA.hub.avatar) assert.ok(typeof c.hubLine === 'string' && c.hubLine.length > 3 && c.hubLine.length <= 80, `${c.id} has something to say on the square`);
});

test('content: evolution and innate unlocks sit only on weapons made that way; every building level brings something', () => {
  const evolvedInto = new Set(DATA.weapons.filter((w) => w.evolution).map((w) => w.evolution.into));
  for (const [kind, list] of [['weapon', DATA.weapons], ['passive', DATA.passives], ['relic', DATA.relics], ['rune', DATA.runes], ['character', DATA.characters]]) {
    for (const x of list) {
      if (x.unlock === 'evolution') assert.ok(kind === 'weapon' && evolvedInto.has(x.id), `${kind} ${x.id}: only a weapon something evolves into is unlocked by evolving`);
      if (x.unlock === 'innate') assert.ok(kind === 'weapon' && x.innate, `${kind} ${x.id}: only a character's own weapon is innate`);
    }
  }
  for (const w of DATA.weapons) {
    if (evolvedInto.has(w.id)) assert.equal(w.unlock, 'evolution', `${w.id} is evolved into, so it's never in a pool`);
    if (w.innate) assert.equal(w.unlock, 'innate', `${w.id} is a character's own weapon`);
  }
  for (const b of DATA.buildings) {
    b.levels.forEach((lv, i) => {
      const key = `${b.id}:${i + 1}`;
      const brings = Object.keys(lv).some((k) => k !== 'cost')
        || [DATA.weapons, DATA.passives, DATA.relics, DATA.runes, DATA.characters, DATA.recipes, DATA.consumables, DATA.arcana].flat().some((x) => x.unlock === `building:${key}`)
        || DATA.hub.fog.some((f) => f.revealedBy === key) || DATA.hub.props.some((p) => p.from === key)
        || DATA.npcs.some((n) => n.home === b.id && (i + 1 === 4 || i + 1 === 5));
      assert.ok(brings, `${key} brings something`);
    });
  }
});

test('content: the harbor\'s people keep real buildings, and their lines key to real levels', () => {
  for (const n of DATA.npcs) {
    assert.ok(B.has(n.home), `${n.id}: home ${n.home}`);
    assert.ok(typeof n.sprite === 'string' && n.sprite.startsWith('npc_'), `${n.id}: sprite`);
    assert.ok(DATA.hub.keepers[n.id], `${n.id}: has a post and a walk on the map`);
    assert.ok(n.lines.length >= 1);
    for (const l of n.lines) {
      const m = /^([a-z_]+):(\d)$/.exec(l.when);
      assert.ok(l.when === 'start' || (m && B.has(m[1]) && Number(m[2]) >= 1 && Number(m[2]) <= MAX_BUILDING_LEVEL), `${n.id}: line keyed to "${l.when}"`);
      assert.ok(typeof l.text === 'string' && l.text.length > 3 && l.text.length <= 80, `${n.id}: "${l.text}" fits on a line`);
    }
  }
});

/**
 * Every plot or ruin that shows half in the fog at some mix of building levels (each building at 0
 * and at every level that clears a region): a building is either clear with clear ground all
 * round it, or in the fog with fog all round it. [] when all is well.
 */
function fogEdgeProblems(hub, map, buildings) {
  const reached = (levels, key) => key === 'start' || (levels[key.split(':')[0]] ?? 0) >= Number(key.split(':')[1]);
  const steps = buildings.map((b) => [b.id, [0, ...new Set(hub.fog.filter((f) => f.revealedBy.startsWith(`${b.id}:`)).map((f) => Number(f.revealedBy.split(':')[1])))]]);
  const mixes = steps.reduce((acc, [id, lvs]) => acc.flatMap((m) => lvs.map((lv) => ({ ...m, [id]: lv }))), [{}]);
  const problems = [];
  for (const levels of mixes) {
    const clear = clearTiles(map, new Set(hub.fog.filter((f) => reached(levels, f.revealedBy)).map((f) => f.id)));
    for (const p of [...hub.plots, ...hub.ruins]) {
      const inside = [], ring = [];
      for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) {
        if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) continue;
        (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h ? inside : ring).push(clear[y * map.cols + x] === 1);
      }
      const out = inside[0], where = `${p.building || p.id} at ${JSON.stringify(levels)}`;
      if (!inside.every((c) => c === out)) problems.push(`${where}: half in the fog`);
      else if (!ring.every((c) => c === out)) problems.push(`${where}: ${out ? 'fog' : 'clear ground'} right against it`);
    }
  }
  return problems;
}

test('content: the harbor map: plots, doors, fog, the gate, the pier, and every walk fit together', () => {
  const hub = DATA.hub;
  const map = buildHubMap(hub, HUB_TERRAIN);
  const regionOk = (key) => key === 'start' || (/^([a-z_]+):(\d)$/.test(key) && B.has(key.split(':')[0]) && Number(key.split(':')[1]) <= MAX_BUILDING_LEVEL);
  assert.equal(new Set(hub.fog.map((f) => f.id)).size, hub.fog.length, 'fog region ids are unique');
  for (const f of hub.fog) assert.ok(regionOk(f.revealedBy), `fog ${f.id}: revealed by "${f.revealedBy}"`);
  assert.deepEqual(hub.plots.map((p) => p.building).sort(), DATA.buildings.map((b) => b.id).sort(), 'every building has a plot, and every plot a building');
  // What's open for a set of building levels.
  const openFor = (levels) => {
    const revealed = new Set(hub.fog.filter((f) => f.revealedBy === 'start' || (levels[f.revealedBy.split(':')[0]] ?? 0) >= Number(f.revealedBy.split(':')[1])).map((f) => f.id));
    return solidTiles(map, clearTiles(map, revealed));
  };
  const open = (solid, [x, y]) => !solid[y * map.cols + x];
  // A plot's door can be reached once the fog in front of it clears (its openAt; 'start' from the
  // beginning), and not before: a ruin in the fog can't be walked up to (meta/actions.js says so).
  const levelsAt = (key) => (!key || key === 'start' ? {} : { [key.split(':')[0]]: Number(key.split(':')[1]) });
  const start = openFor({});
  assert.ok(open(start, hub.spawn), 'you start on open ground');
  assert.equal(DATA.characters.find((c) => c.id === hub.avatar)?.unlock, 'starter', 'you walk the harbor as a character you have from the start');
  assert.ok(hub.waiting.length >= DATA.characters.length - 1, 'a waiting spot for every other character');
  assert.equal(new Set(hub.waiting.map(String)).size, hub.waiting.length, 'waiting spots are all different');
  const reach = reachableFrom(map, start, hub.spawn);
  const canReach = ([x, y]) => reach[y * map.cols + x] === 1;
  for (const p of hub.plots) {
    assert.ok(regionOk(p.openAt ?? 'start'), `${p.building}: opens at "${p.openAt}"`);
    const at = reachableFrom(map, openFor(levelsAt(p.openAt)), hub.spawn);
    assert.equal(at[p.door[1] * map.cols + p.door[0]], 1, `${p.building}: its door ${p.door} can be reached at ${p.openAt ?? 'start'}`);
    assert.equal(canReach(p.door), !p.openAt || p.openAt === 'start', `${p.building}: its door is in the fog until ${p.openAt}`);
    const [dx, dy] = p.door;
    if (p.anySide) {
      // Used from any side (the Lamp Post): its prompt's tile touches the plot.
      const nx = Math.max(p.x, Math.min(dx, p.x + p.w - 1)), ny = Math.max(p.y, Math.min(dy, p.y + p.h - 1));
      assert.equal(Math.abs(dx - nx) + Math.abs(dy - ny), 1, `${p.building}: its door ${p.door} is beside it`);
    } else assert.ok(dy === p.y + p.h && dx >= p.x && dx < p.x + p.w, `${p.building}: the door ${p.door} is just below the building`);
  }
  const ruinIds = hub.ruins.map((r) => r.id);
  assert.equal(new Set(ruinIds).size, ruinIds.length, 'ruin ids are unique');
  for (const id of ruinIds) assert.ok(ID_RE.test(id) && !B.has(id), `ruin ${id}: its own id, not a building that has a plot`);
  assert.ok(canReach(hub.gate.at), 'the gate can be reached from the start');
  for (const t of hub.waiting) assert.ok(canReach(t), `waiting spot ${t}`);
  assert.equal(hub.map[hub.harbor.landing[1]][hub.harbor.landing[0]], '=', 'arrivals land on the pier');
  assert.deepEqual(hub.harbor.walkUp[0], hub.harbor.landing, 'the walk up starts where the boat lands');
  // The boat stays on the water the whole way in (off the map counts: it sails in from the edge).
  const route = hub.harbor.boatRoute;
  for (let k = 1; k < route.length; k++) {
    for (let s = 0; s <= 32; s++) {
      const x = Math.round(route[k - 1][0] + (route[k][0] - route[k - 1][0]) * s / 32), y = Math.round(route[k - 1][1] + (route[k][1] - route[k - 1][1]) * s / 32);
      if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) continue;
      assert.equal(hub.map[y][x], '~', `the boat's route, leg ${k}, is on water at ${x}, ${y}`);
    }
  }
  const last = route[route.length - 1], land = hub.harbor.landing;
  assert.ok(last[1] === land[1] && Math.abs(last[0] - land[0]) <= 2, 'the boat ties up beside the landing');
  // Every arrival's walk, to every waiting spot, is open from the start.
  for (const t of hub.waiting) {
    const path = arrivalPath(hub, t);
    for (let k = 1; k < path.length; k++) assert.ok(segmentOpen(map, start, path[k - 1], path[k]), `the walk to ${t}, leg ${k}: ${path[k - 1]} -> ${path[k]}`);
  }
  // Keepers: each stands at their post from their building's level 4 and walks their loop from
  // level 5, with nothing else restored (their own streets are enough).
  for (const n of DATA.npcs) {
    const k = hub.keepers[n.id];
    const plot = hub.plots.find((p) => p.building === n.home), opens = levelsAt(plot.openAt);
    const at4 = openFor({ ...opens, [n.home]: 4 }), at5 = openFor({ ...opens, [n.home]: 5 });
    assert.ok(open(at4, k.post), `${n.id}: post ${k.post} is open at ${n.home} level 4`);
    assert.deepEqual(k.loop[0], k.post, `${n.id}: the walk starts at the post`);
    for (let i = 0; i < k.loop.length; i++) {
      const a = k.loop[i], b = k.loop[(i + 1) % k.loop.length];
      assert.ok(segmentOpen(map, at5, a, b), `${n.id}: walk leg ${a} -> ${b} is open at ${n.home} level 5`);
    }
  }
  // Fully restored: you can still reach every door and the gate.
  const full = openFor(Object.fromEntries(DATA.buildings.map((b) => [b.id, 5])));
  const fullReach = reachableFrom(map, full, hub.spawn);
  for (const p of hub.plots) assert.equal(fullReach[p.door[1] * map.cols + p.door[0]], 1);
  assert.equal(fullReach[hub.gate.at[1] * map.cols + hub.gate.at[0]], 1);

  // The small lamps (the gate's on the sea wall, the pier's at the pier's end): posts on solid
  // ground, the pier's on the pier; each solid, off every building, prop, and walk.
  const lampOn = (at) => hub.map[at[1]][at[0]];
  assert.equal(lampOn(hub.gate.lamp), 'w', `the gate's lamp ${hub.gate.lamp} stands on the sea wall`);
  assert.ok(Math.abs(hub.gate.lamp[0] - hub.gate.at[0]) + Math.abs(hub.gate.lamp[1] - hub.gate.at[1]) <= 2, `beside the gate at ${hub.gate.at}`);
  assert.equal(lampOn(hub.harbor.lamp), '=', `the pier's lamp ${hub.harbor.lamp} stands on the pier`);
  for (const at of [hub.gate.lamp, hub.harbor.lamp]) {
    assert.ok(!map.footprint[at[1] * map.cols + at[0]], `the lamp at ${at} is off every building`);
    assert.equal(start[at[1] * map.cols + at[0]], 1, `the lamp at ${at} is solid`);
    assert.ok(!hub.props.some((p) => String(p.at) === String(at)), `no prop on the lamp at ${at}`);
  }

  // Props: each on open ground no one needs (not a door, the gate, the spawn, a post, a walk, a
  // waiting spot, or an arrival's path), clear of the fog from the moment it appears; and with every
  // prop out and only the starting fog gone, every door and the gate can still be reached.
  const keyOk = (key) => key === 'start' || (/^([a-z_]+):(\d)$/.test(key) && B.has(key.split(':')[0]) && Number(key.split(':')[1]) <= MAX_BUILDING_LEVEL);
  const reserved = new Set([hub.spawn, hub.gate.at, ...hub.plots.map((p) => p.door), ...hub.waiting].map(String));
  const walkTiles = (path, loop) => {
    const out = [];
    for (let i = 0; i + (loop ? 0 : 1) < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      for (let x = a[0], y = a[1]; ; x += dx, y += dy) { out.push([x, y]); if (x === b[0] && y === b[1]) break; }
    }
    return out;
  };
  for (const k of Object.values(hub.keepers)) { reserved.add(String(k.post)); for (const t of walkTiles(k.loop, true)) reserved.add(String(t)); }
  for (const t of hub.waiting) for (const q of walkTiles(arrivalPath(hub, t), false)) reserved.add(String(q));
  assert.equal(new Set(hub.props.map((p) => p.id)).size, hub.props.length, 'prop ids are unique');
  assert.equal(new Set(hub.props.map((p) => String(p.at))).size, hub.props.length, 'each prop has a tile of its own');
  for (const at of [hub.gate.lamp, hub.harbor.lamp]) reserved.add(String(at));
  for (const p of hub.props) {
    assert.ok(keyOk(p.from), `prop ${p.id}: from "${p.from}"`);
    assert.ok(typeof p.sprite === 'string' && p.sprite.startsWith('hub_'), `prop ${p.id}: sprite`);
    const [x, y] = p.at;
    assert.ok(HUB_TERRAIN[hub.map[y][x]].walk && !map.footprint[y * map.cols + x], `prop ${p.id} stands on open ground`);
    assert.ok(!reserved.has(String(p.at)), `prop ${p.id} at ${p.at} is out of everyone's way`);
    const lv = p.from === 'start' ? {} : { [p.from.split(':')[0]]: Number(p.from.split(':')[1]) };
    assert.ok(open(openFor(lv), p.at), `prop ${p.id} is out of the fog when it appears`);
  }
  const crowded = solidTiles(map, clearTiles(map, new Set(['square'])), hub.props);
  const crowdedReach = reachableFrom(map, crowded, hub.spawn);
  for (const p of hub.plots) {
    if (p.openAt && p.openAt !== 'start') {
      // In the fog at the start: with every prop out and its own fog gone, it can be reached.
      const lv = levelsAt(p.openAt), ids = new Set(hub.fog.filter((f) => f.revealedBy === 'start' || (lv[f.revealedBy.split(':')[0]] ?? 0) >= Number(f.revealedBy.split(':')[1])).map((f) => f.id));
      const r = reachableFrom(map, solidTiles(map, clearTiles(map, ids), hub.props), hub.spawn);
      assert.equal(r[p.door[1] * map.cols + p.door[0]], 1, `${p.building}'s door with every prop out, at ${p.openAt}`);
    } else assert.equal(crowdedReach[p.door[1] * map.cols + p.door[0]], 1, `${p.building}'s door with every prop out`);
  }
  assert.equal(crowdedReach[hub.gate.at[1] * map.cols + hub.gate.at[0]], 1, 'the gate with every prop out');

  // A building comes out of the fog all at once (§20 call 54), at every mix of levels; and the
  // check catches the two ways it can go wrong: fog cutting through a ruin, and cleared ground
  // right against one still in the fog (the fog's soft edge would show its bottom row).
  assert.deepEqual(fogEdgeProblems(hub, map, DATA.buildings), [], 'every building comes out of the fog all at once');
  const withLamp1 = (rect) => { const h = { ...hub, fog: hub.fog.map((f) => (f.id === 'lamp_1' ? { ...f, rects: [rect] } : f)) }; return fogEdgeProblems(h, buildHubMap(h, HUB_TERRAIN), DATA.buildings).join('\n'); };
  assert.match(withLamp1([18, 5, 22, 20]), /^chapel at \{"lamp_post":1,"library":0,"tavern":0[^}]*\}: half in the fog$/m);
  assert.match(withLamp1([18, 7, 22, 18]), /^chapel at \{"lamp_post":1,"library":0,"tavern":0[^}]*\}: clear ground right against it$/m);
  // Windows: where the art has them.
  for (const p of hub.plots.filter((q) => q.windows)) {
    assert.deepEqual(p.windows, openings(BUILDINGS_LAYOUT[p.building]).windows, `${p.building}'s windows match its art`);
  }
});
