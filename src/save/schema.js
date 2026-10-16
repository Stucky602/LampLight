// The shape of a save. Bump PROFILE_VERSION whenever the profile's stored shape changes, add a
// migration in migrations.js, and add a fixture save to tests/fixtures/saves/ for the new version.

export const PROFILE_VERSION = 3;
export const SETTINGS_VERSION = 1;
export const SAVE_FORMAT = 'lamplight-save';

/** A brand-new profile. Everything derivable is derived at runtime, never stored. */
export function defaultProfile() {
  return {
    v: PROFILE_VERSION,
    profile: {
      materials: {},                       // materialId -> count
      buildings: {},                       // buildingId -> level (0..5)
      research: { done: [], active: [] },  // active: [{ id, runsLeft }]; slots come from the Library's level
      upgrades: {},                        // Lamp Post upgradeId -> rank (v2)
      characters: {},                      // characterId -> { unlocked, masteryXp, perks: [] }
      // Gear (v3): items { uid, id (recipe), tier, affixes: [ids], rolls? (that item's re-rolls:
      // with its uid, the seed of what its next re-roll offers) }; equipped: slot -> uid; next:
      // the next item's uid; rolls: every re-roll made (a count, for the record).
      gear: { inventory: [], equipped: {}, next: 1, rolls: 0 },
      consumables: {},                     // v3: '<consumable id>' or 'rune:<rune id>' (a rune stone) -> count held
      bestiary: {},                        // enemyId -> kills
      bestiaryClaimed: {},                 // v3: enemyId -> how many of its milestones the Cartographer has paid
      codex: [],                           // what the codex has seen: '<kind>:<id>' keys ('weapon:flare_gun')
      feats: [],                           // completed feat ids
      featsFound: [],                      // v3: 'after_found' feats whose discovery has fired
      challenges: [],                      // v3: challenge runs won
      // v3: the gate's last choices (kept so the next run starts the same way).
      setup: { character: '', kit: '', mode: 'standard', curses: [], arcana: '', consumables: [], rune: '', challenge: '' },
      tide: { unlocked: 0, selected: 0 },
      prestige: { cycle: 0, relics: [] },
      flags: {},                           // first-time and dialogue flags
      orphans: {},                         // content this build doesn't know, kept, never deleted
    },
    stats: { runs: 0, playtimeSec: 0, kills: 0, deaths: 0, bestTimeSec: 0, bossKills: 0, clears: 0, lampsLit: 0, bellsRung: 0 },
  };
}

/**
 * fullscreen: covers the screen (Chromium's fullscreen is borderless; there is no exclusive mode).
 * borderless: a frameless window the size of the screen, not flagged fullscreen (taskbar and
 *   notifications behave as they do for normal windows). Switching to or from it re-opens the window.
 * windowed: a normal framed window, sized to a whole multiple of 640x360.
 */
export const DISPLAY_MODES = ['fullscreen', 'borderless', 'windowed'];

export function defaultSettings() {
  return {
    v: SETTINGS_VERSION,
    display: { mode: 'fullscreen', fillScreen: false },
    audio: { master: 0.8, music: 0.6, sfx: 0.8 },
    controls: { prompts: 'auto', deadzone: 0.2 },
    access: { shake: true, damageNumbers: true, flashReduction: false },
    hud: { minimap: 'nearby', minimapSize: 'small' },
  };
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * Settings are forgiving: unknown keys are dropped, missing or invalid values fall back to the
 * defaults. A broken settings file must never stop the game from starting.
 */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const num = (v, lo, hi, dflt) => (typeof v === 'number' && v >= lo && v <= hi ? v : dflt);
  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
  const disp = isObj(raw.display) ? raw.display : {};
  const aud = isObj(raw.audio) ? raw.audio : {};
  const ctl = isObj(raw.controls) ? raw.controls : {};
  const acc = isObj(raw.access) ? raw.access : {};
  const hd = isObj(raw.hud) ? raw.hud : {};
  return {
    v: SETTINGS_VERSION,
    display: {
      mode: pick(disp.mode, DISPLAY_MODES, d.display.mode),
      fillScreen: bool(disp.fillScreen, d.display.fillScreen),
    },
    audio: {
      master: num(aud.master, 0, 1, d.audio.master),
      music: num(aud.music, 0, 1, d.audio.music),
      sfx: num(aud.sfx, 0, 1, d.audio.sfx),
    },
    controls: {
      prompts: pick(ctl.prompts, ['auto', 'playstation', 'xbox', 'keyboard'], d.controls.prompts),
      deadzone: num(ctl.deadzone, 0, 0.6, d.controls.deadzone),
    },
    access: {
      shake: bool(acc.shake, d.access.shake),
      damageNumbers: bool(acc.damageNumbers, d.access.damageNumbers),
      flashReduction: bool(acc.flashReduction, d.access.flashReduction),
    },
    hud: {
      minimap: pick(hd.minimap, ['nearby', 'map', 'off'], d.hud.minimap),
      minimapSize: pick(hd.minimapSize, ['small', 'large'], d.hud.minimapSize),
    },
  };
}

/**
 * Fill anything missing or mistyped in a (migrated) profile doc with defaults, at every depth of
 * the default shape, without touching values that are the right type. Protects against
 * hand-edited or partially written saves (for example `research: {}` would otherwise crash
 * later on research.done). A number stored as text ("12") is read as the number it says rather
 * than replaced. Keys the default doesn't know are left alone.
 * Returns the list of repairs made, for the log.
 */
export function repairProfile(doc) {
  const d = defaultProfile();
  const repairs = [];
  const fix = (target, dflt, pathStr) => {
    for (const [k, v] of Object.entries(dflt)) {
      const cur = target[k];
      const here = pathStr ? `${pathStr}.${k}` : k;
      let ok;
      if (Array.isArray(v)) ok = Array.isArray(cur);
      else if (isObj(v)) ok = isObj(cur);
      else if (typeof v === 'number') {
        ok = typeof cur === 'number' && Number.isFinite(cur);
        if (!ok && typeof cur === 'string' && cur.trim() !== '' && Number.isFinite(Number(cur))) { target[k] = Number(cur); repairs.push(`${here} (read as a number)`); continue; }
      } else ok = typeof cur === typeof v;
      if (!ok) { target[k] = structuredClone(v); repairs.push(here); }
      else if (isObj(v) && Object.keys(v).length) fix(cur, v, here);
    }
  };
  if (!isObj(doc.profile)) { doc.profile = d.profile; repairs.push('profile'); } else fix(doc.profile, d.profile, 'profile');
  if (!isObj(doc.stats)) { doc.stats = d.stats; repairs.push('stats'); } else fix(doc.stats, d.stats, 'stats');
  return repairs;
}
