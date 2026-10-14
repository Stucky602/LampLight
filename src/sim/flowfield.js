// Flow field: how enemies find their way around obstacles to the player (ARCHITECTURE §5.6).
//
// A breadth-first search over the tile grid from the player's tile, inside a window of
// `radius` tiles around the player (48 by default: a 97 x 97 window, 768 px each way, well past
// the spawn ring), recomputed only when the player changes tile. Distances are 4-connected
// (Manhattan). An enemy's direction is
// toward its neighboring tile (8 directions) with the lowest distance; a diagonal step is only
// allowed when both tiles beside it are open, so enemies never clip wall corners. A tile's
// direction is worked out the first time an enemy stands on it after a rebuild, then reused.
//
// In the open (no solid tile anywhere in the window) the field isn't used, and enemies chase
// directly. Outside the window, or on a tile the search couldn't reach, they chase directly too.
//
// `dilate` grows every wall by that many tiles before the search, so the field keeps big bodies
// (elites, bosses: wider than a tile) a clear corridor from walls instead of leading them along
// a wall's edge into its corner. The player's own tile always counts as open.

import { TILE } from './terrain.js';

const UNREACHED = 0xffff;
const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];
const INV_SQRT2 = 0.7071067811865476;

export function createFlowField(terrain, { radius = 48, dilate = 0 } = {}) {
  const size = radius * 2 + 1;
  const n = size * size;
  const dist = new Uint16Array(n);
  const wall = new Uint8Array(n);   // the window's blocked tiles, copied per rebuild
  const queue = new Int32Array(n);
  // Directions are worked out the first time a tile is asked about after a rebuild, then reused
  // (crowds share tiles). stamp[c] === rebuilds marks a cached tile; dir codes: 0 = none.
  const stamp = new Int32Array(n).fill(-1);
  const code = new Uint8Array(n);
  const tmp = new Float64Array(2);
  let ox = 0, oy = 0;               // window's top-left tile
  let ptx = -1e9, pty = -1e9;       // player's tile at the last rebuild
  let active = false;
  let rebuilds = 0;

  function recompute(tx, ty) {
    ptx = tx; pty = ty;
    ox = tx - radius; oy = ty - radius;
    rebuilds++;
    // Worth it only when an obstacle is inside the window. (The map edge alone never needs
    // it: the map is a rectangle, so a straight chase between two points on it stays on it.)
    active = terrain.solidIn(ox, oy, ox + size - 1, oy + size - 1) > 0;
    if (!active) return;
    // Copy the window's walls (outside the map counts as wall).
    const cols = terrain.cols, rows = terrain.rows, solid = terrain.solid;
    for (let wy = 0; wy < size; wy++) {
      const ty2 = oy + wy;
      const rowOut = ty2 < 0 || ty2 >= rows;
      for (let wx = 0; wx < size; wx++) {
        const tx2 = ox + wx;
        wall[wy * size + wx] = rowOut || tx2 < 0 || tx2 >= cols ? 1 : solid[ty2 * cols + tx2];
      }
    }
    if (dilate > 0) {
      // Grow walls: a tile is blocked if any solid tile (or the map edge) is within `dilate`.
      for (let wy = 0; wy < size; wy++) {
        for (let wx = 0; wx < size; wx++) {
          const c = wy * size + wx;
          if (wall[c]) continue;
          if (terrain.solidIn(ox + wx - dilate, oy + wy - dilate, ox + wx + dilate, oy + wy + dilate) > 0 ||
            ox + wx - dilate < 0 || oy + wy - dilate < 0 || ox + wx + dilate >= cols || oy + wy + dilate >= rows) wall[c] = 2;
        }
      }
      const start = radius * size + radius;
      if (wall[start] === 2) wall[start] = 0;
    }
    dist.fill(UNREACHED);
    const start = radius * size + radius;
    if (wall[start]) return; // player inside a wall (shouldn't happen): everyone chases directly
    dist[start] = 0;
    let head = 0, tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % size;
      const d = dist[c] + 1;
      // Right, left, down, up (bounds-checked by column/row).
      if (cx + 1 < size && dist[c + 1] === UNREACHED && !wall[c + 1]) { dist[c + 1] = d; queue[tail++] = c + 1; }
      if (cx > 0 && dist[c - 1] === UNREACHED && !wall[c - 1]) { dist[c - 1] = d; queue[tail++] = c - 1; }
      if (c + size < n && dist[c + size] === UNREACHED && !wall[c + size]) { dist[c + size] = d; queue[tail++] = c + size; }
      if (c - size >= 0 && dist[c - size] === UNREACHED && !wall[c - size]) { dist[c - size] = d; queue[tail++] = c - size; }
    }
  }

  return {
    radius,
    get active() { return active; },
    get rebuilds() { return rebuilds; },
    /** Call every tick with the player's position; recomputes only on a new tile. Returns true if it did. */
    update(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      if (tx === ptx && ty === pty) return false;
      recompute(tx, ty);
      return true;
    },
    /**
     * Direction toward the player for a point, written to out[0], out[1] (a unit vector).
     * Returns false when the caller should chase directly: open window, outside the window,
     * an unreached tile, or the player's own tile.
     */
    dirAt(x, y, out) {
      tmp[0] = x; tmp[1] = y;
      return this.dirR(tmp, out);
    },
    /** dirAt() with the point in reg[0], reg[1] (hot loops: no number arguments). */
    dirR(reg, out) {
      if (!active) return false;
      const cx = Math.floor(reg[0] / TILE) - ox, cy = Math.floor(reg[1] / TILE) - oy;
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) return false;
      const c = cy * size + cx;
      let k = 0;
      if (stamp[c] === rebuilds) {
        k = code[c];
      } else {
        stamp[c] = rebuilds;
        const dc = dist[c];
        if (dc !== UNREACHED && dc !== 0) {
          let best = dc;
          for (let j = 0; j < 8; j++) {
            const wx = cx + NX[j], wy = cy + NY[j];
            if (wx < 0 || wy < 0 || wx >= size || wy >= size) continue;
            if (j >= 4 && (wall[cy * size + wx] || wall[wy * size + cx])) continue; // no corner cutting
            const dw = dist[wy * size + wx];
            if (dw < best) { best = dw; k = j + 1; }
          }
        }
        code[c] = k;
      }
      if (k === 0) return false;
      const bx = NX[k - 1], by = NY[k - 1];
      if (bx !== 0 && by !== 0) { out[0] = bx * INV_SQRT2; out[1] = by * INV_SQRT2; }
      else { out[0] = bx; out[1] = by; }
      return true;
    },
    /** Steps from a point to the player (tests and tools), or -1 if unreachable, outside, or inactive. */
    stepsAt(x, y) {
      if (!active) return -1;
      const wx = Math.floor(x / TILE) - ox, wy = Math.floor(y / TILE) - oy;
      if (wx < 0 || wy < 0 || wx >= size || wy >= size) return -1;
      const d = dist[wy * size + wx];
      return d === UNREACHED ? -1 : d;
    },
  };
}
