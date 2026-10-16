// The single entry point for all content and tuning (ARCHITECTURE §11). The game and the tests
// both load data from here.

import { TUNING, HUB_TUNING } from './tuning.js';
import { WEAPONS } from './weapons.js';
import { PASSIVES } from './passives.js';
import { RUNES } from './runes.js';
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
import { ASCENSIONS } from './ascensions.js';

export const DATA = Object.freeze({
  tuning: TUNING,
  weapons: WEAPONS,
  ascensions: ASCENSIONS,
  passives: PASSIVES,
  runes: RUNES,
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
});

export { TUNING, HUB_TUNING, WEAPONS, PASSIVES, RUNES, RELICS, CHARACTERS, ENEMIES, BOSSES, MAPS, MATERIALS, SFX, PALETTE, ASCENSIONS, BUILDINGS, RESEARCH, UPGRADES, NPCS, HUB, META };
