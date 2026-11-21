// The sweep's app fixes (S4 B3 to B6, C1, E2's page side, F1, G3), and the rules they keep:
// - Run again after a resume sets out as the run did; a checkpoint is written as a run sets out;
//   an import drops the old profile's run; a tab that doesn't own the save is offered nothing;
// - a minute's checkpoint packs a minute's frames, however long the run, and resumes exactly,
//   in the middle of a halt too;
// - every close question the page takes is answered;
// - a tab that keeps the focus looks for a new build on a timer and at the title or the harbor,
//   and loads it only at a safe point;
// - the tools' hooks are not in a player's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDocument } from './helpers/fakedom.js';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { createStore } from '../src/save/store.js';
import { createKvBackend, memoryKv } from '../src/save/backends.js';
import { readOnlyStore } from '../src/app/tabguard.js';
import { createInput } from '../src/input/input.js';
import { B } from '../src/input/gamepad.js';
import { createUi } from '../src/ui/screens.js';
import { questionScreen } from '../src/ui/menus.js';
import { createRunScene } from '../src/app/scenes/run.js';
import { createSceneManager } from '../src/app/scenes.js';
import { createRecordedRun } from '../src/sim/replay.js';
import { currentHalt, hashWorld } from '../src/sim/world.js';
import { createCheckpointer, createResumeOffer, readCheckpoint, makeCheckpoint, catchUp, runAgainChoice, keptChoice, CHECKPOINT_TICKS } from '../src/app/resume.js';
import { wireCloseQuestion } from '../src/app/closequestion.js';
import { createVersionCheck, attachVersionCheck, checkAtSafePoints, CHECK_EVERY_MS } from '../src/app/version-check.js';
import { FRAME_BYTES } from '../src/lib/inputframe.js';
import { inflateSync } from 'fflate';

const FRAME_MS = 1000 / 60;
const memStore = () => createStore({ backend: createKvBackend(memoryKv(), 'memory'), build: 'test' });
const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function dualSense(pressed = []) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, mapping: 'standard', connected: true, buttons, axes: [0, 0, 0, 0] };
}

/** A stick that wanders, and an answer for any halt. */
const stick = (t) => ({ mx: (t % 200) < 100 ? 100 : -100, my: ((t * 7) % 90) - 45, buttons: t % 300 === 0 ? 1 : 0 });
const answerFor = (h) => (h.kind === 'draft' || h.kind === 'relic' ? { kind: 'pick', index: 0 } : h.kind === 'chest' ? { kind: 'ok' } : h.kind === 'overtime' ? { kind: 'leave' } : h.kind === 'ferry' ? { kind: 'done' } : { kind: 'keep' });
function play(rec, ticks, { answer = true } = {}) {
  for (let k = 0; k < ticks && !rec.world.over; k++) {
    if (currentHalt(rec.world)) { if (!answer) return; rec.decide(answerFor(currentHalt(rec.world))); continue; }
    rec.step(stick(rec.world.tick));
    rec.world.events.clear();
  }
}
function resumeFrom(cp, buildId = 'b') {
  const c = catchUp(cp.replay, DATA, buildId);
  let guard = 0;
  while (!c.step(600) && guard++ < 1000) { /* chunks */ }
  return c.rec;
}

// ---------------------------------------------------------------- C1: a minute's frames a minute

test('checkpoints: each one packs only the frames since the last, and the last resumes the same run exactly', async () => {
  const store = memStore();
  // (Can't die: a wandering stick may not live 6 minutes, and the loop below waits on the clock.)
  const rec = createRecordedRun({ seed: 'x5-cp', character: 'lamplighter', invulnerable: true }, DATA, 'b');
  const cper = createCheckpointer();
  const meta = () => ({ runs: 2, map: rec.world.map.id, character: 'lamplighter', tick: rec.world.tick });
  // As the run sets out: nothing recorded, no chunk, and it can already be resumed.
  const first = cper.make(rec, meta());
  assert.deepEqual([first.v, first.replay.chunks.length, first.replay.frameBytes], [2, 0, 0]);
  assert.equal(readCheckpoint(JSON.parse(JSON.stringify(first)), { buildId: 'b', runs: 2 }).ok.tick, 0);
  let last = first, was = 0;
  for (let m = 1; m <= 6; m++) {
    while (rec.world.tick < m * 600 && !rec.world.over) play(rec, 1);
    const cp = cper.make(rec, meta());
    assert.equal(cp.replay.chunks.length, m, 'one more chunk');
    assert.deepEqual(cp.replay.chunks.slice(0, m - 1), last.replay.chunks, 'the chunks before it untouched');
    assert.equal(inflateSync(b64bytes(cp.replay.chunks[m - 1])).length, cp.replay.frameBytes - was, 'holding only the frames since the last one');
    assert.equal(cp.replay.frameBytes, rec.world.tick * FRAME_BYTES);
    was = cp.replay.frameBytes;
    last = cp;
    await store.saveCheckpoint(cp);
  }
  // Asked again with nothing new: no empty chunk.
  assert.equal(cper.make(rec, meta()).replay.chunks.length, 6);
  // Through the store's slot and back, on this build and profile only.
  const slot = await store.loadCheckpoint();
  assert.equal(readCheckpoint(slot, { buildId: 'other', runs: 2 }).why, 'another build');
  assert.equal(readCheckpoint(slot, { buildId: 'b', runs: 3 }).why, 'the profile moved on');
  const ok = readCheckpoint(slot, { buildId: 'b', runs: 2 }).ok;
  assert.equal(ok.tick, rec.world.tick);
  assert.deepEqual([...ok.replay.frames], [...rec.toReplay().frames], 'the same frames as the whole replay');
  const back = resumeFrom(ok);
  assert.equal(hashWorld(back.world), hashWorld(rec.world), 'the same run, exactly');
  // Played on with the same hands, both land in the same place, with the same recording.
  play(rec, 900); play(back, 900);
  assert.equal(hashWorld(back.world), hashWorld(rec.world));
  assert.deepEqual(back.toReplay().decisions, rec.toReplay().decisions);
  // Another run starts over: none of the last run's chunks.
  const other = createRecordedRun({ seed: 'x5-cp-2', character: 'lamplighter' }, DATA, 'b');
  play(other, 30);
  assert.equal(cper.make(other, meta()).replay.chunks.length, 1);
});

test('checkpoints: the work a checkpoint does late in a run is the frames since the last one, not the whole run\'s', () => {
  // A noisy stick (it packs badly, the worst case), a checkpoint every 120 ticks, 40 of them.
  const rec = createRecordedRun({ seed: 'x5-cost', character: 'lamplighter', invulnerable: true }, DATA, 'b');
  const cper = createCheckpointer();
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const sizes = [];
  for (let m = 1; m <= 40; m++) {
    while (rec.world.tick < m * 120) {
      if (currentHalt(rec.world)) { rec.decide(answerFor(currentHalt(rec.world))); continue; }
      rec.step({ mx: Math.round((rnd() - 0.5) * 250), my: Math.round((rnd() - 0.5) * 250), buttons: rnd() < 0.01 ? 1 : 0 });
      rec.world.events.clear();
    }
    const cp = cper.make(rec, { runs: 0, map: 'drowned_docks', character: 'lamplighter', tick: rec.world.tick });
    sizes.push(inflateSync(b64bytes(cp.replay.chunks.at(-1))).length);
  }
  // Every chunk is the same 120 ticks, the 40th as the 1st: what's packed doesn't grow with the run.
  assert.deepEqual([...new Set(sizes)], [120 * FRAME_BYTES]);
});

test('checkpoints: a resume in the middle of a halt waits on the same question, and answers land the same', () => {
  const a = createRecordedRun({ seed: 'x5-halt', character: 'lamplighter' }, DATA, 'b');
  const cper = createCheckpointer();
  // Play until the run waits on something (a level-up's cards), and checkpoint there, unanswered.
  let guard = 0;
  while (!currentHalt(a.world) && guard++ < 20000) play(a, 1, { answer: false });
  const halt = currentHalt(a.world);
  assert.ok(halt, 'the run reached a halt');
  const cp = JSON.parse(JSON.stringify(cper.make(a, { runs: 0, map: a.world.map.id, character: 'lamplighter', tick: a.world.tick })));
  const b = resumeFrom(readCheckpoint(cp, { buildId: 'b', runs: 0 }).ok);
  assert.equal(currentHalt(b.world)?.kind, halt.kind, 'the resumed run waits on the same question');
  assert.equal(hashWorld(b.world), hashWorld(a.world));
  // Answer it in both and play on, through later halts too.
  play(a, 2400); play(b, 2400);
  assert.equal(a.world.tick, b.world.tick);
  assert.equal(hashWorld(b.world), hashWorld(a.world), 'the same run after the answer');
  // A second checkpoint taken mid-halt after answers were given (the decisions travel with it).
  guard = 0;
  while (!currentHalt(a.world) && guard++ < 20000) play(a, 1, { answer: false });
  if (currentHalt(a.world)) {
    const c = resumeFrom(readCheckpoint(JSON.parse(JSON.stringify(cper.make(a, { runs: 0, map: a.world.map.id, character: 'lamplighter', tick: a.world.tick }))), { buildId: 'b', runs: 0 }).ok);
    assert.equal(hashWorld(c.world), hashWorld(a.world));
    assert.equal(currentHalt(c.world)?.kind, currentHalt(a.world).kind);
  }
});

test('checkpoints: a damaged or crafted chunked checkpoint reads as damaged, never throws, never unpacks past its count', () => {
  const rec = createRecordedRun({ seed: 'x5-bad', character: 'lamplighter' }, DATA, 'b');
  play(rec, 200);
  const good = createCheckpointer().make(rec, { runs: 0, map: 'drowned_docks', character: 'lamplighter', tick: rec.world.tick });
  const bad = (change) => { const c = JSON.parse(JSON.stringify(good)); change(c); return readCheckpoint(c, { buildId: 'b', runs: 0 }); };
  assert.ok(bad(() => {}).ok);
  for (const [name, change] of [
    ['a chunk cut short', (c) => { c.replay.chunks[0] = c.replay.chunks[0].slice(0, 10); }],
    ['a chunk that is not text', (c) => { c.replay.chunks[0] = 7; }],
    ['not base64', (c) => { c.replay.chunks[0] = '***'; }],
    ['a count below what the chunks hold', (c) => { c.replay.frameBytes -= FRAME_BYTES; }],
    ['a count above', (c) => { c.replay.frameBytes += FRAME_BYTES; }],
    ['a count that is not whole frames', (c) => { c.replay.frameBytes += 1; }],
    ['a huge count', (c) => { c.replay.frameBytes = 3e9; }],
    ['a negative count', (c) => { c.replay.frameBytes = -3; }],
    ['no decisions', (c) => { delete c.replay.decisions; }],
    ['no config', (c) => { c.replay.config = null; }],
    ['chunks not a list', (c) => { c.replay.chunks = 'x'; }],
    ['far too many chunks', (c) => { c.replay.chunks = Array.from({ length: 5000 }, () => c.replay.chunks[0]); }],
  ]) {
    const r = bad(change);
    assert.deepEqual([r.ok, r.why], [null, 'damaged'], name);
  }
  assert.equal(bad((c) => { c.replay = 5; }).why, 'none');
  assert.equal(bad((c) => { c.v = 3; }).why, 'none');
});

// ---------------------------------------------------------------- B3, B5: the run scene

function runRig({ onCheckpoint, configFor = null } = {}) {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const view = { now: 0, attach() {}, detach() {}, markTick() {}, consume() {}, draw(a, ms) { this.now += ms; }, screenFlash: () => 0 };
  const runs = [], saved = [];
  const scene = createRunScene({
    view, hud: { attach() {}, detach() {}, draw() {}, notice() {} }, input, ui, menuCtx, audio: { ok: false }, data: DATA, buildId: 'b',
    loop: { pause() {}, resume() {}, reset() {}, hitStop() {} }, renderer: { camera: { x: 0, y: 0 } },
    onRunSaved: (replay, result) => saved.push({ replay, result }), onHarbor() {}, startRun: (cfg) => runs.push(cfg),
    onSettings() {}, saveReport() {}, copyText: () => 'ok', onTitle() {}, onCheckpoint,
    ...(configFor ? { configFor } : {}),
  });
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); } };
  const press = (...b) => { box.pads = [dualSense(b)]; frame(); box.pads = [dualSense()]; frame(); };
  return { scene, ui, frame, press, runs, saved };
}

test('run scene: a checkpoint is written as the run sets out (after what it used up is saved), carrying the gate\'s choice', () => {
  const order = [];
  const cps = [];
  const cper = createCheckpointer();
  const choice = { character: 'lamplighter', map: 'drowned_docks', mode: 'standard', kit: 'lamplighter_orb', tide: 7, curses: ['c1', 'c2'], consumables: ['smelling_salts'], rune: 'splitting' };
  const t = runRig({
    configFor: (c) => { order.push('used up and saved'); return { seed: c.seed, character: c.character, map: c.map }; },
    onCheckpoint: (rec, w, ch) => { order.push(`checkpoint at ${w.tick}`); cps.push(cper.make(rec, { runs: 4, map: w.map.id, character: w.character.id, tick: w.tick, choice: ch })); },
  });
  t.scene.enter({ ...choice, seed: 'x5-start' });
  assert.deepEqual(order, ['used up and saved', 'checkpoint at 0'], 'before a single tick is played');
  const cp = readCheckpoint(JSON.parse(JSON.stringify(cps[0])), { buildId: 'b', runs: 4 }).ok;
  assert.ok(cp, 'a crash in the first minute has a run to resume');
  assert.equal(cp.tick, 0);
  assert.deepEqual(cp.choice, { character: 'lamplighter', map: 'drowned_docks', mode: 'standard', kit: 'lamplighter_orb', tide: 7, curses: ['c1', 'c2'] }, 'the choice, without the consumables and rune stone (used up)');
  t.scene.exit();
});

test('run scene: Run again after a resumed run sets out as that run did (Tide, curses, mode, kit, map)', () => {
  const cper = createCheckpointer();
  let last = null;
  const keep = (rec, w, ch) => { last = JSON.parse(JSON.stringify(cper.make(rec, { runs: 0, map: w.map.id, character: w.character.id, tick: w.tick, choice: ch }))); };
  const choice = { character: 'harpooner', map: 'drowned_docks', mode: 'short', kit: 'harpooner_bell', tide: 7, curses: ['c1', 'c2'], challenge: '', consumables: ['smelling_salts'], rune: 'splitting' };
  const first = runRig({ onCheckpoint: keep, configFor: (c) => ({ seed: c.seed, character: c.character, map: c.map }) });
  first.scene.enter({ ...choice, seed: 'x5-again' });
  first.frame(30);
  first.scene.checkpointNow();   // the tab closes
  assert.ok(last.tick > 0);
  first.scene.exit();
  // Another session: the title's Resume run.
  const resume = readCheckpoint(last, { buildId: 'b', runs: 0 }).ok;
  const t = runRig({ onCheckpoint: keep });
  const before = last;
  t.scene.enter({ resume });
  assert.equal(last, before, 'a resumed run writes no checkpoint as it starts (it has one)');
  t.frame(20);   // catches up
  assert.equal(t.scene.world.tick > 0, true);
  t.scene.recorded.decide({ kind: 'leave' });
  t.frame(Math.ceil(1400 / FRAME_MS) + 45);
  assert.match(t.ui.top.el.className, /end-screen/);
  t.ui.top.scope.focusKey('again');
  t.press(B.SOUTH);
  assert.equal(t.runs.length, 1);
  assert.deepEqual(t.runs[0], { character: 'harpooner', map: 'drowned_docks', mode: 'short', kit: 'harpooner_bell', tide: 7, curses: ['c1', 'c2'], challenge: '', seed: undefined, consumables: [], rune: '' });
  // And a later checkpoint of the resumed run still carries the choice (a second crash).
  t.scene.enter({ resume: readCheckpoint(before, { buildId: 'b', runs: 0 }).ok });
  t.frame(20);
  t.scene.checkpointNow();
  assert.equal(last.choice.tide, 7);
  t.scene.exit();
});

test('resume: the kept choice is plain values from a short list (a crafted checkpoint can\'t ask for a tools run)', () => {
  assert.deepEqual(keptChoice({ character: 'x', all: true, harbor: { a: 1 }, seed: 's', tide: 3.5, curses: ['a', 5, null, 'b'], map: 7, kit: 'k'.repeat(200), consumables: ['x'], rune: 'r' }), { character: 'x', curses: ['a', 'b'] });
  assert.equal(keptChoice(null), null);
  assert.equal(keptChoice('x'), null);
  // No choice in the checkpoint (an older one): the replay's character and map.
  assert.deepEqual(runAgainChoice({ replay: { config: { character: 'punter', map: 'salt_marsh', all: true } } }), { character: 'punter', map: 'salt_marsh', seed: undefined, consumables: [], rune: '' });
  // The whole (v1) checkpoint carries it too.
  const rec = createRecordedRun({ seed: 'x5-v1', character: 'lamplighter' }, DATA, 'b');
  play(rec, 10);
  const v1 = makeCheckpoint(rec.toReplay(), { runs: 0, map: 'drowned_docks', character: 'lamplighter', tick: 10, choice: { character: 'lamplighter', tide: 2 } });
  assert.deepEqual(readCheckpoint(v1, { buildId: 'b', runs: 0 }).ok.choice, { character: 'lamplighter', tide: 2 });
});

// ---------------------------------------------------------------- B4, B6: the title's offer

async function storeWithRun(runs = 3) {
  const store = memStore();
  const rec = createRecordedRun({ seed: 'x5-offer', character: 'lamplighter' }, DATA, 'b');
  play(rec, 120);
  await store.saveCheckpoint(createCheckpointer().make(rec, { runs, map: 'drowned_docks', character: 'lamplighter', tick: rec.world.tick }));
  return store;
}

test('resume offer: an import drops the old profile\'s run and clears its slot; the next start offers nothing', async () => {
  const store = await storeWithRun(3);
  const runs = 3;
  const offer = createResumeOffer({ store, buildId: 'b', runs: () => runs });
  assert.ok(await offer.load(), 'a run is on offer at the title');
  // A save code is imported at the title (main.js onImported): another profile, even one with the same count of runs.
  assert.equal(offer.drop(), true);
  assert.equal(offer.current, null, 'the title drawn again has no Resume run');
  await store.flush();
  assert.equal(await store.loadCheckpoint(), null, 'and the slot is cleared: the next launch offers nothing either');
  assert.equal(await createResumeOffer({ store, buildId: 'b', runs: () => runs }).load(), null);
  // An import with nothing on offer (a stale run in the slot) clears the slot too.
  const stale = await storeWithRun(9);
  const o2 = createResumeOffer({ store: stale, buildId: 'b', runs: () => 3 });
  assert.equal(await o2.load(), null);
  assert.equal(o2.drop(), false);
  await stale.flush();
  assert.equal(await stale.loadCheckpoint(), null);
  // main.js calls it from onImported, before the title is drawn again (a source check: main.js can't load in Node).
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\/\/[^\n]*\n/g, '').replace(/\s+/g, '');
  assert.ok(main.includes("onImported:()=>{resumeOffer.drop();if(scenes.name==='hub')scenes.go('hub');elseif(scenes.name==='title'){ui.closeAll();showTitle();}}"), 'onImported drops the left-over run');
});

test('resume offer: taken once; a tab that doesn\'t own the save is offered nothing and never reads the slot', async () => {
  const store = await storeWithRun(3);
  const notes = [];
  const offer = createResumeOffer({ store, buildId: 'b', runs: () => 3, note: (m) => notes.push(m) });
  await offer.load();
  const r = offer.take();
  assert.ok(r && r.replay);
  assert.equal(offer.take(), null, 'once');
  // The read-only second tab: the first tab's live run is in the slot.
  let read = 0;
  const ro = readOnlyStore(store);
  const spy = { ...ro, loadCheckpoint: () => { read++; return store.loadCheckpoint(); } };
  const second = createResumeOffer({ store: spy, buildId: 'b', runs: () => 3, owner: false });
  assert.equal(await second.load(), null);
  assert.equal(second.current, null);
  assert.equal(read, 0);
  second.drop();
  await store.flush();
  assert.ok(await store.loadCheckpoint(), 'and it can\'t clear the first tab\'s run');
  // A run that can't resume says why, once, as a notice.
  const other = createResumeOffer({ store, buildId: 'another', runs: () => 3, note: (m) => notes.push(m) });
  assert.equal(await other.load(), null);
  assert.deepEqual(notes, ['The saved run is from another version of the game, so it can\'t be resumed.']);
  // A store that throws offers nothing.
  assert.equal(await createResumeOffer({ store: { loadCheckpoint: async () => { throw new Error('x'); } }, buildId: 'b', runs: () => 0 }).load(), null);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\s+/g, '');
  assert.ok(main.includes('createResumeOffer({store,buildId:BUILD_ID,owner:tab.owner,'), 'main.js tells the offer whether this tab owns the save');
});

// ---------------------------------------------------------------- the close question, the page's side

function closeRig({ inRun = true, saveRun = async () => true, keepAll = async () => true } = {}) {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const acks = [], answers = [], paused = new Set(), errors = [];
  let asked = null;
  const native = { onCloseAsked: (f) => { asked = f; }, closeAck: () => acks.push(1), closeAnswer: (leave) => answers.push(leave) };
  const handler = wireCloseQuestion({
    native, ui, loop: { pause: (r) => paused.add(r), resume: (r) => paused.delete(r) },
    inRunNow: () => inRun, saveRun, keepAll, makeScreen: (o) => questionScreen(menuCtx, o), onError: (e) => errors.push(e),
  });
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); ui.update(FRAME_MS); } };
  const press = (...b) => { box.pads = [dualSense(b)]; frame(); box.pads = [dualSense()]; frame(); };
  const choose = (key) => { frame(20); ui.top.scope.focusKey(key); press(B.SOUTH); };
  return { ui, ask: (kind) => asked(kind), handler, acks, answers, paused, errors, frame, press, choose, texts: () => ui.top.el.textContent };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('close question (the page): every question taken is answered, once: Stay, Quit anyway, Back, and Save and quit', async () => {
  // Stay.
  const a = closeRig();
  a.ask('run');
  assert.equal(a.acks.length, 1, 'the page says it has the question');
  assert.match(a.texts(), /Quit in the middle of a run\?/);
  assert.ok(a.paused.has('close'), 'the run waits (under its own reason: the sweep, S3b F7)');
  a.choose('no');
  assert.deepEqual(a.answers, [false]);
  assert.equal(a.ui.top, null);
  assert.equal(a.paused.size, 0);
  // Asked again: it asks again (nothing left over).
  a.ask('run');
  a.choose('yes');
  assert.deepEqual(a.answers, [false, true]);
  // Back (the pad's Circle) is Stay.
  const b = closeRig();
  b.ask('run');
  b.frame(20);
  b.press(B.EAST);
  assert.deepEqual(b.answers, [false]);
  // A second close while the question is up: acked, no second screen, and one answer serves.
  const c = closeRig();
  c.ask('run'); c.ask('run');
  assert.equal(c.acks.length, 2);
  c.choose('yes');
  assert.equal(c.ui.top, null, 'one screen');
  assert.deepEqual(c.answers, [true]);
  // Save and quit: the run is left and saved, every save kept, then "leave".
  const order = [];
  const d = closeRig({ saveRun: async () => { order.push('run saved'); }, keepAll: async () => { order.push('all kept'); return true; } });
  d.ask('run');
  d.choose('save');
  await settle();
  assert.deepEqual(order, ['run saved', 'all kept']);
  assert.deepEqual(d.answers, [true]);
});

test('close question (the page): Save and quit answers "stay" when a save still fails or saving throws, never nothing', async () => {
  const failing = closeRig({ keepAll: async () => false });
  failing.ask('run');
  failing.choose('save');
  await settle();
  assert.deepEqual(failing.answers, [false], 'a save still fails: the window stays');
  const throwing = closeRig({ saveRun: async () => { throw new Error('the fold-in broke'); } });
  throwing.ask('run');
  throwing.choose('save');
  await settle();
  assert.deepEqual(throwing.answers, [false], 'saving threw: answered all the same, so the X still works');
  assert.equal(throwing.errors.length, 1);
  assert.equal(throwing.paused.size, 0);
  // A question that can't be shown is answered too.
  const acks = [], answers = [];
  const handler = wireCloseQuestion({
    native: { closeAck: () => acks.push(1), closeAnswer: (l) => answers.push(l) }, ui: { has: () => false, push() {}, close() {} },
    loop: { pause() {}, resume() {} }, inRunNow: () => true, saveRun: async () => {}, keepAll: async () => true,
    makeScreen: () => { throw new Error('no screen'); },
  });
  handler('run');
  assert.deepEqual([acks.length, answers], [1, [false]]);
});

test('close question (the page): a failing save, or a run that already ended, asks the unsaved-progress question (no Save and quit)', () => {
  const a = closeRig({ inRun: true });
  a.ask('unsaved');
  assert.match(a.texts(), /Unsaved progress/);
  assert.doesNotMatch(a.texts(), /Save and quit/);
  a.choose('yes');
  assert.deepEqual(a.answers, [true]);
  const b = closeRig({ inRun: false });
  b.ask('run');
  assert.doesNotMatch(b.texts(), /Save and quit/);
  b.choose('no');
  assert.deepEqual(b.answers, [false]);
});

// ---------------------------------------------------------------- F1: always the newest version

function vcRig({ served = 'B1', safe = true } = {}) {
  const h = { served, safe, now: 100000, reloads: 0, fetches: 0, timers: [], notices: [] };
  h.vc = createVersionCheck({
    currentBuild: 'B1', fetchVersion: async () => { h.fetches++; return { build: h.served }; }, isSafePoint: () => h.safe,
    reload: () => { h.reloads++; }, onUpdateReady: (i) => h.notices.push(i.stuck ? 'stuck' : 'ready'), now: () => h.now,
    setTimer: (fn, ms) => { h.timers.push({ fn, at: h.now + ms }); return h.timers.length; }, clearTimer: () => {},
    session: { m: new Map(), get(k) { return this.m.get(k) ?? null; }, set(k, v) { this.m.set(k, v); } },
  });
  return h;
}
const fakePage = () => {
  const mk = () => { const l = {}; return { addEventListener: (e, f) => { l[e] = f; }, removeEventListener: (e) => { delete l[e]; }, fire: (e) => l[e]?.(), l }; };
  return { win: mk(), doc: Object.assign(mk(), { visibilityState: 'visible' }) };
};

test('version check: a tab that keeps the focus looks again on a timer, and a hidden tab waits', async () => {
  const h = vcRig();
  const { win, doc } = fakePage();
  let every = null, cleared = null;
  const detach = attachVersionCheck(h.vc, win, doc, { setEvery: (fn, ms) => { every = { fn, ms }; return 77; }, clearEvery: (x) => { cleared = x; } });
  await settle();
  assert.equal(h.fetches, 1, 'on load');
  assert.equal(every.ms, CHECK_EVERY_MS);
  assert.ok(CHECK_EVERY_MS <= 10 * 60 * 1000, 'within minutes, not hours');
  // Hours in the tab, no focus or visibility event: the timer looks.
  h.now += CHECK_EVERY_MS;
  every.fn(); await settle();
  assert.equal(h.fetches, 2);
  // A new build is up; the player is mid-run: found, not loaded.
  h.served = 'B2'; h.safe = false; h.now += CHECK_EVERY_MS;
  every.fn(); await settle();
  assert.deepEqual([h.fetches, h.reloads, h.vc.pending, h.notices], [3, 0, true, ['ready']]);
  // Hidden: the timer doesn't fetch (becoming visible does).
  const g = vcRig();
  const p2 = fakePage();
  p2.doc.visibilityState = 'hidden';
  let ev2 = null;
  attachVersionCheck(g.vc, p2.win, p2.doc, { setEvery: (fn) => { ev2 = fn; return 1; }, clearEvery() {} });
  await settle();
  g.now += CHECK_EVERY_MS; ev2(); await settle();
  assert.equal(g.fetches, 1);
  detach();
  assert.equal(cleared, 77, 'detach stops the timer');
  // The default timer never keeps a process alive (this test file ends).
  const d2 = attachVersionCheck(vcRig().vc, fakePage().win, fakePage().doc);
  d2();
});

test('version check: reaching the title or a quiet harbor looks for a new build and loads it there, never as a run starts', async () => {
  const h = vcRig();
  const scenes = createSceneManager({ onError: (e) => { throw e; } });
  let harborIdle = false;
  scenes.register('title', { safePoint: true });
  scenes.register('run', { safePoint: false });
  scenes.register('hub', { get safePoint() { return harborIdle; } });
  h.safe = undefined;
  Object.defineProperty(h, 'safe', { get: () => scenes.isSafePoint() });
  checkAtSafePoints(h.vc, scenes);
  await scenes.go('title'); await settle();
  assert.equal(h.fetches, 1, 'at the title: a look');
  // Into a run: no look (and nothing to load).
  h.now += 60000;
  await scenes.go('run'); await settle();
  assert.equal(h.fetches, 1);
  // A deploy lands while the run is played. The run ends; the harbor comes up under the results: a look...
  h.served = 'B2'; h.now += 20 * 60000;
  await scenes.go('hub'); await settle();
  assert.deepEqual([h.fetches, h.reloads], [1, 0], 'not a safe point yet (the results are up): no look, no reload');
  // ...and back at the title (a safe point): found and loaded there.
  harborIdle = true;
  await scenes.go('title'); await settle();
  assert.deepEqual([h.fetches, h.reloads], [2, 1], 'found at the title and loaded at once');
  // An update found mid-run (by the timer) loads on reaching the title.
  const g = vcRig({ served: 'B2', safe: false });
  await g.vc.check({ force: true });
  assert.deepEqual([g.vc.pending, g.reloads], [true, 0]);
  const s2 = createSceneManager({ onError: (e) => { throw e; } });
  s2.register('title', { safePoint: true });
  Object.defineProperty(g, 'safe', { get: () => s2.isSafePoint() });
  checkAtSafePoints(g.vc, s2);
  await s2.go('title'); await settle();
  assert.equal(g.reloads, 1);
});

// ---------------------------------------------------------------- G3: the tools' hooks

test('the public page carries no tool hooks: the smoke runner loads only for ?smoke, and so does window.__lamplight', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import[^\n]*app\/smoke\.js/m, 'no static import of the smoke runner (it would ship in the main bundle)');
  const flat = src.replace(/\s+/g, '');
  assert.ok(flat.includes("if(params.has('smoke')){window.__lamplight=game;const{runSmoke}=awaitimport('./app/smoke.js');"), 'both inside the ?smoke branch');
  assert.equal(src.split('window.__lamplight').length - 1, 2, 'window.__lamplight is set in one place (and named once in the comment above it)');
  assert.equal(src.split('smoke.js').length - 1, 1);
});
