// The committed atlas (ARCHITECTURE §16.3, §16.4, §6.2): src/assets/atlas.png and atlas.json, as
// the game will load them. It's up to date with its sources, every sprite the game names is on
// it with its variants, the readability rules and contrast hold on the real pixels, frames never
// overlap, and the menus' CSS colors come from the palette.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DATA } from '../src/data/index.js';
import { PALETTE } from '../src/data/palette.js';
import { decodePng } from '../tools/atlas/png.mjs';
import { atlasSourceHash, atlasInputs } from '../tools/atlas/sources.mjs';
import { iconKeysFor, ELITE_SCALE, composeRig, PLAYER_SIZE } from '../tools/atlas/atlas.mjs';
import { BUILDINGS_LAYOUT, TOWN_COLORS, SPRITES } from '../art/manifest.js';
import { openings, librarySign, tavernSign, wallLantern, flowerBox } from '../art/draw/hub.js';
import { luminance as relLum, contrastRatio, oklab, hexRgb } from '../tools/atlas/color.mjs';
import { checkAtlasJson, animFrameIds, DRAWN_IN_CODE } from '../src/render/atlasdata.js';
import { FX_COLOR, LOOK, LOOK_COLOR, GROUND_FRAMES } from '../src/render/viewstate.js';
import { RIGS } from '../src/render/rigs.js';
import { glowFrame, fogFrame } from '../src/render/textures.js';
import { stageFrames } from '../src/render/hubtiles.js';
import { PLAYER_FEET_ROOM } from '../src/render/playerframe.js';
import { FONT, glyphKey, textWidth, digitsWidth } from '../src/render/font.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = decodePng(readFileSync(resolve(ROOT, 'src/assets/atlas.png')));
const table = JSON.parse(readFileSync(resolve(ROOT, 'src/assets/atlas.json'), 'utf8'));
const has = (id) => Object.prototype.hasOwnProperty.call(table.frames, id);

/** A frame's pixels, copied off the page. */
function frame(id) {
  const r = table.frames[id];
  assert.ok(r, `frame "${id}"`);
  const [x0, y0, w, h] = r;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(page.rgba.subarray(((y0 + y) * page.width + x0) * 4, ((y0 + y) * page.width + x0 + w) * 4), y * w * 4);
  return { id, w, h, rgba };
}

const OUTLINE = [7, 8, 13];   // night-0
const GOLD = [0xf3, 0xb0, 0x49]; // lamp-4, the elite's outer line
const same = (r, g, b, c) => r === c[0] && g === c[1] && b === c[2];
/**
 * Mean and max luminance (0..255), relative luminance, warmth, and color (OKLab: the mean chroma,
 * how far from grey, and the hue of the mean color in degrees) over a frame's opaque pixels.
 * skipOutline leaves out the night-0 outline; for an elite, `elite` also leaves out its gold line
 * (only the body counts).
 */
function measure(f, skipOutline = true, elite = false) {
  let sum = 0, n = 0, max = 0, rs = 0, gs = 0, bs = 0, rel = 0, chroma = 0, as = 0, bbs = 0, relMin = 1, relMax = 0;
  for (let i = 0; i < f.w * f.h; i++) {
    const o = i * 4;
    if (f.rgba[o + 3] < 128) continue;
    const r = f.rgba[o], g = f.rgba[o + 1], b = f.rgba[o + 2];
    if (skipOutline && same(r, g, b, OUTLINE)) continue;
    if (elite && same(r, g, b, GOLD)) continue;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l; n++; if (l > max) max = l;
    const rl = relLum(r, g, b);
    rs += r; gs += g; bs += b; rel += rl;
    if (rl < relMin) relMin = rl;
    if (rl > relMax) relMax = rl;
    const k = oklab(r, g, b);
    chroma += Math.hypot(k[1], k[2]); as += k[1]; bbs += k[2];
  }
  return {
    mean: n ? sum / n : 0, max, rel: n ? rel / n : 0, relMin, relMax, r: rs, g: gs, b: bs, n,
    chroma: n ? chroma / n : 0, hue: (Math.atan2(bbs, as) * 180) / Math.PI,
  };
}
/** The OKLab hue of one color, in degrees (red-orange sits near 30 to 45, the lamp colors 60 to 90). */
function hueOf(r, g, b) { const k = oklab(r, g, b); return (Math.atan2(k[2], k[1]) * 180) / Math.PI; }

test('atlas: the table is sound, matches its image, and is up to date with its sources', () => {
  assert.deepEqual(checkAtlasJson(table), []);
  assert.equal(page.width, table.width); assert.equal(page.height, table.height);
  const now = atlasSourceHash(ROOT, iconKeysFor(DATA));
  assert.equal(table.source, now,
    `The atlas is out of date: the code of one of its inputs changed, or an icon's tag did. Its inputs are ${atlasInputs(ROOT).join(', ')}. `
    + 'Rebuild it in the workspace with node tools/atlas/build.mjs (it needs the Kenney packs); comments and spacing never count.');
});

test('atlas: every sprite and icon the data names is on the page (or drawn in code)', () => {
  const named = new Set();
  for (const list of [DATA.weapons, DATA.characters, DATA.enemies, DATA.passives, DATA.relics, DATA.runes, DATA.materials]) {
    for (const x of list) { if (x.sprite) named.add(x.sprite); if (x.icon) named.add(x.icon); }
  }
  const missing = [...named].filter((id) => !has(id) && !DRAWN_IN_CODE.includes(id));
  assert.deepEqual(missing, []);
  for (const id of Object.keys(table.frames)) {
    const f = frame(id);
    let seen = false;
    for (let i = 3; i < f.rgba.length && !seen; i += 4) seen = f.rgba[i] > 0;
    assert.ok(seen, `frame ${id} has a visible pixel`);
  }
});

test('atlas: actors have same-size flashes; enemies have elites (twice the size) for every animation frame', () => {
  const sameShape = (a, b) => {
    assert.equal(a.w, b.w); assert.equal(a.h, b.h);
    for (let i = 3; i < a.rgba.length; i += 4) assert.equal(b.rgba[i] > 0, a.rgba[i] > 0, `${b.id} covers exactly ${a.id}`);
  };
  for (const c of DATA.characters) sameShape(frame(c.sprite), frame(`${c.sprite}#flash`));
  for (const e of DATA.enemies) {
    if (e.ai.type === 'boss') { sameShape(frame(e.sprite), frame(`${e.sprite}#flash`)); continue; }
    const ids = animFrameIds(table, e.sprite);
    const first = frame(ids[0]);
    for (const id of ids) {
      const f = frame(id);
      assert.equal(f.w, first.w, `${id}: animation frames are one size`);
      sameShape(f, frame(`${id}#flash`));
      const big = frame(`${id}#elite`);
      assert.equal(big.w, (f.w - 2) * ELITE_SCALE + 4, `${id}: elite width`);
      assert.equal(big.h, (f.h - 2) * ELITE_SCALE + 4, `${id}: elite height`);
      sameShape(big, frame(`${id}#elite#flash`));
    }
  }
});

test('atlas: every boss rig part is on the page with its flash, pivots inside the part', () => {
  for (const [id, rig] of Object.entries(RIGS)) {
    assert.deepEqual(table.rigs[id], rig.parts.map((p) => p.frame), `${id}: the atlas was built from this rig`);
    for (const p of rig.parts) {
      const [, , w, h] = table.frames[p.frame] || [];
      assert.ok(w && has(`${p.frame}#flash`), p.frame);
      assert.ok(p.px >= 0 && p.px <= w && p.py >= 0 && p.py <= h, `${p.frame}: pivot (${p.px}, ${p.py}) inside ${w}x${h}`);
    }
  }
  for (const e of DATA.enemies.filter((x) => x.ai.type === 'boss')) assert.ok(RIGS[e.sprite], `${e.sprite} has a rig`);
});

test('art: the readability rules (§16.4) hold on the real pixels', () => {
  const floor = [0, 1, 2, 3].map((v) => measure(frame(`tile_floor_${v}`), false));
  const blocks = [0, 1, 2].map((v) => measure(frame(`tile_block_${v}`), false));
  const floorMax = Math.max(...floor.map((m) => m.max));
  const floorRel = Math.max(...floor.map((m) => m.rel));
  const blockMean = Math.max(...blocks.map((m) => m.mean));
  assert.ok(blockMean > Math.max(...floor.map((m) => m.mean)), 'obstacles stand out from the floor');
  // The ground is low in contrast: its own lightest and darkest pixels are closer together (under
  // 1.5:1; 1.3:1 today) than any actor is to it (2:1 and more, below).
  for (const [v, m] of floor.entries()) assert.ok(contrastRatio(m.relMax, m.relMin) < 1.5, `floor ${v}: its own contrast is ${contrastRatio(m.relMax, m.relMin).toFixed(2)}:1`);
  // Every enemy frame counts: each animation frame, and each elite's body (inside its gold line).
  const enemies = [];
  for (const e of DATA.enemies) {
    for (const id of animFrameIds(table, e.sprite)) {
      enemies.push([id, measure(frame(id))]);
      if (e.ai.type !== 'boss') enemies.push([`${id}#elite`, measure(frame(`${id}#elite`), true, true)]);
    }
  }
  assert.ok(enemies.length > DATA.enemies.length * 2, 'animation frames and elites are measured too');
  for (const [id, m] of enemies) {
    assert.ok(m.mean > floorMax, `${id} (mean ${m.mean.toFixed(0)}) is brighter than the brightest floor pixel (${floorMax.toFixed(0)})`);
    assert.ok(m.mean > blockMean, `${id} stands out from the obstacles`);
    assert.ok(m.b > m.r, `${id} is cool (more blue than red)`);
    // Desaturated: the enemies' ramps stay near grey (OKLab chroma 0.04 to 0.09 today; a vivid
    // cobalt or violet would be 0.15 and more), so the warm player and the cyan gems carry the color.
    assert.ok(m.chroma <= 0.1, `${id} is desaturated (chroma ${m.chroma.toFixed(3)})`);
  }
  // The player is the brightest and warmest thing: every character above every enemy.
  const chars = DATA.characters.map((c) => [c.sprite, measure(frame(c.sprite))]);
  const dimmest = Math.min(...chars.map(([, m]) => m.mean));
  for (const [id, m] of enemies) assert.ok(m.mean < dimmest, `${id} (${m.mean.toFixed(0)}) is dimmer than every character (${dimmest.toFixed(0)})`);
  for (const [id, m] of chars) assert.ok(m.r > m.b * 1.3, `${id} is warm`);
  // Contrast against the floor (WCAG's ratio of relative luminance): characters at least 4.5:1,
  // enemies at least 2:1 (the lamp and the outline carry them the rest of the way in the dark).
  for (const [id, m] of chars) assert.ok(contrastRatio(m.rel, floorRel) >= 4.5, `${id}: contrast ${contrastRatio(m.rel, floorRel).toFixed(1)}:1`);
  for (const [id, m] of enemies) assert.ok(contrastRatio(m.rel, floorRel) >= 2, `${id}: contrast ${contrastRatio(m.rel, floorRel).toFixed(1)}:1`);
  // The rest of the wharf (every frame the run's ground can show): what you walk on is as low in
  // contrast as the boards, and every obstacle (water, roofs, walls, the hull) stays dimmer than
  // the dimmest enemy, so the crowd reads over all of it.
  const dimmestEnemy = Math.min(...enemies.map(([, m]) => m.mean));
  for (const id of GROUND_FRAMES) {
    const m = measure(frame(id), false);
    if (/^tile_(floor|bridge|deck)_/.test(id)) assert.ok(contrastRatio(m.relMax, m.relMin) < 1.5, `${id}: its own contrast is ${contrastRatio(m.relMax, m.relMin).toFixed(2)}:1`);
    else assert.ok(m.mean < dimmestEnemy, `${id} (mean ${m.mean.toFixed(0)}) is dimmer than every enemy (${dimmestEnemy.toFixed(0)})`);
  }
  // The player's shots are warm and light.
  for (const w of DATA.weapons) {
    if (DRAWN_IN_CODE.includes(w.sprite)) continue;
    const m = measure(frame(w.sprite), false);
    assert.ok(m.r > m.b, `${w.sprite} is warm`);
    assert.ok(m.mean > 120, `${w.sprite} is light`);
  }
  // Gems are bright cyan: blue and green well above red, and brighter than any enemy (the
  // brightest enemy frame is about 130 today; gems are about 190 to 210).
  const brightestEnemy = Math.max(...enemies.map(([, m]) => m.mean));
  for (const id of ['gem_1', 'gem_2', 'gem_3', 'gem_big']) {
    const m = measure(frame(id));
    assert.ok(m.b > m.r * 1.5 && m.g > m.r * 1.3, `${id} is cyan`);
    assert.ok(m.mean >= 170 && m.mean > brightestEnemy + 30, `${id} is bright (${m.mean.toFixed(0)})`);
  }
  // Enemy shots are hot (the hazard color), not cool like enemies, and red-orange rather than the
  // player's amber: red over green over blue, with a hue redder than any lamp color.
  const hs = measure(frame('proj_hostile'), false);
  assert.ok(hs.r > hs.g && hs.g > hs.b, 'hostile shots are red, then green, then blue');
  const lampHue = Math.min(...['lamp-3', 'lamp-4', 'lamp-5', 'lamp-6'].map((k) => hueOf(...hexRgb(PALETTE[k]))));
  assert.ok(hs.hue >= 15 && hs.hue < 50 && hs.hue < lampHue - 10, `hostile shots are red-orange (hue ${hs.hue.toFixed(0)}, the lamp colors from ${lampHue.toFixed(0)})`);
});

test('atlas: frames lie inside the page with a pixel of space around each, never touching', () => {
  const rects = Object.entries(table.frames).map(([id, [x, y, w, h]]) => ({ id, x, y, w, h }));
  for (const r of rects) assert.ok(r.x >= 1 && r.y >= 1 && r.x + r.w <= table.width - 1 && r.y + r.h <= table.height - 1, `${r.id} has its padding`);
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (b.y >= a.y + a.h + 1) break;
      const apart = a.x + a.w + 1 <= b.x || b.x + b.w + 1 <= a.x || a.y + a.h + 1 <= b.y || b.y + b.h + 1 <= a.y;
      assert.ok(apart, `${a.id} and ${b.id} never touch`);
    }
  }
  assert.ok(table.width <= 2048 && table.height <= 2048, 'one page, well under the GPU limit');
});

test('art: every frame id the renderer, HUD, and title ask for by name exists', () => {
  // The render code names frames as T('id') and atlas.tex('id'): scan it, so renaming a frame
  // fails here instead of throwing "No sprite" on the first run.
  const named = new Set();
  for (const f of ['src/render/runview.js', 'src/render/hud.js', 'src/app/scenes/lampyard.js']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(?:\bT|atlas\.tex)\('([^'$]+)'\)/g)) named.add(m[1]);
  }
  assert.ok(named.size >= 20, `found ${named.size} names`);
  for (const id of named) assert.ok(has(id), `frame "${id}"`);
  for (let d = 0; d < 10; d++) assert.ok(has(`digit:${d}`));
  for (let v = 0; v < 4; v++) assert.ok(has(`tile_floor_${v}`));
});

test('art: the font covers what the HUD writes, and measures what it draws', () => {
  for (const ch of '0123456789:.,!?-+/%()ABCDEFGHIJKLMNOPQRSTUVWXYZ') assert.ok(glyphKey(ch) in FONT, ch);
  assert.equal(glyphKey('a'), 'A');
  assert.equal(glyphKey('×'), 'x');
  assert.equal(glyphKey('~'), null);
  for (const [k, rows] of Object.entries(FONT)) {
    assert.equal(rows.length, 7, k);
    for (const r of rows) assert.match(r, /^[01]{5}$/, k);
    assert.ok(has(`glyph:${k}`) && has(`glyph_o:${k}`), `glyph ${k}`);
    const g = frame(`glyph:${k}`);
    assert.equal(g.w, 5); assert.equal(g.h, 7);
    rows.forEach((r, y) => { for (let x = 0; x < 5; x++) assert.equal(g.rgba[(y * 5 + x) * 4 + 3] > 0, r[x] === '1', `glyph ${k} at ${x},${y}`); });
  }
  assert.equal(textWidth(''), 0);
  assert.equal(textWidth('12:34'), 29);
  assert.equal(digitsWidth(7), 5);
  assert.equal(digitsWidth(1234), 17);
});

test('art: glow and fog textures are well formed (the fog tiles seamlessly)', () => {
  const g = glowFrame(64);
  assert.equal(g.rgba[(32 * 64 + 32) * 4 + 3] > 240, true, 'bright in the middle');
  assert.equal(g.rgba[3], 0, 'clear at the corner');
  const f = fogFrame(128);
  // Tileable: the left and right edges (and top and bottom) continue into each other smoothly.
  let worst = 0;
  for (let y = 0; y < 128; y++) worst = Math.max(worst, Math.abs(f.rgba[(y * 128 + 127) * 4 + 3] - f.rgba[(y * 128) * 4 + 3]));
  for (let x = 0; x < 128; x++) worst = Math.max(worst, Math.abs(f.rgba[(127 * 128 + x) * 4 + 3] - f.rgba[x * 4 + 3]));
  assert.ok(worst < 40, `edge step ${worst} (a seam would show as a jump)`);
});

test('art: the menu stylesheet uses only palette colors, under the palette names', () => {
  const css = readFileSync(resolve(ROOT, 'src/ui/ui.css'), 'utf8');
  const vars = [...css.matchAll(/--([a-z]+-\d|white):\s*(#[0-9a-fA-F]{6})/g)];
  assert.ok(vars.length >= 6, 'the stylesheet defines its colors as palette variables');
  for (const [, name, hex] of vars) assert.equal(hex.toLowerCase(), PALETTE[name], `--${name}`);
  const values = new Set(Object.values(PALETTE));
  const stray = [...css.replace(/--[a-z]+-\d:\s*#[0-9a-fA-F]{6}/g, '').matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()).filter((h) => !values.has(h));
  assert.deepEqual(stray, [], 'no color outside the palette');
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3}\b/g) || [], [], 'no three-digit colors (they would slip past this check)');
  const rgb = new Set(Object.values(PALETTE).map((hx) => [1, 3, 5].map((k) => parseInt(hx.slice(k, k + 2), 16)).join(',')));
  for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) assert.ok(rgb.has(`${m[1]},${m[2]},${m[3]}`), `rgb(${m[1]}, ${m[2]}, ${m[3]}) is a palette color`);
});

test('art: every color on the page is a palette color (the whole game is one set, §16.3)', () => {
  const rgb = new Set(Object.values(PALETTE).map((hx) => parseInt(hx.slice(1), 16)));
  const stray = new Map();
  for (const [id, [x0, y0, w, h]] of Object.entries(table.frames)) {
    if (id === 'shadow_s' || id === 'shadow_m' || id === 'shadow_l') continue; // soft shadows: night-0 at part alpha
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const o = (y * page.width + x) * 4;
      if (page.rgba[o + 3] === 0) continue;
      const c = (page.rgba[o] << 16) | (page.rgba[o + 1] << 8) | page.rgba[o + 2];
      if (!rgb.has(c) && !stray.has(id)) stray.set(id, `#${c.toString(16).padStart(6, '0')}`);
    }
  }
  assert.deepEqual([...stray], []);
});

test('art: materials are outlined and each has its own picture (§16.4)', () => {
  const icons = DATA.materials.map((m) => m.icon);
  assert.equal(new Set(icons).size, icons.length, 'no two materials share an icon');
  const seen = new Map();
  for (const id of icons) {
    const f = frame(id);
    // Outlined: every opaque pixel on the frame's edge is the night-0 outline, and some pixel is.
    let edges = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const o = (y * f.w + x) * 4;
      if (f.rgba[o + 3] === 0) continue;
      const onEdge = x === 0 || y === 0 || x === f.w - 1 || y === f.h - 1;
      if (onEdge) { edges++; assert.ok(same(f.rgba[o], f.rgba[o + 1], f.rgba[o + 2], OUTLINE), `${id}: its edge is outlined`); }
    }
    assert.ok(edges > 0, `${id} has an outline`);
    const key = `${f.w}x${f.h}:${Buffer.from(f.rgba).toString('base64')}`;
    assert.ok(!seen.has(key), `${id} looks exactly like ${seen.get(key)}`);
    seen.set(key, id);
  }
});

test('art: warnings are red-orange, dazed enemies keep their colors', () => {
  const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  for (const name of ['warn', 'warnHot']) {
    const [r, g, b] = rgb(FX_COLOR[name]);   // palette colors are 0xRRGGBB numbers
    assert.ok(r > g && g > b && r >= b * 2, `${name} is red-orange (${r}, ${g}, ${b})`);
    const hue = hueOf(r, g, b);
    assert.ok(hue >= 15 && hue < 50, `${name} is red-orange, not amber (hue ${hue.toFixed(0)})`);
  }
  assert.deepEqual(rgb(LOOK_COLOR[LOOK.DAZED]), [255, 255, 255], 'the daze is shown by a wobble, not by dimming (contrast holds, §16.4)');
});

test('art: the player is drawn above the light, fog, and warnings (§6.2, call 46)', () => {
  const src = readFileSync(resolve(ROOT, 'src/render/runview.js'), 'utf8');
  const m = src.match(/root\.addChild\(([^)]*)\)/);
  assert.ok(m, 'the run view adds its layers in one call');
  const order = m[1].split(',').map((x) => x.trim().replace(/\.container$/, ''));
  const at = (name) => { const k = order.indexOf(name); assert.ok(k >= 0, `layer ${name}`); return k; };
  assert.ok(at('playerLayer') > at('teleG') && at('playerLayer') > at('fogSprite') && at('playerLayer') > at('lightSprite'), `order: ${order.join(', ')}`);
  assert.ok(at('playerLayer') > at('actors'), 'above elites and bosses too');
  assert.match(src, /playerLayer\.addChild\(playerSprite\)/);
});

test('art: the Tidecaller\'s hand shows on its staff in the composed boss (the hand is drawn after the staff)', () => {
  // Every part as it is on the page, the hand marked in a color nothing else uses; compose the
  // rig the way the builder does and count how much of the hand is left on top.
  const rig = RIGS.boss_tidecaller, MARK = [1, 2, 3];
  const parts = new Map();
  let handPixels = 0;
  for (const p of rig.parts) {
    const f = frame(p.frame), g = { id: p.frame, w: f.w, h: f.h, rgba: new Uint8ClampedArray(f.rgba) };
    if (p.name === 'hand') {
      // The hand itself, not its outline (the bell hanging beside it may overlap an outline pixel).
      for (let i = 0; i < g.w * g.h; i++) {
        if (g.rgba[i * 4 + 3] >= 128 && !same(g.rgba[i * 4], g.rgba[i * 4 + 1], g.rgba[i * 4 + 2], OUTLINE)) { g.rgba.set(MARK, i * 4); handPixels++; }
      }
    }
    parts.set(p.frame, g);
  }
  const out = composeRig('boss_tidecaller', rig, parts);
  let shown = 0;
  for (let i = 0; i < out.w * out.h; i++) if (out.rgba[i * 4 + 3] >= 128 && same(out.rgba[i * 4], out.rgba[i * 4 + 1], out.rgba[i * 4 + 2], MARK)) shown++;
  assert.ok(handPixels > 0 && shown === handPixels, `the whole hand shows (${shown} of ${handPixels} pixels)`);
  const k = (name) => rig.parts.findIndex((p) => p.name === name);
  assert.ok(k('hand') > k('staff') && k('hand') > k('robe'), 'the hand is drawn after the staff and the robe');
});

test('art: each building stage shows what it says on the committed atlas, a visible change at every level (§10.4)', () => {
  const NAME = new Map(Object.entries(PALETTE).map(([k, v]) => [v.toLowerCase(), k]));
  /** The palette name of a frame's pixel (null where it's see-through). */
  const nameAt = (f, x, y) => {
    const o = (y * f.w + x) * 4;
    if (f.rgba[o + 3] < 128) return null;
    return NAME.get(`#${[0, 1, 2].map((i) => f.rgba[o + i].toString(16).padStart(2, '0')).join('')}`) ?? 'not in the palette';
  };
  const differ = (a, b) => { let n = 0; for (let i = 0; i < a.rgba.length; i += 4) if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2] || a.rgba[i + 3] !== b.rgba[i + 3]) n++; return n; };
  /** Whether every drawn pixel of `art` is on `f` at (ox, oy), exactly. */
  const stamped = (f, art, ox, oy) => {
    for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) {
      const a = (y * art.w + x) * 4;
      if (art.rgba[a + 3] === 0) continue;
      const o = ((oy + y) * f.w + ox + x) * 4;
      if (f.rgba[o] !== art.rgba[a] || f.rgba[o + 1] !== art.rgba[a + 1] || f.rgba[o + 2] !== art.rgba[a + 2]) return false;
    }
    return true;
  };
  const SIGN = { library: librarySign(), tavern: tavernSign() };
  for (const b of ['library', 'tavern']) {
    const layout = BUILDINGS_LAYOUT[b];
    const { windows, doors } = openings(layout);
    const [ruin, roof, lit, keeper, alive] = ['ruin', 'roof', 'lit', 'keeper', 'alive'].map((s) => frame(`bld_${b}_${s}`));
    [ruin, roof, lit, keeper, alive].reduce((before, now) => { assert.ok(differ(before, now) >= 20, `${now.id} differs from ${before.id}`); return now; });
    // A ruin: you look down into it where the roof was.
    let dark = 0, changed = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < ruin.w; x++) {
      if (/^night/.test(nameAt(ruin, x, y) ?? '')) dark++;
      const o = (y * ruin.w + x) * 4;
      if (ruin.rgba[o] !== roof.rgba[o] || ruin.rgba[o + 1] !== roof.rgba[o + 1] || ruin.rgba[o + 2] !== roof.rgba[o + 2]) changed++;
    }
    assert.ok(dark > ruin.w * 32 * 0.5 && changed > ruin.w * 32 * 0.6, `${b}: the ruin is roofless and dark inside (${dark} dark, ${changed} changed)`);
    // Boarded windows are dark with a plank across; lit ones glow on the glass, brightest at the top.
    assert.ok(windows.length >= 2, `${b} has windows`);
    for (const [tx, ty] of windows) {
      for (const px of [5, 6, 9, 10]) for (let py = 5; py <= 10; py++) {
        const x = tx * 16 + px, y = ty * 16 + py;
        assert.equal(nameAt(lit, x, y), py <= 7 ? 'lamp-5' : 'lamp-4', `${b} lit: the pane at ${x}, ${y}`);
        assert.ok(!/^lamp/.test(nameAt(roof, x, y)), `${b} roof: no light at ${x}, ${y}`);
      }
      for (const [px, py] of [[5, 5], [10, 5], [5, 10], [10, 10]]) assert.equal(nameAt(roof, tx * 16 + px, ty * 16 + py), 'night-1', `${b} roof: the glass dark round the plank`);
      for (let i = 0; i < 10; i++) assert.equal(nameAt(roof, tx * 16 + 3 + i, ty * 16 + 6 + (i >= 5 ? 1 : 0)), 'wood-4', `${b} roof: the plank's lit edge across the window`);
    }
    // The keeper's stage hangs the sign over the door and the lantern beside it; the last one adds
    // a window box under every upper window.
    const [dx, dy] = doors[0];
    const sign = SIGN[b], lantern = wallLantern(), box = flowerBox();
    const signAt = [dx * 16 + Math.floor((16 - sign.w) / 2), dy * 16 - sign.h + 1], lanternAt = [dx * 16 + 12, dy * 16 + 1];
    assert.ok(stamped(keeper, sign, ...signAt) && stamped(alive, sign, ...signAt), `${b}: the sign over the door`);
    assert.ok(stamped(keeper, lantern, ...lanternAt) && stamped(alive, lantern, ...lanternAt), `${b}: the door lantern`);
    assert.ok(!stamped(lit, sign, ...signAt) && !stamped(lit, lantern, ...lanternAt), `${b}: neither before the keeper`);
    const upper = windows.filter(([, ty]) => ty < dy);
    assert.ok(upper.length >= 2, `${b} has upper windows`);
    for (const [tx, ty] of upper) {
      assert.ok(stamped(alive, box, tx * 16 + 2, ty * 16 + 11), `${b}: a window box under ${tx}, ${ty}`);
      assert.ok(!stamped(keeper, box, tx * 16 + 2, ty * 16 + 11), `${b}: not before the last level`);
    }
    // A layout cell's own colors (a stone gable on timber, a timber one on stone) are its own.
    layout.forEach((row, ty) => row.forEach((cell, tx) => {
      if (!cell || typeof cell !== 'object') return;
      const own = new Set(Object.values(cell.colors));
      const instead = Object.keys(cell.colors).map((src) => TOWN_COLORS[src]).filter((n) => !own.has(n));
      const seen = new Set();
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) seen.add(nameAt(lit, tx * 16 + x, ty * 16 + y));
      for (const n of own) assert.ok(seen.has(n), `${b}: its ${tx}, ${ty} tile shows its own ${n}`);
      for (const n of instead) assert.ok(!seen.has(n), `${b}: its ${tx}, ${ty} tile has no ${n} (the town's color for it)`);
    }));
  }
  // The town lamp before its first level is dimmer than lit, glass and all.
  const lamp = frame('hub_lamp'), dim = frame('hub_lamp_dim');
  assert.equal(differ(lamp, dim) > 10, true);
  assert.ok(measure(lamp).mean > measure(dim).mean + 3, `lit ${measure(lamp).mean.toFixed(1)}, dim ${measure(dim).mean.toFixed(1)}`);
  const lampColors = (f) => { const s = new Set(); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const n = nameAt(f, x, y); if (/^lamp/.test(n ?? '')) s.add(n); } return s; };
  assert.ok(lampColors(lamp).has('lamp-6') && !lampColors(dim).has('lamp-6') && !lampColors(dim).has('lamp-5'), 'the lit glass burns white-gold; the dim glass doesn\'t');
  // Townsfolk and characters stand in the same 22 x 22 frame, their feet the same room above its
  // bottom (the lowest row a body wide; a harpoon's butt may reach below it).
  for (const id of [...DATA.npcs.map((n) => n.sprite), ...DATA.characters.map((c) => c.sprite)]) {
    assert.deepEqual(table.frames[id].slice(2), [PLAYER_SIZE, PLAYER_SIZE], `${id} is ${PLAYER_SIZE} x ${PLAYER_SIZE}`);
    const f = frame(id);
    let feet = -1;
    for (let y = 0; y < f.h; y++) { let n = 0; for (let x = 0; x < f.w; x++) if (f.rgba[(y * f.w + x) * 4 + 3] >= 128) n++; if (n >= 5) feet = y; }
    assert.equal(f.h - 1 - feet, PLAYER_FEET_ROOM, `${id}: its feet ${PLAYER_FEET_ROOM} px above its frame's bottom`);
  }
  assert.ok(SPRITES.some((e) => e.kind === 'npc'), 'the townsfolk are built as townsfolk');
});

test('art: every building stage, scaffold, and ruin is its plot\'s size (the view stands each on its plot)', () => {
  const size = (id) => table.frames[id]?.slice(2);
  for (const p of DATA.hub.plots) {
    if (p.building === 'lamp_post') continue;   // the town lamp stands on its one tile (hubview.js place)
    for (let level = 0; level <= 5; level++) {
      const z = stageFrames(p.building, level);
      assert.deepEqual(size(z.frame), [p.w * 16, p.h * 16], `${p.building} at level ${level}: ${z.frame}`);
    }
    assert.deepEqual(size('hub_scaffold_5x4'), [p.w * 16 + 2, p.h * 16 + 2], `the scaffold over the ${p.building}: the plot, and its outline a pixel round it`);
  }
  for (const r of DATA.hub.ruins) assert.deepEqual(size(`bld_${r.id}_ruin`), [r.w * 16, r.h * 16], `the ${r.id} ruin`);
});
