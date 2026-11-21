// The run's minimap (ARCHITECTURE §6.2): where it sits, what it shows, and where each mark goes.
// Pure (tested in Node); render/minimap.js draws it. It shows the ground (water, sheds, crates),
// you, elites and bosses, and every drop but the experience gems (there are hundreds of those,
// and they would bury the rest). Ordinary enemies aren't shown.
//
// Settings (save/schema.js hud): minimap 'nearby' (a window around you), 'map' (the whole map),
// or 'off'; minimapSize 'small' or 'large'.

import { VIEW_W } from './layout.js';
import { HUD_LAYOUT } from './hudmodel.js';
import { EF, PK, TASK, TASK_STATE } from '../sim/constants.js';
import { wardAt } from '../sim/tasks.js';
import { PLAYER_FEET_ROOM } from './playerframe.js';

export const MINIMAP = Object.freeze({
  size: Object.freeze({ small: 72, large: 120 }),   // view px, square
  top: 22,               // under the kills line (its 12-row cell and outline end at 19; a comma's tail drops below the baseline)
  // 'nearby' draws the ground at whole pixels a tile (no shimmer as it slides): small 72 tiles
  // across (about two screens), large 60 (1.5 screens, at twice the size).
  nearbyPxPerTile: Object.freeze({ small: 1, large: 2 }),
  fadeAlpha: 0.25,       // while you're under it
});

/**
 * Mark kinds. Drawn materials first, then the other drops, the places (tasks, the skiff, a
 * secret), elites and bosses, and you on top.
 */
export const MARK = Object.freeze({
  MATERIAL: 0, HEAL: 1, MAGNET: 2, EMBER: 3, CHEST: 4, ELITE: 5, BOSS: 6, PLAYER: 7,
  LAMP: 8, LAMP_LIT: 9, BELL: 10, FERRY: 11, RELIQUARY: 12, SECRET: 13, WELL: 14,
  // 0.8.2: a lamp started and left part-lit, a bell tolled (its crew on the way), and the vault
  // (it shared the Reliquary's box before).
  LAMP_PART: 15, BELL_ON: 16, VAULT: 17,
  // 0.9.0 (W4): the Docks' crane and the Marsh's salt cairn (while ready).
  CRANE: 18, CAIRN: 19,
});

/** A diamond of radius r as rects [dx, dy, w, h, ink]: filled, or its outline only. */
function diamondRects(r, filled) {
  const out = [];
  for (let d = -r; d <= r; d++) {
    const w = r - Math.abs(d);
    if (filled) out.push([-w, d, 2 * w + 1, 1, 1]);
    else if (w === 0) out.push([0, d, 1, 1, 1]);
    else out.push([-w, d, 1, 1, 1], [w, d, 1, 1, 1]);
  }
  return out;
}

/**
 * Each mark's shape, around its point: rects [dx, dy, w, h, ink] (ink 1 the mark's color, 0 the
 * dark of the night). Every kind its own shape, so none is told apart by color alone: you a ring
 * with a dot; a boss a filled diamond and an elite a hollow one; a chest a hollow box wider than
 * tall; an Ember a big plus with a dark middle; food a small plus; a magnet a U; a material a
 * 2 px dot (rare ones in a brighter color); a Wayside Lamp a triangle pointing up (hollow until
 * it's lit); a Fog Bell an upside-down hollow cup; the Ferryman's skiff a wide flat bowl; a
 * Reliquary or the vault a hollow box taller than wide; a secret an X; the Salt Well, once open, a
 * ring round a dark middle wider than the chest's box.
 */
export const MARK_SHAPES = Object.freeze({
  [MARK.PLAYER]: [[-1, -2, 3, 1, 1], [-1, 2, 3, 1, 1], [-2, -1, 1, 3, 1], [2, -1, 1, 3, 1], [0, 0, 1, 1, 1]],
  [MARK.BOSS]: diamondRects(3, true),
  [MARK.ELITE]: diamondRects(2, false),
  [MARK.CHEST]: [[-2, -1, 5, 1, 1], [-2, 1, 5, 1, 1], [-2, 0, 1, 1, 1], [2, 0, 1, 1, 1]],
  [MARK.EMBER]: [[-1, -2, 3, 5, 1], [-2, -1, 5, 3, 1], [0, 0, 1, 1, 0]],
  [MARK.HEAL]: [[0, -1, 1, 3, 1], [-1, 0, 3, 1, 1]],
  [MARK.MAGNET]: [[-1, -1, 1, 2, 1], [1, -1, 1, 2, 1], [-1, 1, 3, 1, 1]],
  [MARK.MATERIAL]: [[0, 0, 2, 2, 1]],
  [MARK.LAMP]: [[0, -2, 1, 1, 1], [-1, -1, 1, 1, 1], [1, -1, 1, 1, 1], [-2, 0, 1, 1, 1], [2, 0, 1, 1, 1], [-2, 1, 5, 1, 1]],
  [MARK.LAMP_LIT]: [[0, -2, 1, 1, 1], [-1, -1, 3, 1, 1], [-2, 0, 5, 1, 1], [-2, 1, 5, 1, 1]],
  // Part-lit: the hollow triangle with its bottom half filled (lit to there).
  [MARK.LAMP_PART]: [[0, -2, 1, 1, 1], [-1, -1, 1, 1, 1], [1, -1, 1, 1, 1], [-2, 0, 5, 1, 1], [-2, 1, 5, 1, 1]],
  // A tolled bell: the cup filled.
  [MARK.BELL_ON]: [[-1, -2, 3, 1, 1], [-2, -1, 5, 2, 1], [-3, 1, 7, 1, 1]],
  // The vault: an open hatch, a box with its lid raised off it (its light coming out between).
  [MARK.VAULT]: [[-2, -3, 5, 1, 1], [-2, -1, 1, 3, 1], [2, -1, 1, 3, 1], [-2, 2, 5, 1, 1]],
  [MARK.BELL]: [[-1, -2, 3, 1, 1], [-2, -1, 1, 3, 1], [2, -1, 1, 3, 1], [-3, 1, 7, 1, 1]],
  [MARK.FERRY]: [[-3, -1, 1, 1, 1], [3, -1, 1, 1, 1], [-2, 0, 5, 1, 1]],
  [MARK.RELIQUARY]: [[-1, -2, 3, 1, 1], [-1, 2, 3, 1, 1], [-1, -1, 1, 3, 1], [1, -1, 1, 3, 1]],
  [MARK.SECRET]: [[-2, -2, 1, 1, 1], [2, -2, 1, 1, 1], [-1, -1, 1, 1, 1], [1, -1, 1, 1, 1], [0, 0, 1, 1, 1], [-1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [-2, 2, 1, 1, 1], [2, 2, 1, 1, 1]],
  // The Salt Well (0.8.0): a ring round a dark middle, wider than tall (a well-head seen side on).
  [MARK.WELL]: [[-2, -1, 5, 1, 1], [-3, 0, 1, 2, 1], [3, 0, 1, 2, 1], [-2, 0, 5, 2, 0], [-2, 2, 5, 1, 1]],
  // A crane: an upside-down L (its mast and jib) over a foot. A cairn: a small stack, wider at the foot.
  [MARK.CRANE]: [[-2, -2, 5, 1, 1], [-2, -1, 1, 3, 1], [-3, 2, 3, 1, 1], [2, -1, 1, 1, 1]],
  [MARK.CAIRN]: [[0, -2, 1, 1, 1], [-1, -1, 3, 1, 1], [-1, 0, 3, 1, 1], [-2, 1, 5, 1, 1]],
});

/** Marks pinned to the minimap's edge when off its window (MINIMAP edge inset, px). */
const PIN_INSET = 3;

const BOXES = new Map();
const LAYOUTS = new Map();

/** Where the minimap sits (top right) for a setting, or null when it's off. Shared, frozen boxes. */
export function minimapBox(mode, size) {
  if (mode !== 'nearby' && mode !== 'map') return null;
  const s = MINIMAP.size[size] ?? MINIMAP.size.small;
  let b = BOXES.get(s);
  if (!b) { b = Object.freeze({ x: VIEW_W - HUD_LAYOUT.edge - s, y: MINIMAP.top, w: s, h: s, size: s === MINIMAP.size.large ? 'large' : 'small' }); BOXES.set(s, b); }
  return b;
}

/** The marks' store: made once, rewritten every frame (no garbage). */
export function createMarks(capacity = 640) {
  return { n: 0, capacity, kind: new Uint8Array(capacity), x: new Float32Array(capacity), y: new Float32Array(capacity), a: new Int16Array(capacity) };
}

/**
 * Where the minimap's window is: { s (minimap px per world px), ox, oy (the world point at the
 * box's top left) }, written into `out`. 'map' fits the whole map; 'nearby' centers a window on
 * you at MINIMAP.nearbyPxPerTile (by the box's size), kept inside the map, its corner on a whole
 * minimap pixel so the ground never lands between pixels.
 */
export function minimapWindow(world, box, mode, out) {
  const T = world.terrain, p = world.player;
  if (mode === 'map') {
    out.s = Math.min(box.w / T.width, box.h / T.height);
    out.ox = (T.width - box.w / out.s) / 2; out.oy = (T.height - box.h / out.s) / 2;
    return out;
  }
  const ppt = MINIMAP.nearbyPxPerTile[box.size] ?? MINIMAP.nearbyPxPerTile.small;
  out.s = ppt / T.tile;
  const span = box.w / out.s;
  const ox = Math.min(Math.max(p.x - span / 2, 0), Math.max(0, T.width - span));
  const oy = Math.min(Math.max(p.y - span / 2, 0), Math.max(0, T.height - span));
  out.ox = Math.round(ox * out.s) / out.s; out.oy = Math.round(oy * out.s) / out.s;
  return out;
}

/**
 * Uncover what's on screen: every tile under the view (camera center cx, cy in world px, the view
 * viewW x viewH: the run view's camera, already kept inside the map) is marked in `seen` (a byte a
 * tile); onNew(i) is called for each tile seen for the first time. Returns how many were new.
 */
/**
 * Uncover a disc of tiles around a point (a lit Wayside Lamp's reach): tile (tx, ty), radius r
 * tiles. Returns how many were new.
 */
export function revealDisc(seen, cols, rows, tx, ty, r, onNew) {
  let n = 0;
  for (let y = Math.max(0, ty - r); y <= Math.min(rows - 1, ty + r); y++) {
    for (let x = Math.max(0, tx - r); x <= Math.min(cols - 1, tx + r); x++) {
      if ((x - tx) * (x - tx) + (y - ty) * (y - ty) > r * r) continue;
      const i = y * cols + x;
      if (seen[i]) continue;
      seen[i] = 1; n++;
      onNew(i);
    }
  }
  return n;
}

export function revealView(seen, cols, rows, tile, cx, cy, viewW, viewH, onNew) {
  const x0 = Math.max(0, Math.floor((cx - viewW / 2) / tile)), x1 = Math.min(cols - 1, Math.floor((cx + viewW / 2 - 1e-6) / tile));
  const y0 = Math.max(0, Math.floor((cy - viewH / 2) / tile)), y1 = Math.min(rows - 1, Math.floor((cy + viewH / 2 - 1e-6) / tile));
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * cols + x;
      if (seen[i]) continue;
      seen[i] = 1; n++;
      onNew(i);
    }
  }
  return n;
}

/**
 * Every mark for this frame, in minimap pixels, inside the box, in drawing order: materials,
 * the other drops (so a material never covers an Ember or a chest), elites and bosses, and you
 * last (your slot is kept: a full store drops a material, never you). Returns marks.n.
 *
 * 0.8.2: lamps and bells are marked from 0:00 (unlit, part-lit, and lit lamps each their own
 * mark; an idle bell and a tolled one); the Ferryman while he's tied up or rowing in; the vault its
 * own mark. Pinned to the box's edge when off its window: a Reliquary with the Cartographer's
 * first level (`tasksOnMap`: Reliquaries anywhere on the map), and anything a lit lamp watched
 * land (a chest, a Reliquary, the vault, or an Ember inside its ward).
 */
export function minimapMarks(world, marks, box, win) {
  marks.n = 0;
  const room = marks.capacity - 1;
  const P = world.pickups;
  const H = world.config.harbor || {};
  const watched = Array.isArray(world.tasks) && world.tasks.length > 0;
  for (let i = 0; i < P.count; i++) if (P.kind[i] === PK.MATERIAL) addMark(marks, box, win, MARK.MATERIAL, P.x[i], P.y[i], P.a[i], room);
  for (let i = 0; i < P.count; i++) {
    const kd = P.kind[i];
    const kind = kd === PK.HEAL ? MARK.HEAL : kd === PK.MAGNET ? MARK.MAGNET : kd === PK.CHEST ? MARK.CHEST : kd === PK.EMBER ? MARK.EMBER
      : kd === PK.RELIQUARY ? MARK.RELIQUARY : kd === PK.VAULT ? MARK.VAULT : -1;
    if (kind < 0) continue;
    const big = kd === PK.CHEST || kd === PK.EMBER || kd === PK.RELIQUARY || kd === PK.VAULT;
    const pin = (kd === PK.RELIQUARY && !!H.tasksOnMap) || (big && watched && wardAt(world, P.x[i], P.y[i]) > 0);
    addMark(marks, box, win, kind, P.x[i], P.y[i], kd === PK.CHEST ? P.a[i] : 0, room, pin);
  }
  // The places: the run's lamps and bells from 0:00, the Ferryman where he's tied up (or rowing
  // in), the open Salt Well, and the map's secrets as the Cartographer's levels chart them.
  for (const t of world.tasks || []) {
    if (t.kind === TASK.CRANE || t.kind === TASK.CAIRN) { if (t.state === TASK_STATE.IDLE) addMark(marks, box, win, t.kind === TASK.CRANE ? MARK.CRANE : MARK.CAIRN, t.x, t.y, 0, room); continue; }
    if (t.kind === TASK.BELL && t.state === TASK_STATE.DONE) continue;
    const kind = t.kind === TASK.BELL ? (t.state === TASK_STATE.ACTIVE ? MARK.BELL_ON : MARK.BELL)
      : t.state === TASK_STATE.DONE ? MARK.LAMP_LIT : t.state === TASK_STATE.ACTIVE && t.progress > 0 ? MARK.LAMP_PART : MARK.LAMP;
    addMark(marks, box, win, kind, t.x, t.y, 0, room);
  }
  const F = world.ferry;
  if (F && (F.moored ?? true)) addMark(marks, box, win, MARK.FERRY, F.x, F.y, 0, room);
  if (world.well && world.well.open) addMark(marks, box, win, MARK.WELL, world.well.x, world.well.y, 0, room);
  // The Cartographer's charts (the sweep, X2): small secrets (a `gift`) from its level 2, the big ones at its last.
  if (H.secretsOnMap || H.findsOnMap) for (const s of world.secrets) if (!s.open && (s.gift ? (!!H.findsOnMap || !!H.secretsOnMap) && (world.acts?.act ?? 1) >= (s.from ?? 1) : !!H.secretsOnMap)) addMark(marks, box, win, MARK.SECRET, s.x, s.y, 0, room);
  const E = world.enemies;
  for (let i = 0; i < E.count; i++) {
    const f = E.flags[i];
    if ((f & EF.DEAD) !== 0 || (f & (EF.ELITE | EF.BOSS)) === 0) continue;
    addMark(marks, box, win, (f & EF.BOSS) !== 0 ? MARK.BOSS : MARK.ELITE, E.x[i], E.y[i], 0, room);
  }
  addMark(marks, box, win, MARK.PLAYER, world.player.x, world.player.y, 0, marks.capacity);
  return marks.n;
}

function addMark(marks, box, win, kind, wx, wy, a, cap, pin = false) {
  let x = box.x + (wx - win.ox) * win.s, y = box.y + (wy - win.oy) * win.s;
  if (pin) {
    // Held at the nearest point of the box's edge (a few pixels in, so its whole shape shows).
    x = Math.min(Math.max(x, box.x + PIN_INSET), box.x + box.w - 1 - PIN_INSET);
    y = Math.min(Math.max(y, box.y + PIN_INSET), box.y + box.h - 1 - PIN_INSET);
  }
  if (x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h || marks.n >= cap) return;
  const k = marks.n++;
  marks.kind[k] = kind; marks.x[k] = x; marks.y[k] = y; marks.a[k] = a;
}

// Your figure on screen (render/runview.js): a 22 px frame centered PLAYER_FEET_ROOM above your
// feet, so it reaches FIGURE_UP above them and FIGURE_DOWN below, FIGURE_HALF either side.
const FIGURE_HALF = 11, FIGURE_UP = FIGURE_HALF + PLAYER_FEET_ROOM, FIGURE_DOWN = FIGURE_HALF - PLAYER_FEET_ROOM;
const FRAME_W = 2;   // the minimap's frame round its box

/**
 * How solid something over the play field is this frame (the minimap, or the How to play card):
 * faded (MINIMAP.fadeAlpha) while your figure overlaps `box` (with the minimap's frame), so a
 * corner it covers never hides you (§6.2 item 11b), else 1. at: your feet in the view (px).
 */
export function minimapFade(box, at) {
  if (!box || !at) return 1;
  const inside = at.x + FIGURE_HALF > box.x - FRAME_W && at.x - FIGURE_HALF < box.x + box.w + FRAME_W
    && at.y + FIGURE_DOWN > box.y - FRAME_W && at.y - FIGURE_UP < box.y + box.h + FRAME_W;
  return inside ? MINIMAP.fadeAlpha : 1;
}
