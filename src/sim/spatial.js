// Uniform-grid spatial hash for circle queries (ARCHITECTURE §5.4).
//
// Rebuilt every tick into flat typed arrays with no allocation: each cell holds a linked list
// of item indices (head per cell, next per item), and only the cells used by the last build are
// reset, so a build costs O(items), not O(cells). Items are inserted from the highest index down,
// so every cell lists its items in ascending index order and query results are deterministic.
//
// The grid is a window of cols x rows cells that follows the player (the sim passes the
// window's corner each tick). Enemies are kept within about 1.5 screens of the player by
// teleport-ahead, so they fall inside it; anything outside is clamped into the edge cells,
// which keeps queries correct (every candidate is distance-checked) and only costs speed for
// the rare straggler.
//
// Small items (radius up to half a cell) go in the one cell holding their center. Big items
// (elites and bosses) are few, so they skip the grid and every query checks them directly.

/**
 * @param {object} o
 * @param {number} o.capacity most items per build
 * @param {number} [o.cell] cell size in px
 * @param {number} [o.cols]
 * @param {number} [o.rows]
 * @param {number} [o.maxBig] most big items tracked; extra big items go in the grid by center
 *   and queries widen their search to cover them (still distance-checked exactly)
 */
export function createSpatialHash({ capacity, cell = 16, cols = 128, rows = 128, maxBig = 64 }) {
  const cells = cols * rows;
  const small = cell / 2;
  const head = new Int32Array(cells).fill(-1);
  const next = new Int32Array(capacity);
  const touched = new Int32Array(Math.min(capacity, cells));
  let nTouched = 0;
  const bigs = new Int32Array(maxBig);
  let nBig = 0;
  const tmp = new Float64Array(3);
  let originX = 0, originY = 0;
  let count = 0;
  let X = null, Y = null, R = null;
  let bigOverflow = 0;
  let overflowReach = small; // widest radius among big items that went into the grid

  // Cell of a coordinate, clamped into the window. (!(c >= 0) also catches NaN, so a broken
  // position lands in a corner cell instead of vanishing from every query.)
  function cx(x) {
    const c = Math.floor((x - originX) / cell);
    return !(c >= 0) ? 0 : c >= cols ? cols - 1 : c;
  }
  function cy(y) {
    const c = Math.floor((y - originY) / cell);
    return !(c >= 0) ? 0 : c >= rows ? rows - 1 : c;
  }

  const hash = {
    cell, cols, rows,
    get count() { return count; },
    get bigCount() { return nBig; },
    /** Big items that didn't fit the big list this build (the soak test watches it). */
    get bigOverflow() { return bigOverflow; },
    get originX() { return originX; },
    get originY() { return originY; },

    /**
     * Index items 0..n-1 by position. xs, ys, rs are typed arrays (rs: radius per item).
     * (ox, oy) is the window's top-left corner in world px.
     */
    build(n, xs, ys, rs, ox, oy) {
      if (n > capacity) throw new Error(`spatial.build: ${n} items exceeds capacity ${capacity}`);
      for (let k = 0; k < nTouched; k++) head[touched[k]] = -1;
      nTouched = 0;
      X = xs; Y = ys; R = rs; count = n;
      originX = ox; originY = oy;
      nBig = 0;
      bigOverflow = 0;
      overflowReach = small;
      // Bigs first (in index order), then everything else into the grid from the top down.
      for (let i = 0; i < n; i++) if (rs[i] > small && nBig < maxBig) bigs[nBig++] = i;
      let b = nBig - 1;
      for (let i = n - 1; i >= 0; i--) {
        if (b >= 0 && bigs[b] === i) { b--; continue; }
        if (rs[i] > small) { bigOverflow++; if (rs[i] > overflowReach) overflowReach = rs[i]; }
        const c = cy(ys[i]) * cols + cx(xs[i]);
        if (head[c] === -1) touched[nTouched++] = c;
        next[i] = head[c];
        head[c] = i;
      }
    },

    /**
     * Every item whose circle overlaps the circle (x, y, r): center distance <= r + its radius.
     * Writes item indices into `out` (an Int32Array) and returns how many; stops at out.length.
     * `skip` is an index to leave out (the querying item itself), or -1.
     * (Convenience for cold paths; hot loops use queryR, which takes no number arguments.)
     */
    query(x, y, r, out, skip = -1) {
      tmp[0] = x; tmp[1] = y; tmp[2] = r;
      return hash.queryR(tmp, out, skip);
    },

    /**
     * query() with the circle in reg[0..2] (x, y, r). Hot loops call this: V8 boxes every
     * fractional number passed to a call it doesn't inline (a 16-byte allocation each), and
     * typed-array registers avoid that (ARCHITECTURE §17).
     */
    queryR(reg, out, skip) {
      const x = reg[0], y = reg[1], r = reg[2];
      const max = out.length;
      let m = 0;
      if (count === 0) return 0;
      const reach = r + overflowReach;
      const x0 = cx(x - reach), x1 = cx(x + reach);
      const y0 = cy(y - reach), y1 = cy(y + reach);
      for (let gy = y0; gy <= y1; gy++) {
        const row = gy * cols;
        for (let gx = x0; gx <= x1; gx++) {
          for (let i = head[row + gx]; i !== -1; i = next[i]) {
            if (i === skip) continue;
            const dx = X[i] - x, dy = Y[i] - y, rr = r + R[i];
            if (dx * dx + dy * dy <= rr * rr) {
              out[m++] = i;
              if (m >= max) return m;
            }
          }
        }
      }
      for (let k = 0; k < nBig; k++) {
        const i = bigs[k];
        if (i === skip) continue;
        const dx = X[i] - x, dy = Y[i] - y, rr = r + R[i];
        if (dx * dx + dy * dy <= rr * rr) {
          out[m++] = i;
          if (m >= max) return m;
        }
      }
      return m;
    },

    /**
     * The nearest item to (x, y) within maxDist, skipping `skip` and any item whose
     * flags[i] & mask is nonzero (pass flags = null to skip nothing). Returns -1 if none. Ties
     * go to the lower index. Searches rings of cells outward, so it stays cheap when something
     * is close. Exact for query points inside the grid window; from outside it, the answer is
     * the nearest among the clamped edge cells.
     * To exclude a few specific items (a chain's earlier targets), set a spare flag bit on
     * them, pass it in the mask, then clear it.
     */
    nearest(x, y, maxDist, flags = null, mask = 0, skip = -1) {
      let best = -1, bestD2 = maxDist * maxDist;
      if (count === 0) return -1;
      for (let k = 0; k < nBig; k++) {
        const i = bigs[k];
        if (i === skip || (flags !== null && (flags[i] & mask) !== 0)) continue;
        const dx = X[i] - x, dy = Y[i] - y, d2 = dx * dx + dy * dy;
        if (d2 < bestD2 || (d2 === bestD2 && i < best)) { bestD2 = d2; best = i; }
      }
      const ccx = cx(x), ccy = cy(y);
      // Past the window's far side there's nothing left to search (and an infinite range stays finite).
      const maxRing = Math.min(Math.ceil(maxDist / cell) + 1, Math.max(cols, rows));
      for (let ring = 0; ring <= maxRing; ring++) {
        // Stop once this ring can't hold anything closer than the best so far.
        if (best >= 0) {
          const ringDist = (ring - 1) * cell; // centers in this ring are at least this far
          if (ringDist > 0 && ringDist * ringDist > bestD2) break;
        }
        const gx0 = ccx - ring, gx1 = ccx + ring, gy0 = ccy - ring, gy1 = ccy + ring;
        for (let gy = gy0; gy <= gy1; gy++) {
          if (gy < 0 || gy >= rows) continue;
          const edgeRow = gy === gy0 || gy === gy1;
          const step = edgeRow ? 1 : (gx1 - gx0 || 1);
          for (let gx = gx0; gx <= gx1; gx += step) {
            if (gx < 0 || gx >= cols) continue;
            for (let i = head[gy * cols + gx]; i !== -1; i = next[i]) {
              if (i === skip || (flags !== null && (flags[i] & mask) !== 0)) continue;
              const dx = X[i] - x, dy = Y[i] - y, d2 = dx * dx + dy * dy;
              if (d2 < bestD2 || (d2 === bestD2 && i < best)) { bestD2 = d2; best = i; }
            }
          }
        }
      }
      return best;
    },
  };

  return hash;
}
