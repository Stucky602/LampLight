// The feel toolkit's arithmetic (ARCHITECTURE §6.3), kept free of Pixi so the tests can check
// it: screen shake, damage-number grouping, the render-side particle pool, and packed colors.
// Nothing here allocates per frame.

/** A Pixi Particle's packed color: 0xRRGGBB plus alpha (0..1), in the byte order Pixi uploads. */
export function packColor(rgb, alpha = 1) {
  const bgr = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
  return bgr + (((alpha < 0 ? 0 : alpha > 1 ? 1 : alpha) * 255 | 0) << 24);
}

/**
 * Screen shake, trauma model: events add trauma (0..1), it decays linearly, and the offset is
 * trauma² × maxOffset in a smooth pseudo-random direction, so small bumps barely register and
 * big ones really shake.
 */
export function createShake() {
  let trauma = 0;
  return {
    add(t) { if (t > 0) trauma = Math.min(1, trauma + t); },
    update(dtSec, decayPerSec) { trauma = Math.max(0, trauma - decayPerSec * dtSec); },
    /** Write the offset (whole pixels) into out[0], out[1]. `t` is time in seconds. */
    offsetInto(out, t, maxOffset) {
      const k = trauma * trauma * maxOffset;
      out[0] = Math.round(k * (Math.sin(t * 71.3) * 0.6 + Math.sin(t * 113.9 + 1.7) * 0.4)) | 0;
      out[1] = Math.round(k * (Math.sin(t * 89.1 + 0.9) * 0.6 + Math.sin(t * 131.7 + 2.3) * 0.4)) | 0;
      return out;
    },
    get trauma() { return trauma; },
    reset() { trauma = 0; },
  };
}

/**
 * Damage numbers, grouped: hits on the same enemy within `groupMs` add into one number, so a
 * thousand hits never become a thousand numbers (§5.14). At most `limit` are alive (at most
 * `max`, the capacity; setLimit follows tuning.feel.numbers.max live); when full, a new number
 * replaces the oldest.
 *
 * Numbers are keyed by the enemy's slot id (0..slots-1) and checked against its handle, so a
 * slot reused by a new enemy starts a new number.
 */
export function createNumbers(max = 150, slots = 4096) {
  const x = new Float32Array(max), y = new Float32Array(max), value = new Float32Array(max);
  const born = new Float64Array(max), last = new Float64Array(max);
  const handle = new Int32Array(max), slot = new Int32Array(max), kind = new Uint8Array(max);
  const live = new Uint8Array(max);
  const bySlot = new Int32Array(slots).fill(-1);
  let count = 0;
  let limit = max;
  function retire(i) {
    live[i] = 0; count--;
    if (slot[i] >= 0 && bySlot[slot[i]] === i) bySlot[slot[i]] = -1;
  }
  const api = {
    max, x, y, value, born, kind, live,
    get count() { return count; },
    get limit() { return limit; },
    /** Show at most n at once (1..max). Numbers past a lowered limit are retired. */
    setLimit(n) {
      const v = Math.max(1, Math.min(max, n | 0));
      if (v === limit) return;
      limit = v;
      for (let i = limit; i < max; i++) if (live[i] === 1) retire(i);
    },
    /**
     * A hit of `amount` at (px, py) on the enemy with this slot id and handle. kind: 0 normal,
     * 1 critical, 2 damage to the player, 3 healing (these two never group).
     */
    hit(s, h, px, py, amount, k, now, groupMs) {
      if (k < 2 && s >= 0 && s < slots) {
        const i = bySlot[s];
        if (i >= 0 && live[i] === 1 && handle[i] === h && now - last[i] <= groupMs && kind[i] <= 1) {
          value[i] += amount;
          last[i] = now;
          if (k === 1) kind[i] = 1;
          x[i] = px; y[i] = py;
          return i;
        }
      }
      // A free entry, or else the oldest.
      let pick = -1, oldest = Infinity;
      for (let i = 0; i < limit; i++) {
        if (live[i] === 0) { pick = i; break; }
        if (born[i] < oldest) { oldest = born[i]; pick = i; }
      }
      if (live[pick] === 1) { if (slot[pick] >= 0 && bySlot[slot[pick]] === pick) bySlot[slot[pick]] = -1; } else count++;
      live[pick] = 1; x[pick] = px; y[pick] = py; value[pick] = amount; born[pick] = now; last[pick] = now;
      handle[pick] = h; kind[pick] = k; slot[pick] = k < 2 ? s : -1;
      if (k < 2 && s >= 0 && s < slots) bySlot[s] = pick;
      return pick;
    },
    /** Retire numbers older than lifeMs. */
    expire(now, lifeMs) {
      for (let i = 0; i < max; i++) if (live[i] === 1 && now - born[i] > lifeMs) retire(i);
    },
    clear() { live.fill(0); bySlot.fill(-1); count = 0; },
  };
  return api;
}

/**
 * Render-side particles (sparks, embers, puffs): not sim state (§5.3). Structure of arrays, a
 * fixed capacity, and the oldest particle is replaced when full, so a huge burst can't grow
 * memory or stall a frame.
 */
export function createParticles(capacity = 4096) {
  const P = {
    capacity,
    count: 0,
    x: new Float32Array(capacity), y: new Float32Array(capacity),
    vx: new Float32Array(capacity), vy: new Float32Array(capacity),
    age: new Float32Array(capacity), life: new Float32Array(capacity),
    gravity: new Float32Array(capacity), drag: new Float32Array(capacity),
    color: new Uint32Array(capacity), frame: new Uint8Array(capacity), grow: new Float32Array(capacity),
  };
  let next = 0; // when full, the ring position to overwrite
  /** Add one; returns its index. lifeMs > 0. frame indexes the caller's particle frame table. */
  P.spawn = function spawn(px, py, pvx, pvy, lifeMs, frame, rgb, gravity = 0, drag = 0, grow = 0) {
    let i;
    if (P.count < capacity) i = P.count++;
    else { i = next; next = (next + 1) % capacity; }
    P.x[i] = px; P.y[i] = py; P.vx[i] = pvx; P.vy[i] = pvy;
    P.age[i] = 0; P.life[i] = lifeMs > 1 ? lifeMs : 1;
    P.gravity[i] = gravity; P.drag[i] = drag; P.color[i] = rgb; P.frame[i] = frame; P.grow[i] = grow;
    return i;
  };
  /** Advance every particle by dtMs; dead ones are removed by swapping with the last. */
  P.step = function step(dtMs) {
    const dt = dtMs / 1000;
    for (let i = P.count - 1; i >= 0; i--) {
      P.age[i] += dtMs;
      if (P.age[i] >= P.life[i]) { removeAt(i); continue; }
      const k = P.drag[i] > 0 ? Math.max(0, 1 - P.drag[i] * dt) : 1;
      P.vx[i] *= k; P.vy[i] = P.vy[i] * k + P.gravity[i] * dt;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
    }
  };
  function removeAt(i) {
    const last = --P.count;
    if (i !== last) {
      P.x[i] = P.x[last]; P.y[i] = P.y[last]; P.vx[i] = P.vx[last]; P.vy[i] = P.vy[last];
      P.age[i] = P.age[last]; P.life[i] = P.life[last]; P.gravity[i] = P.gravity[last]; P.drag[i] = P.drag[last];
      P.color[i] = P.color[last]; P.frame[i] = P.frame[last]; P.grow[i] = P.grow[last];
    }
    if (next > P.count) next = 0;
  }
  P.clear = function clear() { P.count = 0; next = 0; };
  return P;
}

/** Linear fade over the last part of a life (1 until `from` of the way through, then down to 0). */
export function fadeOut(age, life, from = 0.6) {
  const t = age / life;
  return t <= from ? 1 : Math.max(0, 1 - (t - from) / (1 - from));
}
