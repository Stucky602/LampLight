// The measured yields the pacing report stands on (ARCHITECTURE §10.3): where they're kept, which
// sets there are (each built map at each harbor stage it's open at: stages.mjs), and the
// fingerprint that says whether a set was measured on the code and data in the repo now.
// Measuring takes half an hour of bot runs, so the yields are committed (tools/pacing/yields.json,
// and yields-skilled.json for the practiced player) and reused; the gate fails when a set is stale
// and names the command that measures it again (REMEASURE).
//
// What a measured run reads, and so what a set's fingerprint covers: the code measure.mjs runs (the
// sim, the bot, the meta layer, the stages, followed through their imports; comments and spacing
// don't count), the data the sim plays with (weapons, enemies, the tuning..., and of the maps only
// the one measured: the sim reads no other), and the run config that set's stage gives on its map
// (its pools, upgrades, the Ferryman, the map's layers). Left out:
//   - the harbor's own data (buildings, research, upgrades, townsfolk, the hub, ...: HARBOR_ONLY),
//     which reaches a run only through that config, so re-costing the harbor, the tool's everyday
//     use, leaves the yields fresh;
//   - what only the view and the speakers read: every `sprite` and `icon` field, wherever it is,
//     and the palette and the sounds (RENDER_ONLY), which nothing in the sim reads (the gate checks
//     the sim's code never names them), so new art never makes the yields stale.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { atlasInputs, codeOf } from '../atlas/sources.mjs';

/** The committed yields of the ordinary bots (a newer player), from the repo's root. */
export const YIELDS_FILE = 'tools/pacing/yields.json';
/** The committed yields of the practiced player (bots that can't die: pacing.mjs --skilled). */
export const SKILLED_YIELDS_FILE = 'tools/pacing/yields-skilled.json';
/** The committed yields of the player who stays for overtime (the sweep, X3: bots that can't die, staying to the dawn: --stays). */
export const STAYS_YIELDS_FILE = 'tools/pacing/yields-stays.json';
/** The yields file's version: v3 holds sets, a map at a stage each, with their own fingerprints. */
export const YIELDS_VERSION = 3;
/** The command that measures the yields again (the three files, every set): about an hour on 2 cores (the staying runs are half again as long). */
export const REMEASURE = 'node tools/pacing/pacing.mjs --remeasure --jobs 2';

/**
 * The parts of DATA a run reads only through its run config (hashed as the config). Phase 7's are
 * all chosen at the gate or bought in the harbor, and a stage's profile has none of them: gear,
 * run tools, Tides and curses, trophies, set runs, orders, mastery, the Market.
 */
export const HARBOR_ONLY = Object.freeze(['buildings', 'research', 'upgrades', 'npcs', 'hub', 'hubTuning', 'meta',
  'recipes', 'affixes', 'consumables', 'tides', 'curses', 'trophies', 'challenges', 'feats', 'perks', 'weaponPerks', 'kits', 'market']);
/** Tables of DATA only the view, the screens, and the speakers read. */
export const RENDER_ONLY = Object.freeze(['palette', 'sfx', 'sfxVoiceCap', 'glossary', 'glossaryKinds', 'rarities']);
/** Fields only the view reads, left out wherever they are in the data the sim plays with. */
export const RENDER_FIELDS = Object.freeze(['sprite', 'icon']);

/** The code a measured run runs: measure.mjs and every file it imports, but not the data files (hashed as data). */
export function yieldsInputs(root) {
  const data = readdirSync(join(root, 'src/data')).filter((f) => f.endsWith('.js')).map((f) => `src/data/${f}`);
  return atlasInputs(root, ['tools/pacing/measure.mjs'], ['tests/helpers/jsscan.js', ...data]);
}

/** The key a set is named by: 'salt_marsh stage 2'. */
export const setKey = (s) => `${s.map} stage ${s.stage}`;

/** The data the sim plays with on `map`, as hashed: no harbor or render tables, no render fields, only that map. */
export function playedData(DATA, map) {
  const played = Object.fromEntries(Object.entries(DATA).filter(([k]) => !HARBOR_ONLY.includes(k) && !RENDER_ONLY.includes(k)));
  played.maps = DATA.maps.filter((m) => m.id === map);
  return JSON.stringify(played, (k, v) => (RENDER_FIELDS.includes(k) ? undefined : v));
}

/**
 * The fingerprints of the repo at `root` (its own modules are loaded, so a copy can be checked):
 * { sets: [{ map, stage }] (every built map at every stage it's open at), of(map, stage): the
 * set's fingerprint, 16 hex digits }.
 */
export async function yieldsFingerprints(root) {
  const code = createHash('sha256');
  for (const f of yieldsInputs(root)) { code.update(f); code.update('\0'); code.update(codeOf(readFileSync(join(root, f), 'utf8'))); code.update('\0'); }
  const codeHash = code.digest('hex');
  const load = (f) => import(pathToFileURL(join(root, f)).href);
  const { DATA } = await load('src/data/index.js');
  const { measureConfig } = await load('tools/pacing/measure.mjs');
  const { stagesFor } = await load('tools/pacing/stages.mjs');
  const sets = DATA.maps.flatMap((m) => stagesFor(DATA, m.id).map((stage) => ({ map: m.id, stage })));
  const byMap = new Map();
  const of = (map, stage) => {
    if (!byMap.has(map)) byMap.set(map, playedData(DATA, map));
    const h = createHash('sha256');
    h.update(codeHash); h.update('\0'); h.update(byMap.get(map)); h.update('\0');
    const { seed, ...config } = measureConfig(0, false, map, stage, DATA);
    h.update(JSON.stringify(config));
    return h.digest('hex').slice(0, 16);
  };
  return { sets, of };
}

/** The yields kept at `file`, or null if there are none. Throws on a file that holds no measured sets. */
export function readYields(file) {
  if (!existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (!saved || !Array.isArray(saved.sets) || !saved.sets.length || saved.sets.some((s) => !Array.isArray(s.runs) || !s.runs.length)) {
    throw new Error(`${file} holds no measured sets (v${YIELDS_VERSION}: a map at a stage each, with its runs): measure them with ${REMEASURE}`);
  }
  return saved;
}

/**
 * Which of the sets `fps` wants are stale in `saved` (measured on other code or data, or missing),
 * and which kept sets are no longer wanted: { stale: [keys], extra: [keys] }.
 */
export function staleSets(saved, fps) {
  const kept = new Map((saved?.sets || []).map((s) => [setKey(s), s]));
  const stale = fps.sets.filter((s) => kept.get(setKey(s))?.fingerprint !== fps.of(s.map, s.stage)).map(setKey);
  const want = new Set(fps.sets.map(setKey));
  return { stale, extra: [...kept.keys()].filter((k) => !want.has(k)) };
}

/** What the gate and the report say about stale sets, with the command that measures them again. */
export function staleText(file, { stale, extra }) {
  const parts = [];
  if (stale.length) parts.push(`${stale.join(', ')} ${stale.length === 1 ? 'was' : 'were'} measured on other code or data (or never)`);
  if (extra.length) parts.push(`${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} no longer a set`);
  return parts.length ? `STALE YIELDS in ${file}: ${parts.join('; ')}. Measure again with: ${REMEASURE}` : '';
}

/**
 * The drift check (`npm run pacing:check`, tools/pacing/check.mjs): is every committed set, for
 * the three players, measured on today's code and data? { ok, said: [lines] }. A release step, not part
 * of `npm test`: a sim or balance change makes the yields stale until 168 twenty-minute bot runs are
 * measured again, and that must not stand between a small fix and a deploy (ARCHITECTURE §14).
 * `files` are paths under `root` (or absolute); `fps` can be passed in (tests).
 */
export async function checkYields(root, { files = [SKILLED_YIELDS_FILE, YIELDS_FILE, STAYS_YIELDS_FILE], fps = null } = {}) {
  const want = fps ?? await yieldsFingerprints(root);
  const said = [];
  for (const file of files) {
    let saved = null;
    try { saved = readYields(isAbsolute(file) ? file : join(root, file)); } catch (e) { said.push(e.message); continue; }
    if (!saved) { said.push(`${file} is missing: measure it with ${REMEASURE}`); continue; }
    const text = staleText(file, staleSets(saved, want));
    if (text) said.push(text);
  }
  return { ok: said.length === 0, said };
}
