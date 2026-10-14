// Small helpers for the sentences the game shows (pure; tested).

/** "a", "a and b", "a, b, and c" (with the Oxford comma). */
export function joinList(parts) {
  const p = parts.filter((x) => x !== null && x !== undefined && x !== '');
  if (p.length <= 1) return p[0] ?? '';
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return `${p.slice(0, -1).join(', ')}, and ${p[p.length - 1]}`;
}

/** Seconds as M:SS ("5:00", "4:30"); anything that isn't a positive finite number is 0:00. */
export function clockText(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A name inside a sentence: a leading "The" goes lowercase ("Ready at the Library"). */
export function midSentence(name) {
  return typeof name === 'string' ? name.replace(/^The /, 'the ') : '';
}
