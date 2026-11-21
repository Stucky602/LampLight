// Content (ARCHITECTURE §11, §14.1): every data file against its schema, every reference
// resolves, every hook exists, every capstone's partner is real, and every weapon with each of its
// lines, specials, and Form options actually runs.
import { SKILL_RANKS } from '../src/data/skills.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { buildMap } from '../src/sim/terrain.js';
import { HOOKS, HOOK_POINTS } from '../src/sim/hooks.js';
import { checkModifier, combine, WEAPON_DEFAULTS, PLAYER_STAT_IDS } from '../src/sim/stats.js';
import { EMIT, MOTION, FX, AI, STATUS_IDS } from '../src/sim/constants.js';
import { FORM_KEYS } from '../src/sim/forms.js';
import { makeWorld, give, spawnAt, run, TOP } from './helpers/simworld.js';
import { HUB_TERRAIN } from '../src/data/hub.js';
import { MAX_BUILDING_LEVEL } from '../src/data/buildings.js';
/** A building's own number of levels (five; the Lighthouse's ten stages, 0.9.0). */
const LEVELS = (id) => DATA.buildings.find((b) => b.id === id)?.levels.length ?? 0;
import { parseUnlock, npcLine, hubPeople, contentFrom } from '../src/meta/state.js';
import { defaultProfile } from '../src/save/schema.js';
import { buildHubMap, clearTiles, solidTiles, reachableFrom, segmentOpen, arrivalPath } from '../src/hub/map.js';
import { createHubTuning, checkHubTune, hubTuneRange } from '../src/hub/tuning.js';
import { HUB_TUNING_RANGE } from '../src/data/tuning.js';
import { lookColor } from '../src/render/hubtiles.js';
import { BUILDINGS_LAYOUT } from '../art/manifest.js';
import { openings } from '../art/draw/hub.js';
import { REROLL_COST, GEAR_SLOTS, TIER_MUL, RULE_SLOTS, GEAR_TIER_EXTRA } from '../src/data/gear.js';
import { MAP_LAYERS } from '../src/meta/runconfig.js';
import { TASK } from '../src/sim/constants.js';
import { GROUND } from '../src/sim/terrain.js';
import { featMet, FEAT_KEYS } from '../src/meta/feats.js';
import { ORDER_GROUPS } from '../src/data/feats.js';
import { createWorld } from '../src/sim/world.js';

const ID_RE = /^[a-z][a-z0-9_]*$/;
const ids = (list) => new Set(list.map((x) => x.id));
const W = ids(DATA.weapons), P = ids(DATA.passives);
const EN = ids(DATA.enemies), MAT = ids(DATA.materials), BOSS = ids(DATA.bosses);

test('content: ids are unique, permanent-looking (snake_case), and every entry has a name and plain description', () => {
  for (const [kind, list] of Object.entries(DATA)) {
    // ascensions: their own test (lines of options); tides go by level, not id (data/tide.js).
    // glossaryKinds: the glossary's group names, [kind, label] (data/glossary.js); tests/glossary.test.js checks both.
    if (!Array.isArray(list) || kind === 'ascensions' || kind === 'tides' || kind === 'glossaryKinds') continue;
    const seen = new Set();
    for (const x of list) {
      assert.ok(ID_RE.test(x.id), `${kind}: bad id "${x.id}"`);
      assert.ok(!seen.has(x.id), `${kind}: duplicate id "${x.id}"`);
      seen.add(x.id);
      if (kind === 'recipes' || kind === 'affixes' || kind === 'rarities') { assert.equal(typeof x.name, 'string', `${kind} ${x.id}: name`); continue; }
      if (kind !== 'bosses') {
        assert.equal(typeof x.name, 'string', `${kind} ${x.id}: name`);
        // A building's is the paragraph at the top of its panel, so it gets a little more room.
        // A glossary entry (0.9.0) says everything a term does, so it gets a paragraph.
        const max = kind === 'buildings' ? 200 : kind === 'glossary' ? 700 : 140;
        assert.ok(typeof x.desc === 'string' && x.desc.length > 3 && x.desc.length < max, `${kind} ${x.id}: desc`);
      }
    }
  }
});

test('content: weapons have valid numbers, pipelines, number lines, Rare and Epic lines, and specials; none evolves (ruling 14, C1)', () => {
  const baseKeys = new Set(Object.keys(WEAPON_DEFAULTS));
  const NUMS = new Set(DATA.weaponUps.filter((t) => t.stat).map((t) => t.id));
  const own = new Set();
  const boostOk = (at, b, kind) => {
    assert.ok(b && (b.stats || b.onHit || b.emit || b.motion || b.fx), `${at}: its boost changes something`);
    for (const k of Object.keys(b)) assert.ok(['stats', 'onHit', 'emit', 'motion', 'fx'].includes(k), `${at}: boost ${k}`);
    for (const e of b.onHit || []) assert.ok(FX[e.type] !== undefined && (e.type !== 'status' || STATUS_IDS.includes(e.status)), `${at}: on-hit ${e.type}`);
    for (const k of Object.keys(b.fx || {})) assert.ok(FORM_KEYS.includes(k), `${at}: mechanic ${k}`);
    // Only a fire option replaces an emitter's type and only a travel option a motion's (C1-CONTRACT 2).
    if (b.emit?.type) assert.equal(kind, 'delivery', `${at}: only how it fires replaces the emitter`);
    if (b.motion?.type) assert.equal(kind, 'flight', `${at}: only how its shots travel replaces the motion`);
  };
  for (const w of DATA.weapons) {
    const at = `weapon ${w.id}`;
    assert.ok(Array.isArray(w.tags) && w.tags.length >= 1 && w.tags.length <= 3, `${at}: 1 to 3 tags (brief §5.3)`);
    for (const [k, v] of Object.entries(w.base)) {
      assert.ok(baseKeys.has(k), `${at}: unknown base stat ${k}`);
      assert.ok(Number.isFinite(v), `${at}: base ${k} = ${v}`);
    }
    assert.ok(w.base.cooldown > 0, `${at}: cooldown`);
    for (const k of ['maxLevel', 'levels', 'runeSlots']) assert.equal(w[k], undefined, `${at}: no ${k}`);
    assert.ok(Array.isArray(w.numbers), `${at}: its number lines`);
    if (w.innate) { assert.deepEqual(w.numbers, [], `${at}: a character's built-in weapon never rolls`); continue; }
    assert.ok(w.numbers.includes('damage'), `${at}: damage is in every pool (the pool never runs dry)`);
    assert.equal(new Set(w.numbers).size, w.numbers.length, `${at}: each type once`);
    for (const u of w.numbers) assert.ok(NUMS.has(u), `${at}: number type ${u}`);
    const has = (u) => w.numbers.includes(u);
    const base = { ...WEAPON_DEFAULTS, ...w.base };
    if (base.pierce < 0) assert.ok(!has('pierce'), `${at}: no Pierce on a weapon that passes through everything`);
    if (!(base.hitCooldown > 0)) assert.ok(!has('hit_cooldown'), `${at}: no Hit Delay without its own`);
    if (w.pipeline.emit.type === 'aura') assert.ok(!has('amount'), `${at}: an aura has no count`);
    const C = DATA.tuning.weaponUps.caps;
    if (base.hitCooldown > 0 && base.duration < base.hitCooldown) {
      const longest = base.duration * (has('duration') ? C.duration : 1), shortest = base.hitCooldown * (has('hit_cooldown') ? C.hitCooldown : 1);
      assert.ok(longest < shortest, `${at}: once a shot, its upgrades keep it so`);
    }
    if (w.signature) continue;   // (a signature's lines and specials are C2's: data/signatures.js)
    for (const k of ['upgrades', 'upCaps', 'upMul', 'core', 'special']) assert.equal(w[k], undefined, `${at}: no ${k} (ruling 14: the v4 format)`);
    assert.ok(typeof w.unit === 'string' && typeof w.units === 'string', `${at}: what one of its count is called`);
    assert.ok(P.has(w.partner), `${at}: a partner passive`);
    // Rare and Epic lines: three, at least one of each, ids its own.
    assert.ok(Array.isArray(w.lines) && w.lines.length >= 3, `${at}: its Rare and Epic lines`);
    assert.ok(w.lines.some((l) => l.rarity === 'rare') && w.lines.some((l) => l.rarity === 'epic'), `${at}: a Rare line and an Epic line`);
    for (const l of w.lines) {
      assert.ok(ID_RE.test(l.id) && !own.has(`${w.id}:${l.id}`), `${at}: line ${l.id}`);
      own.add(`${w.id}:${l.id}`);
      assert.match(l.desc, /^[A-Z].*\.$/, `${at}: line ${l.id} says what it does`);
      boostOk(`${at} line ${l.id}`, l.boost, 'line');
    }
    // Legendary specials: two or three, at least one changes how you move or where you stand.
    assert.ok(Array.isArray(w.specials) && w.specials.length >= 2 && w.specials.length <= 3, `${at}: two or three specials`);
    assert.ok(w.specials.some((x) => x.moves), `${at}: a special that changes how you move or where you stand`);
    for (const x of w.specials) { assert.match(x.desc, /^[A-Z].*\.$/, `${at}: special ${x.id} says what it does`); boostOk(`${at} special ${x.id}`, x.boost, 'special'); }
    // Its deed (sim/deeds.js).
    const d = w.deed;
    assert.ok(d && ['kills', 'multi', 'hits'].includes(d.kind) && Number.isInteger(d.count) && d.count > 0 && /^[A-Z]/.test(d.text) && !/px/.test(d.text), `${at}: a deed, said without pixels`);
    assert.ok(d.text.includes(String(d.count)), `${at}: the deed's line says its count`);
    if (d.kind === 'multi') assert.ok(d.n >= 2 && d.within > 0, `${at}: a multi deed's n and window`);
    assert.ok(EMIT[w.pipeline.emit.type] !== undefined, `${at}: emitter ${w.pipeline.emit.type}`);
    assert.ok(MOTION[w.pipeline.motion.type] !== undefined, `${at}: motion ${w.pipeline.motion.type}`);
    assert.ok(w.pipeline.onHit.length >= 1 && w.pipeline.onHit.every((e) => FX[e.type] !== undefined), `${at}: on-hit list`);
    for (const e of w.pipeline.onHit) if (e.type === 'status') assert.ok(STATUS_IDS.includes(e.status), `${at}: status ${e.status}`);
    const lasting = ['aura', 'beam', 'summon', 'orbit'].includes(w.pipeline.emit.type) || w.base.pierce === -1;
    if (lasting) assert.ok(w.base.hitCooldown > 0, `${at}: lasting hits need a hitCooldown`);
    assert.equal(w.evolution, undefined, `${at}: nothing evolves (Forms are the only transformation)`);
    assert.notEqual(w.unlock, 'evolution', `${at}: no weapon is an evolution`);
  }
  // Forms (C1-CONTRACT 4): every drafted weapon has a line of six options, two an axis, each with its
  // price, the capstone options marked; a line's capstoneUnlock is a research key.
  for (const l of DATA.ascensions) {
    const w = DATA.weapons.find((x) => x.id === l.weapons[0]);
    assert.ok(w, `${l.line}: its weapon`);
    if (w.signature) continue;
    assert.deepEqual(l.options.map((o) => o.axis), ['delivery', 'delivery', 'flight', 'flight', 'payoff', 'payoff'], `${l.line}: two options on each axis`);
    for (const o of l.options) {
      assert.ok(typeof o.price === 'string' && o.price.length > 2 && !/\.$/.test(o.price), `${o.id}: its price, as a short line`);
      assert.equal(!!o.capstone, o.axis === 'payoff', `${o.id}: the capstone axis's options are capstones`);
      assert.match(o.desc, /^[A-Z+].*\.$/, `${o.id}: says what it does`);
      boostOk(`${o.id}`, o.boost, o.axis);
      assert.equal(o.needs, undefined, `${o.id}: no needs (ruling 14)`);
    }
    if (l.capstoneUnlock !== undefined) assert.match(l.capstoneUnlock, /^(research|feat):[a-z_]+$/, `${l.line}: opened by the Library or a Harbor Order`);
  }
  // A retired evolution is no weapon now.
  for (const id of Object.keys(DATA.retiredWeapons)) assert.ok(!W.has(id), `${id} is retired`);
});

test('content: passives, relics, characters, enemies, bosses, and maps are all well formed', () => {
  for (const p of DATA.passives) {
    assert.equal(p.levels.length, p.maxLevel, `passive ${p.id}: one modifier list per level`);
    for (const list of p.levels) {
      assert.ok(Array.isArray(list) && list.length >= 1, `passive ${p.id}: each level adds something`);
      for (const m of list) assert.equal(checkModifier(m), null, `passive ${p.id}: ${JSON.stringify(m)}`);
    }
  }
  const paramsOk = (who, hook, params) => {
    for (const k of HOOKS[hook].needs || []) assert.ok(Number.isFinite(params?.[k]), `${who}: hook ${hook} needs a number for "${k}"`);
  };
  for (const r of DATA.relics) {
    // A hook, stat modifiers, or both; a tier (Trinket, Charm, Relic).
    assert.ok(r.hook || r.rule || (r.mods && r.mods.length), `relic ${r.id}: does something`);
    assert.ok([1, 2, 3].includes(r.tier), `relic ${r.id}: tier 1, 2, or 3`);
    if (r.hook) { assert.ok(HOOKS[r.hook], `relic ${r.id}: hook ${r.hook} exists`); paramsOk(`relic ${r.id}`, r.hook, r.params); }
    for (const m of r.mods || []) assert.equal(checkModifier(m), null);
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
      if (e.event === 'eye' || e.event === 'chest') continue;   // (no enemy: the Marsh's Eye, a chest)
      assert.ok(EN.has(e.enemy), `map ${m.id}: event enemy ${e.enemy}`);
      assert.equal(isBoss(e.enemy), e.event === 'boss', `map ${m.id}: ${e.event} at ${e.at} s with ${e.enemy} (boss events, and only they, spawn bosses)`);
      if (e.otherwise) assert.ok(EN.has(e.otherwise.enemy) && !isBoss(e.otherwise.enemy), `map ${m.id}: ${e.event} at ${e.at} s: what comes otherwise`);
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
    // A quarter of the crowd can die in the sweep (0.8.0), so a piece that acts on a kill (a spill, a kill burst) shows what it does.
    w.enemies.hp[i] = w.enemies.maxHp[i] = k % 4 === 1 ? 40 : 400;
  }
  return w;
}

function hashEnemies(w) {
  const E = w.enemies;
  let h = 0;
  for (let i = 0; i < E.count; i++) h = (h * 31 + Math.round((E.x[i] + E.y[i] + E.hp[i] + E.freezeT[i] + E.slowT[i] + E.burnT[i] + E.rotT[i] + E.dazeT[i]) * 100)) % 1000000007;
  return h;
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

test('content: every weapon bare, and with each of its lines, specials, and Form options, runs 600 ticks cleanly, and each changes what it does', () => {
  let combos = 0;
  DATA.weapons.forEach((def, wi) => {
    if (def.innate) return;
    const line = DATA.ascensions.find((l) => l.weapons.includes(def.id));
    const sets = [{}];
    for (const l of def.lines || []) sets.push({ lines: [l.id] });
    for (const x of def.specials || []) sets.push({ specials: [x.id] });
    for (const o of line?.options || []) sets.push({ forms: [o.id] });
    let bare = null;
    for (const extra of sets) {
      // The same seed and crowd for the bare weapon and each piece, so one that does nothing shows
      // as the same damage to the hit point. The player walks, then stands, so walk- and stand-fired
      // pieces get their turn too (ruling 16: nothing fires from the dash).
      const w = sweepWorld(100 + wi);
      give(w, def.id, { slot: def.signature ? 0 : 1, level: TOP, ...extra });
      run(w, 200, { mx: 60, my: 30, buttons: 0 }, { halts: 'pass' });
      run(w, 200, { mx: -60, my: -30, buttons: 0 }, { halts: 'pass' });   // (back the way it came: away from the crowd, over its own trail)
      run(w, 200, { mx: 0, my: 0, buttons: 0 }, { halts: 'pass' });
      const what = `${def.id} + ${JSON.stringify(extra)}`;
      assert.equal(finite(w), null, `${what}: something went non-finite`);
      assert.ok(w.result.damageBySlot.some((d) => d > 0), `${what}: never hurt anything`);
      // What it did to the fight: the damage dealt and the enemies' state (a longer freeze changes the second, not the first).
      const dealt = `${w.result.damageBySlot.reduce((x, y) => x + y, 0).toFixed(3)} / ${w.result.totalKills} / ${hashEnemies(w)}`;
      if (!Object.keys(extra).length) bare = dealt;
      // (Well-Trodden needs its own walk back over fresh glass: tests/forms.test.js checks it.)
      else if (!def.signature && !(extra.specials || []).includes('well_trodden')) assert.notEqual(dealt, bare, `${what}: does exactly what the bare weapon does`);
      combos++;
    }
  });
  assert.ok(combos >= 150, `${combos} combinations`);
});

test('content: ruling 16: nothing in the data fires from the dash, no hook reads it, and every dash item is plain', async () => {
  const { DASH_UPS } = await import('../src/sim/dash.js');
  // No hook point for the dash, and no hook, Form, line, special, relic, passive, or gear text that fires from it.
  assert.ok(!HOOK_POINTS.includes('onDash'), 'no onDash hook point');
  for (const [id, h] of Object.entries(HOOKS)) assert.equal(h.onDash, undefined, `hook ${id} reads the dash`);
  const said = [
    ...DATA.weapons.flatMap((w) => [...(w.lines || []), ...(w.specials || [])].map((x) => [`${w.id} ${x.id}`, x.desc])),
    // (The signatures' Forms are C2's to sweep: work/cw/C1.md. Its port extends this to them.)
    ...DATA.ascensions.filter((l) => !DATA.weapons.find((w) => w.id === l.weapons[0])?.signature).flatMap((l) => l.options.map((o) => [o.id, o.desc])),
    ...DATA.relics.map((r) => [r.id, r.desc]), ...DATA.passives.map((p) => [p.id, `${p.desc} ${p.keystone?.desc ?? ''}`]),
    ...DATA.affixes.map((a) => [a.id, a.name]),
  ];
  for (const [id, text] of said) assert.ok(!/\bdash/i.test(text), `${id}: "${text}" names the dash (only a dash item may)`);
  for (const w of DATA.weapons) for (const x of [...(w.lines || []), ...(w.specials || [])]) assert.equal(x.boost?.fx?.dashfire, undefined, `${w.id} ${x.id}: dashfire`);
  // A walk-, stand-, or clock-fired piece has a clock of its own (the loop check: no kill rate can speed it).
  const cued = [...DATA.weapons.flatMap((w) => [...(w.lines || []), ...(w.specials || [])]), ...DATA.ascensions.flatMap((l) => l.options)];
  for (const x of cued) {
    const fx = x.boost?.fx || {};
    for (const k of ['cue', 'lunge', 'kick']) if (fx[k]) assert.ok(fx[k].every > 0, `${x.id}: ${k} fires on a clock of its own`);
  }
  // Dash items (data/dashes.js, C2's): only how the dash goes, a mark that never hurts, cards from the list.
  const keys = new Set(['id', 'name', 'desc', 'character', 'icon', 'dist', 'time', 'cooldown', 'charges', 'guard', 'mark', 'numbers', 'weight', 'unlock']);
  assert.ok(DATA.dashes.length >= 3, 'dash items');
  for (const d of DATA.dashes) {
    for (const k of Object.keys(d)) assert.ok(keys.has(k), `dash ${d.id}: ${k}`);
    for (const k of ['dist', 'time', 'cooldown', 'guard']) if (d[k] !== undefined) assert.ok(d[k] > 0, `dash ${d.id}: ${k}`);
    if (d.charges !== undefined) assert.ok(Number.isInteger(d.charges) && d.charges >= 1 && d.charges <= DATA.tuning.dashes.caps.charges, `dash ${d.id}: charges`);
    if (d.mark) {
      assert.ok(['slow', 'knock'].includes(d.mark.kind) && ['path', 'end'].includes(d.mark.where), `dash ${d.id}: mark`);
      assert.equal(d.mark.damage, undefined, `dash ${d.id}: a mark never hurts`);
    }
    for (const u of d.numbers) assert.ok(DASH_UPS.includes(u), `dash ${d.id}: card ${u}`);
    if (d.character) assert.ok(DATA.characters.some((c) => c.id === d.character), `dash ${d.id}: ${d.character}`);
  }
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

const GROWING = ['tree', 'researchTier', 'researchSlots', 'lampSpeed', 'ferry', 'gearSlots', 'gearTier', 'tideMax', 'curses', 'market', 'glassToCoin', 'consumableSlots', 'stage', 'consumableSlotsAdd', 'researchSlotsAdd', 'marketRaresAdd', 'foodHeal'];
const FLAGS = ['feats', 'mastery', 'reroll', 'tempering', 'bellRing', 'tasksOnMap', 'findsOnMap', 'challenges', 'shortRuns', 'secretsOnMap', 'heirloom', 'lampSpeedAdd', 'bellRingAdd'];

test('content: buildings have five levels, real costs, and effects that only grow', () => {
  for (const b of DATA.buildings) {
    if (b.id === 'lighthouse') {
      // 0.9.0: the Lighthouse is ten stages, each named, its stage numbered on each level.
      assert.equal(b.levels.length, 10, 'the Lighthouse: ten stages');
      assert.equal(b.stages.length, 10, 'each stage named');
      b.levels.forEach((lv, i) => assert.equal(lv.stage, i + 1, `stage ${i + 1}`));
    } else assert.equal(b.levels.length, MAX_BUILDING_LEVEL, `${b.id}: five levels (brief §6.1)`);
    assert.ok(MAT.has(b.material), `${b.id}: its material ${b.material}`);
    assert.ok(DATA.npcs.some((n) => n.id === b.npc && n.home === b.id), `${b.id}: its keeper ${b.npc} lives there`);
    // Numbers that only grow (data/buildings.js), and flags a level turns on.
    const seen = Object.fromEntries(GROWING.map((k) => [k, 0]));
    b.levels.forEach((lv, i) => {
      checkCost(`${b.id} level ${i + 1}`, lv.cost);
      assert.ok(lv.cost[b.material] > 0, `${b.id} level ${i + 1} uses its own material, ${b.material}`);
      for (const k of Object.keys(lv)) assert.ok(k === 'cost' || k === 'needs' || GROWING.includes(k) || FLAGS.includes(k), `${b.id} level ${i + 1}: unknown effect "${k}"`);   // (needs: X3, D5; tests/sweep-x3.test.js)
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
    // (0.9.0: a capstone Form counts: the brief's "research reveals evolution recipes".)
    const capstones = DATA.ascensions.flatMap((l) => l.options).filter((o) => o.capstone);
    const adds = [DATA.weapons, DATA.passives, DATA.relics, DATA.characters, DATA.recipes, DATA.consumables, capstones].flat().filter((x) => x.unlock === `research:${r.id}`);
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
    // A big secret holds a relic; a small find (0.9.0, W4) a gift instead (sim/acts.js checkActs checks its shape).
    if (x.gift) assert.equal(x.relic, undefined, `secret ${x.id}: a find gives its gift, not a relic`);
    else assert.ok(DATA.relics.some((r) => r.id === x.relic), `secret ${x.id}: relic ${x.relic}`);
    assert.ok(Array.isArray(x.at) && x.at[0] >= 0 && x.at[1] >= 0 && x.at[0] < m.size[0] && x.at[1] < m.size[1], `secret ${x.id}: inside ${m.id}`);
    const g = buildMap(m.layout, m.size[0], m.size[1]);
    assert.equal(g.solid[x.at[1] * m.size[0] + x.at[0]], 0, `secret ${x.id}: on open ground (every open tile is reachable)`);
  }
  for (const [kind, list] of [['weapon', DATA.weapons], ['passive', DATA.passives], ['relic', DATA.relics], ['character', DATA.characters]]) {
    for (const x of list) {
      const u = parseUnlock(x.unlock);
      assert.notEqual(u.kind, 'unknown', `${kind} ${x.id}: unlock "${x.unlock}"`);
      if (u.kind === 'research') assert.ok(RES.has(u.id), `${kind} ${x.id}: research ${u.id}`);
      if (u.kind === 'building') {
        assert.ok(B.has(u.id), `${kind} ${x.id}: building ${u.id}`);
        assert.ok(u.level <= DATA.buildings.find((b) => b.id === u.id).levels.length, `${kind} ${x.id}: level ${u.level}`);
      }
      // A secret's relic is what its cache holds: the cache is how you meet it the first time.
      // (0.9.0, W2: a character can wait at a small find, as the Drowned Man at Breakwater Point.)
      if (u.kind === 'secret') assert.ok(SECRETS.has(u.id) && (kind === 'relic' ? SECRETS.get(u.id).relic === x.id : kind === 'character' && !SECRETS.get(u.id).relic), `${kind} ${x.id}: the secret ${u.id} holds it`);
      // (0.8.0: the Marsh's two come from feats, the Punter from the first crossing.)
      if (kind === 'character') assert.ok(['starter', 'building', 'research', 'feat', 'secret'].includes(u.kind), `character ${x.id} can be reached`);
      if (u.kind === 'feat') assert.ok(DATA.feats.some((f) => f.id === u.id && f.reward?.unlock), `${kind} ${x.id}: feat ${u.id} unlocks`);
    }
  }
  assert.ok(DATA.characters.some((c) => c.unlock === 'starter'), 'someone to play from the start');
  // 0.8.0: a map's `unlock` (a key or a list, every one needed) names things that exist; map 1 is
  // open from the start; a map with layers says what opens each (meta/runconfig.js MAP_LAYERS); a
  // challenge plays on a map that exists.
  assert.equal(DATA.maps[0].unlock, undefined, 'map 1 is open from the start');
  for (const m of DATA.maps) {
    for (const key of m.unlock === undefined ? [] : [].concat(m.unlock)) {
      const u = parseUnlock(key);
      assert.ok(['building', 'boss', 'feat', 'research', 'challenge', 'secret', 'map'].includes(u.kind), `map ${m.id}: unlock "${key}"`);
      if (u.kind === 'building') assert.ok(B.has(u.id) && u.level <= LEVELS(u.id), `map ${m.id}: ${key}`);
      if (u.kind === 'boss') assert.ok(DATA.enemies.some((e) => e.id === u.id && e.boss), `map ${m.id}: ${key} is a boss`);
      if (u.kind === 'feat') assert.ok(DATA.feats.some((f) => f.id === u.id), `map ${m.id}: ${key}`);
      if (u.kind === 'map') assert.ok(DATA.maps.some((x) => x.id === u.id && x.id !== m.id), `map ${m.id}: ${key}`);
    }
    for (const layer of m.layers || []) {
      const rules = MAP_LAYERS[m.id]?.[layer];
      assert.ok(rules?.length, `map ${m.id}: what opens its ${layer} layer`);
      for (const key of rules) assert.ok(/^(boss|tide|building):/.test(key), `map ${m.id} ${layer}: "${key}"`);
    }
  }
  for (const c of DATA.challenges) assert.ok(DATA.maps.some((m) => m.id === (c.map ?? DATA.maps[0].id)), `challenge ${c.id}: plays on a map that exists`);
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
    // Phase 7: gear and what it costs to raise and re-roll, consumables, perks.
    ...DATA.recipes.map((r) => [`gear ${r.id}`, r.cost]),
    ['re-rolls', REROLL_COST],
    ...Object.entries(GEAR_TIER_EXTRA).map(([t, c]) => [`gear tier ${t}`, c]),
    ...DATA.consumables.map((c) => [`consumable ${c.id}`, c.cost]),
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
    // (Projects that count runs on one map, `runsOn`, belong to that map's content pass, not the MVP: 0.8.0.)
    ...DATA.research.filter((r) => r.tier <= mvpTier && r.runsOn === undefined).map((r) => [`research ${r.id}`, r.cost]),
  ];
  for (const [where, cost] of mvpCosts) for (const id of Object.keys(cost)) assert.ok(map1.has(id), `${where} needs ${id}, which map 1 (${DATA.maps[0].id}) doesn't drop`);
  // 0.8.0: every research tier has projects a player on map 1 alone can pay for and finish (its
  // costs map 1's, and it counts runs there), so the Library never waits on a second map.
  const tiers = new Set(DATA.research.map((r) => r.tier));
  for (const t of tiers) {
    const alone = DATA.research.filter((r) => r.tier === t && (r.runsOn === undefined || r.runsOn === DATA.maps[0].id) && Object.keys(r.cost).every((id) => map1.has(id)));
    assert.ok(alone.length >= 1, `research tier ${t}: some project on map 1 alone`);
  }
  // A later map's materials never in a level 1 (a building's first level waits on no second map),
  // and every Smithy and Apothecary level that asks for one keeps a map 1 material beside it, so
  // neither map is ever finished.
  for (const b of DATA.buildings) {
    for (const id of Object.keys(b.levels[0].cost)) assert.ok(map1.has(id), `${b.id} level 1 needs ${id}: a level 1 is paid from map 1`);
    if (!['smithy', 'apothecary'].includes(b.id)) continue;
    b.levels.forEach((lv, i) => {
      const ids = Object.keys(lv.cost).filter((id) => !['coin', 'oil', 'map_scraps'].includes(id));
      if (ids.some((id) => !map1.has(id))) assert.ok(ids.some((id) => map1.has(id)), `${b.id} level ${i + 1}: a map 1 material beside the later map's`);
    });
  }
  // The Salt Marsh's materials have a use at the harbor, beside the research that points at it.
  for (const id of ['marsh_herbs', 'salt_glass']) assert.ok(DATA.buildings.some((b) => b.levels.some((l) => l.cost[id] > 0)), `${id}: a building level asks for it`);
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
    assert.ok(['starter', 'building', 'research', 'feat', 'mastery'].includes(u.kind), `${where}: unlock "${ref}"`);
    if (u.kind === 'mastery') assert.ok(DATA.characters.some((c) => c.id === u.id) && u.level >= 1 && u.level <= DATA.meta.masteryRanks.length, `${where}: mastery ${u.id}:${u.level}`);
    if (u.kind === 'research') assert.ok(RES.has(u.id), `${where}: research ${u.id}`);
    if (u.kind === 'building') assert.ok(B.has(u.id) && u.level <= LEVELS(u.id), `${where}: building ${u.id}:${u.level}`);
    if (u.kind === 'feat') assert.ok(DATA.feats.some((f) => f.id === u.id && f.reward?.unlock), `${where}: feat ${u.id} unlocks`);
  };
  // Relics' new unlock kinds too.
  for (const r of DATA.relics) if (/^feat:/.test(r.unlock)) unlockOk(`relic ${r.id}`, r.unlock);
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
  for (const c of DATA.challenges) {
    assert.ok(W.has(DATA.characters.find((x) => x.id === c.character)?.start), `challenge ${c.id}: a character`);
    // (The sweep, ruling 13: a set run is a Harbor Order with `rules`; its goal is the order's `when`.)
    const order = DATA.feats.find((f) => f.id === c.id);
    assert.ok(order?.rules && order.when.run === c.id && order.group === 'run', `set run ${c.id}: an order on the board with rules`);
    assert.ok(order.when.surviveSec > 0 || DATA.enemies.some((e) => e.id === order.when.boss), `set run ${c.id}: a goal`);
    for (const p of c.pools || []) assert.ok(['weapons', 'passives', 'relics'].includes(p));
    for (const id of c.curses || []) assert.ok(DATA.curses.some((x) => x.id === id));
    assert.ok(!c.tide || c.tide <= DATA.tides.length);
  }
  // Feats: a visibility, conditions the meta layer can judge (an impossible one would never be
  // met), and a reward; an unlocking feat opens something.
  const always0 = { end: 'cleared', cleared: true, tide: 10, bossesKilled: DATA.enemies.filter((e) => e.boss).map((e) => ({ id: e.id, weapons: [] })), lanternNight: true, bellsRung: 99, maxForms: 3, untouchedSec: 9999, timeSurvived: 9999, seaGlassMax: 9999, quenched: 9999, crowdSec: 9999, weaponLevelMax: Object.fromEntries(DATA.weapons.map((w) => [w.id, 99])) };
  for (const f of DATA.feats) {
    // The best run there could be for this feat: on its map, the boss killed with its weapon first.
    const w = f.when || {};
    const always = { ...always0, map: w.map ?? DATA.maps[0].id, bossesKilled: always0.bossesKilled.map((b) => (b.id === w.boss && w.bossWeapon ? { ...b, weapons: [w.bossWeapon] } : b)),
      // 0.9.0, the Harbor Orders' keys (meta/feats.js FEAT_KEYS): the best run for each.
      character: w.character ?? DATA.characters[0].id, capstones: DATA.weapons.map((x) => x.id), level: 9999, totalKills: 1e9,
      kills: Object.fromEntries(DATA.enemies.map((e) => [e.id, 1e9])), elitesKilled: 9999, lanternNights: 99, lampsLit: 99,
      relics: DATA.relics.map((r) => r.id), passives: DATA.passives.map((p) => ({ id: p.id, level: p.maxLevel })), ferryBought: 99, reliquaries: 99,
      embers: 99, dashKills: 1e9, damageTaken: 0, overtimeMinutes: 99, curses: DATA.curses.map((c) => c.id), heirloom: typeof w.heirloom === 'string' ? w.heirloom : 'any', challenge: w.run,
      mode: w.mode ?? 'standard', secretsFound: DATA.maps.flatMap((m) => (m.secrets || []).map((x) => x.id)), wellGiven: DATA.relics[0].id,
      tags: Object.fromEntries(['light', 'fire', 'sea', 'steel', 'echo', 'frost', 'rot'].map((t) => [t, 99])), thralls: 9999, herbsPicked: 9999,
      act: 3, dawn: true, finds: typeof w.find === 'string' ? [w.find] : Array.from({ length: 99 }, (_, k) => `f${k}`), mapEvents: typeof w.mapEvent === 'string' ? [w.mapEvent] : [],
      weapons: typeof w.topWeapon === 'string' ? [{ id: w.topWeapon, damage: 1 }] : [] };   // (C3: the top weapon)
    for (const k of [...Object.keys(w), ...Object.keys(f.found || {})]) assert.ok(FEAT_KEYS.includes(k), `feat ${f.id}: a condition this build can judge (${k})`);
    assert.equal(typeof f.by === 'string' && DATA.npcs.some((n) => n.id === f.by), true, `feat ${f.id}: posted by someone in the harbor (by)`);
    assert.ok(ORDER_GROUPS.some(([g]) => g === f.group) && f.tier >= 1 && f.tier <= 4, `feat ${f.id}: a group and a tier`);
    assert.ok(['visible', 'after_found', 'hidden'].includes(f.visibility), `feat ${f.id}: visibility`);
    assert.ok(Object.keys(f.when || {}).length > 0, `feat ${f.id}: a condition (an empty one is always met)`);
    assert.ok(!featMet(f.when, { end: 'died', timeSurvived: 0 }, { kills: 0 }), `feat ${f.id}: not met by a run that did nothing`);
    const maxOf = (id) => DATA.passives.find((p) => p.id === id)?.maxLevel ?? Infinity;
    const took = w.axisBoth ? w.axisBoth.pairs.flat().map((o) => `took:${w.axisBoth.weapon}:${o}`) : [];   // (C3: both options, across runs)
    assert.ok(featMet(f.when, always, { kills: 1e9, enemyKills: Object.fromEntries(DATA.enemies.map((e) => [e.id, 1e9])), codex: took }, maxOf), `feat ${f.id}: can be done`);
    if (f.visibility === 'after_found') assert.ok(f.found && featMet(f.found, always, { kills: 1e9 }, maxOf), `feat ${f.id}: can be found`);
    assert.ok(f.reward.unlock || f.reward.materials, `feat ${f.id}: a reward`);
    // 0.9.0: an order opens exactly one thing (the Harbor Orders' rule).
    assert.ok(f.reward.unlock && !f.reward.materials, `feat ${f.id}: opens a thing, not materials`);
    assert.equal(contentFrom(DATA, `feat:${f.id}`).length, 1, `feat ${f.id}: opens exactly one thing (${contentFrom(DATA, `feat:${f.id}`).map((x) => x.id)})`);
  }
  // Mastery: perks at ranks the tuning has, for real characters; kits start with real weapons.
  const ranks = DATA.meta.masteryRanks;
  for (let k = 1; k < ranks.length; k++) assert.ok(ranks[k] > ranks[k - 1]);
  // Ruling 15: skill points at ranks the tuning has (tests/skills.test.js checks the trees).
  for (const r of SKILL_RANKS) assert.ok(r >= 1 && r <= ranks.length, `skill rank ${r}`);
  for (const k of DATA.kits) {
    assert.ok(W.has(k.start) && (k.character === '*' || DATA.characters.some((c) => c.id === k.character && c.start !== k.start)) && (k.rank === undefined || k.rank <= ranks.length), `kit ${k.id}`);
    assert.ok(k.rank !== undefined || k.unlock !== undefined, `kit ${k.id}: opened by a rank or an order`);
    if (k.unlock) unlockOk(`kit ${k.id}`, k.unlock);
  }
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
      // Every mooring (0.8.2): boards you can walk to, never a creek's bed, and the skiff beside
      // them (or a tile further out) on water, a creek's bed only where no open water is near;
      // four to six of them, spread out.
      const M = w.ferry.moorings;
      assert.ok(M.length >= 4 && M.length <= 6, `${m.id}: 4 to 6 moorings`);
      M.forEach((F, k) => {
        assert.ok(reachable(F.x, F.y), `${m.id}: mooring ${k}'s boards on ground you can walk to`);
        assert.notEqual(T.kinds[Math.floor(F.y / T.tile) * T.cols + Math.floor(F.x / T.tile)], GROUND.MUD, `${m.id}: mooring ${k}'s boards not on a creek's bed`);
        assert.ok([GROUND.WATER, GROUND.DEEP, GROUND.MUD].includes(T.kinds[Math.floor(F.by / T.tile) * T.cols + Math.floor(F.bx / T.tile)]), `${m.id}: mooring ${k}'s skiff on the water`);
        const off = Math.hypot(F.x - F.bx, F.y - F.by);
        assert.ok(off === T.tile || off === 2 * T.tile, `${m.id}: mooring ${k}'s skiff beside its boards, or a tile further out in the channel`);
        for (let j = 0; j < k; j++) assert.ok(Math.hypot(F.x - M[j].x, F.y - M[j].y) > 200, `${m.id}: moorings ${j} and ${k} apart`);
      });
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
      const doc = defaultProfile();
      // 0.9.0: a run milestone (an order, a boss, a secret, a map's Tide, the runs played) set as reached.
      const p = l.when.split(':');
      if (p[0] === 'feat') doc.profile.feats = [p[1]];
      else if (p[0] === 'boss') doc.profile.bestiary = { [p[1]]: 1 };
      else if (p[0] === 'secret') doc.profile.codex = [`secret:${p[1]}`];
      else if (p[0] === 'tide') doc.profile.tides = { [p[1]]: Number(p[2]) };
      else if (p[0] === 'runs') doc.stats.runs = Number(p[1]);
      else if (l.when !== 'start') levels[p[0]] = Math.max(levels[p[0]] ?? 0, Number(p[1]));
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

test('content: innate unlocks sit only on weapons made that way, nothing is an evolution; every building level brings something', () => {
  for (const [kind, list] of [['weapon', DATA.weapons], ['passive', DATA.passives], ['relic', DATA.relics], ['character', DATA.characters]]) {
    for (const x of list) {
      assert.notEqual(x.unlock, 'evolution', `${kind} ${x.id}: nothing evolves (0.9.0)`);
      if (x.unlock === 'innate') assert.ok(kind === 'weapon' && (x.innate || x.signature), `${kind} ${x.id}: only a character's own weapon is innate`);
    }
  }
  for (const w of DATA.weapons) {
    if (w.innate) assert.equal(w.unlock, 'innate', `${w.id} is a character's own weapon`);
    // 0.9.0 (W2, ruling 2): a signature weapon is one character's own, and that character carries it.
    if (w.signature) {
      assert.equal(w.unlock, 'innate', `${w.id}: a signature weapon is never in a pool`);
      assert.ok(!w.innate, `${w.id}: a signature weapon rolls upgrades and takes Forms (not innate)`);
      assert.equal(DATA.characters.find((c) => c.id === w.signature)?.signature, w.id, `${w.id}: its character carries it`);
    }
  }
  for (const b of DATA.buildings) {
    b.levels.forEach((lv, i) => {
      const key = `${b.id}:${i + 1}`;
      const brings = Object.keys(lv).some((k) => k !== 'cost')
        || [DATA.weapons, DATA.passives, DATA.relics, DATA.characters, DATA.recipes, DATA.consumables].flat().some((x) => x.unlock === `building:${key}`)
        || DATA.hub.fog.some((f) => f.revealedBy === key) || DATA.hub.props.some((p) => p.from === key)
        || DATA.npcs.some((n) => n.home === b.id && (i + 1 === 4 || i + 1 === 5));
      assert.ok(brings, `${key} brings something`);
    });
  }
});

/**
 * A run milestone a townsfolk line can key to (0.9.0): an order done, a boss killed, a secret
 * found, a map's Tide opened, a challenge won, or a number of runs; each naming something real.
 */
function milestoneOk(key) {
  const p = key.split(':');
  if (p[0] === 'feat') return DATA.feats.some((f) => f.id === p[1]);
  if (p[0] === 'boss') return DATA.enemies.some((e) => e.id === p[1] && e.boss);
  if (p[0] === 'secret') return DATA.maps.some((m) => (m.secrets || []).some((x) => x.id === p[1]));
  if (p[0] === 'challenge') return DATA.challenges.some((c) => c.id === p[1]);
  if (p[0] === 'tide' && p.length === 3) return DATA.maps.some((m) => m.id === p[1]) && Number(p[2]) >= 1 && Number(p[2]) <= DATA.tides.length;
  if (p[0] === 'runs') return /^\d+$/.test(p[1]);
  return false;
}

test('content: the harbor\'s people keep real buildings, and their lines key to real levels', () => {
  for (const n of DATA.npcs) {
    assert.ok(B.has(n.home), `${n.id}: home ${n.home}`);
    assert.ok(typeof n.sprite === 'string' && n.sprite.startsWith('npc_'), `${n.id}: sprite`);
    assert.ok(DATA.hub.keepers[n.id], `${n.id}: has a post and a walk on the map`);
    assert.ok(n.lines.length >= 1);
    for (const l of n.lines) {
      const m = /^([a-z_]+):(\d+)$/.exec(l.when);
      assert.ok(l.when === 'start' || (m && B.has(m[1]) && Number(m[2]) >= 1 && Number(m[2]) <= LEVELS(m[1])) || milestoneOk(l.when), `${n.id}: line keyed to "${l.when}"`);
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
  const regionOk = (key) => key === 'start' || (/^([a-z_]+):(\d+)$/.test(key) && B.has(key.split(':')[0]) && Number(key.split(':')[1]) <= LEVELS(key.split(':')[0]));
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
  // (The sweep: a prop that comes with an order done, 'feat:<id>', stands on ground clear from the start.)
  const featKey = (key) => /^feat:[a-z0-9_]+$/.test(key) && DATA.feats.some((f) => `feat:${f.id}` === key);
  const keyOk = (key) => key === 'start' || featKey(key) || /^runs:\d+$/.test(key) || (/^([a-z_]+):(\d+)$/.test(key) && B.has(key.split(':')[0]) && Number(key.split(':')[1]) <= LEVELS(key.split(':')[0]));
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
    // (A building that comes out of the fog later, the Lighthouse, has its own way open too.)
    const home = hub.plots.find((q) => q.building === p.from.split(':')[0]);
    const lv = p.from === 'start' || featKey(p.from) || p.from.startsWith('runs:') ? {} : { ...(home?.openAt && home.openAt !== 'start' ? levelsAt(home.openAt) : {}), [p.from.split(':')[0]]: Number(p.from.split(':')[1]) };
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

test('content: a project\'s runsOn names a map this build has (a typo would leave it never finishing), and every challenge\'s map is one too', () => {
  const maps = new Set(DATA.maps.map((m) => m.id));
  for (const r of DATA.research.filter((x) => x.runsOn !== undefined)) assert.ok(typeof r.runsOn === 'string' && maps.has(r.runsOn), `research ${r.id}: runsOn "${r.runsOn}"`);
  assert.ok(DATA.research.some((r) => r.runsOn), 'some projects count runs on one map');
  for (const c of DATA.challenges.filter((x) => x.map !== undefined)) assert.ok(maps.has(c.map), `challenge ${c.id}: map "${c.map}"`);
});
