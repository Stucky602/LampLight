// Where the run's places stand (sim/tasks.js, sim/relics.js): a map's tile, moved to open ground
// a player can stand on, or to the water's edge for a boat. Its own module so tasks and the
// Ferryman share it without importing each other.

import { TILE, GROUND } from './terrain.js';

/** The middle of the open tile nearest tile (tx, ty), in px: [x, y]. */
export function snapOpen(world, tx, ty) {
  const at = [0, 0];
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error(`Map ${world.map.id}: a task or the skiff needs \`at: [col, row]\` in whole tiles`);
  if (!world.terrain.nearestOpen(tx, ty, at)) throw new Error(`Map ${world.map.id}: no open ground near (${tx}, ${ty}) for a task`);
  return at;
}

/**
 * The open tile nearest tile (tx, ty) that has water beside it (where a boat can tie up), in px:
 * { x, y } the open tile's middle and { bx, by } the water's. Falls back to plain open ground when
 * there's no water within 48 tiles (a map without any: the skiff then sits on the boards).
 */
export function snapShore(world, tx, ty) {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error(`Map ${world.map.id}: a task or the skiff needs \`at: [col, row]\` in whole tiles`);
  const t = world.terrain, kinds = t.kinds;
  const water = (x, y) => kinds && x >= 0 && y >= 0 && x < t.cols && y < t.rows && kinds[y * t.cols + x] === GROUND.WATER;
  for (let r = 0; r < 48; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if (t.blocked(x, y)) continue;
        for (const [ox, oy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          if (!water(x + ox, y + oy)) continue;
          return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, bx: (x + ox + 0.5) * TILE, by: (y + oy + 0.5) * TILE };
        }
      }
    }
  }
  const [x, y] = snapOpen(world, tx, ty);
  return { x, y, bx: x, by: y };
}
