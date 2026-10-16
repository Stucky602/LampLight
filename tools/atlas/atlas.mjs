// The atlas builder's core (ARCHITECTURE §16.3): art/manifest.js plus the packs in, every frame
// out. Pure apart from the pack images it's given, so the gate can run the parts that don't need
// the packs. tools/atlas/build.mjs is the command that writes the files.

import { SPRITES, RAMPS, PACKS, TOWN_COLORS } from '../../art/manifest.js';
import { DRAW, HOLD } from '../../art/draw/index.js';
import { ruin, openings, boardWindows, lightWindows, flowerBox, wallLantern, tavernSign, librarySign, docksSign, smithySign, chapelSign, marketSign, apothecarySign, cartographerSign, fillDoorways } from '../../art/draw/hub.js';
import { RIGS, restPose, rigPlace } from '../../src/render/rigs.js';
import { TAG_COLORS } from '../../src/data/palette.js';
import { blank, stamp, outlined } from '../../src/render/pixels.js';
import { tint, tintLayers, remap, flash, elite, framed, cropFrame, padTo, maskOf, cropMask } from './treat.mjs';
import { PLAYER_FEET_ROOM } from '../../src/render/playerframe.js';

export const TILE = 16;
export const ICON_SIZE = 18;
export const ELITE_SCALE = 2;
/** A character's frame: the 16 px tile with room on every side for what she holds. */
export const PLAYER_SIZE = TILE + 2 * PLAYER_FEET_ROOM;

/** Icon border colors: weapons and passives by their first tag, relics and runes by kind. */
export const ICON_BORDER = Object.freeze({ ...TAG_COLORS, relic: 'violet-3', rune: 'violet-4', gear: 'fog-4', item: 'moss-3', arcana: 'lamp-5', none: 'fog-2' });

/** Each icon the data names, with the key that picks its border and default ramp. */
export function iconKeysFor(data) {
  const out = {};
  for (const w of data.weapons) out[w.icon] = w.tags?.[0] || 'none';
  for (const p of data.passives) out[p.icon] = p.tags?.[0] || 'none';
  for (const r of data.relics) out[r.icon] = 'relic';
  for (const r of data.runes) out[r.icon] = 'rune';
  for (const r of data.recipes || []) out[r.icon] = 'gear';
  for (const c of data.consumables || []) out[c.icon] = 'item';
  for (const a of data.arcana || []) out[a.icon] = 'arcana';
  return out;
}

function rampOf(name, id) {
  const r = RAMPS[name];
  if (!r) throw new Error(`${id}: no ramp called "${name}" in art/manifest.js`);
  return r;
}

/**
 * A 16 x 16 tile of a decoded pack sheet. The sheet must be the packed one (tiles edge to edge,
 * `cols` across): the packs also ship sheets with a pixel between tiles, where every index would
 * land on pieces of its neighbors.
 */
export function tileOf(pack, index, id) {
  const cols = PACKS[pack.name].cols;
  if (pack.img.width !== cols * TILE || pack.img.height % TILE !== 0) {
    throw new Error(`${id}: the ${pack.name} sheet is ${pack.img.width}x${pack.img.height}; the packed sheet (${cols} tiles of ${TILE} px across, no spacing) is ${cols * TILE} wide (${PACKS[pack.name].file})`);
  }
  const rows = Math.floor(pack.img.height / TILE);
  if (!(Number.isInteger(index) && index >= 0 && index < cols * rows)) throw new Error(`${id}: tile ${index} is not in the ${pack.name} pack (0 to ${cols * rows - 1})`);
  const f = blank(id, TILE, TILE);
  const x0 = (index % cols) * TILE, y0 = Math.floor(index / cols) * TILE;
  for (let y = 0; y < TILE; y++) {
    const from = ((y0 + y) * pack.img.width + x0) * 4;
    f.rgba.set(pack.img.rgba.subarray(from, from + TILE * 4), y * TILE * 4);
  }
  return f;
}

/** The source of an entry as a mask (pack tile or code) or the generator's raw result. */
function source(entry, packs, k = 0) {
  if (entry.draw) {
    const gen = DRAW[entry.draw];
    if (!gen) throw new Error(`${entry.id}: no drawing called "${entry.draw}" in art/draw/`);
    return gen(entry);
  }
  const pack = packs[entry.pack];
  if (!pack) throw new Error(`${entry.id}: pack "${entry.pack}" isn't loaded`);
  const tile = entry.tiles ? entry.tiles[k] : entry.tile;
  return tileOf(pack, tile, entry.id);
}

function asMask(src, id) {
  if (src && src.a) return src;
  if (src && src.rgba) return maskOf(src);
  throw new Error(`${id}: expected a mask or a one-color tile`);
}

/**
 * Color a source: a mask (or one-color tile) in `rampName`, or { layers } each in its own ramp.
 * Returns the frame as drawn (outlined, unless the drawing asks for none) and `inner`, the same
 * without the outline (what the elite version and icon pictures are made from).
 */
function colored(src, id, rampName) {
  let inner, outline = 'night-0';
  if (src && src.layers) {
    const layers = src.layers.map((L) => ({ mask: L.mask, ramp: rampOf(L.ramp, id), shade: L.shade }));
    inner = tintLayers(layers, id, { outline: null });
    if (src.outline !== undefined) outline = src.outline;
  } else {
    const ramp = rampOf(rampName, id);
    inner = tint(asMask(src, id), { ...ramp, outline: null }, id);
    if (ramp.outline !== undefined) outline = ramp.outline;
  }
  return { frame: outline ? outlined(inner, outline, id) : inner, inner };
}

/**
 * A harbor sprite from pack B: one tile, or `layout` (rows of tiles; a cell is a tile index, null
 * for none, or { t, colors } to recolor that tile alone), remapped with TOWN_COLORS and the
 * entry's `colors`. Strict: a color nobody listed stops the build (the harbor's look is chosen,
 * never the nearest match by accident).
 */
export function townFrame(e, packs) {
  const pack = packs[e.pack];
  if (!pack) throw new Error(`${e.id}: pack "${e.pack}" isn't loaded`);
  const colors = { ...TOWN_COLORS, ...(e.colors || {}) };
  if (!e.layout) return remap(tileOf(pack, e.tile, e.id), colors, e.id, { strict: true }).frame;
  const rows = e.layout.length, cols = e.layout[0].length;
  const out = blank(e.id, cols * TILE, rows * TILE);
  e.layout.forEach((row, ty) => {
    if (row.length !== cols) throw new Error(`${e.id}: layout row ${ty} is ${row.length} tiles, not ${cols}`);
    row.forEach((cell, tx) => {
      if (cell === null) return;
      const t = typeof cell === 'object' ? cell.t : cell;
      const own = typeof cell === 'object' ? cell.colors : null;
      stamp(out, remap(tileOf(pack, t, e.id), own ? { ...colors, ...own } : colors, e.id, { strict: true }).frame, tx * TILE, ty * TILE);
    });
  });
  return out;
}

/** The signs a building can hang over its door (the manifest's `sign`). */
const SIGNS = Object.freeze({ library: librarySign, tavern: tavernSign, docks: docksSign, smithy: smithySign, chapel: chapelSign, market: marketSign, apothecary: apothecarySign, cartographer: cartographerSign });

/** The places on a building's frame for its sign, its door lantern, and its window boxes. */
function dressBuilding(f, e, { windows, doors }, { sign, lantern, boxes }) {
  const [dx, dy] = doors[0] || [Math.floor(f.w / TILE / 2), Math.floor(f.h / TILE) - 1];
  if (sign) {
    const make = SIGNS[e.sign];
    if (!make) throw new Error(`${e.id}: no sign called "${e.sign}" (there are ${Object.keys(SIGNS).join(', ')})`);
    const s = make();
    stamp(f, s, dx * TILE + Math.floor((TILE - s.w) / 2), dy * TILE - s.h + 1);
  }
  if (lantern) stamp(f, wallLantern(), dx * TILE + 12, dy * TILE + 1);
  if (boxes) {
    const box = flowerBox();
    for (const [tx, ty] of windows) if (ty < dy) stamp(f, box, tx * TILE + 2, ty * TILE + 11);
  }
  return f;
}

/** A building's frame at one stage (the manifest's `stage`); its open doorways are dark inside. */
export function buildingFrame(e, packs) {
  const whole = fillDoorways(townFrame(e, packs), e.layout);
  const where = openings(e.layout);
  switch (e.stage) {
    case 'ruin': return ruin(whole, e.layout, e.id);
    case 'roof': return boardWindows(whole, where.windows);
    case 'lit': return lightWindows(whole, where.windows);
    case 'keeper': return dressBuilding(lightWindows(whole, where.windows), e, where, { sign: true, lantern: true });
    case 'alive': return dressBuilding(lightWindows(whole, where.windows), e, where, { sign: true, lantern: true, boxes: true });
    default: throw new Error(`${e.id}: no building stage called "${e.stage}"`);
  }
}

/**
 * Build every frame. `packs`: { onebit, dungeon, town } each { name, img: {width, height, rgba} }.
 * `sprites`: the manifest's entries (tests pass their own).
 * Returns { frames: [...], anims: { id: { n, fps } }, rigs: { id: [...parts] } }.
 */
export function buildFrames(packs, data, sprites = SPRITES) {
  const frames = [];
  const anims = {};
  const add = (f) => { frames.push(f); return f; };
  const iconKeys = iconKeysFor(data);
  const partFrames = new Map();

  for (const e of sprites) {
    switch (e.kind) {
      case 'player': {
        const tile = source(e, packs);
        const { frame } = remap(tile, e.colors, e.id);
        // Room for what she holds, the body staying centered; then the thing, drawn at `at`.
        const body = padTo(frame, PLAYER_SIZE, PLAYER_SIZE, e.id);
        if (e.hold) {
          const draw = HOLD[e.hold.what];
          if (!draw) throw new Error(`${e.id}: nothing called "${e.hold.what}" to hold`);
          draw(body, ...e.hold.at);
        }
        add(body); add(flash(body));
        break;
      }
      case 'enemy': {
        const n = e.frames || 1;
        if (n > 1) anims[e.id] = { n, fps: e.fps || 6 };
        let size = null;
        const drawn = e.draw ? source(e, packs) : null;
        if (drawn && n > 1 && !(Array.isArray(drawn) && drawn.length === n)) throw new Error(`${e.id}: ${n} frames asked for, the drawing gives ${Array.isArray(drawn) ? drawn.length : 1}`);
        if (!e.draw && n > 1 && !(Array.isArray(e.tiles) && e.tiles.length === n)) throw new Error(`${e.id}: ${n} frames need ${n} tiles`);
        for (let k = 0; k < n; k++) {
          const raw = drawn ? (Array.isArray(drawn) ? drawn[k] : drawn) : source(e, packs, k);
          const id = k === 0 ? e.id : `${e.id}@${k}`;
          const { frame: f, inner } = colored(raw, id, e.ramp);
          if (size && (f.w !== size[0] || f.h !== size[1])) throw new Error(`${e.id}: animation frames differ in size`);
          size = [f.w, f.h];
          add(f); add(flash(f));
          const big = elite(inner, `${id}#elite`, { scale: ELITE_SCALE });
          add(big); add(flash(big));
        }
        break;
      }
      case 'part': {
        const { frame: f } = colored(source(e, packs), e.id, e.ramp);
        add(f); add(flash(f));
        partFrames.set(e.id, f);
        break;
      }
      case 'item': {
        const src = source(e, packs);
        add(colored(src.layers ? src : cropMask(asMask(src, e.id)), e.id, e.ramp).frame);
        break;
      }
      case 'icon': {
        const key = iconKeys[e.id];
        if (key === undefined) throw new Error(`${e.id}: the data has no weapon, passive, relic, or rune with this icon`);
        const rampName = e.ramp || key;   // every tag has a ramp (tests/atlas.test.js), relics and runes too
        const src = source(e, packs);
        const pic = colored(src.layers ? src : cropMask(asMask(src, e.id)), e.id, rampName).inner;
        add(framed(pic, e.id, ICON_BORDER[key] || ICON_BORDER.none, { size: ICON_SIZE }));
        break;
      }
      case 'ground': {
        const f = source(e, packs);
        f.id = e.id;
        add(f);
        break;
      }
      case 'block': {
        const floorEntry = sprites.find((x) => x.kind === 'ground' && x.variant === e.floor);
        if (!floorEntry) throw new Error(`${e.id}: no floor tile with variant ${e.floor}`);
        const f = source(floorEntry, packs);
        f.id = e.id;
        const obj = colored(cropMask(asMask(source(e, packs), e.id)), e.id, e.ramp).frame;
        if (obj.w > TILE || obj.h > TILE) {
          // The outline may run a pixel past the tile; keep the obstacle's middle.
          const box = { x: Math.max(0, Math.floor((obj.w - TILE) / 2)), y: Math.max(0, Math.floor((obj.h - TILE) / 2)), w: Math.min(TILE, obj.w), h: Math.min(TILE, obj.h) };
          stamp(f, cropFrame(obj, box), Math.floor((TILE - box.w) / 2), Math.floor((TILE - box.h) / 2));
        } else stamp(f, obj, Math.floor((TILE - obj.w) / 2), Math.floor((TILE - obj.h) / 2));
        add(f);
        break;
      }
      case 'fx': {
        const out = source(e, packs);
        for (const f of out) add(f);
        break;
      }
      case 'town': add(townFrame(e, packs)); break;
      case 'building': add(buildingFrame(e, packs)); break;
      case 'npc': add(padTo(townFrame(e, packs), PLAYER_SIZE, PLAYER_SIZE, e.id)); break;
      default: throw new Error(`${e.id}: unknown kind "${e.kind}"`);
    }
  }

  // Each boss's resting pose as one frame (and its flash), from its rig. (A build of a few test
  // entries has no parts at all and skips this; some parts but not all is a mistake.)
  const rigs = {};
  for (const [id, rig] of Object.entries(RIGS)) {
    const have = rig.parts.filter((p) => partFrames.has(p.frame)).length;
    if (have === 0 && sprites !== SPRITES) continue;
    const f = composeRig(id, rig, partFrames);
    add(f); add(flash(f));
    rigs[id] = rig.parts.map((p) => p.frame);
  }
  return { frames, anims, rigs };
}

/** Stamp a rig's parts in their resting pose into one frame, centered on the boss's position. */
export function composeRig(id, rig, partFrames) {
  const at = rigPlace(id, restPose(rig), new Float64Array(rig.parts.length * 2));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const placed = rig.parts.map((p, k) => {
    const f = partFrames.get(p.frame);
    if (!f) throw new Error(`rig ${id}: no frame "${p.frame}"`);
    // Pixi mirrors a flipped part around its pivot, so pixel c lands at pivot + px - c - 1.
    const px = p.flip ? f.w - p.px : p.px;
    const x = Math.round(at[k * 2] - px), y = Math.round(at[k * 2 + 1] - p.py);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + f.w); y1 = Math.max(y1, y + f.h);
    return { f: p.flip ? mirrored(f) : f, x, y };
  });
  // Centered on the boss: the frame reaches as far on each side as the widest part.
  const hw = Math.max(-x0, x1), hh = Math.max(-y0, y1);
  const out = blank(id, hw * 2, hh * 2);
  for (const { f, x, y } of placed) stamp(out, f, x + hw, y + hh);
  return out;
}

function mirrored(f) {
  const o = blank(f.id, f.w, f.h);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const i = (y * f.w + (f.w - 1 - x)) * 4, j = (y * f.w + x) * 4;
    for (let k = 0; k < 4; k++) o.rgba[j + k] = f.rgba[i + k];
  }
  return o;
}

