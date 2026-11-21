// 0.9.0's presentation batch (W6): the Brightness setting and the lifted ground, the enemies'
// family tones, damage numbers in a crowd, the warning tiers, the music's notes, each weapon's own
// fire sound, the combat rumble, the run-end damage table, and notices that wrap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { PALETTE } from '../src/data/palette.js';
import { BRIGHTNESS, BRIGHTNESS_SPAN, brightnessLift, brightnessValue, runAmbient } from '../src/render/brightness.js';
import { GROUND_LIFT, RAMPS } from '../art/manifest.js';
import { recolored, tint } from '../tools/atlas/treat.mjs';
import { mask } from '../tools/atlas/mask.mjs';
import { blank, setPx } from '../src/render/pixels.js';
import {
  createViewState, consumeEvents, numberShows, NUMBERS_CROWD, NUMBERS_BIG, NUMBERS_CLEAR, TIER, poolTierAt, tellShowing, expireTelegraphs,
} from '../src/render/viewstate.js';
import { EV, TELE, HITSTOP } from '../src/sim/events.js';
import { createEventBuffer } from '../src/sim/events.js';
import { MUSIC, MODES, AMBIENCE } from '../src/data/music.js';
import { parsePattern, midiOf, loopNotes, loopSteps, freqOf, VOICES } from '../src/audio/music.js';
import { musicFor, fireSound } from '../src/audio/cues.js';
import { SFX, WEAPON_FIRE, RUMBLE } from '../src/data/sfx.js';
import { rumbleFor, hurtScale, createRumble, LOW_HEALTH, PULSE_MS, HURT_MIN_SCALE } from '../src/render/rumble.js';
import { damageRows } from '../src/render/damagetable.js';
import { noticeBreak, NOTICE_MAX_W } from '../src/render/hudmodel.js';
import { textWidth } from '../src/render/font.js';

const FEEL = DATA.tuning.feel;
const ctx = (over = {}) => ({ now: 1000, tick: 100, feel: FEEL, numbersOn: true, playerX: 500, playerY: 500, slotOf: (h) => h & 4095, alive: 10, ...over });

test('brightness: 0.5 is the game as tuned, the ends move the ambient light by 0.2, and anything odd is the default', () => {
  assert.equal(BRIGHTNESS.key, 'access.brightness');
  assert.equal(brightnessLift(0.5), 0);
  assert.ok(Math.abs(brightnessLift(1) - BRIGHTNESS_SPAN) < 1e-9 && Math.abs(brightnessLift(0) + BRIGHTNESS_SPAN) < 1e-9);
  for (const bad of [undefined, null, 'x', NaN]) assert.equal(brightnessValue(bad), 0.5);
  assert.equal(brightnessValue(4), 1);
  // A run's ambient: the map's, the boost, the setting, Lantern Night, held to 0..1.
  assert.equal(runAmbient(0.5, 0.2, 0.5), 0.7);
  assert.ok(Math.abs(runAmbient(0.5, 0.2, 1) - 0.9) < 1e-9);
  assert.equal(runAmbient(0.9, 0.2, 1, 0.3), 1);
  assert.equal(runAmbient(0, 0, 0), 0);
  // The run's ground is lifted (V5: "runs are too dark to read the map").
  assert.ok(FEEL.light.ambientBoost > 0, 'the run ground is lifted by the light model too');
  // The harbor's night is darker than the old dusk (V5: windows and lamp pools didn't show).
  assert.ok(Math.max(...DATA.hubTuning.look.ambient) <= 0.5, 'the harbor reads as night');
});

test('the ground you walk on is drawn a palette step lighter; water and obstacles stay as drawn', () => {
  const f = blank('t', 2, 1);
  setPx(f, 0, 0, 'night-2'); setPx(f, 1, 0, 'sea-1');
  const g = recolored(f, GROUND_LIFT.colors);
  const hex = (x) => `#${[0, 1, 2].map((k) => g.rgba[x * 4 + k].toString(16).padStart(2, '0')).join('')}`;
  assert.equal(hex(0), PALETTE['night-3'], 'night-2 goes to night-3');
  assert.equal(hex(1), PALETTE['sea-1'], 'a color not listed stays');
  for (const d of ['water', 'roof', 'shedWall', 'hull', 'mWater', 'mStump']) assert.ok(!GROUND_LIFT.draws.includes(d), `${d} stays as drawn`);
  for (const d of ['planks', 'bridge', 'mSalt', 'mMud', 'mLanding']) assert.ok(GROUND_LIFT.draws.includes(d), `${d} is lifted`);
});

test('enemies wear their family\'s second tone over the top of the body; the shade side keeps its shade', () => {
  const m = mask(3, 6);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 3; x++) m.a[y * 3 + x] = 1;
  const ramp = { light: 'fog-3', body: 'fog-1', shade: 'night-5', hole: null, tone: 'fog-4', toneTo: 0.5, outline: null };
  const f = tint(m, ramp, 't');
  const at = (x, y) => `#${[0, 1, 2].map((k) => f.rgba[(y * 3 + x) * 4 + k].toString(16).padStart(2, '0')).join('')}`;
  assert.equal(at(1, 1), PALETTE['fog-4'], 'the top half takes the tone');
  assert.equal(at(1, 4), PALETTE['fog-1'], 'below it, the body');
  assert.equal(at(2, 1), PALETTE['night-5'], 'the shade side keeps its shade in the band');
  // Every enemy family has its tone; the Salted Dead and the Warden keep their salt crust as theirs.
  for (const k of ['wisp', 'gull', 'crab', 'rat', 'drowned', 'gunner', 'bosun', 'bloater', 'moth', 'midge', 'toad', 'leech', 'eel']) assert.ok(RAMPS[k].tone, `${k} wears a family tone`);
  const tones = new Set(['wisp', 'drowned', 'moth', 'midge'].map((k) => RAMPS[k].tone));
  assert.equal(tones.size, 4, 'each family its own');
});

test('damage numbers: never within 24 px of the player; in a crowd of more than 200, only crits and big hits', () => {
  assert.equal(NUMBERS_CROWD, 200); assert.equal(NUMBERS_CLEAR, 24);
  assert.equal(numberShows(10, false, 50, 10, 23, 0), false, 'inside the player\'s ring');
  assert.equal(numberShows(10, false, 50, 10, 30, 0), true, 'outside it, in a small crowd');
  assert.equal(numberShows(10, false, 400, 10, 100, 0), false, 'an ordinary hit in a big crowd');
  assert.equal(numberShows(10, true, 400, 10, 100, 0), true, 'a crit in a big crowd');
  assert.equal(numberShows(10 * NUMBERS_BIG, false, 400, 10, 100, 0), true, 'a big hit in a big crowd');
  // Through the event reader: the same hit numbered at 50 alive, not at 400.
  for (const [alive, want] of [[50, 1], [400, 0]]) {
    const st = createViewState({ slots: 4096 });
    const ev = createEventBuffer(64, 8);
    for (let k = 0; k < 20; k++) ev.push(EV.HIT, 100, 100, 10, k + 1, 0, 0);
    ev.push(EV.HIT, 100, 100, 10, 77, 0, 0);
    consumeEvents(st, ev, ctx({ alive }));
    assert.equal(st.numbers.count > 0 ? 1 : 0, want, `${alive} alive`);
  }
  // Your own damage sits above the ring, not on you.
  const st = createViewState({ slots: 4096 });
  const ev = createEventBuffer(64, 8);
  ev.push(EV.PLAYER_HURT, 0, 0, 12, 50);
  consumeEvents(st, ev, ctx());
  let n = -1; for (let i = 0; i < st.numbers.max; i++) if (st.numbers.live[i]) n = i;
  assert.ok(500 - st.numbers.y[n] > NUMBERS_CLEAR, 'above the ring');
});

test('warning tiers: a TELE_TIER sets the tier of the warning before it; a DIM line flashes its enemy; a pool keeps its tier by place', () => {
  const st = createViewState({ slots: 4096 });
  const ev = createEventBuffer(64, 8);
  const H = 4096 * 3 + 9;   // a handle in slot 9
  ev.push(EV.TELEGRAPH, 10, 20, TELE.LINE, 30, 60, 0.5);
  ev.push(EV.TELE_TIER, 10, 20, TIER.DIM, H, 30, 2);
  ev.push(EV.TELEGRAPH, 40, 40, TELE.RING, 30, 24, 0);
  ev.push(EV.TELE_TIER, 40, 40, TIER.MAJOR, -1, 30, -1);
  ev.push(EV.TELEGRAPH, 70, 70, TELE.CIRCLE, 30, 16, 0);
  ev.push(EV.TELE_TIER, 70, 70, TIER.FULL, 5, 30, 1);
  ev.push(EV.TELEGRAPH, 90, 90, TELE.LINE, 30, 60, 0);   // no tier: an older sim
  consumeEvents(st, ev, ctx());
  assert.equal(st.tele.n, 3, 'the pool is drawn from its zone, not kept as a shape');
  assert.deepEqual(Array.from(st.tele.tier.slice(0, 3)), [TIER.DIM, TIER.MAJOR, 0]);
  assert.equal(poolTierAt(st, 70, 70, 110), TIER.FULL);
  assert.equal(poolTierAt(st, 71.5, 70, 110), 0, 'by its own place only');
  assert.ok(tellShowing(st, 9, H, 110), 'the DIM line\'s enemy flashes while its warning lasts');
  assert.ok(!tellShowing(st, 9, H + 4096, 110), 'not a newcomer in the same slot');
  assert.ok(!tellShowing(st, 9, H, 131), 'and stops when it ends');
  expireTelegraphs(st, 140);
  assert.equal(poolTierAt(st, 70, 70, 140), 0, 'gone with its warning');
});

test('music: three loops in the folk modes, every track a whole number of bars, every note in its mode', () => {
  assert.deepEqual(Object.keys(MUSIC).sort(), ['boss', 'harbor', 'run']);
  assert.deepEqual(parsePattern('0 - . | 2 x X'), ['0', '-', '.', '2', 'x', 'X']);
  assert.equal(midiOf({ key: 62, mode: 'aeolian' }, 0), 62);
  assert.equal(midiOf({ key: 62, mode: 'aeolian' }, 7), 74, 'degree 7 is the octave');
  assert.equal(midiOf({ key: 62, mode: 'aeolian' }, -1), 60, 'below the key: the seventh under it');
  assert.ok(Math.abs(freqOf(69) - 440) < 1e-9);
  for (const [k, L] of Object.entries(MUSIC)) {
    assert.ok(MODES[L.mode], `${k}: its mode`);
    const steps = loopSteps(L);
    for (const t of L.tracks) {
      assert.ok(VOICES[t.voice], `${k}: a voice called ${t.voice}`);
      const n = parsePattern(t.pattern).length;
      assert.equal(n, steps, `${k} ${t.voice}: as long as the loop`);
      assert.equal(n % L.bar, 0, `${k} ${t.voice}: whole bars`);
      for (const bar of t.pattern.split('|')) assert.equal(bar.trim().split(/\s+/).length, L.bar, `${k} ${t.voice}: each bar ${L.bar} steps`);
    }
    const notes = loopNotes(L);
    assert.ok(notes.length > steps / 2, `${k}: it plays`);
    for (const n of notes) if (n.midi !== null) assert.ok(MODES[L.mode].includes((((n.midi - L.key) % 12) + 12) % 12), `${k}: ${n.midi} is in ${L.mode}`);
    assert.ok(steps * L.step >= 8.5, `${k}: a loop of at least 8.5 s`);
  }
  assert.ok(AMBIENCE.bossDuck > 0 && AMBIENCE.bossDuck < 1, 'the bed ducks under a boss');
  // Which loop plays where.
  assert.equal(musicFor('title', null), 'harbor');
  assert.equal(musicFor('hub', null), 'harbor');
  assert.equal(musicFor('run', { bosses: [] }), 'run');
  assert.equal(musicFor('run', { bosses: [{ alive: false }, { alive: true }] }), 'boss');
  assert.equal(musicFor('loading', null), null);
});

test('every weapon fires its own sound, and every sound it names exists', () => {
  const seen = new Map();
  for (const w of DATA.weapons) {
    const s = fireSound(w);
    if (s === null) continue;
    assert.ok(SFX[s], `${w.id}: ${s} exists`);
    assert.ok(!seen.has(s), `${w.id} and ${seen.get(s)} both fire ${s}`);
    seen.set(s, w.id);
  }
  for (const [id, s] of Object.entries(WEAPON_FIRE)) assert.ok(SFX[s], `${id}: ${s}`);
  assert.equal(fireSound(null), null);
  assert.equal(fireSound({ id: 'new_thing', sfx: { fire: 'flare_fire' } }), 'flare_fire', 'a new weapon falls back to its data');
});

test('combat rumble: hits by their damage, boss attacks, elite and boss kills, level-ups but not dry ones, Forms, and a low-health pulse', () => {
  const ev = createEventBuffer(64, 8);
  ev.push(EV.HIT_STOP, 0, 0, HITSTOP.HURT, 10);
  ev.push(EV.HIT_STOP, 0, 0, HITSTOP.BOSS_HIT, 30);
  ev.push(EV.HIT_STOP, 0, 0, HITSTOP.ELITE_KILL, 0);
  ev.push(EV.HIT_STOP, 0, 0, HITSTOP.BOSS_KILL, 0);
  ev.push(EV.LEVEL_UP, 0, 0, 7);
  ev.push(EV.LEVEL_UP, 0, 0, 8);
  ev.push(EV.ASCEND, 0, 0, 1, 0);
  ev.push(EV.ASCEND, 0, 0, 1, 1);
  ev.push(EV.PLAYER_HURT, 0, 0, 10, 50);   // read through HIT_STOP, so a leech's drain never shakes
  const gifted = new Set([8]);
  assert.deepEqual(Array.from({ length: ev.count }, (_, i) => rumbleFor(ev, i, gifted)), ['hurt', 'bossHit', 'eliteKill', 'bossKill', 'levelUp', null, 'form', 'capstone', null]);
  for (const k of ['hurt', 'bossHit', 'eliteKill', 'bossKill', 'levelUp', 'form', 'capstone', 'lowHealth']) assert.ok(RUMBLE[k] && RUMBLE[k].ms <= 400, `${k}: in the table, short`);
  assert.ok(RUMBLE.bossKill.strong + RUMBLE.bossKill.weak > RUMBLE.eliteKill.strong + RUMBLE.eliteKill.weak, 'a boss falling shakes harder than an elite');
  assert.ok(RUMBLE.capstone.ms > RUMBLE.form.ms, 'a capstone longer than a Form');
  // A hit's shake grows with its damage, from a floor to the whole shake at a quarter of your health.
  assert.equal(hurtScale(1, 100), HURT_MIN_SCALE);
  assert.equal(hurtScale(25, 100), 1);
  assert.ok(hurtScale(15, 100) > hurtScale(10, 100));
  // Through the pad: the hit's shake is scaled; low health pulses, every PULSE_MS, only below 30%.
  const played = [];
  const pad = { index: 0, vibrationActuator: { playEffect: (type, fx) => { played.push(fx.strongMagnitude); return Promise.resolve(); } } };
  let t = 0;
  const r = createRumble({ table: RUMBLE, settings: () => ({ rumble: true, rumbleStrength: 0.5 }), getGamepads: () => [pad], activePad: () => 0, device: () => 'gamepad', now: () => t });
  const small = createEventBuffer(8, 2); small.push(EV.HIT_STOP, 0, 0, HITSTOP.HURT, 5);
  const big = createEventBuffer(8, 2); big.push(EV.HIT_STOP, 0, 0, HITSTOP.HURT, 30);
  const world = (hp) => ({ stats: { maxHp: 100 }, player: { hp }, over: null });
  assert.ok(r.events(small, world(90)));
  t += 1000;
  assert.ok(r.events(big, world(90)));
  assert.ok(played[1] > played[0], 'a harder hit shakes harder');
  const none = createEventBuffer(8, 2);
  t += 1000;
  assert.equal(r.events(none, world(80)), false, 'healthy: no pulse');
  assert.ok(r.events(none, world(20)), 'low health: a pulse');
  t += 100;
  assert.equal(r.events(none, world(20)), false, 'not again so soon');
  t += PULSE_MS;
  assert.ok(r.events(none, world(10)), 'and again after its beat');
  assert.ok(LOW_HEALTH > 0 && LOW_HEALTH < 0.5);
});

test('the run-end damage table: most damage first, each its share of the best and of the whole', () => {
  const result = { weapons: [{ id: 'harpoon_chain', level: 3, damage: 500 }, { id: 'flare_gun', level: 6, damage: 1500 }, { id: 'tide_bell', level: 1, damage: 0 }] };
  const rows = damageRows(result, DATA);
  assert.deepEqual(rows.map((r) => r.id), ['flare_gun', 'harpoon_chain', 'tide_bell']);
  assert.deepEqual(rows.map((r) => r.pct), [75, 25, 0]);
  assert.deepEqual(rows.map((r) => Math.round(r.share * 100)), [100, 33, 0]);
  assert.equal(rows[0].name, DATA.weapons.find((w) => w.id === 'flare_gun').name);
  assert.ok(rows[0].icon, 'with its icon');
  // From a live world: the slots and what each dealt.
  const def = DATA.weapons.find((w) => w.id === 'flare_gun');
  const live = damageRows({ slots: [{ def, level: 2, ascensions: [] }, null], result: { damageBySlot: [42] } }, DATA);
  assert.deepEqual(live.map((r) => [r.id, r.damage, r.pct]), [['flare_gun', 42, 100]]);
  assert.deepEqual(damageRows({ weapons: [] }, DATA), []);
});

test('a notice too wide for one line breaks at a space onto a second', () => {
  assert.equal(noticeBreak('Short line'), -1);
  const long = 'A clump of biting midges. They drift at you in threes and dart in once when close. Each bite slows you a little.';
  const k = noticeBreak(long);
  assert.ok(k > 0 && long[k] === ' ');
  assert.ok(textWidth(long.slice(0, k)) <= NOTICE_MAX_W && textWidth(long.slice(k + 1)) <= NOTICE_MAX_W);
});
