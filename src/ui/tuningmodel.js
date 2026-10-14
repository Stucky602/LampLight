// The tuning panel's model (pure; tested): every number in data/tuning.js as a row with a sensible
// step, and the "Copy tuning" text Kevin pastes into the chat (only what he changed, by name).

/**
 * Values the sim reads once, when a run starts (the director's short-run timing): changing them
 * mid-run applies from the next run, and the panel says so.
 */
export const START_ONLY = new Set(['run.shortTimeScale', 'run.shortBossHp']);

/** Every tunable number, depth first: [{ path, group, key, value }]. Lists are left out (edited in data). */
export function flattenTuning(tuning, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(tuning)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number') out.push({ path, group: prefix, key: k, value: v });
    else if (typeof v === 'boolean') out.push({ path, group: prefix, key: k, value: v });
    else if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenTuning(v, path));
  }
  return out;
}

/**
 * A step that moves a value by about a tenth of its default, rounded to 1, 2, or 5 of a power of
 * ten: 80 steps by 10, 0.35 by 0.05, 2.5 by 0.2. Whole-number defaults step by at least 1.
 */
export function stepFor(value) {
  const a = Math.abs(value);
  if (a === 0) return 0.1;
  const raw = a / 10;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = Math.round((raw / p) * 1e6) / 1e6; // 0.035 / 0.01 is 3.4999999 in floating point
  let step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  if (Number.isInteger(value) && step < 1) step = 1;
  return Number(step.toPrecision(6));
}

/** Round away floating dust from repeated steps (0.1 + 0.2 = 0.30000000000000004). */
export function tidy(v) {
  return Number(Number(v).toPrecision(8));
}

/** What differs between the defaults and the live tuning: [{ path, from, to }] in tuning order. */
export function tuningDiff(base, current) {
  const cur = new Map(flattenTuning(current).map((r) => [r.path, r.value]));
  const out = [];
  for (const r of flattenTuning(base)) {
    const v = cur.get(r.path);
    if (v !== undefined && v !== r.value) out.push({ path: r.path, from: r.value, to: v });
  }
  return out;
}

/** The text "Copy tuning" puts on the clipboard. */
export function tuningCopyText(diff, { build = '', when = '' } = {}) {
  if (!diff.length) return `Lamplight tuning (build ${build}${when ? `, ${when}` : ''}): no changes from the defaults.`;
  const lines = diff.map((d) => `${d.path}: ${d.to}   (was ${d.from})`);
  return [`Lamplight tuning changes (build ${build}${when ? `, ${when}` : ''}):`, ...lines].join('\n');
}
