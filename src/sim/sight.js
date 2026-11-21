// First sightings (docs/design/SALT_MARSH.md rule 5): the first time a run meets an enemy or a
// new thing (the water, the storm, the Eye, the herbs, the well, a glass pillar, the causeway, a
// thrall), one FIRST_SIGHT event, and its name in the run's result (`sighted`: 'enemy:<id>' or the
// thing's name). The harbor (B5) keeps the field guide from these and says which are new to you.

import { EV, SIGHT, SIGHT_NAMES } from './events.js';

/** The first enemy of a type in this run (sim/enemies.js spawnEnemy; one array read after that). */
export function sightEnemy(world, type, x, y) {
  world.seen[type] = 1;
  world.result.sighted.push(`enemy:${world.enemyDefs[type].id}`);
  world.events.push(EV.FIRST_SIGHT, x, y, SIGHT.ENEMY, type);
}

/** The first time this run meets a thing (SIGHT), at the player. */
export function sightThing(world, what) {
  const bit = 1 << what;
  if ((world.seenThings & bit) !== 0) return;
  world.seenThings |= bit;
  world.result.sighted.push(SIGHT_NAMES[what]);
  world.events.push(EV.FIRST_SIGHT, world.player.x, world.player.y, what, 0);
}
