// The atlas's frame table (src/assets/atlas.json, written by tools/atlas/build.mjs), read without
// Pixi so the gate can check it: its shape, and which frames make up an animation.

/** Sprite ids the run view draws with shapes in code rather than from a frame (waves, the lamp's light). */
export const DRAWN_IN_CODE = Object.freeze(['fx_wave', 'fx_wave_big', 'fx_lamplight']);

/** Problems with an atlas table, as plain sentences (empty when it's fine). */
export function checkAtlasJson(json) {
  const out = [];
  if (!json || typeof json !== 'object') return ['the atlas table is missing'];
  if (json.v !== 1) out.push(`the atlas table is version ${json.v}, this build reads version 1`);
  if (!(Number.isInteger(json.width) && Number.isInteger(json.height) && json.width > 0 && json.height > 0)) out.push('the atlas table has no page size');
  if (!json.frames || typeof json.frames !== 'object') { out.push('the atlas table has no frames'); return out; }
  for (const [id, r] of Object.entries(json.frames)) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isInteger)) { out.push(`frame "${id}" is not [x, y, w, h]`); continue; }
    const [x, y, w, h] = r;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > json.width || y + h > json.height) out.push(`frame "${id}" lies outside the page`);
  }
  for (const [id, a] of Object.entries(json.anims || {})) {
    if (!(Number.isInteger(a?.n) && a.n >= 2 && a.fps > 0)) { out.push(`animation "${id}" needs n >= 2 frames and fps > 0`); continue; }
    for (const f of animFrameIds(json, id)) if (!json.frames[f]) out.push(`animation "${id}" is missing frame "${f}"`);
  }
  return out;
}

/** The frame ids of a sprite's animation (just [id] for a still sprite), with a variant suffix. */
export function animFrameIds(json, id, suffix = '') {
  const a = json.anims?.[id];
  const n = a ? a.n : 1;
  const out = [];
  for (let k = 0; k < n; k++) out.push(`${k === 0 ? id : `${id}@${k}`}${suffix}`);
  return out;
}
