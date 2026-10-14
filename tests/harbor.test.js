// The harbor's presentation, without a browser (ARCHITECTURE §10.4): which frame goes on each tile,
// a building's look and lights at each level, the camera's limits, the fog's density, what the
// panels and the results screen say, and what a purchase plays out as.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { HUB_TERRAIN } from '../src/data/hub.js';
import { defaultProfile } from '../src/save/schema.js';
import { buildHubMap, clearTiles } from '../src/hub/map.js';
import {
  groundFrame, objectFrame, pathPiece, stageFrames, lampRadius, plotLights, clampCamera, fogDensity, hubTileFrames, buildingDraw, lightsNow, lampLight, boatShade,
  FOG_FRAY, FOG_CREEP, harborLights, cameraAt, arrivalLook, appearsAt, hopPhase, LIGHT_SPOTS, lookColor, ambientLight,
  ANCHORS, drawnAt, flickerAt, boatBobAt, fogAtPoint, fogPixels, fogRedraw, lightAt, newcomerTint, boatTint, clearOfBoat, steppingAlpha,
} from '../src/render/hubtiles.js';
import { stepHop } from '../src/render/viewstate.js';
import { levelEffects, costText, changeLines, optionText, researchState, upgradeState, runsText, buildingIn } from '../src/ui/hubtext.js';
import { waitingReason } from '../src/meta/apply.js';
import { levelsOf, levelSetPieces, lineFor, promptFor, runHeading, titleStartLabel, mergeRuns } from '../src/app/hublogic.js';
import { restoreBuilding, applyRunResult, nextAffordable, revealedFog, startResearch, whyNotResearch, whyNotUpgrade } from '../src/meta/index.js';

const HUB = DATA.hub;
const table = JSON.parse(readFileSync(new URL('../src/assets/atlas.json', import.meta.url), 'utf8'));
const has = (id) => Object.prototype.hasOwnProperty.call(table.frames, id);
function profile(levels = {}, mats = {}) { const d = defaultProfile(); Object.assign(d.profile.buildings, levels); Object.assign(d.profile.materials, mats); return d; }
const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 9999]));

test('harbor tiles: every ground tile and object has a frame on the atlas page', () => {
  const used = new Set();
  for (let y = 0; y < HUB.map.length; y++) for (let x = 0; x < HUB.map[0].length; x++) {
    const g = groundFrame(HUB, x, y);
    if (g) used.add(g); else assert.equal(HUB.map[y][x], '~', 'only the sea has no ground frame');
    const o = objectFrame(HUB, x, y);
    if (o) used.add(o);
  }
  for (const id of used) assert.ok(has(id), `frame ${id}`);
  for (const id of hubTileFrames()) assert.ok(has(id), `frame ${id}`);
  // Every building's stage at every level, the props, the townsfolk, and the boat and scaffold.
  for (const p of HUB.plots) for (let lv = 0; lv <= 5; lv++) assert.ok(has(stageFrames(p.building, lv).frame), `${p.building} at level ${lv}`);
  for (const r of HUB.ruins) assert.ok(has(`bld_${r.id}_ruin`), r.id);
  for (const p of HUB.props) assert.ok(has(p.sprite), p.sprite);
  for (const n of DATA.npcs) assert.ok(has(n.sprite), n.sprite);
  for (const id of ['hub_boat', 'hub_scaffold_5x4', 'prop_lamppost', 'hub_lamp', 'hub_lamp_dim']) assert.ok(has(id), id);
  // And every frame the hub view names in its code.
  const src = readFileSync(new URL('../src/render/hubview.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bT\('([^'$]+)'\)/g)) assert.ok(has(m[1]), `hubview names ${m[1]}`);
});

test('harbor tiles: dirt paths get their grass edges from their neighbors', () => {
  const hub = { map: [
    '......',
    '.::::.',
    '.::::.',
    '.::oo.',
    '......',
  ] };
  assert.equal(pathPiece(hub, 1, 1), 'nw');
  assert.equal(pathPiece(hub, 2, 1), 'n');
  assert.equal(pathPiece(hub, 4, 1), 'ne');
  assert.equal(pathPiece(hub, 1, 2), 'w');
  assert.equal(pathPiece(hub, 2, 2), 'c', 'paved all round (the cobbles count as paved)');
  assert.equal(pathPiece(hub, 1, 3), 'sw');
  assert.equal(pathPiece(hub, 2, 3), 's');
  // Inside corners: paved on all four sides, grass on one diagonal.
  const inner = { map: ['.:::', '::::', '::::'] };
  assert.equal(pathPiece(inner, 1, 1), 'in_nw');
  // A path one tile wide has no piece with grass on both sides: it stays plain.
  const thin = { map: ['.:.', '.:.', '.:.'] };
  assert.equal(pathPiece(thin, 1, 1), 'c');
  // Fences join their neighbors; a lone post stands alone.
  const f = { map: ['ffff.f'] };
  assert.deepEqual([0, 1, 3, 5].map((x) => objectFrame(f, x, 0)), ['hub_fence_l', 'hub_fence_m', 'hub_fence_r', 'hub_fence_post']);
  // The pier: its west and east halves, with pilings every other row.
  const [px, py] = HUB.harbor.landing;
  assert.match(groundFrame(HUB, px, py), /^hub_pier_l/);
  assert.match(groundFrame(HUB, px + 1, py), /^hub_pier_r/);
});

test('harbor looks: stages by level, the lamp\'s reach, windows and door lanterns once lit', () => {
  assert.deepEqual(stageFrames('library', 0), { frame: 'bld_library_ruin', scaffold: false });
  assert.deepEqual(stageFrames('library', 1), { frame: 'bld_library_ruin', scaffold: true }, 'the first level puts up a scaffold');
  assert.deepEqual(stageFrames('tavern', 2), { frame: 'bld_tavern_roof', scaffold: false });
  assert.equal(stageFrames('tavern', 5).frame, 'bld_tavern_alive');
  assert.equal(stageFrames('lamp_post', 0).frame, 'hub_lamp_dim');
  assert.equal(stageFrames('lamp_post', 3).frame, 'hub_lamp');
  for (let lv = 1; lv <= 5; lv++) assert.ok(lampRadius(lv) > lampRadius(lv - 1), 'each level reaches further');
  assert.equal(lampRadius(99), lampRadius(5));
  const lib = HUB.plots.find((p) => p.building === 'library');
  assert.deepEqual(plotLights(lib, 2), [], 'dark until lit');
  assert.equal(plotLights(lib, 3).length, lib.windows.length);
  const at4 = plotLights(lib, 4);
  assert.equal(at4.filter((l) => l.kind === 'door').length, 1);
  const door = at4.find((l) => l.kind === 'door');
  assert.ok(door.x > lib.door[0] * 16 && door.x < (lib.door[0] + 1) * 16 && door.y < lib.door[1] * 16, 'the door lantern sits beside the door, on the wall');
  assert.deepEqual(plotLights(HUB.plots.find((p) => p.building === 'lamp_post'), 5), [], 'the lamp\'s light is its own');
});

test('harbor ceremony looks: what a building shows as a level goes up, and how its lights come on', () => {
  const cer = (from, level, build) => ({ kind: 'ceremony', from, level, build });
  // No ceremony: the stage for the level, whole; a scaffold over the ruin at level 1 only.
  assert.deepEqual(buildingDraw('library', 0), { lower: null, upper: 'bld_library_ruin', reveal: 1, scaffold: null });
  assert.deepEqual(buildingDraw('library', 1), { lower: null, upper: 'bld_library_ruin', reveal: 1, scaffold: { drop: 0, alpha: 1 } });
  assert.deepEqual(buildingDraw('library', 4), { lower: null, upper: 'bld_library_keeper', reveal: 1, scaffold: null });
  // The first level: the scaffold rises into place over the ruin and firms up.
  assert.deepEqual(buildingDraw('library', 0, cer(0, 1, 0)), { lower: null, upper: 'bld_library_ruin', reveal: 1, scaffold: { drop: 18, alpha: 0 } });
  assert.deepEqual(buildingDraw('library', 0, cer(0, 1, 0.5)), { lower: null, upper: 'bld_library_ruin', reveal: 1, scaffold: { drop: 9, alpha: 1 } });
  assert.deepEqual(buildingDraw('library', 0, cer(0, 1, 1)).scaffold, { drop: 0, alpha: 1 });
  // Later levels: the new stage rises from the ground over the old; the old scaffold fades as it goes.
  assert.deepEqual(buildingDraw('tavern', 1, cer(1, 2, 0.25)), { lower: 'bld_tavern_ruin', upper: 'bld_tavern_roof', reveal: 0.25, scaffold: { drop: 0, alpha: 0.75 } });
  assert.deepEqual(buildingDraw('tavern', 3, cer(3, 4, 0.5)), { lower: 'bld_tavern_lit', upper: 'bld_tavern_keeper', reveal: 0.5, scaffold: null });
  assert.deepEqual(buildingDraw('tavern', 3, cer(3, 4, 1)), { lower: null, upper: 'bld_tavern_keeper', reveal: 1, scaffold: null }, 'done: the new stage alone');
  assert.equal(buildingDraw('tavern', 3, cer(3, 4, 7)).reveal, 1, 'the build is held to 0..1');
  // The Lamp Post never has a scaffold; its lit lamp rises over the dim one.
  assert.deepEqual(buildingDraw('lamp_post', 0, cer(0, 1, 0.5)), { lower: 'hub_lamp_dim', upper: 'hub_lamp', reveal: 0.5, scaffold: null });
  // Lights: the ones it had stay on; the new ones come up with the build.
  const lib = HUB.plots.find((p) => p.building === 'library');
  assert.deepEqual(lightsNow(lib, 2), []);
  assert.ok(lightsNow(lib, 4).every((l) => l.alpha === 1));
  const lighting = lightsNow(lib, 2, cer(2, 3, 0.4));
  assert.equal(lighting.length, lib.windows.length);
  assert.ok(lighting.every((l) => l.alpha === 0.4 && l.kind === 'window'), 'the windows come on as it builds');
  const lantern = lightsNow(lib, 3, cer(3, 4, 0.4));
  assert.deepEqual(lantern.map((l) => [l.kind, l.alpha]), [...lib.windows.map(() => ['window', 1]), ['door', 0.4]], 'the windows stay on; the door lantern comes on');
  // The town lamp: dim before its first level, swelling from one level's reach to the next.
  const look = DATA.hubTuning.look;
  assert.deepEqual(lampLight(0, null, look), { r: lampRadius(0), alpha: look.lampDim });
  assert.deepEqual(lampLight(3, null, look), { r: lampRadius(3), alpha: 1 });
  assert.deepEqual(lampLight(0, cer(0, 1, 0), look), { r: lampRadius(0), alpha: look.lampDim });
  assert.deepEqual(lampLight(0, cer(0, 1, 1), look), { r: lampRadius(1), alpha: 1 });
  const half = lampLight(2, cer(2, 3, 0.5), look);
  assert.equal(half.r, (lampRadius(2) + lampRadius(3)) / 2);
  // The boat, drawn over the light map and the fog: the night's shade on clear water, darker in fog.
  assert.equal(boatShade(0, look), look.boatNight);
  assert.equal(boatShade(1, look), Math.min(look.boatNight, 1 - look.boatInFog));
  assert.ok(boatShade(1, look) < boatShade(0, look) && look.boatNight < 1, 'never as bright as daylight');
  assert.equal(boatShade(9, look), boatShade(1, look));
  // Held to 0..1 whatever the look says (a negative tint stops Pixi drawing the boat).
  assert.equal(boatShade(1, { ...look, boatInFog: 1.5 }), 0);
  assert.equal(boatShade(NaN, look), look.boatNight);
  assert.equal(boatShade(0, { ...look, boatNight: 3 }), 1);
});

test('harbor view: every light from the look, the camera and an arrival between ticks, and people appearing and stepping', () => {
  const look = DATA.hubTuning.look;
  const levels = { lamp_post: 2, library: 3, tavern: 4 };
  const you = { x: 480, y: 290 };
  const lights = harborLights({ hub: HUB, levels, you, look });
  const lp = HUB.plots.find((p) => p.building === 'lamp_post');
  // The town lamp (its reach from the look, at its glass) and its steady white middle.
  const lampColor = lookColor(look.lampColor), windowColor = lookColor(look.windowColor);
  assert.deepEqual(lights[0], { x: lp.x * 16 + 8, y: (lp.y + 1) * 16 - LIGHT_SPOTS.lampGlass, r: look.lampReach + 2 * look.lampReachPerLevel, color: lampColor, alpha: 1 });
  assert.equal(lampRadius(2), lights[0].r);
  assert.deepEqual(lights[1], { x: lights[0].x, y: lights[0].y, r: look.lampCoreReach, color: 0xffffff, alpha: look.lampCoreLight, steady: true });
  assert.deepEqual(lights[2], { x: 480, y: 282, r: look.lanternReach, color: lampColor, alpha: look.lanternLight }, 'your lantern, above your feet');
  const lib = HUB.plots.find((p) => p.building === 'library');
  const windows = lights.filter((l) => l.color === windowColor);
  assert.equal(windows.length, lib.windows.length * 2, 'the Library\'s and the Tavern\'s windows (both lit)');
  assert.ok(windows.every((l) => l.r === look.windowReach && l.alpha === look.windowLight));
  assert.equal(lights.filter((l) => l.r === look.doorReach).length, 1, 'one door lantern: the Tavern\'s (level 4)');
  assert.equal(lights.filter((l) => l.r === look.smallLampReach && l.alpha === look.smallLampLight).length, 2, 'the gate\'s lamp and the pier\'s');
  // A different look moves the lights with it (nothing about them is left in code).
  const wide = harborLights({ hub: HUB, levels, you, look: { ...look, lampReach: 100, lampReachPerLevel: 50, windowReach: 40, lampColor: '#102030', windowColor: 'sea-5' } });
  assert.equal(wide[0].r, 200);
  assert.equal(wide[0].color, 0x102030, 'a light\'s tint as #rrggbb');
  assert.ok(wide.filter((l) => l.color === lookColor('sea-5')).every((l) => l.r === 40), 'or as a palette name');
  // A boat coming in: its lantern at its stern while lit (arrivalLook's halo), none once it's out.
  const lit = { lantern: true, halo: { x: 286.5, y: 512 } };
  const withBoat = harborLights({ hub: HUB, levels, you, arrival: lit, look });
  assert.deepEqual(withBoat.at(-1), { x: 286.5, y: 512, r: look.boatLanternReach, color: lampColor, alpha: look.boatLanternLight });
  assert.equal(harborLights({ hub: HUB, levels, you, arrival: { ...lit, lantern: false }, look }).length, lights.length, 'out as the camera heads back');
  // The night where no lamp reaches: the look's ambient, plus its boost, kept to 0..1.
  assert.deepEqual(ambientLight(look), look.ambient.map((c) => Math.min(1, Math.max(0, c + look.ambientBoost))));
  assert.deepEqual(ambientLight({ ambient: [0.2, 0.5, 0.9], ambientBoost: 0.2 }).map((c) => Math.round(c * 100)), [40, 70, 100]);
  assert.deepEqual(ambientLight({ ambient: [0.2, 0.5, 0.9], ambientBoost: -0.3 }).map((c) => Math.round(c * 100)), [0, 20, 60]);
  assert.throws(() => lookColor('not-a-color'), /No palette color/);
  const swelling = harborLights({ hub: HUB, levels: { lamp_post: 2 }, cer: { building: 'lamp_post', from: 2, level: 3, build: 0.5 }, you, look });
  assert.equal(swelling[0].r, (lampRadius(2) + lampRadius(3)) / 2);
  // The camera: between you last tick and now, or the set piece's camera while one runs.
  const w = { player: { px: 100, x: 110, py: 50, y: 50 }, cam: { px: 300, x: 320, py: 200, y: 180 }, timeline: null };
  assert.deepEqual(cameraAt(w, 0.5), [105, 50]);
  assert.deepEqual(cameraAt({ ...w, timeline: { kind: 'ceremony' } }, 0.25), [305, 195]);
  // An arrival: the boat between ticks, stood by its bottom middle, in the shade of the fog where
  // it is; the newcomer aboard in the bow, cut at the gunwale, then walking up from exactly there;
  // the lantern at the stern, out as the camera heads back.
  const harbor = { aboard: 16, deck: 4 };
  const tl = { phase: 'sail', boat: { px: 400, x: 410, py: 536, y: 536 }, walker: { px: 464, x: 464, py: 540, y: 540, facing: 1, moving: false } };
  const fog = (x) => (x < 405 ? 1 : 0);
  const sailing = arrivalLook(tl, 0.5, fog, harbor, look);
  assert.deepEqual(sailing.boat, { x: 405, y: 536 });
  assert.deepEqual(sailing.draw, { x: 405, y: 536 + ANCHORS.boatBelow }, 'the sprite stood by its bottom middle');
  assert.deepEqual(sailing.passenger, { x: 421, y: 536 - ANCHORS.gunwale + ANCHORS.boatBelow }, 'in the bow, her cut at the gunwale');
  assert.deepEqual(sailing.halo, { x: 405 + LIGHT_SPOTS.boatLantern[0], y: 536 + LIGHT_SPOTS.boatLantern[1] });
  assert.equal(sailing.walker, null);
  assert.equal(sailing.shade, boatShade(0, look));
  const inFog = arrivalLook(tl, 0, fog, harbor, look);
  assert.equal(inFog.shade, boatShade(1, look), 'darker in the fog');
  assert.equal(sailing.glow, look.boatGlow);
  assert.equal(inFog.glow, look.boatGlow + look.boatGlowInFog, 'its halo thicker in the fog');
  const walking = arrivalLook({ ...tl, phase: 'walk', boat: { px: 448, x: 448, py: 536, y: 536 }, walker: { px: 464, x: 468, py: 540, y: 540, facing: 1, moving: true } }, 0, fog, harbor, look);
  assert.equal(walking.passenger, null);
  assert.deepEqual(walking.walker, { x: 464, y: 540, facing: 1, moving: true }, 'she steps off where she stood aboard');
  // On the swell, the boat, her in it, and its lantern rise and fall together; the pier doesn't.
  const risen = arrivalLook(tl, 0.5, fog, harbor, look, -1);
  assert.deepEqual([risen.draw.y, risen.passenger.y, risen.halo.y], [sailing.draw.y - 1, sailing.passenger.y - 1, sailing.halo.y - 1]);
  assert.deepEqual([risen.draw.x, risen.passenger.x, risen.halo.x, risen.boat.y], [sailing.draw.x, sailing.passenger.x, sailing.halo.x, sailing.boat.y], 'only up and down, and not where it is');
  assert.deepEqual(arrivalLook({ ...tl, phase: 'walk' }, 0, fog, harbor, look, 1).walker, arrivalLook({ ...tl, phase: 'walk' }, 0, fog, harbor, look, 0).walker, 'she walks on the pier');
  const leaving = arrivalLook({ ...tl, phase: 'panOut' }, 1, fog, harbor, look);
  assert.deepEqual([leaving.walker, leaving.lantern, leaving.glow], [null, false, 0], 'her waiting figure has taken over');
  // Her top in the boat and her top on her first step are the same row: no jump at the hand-off.
  // (Cut at the gunwale, `cut` px above her feet; standing on the deck, `deck` below the boat's middle.)
  const inBoatTop = (ANCHORS.boatBelow - ANCHORS.gunwale) + ANCHORS.cut;   // her feet's row, from the boat's middle, as drawn in it
  assert.equal(inBoatTop, HUB.harbor.deck, 'data/hub.js harbor.deck agrees with the view');
  // Between ticks, the lamps' flicker, and the boat's bob.
  assert.deepEqual(drawnAt({ px: 10, x: 20, py: 5, y: 5 }, 0.25), [12.5, 5]);
  for (let t = 0; t < 3000; t += 37) {
    const f = flickerAt(t, look);
    assert.ok(f >= 1 - look.flicker - 1e-9 && f <= 1 + look.flicker + 1e-9);
    assert.ok(Math.abs(boatBobAt(t, look)) <= look.boatBob);
  }
  assert.equal(flickerAt(1234, { ...look, flicker: 0 }), 1, 'no flicker at 0');
  const waves = { ...look, flicker: 0.1, flickerSlowMs: 500, flickerFastMs: 90, flickerSlowShare: 0.8 };
  for (const t of [0, 123, 777, 2468]) assert.ok(Math.abs(flickerAt(t, waves) - (1 + 0.1 * (Math.sin(t / 500) * 0.8 + Math.sin(t / 90) * 0.2))) < 1e-12, 'two waves, as tuned');
  // People: a newcomer is already there; anyone else appears now. Each steps in their own time,
  // and moving never changes when.
  assert.equal(appearsAt('harpooner', 'harpooner', 12), -Infinity);
  assert.equal(appearsAt('librarian', 'harpooner', 12), 12);
  const phases = ['lamp_keeper', 'librarian', 'innkeeper', 'harpooner'].map((id) => hopPhase(id, look.hopStepsPerSec));
  assert.ok(phases.every((p) => p >= 0 && p < 1 / look.hopStepsPerSec) && new Set(phases).size === 4, 'four different phases within a step');
  let flips = 0, last = null;
  for (let tick = 0; tick < 60; tick++) {
    const hop = stepHop(true, tick / 60 + phases[1], look.hopStepsPerSec);
    if (last !== null && hop !== last) flips++;
    last = hop;
  }
  assert.ok(flips <= look.hopStepsPerSec + 1, `a walker hops ${look.hopStepsPerSec} times a second, not ${flips}`);
});

test('harbor camera and fog: the view stays inside the map; the fog is thick until its region clears', () => {
  const W = HUB.map[0].length * 16, H = HUB.map.length * 16;
  assert.deepEqual(clampCamera(0, 0, W, H, 640, 360), [320, 180]);
  assert.deepEqual(clampCamera(99999, 99999, W, H, 640, 360), [W - 320, H - 180]);
  assert.deepEqual(clampCamera(500, 300, W, H, 640, 360), [500, 300]);
  assert.deepEqual(clampCamera(50, 50, 200, 100, 640, 360), [100, 50], 'a map smaller than the view is centered');
  const map = buildHubMap(HUB, HUB_TERRAIN);
  const i = (x, y) => y * map.cols + x;
  const start = fogDensity(map, revealedFog(profile(), DATA), new Map());
  assert.equal(start[i(...HUB.spawn)], 0, 'the square is clear');
  assert.equal(start[i(0, 0)], 1, 'the forest\'s edge is fog');
  const lp1 = revealedFog(profile({ lamp_post: 1 }), DATA);
  const fading = fogDensity(map, lp1, new Map([['lamp_1', 0.4]]));
  const onlyLamp1 = [19, 20];   // a tile only the Lamp Post's first level clears
  assert.ok(Math.abs(fading[i(...onlyLamp1)] - 0.4) < 1e-6, 'a fading region is as thick as its fade');
  assert.equal(fogDensity(map, lp1, new Map())[i(...onlyLamp1)], 0);
  // The edge is ragged, not ruled: along the start's fog edge, the fog tiles next to clear ground
  // thin by different amounts (up to FOG_FRAY), and the clear tiles take some fog (up to FOG_CREEP).
  const clear = clearTiles(map, revealedFog(profile(), DATA));
  const near = (x, y) => [...HUB.plots, ...HUB.ruins].some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);
  const edgeFog = [], edgeClear = [];
  for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
    if (near(x, y)) continue;
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => clear[(y + dy) * map.cols + x + dx]).filter((c) => c !== undefined);
    if (!clear[i(x, y)] && side.includes(1)) edgeFog.push(start[i(x, y)]);
    if (clear[i(x, y)] && side.includes(0)) edgeClear.push(start[i(x, y)]);
  }
  assert.ok(edgeFog.length > 20 && edgeClear.length > 20);
  assert.ok(edgeFog.every((d) => d >= 1 - FOG_FRAY && d <= 1) && new Set(edgeFog.map((d) => d.toFixed(2))).size > 5, 'fog tiles at the edge thin unevenly');
  assert.ok(edgeClear.every((d) => d >= 0 && d <= FOG_CREEP) && edgeClear.some((d) => d > 0.05), 'clear tiles at the edge take a little fog');
  // Never on a building or the ring around it: at every Lamp Post level, each is all 0 or all 1.
  for (let lv = 0; lv <= 5; lv++) {
    const dens = fogDensity(map, revealedFog(profile({ lamp_post: lv }), DATA), new Map());
    for (const p of [...HUB.plots, ...HUB.ruins]) {
      const vals = new Set();
      for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) if (x >= 0 && y >= 0 && x < map.cols && y < map.rows) vals.add(dens[i(x, y)]);
      assert.ok(vals.size === 1 && (vals.has(0) || vals.has(1)), `${p.building || p.id} at Lamp Post ${lv}: ${[...vals].join(', ')}`);
    }
  }
  // And a fade moves the edge smoothly: halfway through, every tile is between where it started and where it ends.
  const before = fogDensity(map, revealedFog(profile(), DATA), new Map()), after = fogDensity(map, lp1, new Map()), mid = fogDensity(map, lp1, new Map([['lamp_1', 0.5]]));
  for (let k = 0; k < mid.length; k++) assert.ok(mid[k] >= Math.min(before[k], after[k]) - 1e-6 && mid[k] <= Math.max(before[k], after[k]) + 1e-6, `tile ${k % map.cols}, ${Math.floor(k / map.cols)}`);
});

test('panel text: a level says what it brings, as short labels, each marked with its kind', () => {
  const texts = (b, lv) => levelEffects(DATA, b, lv).map((e) => e.text);
  assert.deepEqual(levelEffects(DATA, 'lamp_post', 1), [{ kind: 'tree', text: 'Unlocks upgrade tier 1' }, { kind: 'fog', text: 'Clears the fog nearby' }]);
  assert.deepEqual(texts('lamp_post', 2), ['Unlocks upgrade tier 2', 'Clears the fog nearby']);
  assert.deepEqual(levelEffects(DATA, 'library', 1), [{ kind: 'research', text: 'Unlocks research' }, { kind: 'fog', text: 'Clears the fog nearby' }]);
  assert.deepEqual(texts('library', 2), ['Unlocks research tier 2']);
  assert.deepEqual(texts('library', 3), ['Research slots: 2', 'Clears the fog nearby']);
  assert.deepEqual(levelEffects(DATA, 'tavern', 1), [{ kind: 'arrival', text: 'New character: Harpooner' }, { kind: 'fog', text: 'Clears the fog nearby' }]);
  assert.deepEqual(levelEffects(DATA, 'tavern', 2), [{ kind: 'joins', text: 'New relic: Tide Clock' }]);
  assert.ok(levelEffects(DATA, 'tavern', 4).some((e) => e.kind === 'keeper' && e.text === 'Bram returns'));
  assert.ok(texts('library', 5).includes('Silas walks the harbor'));
  assert.deepEqual(levelEffects(DATA, 'tavern', 9), []);
  // A level that brings none of those says so.
  const shed = { ...DATA, buildings: [{ id: 'shed', name: 'Shed', levels: [{ cost: { coin: 1 } }] }], npcs: [], hub: { ...DATA.hub, fog: [] } };
  assert.deepEqual(levelEffects(shed, 'shed', 1), [{ kind: 'more', text: 'No new unlocks' }]);
  assert.equal(costText(DATA, { oil: 15 }), '15 Oil');
  assert.equal(costText(DATA, { oil: 15, coin: 15 }), '15 Oil, 15 Coin');
  assert.equal(costText(DATA, { oil: 1, coin: 2, rope: 3 }), '1 Oil, 2 Coin, 3 Rope');
  assert.equal(costText(DATA, {}), 'Free');
  assert.equal(runsText(1), '1 run'); assert.equal(runsText(3), '3 runs');
  assert.equal(buildingIn(DATA, 'lamp_post'), 'Lamp Post', 'names go without "The" (docs/WRITING.md §4)');
});

test('panel text: research and upgrades say where they stand and why not', () => {
  const orb = DATA.research.find((r) => r.id === 'orbwright');
  const rev = DATA.research.find((r) => r.id === 'reversed_runes');
  assert.deepEqual(researchState(profile(), DATA, orb), { state: 'locked', why: 'Requires Library Lv 1' });
  assert.deepEqual(researchState(profile({ library: 1 }), DATA, orb), { state: 'open' });
  assert.deepEqual(researchState(profile({ library: 2 }), DATA, rev), { state: 'locked', why: 'Requires research: Rune Stones' });
  assert.deepEqual(researchState(profile({ library: 1 }), DATA, rev), { state: 'locked', why: 'Requires Library Lv 2' }, 'the level that opens its tier, from the data');
  const vol = DATA.research.find((r) => r.id === 'volatile_salts');
  assert.equal(researchState(profile({ library: 1 }), DATA, vol).why, 'Requires Library Lv 4');
  // What a row shows is what pressing it says: one line, from the meta layer.
  for (const r of DATA.research) for (const lv of [0, 1, 2, 4]) {
    const doc = profile({ library: lv });
    const st = researchState(doc, DATA, r);
    if (st.state === 'locked') assert.equal(st.why, whyNotResearch(doc, DATA, r.id), `${r.id} at Library ${lv}`);
  }
  for (const u of DATA.upgrades) {
    const doc = profile({ lamp_post: 1 });
    const st = upgradeState(doc, DATA, u);
    if (!st.open) assert.equal(st.why, whyNotUpgrade(doc, DATA, u.id), u.id);
  }
  const going = startResearch(profile({ library: 1 }, RICH), DATA, 'orbwright').doc;
  assert.deepEqual(researchState(going, DATA, orb), { state: 'active', runsLeft: orb.runs });
  const salt = DATA.upgrades.find((u) => u.id === 'salt_skin');
  assert.deepEqual(upgradeState(profile({ lamp_post: 1 }), DATA, salt), { rank: 0, ranks: salt.ranks, open: false, why: 'Requires Lamp Post Lv 3' });
  assert.deepEqual(upgradeState(profile({ lamp_post: 3 }), DATA, salt), { rank: 0, ranks: salt.ranks, open: true, why: null });
  // The level comes from the data (which level opens the tier), not the tier's number.
  const moved = { ...DATA, buildings: DATA.buildings.map((b) => (b.id === 'lamp_post' ? { ...b, levels: b.levels.map((l, i) => ({ ...l, tree: i === 0 ? 1 : i === 1 ? 3 : l.tree })) } : b)) };
  assert.equal(upgradeState(profile({ lamp_post: 1 }), moved, salt).why, 'Requires Lamp Post Lv 2');
});

test('results text: what a run brought home and what happened, one line each', () => {
  const doc = profile({ library: 1 }, RICH);
  const started = startResearch(doc, DATA, 'orbwright').doc;
  const result = {
    end: 'died', timeSurvived: 400, totalKills: 150, kills: { fog_wisp: 150 }, bossesKilled: [],
    materials: { coin: 12, oil: 3 }, weapons: [{ id: 'flare_gun' }], passives: [], relics: [], runes: [], evolutions: [],
  };
  const { changes } = applyRunResult(started, result, DATA);
  const lines = changeLines(DATA, changes);
  assert.deepEqual(lines.filter((l) => l.kind === 'material').map((l) => [l.text, l.icon]), [['12 Coin', 'mat_coin'], ['3 Oil', 'mat_oil']]);
  assert.ok(lines.some((l) => l.text === 'Research complete: Orbwright\'s Notes'), JSON.stringify(lines));
  assert.ok(lines.some((l) => l.text === 'Discovered: Flare Gun'));
  // 150 kills crosses 10 and 100: only the highest is said, and it's the lifetime count.
  const beasts = lines.filter((l) => l.kind === 'bestiary');
  assert.deepEqual(beasts.map((l) => l.text), ['Fog Wisp: 100 kills total']);
  // Purchases read the same way.
  const lib = restoreBuilding(profile({}, RICH), DATA, 'library');
  assert.deepEqual(changeLines(DATA, lib.changes).map((l) => l.text), ['Library Lv 1']);
  // Every other line, one of each.
  const each = changeLines(DATA, [
    { kind: 'research_step', id: 'tide_charts', runsLeft: 1 },
    { kind: 'research_done', id: 'tide_charts', unlocks: [{ what: 'weapon', id: 'tide_bell' }, { what: 'passive', id: 'undertow' }] },
    { kind: 'research_waiting', reason: waitingReason(DATA.meta) },
    { kind: 'codex', key: 'passive:wick_oil' },
    { kind: 'best_time', seconds: 431, previous: 300 },
    { kind: 'upgrade_rank', id: 'long_reach', rank: 2 },
    { kind: 'research_started', id: 'almanac', runs: 2 },
    { kind: 'something_new_later', id: 'x' },
  ]);
  assert.deepEqual(each.map((l) => [l.kind, l.text]), [
    ['research', 'Research: Tide Charts (1 run left)'],
    ['research_done', 'Research complete: Tide Charts'],
    ['unlock', 'New weapon: Tide Bell'],
    ['unlock', 'New passive: Undertow'],
    ['note', 'Research didn\'t progress. A run counts if you survive 5:00 or kill a boss.'],
    ['codex', `Discovered: ${DATA.passives.find((p) => p.id === 'wick_oil').name}`],
    ['record', 'New best time: 7:11 (was 5:00)'],
    ['upgrade', `Long Reach 2/${DATA.upgrades.find((u) => u.id === 'long_reach').ranks}`],
    ['research', `Research started: ${DATA.research.find((r) => r.id === 'almanac').name} (2 runs)`],
  ], 'an unknown kind says nothing');
});

test('results after Run again: several runs read as one visit', () => {
  // Two runs in a row: the Tide Charts steps on and then finishes; materials add up; of the Fog
  // Wisp's milestones (10 in the first run, 100 in the second) only the highest is said.
  let d = startResearch(profile({ library: 1 }, RICH), DATA, 'tide_charts').doc;
  d.profile.materials = {};
  d.profile.bestiary = { fog_wisp: 5 };
  d.stats.bestTimeSec = 300;
  const run = (over) => ({ end: 'died', timeSurvived: 400, totalKills: 10, kills: { fog_wisp: 5 }, bossesKilled: [], materials: { coin: 10, oil: 2 }, weapons: [{ id: 'flare_gun' }], passives: [], relics: [], runes: [], evolutions: [], ...over });
  const a = applyRunResult(d, run({ materials: { coin: 10, oil: 2 } }), DATA);
  const b = applyRunResult(a.doc, run({ materials: { coin: 5, rope: 1 }, timeSurvived: 500, kills: { fog_wisp: 90 }, weapons: [{ id: 'flare_gun' }, { id: 'harpoon_chain' }] }), DATA);
  const merged = mergeRuns({ changes: a.changes, result: 'first', runs: 1 }, { changes: b.changes, result: 'second', runs: 1 }, DATA);
  assert.equal(merged.runs, 2);
  assert.equal(merged.result, 'second');
  const lines = changeLines(DATA, merged.changes).map((l) => l.text);
  assert.deepEqual(lines, [
    '15 Coin', '2 Oil', '1 Rope',
    'Research complete: Tide Charts', 'New weapon: Tide Bell', 'New passive: Undertow',
    'Discovered: Flare Gun', 'Discovered: Harpoon Chain', 'Fog Wisp: 100 kills total',
    'New best time: 8:20 (was 5:00)',
  ]);
  // A third, short run that didn't count: its wait is said; the finished project stays said once.
  const c = applyRunResult(b.doc, run({ timeSurvived: 60, materials: {} }), DATA);
  const three = mergeRuns(merged, { changes: c.changes, result: 'third', runs: 1 }, DATA);
  assert.equal(three.runs, 3);
  assert.equal(changeLines(DATA, three.changes).filter((l) => /Tide Charts/.test(l.text)).length, 1);
});

test('next-3 text: what it is, where, how close, and what is short', () => {
  const doc = profile({}, { oil: 15, coin: 10 });
  const [first] = nextAffordable(doc, DATA, 3);
  const t = optionText(DATA, first);
  assert.equal(t.title, 'Lamp Post Lv 1');
  assert.equal(t.readyAt, 'Ready', 'a building is where you go');
  assert.equal(t.need, 'Need 5 Coin');
  assert.ok(t.progress > 0.8 && t.progress < 1);
  const ready = optionText(DATA, nextAffordable(profile({}, RICH), DATA, 1)[0]);
  assert.equal(ready.need, null);
  // Where each kind is bought, as a label and inside the ready line; several things short, joined.
  const up = optionText(DATA, { kind: 'upgrade', id: 'long_reach', rank: 2, progress: 0.5, missing: [{ id: 'coin', need: 4 }, { id: 'rope', need: 2 }] });
  assert.deepEqual(up, { title: `Long Reach 2/${DATA.upgrades.find((u) => u.id === 'long_reach').ranks}`, where: 'Lamp Post', readyAt: 'Ready at Lamp Post', progress: 0.5, need: 'Need 4 Coin, 2 Rope' });
  const res = optionText(DATA, { kind: 'research', id: 'orbwright', progress: 0.2, missing: [{ id: 'coin', need: 4 }, { id: 'rope', need: 2 }, { id: 'oil', need: 1 }] });
  assert.deepEqual([res.title, res.where, res.readyAt, res.need], ['Orbwright\'s Notes', 'Library', 'Ready at Library', 'Need 4 Coin, 2 Rope, 1 Oil']);
});

test('harbor logic: a level plays its ceremony, then any arrival; the harbor\'s prompts and lines', () => {
  const doc = profile({}, RICH);
  const out = restoreBuilding(doc, DATA, 'tavern');
  const plan = levelSetPieces(out.doc, DATA, out.changes[0]);
  assert.equal(plan.ceremony.building, 'tavern');
  assert.equal(plan.ceremony.level, 1);
  assert.ok(plan.ceremony.revealed.has('tavern_1'));
  assert.ok(!plan.ceremony.people.some((p) => p.id === 'harpooner'), 'she isn\'t on the square before her boat comes in');
  assert.equal(plan.arrivals.length, 1);
  assert.equal(plan.arrivals[0].id, 'harpooner');
  assert.ok(plan.arrivals[0].people.some((p) => p.id === 'harpooner'), 'and she is once it has');
  assert.equal(plan.banner.title, 'Tavern Lv 1');
  // A level with no arrival.
  const lp = restoreBuilding(doc, DATA, 'lamp_post');
  assert.deepEqual(levelSetPieces(lp.doc, DATA, lp.changes[0]).arrivals, []);
  assert.deepEqual(levelsOf(lp.doc, DATA), { lamp_post: 1, library: 0, tavern: 0 });
  assert.equal(promptFor(DATA, { kind: 'door', id: 'library' }), 'Enter Library');
  assert.equal(promptFor(DATA, { kind: 'door', id: 'lamp_post' }), 'Use Lamp Post');
  assert.equal(promptFor(DATA, { kind: 'gate', id: 'gate' }), 'Start run');
  assert.equal(promptFor(DATA, { kind: 'person', id: 'lamp_keeper' }), 'Talk to Old Wick');
  assert.equal(promptFor(DATA, null), null);
  assert.deepEqual(lineFor(profile({ lamp_post: 4 }), DATA, 'lamp_keeper'), { name: 'Old Wick', text: 'Forty years I lit these streets. Nice to have help.' });
  assert.equal(lineFor(profile(), DATA, 'harpooner').name, 'Harpooner');
  assert.equal(lineFor(profile(), DATA, 'nobody'), null);
  assert.deepEqual(runHeading({ end: 'died', timeSurvived: 431 }), { title: 'Results', line: 'Survived 7:11' });
  assert.equal(runHeading({ end: 'left', timeSurvived: 60 }).line, 'Returned at 1:00');
  assert.equal(runHeading({ end: 'cleared', timeSurvived: 1500, map: 'drowned_docks' }, 1, DATA).line, 'Drowned Docks cleared in 25:00', 'the map by its name');
  assert.equal(runHeading({ end: 'cleared', timeSurvived: 1500, map: 'salt_marsh' }, 1, { ...DATA, maps: [...DATA.maps, { id: 'salt_marsh', name: 'Salt Marsh' }] }).line, 'Salt Marsh cleared in 25:00');
  assert.equal(runHeading({ end: 'cleared', timeSurvived: 1500, map: 'nowhere' }, 1, DATA).line, 'Map cleared in 25:00', 'a map this build doesn\'t know');
  assert.deepEqual(runHeading({ end: 'died', timeSurvived: 431 }, 3), { title: 'Results (3 runs)', line: 'Last run: Survived 7:11' });
  assert.equal(titleStartLabel(profile()), 'Start');
  assert.equal(titleStartLabel(profile({ lamp_post: 1 })), 'Continue');
  const ran = profile(); ran.stats.runs = 1;
  assert.equal(titleStartLabel(ran), 'Continue');
});

test('harbor results: runs merged say a research wait only when the last run didn\'t count', () => {
  const wait = { kind: 'research_waiting', reason: "Research didn't progress. A run counts if you survive 5:00 or kill a boss." };
  const step = { kind: 'research_step', id: 'tide_charts', runsLeft: 1 };
  const shortThenLong = mergeRuns({ changes: [wait], result: {}, runs: 1 }, { changes: [step], result: {}, runs: 1 }, DATA);
  assert.deepEqual(shortThenLong.changes, [step], 'the last run counted: no wait');
  const longThenShort = mergeRuns({ changes: [step], result: {}, runs: 1 }, { changes: [wait], result: {}, runs: 1 }, DATA);
  assert.deepEqual(longThenShort.changes, [step, wait], 'the last run didn\'t count: said');
});

test('harbor view: the fog at a point, its clear mask, and when the mask is drawn again', () => {
  const dens = new Float32Array([0, 0.5, 1, 0.25]);   // a 2 x 2 map
  assert.equal(fogAtPoint(dens, 2, 2, 24, 8), 0.5, 'a tile\'s own at its middle');
  assert.equal(fogAtPoint(dens, 2, 2, 8, 24), 1);
  assert.equal(fogAtPoint(dens, 2, 2, 16, 8), 0.25, 'halfway between two middles, halfway between them');
  assert.equal(fogAtPoint(dens, 2, 2, 16, 16), (0 + 0.5 + 1 + 0.25) / 4, 'where four meet, all four');
  assert.equal(fogAtPoint(dens, 2, 2, 2, 3), 0, 'clamped at the map\'s edge, as the texture is');
  assert.equal(fogAtPoint(dens, 2, 2, -3, 5), 1, 'off the map is fog');
  assert.equal(fogAtPoint(dens, 2, 2, 40, 5), 1);
  for (let x = 0; x + 0.5 < 32; x += 0.5) assert.ok(Math.abs(fogAtPoint(dens, 2, 2, x + 0.5, 11) - fogAtPoint(dens, 2, 2, x, 11)) <= 0.5 * 0.5 / 16 + 1e-12, 'smooth, never a step');
  const clear = new Uint8ClampedArray(16);
  fogPixels(dens, clear);
  assert.deepEqual([...clear].filter((_, i) => i % 4 === 3), [255, 128, 0, 191], 'the clear mask: how clear each tile is');
  assert.ok([...clear].every((v, i) => i % 4 === 3 || v === 255), 'white (only its alpha erases)');
  // Drawn again for a new set of cleared regions, every frame of a fade and once after, and when
  // the ragged edge is tuned; not for the thickness (the fill's alpha, set every frame).
  const look = DATA.hubTuning.look;
  const revealed = new Set(['start']);
  const still = { revealed, fogFade: new Map() }, fading = { revealed, fogFade: new Map([['lamp_1', 0.5]]) };
  const first = fogRedraw(null, still, look);
  assert.ok(first, 'the first frame draws it');
  assert.equal(fogRedraw(first, still, look), null, 'nothing changed: kept');
  assert.equal(fogRedraw(first, still, { ...look, fogDensity: 0.4 }), null, 'the thickness is the fill\'s, not the mask\'s');
  assert.ok(fogRedraw(first, { revealed: new Set(revealed), fogFade: new Map() }, look), 'a new set of cleared regions');
  assert.ok(fogRedraw(first, still, { ...look, fogFray: 0.2 }) && fogRedraw(first, still, { ...look, fogCreep: 0.1 }), 'the edge tuned');
  const during = fogRedraw(first, fading, look);
  assert.ok(during && fogRedraw(during, fading, look), 'every frame of a fade');
  const after = fogRedraw(during, still, look);
  assert.ok(after, 'once more when the fade ends (its last value, or a skip)');
  assert.equal(fogRedraw(after, still, look), null, 'then kept');
  // The ragged edge follows the look too.
  const map = buildHubMap(HUB, HUB_TERRAIN);
  const flat = fogDensity(map, revealedFog(profile(), DATA), new Map(), undefined, { ...DATA.hubTuning.look, fogFray: 0, fogCreep: 0 });
  assert.ok(flat.every((d) => d === 0 || d === 1), 'no fray and no creep: every tile clear or fogged');
});

test('harbor view: windows light through a Library ceremony in harborLights too', () => {
  const look = DATA.hubTuning.look;
  const lib = HUB.plots.find((p) => p.building === 'library');
  const windowColor = lookColor(look.windowColor);
  const cer = { building: 'library', from: 2, level: 3, build: 0.4 };
  const lights = harborLights({ hub: HUB, levels: { library: 2 }, cer, you: { x: 0, y: 0 }, look });
  const windows = lights.filter((l) => l.color === windowColor);
  assert.equal(windows.length, lib.windows.length);
  assert.ok(windows.every((l) => Math.abs(l.alpha - look.windowLight * 0.4) < 1e-9), 'coming up with the build, not at full at its start');
});

test('harbor view: the light map at a point, a newcomer\'s shade, and when she\'s still in front of her boat', () => {
  const look = DATA.hubTuning.look;
  const amb = ambientLight(look);
  assert.deepEqual(lightAt(0, 0, [], look), amb, 'the night where no light reaches');
  const L = { x: 100, y: 100, r: 40, color: 0xff8000, alpha: 0.5 };
  assert.deepEqual(lightAt(100, 100, [L], look), [Math.min(1, amb[0] + 0.5), amb[1] + (0.5 * 128) / 255, amb[2]], 'full at its middle');
  assert.ok(Math.abs(lightAt(120, 100, [L], look)[1] - (amb[1] + (0.5 * 0.5625 * 128) / 255)) < 1e-12, 'half its reach out: the glow\'s 0.5625');
  assert.deepEqual(lightAt(140, 100, [L], look), amb, 'nothing at its rim');
  assert.ok(lightAt(130, 100, [L], look, 1.1)[1] > lightAt(130, 100, [L], look, 1)[1], 'the flicker stretches its reach');
  const steady = { ...L, steady: true };
  assert.deepEqual(lightAt(130, 100, [steady], look, 1.1), lightAt(130, 100, [steady], look, 1), 'not a steady light\'s');
  assert.equal(lightAt(100, 100, [L, L, L], look)[0], 1, 'capped at 1, as the multiply is');
  assert.deepEqual(lightAt(100, 100, [{ ...L, r: 0 }, { ...L, alpha: -1 }], look), amb, 'no reach or no brightness adds nothing');
  // A newcomer over the light map: lit like the ground where the fog is clear, in her boat's shade
  // where it's thick, between the two at its edge; the same whether she stands in the boat or walks.
  const pack = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  const aboard = { passenger: { x: 100, y: 100 + ANCHORS.middle - ANCHORS.cut }, walker: null, shade: 0.6 };
  const walking = { passenger: null, walker: { x: 100, y: 100 + ANCHORS.middle }, shade: 0.6 };
  const lit = lightAt(100, 100, [L], look).map((v) => Math.round(255 * v));
  assert.equal(newcomerTint(aboard, [L], () => 0, look), pack(lit), 'lit as the light map lights that spot');
  assert.equal(newcomerTint(walking, [L], () => 0, look), pack(lit), 'the same spot once she walks');
  assert.equal(newcomerTint(aboard, [L], () => 1, look), pack([153, 153, 153]), 'her boat\'s shade in thick fog');
  const edge = newcomerTint(aboard, [L], () => 0.5, look);
  assert.equal((edge >> 8) & 255, Math.round(255 * (lightAt(100, 100, [L], look)[1] + 0.6) / 2), 'halfway at the fog\'s edge');
  assert.equal(newcomerTint({ passenger: null, walker: null, shade: 0.6 }, [L], () => 0, look), null, 'no one to shade in the pan out');
  // Her boat, the same way at its middle (its route point): lit where the fog is clear, its shade
  // in thick fog; so tied up under a lamp, she and her boat are lit alike.
  const boatAt = { boat: { x: 100, y: 100 }, shade: 0.6 };
  assert.equal(boatTint(boatAt, [L], () => 0, look), pack(lit), 'lit as the light map lights the water there');
  assert.equal(boatTint(boatAt, [L], () => 1, look), pack([153, 153, 153]), 'its shade in thick fog');
  assert.equal(boatTint(boatAt, [], () => 0, look), pack(amb.map((v) => Math.round(255 * v))), 'the night\'s dark on clear water with no light near');
  const tiedUp = { boat: { x: 100, y: 100 }, passenger: { x: 104, y: 100 + ANCHORS.middle - ANCHORS.cut }, walker: null, shade: 0.6 };
  const [her, it] = [newcomerTint(tiedUp, [L], () => 0, look), boatTint(tiedUp, [L], () => 0, look)].map((c) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255));
  assert.ok(Math.abs(her - it) <= 12, `she and her boat lit alike (${her} and ${it})`);
  // How far clear of the boat she is: 0 while her frame overlaps its frame, then the gap.
  const draw = { x: 200, y: 300 }, person = { w: 22, h: 22 }, boat = { w: 36, h: 28 };
  assert.equal(clearOfBoat({ x: 210, y: 296 }, draw, person, 3, boat), 0, 'on its deck');
  assert.equal(clearOfBoat({ x: 229, y: 296 }, draw, person, 3, boat), 0, 'touching its bow');
  assert.equal(clearOfBoat({ x: 231, y: 296 }, draw, person, 3, boat), 2, 'two px past its bow');
  assert.equal(clearOfBoat({ x: 169, y: 296 }, draw, person, 3, boat), 2, 'two px behind its stern');
  assert.equal(clearOfBoat({ x: 210, y: 260 }, draw, person, 3, boat), 9, 'up the pier past its mast top');
  assert.equal(clearOfBoat({ x: 210, y: 329 }, draw, person, 3, boat), 10, 'below it');
  assert.equal(clearOfBoat({ x: 240, y: 260 }, draw, person, 3, boat), 11, 'off to one corner: the wider gap');
  // Her figure over the boat: whole while she's in front of it, then fading over the fade's px.
  assert.deepEqual([0, 2.5, 5, 10, 14].map((c) => steppingAlpha(c, 10)), [1, 0.75, 0.5, 0, 0]);
  assert.deepEqual([steppingAlpha(0, 0), steppingAlpha(0.1, 0)], [1, 0], 'no fade: gone as soon as she\'s clear');
});
