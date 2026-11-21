// The harbor stages the yields are measured at (ARCHITECTURE §10.3, 0.8.0). What a run brings home
// grows with the harbor (more weapons and relics in the pools, the Lamp Post's upgrades, the
// Ferryman, the Marsh's storm and Well), so runs are measured at a few stages and the model plays
// each run with the yields of the stage nearest its player's own progress (model.mjs).
//
// A stage is a fraction of the harbor, filled evenly and declared here, never bought: every
// building at that share of its levels (those the fog still covers stay ruins), every upgrade
// whose tier is open at that share of its ranks, and that share of the research (lowest tiers
// first, each once what it requires is done). Past the fresh profile the player has killed each
// map's bosses and cleared each map once, so the Salt Marsh is open (with the Docks and the
// Tavern restored) and its storm and Well are on (MAP_LAYERS: the Old Grey killed, its Tide 1);
// its secret (the Cartographer's level 5, or its Tide 2) is past every stage. Because a stage reads no
// cost, re-costing the harbor never changes what a stage's runs play with, and the yields stay
// fresh through a cost refit.

import { defaultProfile } from '../../src/save/schema.js';
import { fogOver } from '../../src/meta/actions.js';
import { levelOf, treeTier, researchTier, researchDone, rankOf, mapOpen } from '../../src/meta/state.js';

/**
 * How many stages: a fresh profile and a quarter, a half, and three quarters of the harbor. (Not
 * the whole harbor: a player who has it all has nothing left to run for.)
 */
export const STAGE_COUNT = 4;
/** The stages: 0 to STAGE_COUNT - 1. */
export const STAGES = Object.freeze(Array.from({ length: STAGE_COUNT }, (_, k) => k));
/** The share of the harbor a stage fills (0, 1/4, 1/2, 3/4). */
export const stageShare = (stage) => stage / STAGE_COUNT;

/**
 * How far a profile is through the harbor, 0 to 1: its building levels, research done, and
 * upgrade ranks over all there are (each counts one). The model picks the measured stage nearest
 * this; a stage's own is worked out the same way, from its profile.
 */
export function progressOf(doc, data) {
  const done = researchDone(doc);
  const have = data.buildings.reduce((s, b) => s + levelOf(doc, b.id, data), 0)
    + data.research.filter((r) => done.has(r.id)).length
    + data.upgrades.reduce((s, u) => s + Math.min(rankOf(doc, u.id), u.ranks), 0);
  const of = data.buildings.reduce((s, b) => s + b.levels.length, 0) + data.research.length + data.upgrades.reduce((s, u) => s + u.ranks, 0);
  return of > 0 ? have / of : 0;
}

/** The bosses on a map's timeline, in the order it brings them. */
export function bossOrder(data, mapId = data.maps[0].id) {
  const m = data.maps.find((x) => x.id === mapId) ?? data.maps[0];
  return m.timeline.events.filter((e) => e.event === 'boss').sort((a, b) => a.at - b.at).map((e) => e.enemy);
}

/** The profile a stage is measured with (see the top of this file). */
export function stageProfile(data, stage) {
  const p = stageShare(stage);
  const doc = defaultProfile();
  const P = doc.profile;
  const levels = (b) => Math.round(p * b.levels.length);
  // The Lamp Post first: its level clears the fog in front of the others.
  const lamp = data.buildings.find((b) => b.id === 'lamp_post');
  if (lamp) P.buildings.lamp_post = levels(lamp);
  for (const b of data.buildings) if (b.id !== 'lamp_post' && !fogOver(doc, data, b.id)) P.buildings[b.id] = levels(b);
  for (const id of Object.keys(P.buildings)) if (!P.buildings[id]) delete P.buildings[id];
  const tree = treeTier(doc, data);
  for (const u of data.upgrades) { const r = u.tier <= tree ? Math.round(p * u.ranks) : 0; if (r > 0) P.upgrades[u.id] = r; }
  if (p > 0) {
    for (const m of data.maps) {
      for (const boss of bossOrder(data, m.id)) P.bestiary[boss] = 1;
      P.tides[m.id] = 1;
    }
  }
  // Research: the lowest tiers first, in the data's order within a tier, each once it can be.
  const want = Math.round(p * data.research.length);
  const order = [...data.research].map((r, i) => ({ r, i })).sort((a, b) => a.r.tier - b.r.tier || a.i - b.i).map(({ r }) => r);
  const tier = researchTier(doc, data);
  const done = [];
  for (let added = true; added && done.length < want;) {
    added = false;
    for (const r of order) {
      if (done.length >= want) break;
      if (done.includes(r.id) || r.tier > tier || !r.requires.every((q) => done.includes(q))) continue;
      if (r.runsOn && !mapOpen(doc, data, r.runsOn)) continue;
      done.push(r.id);
      added = true;
    }
  }
  P.research.done = done;
  return doc;
}

/** The stages a map is measured at: those whose profile has it open (the Salt Marsh's from the second). */
export function stagesFor(data, mapId) {
  return STAGES.filter((s) => mapOpen(stageProfile(data, s), data, mapId));
}
