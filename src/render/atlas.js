// The sprite atlas as Pixi textures (ARCHITECTURE §6.2, §16.3). The atlas is built in the
// workspace from the art packs (tools/atlas/build.mjs) and shipped as src/assets/atlas.png plus
// its frame table, atlas.json; the boot code loads the image and hands both over here.
//
// One texture source holds every sprite, so any ParticleContainer can draw any of them. The
// light glow and the fog noise are separate small textures made at boot (render/textures.js).

import { Texture, Rectangle } from 'pixi.js';
import { glowFrame, fogFrame } from './textures.js';
import { checkAtlasJson, animFrameIds } from './atlasdata.js';

function canvasFrom(width, height, rgba) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return c;
}

function textureFrom(resource, scaleMode = 'nearest', wrap = 'clamp-to-edge') {
  // Skip Pixi's global cache (it would hold the resource forever under a made-up key).
  const t = Texture.from(resource, true);
  t.source.scaleMode = scaleMode;
  t.source.addressMode = wrap;
  return t;
}

/**
 * @param {object} o
 * @param {HTMLImageElement|ImageBitmap|HTMLCanvasElement} o.image the atlas page, loaded
 * @param {object} o.json the frame table (atlas.json)
 * @param {string} [o.url] the page's URL, for the menus' icons
 */
export function createAtlas({ image, json, url = null }) {
  const problems = checkAtlasJson(json);
  if (problems.length) throw new Error(`The sprite atlas is damaged: ${problems[0]}`);
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  if (iw !== json.width || ih !== json.height) {
    throw new Error(`The sprite atlas image is ${iw}x${ih}, but its table says ${json.width}x${json.height}`);
  }
  const base = textureFrom(image);
  const textures = new Map();
  for (const [id, [x, y, w, h]] of Object.entries(json.frames)) {
    textures.set(id, new Texture({ source: base.source, frame: new Rectangle(x, y, w, h) }));
  }
  const g = glowFrame(64);
  const glow = textureFrom(canvasFrom(g.w, g.h, g.rgba), 'linear');
  const f = fogFrame(128);
  const fog = textureFrom(canvasFrom(f.w, f.h, f.rgba), 'linear', 'repeat');
  const tex = (id) => {
    const t = textures.get(id);
    if (!t) throw new Error(`No sprite "${id}" in the atlas`);
    return t;
  };
  return {
    /** A frame's texture; throws on an unknown id (tests/art.test.js checks every id the game uses). */
    tex,
    has: (id) => textures.has(id),
    /** A sprite's animation frames (one for a still sprite), with a variant suffix ('#flash', '#elite'). */
    frames: (id, suffix = '') => animFrameIds(json, id, suffix).map(tex),
    /** { n, fps } for a sprite (n = 1 when it doesn't animate). */
    anim: (id) => json.anims?.[id] || { n: 1, fps: 0 },
    /** The pixel rectangle of a frame on the page, or null. */
    rect: (id) => { const r = json.frames[id]; return r ? { x: r[0], y: r[1], w: r[2], h: r[3] } : null; },
    /** The page's URL (the DOM menus draw icons from it). */
    url,
    glow,
    fog,
    source: base.source,
    frameCount: textures.size,
    sheet: { width: json.width, height: json.height },
    destroy() {
      for (const t of textures.values()) t.destroy(false);
      base.destroy(true); glow.destroy(true); fog.destroy(true);
    },
  };
}
