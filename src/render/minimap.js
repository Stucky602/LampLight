// The run's minimap, drawn (ARCHITECTURE §6.2; what it shows and where: render/minimapmodel.js).
// The ground is a texture of the map, a pixel a tile, filled in as you see it: a tile shows once
// it has been on your screen (minimapmodel.js revealView, from the run view's camera), so the map
// is yours to uncover (and the wreck's secret stays one until you've been near it). Marks are
// small shapes, a few pixels each, redrawn every frame.

import { Container, Graphics, Sprite } from 'pixi.js';
import { canvasFrom, textureFrom } from './atlas.js';
import { color as pal, PALETTE } from '../data/palette.js';
import { GROUND } from '../sim/terrain.js';
import { VIEW_W, VIEW_H } from './layout.js';
import { MARK, MARK_SHAPES, createMarks, minimapWindow, minimapMarks, revealView, minimapFade } from './minimapmodel.js';

const rgb = (name) => { const n = parseInt(PALETTE[name].slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// The ground's colors: open ground dark, obstacles a step lighter, water darkest and blue.
const KIND_RGB = {
  [GROUND.FLOOR]: rgb('night-3'), [GROUND.BRIDGE]: rgb('night-3'), [GROUND.DECK]: rgb('night-3'),
  [GROUND.CRATE]: rgb('night-5'), [GROUND.SHED_ROOF]: rgb('night-5'), [GROUND.SHED_WALL]: rgb('night-5'), [GROUND.SHED_DOOR]: rgb('night-5'),
  [GROUND.WRECK]: rgb('night-5'), [GROUND.WATER]: rgb('sea-1'),
};
// The marks' colors (their shapes: minimapmodel.js MARK_SHAPES).
const MARK_COL = {
  [MARK.MATERIAL]: pal('fog-3'), [MARK.HEAL]: pal('moss-4'), [MARK.MAGNET]: pal('sea-5'), [MARK.EMBER]: pal('violet-4'),
  [MARK.CHEST]: pal('lamp-5'), [MARK.ELITE]: pal('rot-3'), [MARK.BOSS]: pal('rot-3'), [MARK.PLAYER]: pal('lamp-6'),
};
const RARE_COL = pal('sea-6');
const FRAME = pal('night-0'), BACK = pal('night-1'), EDGE = pal('night-5');
// Fill styles made once (a fill({ color }) a mark a frame would be garbage every frame).
const F = Object.fromEntries(Object.entries(MARK_COL).map(([k, c]) => [k, Object.freeze({ color: c })]));
const F_FRAME = Object.freeze({ color: FRAME }), F_RARE = Object.freeze({ color: RARE_COL });
const REFRESH_MS = 150; // newly seen ground goes to the GPU at most this often (by the clock, not frames)

export function createMinimap() {
  const root = new Container();
  const back = new Graphics();
  const ground = new Sprite();
  const mask = new Graphics();
  const marksG = new Graphics();
  // The ground and the marks are clipped to the box (a mark near its edge never spills past it).
  const clip = new Container();
  clip.addChild(ground, marksG);
  clip.mask = mask;
  root.addChild(back, clip, mask);
  const feet = { x: 0, y: 0 };
  const marks = createMarks();
  const win = { s: 1, ox: 0, oy: 0 };
  let world = null, canvas = null, tex = null, rgba = null, img = null, seen = null, cols = 0, rows = 0, rare = null;
  let lastKey = NaN, lastKey2 = NaN, dirty = false, flushedAt = -Infinity, lastBox = null, lastMode = '';

  const paint = (i) => {
    const T = world.terrain;
    const k = T.kinds ? T.kinds[i] : (T.solid[i] ? GROUND.CRATE : GROUND.FLOOR);
    const c = KIND_RGB[k] ?? KIND_RGB[GROUND.FLOOR];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  };

  return {
    root,
    /** A new run's map: an empty (unseen) ground texture its size. */
    attach(w) {
      world = w;
      const T = w.terrain;
      cols = T.cols; rows = T.rows;
      rgba = new Uint8ClampedArray(cols * rows * 4);
      img = new ImageData(rgba, cols, rows);   // shares rgba: a flush puts whatever it holds now
      seen = new Uint8Array(cols * rows);
      rare = Uint8Array.from(w.materialDefs ?? [], (m) => (m.rare ? 1 : 0));
      lastKey = lastKey2 = NaN; dirty = true; flushedAt = -Infinity; lastBox = null;
      canvas = canvasFrom(cols, rows, rgba);
      tex?.destroy(true);
      tex = textureFrom(canvas);
      ground.texture = tex;
    },
    detach() { world = null; },
    /**
     * Uncover what the camera shows (camera: the run view's, kept inside the map), even with the
     * minimap off, so turning it on shows everywhere you've been; then draw it in `box`
     * (minimapmodel.js minimapBox) for `mode`, box null hiding it. nowMs: the HUD's clock.
     */
    draw(box, mode, camera, nowMs) {
      if (!world) { root.visible = false; return; }
      if (camera) {
        // Only when the tiles under the view change (not every shake or sub-tile step).
        const t = world.terrain.tile;
        const key = Math.floor((camera.x - VIEW_W / 2) / t) * 4096 + Math.floor((camera.y - VIEW_H / 2) / t);
        const key2 = Math.floor((camera.x + VIEW_W / 2 - 1e-6) / t) * 4096 + Math.floor((camera.y + VIEW_H / 2 - 1e-6) / t);
        if (key !== lastKey || key2 !== lastKey2) {
          lastKey = key; lastKey2 = key2;
          if (revealView(seen, cols, rows, t, camera.x, camera.y, VIEW_W, VIEW_H, paint) > 0) dirty = true;
        }
      }
      root.visible = !!box;
      if (!box) return;
      if (camera) { feet.x = world.player.x - camera.x + VIEW_W / 2; feet.y = world.player.y - camera.y + VIEW_H / 2; }
      root.alpha = minimapFade(box, camera ? feet : null);
      if (dirty && nowMs - flushedAt >= REFRESH_MS) {
        canvas.getContext('2d').putImageData(img, 0, 0);
        tex.source.update();
        dirty = false; flushedAt = nowMs;
      }
      if (box !== lastBox || mode !== lastMode) {
        // The frame and its mask change only with the setting.
        lastBox = box; lastMode = mode;
        back.clear();
        back.rect(box.x - 2, box.y - 2, box.w + 4, box.h + 4).fill({ color: FRAME, alpha: 0.8 });
        back.rect(box.x - 1, box.y - 1, box.w + 2, box.h + 2).stroke({ width: 1, color: EDGE, alpha: 0.8 });
        back.rect(box.x, box.y, box.w, box.h).fill({ color: BACK, alpha: 0.7 });
        mask.clear(); mask.rect(box.x, box.y, box.w, box.h).fill({ color: 0xffffff });
        // Nearby is whole pixels a tile; the whole map is smaller than a pixel a tile, so it's smoothed.
        tex.source.scaleMode = mode === 'map' ? 'linear' : 'nearest';
      }
      minimapWindow(world, box, mode, win);
      ground.scale.set(world.terrain.tile * win.s);
      ground.position.set(box.x - win.ox * win.s, box.y - win.oy * win.s);
      ground.alpha = 0.8;
      marksG.clear();
      const n = minimapMarks(world, marks, box, win);
      for (let k = 0; k < n; k++) {
        const kind = marks.kind[k], x = Math.round(marks.x[k]), y = Math.round(marks.y[k]);
        const col = kind === MARK.MATERIAL && rare[marks.a[k]] ? F_RARE : F[kind];
        for (const [dx, dy, w, h, ink] of MARK_SHAPES[kind]) marksG.rect(x + dx, y + dy, w, h).fill(ink ? col : F_FRAME);
      }
    },
    /** For tests and tools: whether tile i has been seen, and the ground canvas (its last put image). */
    seenAt(i) { return seen ? seen[i] === 1 : false; },
    get canvas() { return canvas; },
    destroy() { tex?.destroy(true); root.destroy({ children: true }); },
  };
}
