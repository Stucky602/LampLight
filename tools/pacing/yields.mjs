// The measured yields the pacing report stands on (ARCHITECTURE §10.3): where they're kept, and
// the fingerprint that says whether they were measured on the code and data in the repo now.
// Measuring takes minutes of bot runs, so the yields are committed (tools/pacing/yields.json) and
// reused; a report made from yields measured on other code says so.
//
// What a measured run reads, and so what the fingerprint covers: the code measure.mjs runs (the
// sim, the bot, the meta layer, followed through their imports; comments and spacing don't
// count), the data the sim plays with (weapons, enemies, maps, the tuning...), and the run config
// a fresh profile gets (its pools and upgrades). The harbor's own data (buildings, research,
// upgrades, townsfolk, the map, its tuning) reaches a fresh profile's run only through that
// config, so re-costing the harbor, the tool's everyday use, leaves the yields fresh.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { atlasInputs, codeOf } from '../atlas/sources.mjs';

/** The committed yields, from the repo's root. */
export const YIELDS_FILE = 'tools/pacing/yields.json';

/** The parts of DATA a fresh profile's run reads only through its run config (hashed as the config). */
export const HARBOR_ONLY = Object.freeze(['buildings', 'research', 'upgrades', 'npcs', 'hub', 'hubTuning', 'meta']);

/** The code a measured run runs: measure.mjs and every file it imports, but not the data files (hashed as data). */
export function yieldsInputs(root) {
  const data = readdirSync(join(root, 'src/data')).filter((f) => f.endsWith('.js')).map((f) => `src/data/${f}`);
  return atlasInputs(root, ['tools/pacing/measure.mjs'], ['tests/helpers/jsscan.js', ...data]);
}

/**
 * The fingerprint of everything a measured run depends on, for the repo at `root` (its own
 * modules are loaded, so a copy can be checked): the code, the data the sim reads, and a fresh
 * profile's run config. 16 hex digits.
 */
export async function yieldsFingerprint(root) {
  const h = createHash('sha256');
  for (const f of yieldsInputs(root)) {
    h.update(f); h.update('\0'); h.update(codeOf(readFileSync(join(root, f), 'utf8'))); h.update('\0');
  }
  const load = (f) => import(pathToFileURL(join(root, f)).href);
  const { DATA } = await load('src/data/index.js');
  const { runConfigFor } = await load('src/meta/runconfig.js');
  const { defaultProfile } = await load('src/save/schema.js');
  const { MEASURE } = await load('tools/pacing/measure.mjs');
  const played = Object.fromEntries(Object.entries(DATA).filter(([k]) => !HARBOR_ONLY.includes(k)));
  h.update(JSON.stringify(played)); h.update('\0');
  const { seed, ...config } = runConfigFor(defaultProfile(), DATA, { character: MEASURE.character, seed: 'fingerprint' });
  h.update(JSON.stringify(config));
  return h.digest('hex').slice(0, 16);
}

/**
 * The yields kept at `file`, or null if there are none: { saved, stale }, where `stale` is true
 * when they were measured on other code or data than `fingerprint` (or carry no fingerprint).
 */
export function readYields(file, fingerprint) {
  if (!existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (!saved || !Array.isArray(saved.runs) || !saved.runs.length) throw new Error(`${file} holds no measured runs`);
  return { saved, stale: saved.fingerprint !== fingerprint };
}
