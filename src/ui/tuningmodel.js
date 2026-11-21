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

// ---------------------------------------------------------------- plain names (0.7.3)

/** Words a tuning name is made of that read better another way, and the unit some words carry. */
const WORDS = Object.freeze({ hp: 'HP', xp: 'XP', dps: 'DPS', fps: 'FPS', ui: 'UI', id: 'ID', mul: 'multiplier', pct: 'share', max: 'max', min: 'min', num: 'number', cfg: 'setting' });
/** A last word that is only a unit (dropped from the name), and one that names the thing and has a unit. */
const UNIT_ONLY = Object.freeze({ sec: 's', secs: 's', seconds: 's', ms: 'ms', px: 'px', ticks: 'ticks', deg: 'degrees' });
const UNIT_KEEP = Object.freeze({ mul: 'x', radius: 'px', distance: 'px', range: 'px', time: 's', cooldown: 's', iframes: 's', gap: 's' });
/** Groups whose numbers all share a unit (the code's comments say so). */
const GROUP_UNITS = Object.freeze([['feel.hitStop.', 'ms'], ['hub.timing.', 's']]);

/** A name's words: "shortTimeScale" -> ['short', 'time', 'scale'], "hit_stop" -> ['hit', 'stop']. */
function words(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * A tuning value's name as the panel shows it (0.7.3: plain words with the unit, not the code's
 * name): "materialMul" -> { label: 'Material multiplier', unit: 'x' }, "warnSec" -> { label:
 * 'Warn', unit: 's' }. The unit is the last word's when it has one (a word that is only a unit, like
 * "Sec", drops out of the label), or the group's (feel.hitStop's are ms).
 */
/** Names worded by hand where the code's words don't say it plainly ({ label, unit }). */
const NAMED = Object.freeze({
  'xp.growthFrom': { label: 'Costlier levels from level', unit: null },
  'xp.growth': { label: 'Each level past that costs', unit: 'x' },
  'draft.autoFallback': { label: 'Pay a gift on a level with nothing to pick', unit: null },
  'draft.autoHealBelow': { label: 'Gift food below health share', unit: null },
  'draft.autoGlass': { label: 'Gift Pearls', unit: null },
  'draft.autoEmberEvery': { label: 'Gift an Ember every Nth gift', unit: null },
  'director.musterWarn': { label: 'Overtime muster warning', unit: 's' },
  'tasks.night.burnPerMin': { label: 'Burn grows per minute', unit: null },
  'ferry.emberPerForm': { label: 'Ember price per Form held', unit: null },
  'bosses.hpPerLevel': { label: 'Boss HP per player level', unit: null },
  'bosses.hpLevelMin': { label: 'Boss HP at least', unit: 'x' },
  'bosses.hpLevelMax': { label: 'Boss HP at most', unit: 'x' },
  // The combat's pace (0.8.1): the dials Kevin turns for fewer, slower, stronger enemies.
  'pace.density': { label: 'Enemy count', unit: 'x' },
  'pace.maxAlive': { label: 'Enemies alive at most', unit: null },
  'pace.speed': { label: 'Enemy speed', unit: 'x' },
  'pace.hp': { label: 'Enemy HP', unit: 'x' },
  'pace.contact': { label: 'Enemy touch damage', unit: 'x' },
  'pace.xp': { label: 'XP per kill', unit: 'x' },
  'pace.drops': { label: 'Drops per kill', unit: 'x' },
  'pace.events': { label: 'Set piece size', unit: 'x' },
});

export function plainName(path) {
  if (NAMED[path]) return { ...NAMED[path] };
  const key = String(path).split('.').at(-1);
  const w = words(key);
  const last = w.at(-1);
  const only = UNIT_ONLY[last] && w.length > 1;
  const unit = (only ? UNIT_ONLY[last] : UNIT_KEEP[last]) ?? GROUP_UNITS.find(([g]) => String(path).startsWith(g))?.[1] ?? null;
  const shown = (only ? w.slice(0, -1) : w).map((x) => WORDS[x] ?? x);
  const text = shown.join(' ');
  return { label: text.charAt(0).toUpperCase() + text.slice(1), unit };
}

/** A group's path as a heading: "player.stats" -> "Player, stats"; "hub.look.fog" -> "Harbor look, fog". */
export function plainGroup(group) {
  const parts = String(group).split('.').filter(Boolean).map((p) => words(p).map((x) => WORDS[x] ?? x).join(' '));
  if (parts[0] === 'hub') parts[0] = 'harbor';
  const [first = '', ...rest] = parts;
  const head = first.charAt(0).toUpperCase() + first.slice(1);
  return rest.length ? `${head}${rest[0] ? ` ${rest.join(', ')}` : ''}` : head;
}

/** A value with its unit, as the panel shows it: "1.2x", "45s", "84 px", "On". */
export function valueText(value, unit) {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (!unit) return String(value);
  if (unit === 'x' || unit === 's' || unit === 'ms' || unit === '%') return `${value}${unit}`;
  return `${value} ${unit}`;
}
