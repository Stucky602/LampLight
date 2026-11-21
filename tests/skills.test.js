// Skill trees (ruling 15): the data's shape, points, forks, needs, orders, reset, the run's
// config, and what a save's mastery perks became.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { SKILL_RANKS, SKILL_RESET, TREE_ROWS } from '../src/data/skills.js';
import * as K from '../src/meta/skills.js';
import { runConfigFor } from '../src/meta/runconfig.js';
import { reconcileProfile } from '../src/meta/reconcile.js';
import { defaultProfile as createProfile } from '../src/save/schema.js';
import { contentFrom } from '../src/meta/state.js';
import { MetaError } from '../src/meta/actions.js';

const ranks = DATA.meta.masteryRanks;
function who(xp, id = 'lamplighter', tavern = 2, feats = []) {
  const d = createProfile();
  d.profile.buildings.tavern = tavern;
  d.profile.characters = Object.fromEntries(DATA.characters.map((c) => [c.id, { unlocked: true, masteryXp: c.id === id ? xp : 0, skills: [] }]));
  d.profile.feats = feats;
  d.profile.materials = { coin: 99999, rum: 999, marsh_herbs: 999 };
  return d;
}

test('skills: every character has a tree of 12 to 15, with two builds, three forks, needs, and two order skills', () => {
  for (const c of DATA.characters) {
    const t = DATA.skills.filter((s) => s.character === c.id);
    assert.ok(t.length >= 12 && t.length <= 15, `${c.id}: ${t.length} skills`);
    assert.ok(TREE_ROWS[c.id]?.length === 2, `${c.id}: two named fork rows`);
    const forks = t.filter((s) => s.rival);
    assert.ok(forks.length >= 4, `${c.id}: at least two forks`);
    for (const s of forks) {
      const r = t.find((x) => x.id === s.rival);
      assert.ok(r && r.rival === s.id && r.row === s.row, `${s.id}: its rival closes it back, in the same row`);
    }
    for (const s of t.filter((x) => x.needs)) assert.ok(t.some((x) => x.id === s.needs), `${s.id}: needs a skill of the same tree`);
    assert.ok(t.filter((s) => s.needs).length >= 2, `${c.id}: a few skills need another`);
    assert.equal(t.filter((s) => s.unlock).length, 2, `${c.id}: two skills open by an order`);
    assert.equal(t.filter((s) => s.row === 'build' && s.rival).length, 2, `${c.id}: two builds`);
    // Nobody holds a whole tree: the most that can be held is more than the points there are.
    const holdable = t.length - forks.length / 2 - t.filter((s) => s.needs && t.find((x) => x.id === s.needs).rival).length / 2;
    assert.ok(holdable > SKILL_RANKS.length, `${c.id}: ${holdable} could be held, ${SKILL_RANKS.length} points`);
    assert.ok(SKILL_RANKS.length >= 6 && SKILL_RANKS.length <= 7);
    for (const s of t) {
      assert.match(s.desc, /\.$/, `${s.id}: a sentence`);
      assert.ok(!/!/.test(s.desc) && !/\d+px/.test(s.desc), `${s.id}: no exclamation marks, no pixels`);
      for (const v of Object.values(s.p)) assert.ok(Number.isFinite(v), `${s.id}: its numbers are numbers`);
      if (s.unlock) assert.ok(DATA.feats.some((f) => `feat:${f.id}` === s.unlock), `${s.id}: its order exists`);
    }
  }
  assert.equal(new Set(DATA.skills.map((s) => s.id)).size, DATA.skills.length, 'ids are unique');
  // An order that opens a skill says so on the board.
  assert.deepEqual(contentFrom(DATA, 'feat:lamplighter_wards').map((x) => x.what), ['skill']);
});

test('skills: points come from ranks, the last one late', () => {
  assert.equal(ranks.length, 11);
  assert.equal(K.skillPoints(who(0), DATA, 'lamplighter').earned, 0);
  assert.equal(K.skillPoints(who(ranks[0]), DATA, 'lamplighter').earned, 1);
  assert.equal(K.skillPoints(who(ranks[9]), DATA, 'lamplighter').earned, 6);
  assert.deepEqual(K.skillPoints(who(ranks[10]), DATA, 'lamplighter'), { earned: 7, spent: 0, left: 7, max: 7, nextRank: null });
  // About 30 mastery points a cleared run: the 7th point at run 25 to 30.
  const M = DATA.tuning.mastery, perRun = 20 * M.perMinute + 2 * M.perBoss;
  const runs = ranks[10] / perRun;
  assert.ok(runs >= 25 && runs <= 30, `${runs} runs to the last point`);
});

test('skills: taking, forks, needs, orders, and no points', () => {
  let d = who(ranks[10]);
  assert.equal(K.whyNotSkill(who(999, 'lamplighter', 1), DATA, 'great_lamp'), 'Needs the Tavern at Lv 2');
  assert.equal(K.whyNotSkill(who(0), DATA, 'great_lamp'), 'No points to spend. The next comes at mastery rank 1');
  assert.equal(K.whyNotSkill(d, DATA, 'bonfire'), 'Needs Great Lamp first');
  assert.equal(K.whyNotSkill(d, DATA, 'first_flame'), 'Opens with the order Lamplighter\'s Trial');
  d = K.takeSkill(d, DATA, 'great_lamp').doc;
  assert.equal(K.whyNotSkill(d, DATA, 'great_lamp'), 'Already taken');
  assert.equal(K.whyNotSkill(d, DATA, 'lamp_row'), 'Closed: you took Great Lamp');
  assert.equal(K.whyNotSkill(d, DATA, 'lamplit_road'), 'Closed: you took Great Lamp', 'what needs the rival is closed too');
  assert.equal(K.whyNotSkill(d, DATA, 'bonfire'), null);
  assert.throws(() => K.takeSkill(d, DATA, 'lamp_row'), MetaError);
  for (const id of ['bonfire', 'oil_flask', 'moth_light', 'burning_wards', 'flare_up', 'night_watch']) d = K.takeSkill(d, DATA, id).doc;
  assert.equal(K.skillPoints(d, DATA, 'lamplighter').left, 0);
  assert.equal(K.whyNotSkill(d, DATA, 'signal_lamp'), 'Closed: you took Moth Light');
  // An order's skill opens with the order.
  const open = who(ranks[10], 'lamplighter', 2, ['lamplighter_trial']);
  assert.equal(K.whyNotSkill(open, DATA, 'first_flame'), null);
  // The tree view: states and what a fork closes.
  const v = K.treeView(d, DATA, 'lamplighter');
  assert.deepEqual(v.rows.map((r) => r.label), ['Builds', 'The fuel', 'The light', 'Free']);
  const s = (id) => v.rows.flatMap((r) => r.skills).find((x) => x.id === id);
  assert.equal(s('great_lamp').state, 'held');
  assert.equal(s('lamp_row').state, 'closed');
  assert.equal(s('first_flame').state, 'locked');
  assert.deepEqual(s('lamp_row').closes, ['Great Lamp', 'Bonfire']);
  // The run gets the tree as it stands.
  const cfg = runConfigFor(d, DATA, { character: 'lamplighter', seed: 1 });
  assert.deepEqual(Object.keys(cfg.skills).sort(), ['bonfire', 'burning_wards', 'flare_up', 'great_lamp', 'moth_light', 'night_watch', 'oil_flask']);
  assert.deepEqual(cfg.skills.great_lamp, DATA.skills.find((x) => x.id === 'great_lamp').p);
  assert.equal(runConfigFor(who(0), DATA, { character: 'lamplighter', seed: 1 }).skills, undefined);
});

test('skills: a reset gives every point back for materials', () => {
  let d = who(ranks[4], 'punter', 2, ['first_crossing']);
  assert.equal(K.whyNotReset(d, DATA, 'punter'), 'No skills taken');
  d = K.takeSkill(d, DATA, 'pole_vault').doc;
  d = K.takeSkill(d, DATA, 'long_jump').doc;
  assert.deepEqual(K.resetCost(d, DATA, 'punter'), { coin: SKILL_RESET.coin * 2, marsh_herbs: SKILL_RESET.each * 2 });
  const poor = structuredClone(d); poor.profile.materials = {};
  assert.match(K.whyNotReset(poor, DATA, 'punter'), /^Need /);
  const out = K.resetSkills(d, DATA, 'punter');
  assert.deepEqual(K.skillsOf(out.doc, DATA, 'punter'), []);
  assert.equal(out.doc.profile.materials.coin, 99999 - SKILL_RESET.coin * 2);
  assert.equal(K.whyNotSkill(out.doc, DATA, 'water_born'), null, 'the rival can be taken now');
  assert.equal(d.profile.characters.punter.skills.length, 2, 'the document passed in is untouched');
});

test('skills: a save\'s trained perks are paid back once, and their points are there to spend', () => {
  const d = createProfile();
  d.profile.buildings.tavern = 2;
  d.profile.characters = { lamplighter: { unlocked: true, masteryXp: ranks[4], perks: ['trimmed_wick', 'oil_reserve', 'night_walker'] }, harpooner: { unlocked: true, masteryXp: 0, perks: [] } };
  d.profile.materials = { coin: 10 };
  const a = reconcileProfile(d, DATA).doc;
  const cost = K.RETIRED_PERKS;
  assert.equal(a.profile.materials.coin, 10 + cost.trimmed_wick.cost.coin + cost.oil_reserve.cost.coin + cost.night_walker.cost.coin);
  assert.equal(a.profile.materials.rum, 30 + 55 + 80);
  assert.equal(a.profile.characters.lamplighter.perks, undefined);
  assert.deepEqual(a.profile.characters.lamplighter.skills, []);
  assert.equal(a.profile.characters.lamplighter.masteryXp, ranks[4]);
  assert.equal(a.profile.retiredNote.perks, 3);
  assert.equal(a.profile.retiredNote.points, 3);
  assert.equal(K.skillPoints(a, DATA, 'lamplighter').left, 3);
  // Once: a second load pays nothing more.
  const b = reconcileProfile(a, DATA).doc;
  assert.deepEqual(b.profile.materials, a.profile.materials);
  // Every perk an old build could have trained has its price here.
  assert.equal(Object.keys(K.RETIRED_PERKS).length, 42);
});
