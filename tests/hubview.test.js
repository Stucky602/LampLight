// The harbor view itself (render/hubview.js, ARCHITECTURE §10.4), run in Node on Pixi's real
// scene graph with stand-ins for the GPU and the canvas (tests/helpers/hubrig.js): what each part
// of the scene shows, frame by frame, against the pure helpers it draws from. The layers and the
// fog's make-up, the fog redrawn while a region peels, you and the people between ticks, every
// light into the light map, a stage rising behind its mask, an arrival from the boat to the
// square, every light on the glass its drawing has (where the view actually stands each thing),
// the look read live, and every harbor number at the edge of its range drawing nothing broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Texture } from 'pixi.js';
import { DATA } from '../src/data/index.js';
import { HUB_TUNING_RANGE } from '../src/data/tuning.js';
import { PALETTE } from '../src/data/palette.js';
import { stepHub, startCeremony, startArrival, setProps } from '../src/hub/world.js';
import { createHubTuning } from '../src/hub/tuning.js';
import { EMPTY_FRAME } from '../src/lib/inputframe.js';
import { restoreBuilding, shownProps } from '../src/meta/index.js';
import { levelsOf, levelSetPieces } from '../src/app/hublogic.js';
import { flattenTuning } from '../src/ui/tuningmodel.js';
import {
  harborLights, arrivalLook, ambientLight, lookColor, drawnAt, flickerAt, boatBobAt, hopPhase, fogDensity, fogAtPoint, newcomerTint, boatTint, lightAt,
  clearOfBoat, steppingAlpha, clampCamera, cameraAt, ANCHORS, buildingDraw, lampRadius,
} from '../src/render/hubtiles.js';
import { stepHop } from '../src/render/viewstate.js';
import { PLAYER_FEET_ROOM } from '../src/render/playerframe.js';
import { hubRig, profileWith, ATLAS_JSON } from './helpers/hubrig.js';

const HUB = DATA.hub;
const DT = 1 / 60, MS = 1000 / 60;
const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 99999]));
const rich = (levels) => { const d = profileWith(levels); Object.assign(d.profile.materials, RICH); return d; };

/** One tick of the world, then a frame drawn at it. */
function tick(r, frame = EMPTY_FRAME) { stepHub(r.world, frame, DT); return r.frame(1, MS); }
/** Ticks until `pred(world)` holds (the frame it first holds); fails after `max`. */
function until(r, pred, what, max = 60 * 60) {
  for (let i = 0; i < max; i++) { const f = tick(r); if (pred(r.world)) return f; }
  throw new Error(`never: ${what}`);
}
/** A purchase in the harbor, as the scene makes it: the new levels drawn, its set pieces started. */
function buy(r, building) {
  const out = restoreBuilding(r.doc, DATA, building);
  const plan = levelSetPieces(out.doc, DATA, out.changes[0]);
  r.doc = out.doc;
  r.view.setLevels(levelsOf(out.doc, DATA));
  startCeremony(r.world, plan.ceremony);
  for (const a of plan.arrivals) startArrival(r.world, a);
  return plan;
}
/** The fog's density as the view draws it (its fog is redrawn from the world each change). */
const densityOf = (r) => fogDensity(r.world.map, r.world.revealed, r.world.fogFade, undefined, r.tuning.look);
const fogAtFor = (r) => { const d = densityOf(r); return (x, y) => fogAtPoint(d, r.world.map.cols, r.world.map.rows, x, y); };

test('harbor view in Node: the layers stack as §10.4 says, and the fog shows each tile\'s density times its thickness', () => {
  const r = hubRig({ levels: { lamp_post: 1 } });
  const look = r.tuning.look;
  let f = r.frame();
  assert.deepEqual(r.find('harbor').children.slice(0, 7).map((c) => c.label), ['sea', 'ground', 'actors', 'puffs', 'light', 'fog', 'boat-layer']);
  assert.equal(r.find('light').blendMode, 'multiply', 'the light map multiplies the town down');
  assert.equal(f.light.blend, 'add', 'the lights add up in it');
  // Each is drawn into the texture its layer shows, over a fresh start: the night, and nothing.
  assert.equal(f.light.target, r.find('light').texture, 'the light map into the light layer\'s texture');
  assert.equal(f.fog.target, r.find('fog').texture, 'the fog into the fog layer\'s');
  assert.deepEqual([f.light.cleared, f.fog.cleared], [true, true], 'each cleared first, every frame');
  assert.deepEqual(f.fog.clearColor, [0, 0, 0, 0], 'the fog from see-through');
  assert.deepEqual(f.fog.order, ['fog-fill', 'fog-wisps', 'fog-clear'], 'the fog whole, the wisps over it, then erased by how clear each tile is');
  assert.equal(f.fog.clear.blend, 'erase');
  assert.equal(f.fog.fill.alpha, look.fogDensity);
  assert.equal(f.fog.fill.tint, lookColor(look.fogColor));
  assert.ok(f.fog.fill.w >= 320 + 2 && f.fog.fill.h >= 180 + 2, 'the fill covers the fog\'s whole texture');
  assert.equal(f.fog.wisps.alpha, look.wisps);
  assert.equal(f.fog.wisps.tint, lookColor(look.wispColor));
  // The mask a texel a tile, each texel's middle on its tile's middle.
  const fog = r.find('fog');
  assert.equal(f.fog.clear.sx, 8);
  assert.equal(f.fog.clear.x * -2, fog.x, 'the mask placed where the fog texture is');
  assert.equal(fog.x, r.find('light').x, 'the fog and the light map share their place');
  // Halfway through a region's peel, every tile shows its density times the thickness.
  r.world.fogFade = new Map([['lamp_1', 0.5]]);
  f = r.frame();
  const dens = densityOf(r);
  const shown = (i) => f.fog.fill.alpha * (1 - f.fog.mask.data[i * 4 + 3] / 255);
  let between = 0;
  for (let i = 0; i < dens.length; i++) {
    assert.ok(Math.abs(shown(i) - dens[i] * look.fogDensity) <= 0.5 / 255 + 1e-9, `tile ${i}: ${shown(i)} shown, ${dens[i] * look.fogDensity} meant`);
    if (dens[i] > 0.2 && dens[i] < 0.8) between++;
  }
  assert.ok(between > 10, 'the peel is half done somewhere');
  // The thickness is live, and needs no new mask.
  const puts = f.fog.maskPuts;
  r.world.fogFade = new Map();
  r.frame();
  r.tuning.look.fogDensity = 0.5;
  f = r.frame();
  assert.equal(f.fog.fill.alpha, 0.5);
  assert.equal(f.fog.maskPuts, puts + 1, 'redrawn once as the fade ended, not again for the thickness');
});

test('harbor view in Node: a region peeling back redraws the fog every frame, once more at its end, then not again', () => {
  const r = hubRig({ profile: rich({}) });
  r.frame();
  buy(r, 'lamp_post');
  let f = until(r, (w) => w.fogFade.size > 0, 'the peel starts');
  let last = f.fog.maskPuts, lastMask = f.fog.mask.data, frames = 0;
  while (r.world.fogFade.size > 0) {
    f = tick(r);
    assert.equal(f.fog.maskPuts, last + 1, 'redrawn this frame');
    if (r.world.fogFade.size > 0) assert.notDeepEqual(f.fog.mask.data, lastMask, 'and thinner than the last');
    last = f.fog.maskPuts; lastMask = f.fog.mask.data; frames++;
  }
  assert.ok(frames >= 60, `the peel ran ${frames} frames`);
  const dens = densityOf(r);
  assert.ok(dens.every((d, i) => Math.abs(1 - f.fog.mask.data[i * 4 + 3] / 255 - d) <= 0.5 / 255 + 1e-9), 'the last mask is the cleared fog');
  for (let i = 0; i < 30; i++) f = tick(r);
  assert.equal(f.fog.maskPuts, last, 'nothing changes after');
});

test('harbor view in Node: you and the people are drawn between their last two ticks, each hopping in their own time', () => {
  const r = hubRig({ levels: { lamp_post: 5, library: 5, tavern: 5 } });
  const look = r.tuning.look;
  for (let i = 0; i < 30; i++) stepHub(r.world, EMPTY_FRAME, DT);
  const p = r.world.player;
  p.px = p.x - 6; p.py = p.y + 4; p.moving = false; p.facing = -1;
  r.frame(0.25);
  const you = r.find('you');
  assert.equal(you.x, Math.round(p.px + (p.x - p.px) * 0.25));
  assert.equal(you.y, Math.round(p.py + (p.y - p.py) * 0.25));
  assert.equal(you.scale.x, -1);
  assert.equal(you.zIndex, p.py + (p.y - p.py) * 0.25, 'sorted by where your feet are, between ticks too');
  const walking = r.world.people.filter((q) => q.moving && (q.px !== q.x || q.py !== q.y));
  assert.ok(walking.length >= 1, 'a keeper is out walking');
  for (const [i, person] of r.world.people.entries()) { person.px = person.x - 7 - i; person.py = person.y + 5; if (i === 0) person.facing = -1; }
  r.frame(0.25);
  for (const person of r.world.people) {
    const s = r.find(`person:${person.id}`);
    const [x, y] = drawnAt(person, 0.25);
    const hop = stepHop(!!person.moving, r.world.time + hopPhase(person.id, look.hopStepsPerSec), look.hopStepsPerSec);
    assert.deepEqual([s.x, s.y, s.zIndex, s.scale.x], [Math.round(x), Math.round(y) - hop, y, person.facing < 0 ? -1 : 1], person.id);
    assert.equal(s.alpha, 1, `${person.id} was there from the start`);
  }
  // A keeper stepping out as a level lands fades in over popSec.
  const k = hubRig({ profile: rich({ lamp_post: 5, tavern: 3 }) });
  k.frame();
  buy(k, 'tavern');
  until(k, (w) => w.people.some((q) => q.id === 'innkeeper'), 'the innkeeper steps out');
  const inn = k.find('person:innkeeper');
  assert.equal(inn.alpha, 0, 'not there yet');
  for (let i = 0; i < 6; i++) tick(k);
  assert.ok(Math.abs(inn.alpha - (6 * DT) / look.popSec) < 1e-9, 'coming in');
  for (let i = 0; i < 60; i++) tick(k);
  assert.equal(inn.alpha, 1, 'then there');
  // Walking, you hop.
  p.moving = true;
  const hops = new Set();
  for (let i = 0; i < 12; i++) { r.world.time += DT; r.frame(1); hops.add(p.y - r.find('you').y); }
  assert.ok(hops.size === 2 && hops.has(0), 'a pixel\'s hop, on and off');
});

test('harbor view in Node: each thing shows its own picture, stood on its tile or its feet, sorted where it should be', () => {
  const r = hubRig({ levels: { lamp_post: 4, library: 5, tavern: 5 } });
  tick(r);
  /** A sprite's drawn box in world px (its frame, placed by its anchor and scale). */
  const box = (s) => {
    const f = s.texture.frame, sx = Math.abs(s.scale.x), sy = s.scale.y;
    const left = s.x - s.anchor.x * f.width * sx, top = s.y - s.anchor.y * f.height * sy;
    return { left, top, right: left + f.width * sx, bottom: top + f.height * sy };
  };
  // You and everyone out: their own pictures, each stood on its feet (the frame's foot room below them).
  const standsOn = (s, sprite, what) => {
    assert.equal(s.texture, r.atlas.tex(sprite), `${what}: ${sprite}`);
    const b = box(s);
    assert.ok(Math.abs((b.left + b.right) / 2 - s.x) < 1e-9 && Math.abs(b.bottom - PLAYER_FEET_ROOM - s.y) < 1e-9, `${what}: its feet where it stands`);
  };
  standsOn(r.find('you'), DATA.characters.find((c) => c.id === HUB.avatar).sprite, 'you');
  assert.ok(new Set(r.world.people.map((p) => p.sprite)).size >= 3, 'several different people out');
  for (const person of r.world.people) standsOn(r.find(`person:${person.id}`), person.sprite, person.id);
  // Props: their own pictures, each standing on its tile (its middle, its bottom edge), sorted by it.
  assert.ok(new Set(r.world.props.map((p) => p.sprite)).size >= 3, 'several different props out');
  for (const pr of r.world.props) {
    const s = r.find(`prop:${pr.id}`), b = box(s);
    assert.equal(s.texture, r.atlas.tex(pr.sprite), `${pr.id}: ${pr.sprite}`);
    assert.deepEqual([(b.left + b.right) / 2, b.bottom, s.zIndex], [pr.at[0] * 16 + 8, (pr.at[1] + 1) * 16, (pr.at[1] + 1) * 16], `${pr.id} on its tile ${pr.at}`);
  }
  // A building's stages sort by its front edge: the old stage under the new, the scaffold over both.
  for (const p of HUB.plots) {
    const [lower, upper, scaffold] = ['stage-below', 'stage', 'scaffold'].map((k) => r.find(`${k}:${p.building}`));
    assert.ok(lower.zIndex < upper.zIndex && upper.zIndex < scaffold.zIndex, `${p.building}: the old stage, the new, then the scaffold`);
    for (const s of [lower, upper, scaffold]) assert.ok(Math.abs(s.zIndex - (p.y + p.h) * 16) < 0.5, `${p.building}: sorted by its front edge`);
  }
  // A building fills its plot; the town lamp stands on the middle of its tile.
  for (const p of HUB.plots) {
    const b = box(r.find(`stage:${p.building}`));
    if (p.building === 'lamp_post') assert.deepEqual([(b.left + b.right) / 2, b.bottom], [p.x * 16 + 8, (p.y + 1) * 16], 'the lamp on its tile');
    else assert.deepEqual([b.left, b.top, b.right, b.bottom], [p.x * 16, p.y * 16, (p.x + p.w) * 16, (p.y + p.h) * 16], `${p.building} on its plot`);
  }
  // The prompts' place: a world point in the view, from the camera the frame drew with.
  const cam = r.renderer.camera;
  assert.deepEqual(r.view.toView(cam.x, cam.y), { x: 320, y: 180 }, 'the camera\'s point is the view\'s middle');
  assert.deepEqual(r.view.toView(cam.x - 100, cam.y + 40), { x: 220, y: 220 });
  // The town lamp rising (a level of the Lamp Post) is masked where the lamp stands, not as a building's plot.
  const l = hubRig({ profile: rich({ lamp_post: 1 }) });
  l.frame();
  buy(l, 'lamp_post');
  until(l, (w) => w.timeline?.build > 0.5, 'the lamp half up');
  const lamp = l.find('stage:lamp_post'), mask = l.find('rise-mask:lamp_post'), k = l.world.timeline.build;
  assert.equal(lamp.mask, mask);
  const b = box(lamp), m = mask.bounds;
  const want = [b.left - 1, b.top + (b.bottom - b.top) * (1 - k) - 1, b.right + 1, b.bottom + 1];
  [m.minX, m.minY, m.maxX, m.maxY].forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-6, `the lamp shown from its foot up to the build: ${[m.minX, m.minY, m.maxX, m.maxY]}, not ${want}`));
});

test('harbor view in Node: every light goes into the light map where harborLights puts it, flickering unless steady', () => {
  const r = hubRig({ levels: { lamp_post: 3, library: 4, tavern: 3 } });
  const look = r.tuning.look;
  const f = r.frame(1, 40);
  const lights = harborLights({ hub: HUB, levels: levelsOf(r.doc, DATA), look, you: { x: r.world.player.x, y: r.world.player.y }, arrival: null });
  const flick = flickerAt(r.view.now, look);
  assert.notEqual(flick, 1, 'a moment the lamps are wavering');
  assert.equal(f.light.lights.length, lights.length);
  const origin = r.find('light');
  lights.forEach((L, i) => {
    const s = f.light.lights[i];
    assert.deepEqual([s.x * 2 + origin.x, s.y * 2 + origin.y], [L.x, L.y], `light ${i} where it is`);
    assert.equal(s.sx, (L.r * (L.steady ? 1 : flick)) / 64, `light ${i}'s reach`);
    assert.equal(s.tint, L.color, `light ${i}'s color`);
    assert.equal(s.alpha, Math.min(1, Math.max(0, L.alpha)), `light ${i}'s brightness`);
  });
  assert.deepEqual(f.light.clearColor, [...ambientLight(look), 1], 'the night where no light reaches');
  // Your lantern goes with you between ticks.
  const p = r.world.player;
  p.px = p.x - 10; p.py = p.y - 6;
  const g0 = r.frame(0.5);
  const lantern = g0.light.lights[2];
  assert.deepEqual([lantern.x * 2 + origin.x, lantern.y * 2 + origin.y], [p.px + 5, p.py + 3 - ANCHORS.middle], 'at your middle, halfway between your last two ticks');
  assert.equal(lantern.sx, (look.lanternReach * flickerAt(r.view.now, look)) / 64);
  // Through a ceremony the new windows come up with the build.
  const c = hubRig({ profile: rich({ lamp_post: 5, library: 2 }) });
  c.frame();
  buy(c, 'library');
  const g = until(c, (w) => w.timeline?.build > 0.4, 'the Library is half built');
  const tl = c.world.timeline;
  const windows = g.light.lights.filter((s) => s.tint === lookColor(look.windowColor));
  assert.equal(windows.length, HUB.plots.find((p) => p.building === 'library').windows.length);
  assert.ok(windows.every((s) => Math.abs(s.alpha - look.windowLight * tl.build) < 1e-9), 'coming up with the build');
});

test('harbor view in Node: a new stage rises over the old behind a mask, and the mask goes when it\'s up', () => {
  const r = hubRig({ profile: rich({ lamp_post: 5, library: 2 }) });
  r.frame();
  buy(r, 'library');
  tick(r);
  assert.ok(!r.find('stage:library').visible && r.find('stage-below:library').visible, 'before the build, the old stage alone');
  const puffs = r.find('puffs').children[0].context.instructions;
  assert.equal(puffs.length, 0, 'no dust before the build');
  const random = Math.random;
  Math.random = () => 0;   // a puff every frame, at the stage's left end
  try { until(r, (w) => w.timeline?.build > 0.5, 'the build is past half'); } finally { Math.random = random; }
  assert.ok(r.find('puffs').children[0].context.instructions.length > 0, 'dust along the rising line');
  const tl = r.world.timeline;
  const plot = HUB.plots.find((p) => p.building === 'library');
  const upper = r.find('stage:library'), lower = r.find('stage-below:library'), mask = r.find('rise-mask:library');
  const d = buildingDraw('library', 3, tl, r.tuning.look);
  assert.equal(upper.texture, r.atlas.tex(d.upper));
  assert.equal(lower.texture, r.atlas.tex(d.lower));
  assert.ok(lower.visible && upper.visible && mask.visible);
  assert.equal(upper.mask, mask, 'the new stage is masked');
  const h = upper.texture.frame.height, top = plot.y * 16, edge = top + h * (1 - tl.build);
  const b = mask.bounds;
  const want = [plot.x * 16 - 1, edge - 1, plot.x * 16 + upper.texture.frame.width + 1, top + h + 1];
  [b.minX, b.minY, b.maxX, b.maxY].forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-6, `shown from the ground up to the build: ${[b.minX, b.minY, b.maxX, b.maxY]}, not ${want}`));
  until(r, (w) => w.timeline?.built, 'the build is done');
  r.frame();
  assert.ok(!upper.mask && !mask.visible && !lower.visible, 'then the new stage alone, whole');
  // A first level: the scaffold rises into place over the ruin and firms up, and stays.
  const s = hubRig({ profile: rich({ lamp_post: 5, library: 0 }) });
  s.frame();
  const scaffold = s.find('scaffold:library');
  assert.equal(scaffold.visible, false, 'no scaffold on a ruin');
  buy(s, 'library');
  until(s, (w) => w.timeline?.build > 0.3, 'going up');
  const k = s.world.timeline.build;
  assert.ok(scaffold.visible);
  // Its frame is its drawing (the plot's size) and the outline a pixel round it: the drawing on the plot.
  const sf = scaffold.texture.frame;
  assert.deepEqual([sf.width - plot.w * 16, sf.height - plot.h * 16], [2, 2], 'the plot, and a pixel of outline a side');
  assert.deepEqual([scaffold.x, scaffold.y], [plot.x * 16 - 1, plot.y * 16 - 1 + Math.round((1 - k) * s.tuning.look.scaffoldDrop)], 'rising into place');
  assert.equal(scaffold.alpha, Math.min(1, k * 2), 'firming up');
  until(s, (w) => w.timeline === null, 'done');
  s.frame();
  assert.deepEqual([scaffold.visible, scaffold.x, scaffold.y, scaffold.alpha], [true, plot.x * 16 - 1, plot.y * 16 - 1, 1], 'in place at level 1');
  assert.equal(s.find('stage:library').texture, s.atlas.tex('bld_library_ruin'), 'over the ruin');
  // The last level's chimney smokes once its stage is up, not from the moment it's bought.
  const k5 = hubRig({ profile: rich({ lamp_post: 5, library: 4 }) });
  k5.frame();
  const smoke = () => k5.find('puffs').children[0].context.instructions.length;
  buy(k5, 'library');
  let smokedEarly = false;
  const draw = Math.random;
  Math.random = () => 0.99;   // no dust (a puff only when the draw is under dt x perSec)
  try {
    while (!k5.world.timeline.built) { tick(k5); if (smoke() > 0 && !k5.world.timeline.built) smokedEarly = true; }
    assert.equal(smokedEarly, false, 'no smoke while level 5 goes up');
    for (let i = 0; i < 10; i++) tick(k5);
    assert.ok(smoke() > 0, 'smoke once it\'s up');
  } finally { Math.random = draw; }
});

test('harbor view in Node: an arrival, from the boat out in the fog to her place on the square', () => {
  const r = hubRig({ levels: { lamp_post: 1 } });
  const look = r.tuning.look;
  r.frame();
  startArrival(r.world, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: HUB.waiting[0] });
  // Sailing: the boat, its halo, and the newcomer standing in it, cut at the gunwale.
  until(r, (w) => w.timeline?.phase === 'sail' && w.timeline.phaseT > 1, 'sailing');
  const now = () => arrivalLook(r.world.timeline, 1, fogAtFor(r), HUB.harbor, look, boatBobAt(r.view.now, look));
  let a = now();
  const boat = r.find('boat'), passenger = r.find('passenger'), halo = r.find('boat-halo'), stepping = r.find('stepping-off'), walker = r.find('walker');
  assert.ok(r.find('boat-layer').visible);
  const lights = (arrival) => harborLights({ hub: HUB, levels: levelsOf(r.doc, DATA), look, you: { x: r.world.player.x, y: r.world.player.y }, arrival });
  assert.deepEqual([boat.x, boat.y, boat.tint], [a.draw.x, a.draw.y, boatTint(a, lights(a), fogAtFor(r), look, flickerAt(r.view.now, look))], 'lit as the light map would light it (its shade in the fog)');
  assert.deepEqual([halo.x, halo.y, halo.alpha, halo.tint], [Math.round(a.halo.x), Math.round(a.halo.y), a.glow, lookColor(look.lampColor)]);
  assert.equal(halo.scale.x, look.boatHaloReach / 32, 'the halo reaches boatHaloReach');
  const rect = r.atlas.rect('pc_harpooner');
  assert.ok(passenger.visible && !stepping.visible && !walker.visible);
  const pf = passenger.texture.frame;
  assert.deepEqual([pf.x, pf.y, pf.width, pf.height], [rect.x, rect.y, rect.w, rect.h - PLAYER_FEET_ROOM - ANCHORS.cut], 'her own picture, cut off at the knees');
  assert.deepEqual([passenger.anchor.x, passenger.anchor.y], [0.5, 1]);
  assert.deepEqual([passenger.x, passenger.y], [Math.round(a.passenger.x), Math.round(a.passenger.y)]);
  assert.equal(passenger.tint, newcomerTint(a, lights(a), fogAtFor(r), look, flickerAt(r.view.now, look)), 'lit as the light map would light her');
  // The step off: over the boat while she's in front of it, her shade carrying straight on.
  let shade = passenger.tint;
  for (let i = 0; r.world.timeline.phase === 'sail'; i++) { assert.ok(i < 60 * 30, 'the boat lands'); shade = passenger.tint; tick(r); }
  a = now();
  assert.ok(stepping.visible && walker.visible && !passenger.visible, 'stepping off: over the boat, and under the light map beneath');
  assert.equal(stepping.alpha, 1, 'whole while she\'s in front of it');
  // The hull from the gunwale down is drawn again over her: her feet hidden where it's in front of them.
  const hull = r.find('boat-hull'), boatRect = r.atlas.rect('hub_boat');
  assert.deepEqual(r.find('boat-layer').children.map((c) => c.label), ['boat', 'passenger', 'stepping-off', 'boat-hull', 'boat-halo']);
  assert.deepEqual([hull.x, hull.y, hull.tint, hull.anchor.x, hull.anchor.y], [boat.x, boat.y, boat.tint, 0.5, 1]);
  const hf = hull.texture.frame;
  assert.deepEqual([hf.x, hf.y, hf.width, hf.height], [boatRect.x, boatRect.y + boatRect.h - ANCHORS.gunwale, boatRect.w, ANCHORS.gunwale], 'the boat\'s frame from its gunwale down');
  assert.equal(boat.y - ANCHORS.gunwale, Math.round(a.walker.y) - ANCHORS.cut, 'which is where she was cut standing in it');
  assert.deepEqual([stepping.x, stepping.y], [Math.round(a.walker.x), Math.round(a.walker.y) - stepHop(a.walker.moving, r.world.time, look.hopStepsPerSec)]);
  assert.deepEqual([stepping.zIndex, stepping.scale.x], [a.walker.y, a.walker.facing < 0 ? -1 : 1]);
  assert.deepEqual([a.walker.x, a.walker.y], [a.boat.x + HUB.harbor.aboard, a.boat.y + HUB.harbor.deck], 'from the deck she stood on');
  const channels = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const close = (x, y, what) => channels(x).forEach((v, i) => assert.ok(Math.abs(v - channels(y)[i]) <= 8, `${what}: ${channels(x)} then ${channels(y)}`));
  close(shade, stepping.tint, 'no jump in her shade at the step');
  // Walking clear, her figure over the boat fades out over stepOffFade px, the one under the light
  // map (lit as she was over it) showing through, in the same place.
  const size = { w: rect.w, h: rect.h }, boatSize = { w: boat.texture.frame.width, h: boat.texture.frame.height };
  const fades = [];
  for (let i = 0; stepping.visible && i < 120; i++) {
    a = now();
    const clear = clearOfBoat(a.walker, a.draw, size, PLAYER_FEET_ROOM, boatSize);
    assert.equal(stepping.alpha, steppingAlpha(clear, look.stepOffFade));
    assert.deepEqual([stepping.x, stepping.y, stepping.scale.x, stepping.texture], [walker.x, walker.y, walker.scale.x, walker.texture], 'the two in step');
    fades.push(stepping.alpha);
    shade = stepping.tint;
    tick(r);
  }
  assert.ok(fades.length >= 12 && fades.length < 90, `over the boat for ${fades.length} frames`);
  assert.ok(fades.every((v, i) => i === 0 || v <= fades[i - 1]) && fades.some((v) => v > 0 && v < 1), 'fading out, never back');
  assert.ok(walker.visible && !stepping.visible);
  a = now();
  assert.ok(clearOfBoat(a.walker, a.draw, size, PLAYER_FEET_ROOM, boatSize) >= look.stepOffFade, 'clear of it by the fade\'s length');
  assert.deepEqual([walker.x, walker.y, walker.zIndex, walker.scale.x], [Math.round(a.walker.x), Math.round(a.walker.y) - stepHop(a.walker.moving, r.world.time, look.hopStepsPerSec), a.walker.y, a.walker.facing < 0 ? -1 : 1], 'walking up, between ticks');
  assert.equal(walker.texture, r.atlas.tex('pc_harpooner'), 'whole');
  const lit = lightAt(a.walker.x, a.walker.y - ANCHORS.middle, lights(a), look, flickerAt(r.view.now, look)).map((v) => Math.round(v * 255));
  close(shade, (lit[0] << 16) | (lit[1] << 8) | lit[2], 'the light map lights her as she was lit');
  // She turns to face the way she walks.
  until(r, (w) => w.timeline?.walker.facing < 0, 'she turns west along the square');
  assert.equal(walker.scale.x, -1);
  // At her place, her waiting figure takes over on the same tick; the boat stays for the pan out.
  until(r, (w) => w.timeline?.phase === 'panOut', 'she\'s at her place');
  const her = r.find('person:harpooner');
  assert.ok(her && her.visible && her.alpha === 1, 'there, not fading in');
  assert.ok(!walker.visible && !stepping.visible && !passenger.visible, 'and only once');
  assert.equal(r.find('boat-halo').alpha, 0, 'the lantern out as the camera heads back');
  until(r, (w) => w.timeline === null, 'the arrival is over');
  const after = r.frame();
  assert.equal(r.find('boat-layer').visible, false);
  assert.equal(after.light.lights.length, lights(null).length, 'no light left on where the boat\'s lantern was');
  // Gone with the harbor, the atlas's own textures stay for the run.
  r.view.destroy();
  assert.ok(!r.atlas.source.destroyed && !r.atlas.glow.source.destroyed && !r.atlas.fog.source.destroyed);
  assert.equal(r.renderer.world.children.length, 0);
});

test('harbor view in Node: every light sits on the glass its drawing has, where the view stands each thing', async () => {
  const { decodePng } = await import('../tools/atlas/png.mjs');
  const page = decodePng(readFileSync(new URL('../src/assets/atlas.png', import.meta.url)));
  const rgb = (name) => [1, 3, 5].map((i) => parseInt(PALETTE[name].slice(i, i + 2), 16));
  const GLASS = [rgb('lamp-5'), rgb('lamp-6')];   // a lit lantern's glass
  const PANES = [rgb('lamp-5'), rgb('lamp-4')];   // a lit window's (art/draw/hub.js lightWindows)
  /** The middle of the lit glass a sprite shows (within `box`, frame px), in world px. */
  const glassOf = (s, box = null, colors = GLASS) => {
    const f = s.texture.frame;
    const left = s.x - s.anchor.x * f.width, top = s.y - s.anchor.y * f.height;
    const pts = [];
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      if (box && (x < box[0] || y < box[1] || x >= box[0] + box[2] || y >= box[1] + box[3])) continue;
      const o = ((f.y + y) * page.width + f.x + x) * 4;
      if (page.rgba[o + 3] >= 128 && colors.some(([rr, g, b]) => page.rgba[o] === rr && page.rgba[o + 1] === g && page.rgba[o + 2] === b)) pts.push([x + 0.5, y + 0.5]);
    }
    assert.ok(pts.length > 0, `${s.label} shows lit glass`);
    return [left + pts.reduce((t, p) => t + p[0], 0) / pts.length, top + pts.reduce((t, p) => t + p[1], 0) / pts.length];
  };
  const r = hubRig({ levels: { lamp_post: 1, library: 4, tavern: 3 } });
  const look = r.tuning.look;
  startArrival(r.world, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: HUB.waiting[0] });
  const f = until(r, (w) => w.timeline?.phase === 'sail', 'a boat out');
  const origin = r.find('light');
  const world = (s) => [s.x * 2 + origin.x, s.y * 2 + origin.y];
  const pool = f.light.lights.map((s) => ({ at: world(s), r: s.sx * 64, tint: s.tint }));
  const nearest = (xy, r0) => pool.filter((l) => Math.abs(l.r - r0) < 4).sort((p, q) => Math.hypot(p.at[0] - xy[0], p.at[1] - xy[1]) - Math.hypot(q.at[0] - xy[0], q.at[1] - xy[1]))[0];
  const on = (s, reach, what, box, colors) => {
    const glass = glassOf(s, box, colors);
    const l = nearest(glass, reach);
    assert.ok(l && Math.abs(l.at[0] - glass[0]) <= 1 && Math.abs(l.at[1] - glass[1]) <= 1, `${what}: light at ${l?.at}, glass at ${glass}`);
  };
  const flick = flickerAt(r.view.now, look);
  on(r.find('stage:lamp_post'), lampRadius(1, look) * flick, 'the town lamp');
  on(r.find('small-lamp:gate'), look.smallLampReach * flick, 'the gate\'s lamp');
  on(r.find('small-lamp:pier'), look.smallLampReach * flick, 'the pier\'s lamp');
  on(r.find('boat'), look.boatLanternReach * flick, 'the boat\'s lantern');
  const lib = HUB.plots.find((p) => p.building === 'library');
  const dx = lib.door[0] - lib.x, dy = lib.door[1] - 1 - lib.y;
  on(r.find('stage:library'), look.doorReach * flick, 'the Library\'s door lantern', [dx * 16 + 10, dy * 16 - 2, 10, 12]);
  // Every lit window: its light on the middle of its panes (the glass of its tile, x 5 to 10, y 5 to 10).
  for (const b of ['library', 'tavern']) {
    for (const [wx, wy] of HUB.plots.find((p) => p.building === b).windows) on(r.find(`stage:${b}`), look.windowReach, `the ${b}'s window at ${wx}, ${wy}`, [wx * 16 + 5, wy * 16 + 5, 6, 6], PANES);
  }
});

test('harbor view in Node: the look is read live (the camera\'s lift, a prop\'s pop, the puffs)', () => {
  const r = hubRig({ profile: rich({ lamp_post: 5, library: 5, tavern: 4 }) });
  const look = r.tuning.look;
  r.frame();
  // The sea swells a frame at a time and drifts east; the wisps drift at their own speed.
  const sea = r.find('sea');
  const frames = [];
  let f;
  for (let i = 0; i < 60; i++) { f = r.frame(1, MS); frames.push([r.view.now, sea.texture, sea.tilePosition.x, f.fog.wisps.tx - f.fog.clear.x]); }
  const firstSwell = frames.findIndex(([ms]) => ms >= look.waterFrameMs);
  assert.ok(frames.slice(0, firstSwell).every(([, t]) => t === frames[0][1]) && frames[firstSwell][1] !== frames[0][1], 'a new swell every waterFrameMs');
  assert.ok(frames.every(([ms, , x]) => x === Math.floor(ms / look.waterDriftMs) % 64), 'a pixel east every waterDriftMs');
  assert.ok(frames.every(([ms, , , wx]) => Math.abs(wx - (ms / 1000) * look.wispDriftX) < 1e-9), 'the wisps drift at wispDriftX');
  look.wisps = 0.55;
  assert.equal(r.frame().fog.wisps.alpha, 0.55, 'the wisps\' strength');
  const at = () => cameraAt(r.world, 1);
  look.cameraLift = 30;
  r.frame();
  const W = HUB.map[0].length * 16, H = HUB.map.length * 16;
  assert.equal(r.renderer.camera.y, clampCamera(at()[0], at()[1] - 30, W, H, 640, 360)[1]);
  // A look swapped whole (not only changed in place) is read too.
  r.tuning.look = { ...look, cameraLift: 12 };
  r.frame();
  assert.equal(r.renderer.camera.y, clampCamera(at()[0], at()[1] - 12, W, H, 640, 360)[1]);
  r.tuning.look = look;
  // A prop appearing swells past its size by popOvershoot, then settles; with 0 it never passes 1.
  const prop = r.world.props[0];
  const others = r.world.props.filter((p) => p !== prop);
  const scales = (c) => {
    look.popOvershoot = c;
    setProps(r.world, others);
    r.frame();
    assert.equal(r.find(`prop:${prop.id}`), null, 'gone');
    setProps(r.world, [...others, prop]);
    const out = [];
    for (let i = 0; i < 40; i++) { r.world.time += DT; r.frame(); out.push(r.find(`prop:${prop.id}`).scale.x); }
    return out;
  };
  const swell = scales(1.7), none = scales(0);
  const u = (t) => t - 1, ease = (t, c) => 1 + (c + 1) * u(t) ** 3 + c * u(t) ** 2;
  assert.ok(Math.max(...swell) > 1.05 && swell[swell.length - 1] === 1, 'past its size, then settled');
  assert.ok(Math.abs(swell[4] - ease(4 * DT / look.popSec, 1.7)) < 1e-9, 'easing out past its size');
  assert.ok(none.every((s) => s <= 1), 'no swell at 0');
  // The Library's chimney smokes (it's fully alive); with no puffs allowed, nothing is drawn.
  const drawn = () => r.find('puffs').children[0].context.instructions.length;
  for (let i = 0; i < 90; i++) tick(r);
  assert.ok(drawn() > 0, 'smoke');
  look.puffs.max = 0;
  for (let i = 0; i < 60 * 3; i++) tick(r);
  assert.equal(drawn(), 0, 'nothing drawn');
});

/** Every number in the scene and in what it rendered is a number (not NaN, not infinite). */
function brokenIn(r, f) {
  const bad = [];
  const walk = (n, path) => {
    for (const [k, v] of [['x', n.x], ['y', n.y], ['scale.x', n.scale.x], ['scale.y', n.scale.y], ['alpha', n.alpha], ['tint', n.tint]]) if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${path}.${k}`);
    if (n.visible && n.texture === Texture.EMPTY) bad.push(`${path}: shown with no picture`);
    if (!Number.isFinite(n.zIndex)) bad.push(`${path}.zIndex`);
    n.children.forEach((c, i) => walk(c, `${path}/${c.label || i}`));
  };
  walk(r.find('harbor'), 'harbor');
  for (const s of f.light.lights) for (const [k, v] of Object.entries(s)) if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`light.${k}`);
  for (const v of [...f.light.clearColor, f.fog.fill.alpha, f.fog.wisps.alpha, f.fog.clear.x, r.renderer.camera.x, r.renderer.camera.y]) if (!Number.isFinite(v)) bad.push('fog or camera');
  const sea = r.find('sea');
  for (const v of [sea.tilePosition.x, sea.tilePosition.y, f.fog.wisps.tx, f.fog.wisps.ty]) if (!Number.isFinite(v)) bad.push('the sea\'s or the wisps\' drift');
  return bad;
}

test('harbor view in Node: every harbor number at the edges of its range draws a whole ceremony and arrival with nothing broken', () => {
  const numbers = flattenTuning(DATA.hubTuning).filter((n) => typeof n.value === 'number');
  const rangeOf = (path) => path.split('.').reduce((o, k) => o?.[k], HUB_TUNING_RANGE);
  // What must stay above 0 goes to a thousandth at the low edge (a speed, the other way: a thousand,
  // so the set pieces still end) and to a million at the high edge where it only paces the look (a
  // period, a pop); the set pieces' own times and speeds stay put there, so they end in the test.
  const SPEEDS = ['timing.boatSpeed', 'timing.walkSpeed', 'timing.arriveSpeed', 'look.hopStepsPerSec'];
  const SET_PIECE = ['timing.panIn', 'timing.build', 'timing.fogPeel', 'timing.panOut'];
  const above0 = (n, low) => (low ? (SPEEDS.includes(n.path) ? 1e3 : 1e-3) : SPEEDS.includes(n.path) || SET_PIECE.includes(n.path) ? n.value : 1e6);
  const edges = {
    low: (n) => ({ above0: above0(n, true), min0: 0, unit: 0, any: -Math.abs(n.value) - 1 })[rangeOf(n.path)],
    high: (n) => ({ above0: above0(n, false), min0: n.value * 4, unit: 1, any: Math.abs(n.value) * 4 + 1 })[rangeOf(n.path)],
  };
  for (const [edge, value] of Object.entries(edges)) {
    const tuning = createHubTuning();
    for (const n of numbers) {
      const keys = n.path.split('.'), last = keys.pop();
      keys.reduce((o, k) => o[k], tuning)[last] = value(n);
    }
    // The Lamp Post's level 4 brings a prop (it pops in) and its keeper (who fades in) with the build.
    const r = hubRig({ profile: rich({ lamp_post: 3, library: 5, tavern: 5 }), tuning });
    r.frame();
    const keepers = r.world.people.filter((p) => p.loop);
    const from = keepers.map((p) => [p.x, p.y]);
    const walked = keepers.map(() => false);
    buy(r, 'lamp_post');
    startArrival(r.world, { id: 'harpooner', sprite: 'pc_harpooner', waitAt: HUB.waiting[0] });
    let frames = 0;
    for (; r.world.timeline && frames < 60 * 60; frames++) {
      const f = tick(r);
      const bad = brokenIn(r, f);
      assert.deepEqual(bad, [], `${edge}: frame ${frames}`);
    }
    assert.equal(r.world.timeline, null, `${edge}: the ceremony and the arrival both end (${frames} frames)`);
    assert.ok(r.find('prop:square_cart') && r.find('person:lamp_keeper'), `${edge}: the level\'s prop and keeper came out`);
    for (let i = 0; i < 60 * 8; i++) {
      assert.deepEqual(brokenIn(r, tick(r)), [], `${edge}: after, frame ${i}`);
      keepers.forEach((p, k) => { if (p.x !== from[k][0] || p.y !== from[k][1]) walked[k] = true; });
    }
    assert.ok(walked.every(Boolean), `${edge}: the keepers walk`);
  }
});
