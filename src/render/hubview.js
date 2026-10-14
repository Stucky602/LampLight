// The harbor, drawn (ARCHITECTURE §10.4). Reads the hub world (src/hub/world.js) and the building
// levels; writes nothing back.
//
// Layers, bottom to top:
//   the sea (three frames of swell, drifting) · the ground (one texture, drawn once) · everything
//   that stands up, sorted by where its feet are: trees, fences, props, the buildings at their
//   stages (a scaffold over a ruin; during a ceremony the new stage rises over the old), the lamps,
//   the keepers and the characters waiting, and you · chimney smoke and building dust · the light
//   map (multiplied: the night, and the lamps' pools) · the fog over the regions not yet clear,
//   thick, soft at its edge, drifting, thinning as a region peels back · a boat coming in, and
//   whoever is in it (over the fog: a lantern out in the mist).
// Prompts, panels, and the materials bar are DOM (ui/hubhud.js), placed with toView().
//
// What a building shows and how its lights come up (during a ceremony too), every light and how
// bright, where the camera looks, an arrival's boat and newcomer, when someone appears, each
// person's step, the camera's limits, and the fog's density are pure (render/hubtiles.js, tested);
// this file only draws. How it looks is data (data/tuning.js HUB_TUNING.look), read every frame from
// the harbor's live tuning, so the tuning panel's changes show at once. Anything that moves
// between ticks (you, the people, the camera, the boat, a newcomer walking up) is drawn between
// its last two positions, so a fast monitor sees it glide.
//
// Every part of the scene has a label (Pixi's `label`: 'you', 'boat', 'stage:library', ...), so
// the gate runs this file on Pixi's own scene graph and checks what it drew (tests/hubview.test.js).

import { Container, Graphics, Sprite, Texture, TilingSprite, RenderTexture, Rectangle } from 'pixi.js';
import { VIEW_W, VIEW_H, MARGIN, splitCamera } from './layout.js';
import { color as pal } from '../data/palette.js';
import {
  groundFrame, objectFrame, buildingDraw, harborLights, cameraAt, arrivalLook, appearsAt, hopPhase, clampCamera, fogDensity, lookColor, ambientLight,
  ANCHORS, drawnAt, flickerAt, boatBobAt, fogAtPoint, fogPixels, fogRedraw, newcomerTint, boatTint, clearOfBoat, steppingAlpha, scaffoldAt,
} from './hubtiles.js';
import { PLAYER_FEET_ROOM } from './playerframe.js';
import { stepHop } from './viewstate.js';

const TILE = 16;
const LIGHT_W = Math.ceil((VIEW_W + MARGIN * 2) / 2) + 1;
const LIGHT_H = Math.ceil((VIEW_H + MARGIN * 2) / 2) + 1;

/** A swell past 1 and back: how a prop pops in (`c`, how far past; 0 for none). */
const easeOutBack = (t, c) => { const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

/** A node with its label (tests/hubview.test.js finds the scene's parts by these). */
const named = (node, label) => { node.label = label; return node; };

/** A texture drawn into a canvas from atlas frames (skipping Pixi's global cache). */
function canvasTexture(owned, w, h, paint, { repeat = false, linear = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), c);
  const t = Texture.from(c, true);
  t.source.scaleMode = linear ? 'linear' : 'nearest';
  if (repeat) t.source.addressMode = 'repeat';
  owned.push(t);
  return t;
}

/**
 * tuning: the harbor's live tuning ({ timing, look }, the shape of data/tuning.js HUB_TUNING; the
 * app's copy the tuning panel changes), read every frame. Defaults to the data's.
 */
export function createHubView({ renderer, atlas, data, tuning = data.hubTuning }) {
  const hub = data.hub;
  let LOOK = tuning.look;          // this frame's look (draw() reads it again each frame)
  const avatar = data.characters.find((c) => c.id === hub.avatar)?.sprite;
  if (!avatar) throw new Error(`hub view: the harbor's avatar "${hub.avatar}" is not a character`);
  const cols = hub.map[0].length, rows = hub.map.length;
  const mapW = cols * TILE, mapH = rows * TILE;
  const T = (id) => atlas.tex(id);
  const owned = [];
  const img = atlas.source.resource;
  const drawFrame = (g, id, x, y) => { const r = atlas.rect(id); g.drawImage(img, r.x, r.y, r.w, r.h, x, y, r.w, r.h); };
  const glowRadius = atlas.glow.frame.width / 2;   // px: a glow sprite at scale 1 reaches this far

  const root = named(new Container(), 'harbor');
  // The sea: three canvases of 64 x 64 (the frame repeated) as tiling textures.
  const waterTex = [0, 1, 2].map((k) => canvasTexture(owned, 64, 64, (g) => {
    for (let y = 0; y < 64; y += TILE) for (let x = 0; x < 64; x += TILE) drawFrame(g, `hub_water_${k}`, x, y);
  }, { repeat: true }));
  const water = named(new TilingSprite({ texture: waterTex[0], width: mapW, height: mapH }), 'sea');
  // The ground: every tile once (the sea's tiles left empty so the swell shows through).
  const groundTex = canvasTexture(owned, mapW, mapH, (g) => {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const id = groundFrame(hub, x, y);
      if (id) drawFrame(g, id, x * TILE, y * TILE);
    }
  });
  const ground = named(new Sprite(groundTex), 'ground');
  const actors = named(new Container(), 'actors');
  actors.sortableChildren = true;
  const dustLayer = named(new Container(), 'puffs');
  const dustG = new Graphics();
  dustLayer.addChild(dustG);

  // The light map and the fog, each rendered into its own half-size texture every frame.
  const lightRT = RenderTexture.create({ width: LIGHT_W, height: LIGHT_H });
  lightRT.source.scaleMode = 'linear';
  const lightSprite = named(new Sprite(lightRT), 'light');
  lightSprite.blendMode = 'multiply';
  lightSprite.scale.set(2);
  const lightRoot = named(new Container(), 'light-map');
  const lightsC = new Container();
  lightsC.blendMode = 'add';
  lightRoot.addChild(lightsC);
  const lightPool = [];

  const fogRT = RenderTexture.create({ width: LIGHT_W, height: LIGHT_H });
  fogRT.source.scaleMode = 'linear';
  const fogSprite = named(new Sprite(fogRT), 'fog');
  fogSprite.scale.set(2);
  const fogRoot = named(new Container(), 'fog-layer');
  // The fog is drawn whole (a flat fill at the look's thickness, the drifting wisps over it), then
  // erased by how clear each tile is, so what shows is the density times the thickness (§10.4):
  // the erase scales everything under it, which is why nothing density-shaped is drawn before it.
  // The clear mask is one tiny canvas, a texel a tile, drawn scaled up with smoothing, so every
  // edge is soft.
  const fogFill = named(new Sprite(Texture.WHITE), 'fog-fill');
  fogFill.width = LIGHT_W; fogFill.height = LIGHT_H;
  const wisps = named(new TilingSprite({ texture: atlas.fog, width: LIGHT_W, height: LIGHT_H }), 'fog-wisps');
  const clearCanvas = document.createElement('canvas'); clearCanvas.width = cols; clearCanvas.height = rows;
  const clearTex = Texture.from(clearCanvas, true); clearTex.source.scaleMode = 'linear'; owned.push(clearTex);
  const clearSprite = named(new Sprite(clearTex), 'fog-clear');
  clearSprite.blendMode = 'erase';
  fogRoot.addChild(fogFill, wisps, clearSprite);
  const density = new Float32Array(cols * rows);
  const clearPixels = clearCanvas.getContext('2d').createImageData(cols, rows);
  let fogState = null;   // what the clear mask was last drawn for (fogRedraw)

  // A boat coming in is drawn over the fog (a lantern out in the mist), shaded by how thick the
  // fog is where it is; its passenger rides in it until she steps onto the pier.
  const boatLayer = named(new Container(), 'boat-layer');
  const boatGlow = named(new Sprite(atlas.glow), 'boat-halo');
  boatGlow.anchor.set(0.5);
  boatGlow.blendMode = 'add';
  root.addChild(water, ground, actors, dustLayer, lightSprite, fogSprite, boatLayer);

  // ---------------------------------------------------------------- what stands up

  const feet = (sprite, foot) => { sprite.zIndex = foot; actors.addChild(sprite); return sprite; };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const id = objectFrame(hub, x, y);
    if (!id) continue;
    const s = named(new Sprite(T(id)), `object:${x},${y}`);
    s.position.set(x * TILE, y * TILE);
    feet(s, (y + 1) * TILE);
  }
  // Buildings: a sprite for the stage below (during a ceremony) and one on top, a scaffold, and a
  // mask for the stage on top while it rises (only then; the rest of the time nothing is masked).
  const plots = hub.plots.map((p) => {
    const lower = feet(named(new Sprite(), `stage-below:${p.building}`), (p.y + p.h) * TILE - 0.02);
    const upper = feet(named(new Sprite(), `stage:${p.building}`), (p.y + p.h) * TILE - 0.01);
    const scaffold = feet(named(new Sprite(T('hub_scaffold_5x4')), `scaffold:${p.building}`), (p.y + p.h) * TILE);
    const mask = named(new Graphics(), `rise-mask:${p.building}`);
    mask.visible = false;
    root.addChild(mask);
    return { p, lower, upper, scaffold, mask, maskEdge: NaN, maskH: 0, smoke: 0 };
  });
  const lampPlot = hub.plots.find((p) => p.building === 'lamp_post');
  /** A stage's frame on its plot: the Lamp Post's lamp stands on its tile; a building fills its plot. */
  const place = (s, p, id) => {
    s.texture = T(id);
    if (p === lampPlot) { s.anchor.set(0.5, 1); s.position.set(p.x * TILE + 8, (p.y + 1) * TILE); } else s.position.set(p.x * TILE, p.y * TILE);
  };
  for (const r of hub.ruins) {
    const s = named(new Sprite(T(`bld_${r.id}_ruin`)), `ruin:${r.id}`);
    s.position.set(r.x * TILE, r.y * TILE);
    feet(s, (r.y + r.h) * TILE);
  }
  // Small lamps: the gate's (on the sea wall) and the pier's end.
  for (const [where, at] of [['gate', hub.gate.lamp], ['pier', hub.harbor.lamp]]) {
    if (!at) continue;
    const [x, y] = at;
    const s = named(new Sprite(T('prop_lamppost')), `small-lamp:${where}`);
    s.anchor.set(0.5, 1);
    s.position.set(x * TILE + 8, (y + 1) * TILE - ANCHORS.smallLampLift);
    feet(s, (y + 1) * TILE);
  }
  const propSprites = new Map();     // prop id -> { sprite, born, seen }
  const people = new Map();          // person id -> { sprite, born, seen }
  /** A person's sprite, stood by their feet (the frame keeps a little room below them). */
  const standUp = (s, tex) => { s.texture = tex; s.anchor.set(0.5, (tex.frame.height - PLAYER_FEET_ROOM) / tex.frame.height); return s; };
  const makePerson = (tex, label) => {
    const s = standUp(named(new Sprite(), label), tex);
    actors.addChild(s);
    return s;
  };
  const player = makePerson(T(avatar), 'you');
  const walker = makePerson(T(avatar), 'walker');
  walker.visible = false;
  // A newcomer standing in the boat: her frame cut off at the knees, so she stands in the hull.
  const passenger = named(new Sprite(T(avatar)), 'passenger');
  passenger.anchor.set(0.5, 1);
  // ...and stepping off it: drawn over the boat, whole, until she's clear of it (then fading).
  const stepping = standUp(named(new Sprite(), 'stepping-off'), T(avatar));
  stepping.visible = false;
  const standing = new Map();
  const standingIn = (id) => {
    let t = standing.get(id);
    if (!t) {
      const r = atlas.rect(id);
      t = new Texture({ source: atlas.source, frame: new Rectangle(r.x, r.y, r.w, r.h - PLAYER_FEET_ROOM - ANCHORS.cut) });
      standing.set(id, t);
    }
    return t;
  };
  const boat = named(new Sprite(T('hub_boat')), 'boat');
  boat.anchor.set(0.5, 1);
  // The hull from the gunwale down, drawn again over whoever is stepping off: it hides her feet
  // where the hull is in front of them, and they show as she walks clear of it.
  const hullFrame = atlas.rect('hub_boat');
  const hullTex = new Texture({ source: atlas.source, frame: new Rectangle(hullFrame.x, hullFrame.y + hullFrame.h - ANCHORS.gunwale, hullFrame.w, ANCHORS.gunwale) });
  const hull = named(new Sprite(hullTex), 'boat-hull');
  hull.anchor.set(0.5, 1);
  boatLayer.addChild(boat, passenger, stepping, hull, boatGlow);
  boatLayer.visible = false;

  // Smoke and dust: a few puffs, drawn as small squares with Graphics (never many).
  const puffs = [];
  const puff = (x, y, vx, vy, kind) => {
    if (puffs.length < LOOK.puffs.max) puffs.push({ x, y, vx, vy, t: 0, life: kind.life, size: kind.size, col: pal(kind.color) });
  };

  let world = null;
  let levels = {};
  let now = 0;
  let frameNo = 0;
  let camX = 0, camY = 0;
  let arrivalId = null;              // the newcomer last seen walking up: she takes her place without fading in
  let arrival = null;                // this frame's arrivalLook (the boat, for the light map), or null
  const origin = { x: 0, y: 0 };
  const stats = { lights: 0, jsMs: 0 };

  function levelOf(id) { return Math.max(0, levels[id] | 0); }
  function ceremonyFor(building) {
    const tl = world.timeline;
    return tl && tl.kind === 'ceremony' && tl.building === building ? tl : null;
  }

  // ---------------------------------------------------------------- per frame

  function drawBuildings(dt) {
    const dust = LOOK.dust, smoke = LOOK.smoke;
    for (const b of plots) {
      const { p } = b;
      const cer = ceremonyFor(p.building);
      const d = buildingDraw(p.building, levelOf(p.building), cer, LOOK);
      place(b.upper, p, d.upper);
      b.upper.visible = d.reveal > 0;
      b.lower.visible = d.lower !== null;
      if (d.lower) place(b.lower, p, d.lower);
      b.scaffold.visible = d.scaffold !== null;
      if (d.scaffold) {
        const f = b.scaffold.texture.frame;
        b.scaffold.position.set(...scaffoldAt(p, { w: f.width, h: f.height }, d.scaffold.drop));
        b.scaffold.alpha = d.scaffold.alpha;
      }
      // The new stage rises from the ground up over the old one, with dust along the line.
      if (d.reveal > 0 && d.reveal < 1) {
        const h = b.upper.texture.frame.height, w = b.upper.texture.frame.width;
        const top = p === lampPlot ? (p.y + 1) * TILE - h : p.y * TILE;
        const left = p === lampPlot ? p.x * TILE + 8 - w / 2 : p.x * TILE;
        const edge = top + h * (1 - d.reveal);
        if (b.maskEdge !== edge || b.maskH !== h) { b.mask.clear().rect(left - 1, edge - 1, w + 2, h * d.reveal + 2).fill(0xffffff); b.maskEdge = edge; b.maskH = h; }
        if (b.upper.mask !== b.mask) { b.mask.visible = true; b.upper.mask = b.mask; }
        if (Math.random() < dt * dust.perSec) {
          puff(left + Math.random() * w, edge, (Math.random() - 0.5) * dust.spread, -(dust.rise + Math.random() * dust.riseJitter), dust);
        }
      } else if (b.upper.mask) {
        b.upper.mask = null; b.mask.visible = false; b.maskEdge = NaN;
      }
      // Smoke from the chimney once a building is fully alive (in a ceremony, once its stage is up).
      if (p !== lampPlot && (cer ? (cer.build >= 1 ? cer.level : cer.from) : levelOf(p.building)) >= 5) {
        b.smoke -= dt;
        if (b.smoke <= 0) {
          b.smoke = smoke.every + Math.random() * smoke.jitter;
          puff((p.x + p.w / 2) * TILE, p.y * TILE + ANCHORS.smokeFrom, smoke.drift + Math.random() * smoke.driftJitter, -(smoke.rise + Math.random() * smoke.riseJitter), smoke);
        }
      }
    }
  }

  function drawProps() {
    for (const pr of world.props) {
      let e = propSprites.get(pr.id);
      if (!e) {
        const s = named(new Sprite(T(pr.sprite)), `prop:${pr.id}`);
        s.anchor.set(0.5, 1);
        s.position.set(pr.at[0] * TILE + 8, (pr.at[1] + 1) * TILE);
        feet(s, (pr.at[1] + 1) * TILE);
        e = { sprite: s, born: world.time, seen: 0 };
        propSprites.set(pr.id, e);
      }
      e.seen = frameNo;
      const t = (world.time - e.born) / LOOK.popSec;
      e.sprite.scale.set(t >= 1 ? 1 : Math.max(0, easeOutBack(t, LOOK.popOvershoot)));
    }
    for (const [id, e] of propSprites) if (e.seen !== frameNo) { e.sprite.destroy(); propSprites.delete(id); }
  }

  function drawPeople(alpha) {
    const tl = world.timeline;
    if (tl !== null && tl.kind === 'arrival') arrivalId = tl.id;
    for (const person of world.people) {
      let e = people.get(person.id);
      if (!e) {
        // A keeper stepping out fades in; a newcomer who walked up is already there.
        e = { sprite: makePerson(T(person.sprite), `person:${person.id}`), born: appearsAt(person.id, arrivalId, world.time), seen: 0, phase: hopPhase(person.id, LOOK.hopStepsPerSec) };
        people.set(person.id, e);
      }
      e.seen = frameNo;
      const [x, y] = drawnAt(person, alpha);
      const hop = stepHop(!!person.moving, world.time + e.phase, LOOK.hopStepsPerSec);
      e.sprite.position.set(Math.round(x), Math.round(y) - hop);
      e.sprite.scale.x = person.facing < 0 ? -1 : 1;
      e.sprite.zIndex = y;
      e.sprite.alpha = Math.min(1, (world.time - e.born) / LOOK.popSec);
    }
    for (const [id, e] of people) if (e.seen !== frameNo) { e.sprite.destroy(); people.delete(id); }
    // You.
    const p = world.player;
    const [x, y] = drawnAt(p, alpha);
    player.position.set(Math.round(x), Math.round(y) - stepHop(p.moving, world.time, LOOK.hopStepsPerSec));
    player.scale.x = p.facing < 0 ? -1 : 1;
    player.zIndex = y;
  }

  /**
   * An arrival: the boat with the newcomer standing in it (over the fog), then her walk up under
   * the light map with everyone else, drawn over the boat as well while she's still in front of
   * it (fading as she walks clear). She walks until she's at her spot, where the waiting figure
   * takes over on the same tick. (Her tint and the boat's, drawn over the light map, are set with
   * the lights: drawLight.)
   */
  function drawArrival(alpha) {
    const tl = world.timeline;
    arrival = tl !== null && tl.kind === 'arrival' ? arrivalLook(tl, alpha, fogAt, hub.harbor, LOOK, boatBobAt(now, LOOK)) : null;
    boatLayer.visible = arrival !== null;
    walker.visible = stepping.visible = passenger.visible = false;
    if (!arrival) return;
    boat.position.set(arrival.draw.x, arrival.draw.y);
    hull.position.set(arrival.draw.x, arrival.draw.y);
    boatGlow.position.set(Math.round(arrival.halo.x), Math.round(arrival.halo.y));
    boatGlow.scale.set(LOOK.boatHaloReach / glowRadius);
    boatGlow.tint = lookColor(LOOK.lampColor);
    boatGlow.alpha = arrival.glow;
    if (arrival.passenger) {
      passenger.texture = standingIn(tl.sprite);
      passenger.position.set(Math.round(arrival.passenger.x), Math.round(arrival.passenger.y));
      passenger.visible = true;
    }
    if (arrival.walker) {
      // Walking up under the light map, and over the boat as well, whole while she's in front of
      // it and fading out as she walks clear.
      const tex = T(tl.sprite);
      const clear = clearOfBoat(arrival.walker, arrival.draw, { w: tex.frame.width, h: tex.frame.height }, PLAYER_FEET_ROOM, { w: boat.texture.frame.width, h: boat.texture.frame.height });
      const x = Math.round(arrival.walker.x), y = Math.round(arrival.walker.y) - stepHop(arrival.walker.moving, world.time, LOOK.hopStepsPerSec);
      for (const s of [walker, stepping]) {
        standUp(s, tex);
        s.position.set(x, y);
        s.zIndex = arrival.walker.y;
        s.scale.x = arrival.walker.facing < 0 ? -1 : 1;
      }
      walker.visible = true;
      stepping.alpha = steppingAlpha(clear, LOOK.stepOffFade);
      stepping.visible = stepping.alpha > 0;
    }
  }

  /** The fog's density at a point (1 off the map), from the last drawn fog. */
  function fogAt(x, y) { return fogAtPoint(density, cols, rows, x, y); }

  function drawPuffs(dt) {
    const { alpha, grow } = LOOK.puffs;
    dustG.clear();
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.t += dt;
      if (q.t >= q.life) { puffs.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      const a = 1 - q.t / q.life;
      const s = q.size + q.t * grow;
      dustG.rect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), Math.round(s), Math.round(s)).fill({ color: q.col, alpha: alpha * a });
    }
  }

  // ---------------------------------------------------------------- light and fog

  function light(i, x, y, r, rgb, intensity) {
    let s = lightPool[i];
    if (!s) { s = named(new Sprite(atlas.glow), 'light'); s.anchor.set(0.5); lightPool.push(s); lightsC.addChild(s); }
    s.visible = true;
    s.position.set((x - origin.x) / 2, (y - origin.y) / 2);
    s.scale.set(r / (2 * glowRadius));
    s.tint = rgb;
    s.alpha = Math.max(0, Math.min(1, intensity));
    return i + 1;
  }

  function drawLight(alpha, app) {
    let n = 0;
    const flick = flickerAt(now, LOOK);
    // Every light (hubtiles.js harborLights): the town lamp by its level (swelling through its
    // ceremony), your lantern, the windows and door lanterns, the small lamps, a boat's lantern.
    const tl = world.timeline;
    const p = world.player;
    const [yx, yy] = drawnAt(p, alpha);
    const lights = harborLights({ hub, levels, cer: tl && tl.kind === 'ceremony' ? tl : null, look: LOOK, you: { x: yx, y: yy }, arrival });
    for (const L of lights) n = light(n, L.x, L.y, L.r * (L.steady ? 1 : flick), L.color, L.alpha);
    for (let i = n; i < lightPool.length; i++) lightPool[i].visible = false;
    stats.lights = n;
    const [ar, ag, ab] = ambientLight(LOOK);
    app.render({ container: lightRoot, target: lightRT, clear: true, clearColor: [ar, ag, ab, 1] });
    lightSprite.position.set(origin.x, origin.y);
    // The boat and its newcomer, drawn over the light map, are lit as it would light them
    // (hubtiles.js boatTint and newcomerTint).
    if (arrival) {
      boat.tint = hull.tint = boatTint(arrival, lights, fogAt, LOOK, flick);
      passenger.tint = stepping.tint = newcomerTint(arrival, lights, fogAt, LOOK, flick) ?? 0xffffff;
    }
  }

  function drawFog(app) {
    // Redraw the clear mask only when the fog changes (fogRedraw: a region cleared, one fading, or
    // its ragged edge tuned).
    const redraw = fogRedraw(fogState, world, LOOK);
    if (redraw) {
      fogState = redraw;
      fogDensity(world.map, world.revealed, world.fogFade, density, LOOK);
      fogPixels(density, clearPixels.data);
      clearCanvas.getContext('2d').putImageData(clearPixels, 0, 0);
      clearTex.source.update();
    }
    // The mask holds a texel per tile; placed so each texel's center is its tile's center.
    clearSprite.scale.set(TILE / 2); clearSprite.position.set(-origin.x / 2, -origin.y / 2);
    fogFill.tint = lookColor(LOOK.fogColor);
    fogFill.alpha = LOOK.fogDensity;
    wisps.tint = lookColor(LOOK.wispColor);
    wisps.alpha = LOOK.wisps;
    const drift = now / 1000;
    wisps.tilePosition.set(-origin.x / 2 + drift * LOOK.wispDriftX, -origin.y / 2 + drift * LOOK.wispDriftY);
    app.render({ container: fogRoot, target: fogRT, clear: true, clearColor: [0, 0, 0, 0] });
    fogSprite.position.set(origin.x, origin.y);
  }

  // ---------------------------------------------------------------- public

  return {
    root,
    stats,
    /** Start drawing a harbor world with these building levels. */
    attach(w, lv) {
      world = w;
      levels = { ...lv };
      for (const [, e] of propSprites) e.sprite.destroy();
      propSprites.clear();
      for (const [, e] of people) e.sprite.destroy();
      people.clear();
      arrivalId = null;
      // What's already there at the start doesn't pop in.
      frameNo++;
      drawProps(); drawPeople(1);
      for (const e of propSprites.values()) e.born = -Infinity;
      for (const e of people.values()) e.born = -Infinity;
      renderer.world.addChild(root);
      fogState = null;
    },
    detach() { if (root.parent) root.parent.removeChild(root); world = null; },
    /** The building levels changed (a purchase): the ceremony shows the step between. */
    setLevels(lv) { levels = { ...lv }; },
    /** Draw one frame. alpha: how far between the last two ticks. */
    draw(alpha, frameMs) {
      if (!world) return;
      const t0 = performance.now();
      const dt = Math.min(0.1, frameMs / 1000);
      now += frameMs;
      frameNo++;
      LOOK = tuning.look;
      // Camera: the world's (you, or a set piece), between its last two ticks, kept inside the map.
      const [fx, fy] = cameraAt(world, alpha);
      [camX, camY] = clampCamera(fx, fy - LOOK.cameraLift, mapW, mapH, VIEW_W, VIEW_H);
      renderer.camera.x = camX; renderer.camera.y = camY;
      origin.x = splitCamera(camX - VIEW_W / 2).whole - MARGIN;
      origin.y = splitCamera(camY - VIEW_H / 2).whole - MARGIN;
      // The sea's swell: a new frame every so often, drifting slowly east.
      water.texture = waterTex[Math.floor(now / LOOK.waterFrameMs) % 3];
      water.tilePosition.x = Math.floor(now / LOOK.waterDriftMs) % 64;
      drawBuildings(dt);
      drawProps();
      drawPeople(alpha);
      drawArrival(alpha);
      drawPuffs(dt);
      const app = renderer.app.renderer;
      drawLight(alpha, app);
      drawFog(app);
      stats.jsMs = stats.jsMs * 0.9 + (performance.now() - t0) * 0.1;
    },
    /** A world position in the 640 x 360 view (for the DOM prompts), from the last frame's camera. */
    toView(x, y) { return { x: x - camX + VIEW_W / 2, y: y - camY + VIEW_H / 2 }; },
    /** Where a prompt goes above what's in reach: { x, y } in world px. */
    anchorOf(near) {
      if (!near || !world) return null;
      if (near.kind === 'door') {
        const pl = hub.plots.find((q) => q.building === near.id);
        return pl === lampPlot ? { x: pl.x * TILE + 8, y: (pl.y + 1) * TILE - 48 } : { x: (pl.x + pl.w / 2) * TILE, y: pl.y * TILE - 4 };
      }
      if (near.kind === 'gate') return { x: hub.gate.at[0] * TILE + 8, y: hub.gate.at[1] * TILE - 20 };
      const person = world.people.find((q) => q.id === near.id);
      return person ? { x: person.x, y: person.y - 24 } : null;
    },
    get now() { return now; },
    destroy() {
      this.detach();
      root.destroy({ children: true });
      lightRoot.destroy({ children: true });
      fogRoot.destroy({ children: true });
      lightRT.destroy(true); fogRT.destroy(true);
      for (const t of owned) t.destroy(true);
      owned.length = 0;
      for (const t of standing.values()) t.destroy(false);
      standing.clear();
      hullTex.destroy(false);   // a frame of the atlas's page, which stays
    },
  };
}
