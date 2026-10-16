// Feats and challenge runs, judged from a finished run (ARCHITECTURE §10.6; data/feats.js,
// data/challenges.js). Pure; meta/apply.js calls these with the run's result and the lifetime
// numbers already updated by it.

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const n = (v) => (Number.isFinite(v) ? v : 0);
const killed = (result, id) => Array.isArray(result.bossesKilled) && result.bossesKilled.some((b) => (isObj(b) ? b.id : b) === id);

/** Does a run (with the lifetime numbers) show every part of `when`? */
export function featMet(when, result, stats) {
  for (const [k, v] of Object.entries(when)) {
    switch (k) {
      case 'cleared': if ((result.end === 'cleared' || result.cleared === true) !== v) return false; break;
      case 'tide': if (n(result.tide) < v) return false; break;
      case 'boss': if (!killed(result, v)) return false; break;
      case 'lanternNight': if ((result.lanternNight === true) !== v) return false; break;
      case 'bells': if (n(result.bellsRung) < v) return false; break;
      case 'forms': if (n(result.maxForms) < v) return false; break;
      case 'untouchedSec': if (n(result.untouchedSec) < v || n(result.timeSurvived) < v) return false; break;
      case 'seaGlassHeld': if (n(result.seaGlassMax) < v) return false; break;
      case 'lifetimeKills': if (n(stats?.kills) < v) return false; break;
      default: return false; // a condition this build can't judge is never met
    }
  }
  return true;
}

/** Was this run the challenge it was set out as, and did it meet the goal? */
export function challengeWon(challenge, result) {
  if (!challenge || result.challenge !== challenge.id) return false;
  const g = challenge.goal || {};
  if (g.surviveSec !== undefined && n(result.timeSurvived) < g.surviveSec) return false;
  if (g.boss !== undefined && !killed(result, g.boss)) return false;
  return true;
}

/**
 * Feats a run finishes, and 'after_found' feats it discovers: { done: [feat], found: [feat] }.
 * `doneBefore`, `foundBefore`: Sets of ids already there.
 */
export function judgeFeats(data, result, stats, doneBefore, foundBefore) {
  const done = [], found = [];
  for (const f of data.feats || []) {
    if (doneBefore.has(f.id)) continue;
    if (featMet(f.when, result, stats)) { done.push(f); continue; }
    if (f.visibility === 'after_found' && f.found && !foundBefore.has(f.id) && featMet(f.found, result, stats)) found.push(f);
  }
  return { done, found };
}

/** Whether a feat shows on the Tavern's list for this profile (done ones always do). */
export function featShown(f, done, found) {
  if (done.has(f.id)) return true;
  if (f.visibility === 'visible') return true;
  if (f.visibility === 'after_found') return found.has(f.id);
  return false;
}
