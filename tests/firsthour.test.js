// The first hour, controls, and robustness (0.9.0, W7; the veteran round's V4 and V5): the results
// leading with what can be bought, lists as counts, "1 kill"; a purchase that would take a Ready
// level out of reach saying so; the settings' descriptions; tips over the things themselves; first
// sightings held until their enemy is on screen; the death recap; the Spoils screen; the relic
// swap; a save code's size cap and import by paste; the run's checkpoint and resuming it; the
// second tab's guard; the desktop's close question on the game's own screen; and the soak's clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDocument, textsOf } from './helpers/fakedom.js';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { changeLines, readyNow, purchaseWarning, killsText, COLLAPSE_AT, TIDE_LINE } from '../src/ui/hubtext.js';
import { buyUpgrade, restoreBuilding } from '../src/meta/actions.js';
import { SETTING_DESCS } from '../src/app/settings-flow.js';
import { createWorldTips, worldTips, tipsSeeEvents, createSightings, sightingLine, createHurtLog, deathRecap, killerText, HURT_KIND, TIP_SEC } from '../src/app/runtips.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld } from '../src/sim/world.js';
import { createRecordedRun } from '../src/sim/replay.js';
import { createEventBuffer, EV } from '../src/sim/events.js';
import { TASK, TASK_STATE, PK } from '../src/sim/constants.js';
import { encodeExportCode, decodeExportCode, b64urlEncode, MAX_SAVE_BYTES } from '../src/save/codec.js';
import { createStore } from '../src/save/store.js';
import { createKvBackend, memoryKv } from '../src/save/backends.js';
import { makeCheckpoint, readCheckpoint, catchUp, resumeNote, CHECKPOINT_TICKS } from '../src/app/resume.js';
import { claimSaves, readOnlyStore, TAB_TEXT } from '../src/app/tabguard.js';
import { deflateSync, strToU8 } from 'fflate';

const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 99999]));
function withMats(doc, mats) { const d = structuredClone(doc); Object.assign(d.profile.materials, mats); return d; }

// ------------------------------------------------------------------------------ the harbor's words

test('results: lists longer than a few are their count; "1 kill"; the first Tide says what a Tide is', () => {
  const doc = defaultProfile();
  const names = DATA.enemies.slice(0, COLLAPSE_AT + 2).map((e) => `enemy:${e.id}`);
  const many = changeLines(DATA, [{ kind: 'sighted', map: 'drowned_docks', names }], doc).map((l) => l.text);
  assert.ok(many.includes(`${names.length} new in the codex for this map (the pause menu in a run)`), many.join(' | '));
  const few = changeLines(DATA, [{ kind: 'sighted', map: 'drowned_docks', names: names.slice(0, 2) }], doc).map((l) => l.text);
  assert.ok(few.some((t) => t.startsWith('New in the codex: ')));
  const discovered = DATA.weapons.slice(0, COLLAPSE_AT + 1).map((w) => ({ kind: 'codex', key: `weapon:${w.id}` }));
  assert.ok(changeLines(DATA, discovered, doc).some((l) => l.text === `Discovered ${discovered.length} new weapons, passives, and relics`));
  // (Ruling 13: kill counts are on the codex's enemy page; the results say nothing of them.)
  assert.deepEqual(changeLines(DATA, [{ kind: 'bestiary', id: DATA.enemies[0].id, kills: 1 }], doc), []);
  assert.equal(killsText(1), '1 kill');
  assert.equal(killsText(3000), '3,000 kills');
  const tide = changeLines(DATA, [{ kind: 'tide', level: 1, map: 'drowned_docks' }], doc).find((l) => l.kind === 'tide').text;
  assert.ok(tide.includes(TIDE_LINE), tide);
  const tide2 = changeLines(DATA, [{ kind: 'tide', level: 2, map: 'drowned_docks' }], doc).find((l) => l.kind === 'tide').text;
  assert.ok(!tide2.includes(TIDE_LINE), 'said once, at the first');
});

test('results: what can be bought now leads, with where (V4: it showed only in Next up)', () => {
  assert.deepEqual(readyNow(defaultProfile(), DATA), [], 'nothing on a fresh profile');
  const r = readyNow(withMats(defaultProfile(), RICH), DATA);
  assert.ok(r.length >= 1 && r.length <= 4);
  assert.equal(r[0].kind, 'building', 'buildings first');
  assert.match(r[0].at, /^Ready at the /);
});

test('a purchase that would take a Ready level out of reach says so (V4: Brighter Flame cost Lamp Post Lv 2 and said nothing)', () => {
  // Just enough for the Lamp Post's next level, and an upgrade that spends the same Oil.
  let doc = withMats(defaultProfile(), RICH);
  doc = restoreBuilding(doc, DATA, 'lamp_post').doc;
  const next = DATA.buildings.find((b) => b.id === 'lamp_post').levels[1].cost;
  const d = structuredClone(doc);
  d.profile.materials = { ...next };
  const u = DATA.upgrades.find((x) => x.tier === 1 && Object.keys(x.cost || x.costs?.[0] || {}).some((k) => next[k]));
  let after = null;
  try { after = buyUpgrade(d, DATA, u.id).doc; } catch { after = null; }
  if (after) {
    const warn = purchaseWarning(d, DATA, after);
    assert.match(warn, /^Leaves Lamp Post Lv 2 short of \d+ /, String(warn));
  }
  assert.equal(purchaseWarning(withMats(defaultProfile(), RICH), DATA, withMats(defaultProfile(), RICH)), null, 'nothing lost, nothing said');
  assert.equal(purchaseWarning(d, DATA, null), null, 'a refused purchase says nothing here');
});

test('settings: every row says what it does, in plain sentences', async () => {
  installFakeDocument();
  const { openSettings } = await import('../src/app/settings-flow.js');
  const { defaultSettings } = await import('../src/save/schema.js');
  const pushed = [];
  const ui = { push: (s) => pushed.push(s), close() {}, relabel() {}, setTextScale() {}, glyph: (a) => { const g = document.createElement('span'); g.textContent = a; return g; } };
  const menuCtx = { ui, icon: () => document.createElement('span'), sound() {} };
  const s = openSettings({ ui, menuCtx, settings: defaultSettings(), desktop: true, native: null, atTitleOrHarbor: () => true, input: { setSettings() {}, controllerType: null }, audio: { setVolumes() {} }, renderer: { setFillScreen() {} }, save: async () => {} });
  const keys = [...s.el.querySelectorAll('.set-row')].map((r) => r.dataset.focus);
  for (const k of keys) assert.match(SETTING_DESCS[k] ?? '', /^[A-Z].*\.$/, `${k} has a description`);
  for (const k of ['access.textScale', 'access.highContrast', 'access.brightness', 'audio.music', 'audio.ambience', 'controls.open', 'play.fullBuild']) assert.ok(keys.includes(k), k);
  // The prompts say how a row changes (◀ ▶), as the gate's do.
  assert.ok(textsOf(s.el).includes('sides'), textsOf(s.el).join(' | '));
});

// ------------------------------------------------------------------------------ in a run

test('tips over the things themselves: a lamp on screen, once, gone when one is lit or after its seconds; not for what earlier runs showed', () => {
  const w = createWorld({ seed: 'tips', character: 'harpooner' }, DATA);
  const lamp = w.tasks.find((t) => t.kind === TASK.LAMP);
  // (The Lamplighter's own lamp tip says hers light at a touch: ruling 14 item 13.)
  const own = createWorld({ seed: 'tips', character: 'lamplighter' }, DATA);
  assert.ok(worldTips(createWorldTips({ firstRun: true }), own, { x: lamp.x + 40, y: lamp.y }, 0).some((t) => t.kind === 'lamp_touch' && /at a touch/.test(t.text)));
  const cam = { x: lamp.x + 40, y: lamp.y };
  const T = createWorldTips({ known: new Set(), firstRun: true });
  const at0 = worldTips(T, w, cam, 0);
  assert.ok(at0.some((t) => t.kind === 'lamp' && t.x === lamp.x && /circle/.test(t.text)), JSON.stringify(at0));
  assert.equal(worldTips(T, w, { x: lamp.x + 2000, y: lamp.y }, 1).length, 0, 'off screen: nothing');
  assert.equal(worldTips(T, w, cam, TIP_SEC + 1).filter((t) => t.kind === 'lamp').length, 0, 'gone after its seconds');
  const T2 = createWorldTips({ known: new Set(), firstRun: false });
  lamp.state = TASK_STATE.DONE;
  assert.equal(worldTips(T2, w, cam, 0).filter((t) => t.kind === 'lamp').length, 0, 'a lamp lit: done');
  lamp.state = TASK_STATE.IDLE;
  assert.equal(worldTips(createWorldTips({ known: new Set(['lamp']) }), w, cam, 0).filter((t) => t.kind === 'lamp').length, 0, 'shown on an earlier run');
  // A chest's tip only in a first run, and gone once a chest opens.
  const ev = createEventBuffer(8, 1);
  ev.push(EV.CHEST, 0, 0, 1, 1);
  tipsSeeEvents(T, ev);
  assert.ok(T.done.has('chest'));
});

test('first sightings: one line, held until the enemy is on screen (V4: "First sighting: Fog Wisp" at 0:00 with no wisp in view)', () => {
  const w = createWorld({ seed: 'sight', character: 'lamplighter' }, DATA);
  const S = createSightings();
  const type = 0;
  S.add(`enemy:${w.enemyDefs[type].id}`, w, type);
  const far = { x: w.player.x + 5000, y: w.player.y };
  assert.deepEqual(S.ready(w, far), [], 'none on screen: it waits');
  const E = w.enemies;
  const i = E.alloc(); E.type[i] = type; E.x[i] = w.player.x + 30; E.y[i] = w.player.y;
  const lines = S.ready(w, { x: w.player.x, y: w.player.y });
  assert.deepEqual(lines, [sightingLine(DATA, `enemy:${w.enemyDefs[type].id}`)]);
  assert.match(lines[0], /^First sighting: [^.]+\. [A-Z]/, 'the name and what it is, one line');
  assert.equal(S.count, 0);
  S.add('water', w);
  assert.deepEqual(S.ready(w, far), [sightingLine(DATA, 'water')], 'a thing shows at once');
});

test('the death recap: what killed you, and the last 5s by source, biggest first', () => {
  const defs = DATA.enemies;
  const boss = defs.findIndex((e) => e.id === 'the_tidecaller'), sailor = defs.findIndex((e) => e.id === 'drowned_sailor');
  const hurts = [
    { tick: 100, damage: 50, kind: HURT_KIND.CONTACT, type: sailor },            // too long ago
    { tick: 900, damage: 10, kind: HURT_KIND.CONTACT, type: sailor },
    { tick: 950, damage: 12, kind: HURT_KIND.CONTACT, type: sailor },
    { tick: 990, damage: 40, kind: HURT_KIND.BOSS, type: boss, name: 'tide line' },
  ];
  const r = deathRecap(defs, hurts, 1000);
  assert.equal(r.killer, `the ${defs[boss].name.replace(/^The /, '')}'s tide line`);
  assert.deepEqual(r.lines, [`${defs[boss].name.replace(/^The /, '')}, tide line: 1 hit, 40 damage`, `${defs[sailor].name}, touch: 2 hits, 22 damage`]);
  assert.equal(killerText(defs, { kind: HURT_KIND.CONTACT, type: sailor }), `a ${defs[sailor].name}`);
  assert.equal(killerText(defs, { kind: HURT_KIND.STRIKE, type: -1 }), 'the storm\'s lightning');
  assert.equal(deathRecap(defs, [], 10), null);
  // The scene's own log names a hurt the sim didn't by the enemy standing where it came from.
  const w = createWorld({ seed: 'hurt', character: 'lamplighter' }, DATA);
  const E = w.enemies;
  const i = E.alloc(); E.type[i] = sailor; E.x[i] = 100; E.y[i] = 120;
  const ev = createEventBuffer(8, 1);
  ev.push(EV.PLAYER_HURT, 100, 120, 7, 50, 0, 0);
  const log = createHurtLog();
  log.add(w, ev, 0);
  assert.deepEqual(log.list().map((h) => [h.kind, h.type, h.damage]), [[HURT_KIND.CONTACT, sailor, 7]]);
});

test('Spoils: one screen for a chest and what follows: the reel, then the Ember and its Forms with their prices (V4: 3 to 5 screens)', async () => {
  installFakeDocument();
  const { spoilsScreen } = await import('../src/ui/menus.js');
  const ctx = { ui: { glyph: (a) => { const g = document.createElement('span'); g.textContent = a; return g; } }, icon: () => document.createElement('span'), sound() {} };
  let seen = 0;
  const s = spoilsScreen(ctx, { items: [{ title: 'Flare Gun', sub: 'Lv 3', desc: '+1 Pierce', icon: 'x', kind: 'weapon' }], pool: ['x'], after: 'an Ember to spend', onContinue: () => seen++ });
  document.body.appendChild(s.el);
  assert.ok(textsOf(s.el).includes('Then: an Ember to spend'));
  s.el.querySelector('[data-focus="go"]').click();   // lands the reel
  s.el.querySelector('[data-focus="go"]').click();   // then goes on
  assert.equal(seen, 1);
  const w = { slot: 0, name: 'Flare Gun', icon: 'x', taken: [], forms: [
    { id: 'salvo', name: 'Salvo', desc: 'Every 6th flare also sets off a ring of 6.', price: '+10% Cooldown', axis: 'delivery', taken: false, cost: 'ember', switches: null, why: null },
    { id: 'mortar', name: 'Mortar', desc: 'Lobbed.', price: '+25% Cooldown', axis: 'flight', taken: false, cost: null, switches: null, why: 'Opens at 10 upgrades (3 now)' }] };
  const picked = [];
  s.setStep({ kind: 'ember', embers: 1, weapons: [w], onPick: () => picked.push('w'), onKeep() {} });
  assert.ok(textsOf(s.el).includes('0 of 3 Forms'));
  s.el.querySelector('[data-focus="e0"]').click();
  assert.deepEqual(picked, ['w']);
  const took = [];
  s.setStep({ kind: 'forms', weapon: w, onAscend: (id) => took.push(id), onBack() {} });
  assert.ok(textsOf(s.el).includes('Drawback: +10% Cooldown'), 'each option says its drawback');
  assert.ok(textsOf(s.el).includes('Opens at 10 upgrades (3 now)'), 'and one it can\'t take says what opens it');
  s.el.querySelector('[data-focus="f0"]').click();
  s.el.querySelector('[data-focus="f1"]').click();   // (shut: plays the menu's "no")
  assert.deepEqual(took, ['salvo']);
  s.done('Flare Gun: Salvo');
  const kept = [];
  s.setStep({ kind: 'ember', embers: 1, weapons: [], onPick() {}, onKeep: () => kept.push(1) });
  s.el.querySelector('[data-focus="keep"]').click();
  assert.deepEqual(kept, [1]);
  assert.ok(textsOf(s.el).includes('Flare Gun: Salvo'), 'what was done stays listed');
});

test('a real boss chest with an Ember after it opens one Spoils screen through the run scene', async () => {
  const src = readFileSync(new URL('../src/app/scenes/run.js', import.meta.url), 'utf8');
  assert.ok(/if \(v\.boss \|\| v\.secret \|\| chain\.length\) \{ openSpoils\(v, chain, pool\); break; \}/.test(src), 'the chest halt goes to Spoils');
  assert.ok(!/rune/i.test(src.replace(/rune: ''/g, '')), 'no rune step left in the run scene');
  // The halts it chains are the sim's own: a boss chest, then an Ember's choice.
  const rec = createRecordedRun({ seed: 'spoils', character: 'lamplighter' }, DATA, 'b');
  rec.step({ mx: 0, my: 0, buttons: 0 });
  rec.decide({ kind: 'dev', cmd: 'chest', boss: true });
  rec.decide({ kind: 'dev', cmd: 'ember' });
  const kinds = rec.world.halts.map((h) => h.kind);
  assert.equal(kinds[0], 'chest');
  assert.ok(kinds.slice(1).every((k) => k === 'ascend'), kinds.join());
});

test('relic slots full: a pick asks which carried relic to give up, Pass keeps them (W1\'s contract §5)', async () => {
  installFakeDocument();
  const { relicScreen } = await import('../src/ui/menus.js');
  const ctx = { ui: { glyph: (a) => { const g = document.createElement('span'); g.textContent = a; return g; } }, icon: () => document.createElement('span'), sound() {} };
  const card = (id) => ({ id, name: id, desc: 'd', icon: 'x', tierName: 'Trinket, tier 1 of 3' });
  const picks = [];
  let passed = 0;
  const s = relicScreen(ctx, { vault: false, relics: [card('new_a'), card('new_b')], full: true, slots: { used: 3, total: 3 }, carried: [card('old_1'), card('old_2'), card('old_3')], onPick: (i, sw) => picks.push([i, sw]), onPass: () => passed++ });
  document.body.appendChild(s.el);
  assert.ok(textsOf(s.el).some((t) => t.startsWith('Relic slots full (3 of 3)')));
  s.el.querySelector('[data-focus="c1"]').click();
  assert.ok(textsOf(s.el).includes('Give up which relic for new_b?'));
  s.el.querySelector('[data-focus="g2"]').click();
  assert.deepEqual(picks, [[1, 'old_3']]);
  s.onBack();
  s.el.querySelector('[data-focus="pass"]')?.click();
  assert.equal(passed, 1);
});

// ------------------------------------------------------------------------------ saves

test('save codes: a code past the cap stops unpacking at the cap (V5: 267 KB ran 10 s to 2.3 GB)', () => {
  const big = `{"v":4,"profile":{},"x":"${'a'.repeat(MAX_SAVE_BYTES + 100)}"}`;
  const code = `LAMP1.${b64urlEncode(deflateSync(strToU8(big), { level: 9 }))}.00000000`;
  const t0 = performance.now();
  assert.throws(() => decodeExportCode(code), /far more than a save/);
  assert.ok(performance.now() - t0 < 5000);
  assert.throws(() => decodeExportCode('x'.repeat(5 * 1024 * 1024)), /far too long/);
  assert.deepEqual(decodeExportCode(encodeExportCode({ v: 4, profile: { a: 1 } })), { v: 4, profile: { a: 1 } });
});

test('save codes: Paste code imports from the clipboard; a clipboard that can\'t be read opens a box to paste into', async () => {
  installFakeDocument();
  const { createSaveCodes } = await import('../src/app/savecode.js');
  const store = createStore({ backend: createKvBackend(memoryKv(), 'memory') });
  const pushed = [];
  const ui = { push: (s) => pushed.push(s), close() {}, glyph: (a) => { const g = document.createElement('span'); g.textContent = a; return g; } };
  const menuCtx = { ui, icon: () => document.createElement('span'), sound() {} };
  const doc = defaultProfile(); doc.stats.runs = 7;
  let clip = encodeExportCode(doc);
  const keeper = { profile: defaultProfile(), keep: async () => true };
  const codes = createSaveCodes({ ui, menuCtx, store, keeper, data: DATA, deliverFile: async () => 'x', copy: async () => true, readClipboard: async () => { if (clip === null) throw new Error('denied'); return clip; }, onImported() {} });
  const screen = codes.open();
  await codes.pasteCode();
  assert.match(pushed.at(-1).el.textContent, /7 runs/, 'the question names what the code holds');
  clip = null;
  await codes.pasteCode();
  assert.equal(screen.pasteBox.hidden, false, 'the box opens');
  assert.match(screen.note, /Ctrl\+V/);
  codes.importText(encodeExportCode(doc));
  assert.match(pushed.at(-1).el.textContent, /7 runs/);
  // A read-only tab (app/tabguard.js) can't import.
  const ro = createSaveCodes({ ui, menuCtx, store: readOnlyStore(store), keeper, data: DATA, deliverFile: async () => 'x', copy: async () => true, readClipboard: async () => encodeExportCode(doc), onImported() {} });
  const roScreen = ro.open();
  await ro.pasteCode();
  assert.match(roScreen.note, /open in another tab/);
});

test('the run\'s checkpoint: saved whole, read back on this build and profile only, and a resumed run catches up to the same state', () => {
  const rec = createRecordedRun({ seed: 'cp', character: 'lamplighter' }, DATA, 'build-x');
  for (let t = 0; t < 1500; t++) {
    rec.step({ mx: (t % 200) < 100 ? 100 : -100, my: 40, buttons: t % 300 === 0 ? 1 : 0 });
    while (currentHalt(rec.world)) rec.decide(currentHalt(rec.world).kind === 'draft' ? { kind: 'pick', index: 0 } : currentHalt(rec.world).kind === 'chest' ? { kind: 'ok' } : { kind: 'keep' });
  }
  const cp = makeCheckpoint(rec.toReplay(), { runs: 3, map: 'drowned_docks', character: 'lamplighter', tick: rec.world.tick });
  assert.equal(readCheckpoint(cp, { buildId: 'other', runs: 3 }).ok, null, 'another build: no');
  assert.equal(readCheckpoint(cp, { buildId: 'build-x', runs: 4 }).why, 'the profile moved on');
  const ok = readCheckpoint(JSON.parse(JSON.stringify(cp)), { buildId: 'build-x', runs: 3 }).ok;
  assert.ok(ok && ok.tick === rec.world.tick);
  assert.match(resumeNote(DATA, ok), /^The Lamplighter's run on the Drowned Docks stopped at 0:25\./);
  const c = catchUp(ok.replay, DATA, 'build-x');
  let guard = 0;
  while (!c.step(200) && guard++ < 100) { /* chunks */ }
  assert.equal(c.rec.world.tick, rec.world.tick);
  assert.equal(hashWorld(c.rec.world), hashWorld(rec.world), 'the same run, exactly');
  // It goes on recording: a replay of the resumed run is the whole run.
  assert.equal(c.rec.toReplay().decisions.length, rec.toReplay().decisions.length);
  assert.equal(CHECKPOINT_TICKS, 3600);
});

test('the store keeps one checkpoint slot: saved, read, and cleared', async () => {
  const store = createStore({ backend: createKvBackend(memoryKv(), 'memory') });
  assert.equal(await store.loadCheckpoint(), null);
  await store.saveCheckpoint({ v: 1, replay: 'abc', runs: 1 });
  assert.deepEqual(await store.loadCheckpoint(), { v: 1, replay: 'abc', runs: 1 });
  await store.clearCheckpoint();
  assert.equal(await store.loadCheckpoint(), null);
});

test('a second tab saves nothing and says so; when the first closes, the second is told to reload (V5: tabs overwrote each other)', async () => {
  // A stand-in for navigator.locks: one holder; a waiting request is granted when it lets go.
  const held = new Map();
  const locks = {
    request(name, a, b) {
      const opts = typeof a === 'function' ? {} : a, fn = typeof a === 'function' ? a : b;
      if (held.has(name)) {
        if (opts.ifAvailable) return Promise.resolve(fn(null));
        return new Promise((res) => held.get(name).waiters.push(() => res(fn({ name }))));
      }
      held.set(name, { waiters: [] });
      fn({ name });
      return Promise.resolve();
    },
  };
  const first = await claimSaves({ locks, name: 'save' });
  const second = await claimSaves({ locks, name: 'save' });
  assert.deepEqual([first.owner, second.owner], [true, false]);
  let freed = false;
  second.onFree(() => { freed = true; });
  const h = held.get('save'); held.delete('save'); for (const w of h.waiters) w();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(freed, true);
  assert.deepEqual((await claimSaves({ locks: null })).owner, true, 'no Web Locks: as before');
  const store = createStore({ backend: createKvBackend(memoryKv(), 'memory') });
  const ro = readOnlyStore(store);
  await ro.saveProfile(defaultProfile());
  assert.equal((await store.loadProfile()).source, 'new', 'nothing was written');
  assert.ok(ro.readOnly && TAB_TEXT.readOnly.includes('another tab'));
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes("const store = tab.owner ? opened.store : readOnlyStore(opened.store);"), 'the boot wires it');
});

// ------------------------------------------------------------------------------ the desktop and the soak

test('desktop: closing the window mid-run asks on the game\'s own screen; the system\'s dialog only when the page doesn\'t answer', async () => {
  const S = (await import('module')).createRequire(import.meta.url)('../desktop/shell.cjs');
  const timers = { pending: [], setTimeout(fn) { this.pending.push(fn); return this.pending.length; }, clearTimeout(id) { this.pending[id - 1] = null; } };
  const sent = [];
  const q = S.createPageQuestion((kind) => sent.push(kind), { timers });
  const handlers = {};
  const win = { destroyed: false, isDestroyed() { return this.destroyed; }, on(ev, fn) { handlers[ev] = fn; }, webContents: { on() {} }, close() { const e = { prevented: false, preventDefault() { this.prevented = true; } }; handlers.close(e); if (!e.prevented) this.destroyed = true; } };
  const dialogs = [];
  const later = [];
  S.askBeforeClosing(win, { showMessageBoxSync: (w, d) => { dialogs.push(d); return 1; } }, () => ({ unsaved: false, inRun: true, quitting: false }), (fn) => later.push(fn), q);
  win.close();
  assert.deepEqual([sent, dialogs.length, win.destroyed], [['run'], 0, false], 'the page is asked, not the system');
  q.ack();
  for (const f of timers.pending) f?.();
  assert.equal(dialogs.length, 0, 'acknowledged: no fallback');
  q.answer(true);
  later.forEach((f) => f());
  assert.equal(win.destroyed, true, 'the answer closes it');
  // A page that never takes the question: the system's dialog asks (Stay).
  const sent2 = [], t2 = { pending: [], setTimeout(fn) { this.pending.push(fn); return 1; }, clearTimeout() {} };
  const q2 = S.createPageQuestion((k) => sent2.push(k), { timers: t2 });
  const h2 = {};
  const w2 = { destroyed: false, isDestroyed() { return this.destroyed; }, on(ev, fn) { h2[ev] = fn; }, webContents: { on() {} } };
  const d2 = [];
  S.askBeforeClosing(w2, { showMessageBoxSync: (w, d) => { d2.push(d); return 1; } }, () => ({ unsaved: true, inRun: false, quitting: false }), () => {}, q2);
  h2.close({ preventDefault() {} });
  t2.pending[0]();
  assert.deepEqual([sent2, d2], [['unsaved'], [S.LEAVE_DIALOG]]);
});

test('soak: ticks are judged by wall time on a quiet machine, else by CPU time with 1 ms allowed; both clocks reported (V5, 0.9.0 release)', () => {
  const src = readFileSync(new URL('../tools/soak/soak.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('process.cpuUsage(c0)'));
  assert.ok(src.includes('const QUIET = 1.0, WAIT_S = 300, POLL_S = 10, CPU_ALLOWANCE_MS = 1;'));
  assert.ok(src.includes("const byWall = process.argv.includes('--wall') || load < QUIET;"));
  assert.ok(src.includes('budgetP99: b.p99Ms + allowance'));
  assert.ok(src.includes("[byWall ? 'cpuMsPerTick' : 'wallMsPerTick']"));
});

test('the Fog Bell\'s pick says the same stat once, added up (V4: "+10% Area (Light), +10% Area (Light)")', async () => {
  const { mergeStatLines } = await import('../src/app/runlogic.js');
  assert.equal(mergeStatLines('+10% Area (Light), +10% Area (Light)'), '+20% Area (Light)');
  assert.equal(mergeStatLines('+1 Pierce, +5 Damage, +1 Pierce, -0.1s Cooldown, -0.05s Cooldown'), '+2 Pierce, +5 Damage, -0.15s Cooldown');
  assert.equal(mergeStatLines('Heals HP.'), 'Heals HP.');
});
