// A path for the bots (0.9.0, W4): the follow bot walks to an errand around walls, water, and the
// districts instead of in a straight line (with the districts and sites spread over the whole
// map, a straight line ran it into the crane yard's stacks and the breakwater's water). A
// breadth-first field from the target tile over open tiles, rebuilt when the target or the ground
// changes; the bot steps toward the neighbor nearest the target. Used only by sim/bot.js.

import { TILE } from './terrain.js';

export function createBotPath() {
  let cols = 0, rows = 0, dist = null, queue = null, target = -1, version = -1, terrainRef = null;
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function build(T, t) {
    if (T !== terrainRef || T.cols !== cols || T.rows !== rows) {
      terrainRef = T; cols = T.cols; rows = T.rows;
      dist = new Int32Array(cols * rows); queue = new Int32Array(cols * rows);
    }
    dist.fill(-1);
    let h = 0, q = 0;
    dist[t] = 0; queue[q++] = t;
    const solid = T.solid;
    while (h < q) {
      const i = queue[h++], x = i % cols, y = (i - x) / cols, d = dist[i] + 1;
      if (x + 1 < cols && dist[i + 1] < 0 && !solid[i + 1]) { dist[i + 1] = d; queue[q++] = i + 1; }
      if (x > 0 && dist[i - 1] < 0 && !solid[i - 1]) { dist[i - 1] = d; queue[q++] = i - 1; }
      if (y + 1 < rows && dist[i + cols] < 0 && !solid[i + cols]) { dist[i + cols] = d; queue[q++] = i + cols; }
      if (y > 0 && dist[i - cols] < 0 && !solid[i - cols]) { dist[i - cols] = d; queue[q++] = i - cols; }
    }
    target = t; version = T.version;
  }
  return {
    /** The unit direction from (px, py) toward (x, y) along the field, into out[0], out[1]; false with no path (go straight). */
    dirTo(world, px, py, x, y, out) {
      const T = world.terrain;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= T.cols || ty >= T.rows) return false;
      const t = ty * T.cols + tx;
      if (t !== target || T.version !== version || T !== terrainRef) build(T, t);
      const ax = Math.floor(px / TILE), ay = Math.floor(py / TILE), a = ay * cols + ax;
      if (ax < 0 || ay < 0 || ax >= cols || ay >= rows || dist[a] < 0) return false;
      if (dist[a] <= 1) return false;
      let best = -1, bd = dist[a];
      for (const [dx, dy] of N8) {
        const nx = ax + dx, ny = ay + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (dist[j] < 0 || dist[j] >= bd) continue;
        // A diagonal only where both sides are open (no cutting a corner).
        if (dx !== 0 && dy !== 0 && (T.solid[ay * cols + nx] || T.solid[ny * cols + ax])) continue;
        bd = dist[j]; best = j;
      }
      if (best < 0) return false;
      const cx = ((best % cols) + 0.5) * TILE - px, cy = (Math.floor(best / cols) + 0.5) * TILE - py, d = Math.sqrt(cx * cx + cy * cy) || 1;
      out[0] = cx / d; out[1] = cy / d;
      return true;
    },
  };
}
