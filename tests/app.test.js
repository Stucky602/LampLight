import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, splitCamera, placeView, worldSpriteOrigin, VIEW_W, VIEW_H, MARGIN } from '../src/render/layout.js';
import { createSceneManager } from '../src/app/scenes.js';
import { createVersionCheck, attachVersionCheck, fetchVersionJson, RELOAD_KEY, RELOAD_AT_KEY } from '../src/app/version-check.js';
import { createProgressKeeper, SAVE_FAILED_TEXT } from '../src/app/keeper.js';
import { createUpdateMarker, UPDATE_TEXT } from '../src/ui/update-marker.js';
import { createErrorLog } from '../src/app/errors.js';
import { createGameFlow } from '../src/app/flow.js';
import { defaultProfile } from '../src/save/schema.js';
import { DATA } from '../src/data/index.js';
import { readFileSync } from 'node:fs';

test('layout: whole-number scaling at the common PC resolutions', () => {
  const cases = [
    [1920, 1080, 3, 0, 0], [2560, 1440, 4, 0, 0], [3840, 2160, 6, 0, 0],
    [1280, 720, 2, 0, 0], [1366, 768, 2, 43, 24], [2560, 1080, 3, 320, 0], [3440, 1440, 4, 440, 0],
  ];
  for (const [w, h, k, x, y] of cases) {
    const L = computeLayout(w, h);
    assert.equal(L.k, k, `${w}x${h}`);
    assert.equal(L.x, x, `${w}x${h} x`);
    assert.equal(L.y, y, `${w}x${h} y`);
    assert.equal(L.w, VIEW_W * k);
    assert.equal(L.h, VIEW_H * k);
  }
});

test('layout: Windows display scaling is handled in device pixels', () => {
  // A 2560x1440 monitor at 125% reports 2048x1152 CSS px, but the device has 2560x1440.
  assert.equal(computeLayout(2048 * 1.25, 1152 * 1.25).k, 4);
});

test('layout: placement uses the canvas backing size, so Windows 125% and 150% keep the right scale', () => {
  // 2560x1440 at 125%: the window is 2048x1152 CSS px, the canvas backing store 2560x1440.
  const p125 = placeView(2560, 1440, 1.25);
  assert.equal(p125.layout.k, 4);
  assert.equal(p125.scale, 4 / 1.25, 'stage scale is in CSS px');
  assert.deepEqual([p125.x, p125.y], [0, 0]);
  assert.deepEqual(p125.bars, [], 'exact fit: no bars');
  // 4K at 150%.
  const p150 = placeView(3840, 2160, 1.5);
  assert.equal(p150.layout.k, 6);
  assert.deepEqual([p150.x, p150.y], [0, 0]);
  // 1600x900 at 100%: k=2, centered, four bars that exactly cover the rest of the canvas.
  const p = placeView(1600, 900, 1);
  assert.equal(p.layout.k, 2);
  assert.deepEqual([p.x, p.y], [160, 90]);
  const area = p.bars.reduce((a, b) => a + b.w * b.h, 0);
  assert.equal(area, 1600 * 900 - 1280 * 720, 'bars cover exactly the letterbox');
  for (const b of p.bars) assert.ok(b.w > 0 && b.h > 0);
});

test('layout: the world sprite overhangs the view by the margin plus the camera remainder (the bars hide it)', () => {
  const p = placeView(1920, 1080, 1);
  const o = worldSpriteOrigin(p, 0.25, 0.5);
  assert.equal(o.x, -(MARGIN + 0.25) * 3);
  assert.equal(o.y, -(MARGIN + 0.5) * 3);
});

test('layout: fill-screen mode trades pixel-perfect for no bars; tiny windows never go below x1', () => {
  const f = computeLayout(1366, 768, true);
  assert.ok(f.k > 2.1 && f.k < 2.2);
  assert.equal(f.w, 1366);
  assert.equal(computeLayout(500, 300).k, 1);
});

test('layout: camera split gives a whole pixel and a remainder in [0,1)', () => {
  for (const v of [0, 10.25, -3.75, 1e6 + 0.5]) {
    const s = splitCamera(v);
    assert.equal(s.whole + s.frac, v);
    assert.ok(s.frac >= 0 && s.frac < 1);
    assert.equal(Number.isInteger(s.whole), true);
  }
});

test('scenes: enter/exit order, async enters, queued transitions, safe points', async () => {
  const log = [];
  const sm = createSceneManager();
  const mk = (name, safePoint, delay = 0) => ({
    safePoint,
    async enter(p) { log.push(`enter ${name}${p ? ` ${p.x}` : ''}`); if (delay) await new Promise((r) => setTimeout(r, delay)); },
    exit() { log.push(`exit ${name}`); },
    step() { log.push(`step ${name}`); },
  });
  sm.register('title', mk('title', true, 5));
  sm.register('run', mk('run', false));
  assert.equal(sm.isSafePoint(), false, 'no scene yet: nothing has said it is safe');
  sm.go('title');
  assert.equal(sm.isSafePoint(), false, 'mid-transition is never safe');
  sm.go('run', { x: 1 });   // queued behind the slow title enter
  await sm.go('title');
  assert.equal(sm.isSafePoint(), true, 'settled in a safe scene');
  assert.deepEqual(log, ['enter title', 'exit title', 'enter run 1', 'exit run', 'enter title']);
  assert.equal(sm.name, 'title');
  sm.step(1 / 60, 0);
  assert.equal(log.at(-1), 'step title');
  await sm.go('run');
  assert.equal(sm.isSafePoint(), false);
  const toTitle = sm.go('title');
  assert.equal(sm.isSafePoint(), false, 'run -> title in flight: the run result is not saved yet');
  await toTitle;
  assert.equal(sm.isSafePoint(), true);
  assert.throws(() => sm.register('run', {}));
});

test('scenes: errors in a transition are reported, not swallowed', async () => {
  const errs = [];
  const sm = createSceneManager({ onError: (e) => errs.push(e.message) });
  await sm.go('missing');
  assert.deepEqual(errs, ['Unknown scene: missing']);
  sm.register('bad', { enter() { throw new Error('boom'); } });
  await sm.go('bad');
  assert.equal(errs[1], 'boom');
});

function vcHarness({ safe = true, remote = 'b2', session = null, start = 0 } = {}) {
  const calls = { reload: 0, ready: [], fetch: 0, clear: 0 };
  let t = start;
  const timers = [];
  const box = { safe, remote };
  const vc = createVersionCheck({
    currentBuild: 'b1',
    fetchVersion: async () => { calls.fetch++; if (box.remote === 'offline') throw new Error('net'); return { build: box.remote }; },
    isSafePoint: () => box.safe,
    reload: () => { calls.reload++; },
    onUpdateReady: (info) => { calls.ready.push(info); },
    onClear: () => { calls.clear++; },
    now: () => t,
    minIntervalMs: 1000,
    stuckRecheckMs: 60000,
    setTimer: (fn, ms) => { const tm = { fn, at: t + ms }; timers.push(tm); return tm; },
    clearTimer: (tm) => { const i = timers.indexOf(tm); if (i >= 0) timers.splice(i, 1); },
    session,
  });
  const advance = async (ms) => {
    t += ms;
    for (const tm of timers.splice(0)) { if (tm.at <= t) await tm.fn(); else timers.push(tm); }
    await new Promise((r) => setImmediate(r));
  };
  return { vc, calls, box, advance, timers };
}

function memSession() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), m };
}

test('version check: reloads at once at a safe point, and remembers which build it reloaded for', async () => {
  const session = memSession();
  const h = vcHarness({ safe: true, session });
  assert.equal(await h.vc.check({ force: true }), 'reloading');
  assert.equal(h.calls.reload, 1);
  assert.equal(session.get(RELOAD_KEY), 'b2');
  assert.equal(session.get(RELOAD_AT_KEY), '0');
});

test('version check: never reloads mid-run; waits for the next safe point', async () => {
  const h = vcHarness({ safe: false });
  assert.equal(await h.vc.check({ force: true }), 'deferred');
  assert.equal(h.calls.reload, 0);
  assert.equal(h.calls.ready.length, 1);
  assert.equal(h.calls.ready[0].stuck, false);
  assert.equal(h.vc.pending, true);
  h.vc.atSafePoint();
  assert.equal(h.calls.reload, 0, 'still not safe');
  h.box.safe = true;
  h.vc.atSafePoint();
  assert.equal(h.calls.reload, 1);
});

test('version check: a reload that did not take is not repeated forever', async () => {
  const session = memSession();
  session.set(RELOAD_KEY, 'b2'); // we reloaded for b2 moments ago, yet b1 is running
  session.set(RELOAD_AT_KEY, '0');
  const h = vcHarness({ safe: true, session });
  assert.equal(await h.vc.check({ force: true }), 'stuck');
  assert.equal(h.calls.reload, 0);
  assert.equal(h.calls.ready.at(-1).stuck, true);
  assert.equal(await h.vc.check({ force: true }), 'stuck');
  assert.equal(h.calls.reload, 0);
  h.vc.atSafePoint();
  assert.equal(h.calls.reload, 0, 'reaching the hub while stuck does not reload either');
});

test('version check: being stuck heals itself when a newer build appears or ours comes back', async () => {
  const session = memSession();
  session.set(RELOAD_KEY, 'b2');
  session.set(RELOAD_AT_KEY, '0');
  const h = vcHarness({ safe: true, session });
  assert.equal(await h.vc.check({ force: true }), 'stuck');
  const fetches = h.calls.fetch;
  await h.advance(5000);
  assert.equal(await h.vc.check(), 'stuck', 'no polling while stuck');
  assert.equal(h.calls.fetch, fetches);
  assert.equal(h.timers.length, 0, 'and nothing scheduled');
  await h.advance(60000);
  h.box.remote = 'b3';
  assert.equal(await h.vc.check(), 'reloading', 'a later deploy is tried');
  assert.equal(session.get(RELOAD_KEY), 'b3');
  assert.equal(h.vc.stuck, false);

  const s2 = memSession();
  s2.set(RELOAD_KEY, 'b2');
  s2.set(RELOAD_AT_KEY, '0');
  const g = vcHarness({ safe: true, session: s2 });
  assert.equal(await g.vc.check({ force: true }), 'stuck');
  await g.advance(60000);
  g.box.remote = 'b1';
  assert.equal(await g.vc.check(), 'current', 'the deploy was rolled back to our build');
  assert.equal(g.calls.clear, 1, 'the notice is taken down');
  assert.equal(g.vc.stuck, false);
});

test('version check: stuck on a deploy that finished propagating later: one retry per window, at safe points only', async () => {
  const session = memSession();
  session.set(RELOAD_KEY, 'b2');
  session.set(RELOAD_AT_KEY, '0');
  const h = vcHarness({ safe: false, session });
  assert.equal(await h.vc.check({ force: true }), 'stuck');
  await h.advance(60000);
  assert.equal(await h.vc.check(), 'deferred', 'the window passed: b2 is tried again, but not mid-run');
  assert.equal(h.calls.ready.at(-1).stuck, false, 'the notice goes back to "update ready"');
  assert.equal(h.calls.reload, 0);
  h.box.safe = true;
  h.vc.atSafePoint();
  assert.equal(h.calls.reload, 1);
  assert.equal(session.get(RELOAD_AT_KEY), '60000', 'the retry is remembered');
  // The page comes back a second later still old (a new page: fresh state, same session).
  const again = vcHarness({ safe: true, session, start: 61000 });
  assert.equal(await again.vc.check({ force: true }), 'stuck', 'within the window: no second reload');
  assert.equal(again.calls.reload, 0);
  assert.equal(again.calls.ready.at(-1).stuck, true);
});

test('version check: detaching drops a check that was waiting out the throttle window', async () => {
  const h = vcHarness({ remote: 'b1' });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const detach = attachVersionCheck(h.vc, win, doc);
  await h.advance(0);
  assert.equal(h.calls.fetch, 1, 'the load check');
  h.box.remote = 'b2';
  win.dispatchEvent(new Event('focus'));
  assert.equal(h.timers.length, 1, 'a deferred check is waiting');
  detach();
  assert.equal(h.timers.length, 0, 'cancelled');
  await h.advance(5000);
  assert.equal(h.calls.fetch, 1);
  assert.equal(h.calls.reload, 0);
});

test('version check: a check inside the throttle window runs when the window ends', async () => {
  const h = vcHarness({ remote: 'b1' });
  assert.equal(await h.vc.check({ force: true }), 'current');
  h.box.remote = 'b2';
  h.box.safe = false;
  assert.equal(await h.vc.check(), 'throttled');
  assert.equal(await h.vc.check(), 'throttled');
  assert.equal(h.timers.length, 1, 'one deferred check, not one per focus');
  await h.advance(1000);
  assert.equal(h.calls.fetch, 2, 'the deferred check ran');
  assert.equal(h.vc.pending, true, 'and found the update');
});

test('version check: same build, offline, and no reload on either', async () => {
  const h = vcHarness({ remote: 'b1' });
  assert.equal(await h.vc.check({ force: true }), 'current');
  h.box.remote = 'offline';
  assert.equal(await h.vc.check({ force: true }), 'offline');
  assert.equal(h.calls.reload, 0);
});

test('version check: fetch bypasses every cache', async () => {
  const seen = [];
  const fakeFetch = async (url, opts) => { seen.push([url, opts]); return { ok: true, json: async () => ({ build: 'x' }) }; };
  const info = await fetchVersionJson('./version.json', fakeFetch, () => 123);
  assert.deepEqual(info, { build: 'x' });
  assert.equal(seen[0][0], './version.json?t=123');
  assert.equal(seen[0][1].cache, 'no-store');
  assert.equal(await fetchVersionJson('./v.json', async () => ({ ok: false }), () => 1), null);
});

test('version check: focus and becoming visible trigger checks; detach removes them', async () => {
  let checks = 0;
  const vc = { check: () => { checks++; } };
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
  const detach = attachVersionCheck(vc, win, doc);
  assert.equal(checks, 1, 'on load');
  win.dispatchEvent(new Event('focus'));
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(checks, 2, 'hidden does not count');
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(checks, 3);
  detach();
  win.dispatchEvent(new Event('focus'));
  assert.equal(checks, 3);
});

test('version check: a scene can be a safe point only some of the time (the harbor, while idle)', async () => {
  const sm = createSceneManager();
  const box = { idle: false };
  sm.register('hub', { get safePoint() { return box.idle; } });
  await sm.go('hub');
  assert.equal(sm.isSafePoint(), false, 'the results are up');
  box.idle = true;
  assert.equal(sm.isSafePoint(), true);
});

/** A store whose saves fail while `box.broken`, and a notice that remembers its lines. */
function keeperHarness() {
  const box = { broken: false, saved: [], lines: new Map(), log: [], pending: null };
  const store = {
    saveProfile: async (doc) => { if (box.broken) throw new Error('disk full'); box.saved.push(doc); },
    flush: async () => { if (box.pending) await box.pending; },
  };
  const notice = { show: (t, k) => box.lines.set(k, t), clear: (k) => box.lines.delete(k) };
  const keeper = createProgressKeeper({ store, notice, log: (m) => box.log.push(m), profile: { v: 2, n: 0 } });
  return { box, keeper };
}

test('keeper: a failed save keeps the progress in memory and says so until a save works', async () => {
  const { box, keeper } = keeperHarness();
  box.broken = true;
  assert.equal(await keeper.keep({ v: 2, n: 1 }), false);
  assert.deepEqual(keeper.profile, { v: 2, n: 1 }, 'the progress stays in memory');
  assert.equal(keeper.failing, true);
  assert.equal(box.lines.get('save'), SAVE_FAILED_TEXT);
  assert.deepEqual(box.log, ['Could not save progress: disk full']);
  box.broken = false;
  assert.equal(await keeper.keep({ v: 2, n: 2 }), true);
  assert.equal(keeper.failing, false);
  assert.equal(box.lines.has('save'), false, 'the notice goes once a save works');
  assert.deepEqual(box.saved.at(-1), { v: 2, n: 2 });
  // Whoever asks to be told (the desktop shell, before its window closes) hears each change once.
  const told = [];
  const store = { saveProfile: async () => { if (box.broken) throw new Error('disk full'); }, flush: async () => {} };
  const k2 = createProgressKeeper({ store, notice: { show() {}, clear() {} }, log() {}, profile: { v: 2 }, onFailing: (f) => told.push(f) });
  await k2.keep({ v: 2, n: 1 });
  box.broken = true;
  await k2.keep({ v: 2, n: 2 });
  await k2.keep({ v: 2, n: 3 });
  box.broken = false;
  await k2.keep({ v: 2, n: 4 });
  assert.deepEqual(told, [true, false], 'failing, then saved again');
});

test('keeper: nothing leaves the page over progress that isn\'t saved', async () => {
  const { box, keeper } = keeperHarness();
  const went = [];
  // Saved: straight out (after the writes in flight).
  assert.equal(await keeper.leave({ go: () => went.push('reload') }), true);
  // A failed save: saved again first, and out once that works.
  box.broken = true;
  await keeper.keep({ v: 2, n: 5 });
  box.broken = false;
  assert.equal(await keeper.leave({ go: () => went.push('reload') }), true);
  assert.deepEqual(box.saved.at(-1), { v: 2, n: 5 }, 'saved before leaving');
  // Still failing: an update's reload stays (no one to ask); Quit asks, and the answer decides.
  box.broken = true;
  await keeper.keep({ v: 2, n: 6 });
  assert.equal(await keeper.leave({ go: () => went.push('reload') }), false);
  assert.equal(await keeper.leave({ go: () => went.push('quit'), confirm: async () => false }), false, 'Stay');
  assert.equal(await keeper.leave({ go: () => went.push('quit'), confirm: async () => true }), true, 'Quit anyway');
  assert.deepEqual(went, ['reload', 'reload', 'quit']);
  // A save that fails while the writes in flight finish is caught too (checked after the flush).
  const h2 = keeperHarness();
  let fail;
  h2.box.pending = new Promise((r) => { fail = r; });
  h2.box.broken = true;
  const saving = h2.keeper.keep({ v: 2, n: 9 });
  const leaving = h2.keeper.leave({ go: () => went.push('late') });
  fail();
  await saving;
  assert.equal(await leaving, false);
  assert.equal(went.includes('late'), false);
  // A settings write that fails on the way out doesn't hold the player here: the progress decides.
  const h3 = keeperHarness();
  assert.equal(await h3.keeper.leave({ flush: async () => { throw new Error('settings locked'); }, go: () => went.push('anyway') }), true);
  assert.equal(went.at(-1), 'anyway');
});

test('update marker: stays up until the reload, whatever else redraws', () => {
  const made = [];
  const doc = { createElement: () => { const el = { attrs: {}, textContent: '', className: '', setAttribute(k, v) { this.attrs[k] = v; } }; made.push(el); return el; } };
  const root = { children: [], appendChild(el) { this.children.push(el); } };
  const m = createUpdateMarker(root, doc);
  assert.equal(m.text, null);
  m.show(UPDATE_TEXT.ready);
  m.show(UPDATE_TEXT.stuck);
  assert.equal(root.children.length, 1, 'one element, reused');
  assert.equal(m.text, UPDATE_TEXT.stuck);
  assert.equal(made[0].attrs.role, 'status');
  // A storage problem and an update each keep their own line.
  m.show('Progress will be lost when the tab closes.', 'storage');
  assert.equal(m.text, `${UPDATE_TEXT.stuck}\nProgress will be lost when the tab closes.`);
  m.clear('update');
  assert.equal(m.text, 'Progress will be lost when the tab closes.');
  m.clear('storage');
  assert.equal(m.text, null, 'hidden when empty');
  assert.equal(made[0].hidden, true);
});

test('error log: keeps the newest 50, notifies listeners, and keeps notices apart from errors', () => {
  const log = createErrorLog();
  let seen = 0;
  log.onError(() => seen++);
  for (let i = 0; i < 60; i++) log.add('error', `e${i}`);
  assert.equal(log.count, 50);
  assert.equal(log.items[0].message, 'e10');
  assert.equal(log.last.message, 'e59');
  assert.equal(seen, 60);
  log.note('save', 'Save updated from version 1 to 2.');
  assert.equal(log.count, 50, 'a notice is not an error');
  assert.equal(log.lastNotice.message, 'Save updated from version 1 to 2.');
});

test('error log: attach() catches uncaught errors and rejections', () => {
  const log = createErrorLog();
  const win = new EventTarget();
  log.attach(win);
  win.dispatchEvent(Object.assign(new Event('error'), { message: 'boom', error: { stack: 's' } }));
  win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('nope') }));
  assert.deepEqual(log.items.map((e) => [e.kind, e.message]), [['error', 'boom'], ['rejection', 'nope']]);
});

/**
 * The game's flow (app/flow.js) with a real keeper over a store that can fail, a real scene
 * manager with stand-in scenes, and a record of everything that left the page.
 */
async function flowHarness({ native = true } = {}) {
  const box = { broken: false, saves: [], replays: [], flushed: [], asked: [], answer: false, went: [], entered: [] };
  box.order = [];
  const store = {
    saveProfile: async (doc, opts) => { if (box.broken) throw new Error('disk full'); box.saves.push({ doc, rotate: opts?.rotate === true }); box.order.push('profile'); },
    flush: async () => { box.flushed.push('store'); },
  };
  const keeper = createProgressKeeper({ store, notice: { show() {}, clear() {} }, log() {}, profile: defaultProfile() });
  const scenes = createSceneManager();
  for (const name of ['title', 'hub', 'run']) scenes.register(name, { enter: (params) => box.entered.push([name, params ?? null]) });
  const flow = createGameFlow({
    keeper, scenes, data: DATA,
    saveReplay: async (r) => { box.replays.push(r); box.order.push('replay'); },
    flushSettings: async () => { box.flushed.push('settings'); },
    saveSettingsNow: async () => { box.flushed.push('settings now'); },
    askToLeave: async (yes) => { box.asked.push(yes); return box.answer; },
    native: native ? { quit: () => box.went.push('quit') } : null,
    reload: () => box.went.push('reload'),
  });
  return { box, keeper, scenes, flow };
}
const runResult = (over = {}) => ({
  v: 1, seed: 1, map: 'drowned_docks', mode: 'standard', character: 'lamplighter', end: 'died', timeSurvived: 400, ticks: 24000, level: 9,
  kills: { fog_wisp: 12 }, totalKills: 12, elitesKilled: 0, bossesKilled: [], cleared: false, weapons: [], weaponLevelMax: {}, maxWeaponLevel: 0,
  passives: [], relics: [], runes: [], evolutions: [], tags: {}, materials: { coin: 40, oil: 20 }, damageTaken: 0, dashKills: 0, revivalsUsed: 0,
  gems: 0, chests: 0, overtimeMinutes: 0, secretsFound: [], rerolls: 0, skips: 0, banished: [], ...over,
});

test('flow: a run\'s end is folded in and saved at once (rotating the backups), then its replay; Run again adds up the news', async () => {
  const { box, keeper, scenes, flow } = await flowHarness();
  await scenes.go('run');
  await flow.onRunSaved('replay-1', runResult());
  assert.equal(keeper.profile.profile.materials.coin, 40, 'folded into the profile in memory');
  assert.deepEqual(box.saves.map((x) => [x.doc.stats.runs, x.rotate]), [[1, true]], 'saved at once, rotating the backups');
  assert.deepEqual(box.replays, ['replay-1']);
  assert.deepEqual(box.order, ['profile', 'replay'], 'the progress first, then the replay');
  // Run again, then back to the harbor: both runs' news, once.
  await flow.onRunSaved('replay-2', runResult({ materials: { coin: 5 }, kills: { fog_wisp: 3 } }));
  assert.equal(keeper.profile.profile.materials.coin, 45);
  await flow.toHarbor();
  const [name, params] = box.entered.at(-1);
  assert.equal(name, 'hub');
  assert.equal(params.results.runs, 2, 'two runs since the harbor');
  assert.ok(params.results.changes.some((c) => c.kind === 'material' && c.id === 'coin' && c.count === 45), 'their materials added up');
  assert.equal(flow.takeResults(), null, 'the results are shown once');
  await flow.toHarbor();
  assert.equal(box.entered.at(-1)[1].results, null, 'the next visit has none');
});

test('flow: a run\'s config comes from the profile; the title\'s first button goes to the harbor; the window reopens only at the title or in the harbor', async () => {
  const { flow, scenes, box } = await flowHarness();
  const cfg = flow.configFor({ character: 'lamplighter', seed: 's' });
  assert.ok(cfg.pools && !cfg.pools.weapons.includes('lantern_orb'), 'the profile\'s own pools (the Orb is research)');
  assert.throws(() => flow.configFor({ character: 'harpooner', seed: 's' }), /hasn't arrived/);
  assert.deepEqual(flow.configFor({ character: 'harpooner', seed: 's', all: true }), { seed: 's', character: 'harpooner', map: DATA.maps[0].id }, 'the tools may ask for everything');
  await flow.fromTitle();
  assert.equal(box.entered.at(-1)[0], 'hub');
  assert.equal(flow.atTitleOrHarbor(), true, 'in the harbor');
  await scenes.go('run');
  assert.equal(flow.atTitleOrHarbor(), false, 'not in a run');
  const going = scenes.go('title');
  assert.equal(flow.atTitleOrHarbor(), false, 'not while the scene changes');
  await going;
  assert.equal(flow.atTitleOrHarbor(), true, 'at the title');
});

test('flow: every way off the page goes through the keeper: saved first, asked or stayed when a save still fails', async () => {
  const { box, keeper, flow } = await flowHarness();
  // All saved: each way out goes, after writing the settings.
  assert.equal(await flow.quit(), true);
  assert.equal(await flow.reloadAfterError(), true);
  assert.equal(await flow.reloadForUpdate(), true);
  assert.equal(await flow.reopenWindow(() => box.went.push('reopen')), true);
  assert.deepEqual(box.went, ['quit', 'reload', 'reload', 'reopen']);
  assert.deepEqual(box.flushed, ['settings', 'settings', 'settings', 'settings now']);
  // A save that fails and keeps failing: Quit and the error's reload ask; an update and the
  // window stay (no one is asked); nothing goes unless the player says so.
  box.went.length = 0;
  box.broken = true;
  await keeper.keep({ ...keeper.profile, stats: { ...keeper.profile.stats, runs: 7 } });
  assert.equal(await flow.quit(), false);
  assert.equal(await flow.reloadAfterError(), false);
  assert.equal(await flow.reloadForUpdate(), false);
  assert.equal(await flow.reopenWindow(() => box.went.push('reopen')), false);
  assert.deepEqual(box.asked, ['Quit anyway', 'Reload anyway']);
  assert.deepEqual(box.went, [], 'nothing left');
  box.answer = true;
  assert.equal(await flow.quit(), true, 'Quit anyway');
  assert.deepEqual(box.went, ['quit']);
  // Once a save works again, the next try saves the progress kept in memory, then goes.
  box.broken = false;
  assert.equal(await flow.reloadForUpdate(), true);
  assert.equal(box.saves.at(-1).doc.stats.runs, 7, 'the progress kept in memory, saved on the way out');
  // The web build has no Quit.
  assert.equal((await flowHarness({ native: false })).flow.quit, null);
});

test('flow: closing the page another way asks first while a save still fails, but not after a way off that already asked', async () => {
  const { box, keeper, flow } = await flowHarness();
  const closing = () => { const e = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } }; return [flow.beforeLeaving(e), e.defaultPrevented, e.returnValue]; };
  assert.deepEqual(closing(), [false, false, undefined], 'saved: it just closes');
  box.broken = true;
  await keeper.keep(defaultProfile());
  assert.equal(keeper.failing, true);
  assert.deepEqual(closing(), [true, true, ''], 'a save still failing: the page asks to stay');
  // Quit asked already ("Quit anyway"): the window closing after it doesn't ask again.
  box.answer = true;
  assert.equal(await flow.quit(), true);
  assert.deepEqual(box.asked, ['Quit anyway']);
  assert.deepEqual(closing(), [false, false, undefined]);
});

test('main.js wires the scenes, the title, the error screen, settings, and updates through the flow and the keeper (a source check)', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // Each wire as a piece of main.js, its spacing and line breaks aside (rewrapping a line changes
  // nothing here); `…` stands for anything in between that doesn't close a block.
  const flat = src.replace(/\s+/g, '');
  const has = (snippet) => {
    const parts = snippet.split('…').map((p) => p.replace(/\s+/g, ''));
    for (let start = flat.indexOf(parts[0]); start >= 0; start = flat.indexOf(parts[0], start + 1)) {
      let at = start + parts[0].length, ok = true;
      for (const p of parts.slice(1)) {
        const i = flat.indexOf(p, at);
        if (i < 0 || flat.slice(at, i).includes('}')) { ok = false; break; }
        at = i + p.length;
      }
      if (ok) return true;
    }
    return false;
  };
  const wires = [
    ['onHarbor: () => flow.toHarbor()', 'a run\'s end goes to the harbor with the results waiting'],
    ['configFor: (choice) => flow.configFor(choice)', 'a run from the profile\'s own pools'],
    ['onRunSaved: (replay, result) => flow.onRunSaved(replay, result)', 'a run\'s end folded in and saved'],
    ['onError: (e) => { errors.add(\'run end\', … showError(e); }', 'a fold-in that fails goes to the error screen'],
    ['createSceneManager({ onError: (e) => { errors.add(\'scene\', … showError(e); } })', 'a scene that can\'t start too'],
    ['if (where === \'step\') showError(e);', 'and a crash in the sim'],
    ['inRun: scenes.name === \'run\'', 'the error screen says whether a run stopped'],
    ['onReload: () => flow.reloadAfterError()', 'reloading after an error, through the keeper'],
    ['profile: { get: () => keeper.profile, save: (doc) => { keeper.keep(doc); } }', 'the harbor\'s purchases kept through the keeper'],
    ['onStart: () => { ui.close(s); flow.fromTitle(); }', 'the title\'s first button goes to the harbor'],
    ['const quit = flow.quit;', 'Quit through the keeper'],
    ['window.addEventListener(\'beforeunload\', (e) => flow.beforeLeaving(e))', 'closing the page asks while a save fails'],
    ['atTitleOrHarbor: () => flow.atTitleOrHarbor()', 'the window reopens only at the title or in the harbor'],
    ['reopen: (go) => flow.reopenWindow(go)', '...and through the keeper'],
    ['isSafePoint: () => scenes.isSafePoint()', 'an update loads only at a safe point'],
    ['reload: () => flow.reloadForUpdate()', 'an update\'s reload through the keeper'],
    ['onIdle: () => versionCheck?.atSafePoint()', 'the harbor going idle lets a waiting update load'],
    ['scenes.onChange(() => { if (scenes.isSafePoint()) vc.atSafePoint(); })', '...and so does reaching a safe point by a scene change'],
    ['const flushSettings = () => (saveSettingsTimer ? saveSettings(true) : store.flush());', 'leaving waits for the settings, or else the store\'s writes in flight'],
    ['onFailing: (f) => { native?.setUnsaved?.(f)?.catch?.(() => {}); }', 'the desktop shell is told while a save fails'],
  ];
  for (const [snippet, what] of wires) assert.ok(has(snippet), `${what}: ${snippet}`);
  assert.ok(!has('onHarbor: () => flow.toHarbor();'.replace('flow.toHarbor', 'nothing')), 'the check can say no');
  assert.equal(flat.split('onQuit:quit').length - 1, 2, 'the title\'s Quit and the harbor\'s');
  assert.ok(!/store\.saveProfile\(/.test(src), 'no profile save that goes around the keeper');
});
