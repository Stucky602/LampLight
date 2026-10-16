// What sits over the harbor while you walk it (ARCHITECTURE §10.4): your materials (top left),
// the three things you can nearly afford (bottom left: clear of the buildings up the hill, and of
// the page's status notice in the bottom right), the prompt over what's in reach, what a keeper
// says, a banner when a building comes back, and how to skip a set piece (bottom left too; the
// panels hide during a set piece). DOM in the menu layer, under any screen, never taking input. A
// corner panel fades while you walk under it.
//
// Positions are in the 640 x 360 view's pixels (the view says where things are: toView()); the
// menu layer's --u is one of them in screen pixels.

import { h, fill } from './dom.js';
import { optionText } from './hubtext.js';

const GOAL_ROOM = 16;   // view px under the top margin the goal line takes
const ARROW_PAD = 7;    // the edge arrow's half-size, and a little air

/** Is a point (view px) far enough inside the view for a marker over it (below the goal line)? */
export function onScreen(p, w, h, margin = 18) {
  return p.x >= margin && p.x <= w - margin && p.y >= margin + GOAL_ROOM && p.y <= h - margin;
}

/**
 * Where the guide's marker goes in the 640 x 360 view: over the target when it's on screen
 * (`on`), otherwise at the screen's edge, `margin` px in, on the line toward it, with `angle`
 * (radians, 0 = east) pointing at it. `at`: the target in view pixels. `avoid`: boxes
 * ({ x, y, w, h }, view px: the corner panels and the goal line) an edge arrow mustn't sit on.
 * One that would slides along its edge to the box's nearer end (past every box in the way, and
 * never off the screen), keeping the way it points. A target on screen but under a panel gets an
 * arrow just past the panel's nearest clear edge, pointing at it.
 */
export function guideMarker(at, w, h, margin = 18, avoid = []) {
  const pad = ARROW_PAD;
  const hits = (px, py) => avoid.some((b) => !(px < b.x - pad || px > b.x + b.w + pad || py < b.y - pad || py > b.y + b.h + pad));
  if (onScreen(at, w, h, margin)) {
    if (!hits(at.x, at.y)) return { on: true, x: at.x, y: at.y, angle: Math.PI / 2 };
    // On screen but under a panel: an arrow just past the panel's nearer clear edge, pointing at it.
    let best = null, bestD = Infinity;
    for (const b of avoid) {
      for (const [px, py] of [[at.x, b.y - pad - 1], [at.x, b.y + b.h + pad + 1], [b.x - pad - 1, at.y], [b.x + b.w + pad + 1, at.y]]) {
        if (!onScreen({ x: px, y: py }, w, h, margin) || hits(px, py)) continue;
        const d = Math.abs(px - at.x) + Math.abs(py - at.y);
        if (d < bestD) { bestD = d; best = [px, py]; }
      }
    }
    if (best) return { on: false, x: best[0], y: best[1], angle: Math.atan2(at.y - best[1], at.x - best[0]) };
    return { on: true, x: at.x, y: at.y, angle: Math.PI / 2 };
  }
  const cx = w / 2, cy = h / 2, dx = at.x - cx, dy = at.y - cy;
  // Scale the line from the middle so it meets the inset box.
  const sx = dx === 0 ? Infinity : (w / 2 - margin) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (h / 2 - margin) / Math.abs(dy);
  const s = Math.min(sx, sy);
  let x = cx + dx * s, y = cy + dy * s;
  const angle = Math.atan2(at.y - y, at.x - x);
  const side = sx <= sy;   // on the left or right edge (else the top or bottom)
  if (hits(x, y)) {
    // The nearest end of any box, along this edge, that is on screen and clear of every box.
    let best = null, bestD = Infinity;
    for (const b of avoid) {
      const ends = side ? [b.y - pad - 1, b.y + b.h + pad + 1] : [b.x - pad - 1, b.x + b.w + pad + 1];
      for (const e of ends) {
        const px = side ? x : e, py = side ? e : y;
        if (side ? (py < margin + GOAL_ROOM || py > h - margin) : (px < margin || px > w - margin)) continue;
        if (hits(px, py)) continue;
        const d = Math.abs(side ? py - y : px - x);
        if (d < bestD) { bestD = d; best = [px, py]; }
      }
    }
    if (best) [x, y] = best;
  }
  return { on: false, x, y, angle };
}

/**
 * Where an edge arrow should point when the target is off screen: where the walk to it (a route
 * of tiles, hub/map.js routeTo) leaves the screen, so the arrow follows the streets rather than
 * a straight line through the fog. toView(tile) gives a tile's middle in view pixels. Returns
 * that point, or null when the whole walk is on screen (point at the target itself).
 */
export function routeExit(path, toView, w, h, margin = 18) {
  if (!path) return null;
  for (const t of path) {
    const p = toView(t);
    if (!onScreen(p, w, h, margin)) return p;
  }
  return null;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root the menu layer (ui.view)
 * @param {(id: string, scale?: number) => HTMLElement} o.icon atlas icons
 * @param {(action: string) => HTMLElement} o.glyph button prompts that follow the controller
 * @param {object} o.data the content bundle
 * @param {number} o.viewW the view's size in its pixels (render/layout.js VIEW_W, VIEW_H)
 * @param {number} o.viewH
 */
export function createHubHud({ root, icon, glyph, data, viewW, viewH }) {
  const mats = h('div', { class: 'hud-mats' });
  const next = h('div', { class: 'hud-next' });
  const prompt = h('div', { class: 'hud-prompt', hidden: true });
  const bubble = h('div', { class: 'hud-bubble', hidden: true });
  const banner = h('div', { class: 'hud-banner', hidden: true });
  const skip = h('div', { class: 'hud-skip', hidden: true }, glyph('confirm'), ' Skip');
  const goal = h('div', { class: 'hud-goal', hidden: true });
  const arrow = h('div', { class: 'hud-guide', hidden: true });
  const el = h('div', { class: 'hub-hud' }, mats, next, prompt, bubble, banner, skip, goal, arrow);
  root.prepend(el);   // under every screen
  // The materials the harbor asks for: the ones some building, project, or upgrade costs.
  const wanted = data.materials.filter((m) => [
    ...data.buildings.flatMap((b) => b.levels.map((l) => l.cost)), ...data.research.map((r) => r.cost), ...data.upgrades.map((u) => u.cost),
  ].some((c) => c[m.id] > 0));
  let bannerUntil = 0, bubbleFor = null, promptKey = '', goalText = '';
  let guideShown = null;   // what setGuide last placed: { target, marker } (for tests and tools)
  const at = (node, x, y) => { node.style.left = `calc(var(--u) * ${Math.round(x)})`; node.style.top = `calc(var(--u) * ${Math.round(y)})`; };
  const unit = () => parseFloat(root.style.getPropertyValue('--u')) || 1;

  return {
    el,
    /** Material counts, in the data's order (the ones you have none of, dimmed). */
    setMaterials(have) {
      fill(mats, ...wanted.map((m) => {
        const n = have?.[m.id] ?? 0;
        return h('span', { class: `hud-mat${n > 0 ? '' : ' none'}`, title: m.name }, icon(m.icon, 1), ` ${n}`);
      }));
    },
    /** The next three (meta/next.js nextAffordable). */
    setNext(options) {
      if (!options.length) { fill(next); next.hidden = true; return; }
      next.hidden = false;
      fill(next, h('div', { class: 'hud-next-title' }, 'Next up'), ...options.map((o) => {
        const t = optionText(data, o);
        return h('div', { class: 'hud-next-row' },
          h('div', { class: 'hud-next-name' }, t.title),
          h('span', { class: 'meter' }, h('span', { class: 'meter-fill', style: { width: `${Math.round(t.progress * 100)}%` } })),
          h('div', { class: t.need ? 'hud-next-need' : 'hud-next-ready' }, t.need ?? t.readyAt));
      }));
    },
    /**
     * Fade a corner panel while you're under it. pos: where your feet are in the view (null: you
     * aren't out, as in a set piece). Call before placing the prompt and the bubble, so the
     * panels are measured before anything moves.
     */
    placePlayer(pos) {
      const u = unit(), r = el.getBoundingClientRect();
      for (const node of [mats, next]) {
        let under = false;
        if (pos && !node.hidden) {
          const b = node.getBoundingClientRect();
          const x = r.left + pos.x * u, y = r.top + pos.y * u;
          // Your figure stands about 22 px tall over its feet, and 8 px either side.
          under = x > b.left - 8 * u && x < b.right + 8 * u && y > b.top && y < b.bottom + 22 * u;
        }
        node.classList.toggle('under', under);
      }
    },
    /** The prompt over what's in reach: text, at a view position (null hides it). */
    setPrompt(text, pos) {
      if (!text || !pos) { prompt.hidden = true; promptKey = ''; return; }
      if (promptKey !== text) { fill(prompt, glyph('confirm'), ` ${text}`); promptKey = text; }
      prompt.hidden = false;
      at(prompt, pos.x, pos.y);
    },
    /** A keeper's line in a bubble over them, until `untilMs` or until they're out of reach. */
    say(id, name, text, untilMs) {
      bubbleFor = { id, untilMs };
      fill(bubble, h('span', { class: 'bubble-name' }, name), h('span', { class: 'bubble-text' }, text));
    },
    /** Place (or hide) the bubble: pos of the person speaking, now in ms, and who's in reach. */
    placeBubble(pos, nowMs, nearId) {
      if (!bubbleFor || !pos || nowMs > bubbleFor.untilMs || nearId !== bubbleFor.id) { bubble.hidden = true; if (bubbleFor && (nowMs > bubbleFor.untilMs || nearId !== bubbleFor.id)) bubbleFor = null; return; }
      bubble.hidden = false;
      at(bubble, pos.x, pos.y);
    },
    get speaking() { return bubbleFor?.id ?? null; },
    /** A banner across the top: a title and a few lines, for `ms`. */
    showBanner(title, lines, nowMs, ms = 4200) {
      fill(banner, h('div', { class: 'banner-title' }, title), ...lines.map((t) => h('div', { class: 'banner-line' }, t)));
      banner.hidden = false;
      bannerUntil = nowMs + ms;
    },
    tick(nowMs) { if (!banner.hidden && nowMs > bannerUntil) banner.hidden = true; },
    setSkip(on) { skip.hidden = !on; },
    /**
     * The new player's guide (meta/guide.js): its goal across the top, and a marker (guideMarker,
     * above: over the target when it's on screen, at the edge pointing to it when not, clear of
     * the corner panels). `target`: where it is in view pixels, or null for no marker; a null
     * text hides both.
     */
    setGuide(text, target) {
      guideShown = text && target ? { target: { x: target.x, y: target.y }, marker: null } : null;
      if (!text) { goal.hidden = true; arrow.hidden = true; goalText = ''; return; }
      if (text !== goalText) { fill(goal, text); goalText = text; }
      goal.hidden = !banner.hidden;   // a banner has the top for a moment
      arrow.hidden = !target;
      if (!target) return;
      let marker = guideMarker(target, viewW, viewH);
      {
        // Clear of the corner panels and the goal line, as they're laid out now.
        const u = unit(), r = el.getBoundingClientRect();
        const avoid = [];
        for (const node of [mats, next, goal]) {
          if (node.hidden) continue;
          const b = node.getBoundingClientRect();
          if (b.width > 0) avoid.push({ x: (b.left - r.left) / u, y: (b.top - r.top) / u, w: b.width / u, h: b.height / u });
        }
        marker = guideMarker(target, viewW, viewH, 18, avoid);
      }
      guideShown.marker = marker;
      at(arrow, marker.x, marker.y);
      arrow.classList.toggle('on', marker.on);
      arrow.style.transform = marker.on ? '' : `translate(-50%, -50%) rotate(${(marker.angle * 180) / Math.PI - 90}deg)`;
    },
    /** What the guide's marker last pointed at and where it went (null: none). */
    get guideShown() { return guideShown; },
    /** Hide the corner panels (while a screen or a set piece has the stage). */
    setQuiet(on) { el.classList.toggle('quiet', !!on); },
    destroy() { el.remove(); },
  };
}
