// The harbor's guide for a new player (meta/guide.js, ui/hubhud.js guideMarker and routeExit,
// hub/map.js routeTo) and walking off the quay to set out (hub/world.js), ARCHITECTURE §10.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { HUB_TUNING } from '../src/data/tuning.js';
import { HUB_TERRAIN } from '../src/data/hub.js';
import { guideStep } from '../src/meta/guide.js';
import { revealedFog } from '../src/meta/index.js';
import { guideMarker, routeExit } from '../src/ui/hubhud.js';
import { createHubWorld, stepHub } from '../src/hub/world.js';
import { routeTo } from '../src/hub/map.js';
import { BTN_DASH } from '../src/lib/inputframe.js';
import { defaultProfile } from '../src/save/schema.js';

test('guide: a new player is pointed at the gate, then at the Lamp Post, then left be', () => {
  const doc = defaultProfile();
  assert.deepEqual(guideStep(doc, DATA).target, { kind: 'gate' });
  doc.stats.runs = 1;
  // Home with too little for the Lamp Post: back out through the gate.
  assert.deepEqual([guideStep(doc, DATA).id, guideStep(doc, DATA).target], ['more', { kind: 'gate' }]);
  // ...saying what's short, from what you have.
  const lampCost = DATA.buildings.find((b) => b.id === 'lamp_post').levels[0].cost;
  Object.assign(doc.profile.materials, { oil: 3, coin: 5 });
  assert.equal(guideStep(doc, DATA).text, `Lamp Post needs ${lampCost.oil - 3} Oil, ${lampCost.coin - 5} Coin. Go back out through the gate`);
  Object.assign(doc.profile.materials, DATA.buildings.find((b) => b.id === 'lamp_post').levels[0].cost);
  assert.deepEqual(guideStep(doc, DATA).target, { kind: 'door', id: 'lamp_post' }, 'enough: to the Lamp Post');
  doc.profile.buildings.lamp_post = 1;
  assert.equal(guideStep(doc, DATA), null);
  // The marker: over the target when it's on screen, at the edge pointing toward it when not.
  const on = guideMarker({ x: 300, y: 200 }, 640, 360);
  assert.deepEqual([on.on, on.x, on.y], [true, 300, 200]);
  const west = guideMarker({ x: -400, y: 180 }, 640, 360);
  assert.equal(west.on, false);
  assert.ok(west.x <= 20 && Math.abs(west.y - 180) < 1 && Math.abs(Math.abs(west.angle) - Math.PI) < 1e-9, 'at the west edge, pointing west');
  const corner = guideMarker({ x: 2000, y: 2000 }, 640, 360);
  assert.ok(corner.x <= 640 - 18 + 1e-9 && corner.y <= 360 - 18 + 1e-9 && corner.x >= 0 && corner.y >= 0, 'inside the screen');
  // An edge arrow slides clear of a corner panel (Next up, bottom left) and points from there.
  const panel = { x: 6, y: 262, w: 132, h: 92 };
  const under = guideMarker({ x: -128, y: 382 }, 640, 360);
  const inPanel = (m) => m.x > panel.x - 7 && m.x < panel.x + panel.w + 7 && m.y > panel.y - 7 && m.y < panel.y + panel.h + 7;
  assert.ok(inPanel(under), 'without the panel it would sit on it');
  const clear = guideMarker({ x: -128, y: 382 }, 640, 360, 18, [panel]);
  assert.ok(!inPanel(clear), `slid clear: ${clear.x}, ${clear.y}`);
    assert.ok(Math.abs(clear.angle - under.angle) < 1e-9, 'slid, it keeps the way it points');
  // On the top edge it slides to the goal line's nearer end, and past a panel that end runs into.
  const goal = { x: 238, y: 8, w: 164, h: 17 }, mats = { x: 6, y: 6, w: 226, h: 20 };
  const nearRight = guideMarker({ x: 416, y: -4 }, 640, 360, 18, [goal]);
  assert.ok(nearRight.x > goal.x + goal.w, `to the right end (${nearRight.x})`);
  const nearLeft = guideMarker({ x: 250, y: -400 }, 640, 360, 18, [mats, goal]);
  assert.ok(nearLeft.x > mats.x + mats.w + 7 || nearLeft.x > goal.x + goal.w, `off both (${nearLeft.x})`);
  for (const b of [goal, mats]) assert.ok(!(nearLeft.x > b.x - 7 && nearLeft.x < b.x + b.w + 7 && nearLeft.y > b.y - 7 && nearLeft.y < b.y + b.h + 7));
  // On screen but under a panel (the gate behind Next up): an arrow just past the panel, pointing at it.
  const hidden = guideMarker({ x: 40, y: 333 }, 640, 360, 18, [panel]);
  assert.equal(hidden.on, false);
  assert.ok(!inPanel(hidden), `moved off the panel (${hidden.x}, ${hidden.y})`);
  assert.ok(Math.abs(hidden.angle - Math.atan2(333 - hidden.y, 40 - hidden.x)) < 1e-9, 'pointing at the gate');
  assert.deepEqual(guideMarker({ x: 300, y: 200 }, 640, 360, 18, [panel]), on, 'clear of every panel: over it, as before');
  const below = guideMarker({ x: 60, y: 900 }, 640, 360, 18, [panel]);
  assert.ok(!inPanel(below) && below.y >= 360 - 18 - 1e-9, 'on the bottom edge it slides along the bottom');
});

test('harbor: walking off the quay\'s west end by the gate sets out, once a push', () => {
  const hub = DATA.hub;
  const w = createHubWorld({ hub, terrain: HUB_TERRAIN, tuning: DATA.tuning, revealed: hub.fog.map((f) => f.id) });
  const g = hub.gate.at;
  w.player.x = 6 * 16; w.player.y = g[1] * 16 + 8;
  const west = { mx: -127, my: 0, buttons: 0 };
  let fired = 0, ticks = 0;
  for (; ticks < 240 && !fired; ticks++) { stepHub(w, west, 1 / 60); fired += w.events.filter((e) => e.kind === 'walk_off').length; }
  assert.equal(fired, 1, 'walking west off the end sets out');
  for (let k = 0; k < 120; k++) { stepHub(w, west, 1 / 60); fired += w.events.filter((e) => e.kind === 'walk_off').length; }
  assert.equal(fired, 1, 'holding west doesn\'t set out again');
  stepHub(w, { mx: 0, my: 0, buttons: 0 }, 1 / 60);
  const push = Math.round(HUB_TUNING.timing.walkOff * 60);
  for (let k = 0; k < push - 1; k++) { stepHub(w, west, 1 / 60); fired += w.events.filter((e) => e.kind === 'walk_off').length; }
  assert.equal(fired, 1, 'not before timing.walkOff');
  stepHub(w, west, 1 / 60); fired += w.events.filter((e) => e.kind === 'walk_off').length;
  assert.equal(fired, 2, 'let go and push again: again, after timing.walkOff');
  // A null frame (a screen is open) neither moves you nor arms it again.
  stepHub(w, null, 1 / 60);
  for (let k = 0; k < 60; k++) { stepHub(w, west, 1 / 60); fired += w.events.filter((e) => e.kind === 'walk_off').length; }
  assert.equal(fired, 2, 'no frame is not letting go');
  // Elsewhere along the west edge it's only the edge of the map: the same open edge, with the gate
  // moved six rows up (the real map's west edge is open only at the gate).
  const moved = { ...hub, gate: { ...hub.gate, at: [g[0], g[1] - 6] } };
  const w2 = createHubWorld({ hub: moved, terrain: HUB_TERRAIN, tuning: DATA.tuning, revealed: hub.fog.map((f) => f.id) });
  w2.player.x = 6 * 16; w2.player.y = g[1] * 16 + 8;
  let other = 0;
  for (let k = 0; k < 240; k++) { stepHub(w2, west, 1 / 60); other += w2.events.filter((e) => e.kind === 'walk_off').length; }
  assert.ok(w2.player.x <= w2.radius + 1, 'it reached the edge');
  assert.equal(other, 0);
});

test('harbor: the walk-off fires on the row below the gate too, and only against the map\'s edge', () => {
  const hub = DATA.hub;
  const g = hub.gate.at;
  const west = { mx: -127, my: 0, buttons: 0 };
  const fresh = () => createHubWorld({ hub, terrain: HUB_TERRAIN, tuning: DATA.tuning, revealed: hub.fog.map((f) => f.id) });
  // The row below.
  const w = fresh();
  w.player.x = 6 * 16; w.player.y = (g[1] + 1) * 16 + 8;
  let fired = 0;
  for (let k = 0; k < 240 && !fired; k++) { stepHub(w, west, 1 / 60); fired += w.events.filter((e) => e.kind === 'walk_off').length; }
  assert.equal(fired, 1, 'on the row below the gate');
  // Walking west three tiles out: nothing until you're at the edge, then the push's time.
  const v = fresh();
  v.player.x = 3 * 16 + 8; v.player.y = g[1] * 16 + 8;
  let ticks = 0;
  for (; ticks < 240; ticks++) { stepHub(v, west, 1 / 60); if (v.events.some((e) => e.kind === 'walk_off')) break; }
  const walk = Math.ceil((3 * 16 + 8 - (v.radius + 1)) / v.speed * 60);
  assert.ok(ticks >= walk + Math.round(HUB_TUNING.timing.walkOff * 60) - 2, `not before the edge (${ticks} ticks, the walk ${walk})`);
  // A dash into the edge doesn't count while it lasts.
  const d = fresh();
  d.player.x = d.radius + 1; d.player.y = g[1] * 16 + 8; d.player.fx = -1; d.player.fy = 0;
  stepHub(d, { mx: -127, my: 0, buttons: 0 }, 1 / 60);
  d.walkOff = 0;
  stepHub(d, { mx: -127, my: 0, buttons: BTN_DASH }, 1 / 60);
  assert.ok(d.player.dashTicks > 0);
  assert.equal(d.walkOff, 0, 'a dash doesn\'t count toward it');
});

test('harbor: the quay\'s west end is open at the gate from a fresh profile, so walking off it works from the first visit', () => {
  const hub = DATA.hub;
  const w = createHubWorld({ hub, terrain: HUB_TERRAIN, tuning: DATA.tuning, revealed: revealedFog(defaultProfile(), DATA) });
  const g = hub.gate.at, c = w.map.cols;
  assert.ok([g[1], g[1] + 1].some((y) => !w.solid[y * c]), 'x 0 is open on the gate\'s row or the one below');
  // And from the tile beside the gate it fires (the content test walks to the gate from the start).
  w.player.x = (g[0] + 1) * 16 + 8; w.player.y = g[1] * 16 + 8;
  let fired = 0;
  for (let k = 0; k < 240 && !fired; k++) { stepHub(w, { mx: -127, my: 0, buttons: 0 }, 1 / 60); fired += w.events.filter((e) => e.kind === 'walk_off').length; }
  assert.equal(fired, 1);
});

test('guide: off screen, the arrow follows the walk there (around the fog), where it leaves the screen', () => {
  const hub = DATA.hub;
  const w = createHubWorld({ hub, terrain: HUB_TERRAIN, tuning: DATA.tuning, revealed: revealedFog(defaultProfile(), DATA) });
  const from = hub.spawn, to = hub.gate.at;
  const path = routeTo(w.map, w.solid, from, to);
  assert.ok(path && path.length > 2);
  assert.deepEqual(path[0], from);
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1], path[k]];
    assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, 'one step at a time');
    assert.equal(w.solid[b[1] * w.map.cols + b[0]], 0, `open at ${b}`);
  }
  const last = path.at(-1);
  assert.ok(Math.abs(last[0] - to[0]) + Math.abs(last[1] - to[1]) <= 1, 'it ends at the gate');
  // Fog between: no way.
  const shut = new Uint8Array(w.solid); for (let y = 0; y < w.map.rows; y++) shut[y * w.map.cols + 10] = 1;
  assert.equal(routeTo(w.map, shut, from, to), null);
  // routeExit, on a made-up walk east from the middle of the screen, a tile 16 px: tile 19 is the
  // first past the right margin (320 + 19 x 16 = 624 > 640 - 18).
  const east = Array.from({ length: 30 }, (_, k) => [k, 0]);
  const toView = (t) => ({ x: 320 + t[0] * 16, y: 180 + t[1] * 16 });
  assert.deepEqual(routeExit(east, toView, 640, 360), { x: 624, y: 180 });
  // ...and north: the goal line's room counts (y 34 is the last on screen).
  const north = Array.from({ length: 20 }, (_, k) => [0, -k]);
  assert.deepEqual(routeExit(north, toView, 640, 360), { x: 320, y: 180 - 10 * 16 });
  assert.equal(routeExit(east.slice(0, 2), toView, 640, 360), null, 'all on screen: none');
  assert.equal(routeExit(null, toView, 640, 360), null);
});
