// The shape of a save. Bump PROFILE_VERSION whenever the profile's stored shape changes, add a
// migration in migrations.js, and add a fixture save to tests/fixtures/saves/ for the new version.

export const PROFILE_VERSION = 4;
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
      characters: {},                      // characterId -> { unlocked, masteryXp, skills: [] }
      // Gear (v3): items { uid, id (recipe), tier, affixes: [ids], rolls? (that item's re-rolls:
      // with its uid, the seed of what its next re-roll offers) }; equipped: slot -> uid; next:
      // the next item's uid; rolls: every re-roll made (a count, for the record).
      gear: { inventory: [], equipped: {}, next: 1, rolls: 0 },
      consumables: {},                     // v3: '<consumable id>' or 'rune:<rune id>' (a rune stone) -> count held
      bestiary: {},                        // enemyId -> kills
      codex: [],                           // what the codex has seen: '<kind>:<id>' keys ('weapon:flare_gun')
      feats: [],                           // completed feat ids
      featsFound: [],                      // v3: 'after_found' feats whose discovery has fired
      // (featsHeld, optional: orders done before the Tavern kept the board, counted when it's restored;
      // absent means none. meta/state.js featsHeld, meta/reconcile.js.)
      // (Retired in 0.9.0, no longer part of a new profile: bestiaryClaimed, challenges, setup.arcana.
      // An old save's are mapped to what they became by meta/retired.js, and never deleted while they hold anything.)
      // v3: the gate's last choices (kept so the next run starts the same way).
      // v4: the gate's map too.
      setup: { character: '', kit: '', mode: 'standard', curses: [], consumables: [], rune: '', challenge: '', map: '' },
      tide: { selected: 0 },               // v4: only the Tide last chosen (what's opened is per map, below)
      tides: {},                           // v4: mapId -> Tides opened on that map (0..10)
      well: [],                            // v4: relic ids given to the Salt Well (the Ferryman offers them on every map)
      seen: {},                            // v4: mapId -> what that map has shown ('enemy:<id>' or a thing: 'water', 'storm', ...)
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
    // ambience (0.9.0, W6): the sea and the wind under the music.
    audio: { master: 0.8, music: 0.6, ambience: 0.6, sfx: 0.8 },
    // rumble (0.8.2): the controller shakes for a few things on the map (app/rumble.js), on by
    // default at half strength (Kevin rules out screen shake; this shakes the controller only).
    // keys, pad (0.9.0): the player's own bindings, only the actions that differ from the defaults
    // (input/bindings.js; Settings, Controls).
    controls: { prompts: 'auto', deadzone: 0.2, rumble: true, rumbleStrength: 0.5, keys: {}, pad: {} },
    // 0.9.0: textScale (the menus' type: 1, 1.25, 1.5), highContrast (warnings drawn brighter
    // with an outline), brightness (W6: the run's ground and the harbor's night, 0.5 as made).
    access: { damageNumbers: true, flashReduction: false, textScale: 1, highContrast: false, brightness: 0.5 },
    // 0.9.0: what a level-up does once every card is a weapon upgrade (W1b; sim/draft.js draftFull):
    // 'choose' shows the cards, 'auto' takes the best one (autoPick) and says so on the quiet line.
    play: { fullBuild: 'choose' },
    // arrows (0.8.2): the edge arrows to lamps, bells, the Ferryman, and drops off screen.
    hud: { minimap: 'nearby', minimapSize: 'small', arrows: true },
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
  const pl = isObj(raw.play) ? raw.play : {};
  // Bindings: an object of action -> list; input/bindings.js normalizeBindings checks each button.
  const binds = (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[a-z]{1,16}$/.test(k) && Array.isArray(x) && x.length <= 4 && x.every((c) => (typeof c === 'string' && c.length <= 20) || Number.isInteger(c))).map(([k, x]) => [k, [...x]])) : {});
  return {
    v: SETTINGS_VERSION,
    display: {
      mode: pick(disp.mode, DISPLAY_MODES, d.display.mode),
      fillScreen: bool(disp.fillScreen, d.display.fillScreen),
    },
    audio: {
      master: num(aud.master, 0, 1, d.audio.master),
      music: num(aud.music, 0, 1, d.audio.music),
      ambience: num(aud.ambience, 0, 1, d.audio.ambience),
      sfx: num(aud.sfx, 0, 1, d.audio.sfx),
    },
    controls: {
      prompts: pick(ctl.prompts, ['auto', 'playstation', 'xbox', 'keyboard'], d.controls.prompts),
      deadzone: num(ctl.deadzone, 0, 0.6, d.controls.deadzone),
      rumble: bool(ctl.rumble, d.controls.rumble),
      rumbleStrength: num(ctl.rumbleStrength, 0, 1, d.controls.rumbleStrength),
      keys: binds(ctl.keys),
      pad: binds(ctl.pad),
    },
    access: {
      damageNumbers: bool(acc.damageNumbers, d.access.damageNumbers),
      flashReduction: bool(acc.flashReduction, d.access.flashReduction),
      textScale: pick(acc.textScale, [1, 1.25, 1.5], d.access.textScale),
      highContrast: bool(acc.highContrast, d.access.highContrast),
      brightness: num(acc.brightness, 0, 1, d.access.brightness),
    },
    hud: {
      minimap: pick(hd.minimap, ['nearby', 'map', 'off'], d.hud.minimap),
      minimapSize: pick(hd.minimapSize, ['small', 'large'], d.hud.minimapSize),
      arrows: bool(hd.arrows, d.hud.arrows),
    },
    play: {
      fullBuild: pick(pl.fullBuild, ['choose', 'auto'], d.play.fullBuild),
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
