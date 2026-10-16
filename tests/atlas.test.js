// The atlas builder's parts (ARCHITECTURE §16.3): PNG reading and writing, one-bit masks, the
// treatments (tint, remap, flash, elite, icon frames), the boss rigs' poses, and the whole build
// run over stand-in packs, so every rule the builder follows is checked without the real packs
// (which never enter the repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { encodePng, decodePng, crc32 } from '../tools/atlas/png.mjs';
import { mask, maskFromRows, maskOfChar, put, rect, ellipse, line, poly, union, subtract, intersect, flipMask, placed, count } from '../tools/atlas/mask.mjs';
import { tint, tintLayers, remap, flash, elite, unoutline, framed, padTo, enclosedHoles, cropMask, maskOf, opaqueBox, cropFrame } from '../tools/atlas/treat.mjs';
import { oklab, nearestPalette, luminance, contrastRatio, hexRgb } from '../tools/atlas/color.mjs';
import { buildFrames, composeRig, iconKeysFor, ICON_BORDER, ELITE_SCALE, townFrame, buildingFrame } from '../tools/atlas/atlas.mjs';
import { codeOf, atlasInputs, atlasSourceHash } from '../tools/atlas/sources.mjs';
import { packSheet } from '../src/render/sheet.js';
import { createIconFactory } from '../src/app/icons.js';
import { loadAtlasImage } from '../src/render/atlasimage.js';
import { BOSS_STATE, warnTime, registerBoss } from '../src/sim/bosses.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { spawnAt } from './helpers/simworld.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPRITES, PACKS, RAMPS } from '../art/manifest.js';
import { RIGS, createPose, restPose, rigPlace, checkRig } from '../src/render/rigs.js';
import { RIG_STATE, rigPose, rigInput, rigLightAt, RIG_LIGHTS } from '../src/render/rigpose.js';
import { checkAtlasJson, animFrameIds } from '../src/render/atlasdata.js';
import { alphaAt, rgbOf, blank, setPx } from '../src/render/pixels.js';
import { PALETTE, TAG_COLORS } from '../src/data/palette.js';
import { DATA } from '../src/data/index.js';
import { CREDITS } from '../src/data/credits.js';

const px = (f, x, y) => { const o = (y * f.w + x) * 4; return [f.rgba[o], f.rgba[o + 1], f.rgba[o + 2], f.rgba[o + 3]]; };
const is = (f, x, y, name) => { const [r, g, b, a] = px(f, x, y); const [R, G, B] = rgbOf(name); return a === 255 && r === R && g === G && b === B; };

test('png: what we write reads back exactly, and damage is reported plainly', () => {
  const img = { width: 5, height: 3, rgba: new Uint8ClampedArray(60).map((_, i) => (i * 37 + 11) & 255) };
  const bytes = encodePng(img);
  const back = decodePng(bytes);
  assert.equal(back.width, 5); assert.equal(back.height, 3);
  assert.deepEqual([...back.rgba], [...img.rgba]);
  assert.deepEqual(encodePng(img), bytes, 'the same pixels give the same bytes');
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
  const broken = Buffer.from(bytes); broken[40] ^= 0xff;
  assert.throws(() => decodePng(broken), /damaged|checksum/);
  assert.throws(() => encodePng({ width: 2, height: 2, rgba: new Uint8Array(3) }), /expected 16/);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
});

test('png: palette images with transparency and packed pixels read correctly (the packs are like this)', () => {
  // A 3 x 2 two-bit palette image: red, green, and a transparent color.
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(3, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 2; ihdr[9] = 3;
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const trns = Buffer.from([255, 255, 0]);
  // Rows: indices 0 1 2 and 2 1 0, packed 2 bits each, filter 0.
  const raw = Buffer.from([0, 0b00011000, 0, 0b10010000]);
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const img = decodePng(file);
  assert.deepEqual([...img.rgba.subarray(0, 12)], [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0]);
  assert.deepEqual([...img.rgba.subarray(12, 24)], [0, 0, 255, 0, 0, 255, 0, 255, 255, 0, 0, 255]);
  const inter = Buffer.from(file); inter[8 + 8 + 12] = 1; // the interlace byte of IHDR
  inter.writeUInt32BE(crc32(inter.subarray(12, 29)), 29);
  assert.throws(() => decodePng(inter), /interlaced/);
});

test('masks: drawing operations put pixels where they should', () => {
  const m = mask(9, 9);
  rect(m, 1, 1, 3, 2);
  assert.equal(count(m), 6);
  put(m, 50, 50); put(m, -1, 0);
  assert.equal(count(m), 6, 'off-mask pixels are ignored');
  const e = mask(11, 11); ellipse(e, 5.5, 5.5, 4, 4);
  assert.equal(e.a[5 * 11 + 5], 1); assert.equal(e.a[0], 0);
  const l = mask(5, 5); line(l, 0, 0, 4, 4);
  assert.equal(count(l), 5);
  for (let k = 0; k < 5; k++) assert.equal(l.a[k * 5 + k], 1, 'the diagonal');
  const p = mask(10, 10); poly(p, [0, 0, 10, 0, 10, 10, 0, 10]);
  assert.equal(count(p), 100, 'a polygon covering the mask fills it');
  const a = maskFromRows(['##.', '...']), b = maskFromRows(['.##', '...']);
  assert.equal(count(union(maskFromRows(['##.', '...']), b)), 3);
  assert.equal(count(subtract(maskFromRows(['##.', '...']), b)), 1);
  assert.equal(count(intersect(a, b)), 1);
  assert.deepEqual([...flipMask(maskFromRows(['#..'])).a], [0, 0, 1]);
  assert.equal(count(placed(maskFromRows(['##']), 4, 4, 3, 3)), 1, 'placed clips at the edge');
  assert.deepEqual([...maskOfChar(['ab', 'ba'], 'a').a], [1, 0, 0, 1]);
  assert.throws(() => maskFromRows(['##', '#']), /row 1 is 1 wide/);
  assert.throws(() => mask(0, 3), /bad size/);
});

test('tint: lit from the top left, shaded bottom right, holes filled, a one-pixel outline', () => {
  const ramp = { light: 'fog-4', body: 'fog-3', shade: 'fog-2', hole: 'night-1' };
  const m = maskFromRows([
    '#####',
    '#####',
    '##.##',
    '#####',
    '#####',
  ]);
  const f = tint(m, ramp, 'box');
  assert.equal(f.w, 7); assert.equal(f.h, 7, 'one pixel of outline on every side');
  assert.ok(is(f, 1, 1, 'fog-4'), 'top-left corner is lit');
  assert.ok(is(f, 5, 5, 'fog-2'), 'bottom-right corner is shaded');
  assert.ok(is(f, 2, 2, 'fog-3'), 'inside is the body color');
  assert.ok(is(f, 3, 3, 'night-1'), 'the enclosed hole is filled (it reads as a dark feature)');
  assert.ok(is(f, 0, 3, 'night-0') && is(f, 3, 0, 'night-0'), 'outlined in night-0');
  assert.equal(alphaAt(f, 0, 0), 0, 'no outline on the diagonal corner');
  // A gap that reaches the edge is not a hole: it stays see-through (away from the outline,
  // which does close a one-pixel gap).
  const c = tint(maskFromRows(['#####', '#...#', '#...#', '#...#']), ramp, 'cup');
  assert.equal(alphaAt(c, 3, 3), 0);
  assert.ok(is(c, 2, 3, 'night-0'), 'the outline runs inside the gap');
  // shade: false paints one color; hole: null leaves holes clear; outline: null leaves no outline.
  const flat = tint(m, { ...ramp, hole: null, outline: null }, 'flat', { shade: false });
  assert.equal(flat.w, 5);
  assert.ok(is(flat, 0, 0, 'fog-3') && is(flat, 4, 4, 'fog-3'));
  assert.equal(alphaAt(flat, 2, 2), 0);
  assert.throws(() => tint(m, { body: 'fog-3' }, 'bad'), /needs "light"/);
});

test('enclosed holes and cropping', () => {
  const m = maskFromRows(['.....', '.###.', '.#.#.', '.###.', '.....']);
  const h = enclosedHoles(m);
  assert.equal(h[2 * 5 + 2], 1);
  assert.equal(h.reduce((a, b) => a + b, 0), 1);
  const c = cropMask(m);
  assert.equal(c.w, 3); assert.equal(c.h, 3);
  assert.throws(() => cropMask(mask(3, 3)), /empty/);
  const f = blank('f', 4, 4); setPx(f, 1, 2, 'white'); setPx(f, 2, 3, 'white');
  assert.deepEqual(opaqueBox(f), { x: 1, y: 2, w: 2, h: 2 });
  assert.equal(opaqueBox(blank('e', 2, 2)), null);
  assert.equal(cropFrame(f, { x: 1, y: 2, w: 2, h: 2 }).w, 2);
  assert.equal(count(maskOf(f)), 2);
});

test('layers: each in its own ramp, painted in order, outlined as one shape', () => {
  const body = maskFromRows(['####', '####']);
  const eye = maskFromRows(['.#..', '....']);
  const f = tintLayers([{ mask: body, ramp: RAMPS.drowned }, { mask: eye, ramp: RAMPS.maw_eye, shade: false }], 'layered');
  assert.equal(f.w, 6); assert.equal(f.h, 4);
  assert.ok(is(f, 2, 1, 'sea-6'), 'the later layer is on top');
  assert.ok(is(f, 0, 1, 'night-0'), 'one outline around the whole');
  assert.throws(() => tintLayers([{ mask: body, ramp: RAMPS.drowned }, { mask: maskFromRows(['#']), ramp: RAMPS.drowned }], 'bad'), /must be 4x2/);
});

test('remap: listed colors go where they are told, the rest to the nearest palette color', () => {
  const src = blank('src', 3, 1);
  src.rgba.set([0x3f, 0x26, 0x31, 255, 0xfe, 0xfe, 0xfe, 255, 0, 0, 0, 0]);
  const { frame, used } = remap(src, { '#3f2631': 'night-0' }, 'char');
  assert.ok(is(frame, 0, 0, 'night-0'));
  assert.ok(is(frame, 1, 0, 'white'), 'near-white snaps to white');
  assert.equal(alphaAt(frame, 2, 0), 0, 'transparent stays transparent');
  assert.equal(used.get('#fefefe'), 'white');
  assert.throws(() => remap(src, {}, 'strict', { strict: true }), /has no entry/);
  assert.equal(nearestPalette(0xdb, 0x81, 0x2a), 'lamp-3');
  assert.equal(nearestPalette(255, 255, 255, ['night-0', 'fog-5']), 'fog-5', 'only among the names given');
  assert.throws(() => nearestPalette(1, 2, 3, ['no-such']), /no palette color/);
  const [L] = oklab(255, 255, 255);
  assert.ok(Math.abs(L - 1) < 1e-3, 'white is L = 1 in OKLab');
  assert.ok(contrastRatio(luminance(255, 255, 255), luminance(0, 0, 0)) > 20.9);
  assert.deepEqual(hexRgb('#102030'), [16, 32, 48]);
});

test('variants: the flash covers exactly the sprite; the elite is doubled with two outlines', () => {
  const f = tint(maskFromRows(['.#.', '###']), RAMPS.wisp, 'x');
  const fl = flash(f);
  assert.equal(fl.id, 'x#flash');
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) assert.equal(alphaAt(fl, x, y) > 0, alphaAt(f, x, y) > 0);
  assert.ok(is(fl, 2, 1, 'white'));
  const inner = unoutline(f);
  assert.equal(inner.w, 3); assert.equal(inner.h, 2);
  const el = elite(inner, 'x#elite', { scale: 2 });
  assert.equal(el.w, 3 * 2 + 4); assert.equal(el.h, 2 * 2 + 4);
  assert.ok(is(el, 0, 5, 'lamp-4'), 'the gold line outside');
  assert.ok(is(el, 1, 5, 'night-0'), 'the dark line inside it');
});

test('icons: the picture centered on a dark square with its tag color border', () => {
  const pic = tint(maskFromRows(['##', '##']), { ...RAMPS.fire, outline: null }, 'p');
  const f = framed(pic, 'icon_x', 'lamp-3', { size: 18 });
  assert.equal(f.w, 18); assert.equal(f.h, 18);
  assert.ok(is(f, 0, 0, 'lamp-3') && is(f, 17, 17, 'lamp-3'));
  assert.ok(is(f, 1, 1, 'night-2'));
  assert.ok(is(f, 8, 8, 'lamp-5'), 'the picture sits in the middle');
  assert.throws(() => framed(blank('big', 17, 3), 'icon_y', 'lamp-3', { size: 18 }), /doesn't fit/);
  const padded = padTo(pic, 6, 5);
  assert.equal(padded.w, 6); assert.equal(padded.h, 5);
  assert.throws(() => padTo(pic, 1, 1), /doesn't fit/);
  // Every icon in the data has a border color, by its first tag or its kind.
  const keys = iconKeysFor(DATA);
  for (const w of DATA.weapons) assert.equal(keys[w.icon], w.tags[0]);
  for (const r of DATA.relics) assert.equal(keys[r.icon], 'relic');
  for (const k of Object.values(keys)) assert.ok(ICON_BORDER[k], `border for ${k}`);
});

test('manifest: every entry is well formed, every ramp resolves to palette colors', () => {
  const ids = new Set();
  for (const e of SPRITES) {
    assert.ok(!ids.has(e.id), `${e.id} appears once`);
    ids.add(e.id);
    const layoutOk = Array.isArray(e.layout) && e.layout.every((row) => row.every((c) => c === null || Number.isInteger(c) || Number.isInteger(c?.t)));
    assert.ok(e.draw || (e.pack && PACKS[e.pack] && (Number.isInteger(e.tile) || (Array.isArray(e.tiles) && e.tiles.every(Number.isInteger)) || layoutOk)), `${e.id} has a source`);
    if (e.ramp) assert.ok(RAMPS[e.ramp], `${e.id}: ramp ${e.ramp}`);
    if (e.kind === 'player') for (const name of Object.values(e.colors)) assert.ok(PALETTE[name], `${e.id}: ${name}`);
  }
  for (const [name, r] of Object.entries(RAMPS)) {
    for (const k of ['light', 'body', 'shade']) assert.ok(PALETTE[r[k]], `ramp ${name}.${k} = ${r[k]}`);
    if (r.hole) assert.ok(PALETTE[r.hole], `ramp ${name}.hole`);
  }
  // Every pack a sprite uses is credited (brief §9.4), and the credit names Kenney.
  for (const pack of new Set(SPRITES.filter((e) => e.pack).map((e) => e.pack))) {
    const line = CREDITS.find((c) => c.what.includes(PACKS[pack].title));
    assert.ok(line && /Kenney/.test(line.who) && line.license === 'CC0', `${PACKS[pack].title} is in the credits`);
  }
  // Kevin's ruling: everything in runs from the 1-Bit Pack (or drawn in code in its style); the
  // characters, and the harbor's buildings, ground, and townsfolk, from Tiny Dungeon and Tiny Town.
  const HARBOR = ['town', 'building', 'npc'];
  for (const e of SPRITES) {
    if (e.kind === 'player' || HARBOR.includes(e.kind)) assert.ok(e.pack === 'dungeon' || e.pack === 'town', `${e.id} comes from pack B`);
    else if (e.pack) assert.equal(e.pack, 'onebit', `${e.id} (${e.kind}) comes from pack A`);
  }
  for (const e of SPRITES.filter((x) => HARBOR.includes(x.kind))) assert.ok(e.id.startsWith('hub_') || e.id.startsWith('bld_') || e.id.startsWith('npc_'), `${e.id}: harbor ids say so`);
  // Every tag an icon can take has its own colors (so no icon falls back to grey in a colored frame).
  for (const tag of [...Object.keys(TAG_COLORS), 'relic', 'rune', 'none']) assert.ok(RAMPS[tag], `a ramp for "${tag}"`);
});

/** Stand-in packs: every tile a filled square (the 1-Bit Pack) or a two-color figure (Tiny Dungeon). */
function fakePacks() {
  const sheet = (name, cols, rows, paint) => {
    const w = cols * 16, h = rows * 16, rgba = new Uint8ClampedArray(w * h * 4);
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) paint(rgba, w, tx * 16, ty * 16);
    return { name, img: { width: w, height: h, rgba } };
  };
  const onebit = sheet('onebit', 49, 22, (rgba, w, x0, y0) => {
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const o = ((y0 + y) * w + x0 + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = rgba[o + 3] = 255; }
  });
  const figure = (rgba, w, x0, y0) => {
    for (let y = 1; y < 15; y++) for (let x = 2; x < 14; x++) {
      const o = ((y0 + y) * w + x0 + x) * 4, edge = y < 3 || y > 12 || x < 4 || x > 11;
      rgba.set(edge ? [0x3f, 0x26, 0x31, 255] : [0xf7, 0xc2, 0x82, 255], o);
    }
  };
  return { onebit, dungeon: sheet('dungeon', 12, 11, figure), town: sheet('town', 12, 11, figure) };
}

test('build: over stand-in packs, every manifest entry gives its frames and variants', () => {
  const { frames, anims, rigs } = buildFrames(fakePacks(), DATA);
  const byId = new Map(frames.map((f) => [f.id, f]));
  assert.equal(byId.size, frames.length, 'no two frames share an id');
  for (const e of SPRITES) {
    if (e.kind === 'fx') continue;
    if (e.kind === 'enemy') {
      for (const id of animFrameIds({ anims }, e.id)) {
        for (const v of ['', '#flash', '#elite', '#elite#flash']) assert.ok(byId.has(id + v), `${id}${v}`);
        const base = byId.get(id), big = byId.get(`${id}#elite`);
        assert.equal(big.w, (base.w - 2) * ELITE_SCALE + 4, `${id}: the elite is twice the sprite plus two outlines`);
      }
    } else assert.ok(byId.has(e.id), e.id);
    if (e.kind === 'player' || e.kind === 'part') assert.ok(byId.has(`${e.id}#flash`), `${e.id}#flash`);
    if (e.kind === 'icon') assert.equal(byId.get(e.id).w, 18, `${e.id} is 18 across`);
    if (e.kind === 'ground' || e.kind === 'block') { assert.equal(byId.get(e.id).w, 16); assert.equal(byId.get(e.id).h, 16); }
  }
  assert.deepEqual(Object.keys(anims).sort(), SPRITES.filter((e) => (e.frames || 1) > 1).map((e) => e.id).sort());
  for (const id of Object.keys(RIGS)) {
    assert.ok(byId.has(id) && byId.has(`${id}#flash`), `${id}: the resting pose as one frame`);
    assert.deepEqual(rigs[id], RIGS[id].parts.map((p) => p.frame));
  }
});

test('build: a mistake in the manifest or the packs stops the build with the entry named', () => {
  const packs = fakePacks();
  // The spaced sheet (a pixel between tiles) instead of the packed one: refused, not misread.
  const spaced = { ...packs, onebit: { name: 'onebit', img: { width: 832, height: 373, rgba: new Uint8ClampedArray(832 * 373 * 4) } } };
  assert.throws(() => buildFrames(spaced, DATA), /the onebit sheet is 832x373; the packed sheet .* is 784 wide/);
  // A sheet with too few rows: the tile index is named.
  const short = { ...packs, onebit: { name: 'onebit', img: { width: 784, height: 16, rgba: new Uint8ClampedArray(784 * 16 * 4) } } };
  assert.throws(() => buildFrames(short, DATA), /tile \d+ is not in the onebit pack \(0 to 48\)/);
  const noIcons = { ...DATA, weapons: DATA.weapons.slice(1) };
  assert.throws(() => buildFrames(packs, noIcons), /the data has no weapon, passive, relic, or rune with this icon/);
});

test('build: the harbor\'s pieces take only the colors listed for them; a missing pack or sign is named', () => {
  const packs = fakePacks();
  assert.equal(townFrame({ id: 'hub_t', pack: 'town', tile: 0 }, packs).w, 16, 'the stand-in town uses only listed colors');
  // One pixel of a color nobody listed stops the build (never the nearest palette color by accident)...
  const rgba = new Uint8ClampedArray(packs.town.img.rgba);
  rgba.set([0x12, 0x34, 0x56, 255], (8 * packs.town.img.width + 8) * 4);
  const odd = { ...packs, town: { name: 'town', img: { ...packs.town.img, rgba } } };
  assert.throws(() => townFrame({ id: 'hub_x', pack: 'town', tile: 0 }, odd), /remap hub_x: color #123456 has no entry \(strict\)/);
  assert.throws(() => townFrame({ id: 'hub_y', pack: 'town', layout: [[1, 0]] }, odd), /remap hub_y: color #123456 has no entry/);
  assert.throws(() => buildFrames(odd, DATA, [{ id: 'npc_x', kind: 'npc', pack: 'town', tile: 0 }]), /remap npc_x: color #123456/);
  // ...unless the entry lists it.
  assert.ok(is(townFrame({ id: 'hub_x', pack: 'town', tile: 0, colors: { '#123456': 'sea-2' } }, odd), 8, 8, 'sea-2'));
  // A pack that isn't loaded (for a townsperson too), a sign nobody drew, a stage that doesn't exist.
  assert.throws(() => buildFrames({ ...packs, dungeon: undefined }, DATA, [{ id: 'npc_x', kind: 'npc', pack: 'dungeon', tile: 0 }]), /npc_x: pack "dungeon" isn't loaded/);
  const layout = [[0, 0], [85, 0]];
  assert.throws(() => buildingFrame({ id: 'bld_x_keeper', pack: 'town', layout, stage: 'keeper', sign: 'lighthouse' }, packs), /bld_x_keeper: no sign called "lighthouse" \(there are library, tavern, docks, smithy, chapel, market, apothecary, cartographer\)/);
  assert.throws(() => buildingFrame({ id: 'bld_x_odd', pack: 'town', layout, stage: 'odd' }, packs), /bld_x_odd: no building stage called "odd"/);
  // An open doorway (tiles 74 and 78) is dark inside, its sill a step lighter; other tiles keep their see-through pixels.
  const open = buildingFrame({ id: 'bld_x_roof', pack: 'town', layout: [[73, 74]], stage: 'roof' }, packs);
  assert.ok(is(open, 16, 5, 'night-1') && is(open, 16 + 15, 8, 'night-1') && is(open, 16 + 8, 15, 'night-2'));
  assert.equal(px(open, 0, 5)[3], 0, 'the wall tile beside it is untouched');
});

test('rigs: poses are finite, warnings show, attached parts follow, the layout matches the frames', () => {
  const { frames } = buildFrames(fakePacks(), DATA);
  const byId = new Map(frames.map((f) => [f.id, f]));
  for (const [id, rig] of Object.entries(RIGS)) {
    const pose = createPose(rig), at = new Float64Array(rig.parts.length * 2);
    for (const p of rig.parts) {
      const f = byId.get(p.frame);
      assert.ok(f, p.frame);
      assert.ok(p.px >= 0 && p.px <= f.w && p.py >= 0 && p.py <= f.h, `${p.frame}: pivot inside the frame`);
    }
    for (const state of Object.values(RIG_STATE)) {
      for (const attack of ['', 'slam_ring', 'charge_line', 'summon_wave', 'projectile_fan', 'hazard_pools', 'unknown']) {
        for (const t of [0, 0.37, 12.5, 1e5]) {
          rigPose(id, { t, state, attack, u: 0.5, dir: 1 }, pose);
          rigPlace(id, pose, at);
          for (const v of pose) assert.ok(Number.isFinite(v), `${id} pose is finite`);
          for (const v of at) assert.ok(Number.isFinite(v) && Math.abs(v) < 80, `${id} parts stay near the boss`);
        }
      }
    }
    assert.throws(() => rigPose('nobody', {}, pose), /No rig/);
    // The resting pose frame is centered on the boss.
    const composite = composeRig(id, rig, byId);
    assert.equal(composite.w % 2, 0); assert.equal(composite.h % 2, 0);
  }
  // The Maw opens its jaw when it warns of a slam.
  const maw = RIGS.boss_maw, pose = createPose(maw);
  const jaw = maw.parts.findIndex((p) => p.name === 'jaw');
  rigPose('boss_maw', { t: 0, state: RIG_STATE.WALK, attack: '', u: 0 }, pose);
  const rest = pose[jaw * 5 + 1];
  rigPose('boss_maw', { t: 0, state: RIG_STATE.WARN, attack: 'slam_ring', u: 1 }, pose);
  assert.ok(pose[jaw * 5 + 1] > rest + 4, 'the jaw drops');
  // The lure's bulb stays on the tip of its stalk as the stalk sways.
  const at = new Float64Array(maw.parts.length * 2), stalk = 5, bulb = 6;
  for (const t of [0, 1, 2.2]) {
    rigPose('boss_maw', { t, state: RIG_STATE.WALK, attack: '', u: 0 }, pose);
    rigPlace('boss_maw', pose, at);
    const rot = pose[stalk * 5 + 2], [, tx, ty] = maw.parts[bulb].follow, s = maw.parts[stalk];
    const ex = at[stalk * 2] + (tx - s.px) * Math.cos(rot) - (ty - s.py) * Math.sin(rot);
    const ey = at[stalk * 2 + 1] + (tx - s.px) * Math.sin(rot) + (ty - s.py) * Math.cos(rot);
    assert.ok(Math.abs(at[bulb * 2] - ex) < 1e-9 && Math.abs(at[bulb * 2 + 1] - ey) < 1e-9, 'the bulb is on the stalk tip');
  }
  // The Tidecaller swings its bell harder while it rings (a fan or a summon).
  const tc = RIGS.boss_tidecaller, tp = createPose(tc), bellK = tc.parts.findIndex((p) => p.name === 'bell');
  let calm = 0, ringing = 0;
  for (let t = 0; t < 3; t += 0.05) {
    rigPose('boss_tidecaller', { t, state: RIG_STATE.WALK, attack: '', u: 0 }, tp); calm = Math.max(calm, Math.abs(tp[bellK * 5 + 2]));
    rigPose('boss_tidecaller', { t, state: RIG_STATE.WARN, attack: 'projectile_fan', u: 0.5 }, tp); ringing = Math.max(ringing, Math.abs(tp[bellK * 5 + 2]));
  }
  assert.ok(ringing > calm * 2, `the bell swings harder when it rings (${ringing.toFixed(2)} vs ${calm.toFixed(2)})`);
});

test('atlas table: its shape is checked, and animations list their frames', () => {
  assert.deepEqual(checkAtlasJson({ v: 1, width: 8, height: 8, frames: { a: [0, 0, 8, 8] }, anims: {} }), []);
  assert.match(checkAtlasJson(null)[0], /missing/);
  assert.match(checkAtlasJson({ v: 2, width: 8, height: 8, frames: {} })[0], /version 2/);
  assert.match(checkAtlasJson({ v: 1, width: 8, height: 8, frames: { a: [4, 4, 8, 8] } })[0], /outside the page/);
  assert.match(checkAtlasJson({ v: 1, width: 8, height: 8, frames: { a: [0, 0, 1, 1] }, anims: { a: { n: 2, fps: 4 } } })[0], /missing frame "a@1"/);
  assert.match(checkAtlasJson({ v: 1, width: 8, height: 8, frames: { a: [0, 0, 1] } })[0], /not \[x, y, w, h\]/);
  assert.deepEqual(animFrameIds({ anims: { g: { n: 3, fps: 2 } } }, 'g', '#flash'), ['g#flash', 'g@1#flash', 'g@2#flash']);
  assert.deepEqual(animFrameIds({}, 'still'), ['still']);
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('fingerprint: comments and spacing don\'t count, code and string contents do', () => {
  const a = "const x = 1; // one\nconst rows = ['#  #'];\n";
  assert.equal(codeOf(a), codeOf("const x = 1;   // a different comment\n\n  const rows = ['#  #'];"), 'comments and spacing ignored');
  assert.equal(codeOf(a), codeOf('/* a note */ const x = 1;\nconst rows = [\'#  #\'];'));
  assert.notEqual(codeOf(a), codeOf("const x = 2; // one\nconst rows = ['#  #'];\n"), 'a code change counts');
  assert.notEqual(codeOf(a), codeOf("const x = 1; // one\nconst rows = ['#   #'];\n"), 'spaces inside a string count (a text-drawn sprite)');
  assert.equal(codeOf('a\r\nb'), codeOf('a\nb'), 'line endings ignored');
  // A formatter's changes don't count; spaces that keep two tokens apart do.
  for (const [x, y] of [['const x=1;', 'const x = 1;'], ['f(a,b)', 'f(a, b)'], ['{a:1}', '{ a: 1 }'], ['x=>x*2', 'x => x * 2'], ["return 'a'", "return  'a'"], ['[1,2]', '[ 1, 2 ]'], ["'a'+b", "'a' + b"]]) {
    assert.equal(codeOf(x), codeOf(y), `${x} vs ${y}`);
  }
  for (const [x, y] of [['let x', 'letx'], ['a + +b', 'a ++b'], ['a - -b', 'a --b'], ['1 .toFixed(2)', '1.toFixed(2)'], ['a / b / c', 'a // b / c']]) {
    assert.notEqual(codeOf(x), codeOf(y), `${x} vs ${y}`);
  }
});

test('fingerprint: the inputs are every file the builder reaches through its imports', (t) => {
  const inputs = atlasInputs(ROOT);
  for (const f of ['art/manifest.js', 'art/draw/tiles.js', 'src/lib/hash.js', 'src/lib/rng.js', 'src/render/rigs.js', 'src/data/palette.js', 'tools/atlas/treat.mjs']) assert.ok(inputs.includes(f), f);
  for (const f of ['src/data/index.js', 'src/render/rigpose.js', 'src/render/atlasdata.js', 'tests/helpers/jsscan.js', 'tools/atlas/rig-preview.mjs']) assert.ok(!inputs.includes(f), `${f} doesn't decide the atlas`);
  // A new import anywhere down the tree is picked up the day it's written.
  const dir = mkdtempSync(join(tmpdir(), 'atlas-inputs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'tools/atlas'), { recursive: true }); mkdirSync(join(dir, 'art/draw'), { recursive: true });
  writeFileSync(join(dir, 'tools/atlas/build.mjs'), "import { a } from '../../art/draw/a.js';\nimport fs from 'node:fs';\n");
  writeFileSync(join(dir, 'art/draw/a.js'), "export { b } from './b.js'; // re-export\n");
  writeFileSync(join(dir, 'art/draw/b.js'), 'export const b = 1;\n');
  assert.deepEqual(atlasInputs(dir, ['tools/atlas/build.mjs'], []), ['art/draw/a.js', 'art/draw/b.js', 'tools/atlas/build.mjs']);
  // The fingerprint over that tree: a comment in a file two imports down doesn't move it; code
  // there does; so does an icon's tag.
  const fp = (keys = { icon_a: 'fire' }) => atlasSourceHash(dir, keys, ['tools/atlas/build.mjs'], []);
  const before = fp();
  writeFileSync(join(dir, 'art/draw/b.js'), 'export const b = 1; // a note\n');
  assert.equal(fp(), before, 'a comment edit keeps the fingerprint');
  writeFileSync(join(dir, 'art/draw/b.js'), 'export const b = 2;\n');
  assert.notEqual(fp(), before, 'a code edit in an imported file moves it');
  assert.notEqual(fp({ icon_a: 'tide' }), fp(), 'a retagged icon moves it');
  writeFileSync(join(dir, 'art/draw/a.js'), "import './missing.js';\n");
  assert.throws(() => atlasInputs(dir, ['tools/atlas/build.mjs'], []), /atlas input missing: art\/draw\/missing.js/);
});

test('sheet: frames packed on one page, padded, never overlapping, pixels intact; mistakes named', () => {
  const frames = [];
  for (let k = 0; k < 40; k++) { const f = blank(`f${k}`, 3 + (k % 7), 2 + (k % 5)); setPx(f, 0, 0, 'white'); frames.push(f); }
  const sheet = packSheet(frames, { width: 64, pad: 1 });
  assert.equal(sheet.height & (sheet.height - 1), 0, 'a power of two tall');
  const rects = [...sheet.rects.values()];
  for (const r of rects) assert.ok(r.x >= 1 && r.y >= 1 && r.x + r.w <= 63 && r.y + r.h <= sheet.height - 1);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(a.x + a.w + 1 <= b.x || b.x + b.w + 1 <= a.x || a.y + a.h + 1 <= b.y || b.y + b.h + 1 <= a.y, 'apart');
  }
  const r5 = sheet.rects.get('f5');
  assert.deepEqual([...sheet.rgba.subarray(((r5.y) * 64 + r5.x) * 4, ((r5.y) * 64 + r5.x) * 4 + 4)], [255, 255, 255, 255]);
  assert.throws(() => packSheet([blank('a', 1, 1), blank('a', 1, 1)]), /two frames are called "a"/);
  assert.throws(() => packSheet([blank('wide', 40, 1)], { width: 32 }), /wider than the sheet/);
});

test('menu icons: a frame of the atlas page as a crisp, whole-pixel-scaled element', () => {
  const made = [];
  const doc = { createElement: () => { const el = { style: {}, classList: { list: [], add(c) { this.list.push(c); } } }; made.push(el); return el; } };
  const atlas = { url: 'assets/atlas-abc.png', sheet: { width: 512, height: 256 }, rect: (id) => (id === 'icon_x' ? { x: 20, y: 40, w: 18, h: 18 } : null) };
  const icon = createIconFactory(atlas, doc);
  const el = icon('icon_x', 2);
  assert.equal(el.className, 'icon');
  assert.equal(el.style.width, 'calc(var(--u) * 36)');
  assert.equal(el.style.backgroundImage, 'url(assets/atlas-abc.png)');
  assert.equal(el.style.backgroundPosition, 'calc(var(--u) * -40) calc(var(--u) * -80)');
  assert.equal(el.style.backgroundSize, 'calc(var(--u) * 1024) calc(var(--u) * 512)');
  assert.deepEqual(icon('nothing').classList.list, ['icon-blank'], 'an unknown id gives an empty square, not a crash');
  assert.deepEqual(createIconFactory({ ...atlas, url: null }, doc)('icon_x').classList.list, ['icon-blank']);
});

test('atlas image: loads, or fails with a plain message naming the file', async () => {
  const doc = (outcome) => ({ createElement: () => { const img = { decode: () => Promise.resolve() }; Object.defineProperty(img, 'src', { set(v) { this._src = v; queueMicrotask(() => (outcome === 'ok' ? img.onload() : img.onerror())); } }); return img; } });
  const img = await loadAtlasImage('assets/a.png', doc('ok'));
  assert.equal(img._src, 'assets/a.png');
  await assert.rejects(loadAtlasImage('assets/b.png', doc('fail')), /The sprite atlas didn't load \(assets\/b.png\)/);
});

test('build: elites are made from the sprite before its outline, even for a drawing with none', () => {
  // The Maw's mouth is drawn with no outline; used as an enemy here, its elite must be exactly
  // twice it plus the two lines, with nothing stripped off its edge.
  const custom = [
    { id: 'en_plain', kind: 'enemy', draw: 'mawMouth' },
    { id: 'en_lined', kind: 'enemy', draw: 'crab', ramp: 'crab', frames: 2, fps: 4 },
  ];
  const { frames, anims } = buildFrames(fakePacks(), DATA, custom);
  const byId = new Map(frames.map((f) => [f.id, f]));
  const plain = byId.get('en_plain'), plainElite = byId.get('en_plain#elite');
  assert.equal(plainElite.w, plain.w * ELITE_SCALE + 4, 'no outline to strip: the whole sprite doubled');
  const lined = byId.get('en_lined'), linedElite = byId.get('en_lined#elite');
  assert.equal(linedElite.w, (lined.w - 2) * ELITE_SCALE + 4, 'outlined: the sprite inside the outline doubled');
  assert.deepEqual(anims, { en_lined: { n: 2, fps: 4 } });
  assert.equal(frames.some((f) => f.id.startsWith('boss_')), false, 'a partial build makes no boss composites');
});

test('rigs: every layout is sound; a follower listed before its parent is caught', () => {
  for (const id of Object.keys(RIGS)) assert.deepEqual(checkRig(id), [], id);
  const bad = { parts: [{ name: 'b', frame: 'x', px: 0, py: 0, follow: [1, 0, 0] }, { name: 'a', frame: 'y', px: 0, py: 0 }] };
  assert.match(checkRig('bad', bad)[0], /follows part 1, which isn't an earlier part/);
  assert.match(checkRig('nothing')[0], /no rig/);
  assert.equal(RIG_STATE, BOSS_STATE, 'the rigs read the sim\'s own boss states');
  const rest = restPose(RIGS.boss_maw);
  for (let k = 0; k < RIGS.boss_maw.parts.length; k++) assert.deepEqual([...rest.subarray(k * 5, k * 5 + 5)], [0, 0, 0, 1, 1]);
});

test('rigs: each attack shows on the body that makes it', () => {
  const maw = RIGS.boss_maw, mp = createPose(maw), fin = maw.parts.findIndex((p) => p.name === 'finR');
  const tc = RIGS.boss_tidecaller, tp = createPose(tc), robe = tc.parts.findIndex((p) => p.name === 'robe'), t4 = tc.parts.findIndex((p) => p.name === 't4');
  // The Maw spreads its fins (turns them up and out) while it calls a summon.
  rigPose('boss_maw', { t: 0, state: RIG_STATE.WARN, attack: 'summon_wave', u: 1 }, mp);
  assert.ok(mp[fin * 5 + 2] < -0.4, `fins spread (${mp[fin * 5 + 2].toFixed(2)})`);
  // The Tidecaller rises before a slam, and reaches out with its tentacles before its pools.
  rigPose('boss_tidecaller', { t: 0, state: RIG_STATE.WARN, attack: 'slam_ring', u: 1 }, tp);
  assert.ok(tp[robe * 5 + 1] <= -3, 'the robe rises');
  let calmReach = 0, poolReach = 0;
  for (let t = 0; t < 3; t += 0.1) {
    rigPose('boss_tidecaller', { t, state: RIG_STATE.WALK, attack: '', u: 0 }, tp); calmReach = Math.max(calmReach, tp[t4 * 5 + 4]);
    rigPose('boss_tidecaller', { t, state: RIG_STATE.WARN, attack: 'hazard_pools', u: 1 }, tp); poolReach = Math.max(poolReach, tp[t4 * 5 + 4]);
  }
  assert.ok(poolReach > calmReach + 0.1, 'the tentacles stretch before its pools');
  // The tide lanes: further still, with the staff raised.
  let tideReach = 0;
  const staff = tc.parts.findIndex((p) => p.name === 'staff');
  for (let t = 0; t < 3; t += 0.1) { rigPose('boss_tidecaller', { t, state: RIG_STATE.WARN, attack: 'tide_lanes', u: 1 }, tp); tideReach = Math.max(tideReach, tp[t4 * 5 + 4]); }
  assert.ok(tideReach > poolReach, 'the tentacles reach furthest before the tide');
  assert.ok(tp[staff * 5 + 1] < 0, 'the staff is raised');
  // The Maw's lure swells as it lures (its bulb, part 6, scaled past its calm glow).
  let calmBulb = 0, lureBulb = 0;
  for (let t = 0; t < 3; t += 0.1) {
    rigPose('boss_maw', { t, state: RIG_STATE.WALK, attack: '', u: 0 }, mp); calmBulb = Math.max(calmBulb, mp[6 * 5 + 3]);
    rigPose('boss_maw', { t, state: RIG_STATE.WARN, attack: 'lure', u: 1 }, mp); lureBulb = Math.max(lureBulb, mp[6 * 5 + 3]);
  }
  assert.ok(lureBulb > calmBulb * 1.3, `the lure swells (${lureBulb.toFixed(2)} against ${calmBulb.toFixed(2)})`);
});

test('rigs: the pose is read off the sim\'s boss, the warning reaching 1 on the tick the attack lands', () => {
  const w = createWorld({ seed: 'rig', character: 'lamplighter', invulnerable: true }, DATA);
  const e = spawnAt(w, 'harbor_maw', 40, 0);
  registerBoss(w, e, false);
  const b = w.bosses[w.enemies.boss[e]];
  const input = { t: 0, state: 0, attack: '', u: 0 };
  let lastWarnU = -1, sawWarn = false, landed = false;
  for (let t = 0; t < 900 && !landed; t++) {
    const was = b.state;
    stepWorld(w, { mx: 0, my: 0, buttons: 0 });
    rigInput(w, b, 0.5, input);
    assert.equal(input.state, b.state);
    if (b.state === BOSS_STATE.WARN) {
      sawWarn = true;
      assert.ok(input.u >= 0 && input.u <= 1, 'u stays in 0..1');
      assert.equal(input.attack, b.attack.type);
      assert.ok(Math.abs(input.u - (1 - b.timer / warnTime(w, b.attack))) < 1e-12);
      lastWarnU = input.u;
    } else if (was === BOSS_STATE.WARN) landed = true;
  }
  assert.ok(sawWarn && landed, 'a warning ran and ended');
  assert.ok(lastWarnU > 0.97, `the last warning tick is nearly all the way through (${lastWarnU.toFixed(3)})`);
  assert.ok(input.t >= w.tick / 60, 'poses run on sim time');
});

test('rigs: each rig\'s own light sits on the part that makes it', () => {
  const maw = RIGS.boss_maw, pose = restPose(maw), at = rigPlace('boss_maw', pose, new Float64Array(maw.parts.length * 2));
  const out = new Float64Array(2), bulb = maw.parts.findIndex((p) => p.name === 'bulb');
  assert.ok(rigLightAt('boss_maw', pose, at, out));
  assert.deepEqual([...out], [at[bulb * 2], at[bulb * 2 + 1]], 'the lure\'s light is the bulb');
  const tc = RIGS.boss_tidecaller, tpose = restPose(tc), tat = rigPlace('boss_tidecaller', tpose, new Float64Array(tc.parts.length * 2));
  const robe = tc.parts.findIndex((p) => p.name === 'robe'), R = tc.parts[robe], eyes = RIG_LIGHTS.boss_tidecaller.at;
  rigLightAt('boss_tidecaller', tpose, tat, out);
  assert.deepEqual([...out], [tat[robe * 2] + eyes[0] - R.px, tat[robe * 2 + 1] + eyes[1] - R.py], 'the eyes, in the hood');
  // Turn the robe: the eyes turn with it, around the robe's pivot.
  tpose[robe * 5 + 2] = Math.PI / 2;
  rigLightAt('boss_tidecaller', tpose, tat, out);
  assert.ok(Math.abs(out[0] - (tat[robe * 2] - (eyes[1] - R.py))) < 1e-9 && Math.abs(out[1] - (tat[robe * 2 + 1] + (eyes[0] - R.px))) < 1e-9);
  // Every light sits on a part its rig has, with a palette color and a radius; no light, no answer.
  for (const [id, L] of Object.entries(RIG_LIGHTS)) {
    assert.ok(RIGS[id] && Number.isInteger(L.part) && L.part >= 0 && L.part < RIGS[id].parts.length, `${id}: its light is on one of its parts`);
    assert.ok(L.radius > 0 && PALETTE[L.color], `${id}: a radius and a palette color`);
  }
  assert.equal(rigLightAt('no_such_rig', pose, at, out), false);
});
