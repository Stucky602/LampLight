// Harbor Orders (feats), set runs and Hunts among them, judged from a finished run (ARCHITECTURE
// §10.6; data/feats.js, data/challenges.js, data/trophies.js). Pure; meta/apply.js calls these with the run's result and the lifetime
// numbers already updated by it (`stats`, with `enemyKills`: each enemy's kills over every run).

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const n = (v) => (Number.isFinite(v) ? v : 0);
const list = (v) => (Array.isArray(v) ? v : []);
/** The condition keys featMet can judge (the content test holds every order to them). */
export const FEAT_KEYS = Object.freeze(['cleared', 'tide', 'boss', 'lanternNight', 'bells', 'forms', 'untouchedSec', 'seaGlassHeld', 'lifetimeKills', 'map', 'surviveSec', 'quenched', 'crowdSec', 'bossWeapon', 'weaponLevel',
  'character', 'weapon', 'capstone', 'level', 'kills', 'enemy', 'elites', 'bosses', 'nights', 'lamps', 'relics', 'relic', 'passivesMax', 'trades', 'reliquaries', 'embers', 'dashKills', 'damageTakenMax', 'overtime', 'curses', 'curse', 'heirloom', 'mode', 'secret', 'well', 'tag', 'thralls', 'herbs',
  // W4's (0.9.0): the act reached, the Long Night's dawn won, small secrets found, a map event seen.
  'act', 'dawnWon', 'finds', 'find', 'mapEvent',
  // The sweep, X2: a set run (the run set out as that order), and one enemy's kills over every run.
  'run', 'enemyTotal',
  // C3 (ruling 18 P1): the weapon that did the most damage in the run (a weapon's mastery order).
  'topWeapon',
  // C3 (ruling 19 PD): both options on one of a weapon's axes, across runs (the profile's codex ticks).
  'axisBoth']);
const killed = (result, id) => Array.isArray(result.bossesKilled) && result.bossesKilled.some((b) => (isObj(b) ? b.id : b) === id);

/** Does a run (with the lifetime numbers) show every part of `when`? */
/** `maxOf(passiveId)`: a passive's max level (passivesMax needs it; judgeFeats passes it from the data). */
export function featMet(when, result, stats, maxOf = null) {
  for (const [k, v] of Object.entries(when)) {
    switch (k) {
      // C3 (ruling 19 PD): both options on one axis of a weapon, across runs: the profile's codex
      // ticks ('took:<weapon>:<option>', meta/apply.js), this run's among them.
      case 'axisBoth': {
        const have = new Set(Array.isArray(stats?.codex) ? stats.codex : []);
        if (!isObj(v) || !Array.isArray(v.pairs) || !v.pairs.some((p) => Array.isArray(p) && p.length === 2 && p.every((o) => have.has(`took:${v.weapon}:${o}`)))) return false;
        break;
      }
      case 'cleared': if ((result.end === 'cleared' || result.cleared === true) !== v) return false; break;
      case 'tide': if (n(result.tide) < v) return false; break;
      case 'boss': if (!killed(result, v)) return false; break;
      case 'lanternNight': if ((result.lanternNight === true) !== v) return false; break;
      case 'bells': if (n(result.bellsRung) < v) return false; break;
      case 'forms': if (n(result.maxForms) < v) return false; break;
      case 'untouchedSec': if (n(result.untouchedSec) < v || n(result.timeSurvived) < v) return false; break;
      case 'seaGlassHeld': if (n(result.seaGlassMax) < v) return false; break;
      case 'lifetimeKills': if (n(stats?.kills) < v) return false; break;
      // The Salt Marsh's (0.8.0): on a map, how long, burning enemies quenched, seconds among a
      // crowd, and a boss killed with one weapon doing the most damage (at a level).
      case 'map': if (result.map !== v) return false; break;
      case 'surviveSec': if (n(result.timeSurvived) < v) return false; break;
      case 'quenched': if (n(result.quenched) < v) return false; break;
      case 'crowdSec': if (n(result.crowdSec) < v) return false; break;
      case 'bossWeapon': {
        const b = Array.isArray(result.bossesKilled) ? result.bossesKilled.find((x) => isObj(x) && x.id === when.boss) : null;
        if (!b || !Array.isArray(b.weapons) || b.weapons[0] !== v) return false;
        break;
      }
      case 'weaponLevel': if (n(result.weaponLevelMax?.[when.bossWeapon ?? when.weapon]) < v) return false; break;
      // 0.9.0, the Harbor Orders (work/veteran/W5-CONTRACT.md §2).
      case 'character': if (result.character !== v) return false; break;
      case 'weapon': if (!(isObj(result.weaponLevelMax) && n(result.weaponLevelMax[v]) > 0) && !list(result.weapons).some((w) => w?.id === v)) return false; break;
      case 'capstone': if (!list(result.capstones).includes(v)) return false; break;
      case 'topWeapon': { const top = list(result.weapons).filter(isObj).reduce((b, w) => (n(w.damage) > n(b?.damage) ? w : b), null); if (!top || top.id !== v) return false; break; }
      case 'level': if (n(result.level) < v) return false; break;
      case 'kills': if (n(result.totalKills) < v) return false; break;
      case 'enemy': for (const [id, k] of Object.entries(v || {})) if (n(result.kills?.[id]) < k) return false; break;
      case 'elites': if (n(result.elitesKilled) < v) return false; break;
      case 'bosses': if (list(result.bossesKilled).length < v) return false; break;
      case 'nights': if (n(result.lanternNights) < v) return false; break;
      case 'lamps': if (n(result.lampsLit) < v) return false; break;
      case 'relics': if (list(result.relics).length < v) return false; break;
      case 'relic': if (!list(result.relics).some((r) => (isObj(r) ? r.id : r) === v)) return false; break;
      case 'passivesMax': if (list(result.passives).filter((p) => isObj(p) && maxOf && n(p.level) >= maxOf(p.id)).length < v) return false; break;
      case 'trades': if (n(result.ferryBought) < v) return false; break;
      case 'reliquaries': if (n(result.reliquaries) < v) return false; break;
      case 'embers': if (n(result.embers) < v) return false; break;
      case 'dashKills': if (n(result.dashKills) < v) return false; break;
      case 'damageTakenMax': if (!Number.isFinite(result.damageTaken) || result.damageTaken > v) return false; break;
      case 'overtime': if (n(result.overtimeMinutes) < v) return false; break;
      case 'curses': if (list(result.curses).length < v) return false; break;
      case 'curse': if (!list(result.curses).includes(v)) return false; break;
      case 'heirloom': if (v === true ? !result.heirloom : result.heirloom !== v) return false; break;
      case 'run': if (result.challenge !== v) return false; break;
      case 'enemyTotal': for (const [id, k] of Object.entries(v || {})) if (n(stats?.enemyKills?.[id]) < k) return false; break;
      case 'mode': if ((result.mode || 'standard') !== v) return false; break;
      case 'secret': if (!list(result.secretsFound).includes(v)) return false; break;
      case 'well': if ((typeof result.wellGiven === 'string') !== v) return false; break;
      case 'tag': for (const [t, k] of Object.entries(v || {})) if (n(result.tags?.[t]) < k) return false; break;
      case 'thralls': if (n(result.thralls) < v) return false; break;
      case 'herbs': if (n(result.herbsPicked) < v) return false; break;
      // W4's run arc (0.9.0, work/veteran/W4-NOTES.md): `finds` and `mapEvents` are lists of ids
      // (or { id } objects); a count reads their length.
      case 'act': if (n(result.act) < v) return false; break;
      case 'dawnWon': if ((result.dawn === true) !== v) return false; break;
      case 'finds': if (list(result.finds).length < v) return false; break;
      case 'find': if (!list(result.finds).some((x) => (isObj(x) ? x.id : x) === v)) return false; break;
      case 'mapEvent': if (!list(result.mapEvents).some((x) => (isObj(x) ? x.id : x) === v)) return false; break;
      default: return false; // a condition this build can't judge is never met
    }
  }
  return true;
}

/**
 * Feats a run finishes, and 'after_found' feats it discovers: { done: [feat], found: [feat] }.
 * `doneBefore`, `foundBefore`: Sets of ids already there.
 */
export function judgeFeats(data, result, stats, doneBefore, foundBefore, judgeAll = true) {
  const done = [], found = [];
  const maxOf = (id) => data.passives.find((p) => p.id === id)?.maxLevel ?? Infinity;
  for (const f of data.feats || []) {
    if (doneBefore.has(f.id)) continue;
    // (judgeAll false judges only the Chapel's Tide orders. meta/apply.js judges every order from
    // the first run since the sweep's D3, and holds what the Tavern can't show yet.)
    if (!judgeAll && f.group !== 'tide') continue;
    if (featMet(f.when, result, stats, maxOf)) { done.push(f); continue; }
    if (f.visibility === 'after_found' && f.found && !foundBefore.has(f.id) && featMet(f.found, result, stats, maxOf)) found.push(f);
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
