// Skill trees (ruling 15, C2). One tree a character, 13 skills each, in place of mastery perks.
// A character earns a skill point at each rank in SKILL_RANKS (7 in all) and can never hold a
// whole tree: every tree has three forks (`rival`: taking one closes the other, and whatever
// needs it), a few skills need another first (`needs`), and two open by a Harbor Order (`unlock`).
// No skill is a plain percent: each changes how the character's signature weapon, map trade,
// or cost works. None touches the dash (ruling 16: the Dash slot is the one place the dash changes). What a skill does lives in that character's hook (sim/hooks.js) and trade
// (sim/trades.js), which read the run's skills as world.sk.<id> (the skill's `p`, or undefined).
//
//   id         permanent (saves and replays hold it), unique across every tree
//   character  whose tree
//   row        where the tree screen draws it: 'build' (the first fork: two builds and their
//              follow-ups), the tree's two named fork rows (TREE_ROWS), or 'free'
//   rival      the skill this one closes (forks are written on both sides; the test checks)
//   needs      a skill that must be held first
//   unlock     an order's key ('feat:<id>'): the skill can't be taken until it is met
//   desc       one line: what it changes
//   p          its numbers, for the sim

/** The mastery ranks that give a skill point. */
export const SKILL_RANKS = Object.freeze([1, 3, 5, 7, 9, 10, 11]);

/** What resetting a character's tree costs for each point spent (the map they belong to names the second material). */
export const SKILL_RESET = Object.freeze({ coin: 150, each: 8, material: { lamplighter: 'rum', harpooner: 'rum', drowned_man: 'rum', tide_priest: 'rum', punter: 'marsh_herbs', bog_warden: 'marsh_herbs' } });

/** Each tree's two named fork rows, under the builds row (the screen's labels). */
export const TREE_ROWS = Object.freeze({
  lamplighter: ['The fuel', 'The light'],
  harpooner: ['The line', 'The hook'],
  punter: ['The cost', 'The water'],
  bog_warden: ['The price', 'The dead'],
  drowned_man: ['The sea', 'The debt'],
  tide_priest: ['The ward', 'The call'],
});

const S = (character, row, id, name, desc, p = {}, extra = {}) => ({ id, character, row, name, desc, p, ...extra });

// Ruling 16: no skill reads the dash. Anything a skill refunds or repeats has a clock of its own
// (its `every`, or the clock of what sets it off); work/cw/C2-DESIGN.md has the loop line for each.
export const SKILLS = [
  // ---------------------------------------------------------------- Lamplighter
  S('lamplighter', 'build', 'great_lamp', 'Great Lamp', 'Standing still, she spends a spare flame to set down a lantern for 30s. It gives Lamplight +30% Damage, not +15%.', { up: 2, sec: 30 }, { rival: 'lamp_row' }),
  S('lamplighter', 'build', 'lamp_row', 'Lamp Row', 'Each lantern lasts until 4 more are set down, and a line of light joins each to the next, burning enemies that cross it.', { keep: 4, every: 0.5, damageMul: 0.6, width: 12 }, { rival: 'great_lamp' }),
  S('lamplighter', 'build', 'bonfire', 'Bonfire', 'Standing still for 2s, her lamp throws a ring of fire outward every 3s.', { still: 2, every: 3, reach: 1.7, damageMul: 2, knockback: 1.5 }, { needs: 'great_lamp' }),
  S('lamplighter', 'build', 'lamplit_road', 'Lamplit Road', 'Inside a lantern\'s light she walks 25% faster, and her Fuel refills.', { speed: 0.25 }, { needs: 'lamp_row' }),
  S('lamplighter', 'fork1', 'oil_flask', 'Spare Fuel', 'When her Fuel runs out, a flask refills it once. Lighting a lamp refills the flask.', {}, { rival: 'burn_low' }),
  S('lamplighter', 'fork1', 'burn_low', 'Burn Low', 'Her light never dims. With no Fuel left it goes out for 1s in every 5s instead.', { dark: 1, every: 5 }, { rival: 'oil_flask' }),
  S('lamplighter', 'fork2', 'moth_light', 'Moth Light', 'Every 6s, enemies in her light are stunned for 0.5s.', { daze: 0.5, every: 6 }, { rival: 'signal_lamp' }),
  S('lamplighter', 'fork2', 'signal_lamp', 'Signal Lamp', 'Every 8s her lamp throws a beam the way she faces, dealing 3x her light\'s damage to enemies along it.', { every: 8, reach: 5, width: 14, damageMul: 3 }, { rival: 'moth_light' }),
  S('lamplighter', 'free', 'burning_wards', 'Burning Lamps', 'Lamps she has lit also burn enemies in their light, at 50% of her light\'s damage.', { damageMul: 0.5, every: 0.6 }),
  S('lamplighter', 'free', 'keepers_vigil', 'Keeper\'s Vigil', 'While she stands in a lit lamp\'s light, her own light reaches as far as the lamp\'s.', {}, { needs: 'burning_wards', unlock: 'feat:lamplighter_wards' }),
  S('lamplighter', 'free', 'flare_up', 'Flare Up', 'Touching a lamp she has lit sets off a burst from it that knocks enemies back. Each lamp can do it once every 30s.', { every: 30, radius: 70, damageMul: 3, knockback: 2.5 }),
  S('lamplighter', 'free', 'night_watch', 'Night Watch', 'A ready Lantern Night starts when she stands in a lit lamp\'s light for 2s, not when a crowd comes.', { still: 2 }),
  S('lamplighter', 'free', 'first_flame', 'First Flame', 'She starts with 3 spare flames, and a boss\'s death fills them.', {}, { unlock: 'feat:lamplighter_trial' }),

  // ---------------------------------------------------------------- Harpooner
  S('harpooner', 'build', 'sleigh_ride', 'Sleigh Ride', 'When her hook pulls an elite, she is pulled to it instead, hitting enemies on the way.', { damageMul: 1.5, width: 14 }, { rival: 'deadweight' }),
  S('harpooner', 'build', 'deadweight', 'Deadweight', 'Enemies the Grapnel pulls fly past her and burst where they land, damaging enemies near them.', { past: 60, radius: 30, damageMul: 1.2, knockback: 1 }, { rival: 'sleigh_ride' }),
  S('harpooner', 'build', 'boarding_action', 'Boarding Action', 'After Sleigh Ride pulls her to an elite, enemies close by are stunned for 1.5s and she gets full Armor for 3s.', { radius: 50, daze: 1.5, sec: 3 }, { needs: 'sleigh_ride' }),
  S('harpooner', 'build', 'wrecking_ball', 'Wrecking Ball', 'A pulled elite is swung once round her before it lands, hitting enemies it passes.', { damageMul: 2, knockback: 1.5 }, { needs: 'deadweight' }),
  S('harpooner', 'fork1', 'hand_line', 'Hand Line', 'Her hook flies every 3s, at 50% Range.', { every: 3, reach: 0.5 }, { rival: 'gaff_hand' }),
  S('harpooner', 'fork1', 'gaff_hand', 'Gaff Hand', 'Her hook flies twice as far and hits enemies along its line, every 9s.', { every: 9, reach: 2, damageMul: 1.5, width: 12 }, { rival: 'hand_line' }),
  S('harpooner', 'fork2', 'salvager', 'Salvager', 'Her hook pulls in every pickup she faces from across the screen, and pulling in an elite pulls every gem on the map to her, once every 30s.', { reach: 300, every: 30 }, { rival: 'elite_hunter' }),
  S('harpooner', 'fork2', 'elite_hunter', 'Big Game', 'A pulled elite that dies within 4s drops a second chest, and muster captains can be pulled in too.', { sec: 4 }, { rival: 'salvager' }),
  S('harpooner', 'free', 'gaffed', 'Barbed Hook', 'Every enemy she pulls in is hooked: it takes 30% more damage for 4s.', {}),
  S('harpooner', 'free', 'coil', 'Coil', 'While an elite she pulled in is stunned at her side, the Grapnel throws 50% faster.', { rate: -0.33 }, { needs: 'gaffed', unlock: 'feat:harpooner_reel' }),
  S('harpooner', 'free', 'bulwark', 'Bulwark', 'At 10 Armor from enemies close by, she knocks back enemies close to her and deals 12 damage, once every 8s.', { every: 8, radius: 46, damage: 12, knockback: 3 }),
  S('harpooner', 'free', 'slack_line', 'Slack Line', 'Her other chain weapons no longer pull enemies in. They knock them back, as they do for other characters.', {}),
  S('harpooner', 'free', 'ferrymans_friend', 'Ferryman\'s Friend', 'A post she hooks brings the Ferryman with one more thing in stock.', { extra: 1 }, { unlock: 'feat:harpooner_trial' }),

  // ---------------------------------------------------------------- Punter
  S('punter', 'build', 'water_born', 'Water Born', 'He crosses water for 15s, not 5s. At full Momentum on land his wake slows enemies by 50% and deals 1.6x Punt Pole\'s damage every 0.5s.', { punt: 3, fill: 1, every: 0.25, life: 2.5, radius: 16, damageMul: 1.6, slow: 0.5, interval: 0.5 }, { rival: 'pole_vault' }),
  S('punter', 'build', 'pole_vault', 'Pole Vault', 'At full Momentum, running into 4 or more enemies makes him leap over them and land past them in a sweep, once every 3s.', { count: 4, reach: 44, over: 70, every: 3, sec: 0.3 }, { rival: 'water_born' }),
  S('punter', 'build', 'cold_wake', 'Cold Wake', 'Enemies that cross his wake are frozen for 1s.', { freeze: 1 }, { needs: 'water_born' }),
  S('punter', 'build', 'long_jump', 'Long Jump', 'A leap carries him twice as far, and enemies he passes over are stunned for 1s.', { over: 2, daze: 1, width: 22 }, { needs: 'pole_vault' }),
  S('punter', 'fork1', 'dig_in', 'Dig In', 'After standing still for 1s, he loses no Damage for having no Momentum, and the pole gets +100% Area until he moves.', { still: 1, area: 1 }, { rival: 'never_stop' }),
  S('punter', 'fork1', 'never_stop', 'Never Stop', 'At full Momentum nothing slows him, and the first enemy to touch him is knocked back and does him no harm, once every 3s.', { every: 3, radius: 30, knockback: 3 }, { rival: 'dig_in' }),
  S('punter', 'fork2', 'slick_water', 'Slick Water', 'When he comes off the water the bank stays slick for 5s. Enemies that cross it are slowed by 50%.', { life: 5, radius: 34, slow: 0.5 }, { rival: 'second_cache' }),
  S('punter', 'fork2', 'second_cache', 'Second Chest', 'A second floating chest comes out each time.', {}, { rival: 'slick_water' }),
  S('punter', 'free', 'pole_guard', 'Pole Guard', 'A hit taken at full Momentum empties his Momentum and does no damage, once every 20s.', { every: 20 }),
  S('punter', 'free', 'counterpoise', 'Counterpoise', 'When Pole Guard goes off, the pole sweeps.', {}, { needs: 'pole_guard', unlock: 'feat:punter_marsh' }),
  S('punter', 'free', 'sculling', 'Sculling', 'On the water he jabs twice as fast.', { rate: 0.5 }),
  S('punter', 'free', 'gather_way', 'Gather Way', 'Every 4th sweep that hits 3 or more fills his Momentum, once every 20s.', { every: 4, gap: 20 }),
  S('punter', 'free', 'low_bridge', 'Low Bridge', 'His Momentum never drops below 1 step, so his weapons never take the -25% Damage for having none.', { floor: 1 }, { unlock: 'feat:punter_trial' }),

  // ---------------------------------------------------------------- Bog Warden
  S('bog_warden', 'build', 'barrow_wight', 'Barrow Keeper', 'One thrall that never expires. It gives her +6 Armor and bites all enemies near it each 1s. Each enemy that would rise adds +35% Damage.', { feeds: 20, per: 0.35, shed: 4, armor: 6, sweep: 1, reach: 40 }, { rival: 'the_host' }),
  S('bog_warden', 'build', 'the_host', 'Great Host', 'Twice as many thralls at once, each lasting half as long.', { maxMul: 2, secMul: 0.5 }, { rival: 'barrow_wight' }),
  S('bog_warden', 'build', 'wights_shadow', 'Keeper\'s Leap', 'Every 8s her Barrow Keeper thrall leaps into the biggest group near her. Enemies where it lands rot: they take 25% more damage for 3s.', { every: 8, range: 180, radius: 40, damageMul: 2, rot: 3, amp: 0.25 }, { needs: 'barrow_wight' }),
  S('bog_warden', 'build', 'tide_of_bones', 'Bone March', 'Every 8s her thralls charge the way she faces, biting enemies they pass.', { every: 8, reach: 110, width: 16 }, { needs: 'the_host' }),
  S('bog_warden', 'fork1', 'grave_goods', 'Grave Goods', 'Her other weapons deal full damage while she has no thralls.', {}, { rival: 'borrowed_hands' }),
  S('bog_warden', 'fork1', 'borrowed_hands', 'Borrowed Hands', 'Enemies killed by her other weapons also rise, rotting or not. Those weapons deal another 10% less damage.', { might: -0.1 }, { rival: 'grave_goods' }),
  S('bog_warden', 'fork2', 'old_dead', 'Old Dead', 'Bog bodies and wreck crews last 2 minutes and follow her.', { sec: 120 }, { rival: 'fresh_graves' }),
  S('bog_warden', 'fork2', 'fresh_graves', 'Fresh Graves', 'Elite thralls don\'t count toward her 6 thralls, and last twice as long.', { secMul: 2 }, { rival: 'old_dead' }),
  S('bog_warden', 'free', 'death_rattle', 'Death Rattle', 'A thrall whose time is up bursts, dealing 3x its bite damage to enemies near it.', { radius: 26, bites: 3 }),
  S('bog_warden', 'free', 'second_burial', 'Second Burial', 'A thrall that dies rises once more, for 50% of the time.', { secMul: 0.5 }, { needs: 'death_rattle', unlock: 'feat:warden_causeway' }),
  S('bog_warden', 'free', 'thrall_fetch', 'Deep Barrow', 'Her thralls last 40% longer.', { life: 0.4 }),
  S('bog_warden', 'free', 'rot_walk', 'Rot Walk', 'While she has 3 or more thralls, she leaves rot where she walks.', { count: 3, every: 0.4, life: 2.5, radius: 14, rot: 3, amp: 0.25 }),
  S('bog_warden', 'free', 'wardens_rest', 'Warden\'s Rest', 'While she stands still her thralls gather round her and attack twice as fast.', { still: 0.8, rate: 2 }, { unlock: 'feat:warden_trial' }),

  // ---------------------------------------------------------------- Drowned Man
  S('drowned_man', 'build', 'empty_hands', 'Empty Hands', 'Sea chests never give back a weapon slot. Each one gives Grave Pennies 3 levels and +1 Projectile instead.', { ups: 3, amount: 1 }, { rival: 'wreckers_hoard' }),
  S('drowned_man', 'build', 'wreckers_hoard', 'Wrecker\'s Hoard', 'Sea chests give back both missing weapon slots instead of 1.', { slots: 1 }, { rival: 'empty_hands' }),
  S('drowned_man', 'build', 'coin_of_the_realm', 'King\'s Coin', 'Grave Pennies gains +5% Damage each minute of the run, up to +100%.', { per: 0.05, cap: 1 }, { needs: 'empty_hands' }),
  S('drowned_man', 'build', 'fleet', 'Fleet', 'The purse needs 2 fewer pennies for each weapon he carries past two.', { per: 2, min: 8 }, { needs: 'wreckers_hoard' }),
  S('drowned_man', 'fork1', 'deep_water', 'Far Wrecks', 'His crates are marked farther out, most of a screen away, and each holds two items.', { far: 1.6 }, { rival: 'wash_up' }),
  S('drowned_man', 'fork1', 'wash_up', 'Wash Up', 'A full purse brings the crate up at his feet, with no walk, but the purse needs 5 more pennies.', { more: 5 }, { rival: 'deep_water' }),
  S('drowned_man', 'fork2', 'old_debts', 'Old Debts', 'Killing a boss fills the purse, and the crate it marks is a sea chest.', {}, { rival: 'wreck_diver' }),
  S('drowned_man', 'fork2', 'wreck_diver', 'Wreck Diver', 'The map\'s sunken crates hold as much as a boss\'s chest.', {}, { rival: 'old_debts' }),
  S('drowned_man', 'free', 'heavy_purse', 'Heavy Purse', 'The purse gives Armor as it fills, up to +5 Armor when full. Bringing up a crate empties it.', { armor: 5 }),
  S('drowned_man', 'free', 'last_coin', 'Last Coin', 'Once a run, a blow that would kill him with a full purse empties it instead and leaves him at 30% HP.', { hp: 0.3 }, { needs: 'heavy_purse', unlock: 'feat:drowned_man_bosses' }),
  S('drowned_man', 'free', 'cold_hands', 'Cold Hands', 'When a penny finishes an enemy, enemies near it are frozen for 1s, once every 2s.', { radius: 30, freeze: 1, every: 2 }),
  S('drowned_man', 'free', 'charons_change', 'Charon\'s Change', 'A penny that lands anywhere on screen pays into the purse.', {}),
  S('drowned_man', 'free', 'sunk_cost', 'Salvage Rights', 'Reaching one of the map\'s sunken crates fills the purse.', { fill: 1 }, { unlock: 'feat:drowned_man_trial' }),

  // ---------------------------------------------------------------- Tide Priest
  S('tide_priest', 'build', 'neap_priest', 'Neap Priest', 'Floods come 4 times as often, at 33% damage. Each leaves a shield of at most 8. 6 enemies close to her bring one early, not 12.', { every: 8, mul: 0.34, wardMax: 8, crowd: 6 }, { rival: 'one_great_tide' }),
  S('tide_priest', 'build', 'one_great_tide', 'One Great Tide', 'One flood every 45s. Deep water stays round her for 10s, slowing enemies by 50% and dealing 25% of its damage every 0.5s. +50% Damage.', { every: 45, mul: 1.5, area: 0.25, ward: 2, stand: 10, standMul: 0.25, slow: 0.5 }, { rival: 'neap_priest' }),
  S('tide_priest', 'build', 'undertow', 'Drawdown', 'Her ebbs hold the enemies they pull for 0.6s.', { daze: 0.6 }, { needs: 'neap_priest' }),
  S('tide_priest', 'build', 'drowned_bells', 'Bell Floods', 'The flood also rolls out from every Fog Bell rung this run.', { radiusMul: 0.5, damageMul: 0.6 }, { needs: 'one_great_tide' }),
  S('tide_priest', 'fork1', 'blood_tide', 'Blood Tide', 'Her floods heal her: 1 HP for every 2 enemies hit, up to 25. She gets no shield, and no longer takes 15% more damage without one.', { per: 0.5, max: 25 }, { rival: 'seas_armor' }),
  S('tide_priest', 'fork1', 'seas_armor', 'Sea\'s Armor', 'The shield each flood gives her is 50% bigger, and so is its cap.', { mul: 1.5 }, { rival: 'blood_tide' }),
  S('tide_priest', 'fork2', 'slack_water', 'Slack Water', 'When her flood or ebb comes early, it stuns the enemies it hits for 3s, and the next one comes 3s later.', { sec: 3 }, { rival: 'ride_the_tide' }),
  S('tide_priest', 'fork2', 'ride_the_tide', 'Ride the Tide', 'When her flood comes early, it carries her a short distance in the direction she faces. Nothing can hurt her while it does.', { sec: 0.6 }, { rival: 'slack_water' }),
  S('tide_priest', 'free', 'tide_marks', 'Wrack Line', 'The flood\'s edge leaves a line for 6s that slows enemies crossing it by 40%.', { life: 6, slow: 0.4, n: 10, radius: 16 }),
  S('tide_priest', 'free', 'low_water', 'Ebb Walk', 'For 3s after an ebb she moves 30% faster.', { sec: 3, speed: 0.3 }, { needs: 'tide_marks', unlock: 'feat:tide_priest_bells' }),
  S('tide_priest', 'free', 'bell_ringer', 'Bell Call', 'A Fog Bell she has rung twice brings her flood at once.', {}),
  S('tide_priest', 'free', 'stillness', 'Stillness', 'For each 10 enemies a flood hits she gains 1 Armor for 5s, up to 5.', { still: 1 }),
  S('tide_priest', 'free', 'last_rites', 'Last Rites', 'Once a run, under 15% HP, the flood comes at once and she can\'t be hurt for 2s.', {}, { unlock: 'feat:tide_priest_trial' }),
];

/** A character's tree. */
export function skillsOfCharacter(id) { return SKILLS.filter((s) => s.character === id); }
