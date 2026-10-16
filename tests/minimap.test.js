// The run's minimap (render/minimapmodel.js, render/minimap.js, render/hud.js; ARCHITECTURE §6.2
// item 13): where it sits, its marks, its window, what it uncovers, fading while you're under it,
// its settings, and the real Pixi minimap and HUD run in Node on the harbor rig's stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from 'pixi.js';
import { DATA } from '../src/data/index.js';
import { EF, PK } from '../src/sim/constants.js';
import { spawnPickup } from '../src/sim/pickups.js';
import { defaultSettings, normalizeSettings } from '../src/save/schema.js';
import { minimapBox, minimapWindow, minimapMarks, minimapFade, createMarks, revealView, revealDisc, MARK, MARK_SHAPES, MINIMAP } from '../src/render/minimapmodel.js';
import { createWorld } from '../src/sim/world.js';
import { TASK, TASK_STATE } from '../src/sim/constants.js';
import { createMinimap } from '../src/render/minimap.js';
import { createHud } from '../src/render/hud.js';
import { HUD_LAYOUT } from '../src/render/hudmodel.js';
import { VIEW_W, VIEW_H } from '../src/render/layout.js';
import { installFakeDocument, textsOf } from './helpers/fakedom.js';
import { nodeAtlas, installCanvas } from './helpers/hubrig.js';
import { createUi } from '../src/ui/screens.js';
import { createInput } from '../src/input/input.js';
import { openSettings } from '../src/app/settings-flow.js';
import { makeWorld, spawnAt } from './helpers/simworld.js';

test('minimap: top right; marks for drops, elites, bosses, and you, never gems or plain enemies', () => {
  assert.equal(minimapBox('off', 'small'), null);
  const box = minimapBox('nearby', 'small');
  assert.deepEqual(box, { x: VIEW_W - HUD_LAYOUT.edge - MINIMAP.size.small, y: MINIMAP.top, w: MINIMAP.size.small, h: MINIMAP.size.small, size: 'small' });
  assert.equal(minimapBox('nearby', 'large').size, 'large');
  assert.equal(minimapBox('map', 'large').w, MINIMAP.size.large);
  assert.equal(minimapBox('nearby', 'small'), box, 'the same box each frame (no garbage)');
  assert.ok(box.x > VIEW_W / 2 + HUD_LAYOUT.bossBar.w / 2, 'clear of the boss bar');
  const w = makeWorld({ invulnerable: true });
  spawnAt(w, 'drowned_sailor', 40, 0);                         // a plain enemy: not shown
  spawnAt(w, 'drowned_bosun', -40, 0, { elite: true });        // an elite: shown
  spawnPickup(w, PK.CHEST, w.player.x + 30, w.player.y, 1, 0);
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y + 30, 0, 0);
  spawnPickup(w, PK.HEAL, w.player.x - 30, w.player.y - 30, 30, 0);
  w.gems.alloc(); w.gems.x[0] = w.player.x + 5; w.gems.y[0] = w.player.y;   // a gem: not shown
  const marks = createMarks(), win = {};
  minimapWindow(w, box, 'nearby', win);
  const n = minimapMarks(w, marks, box, win);
  const kinds = [...marks.kind.slice(0, n)].sort();
  assert.deepEqual(kinds, [MARK.HEAL, MARK.EMBER, MARK.CHEST, MARK.ELITE, MARK.PLAYER].sort());
  const k = [...marks.kind.slice(0, n)].indexOf(MARK.PLAYER);
  assert.ok(Math.abs(marks.x[k] - (box.x + box.w / 2)) <= 1 && Math.abs(marks.y[k] - (box.y + box.h / 2)) <= 1, 'you in the middle (nearby)');
  for (let i = 0; i < n; i++) assert.ok(marks.x[i] >= box.x && marks.x[i] < box.x + box.w && marks.y[i] >= box.y && marks.y[i] < box.y + box.h);
  // A material, a magnet, and a boss show too; a dead elite and a drop outside the window don't.
  const T = w.terrain;
  spawnPickup(w, PK.MATERIAL, w.player.x - 20, w.player.y + 10, 2, 1);
  spawnPickup(w, PK.MAGNET, w.player.x + 20, w.player.y - 10, 0, 0);
  const boss = spawnAt(w, 'drowned_bosun', 0, -50);
  w.enemies.flags[boss] |= EF.BOSS;
  const dead = spawnAt(w, 'drowned_bosun', 0, 50, { elite: true });
  w.enemies.flags[dead] |= EF.DEAD;
  spawnPickup(w, PK.CHEST, w.player.x + box.w / win.s, w.player.y, 1, 0);   // a window's width away
  const n2 = minimapMarks(w, marks, box, win);
  const kinds2 = [...marks.kind.slice(0, n2)];
  assert.deepEqual([...kinds2].sort(), [MARK.MATERIAL, MARK.HEAL, MARK.MAGNET, MARK.EMBER, MARK.CHEST, MARK.ELITE, MARK.BOSS, MARK.PLAYER].sort(),
    'one chest (the far one is outside), one elite (the dead one is gone), the boss, the material, the magnet');
  assert.equal(marks.a[kinds2.indexOf(MARK.MATERIAL)], 2, 'a material carries which it is');
  // Nearby is whole pixels a tile, and its corner sits on a whole pixel, wherever you stand.
  for (const size of ['small', 'large']) {
    const b = minimapBox('nearby', size);
    for (const dx of [0, 3.3, 7.9, 100.25]) {
      w.player.x += dx;
      minimapWindow(w, b, 'nearby', win);
      assert.equal(win.s * T.tile, MINIMAP.nearbyPxPerTile[size]);
      assert.ok(Math.abs(win.ox * win.s - Math.round(win.ox * win.s)) < 1e-9 && Math.abs(win.oy * win.s - Math.round(win.oy * win.s)) < 1e-9);
    }
  }
  // At the map's corner the window stays inside the map, and you're off its middle.
  const px0 = w.player.x, py0 = w.player.y;
  w.player.x = 4; w.player.y = 4;
  minimapWindow(w, box, 'nearby', win);
  assert.deepEqual([win.ox, win.oy], [0, 0]);
  minimapMarks(w, marks, box, win);
  const me = [...marks.kind.slice(0, marks.n)].indexOf(MARK.PLAYER);
  assert.ok(marks.x[me] < box.x + 4 && marks.y[me] < box.y + 4, 'you near its top left');
  w.player.x = T.width - 4; w.player.y = T.height - 4;
  minimapWindow(w, box, 'nearby', win);
  assert.ok(Math.abs(win.ox + box.w / win.s - T.width) <= 1 / win.s + 1e-9 || T.width < box.w / win.s, 'the window ends at the map\'s edge');
  w.player.x = px0; w.player.y = py0;
  // The whole map: the map fits the box.
  minimapWindow(w, box, 'map', win);
  assert.ok(Math.abs(win.s - Math.min(box.w / T.width, box.h / T.height)) < 1e-9);
  // The setting is kept, and a bad one falls back.
  assert.deepEqual(defaultSettings().hud, { minimap: 'nearby', minimapSize: 'small' });
  assert.deepEqual(normalizeSettings({ hud: { minimap: 'map', minimapSize: 'large' } }).hud, { minimap: 'map', minimapSize: 'large' });
  assert.deepEqual(normalizeSettings({ hud: { minimap: 'huge', minimapSize: 3 } }).hud, { minimap: 'nearby', minimapSize: 'small' });
});

test('minimap: what\'s on screen is uncovered, from the camera (kept inside the map), the whole view and only it', () => {
  const cols = 100, rows = 60, tile = 16, W = 640, H = 360;
  const seen = new Uint8Array(cols * rows);
  const fresh = [];
  // In the middle of the map: the tiles under the view, exactly.
  let n = revealView(seen, cols, rows, tile, 800, 480, W, H, (i) => fresh.push(i));
  assert.equal(n, 40 * 24, 'x 480 to 1119 is tiles 30 to 69; y 300 to 659 is tiles 18 to 41');
  assert.equal(fresh.length, n);
  const at = (x, y) => seen[y * cols + x];
  assert.equal(at(800 / 16 - 20, 30), 1); assert.equal(at(800 / 16 + 19, 30), 1);
  assert.equal(at(800 / 16 - 21, 30), 0, 'not a tile past the view\'s left'); assert.equal(at(800 / 16 + 20, 30), 0);
  // Seen once: never again.
  assert.equal(revealView(seen, cols, rows, tile, 800, 480, W, H, () => assert.fail('seen twice')), 0);
  // At the west edge the camera is held at half a view in: the whole screen's width is uncovered,
  // from the map's edge (with the player at x 50 the view still shows tiles 0 to 39).
  const edge = new Uint8Array(cols * rows);
  revealView(edge, cols, rows, tile, W / 2, H / 2, W, H, () => {});
  for (let x = 0; x < 40; x++) assert.equal(edge[x], 1, `tile ${x} uncovered`);
  assert.equal(edge[40], 0);
  // Past the map: nothing out of range is touched.
  const corner = new Uint8Array(4 * 4);
  assert.equal(revealView(corner, 4, 4, tile, -1000, -1000, W, H, () => {}), 0);
  assert.equal(revealView(corner, 4, 4, tile, 32, 32, W, H, () => {}), 16);
});

test('minimap: Settings has its two rows, and a change there reaches the HUD\'s setting at once', () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = createUi({ root, input: createInput({ getGamepads: () => [], target: new EventTarget(), now: () => 0 }), doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const settings = defaultSettings();
  const live = settings.hud;   // what main.js hands the HUD
  const s = openSettings({
    ui, menuCtx: { ui, icon: () => document.createElement('span'), sound: () => {} }, settings, desktop: false, native: null,
    atTitleOrHarbor: () => true, reopen: async () => true, input: { setDeadzone() {} }, audio: { setVolumes() {} }, renderer: { setFillScreen() {} }, save: async () => {},
  });
  const texts = textsOf(s.el);
  for (const t of ['Minimap', 'Nearby', 'Minimap size', 'Small']) assert.ok(texts.includes(t), `says "${t}"`);
  assert.ok(s.scope.focusKey('hud.minimap'));
  s.onNav('right');
  assert.equal(live.minimap, 'map', 'the HUD reads the same object');
  assert.equal(minimapBox(live.minimap, live.minimapSize).w, MINIMAP.size.small);
  s.onNav('right');
  assert.equal(live.minimap, 'off');
  assert.equal(minimapBox(live.minimap, live.minimapSize), null);
  assert.ok(s.scope.focusKey('hud.minimapSize'));
  s.onNav('right');
  assert.equal(live.minimapSize, 'large');
});


test('minimap: it fades while you stand under it (a cornered player is never hidden), and is solid otherwise', () => {
  for (const size of ['small', 'large']) {
    const box = minimapBox('nearby', size);
    assert.equal(minimapFade(box, { x: box.x + box.w / 2, y: box.y + box.h / 2 }), MINIMAP.fadeAlpha, 'feet inside');
    assert.equal(minimapFade(box, { x: box.x - 6, y: box.y + box.h + 12 }), MINIMAP.fadeAlpha, 'just below its corner: your head is under it');
    assert.equal(minimapFade(box, { x: box.x + 10, y: box.y - 6 }), MINIMAP.fadeAlpha, 'just above it: your legs are under its frame');
    assert.equal(minimapFade(box, { x: VIEW_W / 2, y: VIEW_H / 2 }), 1, 'in the middle of the screen');
    assert.equal(minimapFade(box, { x: box.x + 10, y: box.y + box.h + 30 }), 1, 'well below it');
  }
  assert.equal(minimapFade(null, { x: 600, y: 40 }), 1);
  // The figure's edges, a pixel either side: 14 px over your feet, 8 below, 11 to each side, against
  // the 2 px frame.
  const b = minimapBox('nearby', 'small');
  const mid = b.x + b.w / 2;
  assert.equal(minimapFade(b, { x: mid, y: b.y + b.h + 2 + 14 - 1 }), MINIMAP.fadeAlpha, 'head a pixel into the frame');
  assert.equal(minimapFade(b, { x: mid, y: b.y + b.h + 2 + 14 }), 1, 'head just clear');
  assert.equal(minimapFade(b, { x: mid, y: b.y - 2 - 8 + 1 }), MINIMAP.fadeAlpha, 'feet a pixel into the frame');
  assert.equal(minimapFade(b, { x: mid, y: b.y - 2 - 8 }), 1, 'feet just clear');
  assert.equal(minimapFade(b, { x: b.x - 2 - 11 + 1, y: b.y + 10 }), MINIMAP.fadeAlpha, 'a side a pixel in');
  assert.equal(minimapFade(b, { x: b.x - 2 - 11, y: b.y + 10 }), 1, 'a side just clear');
});

test('minimap: every kind of mark is its own shape (none told apart by color alone)', () => {
  const pattern = (kind) => {
    const px = new Set();
    for (const [dx, dy, w, h, ink] of MARK_SHAPES[kind]) for (let y = dy; y < dy + h; y++) for (let x = dx; x < dx + w; x++) px.add(`${x},${y},${ink}`);
    return [...px].sort().join(' ');
  };
  const kinds = Object.values(MARK);
  const seen = new Map();
  for (const k of kinds) {
    assert.ok(MARK_SHAPES[k]?.length, `kind ${k} has a shape`);
    const p = pattern(k);
    assert.ok(!seen.has(p), `kind ${k} looks like kind ${seen.get(p)}`);
    seen.set(p, k);
  }
  // The ones easy to mix up, by what sets them apart.
  assert.notEqual(pattern(MARK.ELITE), pattern(MARK.BOSS));
  assert.ok(pattern(MARK.PLAYER).split(' ').length > pattern(MARK.HEAL).split(' ').length, 'you are bigger than food');
});

test('minimap: marks stay in the box and you\'re always marked, even with the store full', () => {
  const w = makeWorld({ invulnerable: true });
  const box = minimapBox('nearby', 'small'), win = {};
  for (let k = 0; k < 40; k++) spawnPickup(w, PK.MATERIAL, w.player.x + (k % 8) * 10 - 40, w.player.y + Math.floor(k / 8) * 10 - 20, 0, 1);
  spawnPickup(w, PK.EMBER, w.player.x - 40, w.player.y - 20, 0, 0);
  const marks = createMarks(8);
  minimapWindow(w, box, 'nearby', win);
  const n = minimapMarks(w, marks, box, win);
  assert.equal(n, 8);
  assert.equal(marks.kind[n - 1], MARK.PLAYER, 'you, last (on top), in the slot kept for you');
  const all = createMarks();
  const m = minimapMarks(w, all, box, win);
  const kinds = [...all.kind.slice(0, m)];
  assert.ok(kinds.lastIndexOf(MARK.MATERIAL) < kinds.indexOf(MARK.EMBER), 'materials drawn before the Ember, so they never cover it');
});

test('minimap: the real one (Pixi, in Node) keeps uncovering while Off, sends new ground at most every 150 ms, and the HUD shows it by its setting (and no materials)', () => {
  installFakeDocument();
  installCanvas();
  const w = makeWorld({ invulnerable: true });
  const T = w.terrain;
  const mm = createMinimap();
  mm.attach(w);
  const cam = { x: VIEW_W / 2, y: VIEW_H / 2 };
  // Off: nothing drawn, but what the camera shows is uncovered.
  mm.draw(null, 'off', cam, 0);
  assert.equal(mm.root.visible, false);
  assert.ok(mm.seenAt(0) && mm.seenAt(Math.floor((VIEW_W - 1) / T.tile)), 'the top-left screen is uncovered');
  assert.equal(mm.seenAt(Math.floor(VIEW_W / T.tile) + 1), false);
  // On: the first frame sends the ground; a frame moved 100 ms later doesn't; one 160 ms later does.
  const box = minimapBox('nearby', 'small');
  mm.draw(box, 'nearby', cam, 1000);
  const puts0 = mm.canvas.puts;
  assert.ok(puts0 >= 1);
  assert.equal(mm.canvas.image.data[3], 255, 'tile 0 is painted');
  cam.x += T.tile * 4;
  mm.draw(box, 'nearby', cam, 1100);
  assert.equal(mm.canvas.puts, puts0, 'not yet');
  mm.draw(box, 'nearby', cam, 1160);
  assert.equal(mm.canvas.puts, puts0 + 1, 'sent');
  // Faded while you're under it: walk into the top-right corner of a camera held at the map's edge.
  w.player.x = cam.x + VIEW_W / 2 - 30; w.player.y = cam.y - VIEW_H / 2 + 50;
  mm.draw(box, 'nearby', cam, 1200);
  assert.equal(mm.root.alpha, MINIMAP.fadeAlpha);
  w.player.x = cam.x; w.player.y = cam.y;
  mm.draw(box, 'nearby', cam, 1210);
  assert.equal(mm.root.alpha, 1);
  // What it draws: the ground and the marks clipped to the box; marks for drops; the whole map smoothed.
  const [, clip, mask] = mm.root.children;
  assert.equal(clip.mask, mask, 'ground and marks clipped to the box');
  const [ground, marksG] = clip.children;
  spawnPickup(w, PK.EMBER, w.player.x + 20, w.player.y, 0, 0);
  spawnAt(w, 'drowned_bosun', -20, 0, { elite: true });
  mm.draw(box, 'nearby', cam, 1300);
  const b = marksG.getLocalBounds();
  assert.ok(b.width > 4 && b.height > 4, 'marks drawn');
  assert.ok(b.x >= box.x - 3 && b.x + b.width <= box.x + box.w + 3, 'around the marks\' middles, inside the box (the clip cuts the rest)');
  assert.equal(ground.texture.source.scaleMode, 'nearest', 'Nearby: whole pixels');
  mm.draw(box, 'map', cam, 1400);
  assert.equal(ground.texture.source.scaleMode, 'linear', 'Whole map: smoothed');
  mm.destroy();
  // The HUD: materials found aren't drawn on it (they're on the pause menu and Stats), and the
  // minimap follows its setting live.
  const settings = { minimap: 'nearby', minimapSize: 'large' };
  const renderer = { hud: new Container(), camera: { x: VIEW_W / 2, y: VIEW_H / 2 } };
  const atlas = nodeAtlas();
  const matTex = new Set(DATA.materials.map((m) => atlas.tex(m.icon)));
  const hud = createHud({ renderer, atlas, hudSettings: settings });
  hud.attach();
  for (let k = 0; k < 3; k++) w.result.materialsRaw[k] = 5 + k;
  hud.draw(w, 0, { hurt: 0, level: 0 });
  const all = (c) => [c, ...(c.children ?? []).flatMap(all)];
  assert.equal(all(renderer.hud).filter((c) => matTex.has(c.texture) && c.visible).length, 0, 'no material icons on the HUD');
  const mapRoot = all(renderer.hud).find((c) => c.children?.length === 3 && c.children[1].mask === c.children[2]);
  assert.ok(mapRoot?.visible, 'the minimap is up');
  settings.minimap = 'off';
  hud.draw(w, 16, { hurt: 0, level: 0 });
  assert.equal(mapRoot.visible, false, 'and gone when the setting says Off');
});

test('minimap: Phase 7\'s places: a task once found (from 0:00 with the Cartographer), a lit lamp, never a rung bell; the skiff, a Reliquary, the secrets at its last level; a lit lamp uncovers its ground', () => {
  const box = minimapBox('map', 'large'), marks = createMarks(), win = {};
  const kindsOf = (w) => { minimapWindow(w, box, 'map', win); const n = minimapMarks(w, marks, box, win); return [...marks.kind.slice(0, n)]; };
  const count = (list, k) => list.filter((x) => x === k).length;
  const plain = createWorld({ seed: 1, character: 'lamplighter' }, DATA);
  assert.deepEqual(kindsOf(plain), [MARK.PLAYER], 'nothing found yet, no skiff, no secrets');
  const lamps = plain.tasks.filter((t) => t.kind === TASK.LAMP), bells = plain.tasks.filter((t) => t.kind === TASK.BELL);
  lamps[0].state = TASK_STATE.ACTIVE; lamps[1].state = TASK_STATE.DONE; bells[0].state = TASK_STATE.ACTIVE; bells[1].state = TASK_STATE.DONE;
  const found = kindsOf(plain);
  assert.deepEqual([count(found, MARK.LAMP), count(found, MARK.LAMP_LIT), count(found, MARK.BELL)], [1, 1, 1], 'found ones; a rung bell is done with');
  spawnPickup(plain, PK.RELIQUARY, plain.player.x + 40, plain.player.y, 0, 0);
  assert.equal(count(kindsOf(plain), MARK.RELIQUARY), 1);
  const charted = createWorld({ seed: 1, character: 'lamplighter', harbor: { ferry: 1, tasksOnMap: 1, secretsOnMap: 1 } }, DATA);
  const all = kindsOf(charted);
  assert.equal(count(all, MARK.LAMP), lamps.length, 'every lamp from 0:00');
  assert.equal(count(all, MARK.BELL), bells.length);
  assert.equal(count(all, MARK.FERRY), 1, 'the skiff');
  assert.equal(count(all, MARK.SECRET), DATA.maps[0].secrets.length, 'the secrets');
  charted.secrets[0].open = true;
  assert.equal(count(kindsOf(charted), MARK.SECRET), DATA.maps[0].secrets.length - 1, 'a found one goes');
  // A lit lamp's reach: a disc of tiles, once.
  const cols = 64, rows = 64, seen = new Uint8Array(cols * rows), got = [];
  const r = DATA.tuning.tasks.lamp.reveal;
  const n = revealDisc(seen, cols, rows, 30, 30, r, (i) => got.push(i));
  let want = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if ((x - 30) ** 2 + (y - 30) ** 2 <= r * r) want++;
  assert.equal(n, want);
  assert.equal(got.length, want);
  assert.equal(revealDisc(seen, cols, rows, 30, 30, r, () => {}), 0, 'once');
  assert.equal(revealDisc(new Uint8Array(cols * rows), cols, rows, 0, 0, r, () => {}), [...Array(r + 1).keys()].reduce((s2, y) => s2 + Math.floor(Math.sqrt(r * r - y * y)) + 1, 0), 'held to the map at a corner');
});

test('minimap: the real one uncovers a lit Wayside Lamp\'s ground once, wherever the camera is', () => {
  installFakeDocument();
  installCanvas();
  const probe = makeWorld();
  const T0 = probe.terrain, at = [Math.floor(probe.player.x / T0.tile) + 30, Math.floor(probe.player.y / T0.tile) + 30];
  const w = makeWorld({ invulnerable: true }, { mapExtra: { tasks: [{ kind: 'lamp', at }] } });
  const T = w.terrain, mm = createMinimap();
  mm.attach(w);
  const cam = { x: VIEW_W / 2, y: VIEW_H / 2 };
  const lampTile = Math.floor(w.tasks[0].y / T.tile) * T.cols + Math.floor(w.tasks[0].x / T.tile);
  mm.draw(null, 'off', cam, 0);
  assert.equal(mm.seenAt(lampTile), false, 'unlit and far off: not seen');
  w.tasks[0].state = TASK_STATE.DONE;
  mm.draw(null, 'off', cam, 16);
  const r = DATA.tuning.tasks.lamp.reveal;
  assert.ok(mm.seenAt(lampTile) && mm.seenAt(lampTile + r - 1) && mm.seenAt(lampTile - (r - 1) * T.cols), 'its reach uncovered');
  assert.equal(mm.seenAt(lampTile + r + 2), false, 'and no further');
});
