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
 * { x, y } the open tile's middle and { bx, by } the water's. Water is the sea, the deep, or a
 * creek's bed (the Salt Marsh's mud, where a skiff sits at low water and floats at high); the tile
 * you stand on is never a creek's bed or the causeway, so the water never takes it before overtime.
 * Falls back to plain open ground when there's no water within 48 tiles (a map without any: the
 * skiff then sits on the boards).
 */
export function snapShore(world, tx, ty) {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error(`Map ${world.map.id}: a task or a mooring needs \`at: [col, row]\` in whole tiles`);
  const t = world.terrain, kinds = t.kinds;
  const kindAt = (x, y) => (kinds && x >= 0 && y >= 0 && x < t.cols && y < t.rows ? kinds[y * t.cols + x] : -1);
  const open = (k) => k === GROUND.WATER || k === GROUND.DEEP;
  const water = (x, y, deep) => { const k = kindAt(x, y); return open(k) || (!deep && k === GROUND.MUD); };
  // Open water first (a creek bed reads as the bank at low water, 0.8.2: the skiff sat on the
  // Marsh's mud), within 6 tiles; a creek only where no open water is that near. The boat sits a tile further out
  // when that tile is water too, so it floats in the channel, not against the bank.
  for (const deep of [true, false]) {
    for (let r = 0, reach = deep ? 6 : 48; r < reach; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy, k = kindAt(x, y);
          if (t.blocked(x, y) || k === GROUND.MUD || k === GROUND.CAUSEWAY) continue;
          for (const [ox, oy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            if (!water(x + ox, y + oy, deep)) continue;
            const out = water(x + 2 * ox, y + 2 * oy, deep) ? 2 : 1;
            return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, bx: (x + out * ox + 0.5) * TILE, by: (y + out * oy + 0.5) * TILE };
          }
        }
      }
    }
  }
  const [x, y] = snapOpen(world, tx, ty);
  return { x, y, bx: x, by: y };
}
