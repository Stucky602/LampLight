// Text the HUD and menus show, formatted the same way everywhere (pure; tested).

/** Seconds as M:SS (or H:MM:SS past an hour). Negative or non-numbers show 0:00. */
export function formatClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A count with thousands separators: 12,345. */
export function formatCount(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : 0;
  return v.toLocaleString('en-US');
}
