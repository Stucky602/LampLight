// The run view's memory (render/viewstate.js) and the HUD's content (render/hudmodel.js), fed by
// real sim worlds: which events make which effects, warning timing by the tick that wrote them,
// the dying pop keeping its facing, the lists' caps and expiry, enemy tints, and what the HUD says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createEventBuffer, EV, TELE } from '../src/sim/events.js';
import { stepWorld, decide } from '../src/sim/world.js';
import { CHARGER } from '../src/sim/enemies.js';
import { AI } from '../src/sim/constants.js';
import { readFileSync } from 'node:fs';
import {
  createViewState, resetViewState, consumeEvents, markTick, tickOfEvent, noteEnemy, expireTelegraphs, expireDying,
  expireLights, addLight, screenFlash, enemyLook, LOOK, LOOK_COLOR, MAX_LIGHTS, MAX_TELEGRAPHS,
  simSeconds, animFrameIndex, stepHop, dazeWobble, tileHash, FLOOR_PICK, floorVariant, blockVariant,
} from '../src/render/viewstate.js';
import {
  createHudModel, updateHudModel, HUD_LAYOUT, createHudPlaces, placeHud,
} from '../src/render/hudmodel.js';
import { minimapBox } from '../src/render/minimapmodel.js';
import { formatClock, formatCount } from '../src/render/hudtext.js';
import { textWidth, FONT_H } from '../src/render/font.js';
import { VIEW_W, VIEW_H } from '../src/render/layout.js';
import { MAX_WEAPON_SLOTS, PASSIVE_SLOTS, TPS } from '../src/sim/constants.js';
import { makeWorld, spawnAt, give, IDLE } from './helpers/simworld.js';

const FEEL = DATA.tuning.feel;
let seq = 0;
const rand = () => ((seq = (seq * 1103515245 + 12345) >>> 0) / 2 ** 32);
const ctx = (over = {}) => ({ now: 1000, tick: 100, feel: FEEL, numbersOn: true, playerX: 0, playerY: 0, slotOf: (h) => h & 4095, ...over });

test('view state: hits squash and number their enemy; kills pop facing the way they walked', () => {
  const st = createViewState({ slots: 4096, rand });
  const ev = createEventBuffer(64, 8);
  noteEnemy(st, 7, 7, 0);
  st.facing[7] = -1;
  ev.push(EV.HIT, 10, 20, 12, 7, 0, 0);
  ev.push(EV.HIT, 10, 20, 5, 7, 1, 0);
  ev.push(EV.KILL, 10, 20, 2, 0, 0, 7);
  consumeEvents(st, ev, ctx());
  assert.equal(st.hitAt[7], 1000);
  assert.equal(st.numbers.count, 1, 'two hits on one enemy, one number');
  let n = -1; for (let i = 0; i < st.numbers.max; i++) if (st.numbers.live[i]) n = i;
  assert.equal(st.numbers.value[n], 17);
  assert.equal(st.numbers.kind[n], 1, 'critical');
  assert.equal(st.dying.n, 1);
  assert.equal(st.dying.face[0], -1, 'the pop faces the way it last walked');
  assert.equal(st.dying.type[0], 2);
  assert.ok(st.sparks.count > 0);
  expireDying(st, 1000 + FEEL.deathMs + 1, FEEL.deathMs, FEEL.deathBigMul);
  assert.equal(st.dying.n, 0);
  // A kill whose slot was already reused faces right (no stale facing).
  ev.clear();
  ev.push(EV.KILL, 0, 0, 1, 0, 0, 7 + 4096);
  consumeEvents(st, ev, ctx());
  assert.equal(st.dying.face[0], 1);
  // With damage numbers switched off, hits still squash but make no numbers.
  resetViewState(st);
  ev.clear(); ev.push(EV.HIT, 0, 0, 9, 3, 0, 0);
  consumeEvents(st, ev, ctx({ numbersOn: false }));
  assert.equal(st.numbers.count, 0);
  assert.equal(st.hitAt[3], 1000);
});

test('view state: big kills shake and light; the player getting hurt flashes and numbers', () => {
  const st = createViewState({ rand });
  const ev = createEventBuffer(64, 8);
  ev.push(EV.KILL, 5, 5, 9, 2, 0, 0);      // a boss
  ev.push(EV.PLAYER_HURT, 0, 0, 14, 80);
  consumeEvents(st, ev, ctx());
  assert.ok(st.shake.trauma >= Math.min(1, FEEL.shake.bossKill), 'a boss kill shakes');
  assert.equal(st.lights.n, 1);
  assert.equal(st.decals.n, 1);
  assert.equal(st.hurtAt, 1000);
  const out = screenFlash(st, 1000 + FEEL.flash.playerHurtMs / 2, FEEL.flash, false, { hurt: 0, level: 0 });
  assert.ok(Math.abs(out.hurt - 0.5) < 1e-9);
  assert.ok(Math.abs(screenFlash(st, 1000, FEEL.flash, true, out).hurt - 0.35) < 1e-9, 'softer flashes are capped');
  let hurtNumber = false;
  for (let i = 0; i < st.numbers.max; i++) if (st.numbers.live[i] && st.numbers.kind[i] === 2) hurtNumber = true;
  assert.ok(hurtNumber);
});

test('view state: a warning ends on the tick its hit lands, whichever tick of the frame wrote it', () => {
  const st = createViewState({ rand });
  const ev = createEventBuffer(64, 8);
  // Three ticks in one frame: 100, 101, 102. The warning came from tick 100 with 48 ticks to go.
  ev.push(EV.TELEGRAPH, 0, 0, TELE.RING, 48, 70, 0); markTick(st, ev.count, 100);
  ev.push(EV.HIT, 0, 0, 1, 1, 0, 0); markTick(st, ev.count, 101);
  ev.push(EV.TELEGRAPH, 0, 0, TELE.CIRCLE, 60, 20, 3); markTick(st, ev.count, 102);
  assert.equal(tickOfEvent(st, 0, 999), 100);
  assert.equal(tickOfEvent(st, 2, 999), 102);
  assert.equal(tickOfEvent(st, 5, 999), 999, 'events after the last mark: the current tick');
  consumeEvents(st, ev, ctx({ tick: 102 }));
  assert.equal(st.tele.n, 1, 'hazard circles are drawn from the zone, not stored');
  assert.equal(st.tele.end[0], 148);
  assert.equal(st.marks.n, 0, 'marks are used up by the frame');
  expireTelegraphs(st, 147);
  assert.equal(st.tele.n, 1);
  expireTelegraphs(st, 148);
  assert.equal(st.tele.n, 0);
  // The store is bounded.
  const many = createEventBuffer(256, 8);
  for (let k = 0; k < MAX_TELEGRAPHS + 20; k++) many.push(EV.TELEGRAPH, 0, 0, TELE.LINE, 50, 100, 0);
  consumeEvents(st, many, ctx());
  assert.equal(st.tele.n, MAX_TELEGRAPHS);
});

test('view state: flash lights replace the oldest when full, and fade out on time', () => {
  const st = createViewState({ rand });
  for (let k = 0; k < MAX_LIGHTS; k++) addLight(st, k, 0, 10, 100 + k, 0xffffff, 0);
  addLight(st, 999, 0, 10, 5000, 0xffffff, 0);
  assert.equal(st.lights.n, MAX_LIGHTS);
  assert.equal(st.lights.x[0], 999, 'the first-placed light made room');
  expireLights(st, 150);
  assert.ok(st.lights.n < MAX_LIGHTS && st.lights.n > 0);
  expireLights(st, 6000);
  assert.equal(st.lights.n, 0);
});

test('view state: the damage-number limit follows the tuning, live', () => {
  const st = createViewState({ rand });
  const ev = createEventBuffer(512, 8);
  for (let k = 0; k < 200; k++) ev.push(EV.HIT, 0, 0, 5, k, 0, 0);
  consumeEvents(st, ev, ctx({ feel: { ...FEEL, numbers: { ...FEEL.numbers, max: 60 } } }));
  assert.equal(st.numbers.count, 60);
  consumeEvents(st, createEventBuffer(8, 1), ctx({ feel: { ...FEEL, numbers: { ...FEEL.numbers, max: 20 } } }));
  assert.equal(st.numbers.count, 20, 'lowering the limit retires the extras at once');
});

test('enemy looks: the warning pulse wins, then dazed, frozen, burning, slowed, rotting', () => {
  const w = makeWorld();
  const e = spawnAt(w, 'mud_crab', 60, 0);
  const warned = (E, i) => E.ai[i] === AI.charger && E.aiState[i] === CHARGER.WINDUP;
  const E = w.enemies;
  assert.equal(enemyLook(E, e, 0, 1, warned), LOOK.PLAIN);
  E.rotT[e] = 1; assert.equal(enemyLook(E, e, 0, 1, warned), LOOK.ROT);
  E.slowT[e] = 1; assert.equal(enemyLook(E, e, 0, 1, warned), LOOK.SLOW);
  E.burnT[e] = 1; assert.equal(enemyLook(E, e, 0, 1, warned), LOOK.BURN);
  assert.equal(enemyLook(E, e, 90, 1, warned), LOOK.PLAIN, 'burning flickers');
  E.freezeT[e] = 1; assert.equal(enemyLook(E, e, 0, 1, warned), LOOK.FROZEN);
  E.dazeT[e] = 0.4; assert.equal(enemyLook(E, e, 0, 1, warned), LOOK.DAZED);
  assert.equal(LOOK_COLOR[LOOK.DAZED], 0xffffff, 'dazed keeps its colors (it wobbles instead)');
  E.aiState[e] = CHARGER.WINDUP;
  assert.equal(enemyLook(E, e, 0, 1, warned), LOOK.WARN);
  assert.equal(enemyLook(E, e, 0, 0.2, warned), LOOK.PLAIN, 'the pulse beats');
  assert.equal(LOOK_COLOR.length, Object.keys(LOOK).length, 'every look has a color');
});

test('animation: frames run on sim time, staggered, and hold while held', () => {
  assert.equal(simSeconds({ tick: 3 * TPS }), 3);
  assert.equal(animFrameIndex(1, 7, 12.3, 0.4), 0, 'one frame is always frame 0');
  assert.equal(animFrameIndex(0, 7, 12.3, 0.4), 0);
  // Two frames at 7 fps: the frame changes 7 times a second.
  let changes = 0, last = animFrameIndex(2, 7, 0, 0);
  for (let t = 1; t <= TPS; t++) {
    const f = animFrameIndex(2, 7, t / TPS, 0);
    assert.ok(f === 0 || f === 1);
    if (f !== last) changes++;
    last = f;
  }
  assert.ok(changes >= 6 && changes <= 8, `7 changes a second (${changes})`);
  // A crowd never flaps in step: phases spread the frames.
  const at0 = new Set();
  for (let k = 0; k < 20; k++) at0.add(animFrameIndex(2, 7, 5, k / 20));
  assert.equal(at0.size, 2, 'at one moment, some enemies are on each frame');
  // Held (frozen, dazed): the frame stays put while time passes, and differs between enemies.
  for (const ph of [0, 0.3, 0.7]) {
    const held = animFrameIndex(2, 7, 0, ph, true);
    for (let t = 0; t < 3; t += 0.05) assert.equal(animFrameIndex(2, 7, t, ph, true), held);
  }
  // The sim's clock stands still under a halt or a hit-stop, so the frame does too.
  const w = makeWorld();
  w.tick = 500;
  const a = animFrameIndex(2, 7, simSeconds(w), 0.25);
  assert.equal(animFrameIndex(2, 7, simSeconds(w), 0.25), a);
});

test('animation: the run view uses the helpers the way they are tested (a source check)', () => {
  const src = readFileSync(new URL('../src/render/runview.js', import.meta.url), 'utf8');
  // Frames: each enemy by its own phase (E.anim), held while frozen or dazed.
  assert.match(src, /animFrameIndex\([^;]*simSec, E\.anim\[i\], E\.freezeT\[i\] > 0 \|\| E\.dazeT\[i\] > 0\)/);
  // The daze wobble, on sim time, by the enemy's phase (and on elites too).
  assert.equal((src.match(/dazeWobble\(simSec, E\.anim\[i\]\)/g) || []).length, 2, 'the wobble on regular enemies and elites');
  // The hop, from the player's own walking, on sim time.
  assert.match(src, /stepHop\(p\.moving, simSec, F\.bob\.stepsPerSec\)/);
  // Warning pulses and status flickers on sim time: no pulse or look reads the render clock.
  assert.doesNotMatch(src, /pulse = [^;]*\bnow\b/, 'a pulse on the render clock');
  assert.doesNotMatch(src, /enemyLook\(E, i, now\b/, 'a status flicker on the render clock');
  assert.match(src, /rigInput\(world, world\.bosses\[E\.boss\[i\]\], E\.anim\[i\], v\.input\)/, 'rigs posed from the sim\'s boss');
});

test('animation: the hop is a pixel every other step, only while walking', () => {
  for (let t = 0; t < 2; t += 1 / TPS) assert.equal(stepHop(false, t, 8), 0, 'standing still: no hop');
  let ups = 0, flips = 0, last = stepHop(true, 0, 8);
  for (let tick = 1; tick <= TPS; tick++) {
    const h = stepHop(true, tick / TPS, 8);
    assert.ok(h === 0 || h === 1);
    ups += h;
    if (h !== last) flips++;
    last = h;
  }
  assert.ok(Math.abs(ups - TPS / 2) <= 5, 'up half the time');
  assert.ok(flips >= 7 && flips <= 9, `8 steps a second (${flips})`);
  const still = stepHop(true, 4.2, 8);
  assert.equal(stepHop(true, 4.2, 8), still, 'a halted sim (same time) holds the hop');
});

test('animation: a dazed enemy wobbles, gently, each at its own moment', () => {
  let min = 0, max = 0;
  for (let t = 0; t < 2; t += 1 / TPS) { const w = dazeWobble(t, 0.1); min = Math.min(min, w); max = Math.max(max, w); }
  assert.ok(max > 0.25 && max <= 0.3 && min < -0.25 && min >= -0.3, `a lean both ways, at most 0.3 rad (${min}..${max})`);
  assert.notEqual(dazeWobble(1, 0), dazeWobble(1, 0.25), 'phases differ');
  assert.equal(dazeWobble(1.5, 0.3), dazeWobble(1.5, 0.3), 'the same moment, the same lean (sim time)');
});

test('floor: the tile variants never fall into a pattern, and plain boards are half the floor', () => {
  // The picker the run view and the title's yard both use.
  const N = 256, pick = floorVariant;
  const counts = [0, 0, 0, 0];
  for (let y = -N / 2; y < N / 2; y++) for (let x = -N / 2; x < N / 2; x++) counts[pick(x, y)]++;
  const total = N * N;
  assert.ok(Math.abs(counts[0] / total - 0.5) < 0.02, `plain boards ${counts[0] / total}`);
  for (let v = 1; v <= 3; v++) assert.ok(Math.abs(counts[v] / total - 1 / 6) < 0.02, `variant ${v}: ${counts[v] / total}`);
  // No short period: shifting the map by 2, 4, 8, or 16 tiles either way changes most tiles
  // (the first floor hash repeated every 4 tiles, so the map was one 4 x 4 block).
  for (const p of [1, 2, 3, 4, 8, 16]) {
    let sameX = 0, sameY = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (pick(x, y) === pick(x + p, y)) sameX++;
      if (pick(x, y) === pick(x, y + p)) sameY++;
    }
    // Random tiles with these weights match 1/4 + 3 x 1/36 of the time (a third).
    assert.ok(sameX / 4096 < 0.4 && sameY / 4096 < 0.4, `period ${p}: ${sameX / 4096}, ${sameY / 4096}`);
  }
  assert.equal(tileHash(-3, 7), tileHash(-3, 7));
  assert.ok(FLOOR_PICK.every((v) => v >= 0 && v <= 3));
  for (let k = 0; k < 50; k++) { const b = blockVariant(k * 7, -k, 3); assert.ok(Number.isInteger(b) && b >= 0 && b < 3); }
  // Both views pick the floor through floorVariant (a formula copied into one of them could drift
  // back into a pattern): the yard directly, the run view through groundFrame.
  for (const [file, via] of [['src/render/runview.js', /groundFrame\(/], ['src/app/scenes/lampyard.js', /floorVariant\(/], ['src/render/viewstate.js', /tile_floor_\$\{floorVariant\(/]]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, via, `${file} picks its floor with floorVariant`);
    assert.doesNotMatch(src, /tile_floor_\$\{\(/, `${file} has no floor formula of its own`);
  }
  assert.ok(Number.isInteger(tileHash(-100000, 99999)) && tileHash(-100000, 99999) >= 0);
});

test('HUD layout: nothing overlaps at the longest texts, at every minimap setting', () => {
  const atlas = JSON.parse(readFileSync(new URL('../src/assets/atlas.json', import.meta.url), 'utf8'));
  // The longest texts each line can show.
  const longest = (list) => list.reduce((a, t) => (textWidth(t) > textWidth(a) ? t : a), '');
  const bosses = DATA.enemies.filter((e) => e.ai.type === 'boss').map((e) => e.name);
  const notices = [
    ...bosses, ...DATA.enemies.map((e) => `An elite ${e.name}`), 'Overtime: minute 99',
    ...DATA.weapons.map((w) => `Evolved: ${w.name}`),
    // Phase 7's (app/runlogic.js noticeFor): the longest a task, the night, and the Ferryman say.
    'Wayside Lamp: stand by it to light it', `Fog Bell: ${999} kills inside its ring`, 'Lamp lit 9/9: Kindled, +999 Sea Glass',
    'Fog Bell rung, +999 Sea Glass', 'Lantern Night', 'The night ends', 'Ferryman: new stock',
  ];
  const W = {
    hp: textWidth('9999/9999'), level: textWidth('LV 999'), timer: textWidth(formatClock(7199)),
    kills: textWidth(`${formatCount(9999999)} KILLS`), glass: textWidth(`${formatCount(99999)} GLASS`), boss: textWidth(longest(bosses)),
    overtime: textWidth('OVERTIME 99 MIN'), notice: textWidth(longest(notices)),
  };
  const P = placeHud(createHudPlaces(), W, true);
  const L = HUD_LAYOUT;
  // Boxes as drawn: bars with their 1 px frame, texts with their 1 px outline.
  const grow = (b, name) => ({ name, x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
  const boxes = [
    grow(P.xp, 'xp bar'), grow(P.hp, 'hp bar'), grow(P.dash, 'dash bar'), grow(P.bossBar, 'boss bar'),
    grow(P.hpText, 'hp'), grow(P.levelText, 'level'), grow(P.timerText, 'timer'), grow(P.killsText, 'kills'), grow(P.glassText, 'sea glass'),
    grow(P.bossName, 'boss name'), grow(P.overtime, 'overtime'), grow(P.notice, 'notice'),
  ];
  for (let k = 0; k < MAX_WEAPON_SLOTS; k++) boxes.push({ name: `weapon ${k}`, x: L.icons.x + k * L.icons.step, y: L.icons.weaponsY, w: L.icons.size, h: L.icons.size });
  for (let k = 0; k < PASSIVE_SLOTS; k++) boxes.push({ name: `passive ${k}`, x: L.icons.x + k * L.icons.step, y: L.icons.passivesY, w: L.icons.size, h: L.icons.size });
  // With the minimap off, and at each of its sizes (its frame 2 px round it).
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const [mode, size] of [['off', 'small'], ['nearby', 'small'], ['nearby', 'large'], ['map', 'large']]) {
    const mapBox = minimapBox(mode, size);
    const all = [...boxes];
    if (mapBox) all.push({ name: `minimap ${size}`, x: mapBox.x - 2, y: mapBox.y - 2, w: mapBox.w + 4, h: mapBox.h + 4 });
    for (const b of all) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= VIEW_W && b.y + b.h <= VIEW_H, `${b.name} is on the screen (minimap ${mode} ${size})`);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(!hit(all[i], all[j]), `${all[i].name} overlaps ${all[j].name} (minimap ${mode} ${size})`);
    }
  }
  // Without a boss, overtime takes the boss's line.
  assert.equal(placeHud(createHudPlaces(), W, false).overtime.y, L.overtimeY);
});

test('HUD model: what the HUD says, updated from a live run without rebuilding unchanged text', () => {
  const w = makeWorld();
  give(w, 'flare_gun', { level: 8 });
  decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  const m = createHudModel();
  updateHudModel(m, w);
  assert.equal(m.timerText, '0:00');
  assert.equal(m.levelText, 'LV 1');
  assert.equal(m.killsText, '0 KILLS');
  assert.equal(m.weaponCount, 1);
  assert.deepEqual([m.weapons[0].icon, m.weapons[0].levelText, m.weapons[0].max], ['icon_flare_gun', '8', true]);
  assert.deepEqual([m.passives[0].icon, m.passives[0].levelText], ['icon_wick_oil', ''], 'level 1 shows no number');
  assert.equal(m.boss.shown, false);
  const timer = m.timerText;
  for (let t = 0; t < 30; t++) stepWorld(w, IDLE);
  updateHudModel(m, w);
  assert.equal(m.timerText, timer, 'the same second: the very same string');
  for (let t = 0; t < 40; t++) stepWorld(w, IDLE);
  updateHudModel(m, w);
  assert.equal(m.timerText, '0:01');
  w.result.totalKills = 12345;
  w.result.materialsRaw[w.materialIndex.get('rope')] = 3.9999999999;
  w.player.hp = 37.2;
  updateHudModel(m, w);
  assert.equal(m.killsText, '12,345 KILLS');
  assert.equal(m.hpText, `38/${Math.round(w.stats.maxHp)}`);
  assert.equal('materials' in m, false, 'materials found are on the pause menu, not the HUD');
  decide(w, { kind: 'dev', cmd: 'jump', to: 599.9 });
  const w2 = makeWorld({}, { events: [{ at: 1, event: 'boss', enemy: 'harbor_maw' }] });
  for (let t = 0; t < 70; t++) stepWorld(w2, IDLE);
  updateHudModel(m, w2);
  assert.equal(m.boss.shown, true);
  assert.equal(m.boss.name, 'The Harbor Maw');
  assert.equal(m.boss.frac, 1);
  assert.equal(m.weaponCount, 0, 'a new world, a new list');
});

test('view state: a strike\'s own hit brings its bolt (and still counts as critical when it is); other hits bring none', () => {
  const st = createViewState({ slots: 4096, rand });
  const ev = createEventBuffer(64, 8);
  ev.push(EV.HIT, 10, 20, 12, 7, 0, 0);   // an ordinary hit
  ev.push(EV.HIT, 30, 40, 12, 8, 2, 0);   // a strike's own hit
  ev.push(EV.HIT, 50, 60, 12, 9, 3, 0);   // a strike's own critical hit
  consumeEvents(st, ev, ctx());
  assert.equal(st.bolts.n, 2);
  assert.deepEqual([st.bolts.x[0], st.bolts.y[0], st.bolts.x[1], st.bolts.y[1]], [30, 40, 50, 60]);
  let crits = 0; for (let i = 0; i < st.numbers.max; i++) if (st.numbers.live[i] && st.numbers.kind[i] === 1) crits++;
  assert.equal(crits, 1, 'bit 1 is still the critical');
  // The run view draws an upright weapon's shots unturned, and a beam's own sprite.
  const src = readFileSync(new URL('../src/render/runview.js', import.meta.url), 'utf8');
  assert.match(src, /shotUpright\[P\.def\[i\]\] === true \? 0 :/);
  assert.match(src, /Z\.kind\[z\] !== ZONE\.BEAM/);
  assert.ok(DATA.weapons.filter((w) => w.upright).map((w) => w.id).sort().join() === 'corpse_candles,oil_flask');
});

test('view state: a secret cache opening flares violet, with its light', () => {
  const st = createViewState({ slots: 4096, rand });
  const ev = createEventBuffer(64, 8);
  ev.push(EV.SECRET, 100, 200, 0);
  consumeEvents(st, ev, ctx());
  assert.ok(st.sparks.count > 10, 'a burst and its ring');
  assert.ok(st.lights.n >= 1, 'a light');
  ev.clear(); ev.push(EV.MUSTER, 10, 10, 12, 5, 0);
  const before = st.sparks.count;
  consumeEvents(st, ev, ctx());
  assert.ok(st.sparks.count > before, 'a muster rings out where it forms');
});
