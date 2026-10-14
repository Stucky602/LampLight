// Material costs (ARCHITECTURE §10.3): { materialId: count }. Pure helpers shared by every
// purchase, the next-3 panel, and the pacing simulator.

/** A stored count as a whole number, 0 or more (anything else a save could hold reads as 0). */
export function countOf(v) { return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; }
const n = countOf;

/** Does `have` (materials in hand) cover `cost`? */
export function canPay(have, cost) {
  for (const [id, c] of Object.entries(cost)) if (n(have?.[id]) < c) return false;
  return true;
}

/** What's still needed: [{ id, need }] for each material short (empty when affordable). */
export function missing(have, cost) {
  const out = [];
  for (const [id, c] of Object.entries(cost)) {
    const short = c - n(have?.[id]);
    if (short > 0) out.push({ id, need: short });
  }
  return out;
}

/** Materials after paying (a new object; throws if they don't cover it). */
export function pay(have, cost) {
  if (!canPay(have, cost)) throw new Error('not enough materials');
  const out = { ...have };
  for (const [id, c] of Object.entries(cost)) {
    out[id] = n(out[id]) - c;
    if (out[id] === 0) delete out[id];
  }
  return out;
}

/** A cost times a whole number (an upgrade's rank r costs r times its first rank). */
export function scale(cost, k) {
  const out = {};
  for (const [id, c] of Object.entries(cost)) out[id] = c * k;
  return out;
}

/**
 * How close `have` is to `cost`, from 0 (nothing) to 1 (affordable): the share of the total
 * cost in hand, counting each material only up to what's needed.
 */
export function progress(have, cost) {
  let got = 0, total = 0;
  for (const [id, c] of Object.entries(cost)) { total += c; got += Math.min(c, n(have?.[id])); }
  return total > 0 ? got / total : 1;
}
