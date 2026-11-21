// Numbers in player text read from the data (C2b, Nov 19, main's call: text and numbers can't drift).
// A line holds a placeholder where a number goes, filled once when the data loads:
//   {m.lanternUp%}      a number as a percent (0.1 -> 10%)
//   {m.flameGap}        a plain number (5 -> 5, 1.5 -> 1.5)
//   {m.steps*perStep%}  a product: names after the first are looked up in the same group (4 x 0.1 -> 40%)
//   {t.punt*3}          a product with a plain number
//   {1-b.moveSpeed%}    what is left of 1 (0.85 -> 15%)
//   {-m.empty%}         the number turned round (-0.25 -> 25%), for a line that already says "less"
//   {t.seaEvery#}       an ordinal (3 -> 3rd)
//   {t.seaUps|level}    a count with its word (1 level, 2 levels)
//   {1/(1+p.rate)-1%}   brackets (a cooldown cut of 37.5% throws 60% faster)
//   {b.maxHp-s.maxHp}   a difference of two names (130 - 100 -> 30); + and / work the same way
//                       ({m.short+t.over}, {t.marshCache/60} for minutes)
// The groups are what the caller hands in (data/characters.js: m mechanic, t trade, b base, s the
// standard player; data/signatures.js: p a line's own numbers, w the weapon's base, c its character's
// mechanic). A name that isn't there is an error at load, so a typo can't reach a card.

const show = (v) => String(Math.round(v * 100) / 100);
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function look(scope, path, group, where, all) {
  const parts = path.split('.');
  let o = scope, g = group;
  if (parts.length > 1) { g = parts.shift(); o = scope[g]; } else o = scope[group];
  for (const k of parts) o = o == null ? undefined : o[k];
  if (typeof o !== 'number') throw new Error(`${where}: ${all} names no number`);
  return [o, g];
}

function value(scope, e, where, all) {
  // Brackets first, innermost out: {1/(1+p.rate)-1%}.
  for (let m = e.match(/\(([^()]*)\)/); m; m = e.match(/\(([^()]*)\)/)) e = e.replace(m[0], String(value(scope, m[1], where, all)));
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/.test(e)) return +e;
  const plus = e.indexOf('+', 1);
  if (plus > 0) return value(scope, e.slice(0, plus), where, all) + value(scope, e.slice(plus + 1), where, all);
  const minus = e.lastIndexOf('-');
  if (minus > 0) return value(scope, e.slice(0, minus), where, all) - value(scope, e.slice(minus + 1), where, all);
  const div = e.lastIndexOf('/');
  if (div > 0) return value(scope, e.slice(0, div), where, all) / value(scope, e.slice(div + 1), where, all);
  let v = 1, group = null;
  for (const part of e.split('*')) {
    if (/^\d+(\.\d+)?$/.test(part)) { v *= +part; continue; }
    const [n, g] = look(scope, part, group, where, all);
    v *= n; group = g;
  }
  return v;
}

/** `text` with each {placeholder} filled from `scope`; `where` names the line for the error. */
export function fillText(text, scope, where) {
  if (typeof text !== 'string' || !text.includes('{')) return text;
  return text.replace(/\{([^{}]+)\}/g, (all, expr) => {
    let e = expr.trim(), pct = false, comp = false, neg = false, ord = false, word = null;
    const bar = e.indexOf('|');
    if (bar > 0) { word = e.slice(bar + 1).trim(); e = e.slice(0, bar).trim(); }
    if (e.endsWith('#')) { ord = true; e = e.slice(0, -1); }
    if (e.endsWith('%')) { pct = true; e = e.slice(0, -1); }
    if (e.startsWith('1-')) { comp = true; e = e.slice(2); } else if (e.startsWith('-')) { neg = true; e = e.slice(1); }
    let v = value(scope, e, where, all);
    if (comp) v = 1 - v;
    if (neg) v = -v;
    if (ord) return ordinal(Math.round(v));
    if (word) return `${show(v)} ${v === 1 ? word : `${word}s`}`;
    return pct ? `${show(v * 100)}%` : show(v);
  });
}

/** Fills the named string fields of `obj` in place (a dotted name reaches one level in: 'card.does'). */
export function fillFields(obj, fields, scope, where) {
  for (const f of fields) {
    const [a, b] = f.split('.');
    if (b) { if (obj[a] && typeof obj[a][b] === 'string') obj[a][b] = fillText(obj[a][b], scope, `${where}.${f}`); }
    else if (typeof obj[a] === 'string') obj[a] = fillText(obj[a], scope, `${where}.${f}`);
  }
}
