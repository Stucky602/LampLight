// The harbor you walk around in between runs (src/hub/world.js, ARCHITECTURE §10.4): walking and
// the dash with the run's feel, walls and the fog, what's in reach, the keepers and the waiting
// characters, and the two set pieces (a building's ceremony and an arrival by boat), including
// skipping them and one waiting for another. Headless, stepped at the sim's 60 ticks a second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { HUB_TERRAIN } from '../src/data/hub.js';
import { buildHubMap, segmentOpen, reachableFrom, nearestOpen, solidTiles } from '../src/hub/map.js';
import { defaultProfile } from '../src/save/schema.js';
import { revealedFog, hubPeople, npcLine, shownProps } from '../src/meta/index.js';
import { makeFrame, BTN_DASH, EMPTY_FRAME } from '../src/lib/inputframe.js';
import {
  createHubWorld, stepHub, setRevealed, setPeople, setProps, startCeremony, startArrival, skipTimeline, doorAt, HUB_TIMING, CEREMONY_TIME, ceremonyTime,
} from '../src/hub/world.js';
import { createHubTuning, checkHubTune, setHubTune, resetHubTuning, hubTuneRange } from '../src/hub/tuning.js';
import { flattenTuning } from '../src/ui/tuningmodel.js';

const DT = 1 / 60;
const HUB = DATA.hub;
const px = (t) => t * 16 + 8;
function profile(levels = {}) { const d = defaultProfile(); Object.assign(d.profile.buildings, levels); return d; }
function harbor(levels = {}, opts = {}) {
  const doc = profile(levels);
  const w = createHubWorld({ hub: HUB, terrain: HUB_TERRAIN, tuning: DATA.tuning, revealed: revealedFog(doc, DATA), props: shownProps(doc, DATA), ...opts });
  setPeople(w, hubPeople(doc, DATA));
  return w;
}
function hold(w, frame, secs) { for (let i = 0, n = Math.round(secs / DT); i < n; i++) stepHub(w, frame, DT); }
function place(w, [tx, ty]) { w.player.x = w.player.px = px(tx); w.player.y = w.player.py = px(ty); }
const RIGHT = makeFrame(1, 0), LEFT = makeFrame(-1, 0), UP = makeFrame(0, -1);

test('hub: you walk at the run\'s speed, at your character\'s move speed', () => {
  const w = harbor();
  const x0 = w.player.x;
  hold(w, RIGHT, 1);
  assert.ok(Math.abs(w.player.x - x0 - DATA.tuning.player.speed) < 0.5, `moved ${w.player.x - x0}`);
  assert.equal(w.player.facing, 1);
  assert.equal(w.player.moving, true);
  assert.deepEqual([w.cam.x, w.cam.y], [w.player.x, w.player.y], 'the camera is on you');
  const slow = harbor({}, { moveSpeed: 0.95 });
  const s0 = slow.player.x;
  hold(slow, RIGHT, 1);
  assert.ok(Math.abs(slow.player.x - s0 - DATA.tuning.player.speed * 0.95) < 0.5);
  hold(w, LEFT, 0.1);
  assert.equal(w.player.facing, -1);
  hold(w, EMPTY_FRAME, 0.1);
  assert.equal(w.player.moving, false);
  // Junk input reads as none.
  const x1 = w.player.x;
  hold(w, { mx: NaN, my: 400, buttons: 0 }, 0.5);
  assert.equal(w.player.x, x1);
});

test('hub: the dash covers the run\'s distance, once a press, with the harbor\'s own short cooldown', () => {
  const D = DATA.tuning.player.dash;
  const w = harbor();
  place(w, [23, 18]); // three dashes east stay on the square
  const x0 = w.player.x;
  hold(w, makeFrame(1, 0, BTN_DASH), D.time);
  assert.ok(Math.abs(w.player.x - x0 - D.distance) < 1e-6, `dashed ${w.player.x - x0}`);
  // Holding the button doesn't dash again.
  const x1 = w.player.x;
  hold(w, makeFrame(0, 0, BTN_DASH), 1.5);
  assert.equal(w.player.x, x1);
  // A new press inside the cooldown does nothing; after it, you dash the way you last faced.
  const dash = makeFrame(0, 0, BTN_DASH);
  hold(w, EMPTY_FRAME, DT);
  hold(w, dash, DT); hold(w, EMPTY_FRAME, 0.5);
  const x2 = w.player.x;
  assert.ok(x2 > x1 + D.distance - 1e-6, 'a fresh press after the cooldown dashes');
  hold(w, dash, DT); hold(w, EMPTY_FRAME, 0.2);
  assert.equal(w.player.x, x2, 'inside the cooldown, no dash');
  hold(w, EMPTY_FRAME, HUB_TIMING.dashCooldown);
  hold(w, dash, DT); hold(w, EMPTY_FRAME, D.time);
  assert.ok(Math.abs(w.player.x - x2 - D.distance) < 1e-6, 'after the cooldown, a dash');
  assert.ok(HUB_TIMING.dashCooldown < D.cooldown, 'the harbor\'s dash comes back sooner than the run\'s');
});

test('hub: the dash goes the way you last moved: north, and on a diagonal', () => {
  const D = DATA.tuning.player.dash;
  const w = harbor();
  place(w, [26, 22]);
  hold(w, makeFrame(0, -1, BTN_DASH), D.time);
  assert.ok(Math.abs(w.player.x - px(26)) < 1e-6 && Math.abs(px(22) - w.player.y - D.distance) < 1e-6, `north: ${w.player.x - px(26)}, ${w.player.y - px(22)}`);
  hold(w, EMPTY_FRAME, HUB_TIMING.dashCooldown + DT);
  place(w, [26, 22]);
  hold(w, makeFrame(1, -1, BTN_DASH), D.time);
  const d = D.distance / Math.SQRT2;
  assert.ok(Math.abs(w.player.x - px(26) - d) < 1e-6 && Math.abs(px(22) - w.player.y - d) < 1e-6, `north-east: ${w.player.x - px(26)}, ${w.player.y - px(22)}`);
});

test('hub: walls, buildings, and the fog stop you; clearing the fog opens the way', () => {
  // The lamp on the square is solid: walking up into it from below stops under it.
  const w = harbor();
  place(w, [30, 18]);
  hold(w, UP, 2);
  assert.ok(w.player.y >= 16 * 16 + DATA.tuning.player.radius - 0.01, `stopped below the lamp at ${w.player.y}`);
  assert.equal(w.player.x, px(30));
  // At the start the square's west edge is fog (x 22): you can't walk into it.
  place(w, [30, 18]);
  hold(w, LEFT, 4);
  assert.ok(w.player.x >= 22 * 16 + DATA.tuning.player.radius - 0.01, `stopped at the fog at ${w.player.x}`);
  // The Lamp Post's first level clears the streets west to x 18.
  const doc = profile({ lamp_post: 1 });
  setRevealed(w, revealedFog(doc, DATA), { fade: false });
  hold(w, LEFT, 4);
  assert.ok(w.player.x < 22 * 16 && w.player.x >= 18 * 16 + DATA.tuning.player.radius - 0.01, `now stops at ${w.player.x}`);
  assert.equal(w.fogFade.size, 0, 'loading clears without a fade');
  // The sea wall stops you at the quay.
  place(w, [10, 26]);
  hold(w, makeFrame(0, 1), 2);
  assert.ok(w.player.y <= 27 * 16 - DATA.tuning.player.radius + 0.01);
});

test('hub: the fog fades out over its time when a level clears it, and skipping ends the fade', () => {
  const w = harbor();
  setRevealed(w, revealedFog(profile({ lamp_post: 1 }), DATA), { fade: true });
  assert.equal(w.fogFade.get('lamp_1'), 1);
  assert.equal(w.fogFade.has('square'), false, 'regions already clear don\'t fade again');
  hold(w, EMPTY_FRAME, HUB_TIMING.fogPeel / 2);
  const mid = w.fogFade.get('lamp_1');
  assert.ok(mid > 0.4 && mid < 0.6, `half faded: ${mid}`);
  hold(w, EMPTY_FRAME, HUB_TIMING.fogPeel / 2 + DT * 2);
  assert.equal(w.fogFade.has('lamp_1'), false);
});

test('hub: what\'s in reach: a door, the gate, a person, or nothing', () => {
  const w = harbor({ tavern: 4 });
  place(w, [14, 10]); hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'door', id: 'library' });
  assert.equal(doorAt(w, [14, 10]), 'library');
  assert.equal(doorAt(w, [15, 10]), null);
  place(w, [30, 16]); hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'door', id: 'lamp_post' });
  place(w, HUB.gate.at); hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'gate', id: 'gate' });
  // The innkeeper stands by the Tavern's door from its level 4; next to the door, the nearer wins.
  const post = HUB.keepers.innkeeper.post;
  place(w, post); hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'person', id: 'innkeeper' });
  place(w, [30, 20]); hold(w, EMPTY_FRAME, DT);
  assert.equal(w.near, null);
});

test('hub: the harbor\'s people follow the profile: keepers at level 4, walking at 5, characters waiting', () => {
  assert.deepEqual(hubPeople(profile(), DATA), [], 'nobody out at the start');
  assert.deepEqual(hubPeople(profile({ lamp_post: 3, library: 3, tavern: 3 }), DATA).filter((p) => p.kind === 'keeper'), [], 'no keeper before level 4');
  const at4 = hubPeople(profile({ library: 4 }), DATA);
  assert.deepEqual(at4.map((p) => [p.id, p.kind, p.loop]), [['librarian', 'keeper', null]]);
  const all = hubPeople(profile({ lamp_post: 5, library: 5, tavern: 5 }), DATA);
  assert.deepEqual(all.map((p) => p.id), ['lamp_keeper', 'librarian', 'innkeeper', 'harpooner']);
  assert.ok(all.slice(0, 3).every((p) => Array.isArray(p.loop)));
  const h = all[3];
  assert.equal(h.kind, 'waiting'); assert.deepEqual(h.post, HUB.waiting[0]); assert.equal(h.sprite, 'pc_harpooner');
  assert.ok(!all.some((p) => p.id === HUB.avatar), 'you aren\'t waiting for yourself');
  // The characters waiting face the middle of the square (keepers face out from their doors).
  const w = harbor();
  setPeople(w, [{ id: 'a', sprite: 'pc_harpooner', kind: 'waiting', post: [27, 14] }, { id: 'b', sprite: 'pc_harpooner', kind: 'waiting', post: [33, 18] }, { id: 'c', sprite: 'npc_librarian', kind: 'keeper', post: [33, 16] }]);
  assert.deepEqual(w.people.map((p) => p.facing), [1, -1, 1]);
  // What the keepers say: the newest line that applies.
  assert.equal(npcLine(profile({ lamp_post: 4 }), DATA, 'lamp_keeper'), 'Forty years I lit these streets. Nice to have help.');
  assert.equal(npcLine(profile({ lamp_post: 4, library: 5 }), DATA, 'lamp_keeper'), 'Silas says you read everything twice. Good habit.');
  assert.equal(npcLine(profile({ lamp_post: 5, library: 5 }), DATA, 'lamp_keeper'), 'The fog backs off from a steady flame. Keep it fed.', 'his own last level, last');
  assert.equal(npcLine(profile(), DATA, 'lamp_keeper'), null);
  assert.equal(npcLine(profile(), DATA, 'nobody'), null);
});

test('hub: a keeper walks their loop, pausing at each corner, and comes back; the others stand still', () => {
  const w = harbor({ library: 5, tavern: 1 });
  const lib = w.people.find((p) => p.id === 'librarian');
  const har = w.people.find((p) => p.id === 'harpooner');
  const loop = HUB.keepers.librarian.loop.map(([x, y]) => [px(x), px(y)]);
  const hx = har.x, hy = har.y;
  let lenPx = 0;
  for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; lenPx += Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]); }
  // Back at the post after walking every leg and pausing at the other corners; then a pause there.
  const back = lenPx / HUB_TIMING.walkSpeed + (loop.length - 1) * HUB_TIMING.keeperPause;
  const visited = new Set();
  let moved = 0;
  for (let i = 0, n = Math.round((back + HUB_TIMING.keeperPause / 2) / DT); i < n; i++) {
    stepHub(w, EMPTY_FRAME, DT);
    moved = Math.max(moved, Math.hypot(lib.x - loop[0][0], lib.y - loop[0][1]));
    loop.forEach(([x, y], k) => { if (lib.x === x && lib.y === y) visited.add(k); });
    // Along a straight run, never off it: one coordinate matches a corner's.
    assert.ok(loop.some(([x, y]) => Math.abs(lib.x - x) < 1e-6 || Math.abs(lib.y - y) < 1e-6), 'walks the streets, never cuts corners');
  }
  assert.equal(visited.size, loop.length, 'every corner of the walk');
  assert.ok(moved > 48);
  assert.deepEqual([lib.x, lib.y], loop[0], 'back at the post after a lap');
  assert.deepEqual([har.x, har.y], [hx, hy], 'the Harpooner waits where she is');
  // Setting the same people again keeps everyone where they are.
  hold(w, EMPTY_FRAME, 2);
  const at = [lib.x, lib.y];
  setPeople(w, hubPeople(profile({ library: 5, tavern: 1 }), DATA));
  assert.deepEqual([w.people.find((p) => p.id === 'librarian').x, w.people.find((p) => p.id === 'librarian').y], at);
});

test('hub: a ceremony pans to the building, clears the fog as it builds, brings the keeper out, and pans back', () => {
  const after = profile({ tavern: 4 });
  const w = harbor({ tavern: 3 });
  place(w, [44, 13]); hold(w, EMPTY_FRAME, DT);
  startCeremony(w, { building: 'tavern', level: 4, revealed: revealedFog(after, DATA), people: hubPeople(after, DATA) });
  assert.equal(w.timeline.kind, 'ceremony');
  assert.equal(w.timeline.from, 3);
  const plot = HUB.plots.find((p) => p.building === 'tavern');
  const cx = (plot.x + plot.w / 2) * 16, cy = (plot.y + plot.h / 2) * 16;
  const seen = [];
  let t = 0;
  while (w.timeline) {
    stepHub(w, RIGHT, DT); t += DT;
    for (const e of w.events) seen.push([e.kind, Math.round(t * 60)]);
    if (Math.abs(t - (HUB_TIMING.panIn + 1)) < DT / 2) {
      assert.ok(Math.hypot(w.cam.x - cx, w.cam.y - cy) < 0.5, 'the camera is on the building mid-ceremony');
      assert.equal(w.player.moving, false, 'you stand still while it plays');
      assert.equal(w.near, null);
    }
    assert.ok(t < CEREMONY_TIME + 0.1, 'it ends');
  }
  assert.ok(Math.abs(t - CEREMONY_TIME) < DT * 1.5, `it lasts ${t}`);
  assert.deepEqual(seen.map((s) => s[0]), ['build_start', 'build_done', 'done']);
  // (Within a tick: the times add up in floating point.)
  assert.ok(Math.abs(seen[0][1] - HUB_TIMING.panIn * 60) <= 1.5, 'the build starts when the camera gets there');
  assert.ok(Math.abs(seen[1][1] - (HUB_TIMING.panIn + HUB_TIMING.build) * 60) <= 1.5, 'and is done after its time');
  assert.equal(w.people.find((p) => p.id === 'innkeeper')?.kind, 'keeper', 'the innkeeper is out');
  assert.deepEqual([w.cam.x, w.cam.y], [w.player.x, w.player.y], 'the camera is back on you');
  hold(w, RIGHT, 0.2);
  assert.ok(w.player.moving, 'you can move again');
  assert.throws(() => startCeremony(w, { building: 'boathouse', level: 1 }), /no plot for boathouse/);
});

test('hub: the Tavern\'s first level: the ceremony, then the Harpooner sails in, walks up, and waits on the square', () => {
  const after = profile({ tavern: 1 });
  const w = harbor();
  const peopleAfter = hubPeople(after, DATA);
  const spot = peopleAfter.find((p) => p.id === 'harpooner').post;
  startCeremony(w, { building: 'tavern', level: 1, revealed: revealedFog(after, DATA), people: peopleAfter.filter((p) => p.id !== 'harpooner') });
  startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: spot, people: peopleAfter });
  assert.equal(w.queue.length, 1, 'the arrival waits for the ceremony');
  const kinds = [];
  let t = 0, onWater = true, boatTop = Infinity;
  while (w.timeline && t < 60) {
    stepHub(w, EMPTY_FRAME, DT); t += DT;
    for (const e of w.events) kinds.push(e.kind);
    const tl = w.timeline;
    if (tl?.kind === 'arrival' && tl.phase === 'sail') {
      const tx = Math.floor(tl.boat.x / 16), ty = Math.floor(tl.boat.y / 16);
      if (tx >= 0 && HUB.map[ty][tx] !== '~') onWater = false;
      boatTop = Math.min(boatTop, tl.boat.y);
      assert.ok(!w.people.some((p) => p.id === 'harpooner'), 'not on the square before she lands');
    }
  }
  assert.ok(t < 40, `the whole thing takes ${t.toFixed(1)} s`);
  assert.ok(onWater, 'the boat stays on the water');
  assert.deepEqual(kinds, ['build_start', 'build_done', 'done', 'landed', 'done']);
  const h = w.people.find((p) => p.id === 'harpooner');
  assert.deepEqual([h.x, h.y], [px(spot[0]), px(spot[1])], 'she waits at her spot');
  assert.deepEqual([w.cam.x, w.cam.y], [w.player.x, w.player.y]);
});

test('hub: skipping a set piece lands its state at once and starts the next one', () => {
  const after = profile({ tavern: 1 });
  const w = harbor();
  const peopleAfter = hubPeople(after, DATA);
  startCeremony(w, { building: 'tavern', level: 1, revealed: revealedFog(after, DATA), people: [] });
  startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: peopleAfter[0].post });
  hold(w, EMPTY_FRAME, 0.2);
  skipTimeline(w);
  assert.ok(w.revealed.has('tavern_1'), 'the fog cleared');
  assert.equal(w.fogFade.size, 0, 'with no fade');
  assert.equal(w.timeline?.kind, 'arrival', 'the arrival starts');
  hold(w, EMPTY_FRAME, 3);
  skipTimeline(w);
  assert.equal(w.timeline, null);
  const h = w.people.find((p) => p.id === 'harpooner');
  assert.deepEqual([h.kind, h.post], ['waiting', peopleAfter[0].post], 'without a people list, the newcomer joins whoever is out');
  assert.deepEqual([w.cam.x, w.cam.y], [w.player.x, w.player.y]);
  skipTimeline(w); // nothing running: nothing happens
  assert.equal(w.timeline, null);
  // Skipped while the fog is peeling (a second in): the fade ends with it.
  const w2 = harbor();
  startCeremony(w2, { building: 'lamp_post', level: 1, revealed: revealedFog(profile({ lamp_post: 1 }), DATA) });
  hold(w2, EMPTY_FRAME, 1.0);
  assert.ok(w2.fogFade.get('lamp_1') > 0 && w2.fogFade.get('lamp_1') < 1, 'peeling when skipped');
  skipTimeline(w2);
  assert.equal(w2.fogFade.size, 0, 'what it leaves behind lands at once');
  assert.ok(w2.revealed.has('lamp_1'));
  // Skipped mid-build, a level that brings a keeper out and a prop: both land, the prop solid at once.
  const w3 = harbor({ lamp_post: 3 });
  const four = profile({ lamp_post: 4 });
  const cart = HUB.props.find((p) => p.from === 'lamp_post:4');
  startCeremony(w3, { building: 'lamp_post', level: 4, revealed: revealedFog(four, DATA), people: hubPeople(four, DATA), props: shownProps(four, DATA) });
  hold(w3, EMPTY_FRAME, HUB_TIMING.panIn + 0.2);
  assert.ok(!w3.people.some((p) => p.id === 'lamp_keeper') && !w3.props.some((p) => p.id === cart.id), 'neither out while it builds');
  skipTimeline(w3);
  assert.equal(w3.people.find((p) => p.id === 'lamp_keeper')?.kind, 'keeper', 'the Lamp Post\'s keeper is out');
  assert.ok(w3.props.some((p) => p.id === cart.id), `and the ${cart.id}`);
  assert.equal(w3.solid[cart.at[1] * w3.map.cols + cart.at[0]], 1, 'solid at once');
});

test('hub: props come out with their levels, are solid, and never trap you', () => {
  assert.deepEqual(shownProps(profile(), DATA).map((p) => p.id), ['gate_sign']);
  assert.deepEqual(shownProps(profile({ lamp_post: 3 }), DATA).map((p) => p.id), ['gate_sign', 'square_well', 'square_tub']);
  const w = harbor();
  const well = HUB.props.find((p) => p.id === 'square_well');
  // Walking into the well's tile from the west, before and after it's out.
  place(w, [well.at[0] - 2, well.at[1]]);
  hold(w, RIGHT, 1);
  assert.ok(w.player.x > px(well.at[0]) - 1, 'no well yet: you walk over its spot');
  place(w, [well.at[0] - 2, well.at[1]]);
  setProps(w, shownProps(profile({ lamp_post: 2 }), DATA));
  hold(w, RIGHT, 1);
  assert.ok(w.player.x <= well.at[0] * 16 - DATA.tuning.player.radius + 0.01, `the well stops you (${w.player.x})`);
  // A prop appearing at your edge pushes you clear of it at once (not on your next step).
  const R = DATA.tuning.player.radius;
  setProps(w, shownProps(profile(), DATA));
  place(w, [well.at[0] - 1, well.at[1]]);
  w.player.x = w.player.px = well.at[0] * 16 - 2;   // 2 px west of its tile: your body reaches into it
  setProps(w, shownProps(profile({ lamp_post: 2 }), DATA));
  assert.deepEqual([w.player.x, w.player.px, w.player.y], [well.at[0] * 16 - R, well.at[0] * 16 - R, px(well.at[1])], 'clear of it, and drawn there');
  // A prop appearing where you stand moves you to the nearest open tile, not into a wall.
  place(w, well.at);
  setProps(w, shownProps(profile({ lamp_post: 2 }), DATA));
  const tx = Math.floor(w.player.x / 16), ty = Math.floor(w.player.y / 16);
  assert.notDeepEqual([tx, ty], well.at);
  assert.equal(w.solid[ty * w.map.cols + tx], 0);
  assert.equal(Math.abs(tx - well.at[0]) + Math.abs(ty - well.at[1]), 1, 'one tile over');
  // A ceremony brings its props out when the building is done.
  const w2 = harbor({ lamp_post: 1 });
  const after = profile({ lamp_post: 2 });
  startCeremony(w2, { building: 'lamp_post', level: 2, revealed: revealedFog(after, DATA), props: shownProps(after, DATA) });
  hold(w2, EMPTY_FRAME, HUB_TIMING.panIn + HUB_TIMING.build / 2);
  assert.ok(!w2.props.some((p) => p.id === 'square_well'), 'not while it builds');
  hold(w2, EMPTY_FRAME, HUB_TIMING.build);
  assert.ok(w2.props.some((p) => p.id === 'square_well'), 'out when it\'s built');
  // And its keeper steps out then too, not when it starts.
  const w3 = harbor({ lamp_post: 5, tavern: 3 });
  const keeperAfter = profile({ lamp_post: 5, tavern: 4 });
  startCeremony(w3, { building: 'tavern', level: 4, revealed: revealedFog(keeperAfter, DATA), people: hubPeople(keeperAfter, DATA) });
  hold(w3, EMPTY_FRAME, HUB_TIMING.panIn + HUB_TIMING.build / 2);
  assert.ok(!w3.people.some((p) => p.id === 'innkeeper'), 'not while it builds');
  hold(w3, EMPTY_FRAME, HUB_TIMING.build);
  assert.ok(w3.people.some((p) => p.id === 'innkeeper'), 'out when it\'s built');
});

test('hub: during a ceremony nothing is in reach, even at a door; a change to its timing applies at once', () => {
  const live = createHubTuning();
  const w = harbor({ lamp_post: 1 }, { timing: live.timing });
  place(w, [14, 10]); hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'door', id: 'library' }, 'at the Library\'s door');
  startCeremony(w, { building: 'tavern', level: 1 });
  hold(w, EMPTY_FRAME, live.timing.panIn + 0.2);
  assert.equal(w.near, null, 'the ceremony has the stage');
  // Mid-ceremony, a longer hold: it ends that much later.
  setHubTune(live, 'timing.hold', 2);
  let t = live.timing.panIn + 0.2;
  while (w.timeline) { stepHub(w, EMPTY_FRAME, DT); t += DT; assert.ok(t < 10, 'it ends'); }
  assert.ok(Math.abs(t - ceremonyTime(live.timing)) < DT * 1.5, `it lasts ${t}, the tuned ${ceremonyTime(live.timing)}`);
  assert.ok(ceremonyTime(live.timing) > CEREMONY_TIME + 1);
  hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'door', id: 'library' }, 'the door again after it');
});

test('hub: skipping a ceremony still reports it built (the banner), and the next set piece starts', () => {
  const after = profile({ tavern: 1 });
  const w = harbor();
  startCeremony(w, { building: 'tavern', level: 1, revealed: revealedFog(after, DATA), props: shownProps(after, DATA) });
  startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: HUB.waiting[0] });
  hold(w, EMPTY_FRAME, 0.2);
  assert.deepEqual(skipTimeline(w).map((e) => e.kind), ['build_done', 'done']);
  assert.equal(w.timeline.kind, 'arrival');
  hold(w, EMPTY_FRAME, 1);
  assert.deepEqual(skipTimeline(w).map((e) => e.kind), ['landed', 'done'], 'still sailing: it lands');
  assert.deepEqual(skipTimeline(w), [], 'nothing running: nothing to say');
  // Skipping a ceremony that's already built doesn't say it twice.
  startCeremony(w, { building: 'library', level: 1 });
  hold(w, EMPTY_FRAME, HUB_TIMING.panIn + HUB_TIMING.build + 0.1);
  assert.deepEqual(skipTimeline(w).map((e) => e.kind), ['done']);
});

test('hub: the Lamp Post is used from any side; a door wins a tie with a keeper walking past', () => {
  const w = harbor();
  const lp = HUB.plots.find((p) => p.building === 'lamp_post');
  // Walk into the lamp from the west, the north, and the east: each time it's in reach.
  for (const [start, frame] of [[[lp.x - 3, lp.y], RIGHT], [[lp.x, lp.y - 3], makeFrame(0, 1)], [[lp.x + 3, lp.y], LEFT]]) {
    place(w, start);
    hold(w, frame, 1);
    assert.deepEqual(w.near, { kind: 'door', id: 'lamp_post' }, `from ${start}`);
  }
  // The Library's keeper walking over its door while you stand at it: the door is still the door.
  const w2 = harbor({ library: 5 });
  const lib = HUB.plots.find((p) => p.building === 'library');
  place(w2, lib.door);
  const keeper = w2.people.find((p) => p.id === 'librarian');
  keeper.x = keeper.px = px(lib.door[0]); keeper.y = keeper.py = px(lib.door[1]);
  keeper.wait = 99;
  hold(w2, EMPTY_FRAME, DT);
  assert.deepEqual(w2.near, { kind: 'door', id: 'library' });
  // One step toward the keeper from the door, and it's them.
  keeper.x += 6;
  w2.player.x += 5;
  hold(w2, EMPTY_FRAME, DT);
  assert.deepEqual(w2.near, { kind: 'person', id: 'librarian' });
});

test('hub: last tick\'s positions are kept for you and for the people walking, for the view to draw between', () => {
  const w = harbor({ library: 5 });
  const lib = w.people.find((p) => p.id === 'librarian');
  place(w, [30, 18]);
  hold(w, EMPTY_FRAME, 2);   // past the keeper's first pause at the corner
  for (let i = 0; i < 30; i++) {
    const me = [w.player.x, w.player.y], him = [lib.x, lib.y];
    stepHub(w, RIGHT, DT);
    assert.deepEqual([w.player.px, w.player.py], me, 'your last position');
    assert.deepEqual([lib.px, lib.py], him, 'the keeper\'s last position');
  }
  assert.ok(w.player.x > w.player.px, 'and you moved');
});

test('hub: each world has its own timing, read every tick (the tuning panel changes it live)', () => {
  const fast = createHubTuning();
  fast.timing.panIn = 0.2; fast.timing.build = 0.3; fast.timing.fogPeel = 0.3; fast.timing.hold = 0; fast.timing.panOut = 0.2;
  const w = harbor({}, { timing: fast.timing });
  startCeremony(w, { building: 'library', level: 1 });
  let t = 0;
  while (w.timeline && t < 5) { stepHub(w, EMPTY_FRAME, DT); t += DT; }
  assert.ok(Math.abs(t - ceremonyTime(fast.timing)) < DT * 1.5 && t < 1, `its own ceremony time: ${t.toFixed(2)} s`);
  // The default world is untouched by another world's timing.
  assert.equal(harbor().T, HUB_TIMING);
  assert.equal(ceremonyTime(HUB_TIMING), CEREMONY_TIME);
  // A change made while it runs applies from the next tick: the reach, the dash's cooldown.
  place(w, [14, 10]); hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'door', id: 'library' });
  setHubTune(fast, 'timing.reach', 0);
  place(w, [14, 10]); w.player.x += 1; hold(w, EMPTY_FRAME, DT);
  assert.equal(w.near, null, 'out of a reach of 0');
  resetHubTuning(fast);
  hold(w, EMPTY_FRAME, DT);
  assert.deepEqual(w.near, { kind: 'door', id: 'library' }, 'reset: in reach again');
  assert.equal(fast.timing.panIn, HUB_TIMING.panIn);
  // Only numbers the harbor can run on.
  assert.equal(checkHubTune(fast, 'timing.panIn', 0), 'timing.panIn must stay above 0');
  assert.equal(checkHubTune(fast, 'timing.hold', 0), null, 'no hold is fine');
  assert.equal(checkHubTune(fast, 'timing.reach', -1), 'timing.reach can\'t go below 0');
  assert.equal(checkHubTune(fast, 'look.ambientBoost', -0.2), null, 'the night can darken');
  assert.equal(checkHubTune(fast, 'look.boatInFog', 1.05), 'look.boatInFog can\'t go above 1', 'a shade is 0 to 1');
  assert.equal(checkHubTune(fast, 'look.lanternLight', 1.2), 'look.lanternLight can\'t go above 1');
  assert.equal(checkHubTune(fast, 'look.lanternReach', 400), null, 'a reach has no top');
  assert.equal(checkHubTune(fast, 'look.popSec', NaN), 'look.popSec should be a number');
  assert.match(checkHubTune(fast, 'look.fogColor', 1), /no harbor tuning number/, 'colors are changed in the data');
  assert.match(checkHubTune(fast, 'look.nope', 1), /no harbor tuning number/);
  assert.throws(() => setHubTune(fast, 'timing.arriveSpeed', 0), /must stay above 0/);
  assert.ok(Object.isFrozen(DATA.hubTuning.timing) && !Object.isFrozen(fast.timing), 'the data stays frozen; the copy changes');
});

test('hub: an arrival\'s pans and walk, a keeper\'s pause, and the dash\'s cooldown each follow the world\'s own timing', () => {
  const t = createHubTuning();
  Object.assign(t.timing, { panIn: 0.3, panOut: 0.4, arriveSpeed: 20, keeperPause: 0.5, dashCooldown: 0.25 });
  for (const k of ['panIn', 'panOut', 'arriveSpeed', 'keeperPause', 'dashCooldown']) assert.notEqual(t.timing[k], HUB_TIMING[k], `${k} differs from the default`);
  const w = harbor({ library: 5 }, { timing: t.timing });
  startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: HUB.waiting[0] });
  const ticks = {};
  let fastest = 0;
  while (w.timeline) {
    const phase = w.timeline.phase, was = [w.timeline.walker.x, w.timeline.walker.y];
    stepHub(w, EMPTY_FRAME, DT);
    ticks[phase] = (ticks[phase] ?? 0) + 1;
    if (phase === 'walk' && w.timeline) fastest = Math.max(fastest, Math.hypot(w.timeline.walker.x - was[0], w.timeline.walker.y - was[1]));
  }
  const near = (n, secs) => Math.abs(n - secs / DT) <= 1;
  assert.ok(near(ticks.panIn, 0.3), `the pan in: ${ticks.panIn} ticks`);
  assert.ok(near(ticks.panOut, 0.4), `the pan out: ${ticks.panOut} ticks`);
  assert.ok(Math.abs(fastest - 20 * DT) < 1e-9, `she walks up at 20 px a second (${(fastest / DT).toFixed(2)})`);
  // The Library's keeper stops at a corner for half a second.
  const lib = w.people.find((p) => p.id === 'librarian');
  let walked = false, still = 0;
  for (let i = 0; i < 60 * 30; i++) {
    stepHub(w, EMPTY_FRAME, DT);
    if (lib.moving) { if (still) break; walked = true; } else if (walked) still++;
  }
  assert.ok(near(still, 0.5), `a pause of ${still} ticks`);
  // The dash is back after a quarter second, not the harbor's default.
  place(w, [26, 22]); hold(w, EMPTY_FRAME, 1);
  const press = () => { stepHub(w, EMPTY_FRAME, DT); stepHub(w, makeFrame(1, 0, BTN_DASH), DT); return w.events.some((e) => e.kind === 'dash'); };
  assert.ok(press(), 'a dash');
  hold(w, EMPTY_FRAME, 0.2);
  assert.equal(press(), false, 'not yet, 0.23 s after');
  hold(w, EMPTY_FRAME, 0.1);
  assert.ok(press(), 'again, 0.37 s after');
});

test('hub: the tuning panel holds every harbor number to its range, at both edges', () => {
  const t = createHubTuning();
  const numbers = flattenTuning(DATA.hubTuning).filter((n) => typeof n.value === 'number');
  assert.ok(numbers.length > 60 && numbers.some((n) => n.path === 'look.smoke.every'), 'the groups inside the look too');
  const edges = {
    above0: { ok: [0.001, 1e6], no: [0, -1] },
    min0: { ok: [0, 1e6], no: [-0.001] },
    unit: { ok: [0, 1], no: [-0.001, 1.001] },
    any: { ok: [-1e6, 0, 1e6], no: [] },
  };
  for (const n of numbers) {
    const range = hubTuneRange(n.path);
    assert.ok(edges[range], `${n.path} has a range`);
    for (const v of edges[range].ok) assert.equal(checkHubTune(t, n.path, v), null, `${n.path} (${range}) takes ${v}`);
    for (const v of edges[range].no) assert.notEqual(checkHubTune(t, n.path, v), null, `${n.path} (${range}) refuses ${v}`);
    assert.equal(checkHubTune(t, n.path, Infinity), `${n.path} should be a number`);
  }
  // Set and reset in the groups inside the look.
  setHubTune(t, 'look.smoke.every', 2);
  setHubTune(t, 'look.puffs.alpha', 0.1);
  const smoke = t.look.smoke;
  resetHubTuning(t);
  assert.deepEqual(t, JSON.parse(JSON.stringify(DATA.hubTuning)));
  assert.equal(t.look.smoke, smoke, 'in place: what holds the group sees the reset');
});

test('hub: an arrival needs a tile to wait at, said plainly', () => {
  const w = harbor();
  assert.throws(() => startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner' }), /harpooner needs a tile to wait at on the square/);
  assert.throws(() => startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: [3.5, 2] }), /needs a tile/);
  assert.equal(w.timeline, null, 'nothing started');
});

test('hub: a tick with no length does nothing; the fog starts peeling when the build starts', () => {
  const w = harbor();
  const before = JSON.stringify([w.player, w.time]);
  stepHub(w, makeFrame(1, 0, BTN_DASH), 0);
  stepHub(w, makeFrame(1, 0, BTN_DASH), -1);
  stepHub(w, makeFrame(1, 0, BTN_DASH), NaN);
  assert.equal(JSON.stringify([w.player, w.time]), before);
  const after = profile({ lamp_post: 1 });
  startCeremony(w, { building: 'lamp_post', level: 1, revealed: revealedFog(after, DATA) });
  hold(w, EMPTY_FRAME, HUB_TIMING.panIn - 0.1);
  assert.ok(!w.revealed.has('lamp_1') && !w.fogFade.size, 'not while the camera is on its way');
  hold(w, EMPTY_FRAME, 0.2);
  assert.ok(w.revealed.has('lamp_1') && w.fogFade.get('lamp_1') > 0.9, 'from the start of the build, fading');
});

test('hub: an arrival: the camera follows the boat in, the newcomer steps off and walks the streets to her spot', () => {
  const w = harbor();
  const spot = HUB.waiting[0];
  startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: spot });
  const path = [];
  let followed = true, between = true, handoff = null;
  while (w.timeline) {
    const was = { cam: [w.cam.x, w.cam.y], boat: [w.timeline.boat.x, w.timeline.boat.y], walker: [w.timeline.walker.x, w.timeline.walker.y] };
    stepHub(w, EMPTY_FRAME, DT);
    const tl = w.timeline;
    if (!tl) break;
    if (tl.phase === 'sail' && (w.cam.x !== tl.boat.x || w.cam.y !== tl.boat.y)) followed = false;
    if (tl.phase === 'walk' || tl.phase === 'panOut') path.push([tl.walker.x, tl.walker.y]);
    // Where the camera, the boat, and the walker were last tick is kept, for the view to draw between.
    const kept = [[w.cam.px, w.cam.py], [tl.boat.px, tl.boat.py], [tl.walker.px, tl.walker.py]];
    if (JSON.stringify(kept) !== JSON.stringify([was.cam, was.boat, was.walker])) between = false;
    const her = w.people.find((p) => p.id === 'harpooner');
    if (her && !handoff) handoff = { phase: tl.phase, walker: [tl.walker.x, tl.walker.y], at: [her.x, her.y], facing: her.facing };
  }
  assert.ok(followed, 'the camera is on the boat the whole way');
  assert.ok(between, 'last tick\'s positions are kept every tick');
  // She joins the square on the tick she stops walking, right where she stopped (so the view can
  // hand over from the walker to her waiting figure without a gap), and turns to the square.
  assert.equal(handoff.phase, 'panOut');
  assert.deepEqual(handoff.at, handoff.walker);
  assert.equal(handoff.facing, spot[0] > HUB.spawn[0] ? -1 : 1);
  // She walks from the boat onto the pier, up it, then along the column and the row: never diagonally
  // across open ground, and she ends on her spot.
  const [landX, landY] = HUB.harbor.landing;
  assert.ok(path.some(([x, y]) => x === px(landX) && y === px(landY)), 'she steps onto the landing');
  const last = path[path.length - 1];
  assert.deepEqual(last, [px(spot[0]), px(spot[1])]);
  const afterPier = path.filter(([, y]) => y < px(landY));
  for (const [x, y] of afterPier) assert.ok(x === px(HUB.harbor.walkUp[1][0]) || y === px(spot[1]), `on the street at ${x}, ${y}`);
});

test('hub map: the checks the content test leans on say no when they should', () => {
  const map = buildHubMap(HUB, HUB_TERRAIN);
  const open = new Uint8Array(map.cols * map.rows);
  const wall = new Uint8Array(map.cols * map.rows); wall[5 * map.cols + 7] = 1;
  assert.equal(segmentOpen(map, open, [2, 5], [10, 5]), true);
  assert.equal(segmentOpen(map, wall, [2, 5], [10, 5]), false, 'a solid tile on the way');
  assert.equal(segmentOpen(map, open, [2, 5], [4, 7]), false, 'no diagonal walks');
  assert.equal(segmentOpen(map, open, [map.cols - 2, 5], [map.cols + 2, 5]), false, 'off the map');
  assert.equal(segmentOpen(map, wall, [2, 5], [7, 5]), false, 'ending on a solid tile');
  assert.equal(segmentOpen(map, wall, [7, 5], [10, 5]), false, 'starting on one');
  assert.equal(segmentOpen(map, wall, [2, 5], [6, 5]), true, 'stopping just short of it');
  const boxed = new Uint8Array(map.cols * map.rows).fill(1);
  boxed[3 * map.cols + 3] = 0; boxed[3 * map.cols + 4] = 0; boxed[9 * map.cols + 9] = 0;
  const r = reachableFrom(map, boxed, [3, 3]);
  assert.equal(r[3 * map.cols + 4], 1);
  assert.equal(r[9 * map.cols + 9], 0, 'an open tile walled off is not reachable');
  boxed[4 * map.cols + 5] = 0;
  assert.equal(reachableFrom(map, boxed, [3, 3])[4 * map.cols + 5], 0, 'nor one only a corner touches (no squeezing between two walls)');
  // A prop off the map is dropped, not wrapped onto a tile of the row above or below (here the
  // square's open tile at 30, 18).
  const clear = new Uint8Array(map.cols * map.rows).fill(1);
  assert.equal(solidTiles(map, clear)[18 * map.cols + 30], 0, 'the square is open there');
  assert.deepEqual(solidTiles(map, clear, [{ at: [30 + map.cols, 17] }, { at: [30 - map.cols, 19] }, { at: [3, map.rows] }]), solidTiles(map, clear), 'props off the map change nothing');
  assert.equal(reachableFrom(map, boxed, [0, 0]).reduce((a, b) => a + b, 0), 0, 'from a wall, nothing');
  assert.deepEqual(nearestOpen(map, boxed, [5, 3]), [4, 3]);
  // The map data's mistakes are named.
  const bad = (patch, re) => assert.throws(() => buildHubMap({ ...HUB, ...patch }, HUB_TERRAIN), re);
  bad({ map: [] }, /no rows/);
  bad({ map: [HUB.map[0], HUB.map[1].slice(1)] }, /row 1 is 59 wide, not 60/);
  bad({ map: HUB.map.map((row, y) => (y === 3 ? `?${row.slice(1)}` : row)) }, /unknown ground "\?" at 0, 3/);
  bad({ plots: [...HUB.plots, { building: 'far', x: 58, y: 0, w: 5, h: 2, door: [0, 0] }] }, /far's plot runs off the map/);
  bad({ ruins: [...HUB.ruins, { id: 'overlap', x: 12, y: 6, w: 2, h: 2 }] }, /overlap's plot overlaps another at 12, 6/);
  bad({ fog: [...HUB.fog, { id: 'wide', revealedBy: 'start', rects: [[50, 0, 20, 2]] }] }, /fog region wide has a rectangle off the map/);
  bad({ fog: Array.from({ length: 33 }, (_, k) => ({ id: `f${k}`, revealedBy: 'start', rects: [[0, 0, 1, 1]] })) }, /at most 32 fog regions/);
  bad({ gate: { ...HUB.gate, lamp: [map.cols, 3] } }, /a lamp at 60, 3 is off the map/);
  bad({ harbor: { ...HUB.harbor, lamp: [4, -1] } }, /a lamp at 4, -1 is off the map/);
});

test('hub: the harbor runs the same way every time (no clocks, no randomness)', () => {
  const trace = () => {
    const w = harbor({ lamp_post: 5, library: 5 });
    const out = [];
    for (let i = 0; i < 1200; i++) {
      const f = makeFrame(((i * 37) % 200 - 100) / 100, ((i * 53) % 200 - 100) / 100, i % 90 === 0 ? BTN_DASH : 0);
      stepHub(w, f, DT);
      if (i % 60 === 0) out.push([w.player.x, w.player.y, ...w.people.map((p) => p.x + p.y)].join(','));
    }
    return out.join('|');
  };
  assert.equal(trace(), trace());
});

test('hub: the camera glides in and out of both set pieces, never jumping', () => {
  const w = harbor({ tavern: 3 });
  place(w, [30, 18]); hold(w, EMPTY_FRAME, DT);
  const me = [w.player.x, w.player.y];
  startCeremony(w, { building: 'tavern', level: 4 });
  const tl = w.timeline;
  const at = [tl.x, tl.y];
  const between = (p, a, b) => { const k = (p[0] - a[0]) / (b[0] - a[0]); return k > 0.05 && k < 0.95 && Math.abs(a[1] + (b[1] - a[1]) * k - p[1]) < 1e-6; };
  hold(w, EMPTY_FRAME, HUB_TIMING.panIn / 2);
  assert.ok(between([w.cam.x, w.cam.y], me, at), `half way in: ${w.cam.x}, ${w.cam.y}`);
  hold(w, EMPTY_FRAME, CEREMONY_TIME - HUB_TIMING.panIn / 2 - HUB_TIMING.panOut / 2);
  assert.ok(between([w.cam.x, w.cam.y], at, me), `half way back: ${w.cam.x}, ${w.cam.y}`);
  hold(w, EMPTY_FRAME, HUB_TIMING.panOut);
  assert.equal(w.timeline, null);
  // An arrival: in to the boat, and back from where the newcomer stopped.
  const a = harbor();
  place(a, [30, 18]); hold(a, EMPTY_FRAME, DT);
  startArrival(a, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: HUB.waiting[0] });
  const boat = [a.timeline.boat.x, a.timeline.boat.y];
  hold(a, EMPTY_FRAME, HUB_TIMING.panIn / 2);
  assert.ok(between([a.cam.x, a.cam.y], [a.player.x, a.player.y], boat), 'half way to the boat');
  while (a.timeline && a.timeline.phase !== 'panOut') stepHub(a, EMPTY_FRAME, DT);
  const stop = [a.timeline.walker.x, a.timeline.walker.y];
  hold(a, EMPTY_FRAME, HUB_TIMING.panOut / 2);
  assert.ok(between([a.cam.x, a.cam.y], stop, [a.player.x, a.player.y]), 'half way back to you');
});

test('hub: a world tuned faster builds, peels the fog, and brings the keeper out on its own timing', () => {
  const t = createHubTuning();
  Object.assign(t.timing, { panIn: 0.2, build: 0.3, fogPeel: 0.4, hold: 0.1, panOut: 0.2 });
  const after = profile({ tavern: 4 });
  const w = harbor({ tavern: 3 }, { timing: t.timing });
  startCeremony(w, { building: 'tavern', level: 4, revealed: revealedFog(profile({ tavern: 5 }), DATA), people: hubPeople(after, DATA), props: shownProps(after, DATA) });
  const seen = [];
  let time = 0, fadeEnd = null;
  while (w.timeline && time < 3) {
    stepHub(w, EMPTY_FRAME, DT); time += DT;
    for (const e of w.events) seen.push([e.kind, Math.round(time * 60)]);
    if (fadeEnd === null && seen.some((s) => s[0] === 'build_start') && w.fogFade.size === 0) fadeEnd = time;
  }
  // The pan in, the fog's 0.4 s (it outlasts the build's 0.3 s, so the ceremony waits for it), the
  // hold, the pan out: 0.9 s.
  assert.ok(Math.abs(time - 0.9) < DT * 1.5, `the whole of it: ${time.toFixed(2)} s`);
  assert.ok(Math.abs(ceremonyTime(t.timing) - 0.9) < 1e-9);
  const at = (kind) => seen.find((s) => s[0] === kind)?.[1];
  assert.ok(Math.abs(at('build_done') - (0.2 + 0.3) * 60) <= 1.5, `built on its own time (${at('build_done')} ticks)`);
  // (The fade starts on the tick the build does and loses a tick's share each tick after.)
  assert.ok(Math.abs(fadeEnd - (0.2 + 0.4)) < DT * 3, `the fog peeled on its own time (${fadeEnd.toFixed(2)} s)`);
  assert.equal(w.people.find((p) => p.id === 'innkeeper')?.kind, 'keeper', 'the keeper came out');
  assert.ok(w.props.some((p) => p.id === 'tavern_barrel_2'), 'and its props');
});

test('hub: a dash held through a set piece doesn\'t fire when it ends; a fresh press does', () => {
  const w = harbor();
  place(w, [30, 18]); hold(w, EMPTY_FRAME, DT);
  const held = makeFrame(1, 0, BTN_DASH);
  stepHub(w, held, DT);   // pressed before the ceremony: a dash
  hold(w, EMPTY_FRAME, 1);
  startCeremony(w, { building: 'library', level: 1 });
  while (w.timeline) stepHub(w, makeFrame(0, 0, BTN_DASH), DT);
  const x = w.player.x;
  stepHub(w, makeFrame(0, 0, BTN_DASH), DT);
  assert.ok(!w.events.some((e) => e.kind === 'dash'), 'still held: no dash');
  hold(w, makeFrame(0, 0, BTN_DASH), 0.2);
  assert.equal(w.player.x, x);
  stepHub(w, EMPTY_FRAME, DT);
  stepHub(w, makeFrame(1, 0, BTN_DASH), DT);
  assert.ok(w.events.some((e) => e.kind === 'dash'), 'let go and pressed again: a dash');
});

test('hub: the newcomer steps off where she stood in the boat (its middle plus the harbor\'s aboard and deck)', () => {
  const w = harbor();
  startArrival(w, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: HUB.waiting[0] });
  const end = HUB.harbor.boatRoute.at(-1).map((t) => px(t));
  const aboard = [end[0] + HUB.harbor.aboard, end[1] + HUB.harbor.deck];
  assert.deepEqual(w.timeline.walk[0], aboard);
  assert.ok(HUB.harbor.aboard > 0 && HUB.harbor.deck > 0, 'toward the bow, feet on the deck');
  while (w.timeline.phase !== 'walk') stepHub(w, EMPTY_FRAME, DT);
  assert.deepEqual([w.timeline.walker.px, w.timeline.walker.py], aboard, 'her first step is from there');
});
