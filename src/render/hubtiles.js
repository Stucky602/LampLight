// What the harbor's view draws where (ARCHITECTURE §10.4): the frame on each tile, a building's
// frame at its level, where the lights are and how bright, and where the camera may go. Pure (no
// Pixi), so the gate tests it and the workspace's preview tool draws the same town the game does.
//
// The ground is one frame per tile: grass (now and then with tufts), flowers, the dirt paths
// (their grass edges and inside corners picked from the neighbors, as Tiny Town's own pieces
// expect), the square's setts, the quay's paving, the sea wall, the headland's rocks, the pier's
// two halves. The water is its own animated layer. On top, y-sorted with the people: trees,
// bushes, and fences.

import { tileHash } from './viewstate.js';
import { glowAt } from './textures.js';
import { buildingStage } from '../meta/state.js';
import { HUB_TUNING } from '../data/tuning.js';
import { color as paletteColor, hexToInt } from '../data/palette.js';
import { fnv1a } from '../lib/hash.js';

const LOOK = HUB_TUNING.look;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);   // (NaN reads as 0)

/** A color in the look (HUB_TUNING.look): a palette name ('night-2'), or '#rrggbb' for a light's tint. */
export function lookColor(v) {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return hexToInt(v);
  return paletteColor(v);
}

/** The light map where no lamp reaches: [r, g, b] (0..1), the look's ambient plus its boost. */
export function ambientLight(look = LOOK) {
  return look.ambient.map((c) => clamp01(c + look.ambientBoost));
}

/**
 * Where things off the tile grid are stood, px: a boat's bottom middle is `boatBelow` under its
 * route point, and its gunwale `gunwale` above that point; a newcomer in it is cut `cut` px above
 * her feet (the hull hides the rest); a small lamp's foot is `smallLampLift` above its tile's
 * bottom (standing on the wall or the pier's end). data/hub.js's harbor.deck, where her feet are
 * when she steps off, agrees: boatBelow - gunwale + cut (tests/harbor.test.js). A person's
 * `middle` is that far above their feet (where you carry your lantern, and where the light on a
 * newcomer is taken); a chimney's smoke starts `smokeFrom` below its building's top, at its middle.
 */
export const ANCHORS = Object.freeze({ boatBelow: 7, gunwale: 8, cut: 5, smallLampLift: 2, middle: 8, smokeFrom: 3 });

/**
 * Where the lights sit on their art, px from the thing's anchor (the drawings put them there, and
 * tests/harbor.test.js finds the glass on the atlas page): the town lamp's glass above its foot
 * (art/draw/hub.js townLamp), the small lamps' glass above theirs (prop_lamppost), the boat's
 * stern lantern from its route point (art/draw/hub.js boat, stood by ANCHORS.boatBelow).
 */
export const LIGHT_SPOTS = Object.freeze({ lampGlass: 35, smallLampGlass: 19.5, boatLantern: Object.freeze([-13.5, -8]) });

/** Where something that moves is drawn this frame: between its last two ticks. [x, y] */
export function drawnAt(o, alpha) {
  return [lerp(o.px, o.x, alpha), lerp(o.py, o.y, alpha)];
}

/** The lamps' flicker this frame (a multiplier on their reach), from the view's clock (ms): two waves, a slow one and a quick one. */
export function flickerAt(now, look = LOOK) {
  const slow = look.flickerSlowShare;
  return 1 + look.flicker * (Math.sin(now / look.flickerSlowMs) * slow + Math.sin(now / look.flickerFastMs) * (1 - slow));
}

/** A boat's rise and fall on the swell this frame (whole px), from the view's clock (ms). */
export function boatBobAt(now, look = LOOK) {
  return Math.round(Math.sin(now / look.boatBobMs) * look.boatBob);
}

/** Ground characters a dirt path runs into without a grass edge (data/hub.js HUB_TERRAIN). */
const PAVED = new Set([':', 'o', 'q', '=']);

function at(hub, x, y) {
  const row = hub.map[y];
  return row === undefined || x < 0 || x >= row.length ? null : row[x];
}

/** The path piece for a ':' tile: 'c', an edge ('n', 'e', 's', 'w'), a corner ('nw'...), or an inside corner ('in_nw'...). */
export function pathPiece(hub, x, y) {
  const paved = (dx, dy) => { const c = at(hub, x + dx, y + dy); return c === null || PAVED.has(c); };
  const n = paved(0, -1), s = paved(0, 1), w = paved(-1, 0), e = paved(1, 0);
  // A path one tile wide has no piece with grass on both sides: it stays plain.
  if ((!n && !s) || (!w && !e)) return 'c';
  if (!n && !w) return 'nw';
  if (!n && !e) return 'ne';
  if (!s && !w) return 'sw';
  if (!s && !e) return 'se';
  if (!n) return 'n';
  if (!s) return 's';
  if (!w) return 'w';
  if (!e) return 'e';
  if (!paved(-1, -1)) return 'in_nw';
  if (!paved(1, -1)) return 'in_ne';
  if (!paved(1, 1)) return 'in_se';
  if (!paved(-1, 1)) return 'in_sw';
  return 'c';
}

/** The ground frame for a tile, or null for water (drawn by its own layer). */
export function groundFrame(hub, x, y) {
  const c = at(hub, x, y);
  const h = tileHash(x, y);
  switch (c) {
    case ',': return 'hub_flowers';
    case ':': return `hub_path_${pathPiece(hub, x, y)}`;
    case 'o': return `hub_setts_${h & 1}`;
    case 'q': return `hub_quay_${h & 1}`;
    case 'w': return `hub_wall_${h & 1}`;
    case '#': return `hub_rock_${h & 3}`;
    case '=': {
      const side = at(hub, x - 1, y) === '=' ? 'r' : 'l';
      return `hub_pier_${side}${y % 2 === 0 ? '_post' : ''}`;
    }
    case '~': return null;
    default: return h % 5 === 0 ? 'hub_grass_1' : 'hub_grass_0';   // grass, and under trees, bushes, fences
  }
}

/** What stands on a tile, drawn over the ground and sorted with the people: a tree, a bush, a fence. */
export function objectFrame(hub, x, y) {
  const c = at(hub, x, y);
  if (c === 'T') {
    const h = tileHash(x, y) % 20;
    return h < 10 ? 'hub_tree_round' : h < 17 ? 'hub_tree_pine' : 'hub_tree_small';
  }
  if (c === 't') return 'hub_bush';
  if (c === 'f') {
    const l = at(hub, x - 1, y) === 'f', r = at(hub, x + 1, y) === 'f';
    return l && r ? 'hub_fence_m' : r ? 'hub_fence_l' : l ? 'hub_fence_r' : 'hub_fence_post';
  }
  return null;
}

/** Every frame id the harbor's ground and objects can use (the art test checks each exists). */
export function hubTileFrames() {
  const ids = ['hub_grass_0', 'hub_grass_1', 'hub_flowers', 'hub_setts_0', 'hub_setts_1', 'hub_quay_0', 'hub_quay_1', 'hub_wall_0', 'hub_wall_1', 'hub_rock_0', 'hub_rock_1', 'hub_rock_2', 'hub_rock_3',
    'hub_pier_l', 'hub_pier_l_post', 'hub_pier_r', 'hub_pier_r_post', 'hub_tree_round', 'hub_tree_pine', 'hub_tree_small', 'hub_bush',
    'hub_fence_l', 'hub_fence_m', 'hub_fence_r', 'hub_fence_post', 'hub_water_0', 'hub_water_1', 'hub_water_2'];
  for (const k of ['c', 'n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se', 'in_nw', 'in_ne', 'in_se', 'in_sw']) ids.push(`hub_path_${k}`);
  return ids;
}

// ---------------------------------------------------------------- buildings, lights, the camera

/**
 * A building's look at a level: { frame, scaffold }. The scaffold stage is the ruin with the
 * scaffold over it; the Lamp Post is the town lamp, dim until its first level.
 */
export function stageFrames(building, level) {
  if (building === 'lamp_post') return { frame: level > 0 ? 'hub_lamp' : 'hub_lamp_dim', scaffold: false };
  const stage = buildingStage(level);
  return { frame: `bld_${building}_${stage === 'scaffold' ? 'ruin' : stage}`, scaffold: stage === 'scaffold' };
}

/**
 * How a building draws this frame (the view does exactly this): `upper`, the stage on top, shown
 * from the ground up to `reveal` (0..1); `lower`, the stage under it while a new one rises (or
 * null); and the scaffold (null, or how far below its place it is, px, and how solid). `cer` is
 * the ceremony timeline for this building, or null.
 */
export function buildingDraw(building, level, cer = null, look = LOOK) {
  const canScaffold = building !== 'lamp_post';
  if (!cer) {
    const z = stageFrames(building, level);
    return { lower: null, upper: z.frame, reveal: 1, scaffold: canScaffold && z.scaffold ? { drop: 0, alpha: 1 } : null };
  }
  const a = stageFrames(building, cer.from), z = stageFrames(building, cer.level);
  const k = Math.min(1, Math.max(0, cer.build));
  // The first level: the scaffold goes up over the ruin (it rises into place and firms up).
  if (z.scaffold && !a.scaffold) return { lower: null, upper: a.frame, reveal: 1, scaffold: { drop: Math.round((1 - k) * look.scaffoldDrop), alpha: Math.min(1, k * 2) } };
  // Any other: the new stage rises over the old, and a scaffold on the old one fades as it goes.
  return { lower: k < 1 ? a.frame : null, upper: z.frame, reveal: k, scaffold: canScaffold && a.scaffold && k < 1 ? { drop: 0, alpha: 1 - k } : null };
}

/**
 * Where a scaffold's frame goes over a plot (world px, its top left), `drop` px below its place: its
 * drawing covers the plot exactly, and the outline round the drawing (tools/atlas outlines it, a
 * pixel a side) spills past the plot's edges. `frame` is { w, h }.
 */
export function scaffoldAt(plot, frame, drop = 0) {
  return [plot.x * 16 - (frame.w - plot.w * 16) / 2, plot.y * 16 - (frame.h - plot.h * 16) / 2 + drop];
}

/** How far the town lamp's light reaches (px) at a Lamp Post level: the square at first, the town at the end. */
export function lampRadius(level, look = LOOK) {
  return look.lampReach + look.lampReachPerLevel * Math.max(0, Math.min(5, level | 0));
}

/**
 * The town lamp's light this frame: { r, alpha }. During the Lamp Post's ceremony it swells from
 * the old level's reach to the new one's with the build (and a first level brings it up from dim).
 */
export function lampLight(level, cer, look = LOOK) {
  if (!cer) return { r: lampRadius(level, look), alpha: level > 0 ? 1 : look.lampDim };
  const k = Math.min(1, Math.max(0, cer.build));
  return { r: lampRadius(cer.from, look) + (lampRadius(cer.level, look) - lampRadius(cer.from, look)) * k, alpha: cer.from > 0 ? 1 : look.lampDim + (1 - look.lampDim) * k };
}

/**
 * How bright a boat coming in is drawn in the fog (0..1). It sits over the fog and the light map,
 * so out in the fog it carries its own shade: never brighter than the night's, and darker the
 * thicker the fog where it is (where the fog is clear it's lit as the light map lights the water:
 * boatTint).
 */
export function boatShade(fog, look = LOOK) {
  return clamp01(Math.min(look.boatNight, 1 - look.boatInFog * clamp01(fog)));
}

/**
 * Every light of the harbor this frame, in world px: [{ x, y, r, color, alpha, steady? }]. The town lamp
 * (its reach by the Lamp Post's level, swelling through its ceremony) and its white middle, your
 * lantern (at `you`, its feet), each building's windows and door lantern (coming up through a
 * ceremony), the small lamps (tiles), and a boat's lantern (at `arrival`'s halo while it's lit;
 * arrivalLook, or null for no boat). The view draws these into the light map, their reach times a flicker (not the `steady` white middle);
 * lightAt adds them up the same way (for the preview, and for a newcomer drawn over the light map).
 */
export function harborLights({ hub, levels, cer = null, you, arrival = null, look = LOOK }) {
  const out = [];
  const lp = hub.plots.find((p) => p.building === 'lamp_post');
  const lamp = lampLight(levels.lamp_post ?? 0, cer && cer.building === 'lamp_post' ? cer : null, look);
  const lampColor = lookColor(look.lampColor), windowColor = lookColor(look.windowColor);
  const lx = lp.x * 16 + 8, ly = (lp.y + 1) * 16 - LIGHT_SPOTS.lampGlass;
  out.push({ x: lx, y: ly, r: lamp.r, color: lampColor, alpha: lamp.alpha });
  out.push({ x: lx, y: ly, r: look.lampCoreReach, color: 0xffffff, alpha: look.lampCoreLight, steady: true });
  out.push({ x: you.x, y: you.y - ANCHORS.middle, r: look.lanternReach, color: lampColor, alpha: look.lanternLight });
  for (const p of hub.plots) {
    for (const L of lightsNow(p, levels[p.building] ?? 0, cer && cer.building === p.building ? cer : null, look)) {
      out.push({ x: L.x, y: L.y, r: L.r, color: L.kind === 'door' ? lampColor : windowColor, alpha: look.windowLight * L.alpha });
    }
  }
  for (const [tx, ty] of [hub.gate.lamp, hub.harbor.lamp].filter(Boolean)) {
    out.push({ x: tx * 16 + 8, y: (ty + 1) * 16 - ANCHORS.smallLampLift - LIGHT_SPOTS.smallLampGlass, r: look.smallLampReach, color: lampColor, alpha: look.smallLampLight });
  }
  // A boat coming in: its stern lantern, lit until the camera heads back (arrivalLook).
  if (arrival?.lantern) out.push({ x: arrival.halo.x, y: arrival.halo.y, r: look.boatLanternReach, color: lampColor, alpha: look.boatLanternLight });
  return out;
}

/** Where the camera looks this frame, between its last two ticks: the set piece's camera while one runs, else you. */
export function cameraAt(world, alpha) {
  if (world.timeline) return [lerp(world.cam.px, world.cam.x, alpha), lerp(world.cam.py, world.cam.y, alpha)];
  return [lerp(world.player.px, world.player.x, alpha), lerp(world.player.py, world.player.y, alpha)];
}

/**
 * An arrival this frame (tl: the world's arrival; harbor: data/hub.js's harbor): where the boat
 * is, between its last two ticks (`boat`, its route point) and where its sprite stands (`draw`,
 * its bottom middle, risen or fallen `bob` px on the swell: boatBobAt); the newcomer standing in
 * it (`passenger`: her cut line at the gunwale, `aboard` px ahead of its middle) until it lands,
 * then walking up (between ticks) until she reaches her spot, where her waiting figure takes over
 * on the same tick; the boat's shade by the fog where it is (`fogAt(x, y)`: boatShade; its tint,
 * lit by the harbor's lights as well, is boatTint); its lantern's spot (`halo`, where the light and
 * the halo go, on the swell with the boat) and the halo's strength; the lantern lit until the
 * camera heads back.
 */
export function arrivalLook(tl, alpha, fogAt, harbor, look = LOOK, bob = 0) {
  const [x, y] = drawnAt(tl.boat, alpha);
  const onBoard = tl.phase === 'panIn' || tl.phase === 'sail';
  const d = fogAt(x, y);
  const shade = boatShade(d, look);
  return {
    boat: { x, y },
    draw: { x: Math.round(x), y: Math.round(y) + ANCHORS.boatBelow + bob },
    passenger: onBoard ? { x: x + (harbor.aboard ?? 0), y: y - ANCHORS.gunwale + ANCHORS.boatBelow + bob } : null,
    walker: !onBoard && tl.phase !== 'panOut'
      ? { x: lerp(tl.walker.px, tl.walker.x, alpha), y: lerp(tl.walker.py, tl.walker.y, alpha), facing: tl.walker.facing, moving: !!tl.walker.moving }
      : null,
    shade,
    halo: { x: x + LIGHT_SPOTS.boatLantern[0], y: y + LIGHT_SPOTS.boatLantern[1] + bob },
    glow: tl.phase === 'panOut' ? 0 : clamp01(look.boatGlow + look.boatGlowInFog * d),
    lantern: tl.phase !== 'panOut',
  };
}

/**
 * The light map at a world point this frame, [r, g, b] (0..1): the night's ambient plus each light
 * (harborLights) falling off the way its glow does (render/textures.js glowAt), its reach times the
 * flicker unless it's steady, capped at 1 as the multiply is. The view draws the same sum into its
 * light map; this is for what's drawn over the light map and must match it (a newcomer in the
 * boat), and for the preview.
 */
export function lightAt(x, y, lights, look = LOOK, flick = 1) {
  let [r, g, b] = ambientLight(look);
  for (const L of lights) {
    const reach = L.r * (L.steady ? 1 : flick);
    if (!(reach > 0)) continue;
    const dx = x - L.x, dy = y - L.y;
    const k = glowAt(Math.sqrt(dx * dx + dy * dy) / reach) * clamp01(L.alpha);
    if (k === 0) continue;
    r += (((L.color >> 16) & 255) / 255) * k;
    g += (((L.color >> 8) & 255) / 255) * k;
    b += ((L.color & 255) / 255) * k;
  }
  return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
}

/**
 * The tint of something drawn over the light map at (x, y), 0xRRGGBB: lit like the ground there
 * (lightAt) where the fog is clear, `shade` (0..1, grey) where it's thick, and between the two at
 * the fog's soft edge.
 */
export function litOver(x, y, shade, lights, fogAt, look = LOOK, flick = 1) {
  const light = lightAt(x, y, lights, look, flick);
  const k = clamp01(fogAt(x, y));
  const [r, g, b] = light.map((v) => Math.round(255 * clamp01(v + (shade - v) * k)));
  return (r << 16) | (g << 8) | b;
}

/**
 * A boat's tint (its hull's too), 0xRRGGBB: lit at its middle (its route point) as the light map
 * lights the water there, its own lantern and the pier's lamp with the rest, in its shade out in
 * the fog (litOver). Its newcomer is lit the same way a few px off, so she never reads brighter
 * than the boat she stands in.
 */
export function boatTint(arrival, lights, fogAt, look = LOOK, flick = 1) {
  return litOver(arrival.boat.x, arrival.boat.y, arrival.shade, lights, fogAt, look, flick);
}

/**
 * A newcomer's tint while she's drawn over the light map (standing in the boat, and stepping off
 * it), 0xRRGGBB, or null when she isn't: litOver at her middle, in her boat's shade in the fog.
 * On the pier the fog is clear, so she looks the same the tick she walks out under the light map.
 */
export function newcomerTint(arrival, lights, fogAt, look = LOOK, flick = 1) {
  const feet = arrival.passenger ? { x: arrival.passenger.x, y: arrival.passenger.y + ANCHORS.cut } : arrival.walker;
  if (!feet) return null;
  return litOver(feet.x, feet.y - ANCHORS.middle, arrival.shade, lights, fogAt, look, flick);
}

/**
 * How far a newcomer walking up is clear of her boat, px: 0 while her frame and the boat's
 * overlap (she's still in front of it), then the gap between them (`walker` her feet; `draw` the
 * boat's bottom middle, arrivalLook's; sizes in px, her frame with `feetRoom` below her feet).
 */
export function clearOfBoat(walker, draw, person, feetRoom, boat) {
  const top = walker.y - (person.h - feetRoom), bottom = walker.y + feetRoom;
  const left = walker.x - person.w / 2, right = walker.x + person.w / 2;
  const gx = Math.max(left - (draw.x + boat.w / 2), draw.x - boat.w / 2 - right, 0);
  const gy = Math.max(top - draw.y, draw.y - boat.h - bottom, 0);
  return Math.max(gx, gy);
}

/**
 * How solid a newcomer stepping off is drawn over her boat (0..1), from how far she's clear of it:
 * whole while she's in front of it (the hull never covers her on her way out, as it didn't while
 * she stood in it), then fading out over `fade` px as she walks on, lit by the light map under
 * it. The two are nearly the same (newcomerTint), so the fade hides what small difference there is.
 */
export function steppingAlpha(clear, fade) {
  if (!(clear > 0)) return 1;
  return fade > 0 ? clamp01(1 - clear / fade) : 0;
}

/** When someone on the square appears (the view fades them in from then): now, or already there for the newcomer who just walked up. */
export function appearsAt(id, arrivalId, time) {
  return id === arrivalId ? -Infinity : time;
}

/** A person's own place in the walking hop (seconds), so everyone steps out of time with everyone else, and never faster as they move. */
export function hopPhase(id, stepsPerSec = LOOK.hopStepsPerSec) {
  return (fnv1a(String(id)) % 997) / 997 / stepsPerSec;
}

/**
 * The lights a building gives at a level, in world px: its windows once lit (level 3), and the
 * lantern by its door from level 4. [{ x, y, r, kind: 'window' | 'door' }]
 */
export function plotLights(plot, level, look = LOOK) {
  const out = [];
  if (plot.building === 'lamp_post') return out;
  if (level >= 3) for (const [wx, wy] of plot.windows || []) out.push({ x: (plot.x + wx) * 16 + 8, y: (plot.y + wy) * 16 + 8, r: look.windowReach, kind: 'window' });
  if (level >= 4) {
    // The wall lantern the art hangs right of the door (tools/atlas dressBuilding: 12 px in, 1 down).
    const dx = plot.door[0] - plot.x, dy = plot.door[1] - 1 - plot.y;
    out.push({ x: (plot.x + dx) * 16 + 14, y: (plot.y + dy) * 16 + 4, r: look.doorReach, kind: 'door' });
  }
  return out;
}

/**
 * A building's lights this frame: those of its level (or, during its ceremony, of the new level),
 * each with how bright (0..1): the ones it already had at full, the new ones coming up with the
 * build. [{ x, y, r, kind, alpha }]
 */
export function lightsNow(plot, level, cer = null, look = LOOK) {
  if (!cer) return plotLights(plot, level, look).map((l) => ({ ...l, alpha: 1 }));
  const had = plotLights(plot, cer.from, look).length;
  const k = Math.min(1, Math.max(0, cer.build));
  return plotLights(plot, cer.level, look).map((l, i) => ({ ...l, alpha: i < had ? 1 : k }));
}

/** The camera's center, kept inside the map so the view never shows past its edge. */
export function clampCamera(x, y, mapW, mapH, viewW, viewH) {
  const cx = mapW <= viewW ? mapW / 2 : Math.min(Math.max(x, viewW / 2), mapW - viewW / 2);
  const cy = mapH <= viewH ? mapH / 2 : Math.min(Math.max(y, viewH / 2), mapH - viewH / 2);
  return [cx, cy];
}

/** How ragged the fog's edge is by default (the look's fogFray and fogCreep). */
export const FOG_FRAY = LOOK.fogFray;
export const FOG_CREEP = LOOK.fogCreep;

const NEAR = new WeakMap();   // map -> nearBuildings(map), worked out once per map

/** 1 for every tile of a building or ruin and the ring of tiles around it (the fog there stays exact). */
function nearBuildings(map) {
  if (NEAR.has(map)) return NEAR.get(map);
  const { cols, rows } = map;
  const near = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!map.footprint[y * cols + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) near[ny * cols + nx] = 1;
    }
  }
  NEAR.set(map, near);
  return near;
}

/**
 * Fog density per tile (0 clear .. 1 thick), for a set of cleared regions and the ones still
 * fading out (regionId -> 1..0). A tile under several regions takes the thinnest.
 *
 * The regions are rectangles; the edge between clear ground and fog is made ragged so the town
 * doesn't read as boxes: a fog tile beside clearer ground thins toward it (by up to FOG_FRAY) and
 * a clear tile beside thicker fog takes some of it (up to FOG_CREEP), each by the tile's own hash,
 * and in step with a fade. Never on a building or ruin or the ring of tiles around it, so a
 * building is all clear or all fogged (§20 call 54). Only the look: walking goes by the regions.
 */
export function fogDensity(map, revealed, fading, out = new Float32Array(map.cols * map.rows), look = LOOK) {
  const { cols, rows } = map;
  const alpha = map.regionIds.map((id) => (fading.has(id) ? fading.get(id) : revealed.has(id) ? 0 : 1));
  const base = new Float32Array(cols * rows);
  for (let i = 0; i < base.length; i++) {
    let d = 1;
    const bits = map.regions[i];
    if (bits) for (let k = 0; k < alpha.length; k++) if ((bits & (1 << k)) !== 0 && alpha[k] < d) d = alpha[k];
    base[i] = d;
  }
  const near = nearBuildings(map);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, d = base[i];
    if (near[i]) { out[i] = d; continue; }
    let lo = d, hi = d;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = base[ny * cols + nx];
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
    const h = tileHash(x + 101, y + 57);
    out[i] = d - look.fogFray * ((h & 255) / 255) * (d - lo) + look.fogCreep * (((h >>> 8) & 255) / 255) * (hi - d);
  }
  return out;
}

/**
 * The fog's density at a world point, from a density grid a texel a tile, as the view draws it:
 * each texel at its tile's middle and smooth between them (the mask is scaled up with linear
 * filtering, clamped at the map's edge), so a boat's shade glides through the fog's edge rather
 * than stepping a tile at a time. Off the map is fog (1).
 */
export function fogAtPoint(density, cols, rows, x, y) {
  if (!(x >= 0 && y >= 0 && x < cols * 16 && y < rows * 16)) return 1;
  const fx = x / 16 - 0.5, fy = y / 16 - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const at = (tx, ty) => density[Math.min(rows - 1, Math.max(0, ty)) * cols + Math.min(cols - 1, Math.max(0, tx))];
  return (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
}

/**
 * The fog's clear mask from its density (a texel a tile), RGBA bytes written in place: white at
 * how clear each tile is (1 - its density). The view draws the fog whole (a flat fill at the
 * look's fogDensity, the wisps over it) and erases it by this mask, so what's left on screen is
 * each tile's density times the fog's thickness, wisps and all.
 */
export function fogPixels(density, clear) {
  for (let i = 0; i < density.length; i++) {
    clear[i * 4] = clear[i * 4 + 1] = clear[i * 4 + 2] = 255;
    clear[i * 4 + 3] = Math.round((1 - density[i]) * 255);
  }
}

/**
 * Whether the fog's clear mask needs drawing again: after a new set of cleared regions, every
 * frame while a region fades (and once more after, for the fade's end or a skip), and when its
 * ragged edge is tuned (its thickness is the fill's alpha, set every frame). `state` is what the
 * mask was last drawn for (null before the first draw). Returns the state to draw it for now, or
 * null to keep it.
 */
export function fogRedraw(state, world, look) {
  const fading = world.fogFade.size > 0;
  const edge = `${look.fogFray},${look.fogCreep}`;
  if (state && state.revealed === world.revealed && !fading && !state.fading && state.edge === edge) return null;
  return { revealed: world.revealed, fading, edge };
}
