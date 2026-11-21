// The single entry point for all content and tuning (ARCHITECTURE §11). The game and the tests
// both load data from here.

import { TUNING, HUB_TUNING, SLOTS } from './tuning.js';
import { WEAPONS } from './weapons.js';
import { PASSIVES } from './passives.js';
import { RELICS } from './relics.js';
import { CHARACTERS } from './characters.js';
import { ENEMIES } from './enemies.js';
import { BOSSES } from './bosses.js';
import { MAPS } from './maps.js';
import { MATERIALS } from './materials.js';
import { SFX, SFX_VOICE_CAP } from './sfx.js';
import { PALETTE } from './palette.js';
import { BUILDINGS } from './buildings.js';
import { RESEARCH } from './research.js';
import { UPGRADES } from './upgrades.js';
import { NPCS } from './npcs.js';
import { HUB } from './hub.js';
import { META } from './meta.js';
import { ASCENSIONS, RETIRED_WEAPONS } from './ascensions.js';
import { RECIPES, AFFIXES } from './gear.js';
import { CONSUMABLES } from './consumables.js';
import { TIDES, CURSES } from './tide.js';
import { CHALLENGES } from './challenges.js';
import { TROPHIES } from './trophies.js';
import { FEATS } from './feats.js';
import { KITS } from './mastery.js';
import { WEAPON_PERKS } from './orders-weapons.js';
import { SKILLS } from './skills.js';
import { MARKET } from './market.js';
import { GLOSSARY, GLOSSARY_KINDS } from './glossary.js';
import { RARITIES } from './rarity.js';
import { WEAPON_UPS } from './weaponups.js';
import { SIGNATURES, SIGNATURE_IDS } from './signatures.js';
import { SIGNATURE_FORMS } from './signature-forms.js';
import { DASHES } from './dashes.js';

// 0.9.0 (W2, ruling 2): the characters' signature weapons join the weapon list (replacing the old
// built-in Lamplight by its id), and their Form lines join the ascensions.
const ALL_WEAPONS = [...WEAPONS.filter((w) => !SIGNATURE_IDS.has(w.id)), ...SIGNATURES];
const ALL_ASCENSIONS = [...ASCENSIONS, ...SIGNATURE_FORMS];

export const DATA = Object.freeze({
  tuning: TUNING,
  weapons: ALL_WEAPONS,
  weaponUps: WEAPON_UPS,             // 0.9.0, ruling 10: the types a weapon's level-up rolls (data/weaponups.js)
  dashes: DASHES,                    // ruling 16: the Dash slot's items (data/dashes.js)
  ascensions: ALL_ASCENSIONS,
  retiredWeapons: RETIRED_WEAPONS,   // 0.9.0: the evolved weapons, each its base weapon with its capstone
  slots: SLOTS,                      // 0.9.0: a run's slots, grown by the harbor (meta/state.js slotsFor)
  passives: PASSIVES,
  relics: RELICS,
  characters: CHARACTERS,
  enemies: ENEMIES,
  bosses: BOSSES,
  maps: MAPS,
  materials: MATERIALS,
  sfx: SFX,
  sfxVoiceCap: SFX_VOICE_CAP,
  palette: PALETTE,
  // The meta layer and the harbor (Phase 5).
  buildings: BUILDINGS,
  research: RESEARCH,
  upgrades: UPGRADES,
  npcs: NPCS,
  hub: HUB,
  hubTuning: HUB_TUNING,
  meta: META,
  // Phase 7: the other six buildings' systems.
  recipes: RECIPES,
  affixes: AFFIXES,
  consumables: CONSUMABLES,
  tides: TIDES,
  curses: CURSES,
  challenges: CHALLENGES,            // the set runs' rules (each is an order in `feats`, data/challenges.js)
  trophies: TROPHIES,                // what a Hunt opens (data/trophies.js)
  feats: FEATS,
  skills: SKILLS,                    // the characters' skill trees (ruling 15, data/skills.js)
  kits: KITS,
  weaponPerks: WEAPON_PERKS,       // C3: what the weapons' orders open (data/orders-weapons.js)
  market: MARKET,
  // 0.9.0: every term the screens use, one plain entry each (ui/glossary.js).
  glossary: GLOSSARY,
  glossaryKinds: GLOSSARY_KINDS,
  // 0.9.0, ruling 10: the five rarities (gear tiers, and W1b's rolled weapon upgrades).
  rarities: RARITIES,
});

export { RECIPES, AFFIXES, CONSUMABLES, TIDES, CURSES, CHALLENGES, TROPHIES, FEATS, SKILLS, KITS, MARKET };
export { TUNING, HUB_TUNING, ALL_WEAPONS as WEAPONS, PASSIVES, RELICS, CHARACTERS, ENEMIES, BOSSES, MAPS, MATERIALS, SFX, PALETTE, ALL_ASCENSIONS as ASCENSIONS, BUILDINGS, RESEARCH, UPGRADES, NPCS, HUB, META };
