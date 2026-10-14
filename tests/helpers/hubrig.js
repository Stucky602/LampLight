// The harbor view run in Node (tests/hubview.test.js, tests/harbor.test.js): the real
// render/hubview.js on Pixi's real scene graph, with stand-ins for what needs a browser. A canvas
// stand-in (recording what's drawn into it: the fog's clear mask), the committed atlas's frame
// table on a blank page of its size, and a renderer that renders nothing but records what it was
// asked to render (the light map's lights and the fog's layers, as they were at that moment, into
// which target, and whether it was cleared first).
// The world is the real hub world, built from a profile as the harbor scene builds it.

import { Container } from 'pixi.js';
import { readFileSync } from 'node:fs';
import { DATA } from '../../src/data/index.js';
import { HUB_TERRAIN } from '../../src/data/hub.js';
import { defaultProfile } from '../../src/save/schema.js';
import { revealedFog, hubPeople, shownProps } from '../../src/meta/index.js';
import { createHubWorld, setPeople } from '../../src/hub/world.js';
import { createHubTuning } from '../../src/hub/tuning.js';
import { levelsOf } from '../../src/app/hublogic.js';
import { createAtlas } from '../../src/render/atlas.js';
import { createHubView } from '../../src/render/hubview.js';

/** A canvas: its size, a 2D context that records drawImage calls, and the last image put into it. */
export class FakeCanvas {
  constructor() { this.width = 300; this.height = 150; this.drawn = 0; this.puts = 0; this.image = null; this.ctx = null; }
  getContext(kind) {
    if (kind !== '2d') return null;
    const canvas = this;
    this.ctx ??= {
      canvas,
      drawImage() { canvas.drawn++; },
      createImageData(w, h) { return new FakeImageData(new Uint8ClampedArray(w * h * 4), w, h); },
      putImageData(img) { canvas.puts++; canvas.image = { data: Uint8ClampedArray.from(img.data), width: img.width, height: img.height }; },
    };
    return this.ctx;
  }
}

class FakeImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height ?? data.length / 4 / width; }
}

/** Pixi takes a canvas when HTMLCanvasElement names its class; the view makes them through document. */
export function installCanvas() {
  globalThis.HTMLCanvasElement ??= FakeCanvas;
  globalThis.ImageData ??= FakeImageData;
  if (!globalThis.document) globalThis.document = { createElement: () => { throw new Error('hubrig: only canvases here'); } };
  const make = globalThis.document.createElement.bind(globalThis.document);
  if (!globalThis.document.createElement.hubrig) {
    const createElement = (tag, ...rest) => (String(tag).toLowerCase() === 'canvas' ? new FakeCanvas() : make(tag, ...rest));
    createElement.hubrig = true;
    globalThis.document.createElement = createElement;
  }
}

export const ATLAS_JSON = JSON.parse(readFileSync(new URL('../../src/assets/atlas.json', import.meta.url), 'utf8'));

/** The committed atlas's frames on a blank page (the pixels aren't needed to place things). */
export function nodeAtlas() {
  installCanvas();
  const page = new FakeCanvas();
  page.width = ATLAS_JSON.width; page.height = ATLAS_JSON.height;
  return createAtlas({ image: page, json: ATLAS_JSON });
}

/** A profile with these building levels. */
export function profileWith(levels = {}) {
  const d = defaultProfile();
  Object.assign(d.profile.buildings, levels);
  return d;
}

const sprite = (s) => ({ label: s.label, visible: s.visible, x: s.x, y: s.y, sx: s.scale.x, sy: s.scale.y, tint: s.tint, alpha: s.alpha, blend: s.blendMode });

/** What a render call was asked to draw, kept as it was then. */
function capture({ container, target, clear: cleared, clearColor }) {
  const into = { target, cleared: cleared === true, clearColor };
  if (container.label === 'light-map') {
    const pool = container.children[0];
    return { kind: 'light', ...into, blend: pool.blendMode, lights: pool.children.filter((s) => s.visible).map(sprite) };
  }
  if (container.label === 'fog-layer') {
    const [fill, wisps, clear] = container.children;
    const canvas = clear.texture.source.resource;
    return {
      kind: 'fog', ...into, order: container.children.map((c) => c.label),
      fill: { ...sprite(fill), w: fill.width, h: fill.height }, wisps: { ...sprite(wisps), tx: wisps.tilePosition.x, ty: wisps.tilePosition.y }, clear: sprite(clear),
      mask: canvas.image, maskPuts: canvas.puts,
    };
  }
  return { kind: container.label };
}

/**
 * A harbor, drawn: the view over a world built from `profile` (or `levels`), both on `tuning`
 * (the live tuning; a fresh one by default). `frame(alpha, ms)` draws once and returns what was
 * rendered ({ light, fog }); `find(label)` is a part of the scene.
 */
export function hubRig({ levels = {}, profile = null, tuning = createHubTuning(), data = DATA } = {}) {
  const atlas = nodeAtlas();
  const renders = [];
  const renderer = { world: new Container(), camera: { x: 0, y: 0 }, app: { renderer: { render: (o) => renders.push(capture(o)) } } };
  const view = createHubView({ renderer, atlas, data, tuning });
  const doc = profile ?? profileWith(levels);
  const world = createHubWorld({
    hub: data.hub, terrain: HUB_TERRAIN, tuning: data.tuning, timing: tuning.timing,
    revealed: revealedFog(doc, data), props: shownProps(doc, data), moveSpeed: 1,
  });
  setPeople(world, hubPeople(doc, data));
  view.attach(world, levelsOf(doc, data));
  return {
    view, world, atlas, tuning, doc, renderer,
    frame(alpha = 1, ms = 1000 / 60) {
      renders.length = 0;
      view.draw(alpha, ms);
      return { light: renders.find((r) => r.kind === 'light'), fog: renders.find((r) => r.kind === 'fog') };
    },
    find(label) { return renderer.world.getChildByLabel(label, true); },
  };
}
