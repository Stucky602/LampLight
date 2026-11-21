// The edge arrows (0.8.2, proposal 2.1): one arrow per kind of thing on the map, to the nearest
// one, while it's off screen (sim/signs.js collectArrows says which). Each is the kind's own color
// and wears the kind's own minimap mark in a dark disc, with a pointer toward it, so two kinds are
// never told apart by color alone. Drawn in the HUD's layer (render/hud.js), kept clear of the HUD's
// corners, and spread along the edge so two never sit on each other. Settings can turn them off
// (save/schema.js hud.arrows).
//
// Pure placement here (tested in Node); render/hud.js draws them.

import { ARROW } from '../sim/signs.js';
import { MARK } from './minimapmodel.js';

/** Each arrow kind's color (render/signview.js SIGN_COLOR's key) and the minimap mark it wears. */
export const ARROW_LOOK = Object.freeze({
  [ARROW.LAMP]: Object.freeze({ color: 'lamp', mark: MARK.LAMP }),
  [ARROW.BELL]: Object.freeze({ color: 'bell', mark: MARK.BELL }),
  [ARROW.FERRY]: Object.freeze({ color: 'ferry', mark: MARK.FERRY }),
  [ARROW.RELIQUARY]: Object.freeze({ color: 'reliquary', mark: MARK.RELIQUARY }),
  [ARROW.CHEST]: Object.freeze({ color: 'chest', mark: MARK.CHEST }),
  [ARROW.VAULT]: Object.freeze({ color: 'vault', mark: MARK.VAULT }),
  [ARROW.WELL]: Object.freeze({ color: 'well', mark: MARK.WELL }),
  [ARROW.CRANE]: Object.freeze({ color: 'crane', mark: MARK.CRANE }),
  [ARROW.CAIRN]: Object.freeze({ color: 'cairn', mark: MARK.CAIRN }),
});

/**
 * An arrow's size: the disc's radius, how far its pointer reaches, the least gap between two, and
 * how far in from the view's edge they sit (further from the top, under the HUD's top line).
 */
export const ARROW_SIZE = Object.freeze({ disc: 6, tip: 11, spacing: 16, margin: 13, top: 30 });

/** A placed arrow record (reused frame to frame). */
export function makePlaced() { return { kind: 0, x: 0, y: 0, angle: 0, s: 0 }; }

/**
 * Where on the inset rectangle (margin px in from a w x h view's sides and bottom, `top` px from
 * its top) the line from the view's middle to a target (tx, ty: view px) meets it; into out { x, y,
 * angle (radians, toward the target), s (the point's distance round the rectangle, clockwise from
 * its top-left corner) }.
 */
export function edgePoint(tx, ty, w, h, margin, out, top = margin) {
  const cx = w / 2, cy = h / 2, dx = tx - cx, dy = ty - cy;
  const kx = dx > 0 ? (w - margin - cx) / dx : dx < 0 ? (margin - cx) / dx : Infinity;
  const ky = dy > 0 ? (h - margin - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
  const k = Math.min(kx, ky);
  out.x = cx + dx * k; out.y = cy + dy * k;
  out.angle = Math.atan2(dy, dx);
  out.s = perimeterOf(out.x, out.y, w, h, margin, top);
  return out;
}

/** A point on the inset rectangle's distance round it, clockwise from its top-left corner. */
export function perimeterOf(x, y, w, h, margin, top = margin) {
  const L = margin, T = top, R = w - margin, B = h - margin, W = R - L, H = B - T;
  const e = 0.5;
  if (Math.abs(y - T) <= e) return x - L;
  if (Math.abs(x - R) <= e) return W + (y - T);
  if (Math.abs(y - B) <= e) return W + H + (R - x);
  return 2 * W + H + (B - y);
}

/** The point at distance s round the inset rectangle (wrapping), into out { x, y }. */
export function pointAt(s, w, h, margin, out, top = margin) {
  const L = margin, T = top, R = w - margin, B = h - margin, W = R - L, H = B - T, P = 2 * (W + H);
  let d = ((s % P) + P) % P;
  if (d <= W) { out.x = L + d; out.y = T; return out; }
  d -= W;
  if (d <= H) { out.x = R; out.y = T + d; return out; }
  d -= H;
  if (d <= W) { out.x = R - d; out.y = B; return out; }
  d -= W;
  out.x = L; out.y = B - d;
  return out;
}

/** Is a point (with an arrow's reach round it) on one of the boxes ({ x, y, w, h }, view px)? */
function onBox(x, y, boxes, pad) {
  for (const b of boxes) if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return b;
  return null;
}

const tmp = { x: 0, y: 0 };
const order = [];   // the arrows by their place round the edge (reused)

/**
 * Place this frame's arrows. targets: collectArrows's records (world px), n of them; cam: the
 * camera's middle (world px); w, h: the view (px); avoid: boxes the arrows keep off (the HUD's
 * corners). Fills `out` (makePlaced records, grown as needed) and returns how many: each on the
 * view's edge on the line toward its target, slid along the edge off any box, then spread so no
 * two are closer than ARROW_SIZE.spacing, keeping their order round the edge; its angle still
 * points at its target from where it ends up.
 */
export function placeArrows(targets, n, cam, w, h, avoid, out) {
  const m = ARROW_SIZE.margin, top = ARROW_SIZE.top, pad = ARROW_SIZE.tip;
  const W = w - 2 * m, H = h - m - top, P = 2 * (W + H);
  for (let k = 0; k < n; k++) {
    if (k >= out.length) out.push(makePlaced());
    const t = targets[k], o = out[k];
    o.kind = t.kind;
    edgePoint(t.x - cam.x + w / 2, t.y - cam.y + h / 2, w, h, m, o, top);
    // Off any box: walk round the edge, both ways, to the nearest clear spot.
    if (onBox(o.x, o.y, avoid, pad)) {
      for (let d = 2; d < P / 2; d += 2) {
        pointAt(o.s + d, w, h, m, tmp, top);
        if (!onBox(tmp.x, tmp.y, avoid, pad)) { o.s += d; break; }
        pointAt(o.s - d, w, h, m, tmp, top);
        if (!onBox(tmp.x, tmp.y, avoid, pad)) { o.s -= d; break; }
      }
      o.s = ((o.s % P) + P) % P;
    }
  }
  // Spread along the edge: sort by s, then push each at least `spacing` past the one before.
  order.length = 0;
  for (let k = 0; k < n; k++) order.push(out[k]);
  order.sort((a, b) => a.s - b.s);
  for (let k = 1; k < order.length; k++) if (order[k].s - order[k - 1].s < ARROW_SIZE.spacing) order[k].s = order[k - 1].s + ARROW_SIZE.spacing;
  for (let k = 0; k < n; k++) {
    const o = out[k];
    pointAt(o.s, w, h, m, o, top);
    // A spread arrow that landed on a box steps on past it.
    for (let g = 0; g < 40 && onBox(o.x, o.y, avoid, pad); g++) { o.s += 4; pointAt(o.s, w, h, m, o, top); }
  }
  // Each points at its own target from where it ended up.
  for (let k = 0; k < n; k++) {
    const t = targets[k], o = out[k];
    o.angle = Math.atan2(t.y - cam.y + h / 2 - o.y, t.x - cam.x + w / 2 - o.x);
  }
  return n;
}
