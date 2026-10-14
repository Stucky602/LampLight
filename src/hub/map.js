// The harbor's map, read from data/hub.js (ARCHITECTURE §10.4): which tiles you can walk on,
// which of the fog's regions cover each tile, and where you can get to from where. Pure; tested.
//
// A tile can be walked on when its ground is walkable, no building or ruin stands on it, and the
// fog over it has cleared. The fog is the town's edge: you can't walk into it.

import { TILE } from '../sim/terrain.js';

/**
 * Read the hub data into grids. Returns { cols, rows, ground (Uint8Array, index into `legend`),
 * legend (the terrain characters in order), footprint (Uint8Array: 1 under a building or ruin),
 * regions (Uint32Array: bit k set when fog region k covers the tile), regionIds, plots, ruins }.
 * Throws a plain message for data that doesn't fit (the content test runs this on the real map).
 */
export function buildHubMap(hub, terrain) {
  const rows = hub.map.length, cols = hub.map[0]?.length ?? 0;
  if (!rows || !cols) throw new Error('hub map: no rows');
  const legend = Object.keys(terrain);
  const ground = new Uint8Array(cols * rows);
  hub.map.forEach((row, y) => {
    if (row.length !== cols) throw new Error(`hub map: row ${y} is ${row.length} wide, not ${cols}`);
    for (let x = 0; x < cols; x++) {
      const k = legend.indexOf(row[x]);
      if (k < 0) throw new Error(`hub map: unknown ground "${row[x]}" at ${x}, ${y}`);
      ground[y * cols + x] = k;
    }
  });
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const footprint = new Uint8Array(cols * rows);
  for (const p of [...hub.plots, ...hub.ruins]) {
    const name = p.building || p.id;
    if (!inside(p.x, p.y) || !inside(p.x + p.w - 1, p.y + p.h - 1)) throw new Error(`hub map: ${name}'s plot runs off the map`);
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      if (footprint[y * cols + x]) throw new Error(`hub map: ${name}'s plot overlaps another at ${x}, ${y}`);
      footprint[y * cols + x] = 1;
    }
  }
  if (hub.fog.length > 32) throw new Error('hub map: at most 32 fog regions');
  const regions = new Uint32Array(cols * rows);
  hub.fog.forEach((f, k) => {
    for (const [rx, ry, rw, rh] of f.rects) {
      if (!(rw > 0 && rh > 0) || !inside(rx, ry) || !inside(rx + rw - 1, ry + rh - 1)) throw new Error(`hub map: fog region ${f.id} has a rectangle off the map`);
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) regions[y * cols + x] |= 1 << k;
    }
  });
  // The small lamps (the gate's, the pier's) are posts: solid wherever they stand.
  const lamps = [hub.gate?.lamp, hub.harbor?.lamp].filter(Boolean);
  for (const [x, y] of lamps) if (!inside(x, y)) throw new Error(`hub map: a lamp at ${x}, ${y} is off the map`);
  return { cols, rows, width: cols * TILE, height: rows * TILE, legend, ground, footprint, regions, regionIds: hub.fog.map((f) => f.id), plots: hub.plots, ruins: hub.ruins, lamps, terrain };
}

/** 1 for each tile under cleared fog, given the ids of the regions that have cleared. */
export function clearTiles(map, revealed) {
  let bits = 0;
  map.regionIds.forEach((id, k) => { if (revealed.has(id)) bits |= 1 << k; });
  const out = new Uint8Array(map.cols * map.rows);
  for (let i = 0; i < out.length; i++) out[i] = (map.regions[i] & bits) !== 0 ? 1 : 0;
  return out;
}

/**
 * The solid grid for collision (1 = blocked): ground you can't walk, buildings, the fog, the small
 * lamps, and the props that are out ([{ at: [x, y] }]).
 */
export function solidTiles(map, clear, props = []) {
  const out = new Uint8Array(map.cols * map.rows);
  for (let i = 0; i < out.length; i++) {
    const g = map.terrain[map.legend[map.ground[i]]];
    out[i] = g.walk && !map.footprint[i] && clear[i] ? 0 : 1;
  }
  for (const [x, y] of map.lamps ?? []) out[y * map.cols + x] = 1;
  for (const p of props) {
    const [x, y] = p.at;
    if (x >= 0 && y >= 0 && x < map.cols && y < map.rows) out[y * map.cols + x] = 1;
  }
  return out;
}

/** The nearest open tile to `from` (breadth first, four ways), or null if none is. */
export function nearestOpen(map, solid, from) {
  const { cols, rows } = map;
  const [fx, fy] = from;
  if (fx >= 0 && fy >= 0 && fx < cols && fy < rows && !solid[fy * cols + fx]) return [fx, fy];
  const seen = new Uint8Array(cols * rows);
  const queue = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= cols || y >= rows || seen[y * cols + x]) return; seen[y * cols + x] = 1; queue.push([x, y]); };
  push(Math.min(cols - 1, Math.max(0, fx)), Math.min(rows - 1, Math.max(0, fy)));
  for (let k = 0; k < queue.length; k++) {
    const [x, y] = queue[k];
    if (!solid[y * cols + x]) return [x, y];
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return null;
}

/** Tiles reachable on foot from `from` ([x, y]) through open tiles: a Uint8Array of 1s. */
export function reachableFrom(map, solid, from) {
  const { cols, rows } = map;
  const seen = new Uint8Array(cols * rows);
  const [fx, fy] = from;
  if (fx < 0 || fy < 0 || fx >= cols || fy >= rows || solid[fy * cols + fx]) return seen;
  const stack = [fy * cols + fx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % cols, y = (i - x) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (!seen[j] && !solid[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  return seen;
}

/** Is every tile on the straight run from a to b (tile centers, along one axis) open? */
export function segmentOpen(map, solid, a, b) {
  if (a[0] !== b[0] && a[1] !== b[1]) return false; // walks go along the streets: straight runs only
  const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
  let x = a[0], y = a[1];
  for (;;) {
    if (x < 0 || y < 0 || x >= map.cols || y >= map.rows || solid[y * map.cols + x]) return false;
    if (x === b[0] && y === b[1]) return true;
    x += dx; y += dy;
  }
}

/**
 * The tiles an arrival walks through: up the pier (`harbor.walkUp`), then along the column to the
 * waiting spot's row, then along the row to it. Straight runs only; repeated corners are dropped.
 */
export function arrivalPath(hub, waitAt) {
  const path = hub.harbor.walkUp.map((t) => [t[0], t[1]]);
  const last = path[path.length - 1];
  for (const t of [[last[0], waitAt[1]], [waitAt[0], waitAt[1]]]) {
    const end = path[path.length - 1];
    if (end[0] !== t[0] || end[1] !== t[1]) path.push(t);
  }
  return path;
}

/** The plot whose door is `tile`, or null. */
export function plotAtDoor(map, tile) {
  return map.plots.find((p) => p.door[0] === tile[0] && p.door[1] === tile[1]) ?? null;
}
