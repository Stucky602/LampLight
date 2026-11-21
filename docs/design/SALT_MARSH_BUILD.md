# The Salt Marsh as built: the contract (0.8.0, Phases 8b and 8c)

What the sim and data provide for the Marsh, so the harbor, the screens, the render, and the saves can build on it without reading the sim. The design and its reasons are in `SALT_MARSH.md`; how the systems work is in ARCHITECTURE §5.17. Every name below is in the code as written here.

## The RunConfig

| Field | Shape | Notes |
|---|---|---|
| `map` | `'salt_marsh'` | Map 2. Its `start` is the landing at tile [10, 8]. |
| `layers` | `{ storm, well, secret }`, each `true` or `false` | What of the map the profile has opened. Left out, all are on (tests, bots, tools). An unknown key or a value that isn't a boolean throws. Off: no storm and no Eye (`storm`); an elite Salted Dead at 15:00 instead of the Well's muster (`well`); no Drowned Causeway cache (`secret`). The result echoes them (`layers`). |
| `wellRelics` | `[relic id]` | Added in B5a. The relics given to the Salt Well on earlier runs (`profile.well`, those still in the run's pools). Each Ferryman stock adds a Well slot: one of them in turn, not carried, not banished, not already on offer, at its tier's price, with no draw; the offer carries `well: true`. Not a list of strings, or an unknown id, throws. |
| `characterParams` | `{ name: number }` | Added since B4 began (lead's request). Merged over the character's `mechanic.params` (the run gets the sums: `meta/runconfig.js characterParams` already sends them). Each value must be a finite number. |

Unlock rules for the layers are meta's (`meta/runconfig.js MAP_LAYERS`, ARCHITECTURE §10.6.1): the storm after the Old Grey's first kill, the Well after the Marsh's first clear (its Tide 1), the secret at the Marsh's Tide 2 or the Cartographer at level 5. The map itself opens with `unlock: ['building:docks:1', 'boss:harbor_maw', 'building:tavern:1']` (`data/maps.js`).

## Ids

- **Map** `salt_marsh`. **Materials** `marsh_herbs`, `salt_glass` (`rare: true`, trades as a rare).
- **Enemies** `midge_cloud`, `salted_dead`, `mire_toad`, `creek_eel`, `leech`, `well_warden` (the muster's captain). **Bosses** `old_grey` (10:00), `salt_widow` (20:00).
- **Characters** `punter` (unlock `feat:first_crossing`), `bog_warden` (unlock `feat:eel_season`). The Harpooner's unlock moved to `building:lamp_post:2` (lead's request).
- **Weapons** `brine_spring`, `ice_picks`, `fulgurite`, `eel_pot`, `anchor_chain`, `glass_caltrops`. **Evolutions** `salt_pan` (Brine Spring), `stormglass` (Fulgurite; named Storm Glass), `conger_pot` (Eel Pot), `sea_anchor` (Anchor Chain). Every one has `map: 'salt_marsh'` and no Forms.
- **Passives** `hoarfrost`, `copper_wire`, `grave_moss`, `bitterns_call`, `waders`.
- **Relics** `sea_urchin` (`challenge:brittle_tide`), `quench_bucket` (`feat:quencher`), `cold_iron` (`research:anchor_smithing`), `watchmans_rattle` (`feat:watchman`), `try_pot` (`research:fowlers_calls`), `brine_vat` (`research:salting_ledger`), `bog_torc` (`secret:drowned_causeway`).
- **Runes** `familiar` (`feat:eel_season`), `spillway` (`research:salting_ledger`), `marsh_fever` (`feat:marsh_dawn`), `tarred` (`research:ice_house`).
- **Research** `brine_notes`, `ice_house`, `eel_trapper` (tier 2, `runsOn: 'salt_marsh'`), `fowlers_calls` (tier 2, the Docks' materials), `fulgurite` (tier 3, `runsOn: 'salt_marsh'`), `anchor_smithing`, `salting_ledger` (tier 3, `runsOn: 'drowned_docks'`, cost includes `salt_glass`).
- **Feats** `first_crossing`, `quencher`, `watchman`, `marsh_dawn`, `eel_season`. `dawn` and `high_tide` now say `map: 'drowned_docks'`. **Challenge** `brittle_tide`.
- **Mastery** the Punter's `long_pole`, `reed_eye`, `quick_water`, `push_off` (mechanic `{ dash: -0.1 }`), `heavy_pole`, and kit `punter_picks`; the Bog Warden's `deep_rot`, `peat_smoke`, `mire_host`, `bitter_bite`, `old_roots`, and kit `bog_warden_brine`.
- **Trophies** (consumables) `midge_net`, `salt_crust`, `toad_stone`, `eel_skin`, `leech_jar`, `wardens_key`. Bestiary ladders for every Marsh enemy (`data/meta.js`).
- **The secret** `drowned_causeway` (layer `secret`): its cache is on the island in the far southeast and is reachable only at low water.
- **The tag** `tide` is now `sea` everywhere (tags, `TAG_COLORS.sea`, `.tag-sea`, the arcana hook `arcana_sea_heal`). The gear affixes `tide_might` and `tide_volley` keep their ids (saves hold them) and now read "Damage (Sea)" and "Projectile (Sea)".

## Data fields that are new

- **Map** (`data/maps.js`): `layout: { kind: 'marsh', seed }`, `start: [tx, ty]`, `layers: ['storm', 'well', 'secret']`, `water: { high: [[from, to], ...], creep, warn, mudSlow, rebuildEvery, overtime: { perMin, keepDry } }`, `storm: { windows: [{ from, to, every, burst: [lo, hi] }], overtime, warn, radius, damage, playerDamage, glassEvery }` (the glass pillars' settings are `tuning.storm.pillar: { sec, max, near }`, `data/tuning.js`), `eye: { sec, every, burst, radius, damage, warn, gems, gemXp, glass }`, `herbs: { beds, amount: [lo, hi] }`, `ferry: [tx, ty]`. Timeline events take `layer` and `otherwise` (an event to run instead when the layer is off). New event types are `flock` (`{ enemy, count }`: at most 8, in a tight clump from a random side, flying straight across) and `eye` (`{ sec }`).
- **Enemy** (`data/enemies.js`): `swims: 'land' | 'amphibious' | 'water'`, `clump: n`, `crust: true`, `latch: { every, drain }`, `stormproof: true`, `well: true` (a muster captain who opens the well), `ai.type: 'hopper'` (`every, range, hop, warn, radius, damage, creep`), and `ai.type: 'eel'` (`every, range, warn, lungeSpeed, lungeTime, bank, recover`: the lunge carries at most `bank` px past the water's edge, and its warning line is exactly as long as the lunge).
- **Boss attacks** (`data/bosses.js`): `stab_line` (`length, width, warn, damage`), `leap` (`radius, warn ≥ 0.8, damage, stuck, weak`), `lightning_march` (`count, step, radius, warn, stagger, damage, enemyDamage, kneel, weak`), `summon_wave.water` (tiles). A boss has a weak window (`weakFrom`, `weakUntil`, `weakMul` 2) inside its `minFight` budget.
- **Weapon** (`data/weapons.js`): `map`; emitter `spout` with `puddle: { radius, slow, freeze }` and `shatter: { count, damage, slow }`; `drop.moving`; `emit.armorDamage`. On-hit types are `daze { duration }`, `spill { range, hops }`, `tar { duration, damageMul }`, `fever { duration }`, and `spike { every, life, range, damageMul, max }`. The stat `hops` (Copper Wire; `describe.js` shows "Hop" and "Hops").
- **Research** `runsOn: <map id>`: only runs on that map count toward its `runs` (meta reads it since B5a: ARCHITECTURE §10.6.1).
- **Feats**, the new `when` keys that `meta/feats.js` judges: `map`, `surviveSec`, `quenched`, `crowdSec`, `bossWeapon` (with `boss`), and `weaponLevel` (read with `bossWeapon`).
- **Hooks** with `undo` (a relic given to the Well): `sea_urchin`, `quench_bucket`, `cold_iron`, `watchmans_rattle`, `try_pot`, `brine_vat`, `bog_torc`, `harpooner`, `arcana_embers`, `arcana_relic_tier`. The characters' hooks are `punter` (`perSpeed, cap, dash`) and `bog_warden` (`sec, max, damage, every, speed, reach`).

## The halt

`{ kind: 'well', relics: [ids carried] }` comes when you stand still at an open well. The answers are `{ kind: 'give', id }` (the relic is gone for the run, `wellGiven` records it, and `relic:<id>` is banned for the rest of the run) or `{ kind: 'keep' }`. A well opens once a run and never while you're sinking. The screen is B5's. `tests/helpers/simworld.js` and `sim/bot.js` answer keep.

## Events (`sim/events.js`)

| Event | Code | Fields |
|---|---|---|
| `WATER` | 38 | x, y (you), a = phase (`WATER` in `sim/marsh.js`: 1 warning, 2 rising, 3 high, 4 ebbing, 5 low), b = seconds until it comes (a warning), c = 1 in overtime |
| `HERB` | 39 | x, y, a = herbs picked, b = the bed |
| `FIRST_SIGHT` | 40 | x, y, a = `SIGHT` (1 enemy, 2 water, 3 storm, 4 Eye, 5 herbs, 6 well, 7 pillar, 8 causeway, 9 thrall), b = enemy type index (for an enemy) |
| `STRIKE` | 41 | x, y, a = radius, b = `STRIKE_SRC` (1 storm, 2 Eye, 3 Salt Widow), c = 1 left Salt Glass, d = 1 a pillar rose |
| `PILLAR` | 42 | x, y (the tile's middle), a = 1 rises, 0 falls |
| `WELL` | 43 | x, y, a = 1 opens, 2 a relic given (b = relic index), 3 kept |
| `THRALL` | 44 | x, y, a = 1 rises, 0 crumbles, b = enemy type, c = slot |
| `LATCH` | 45 | x, y, a = 1 latches, 0 thrown off, b = enemy handle, c = latched now |
| `SINK` | 46 | x, y, a = 1 the Bog Torc sinks you, 0 you rise |
| `EYE` | 47 | x, y, a = 1 begins (b = seconds), 0 ends |
| `SHATTER` | 48 | x, y, a = shards, b = weapon slot |
| `TAR` | 49 | x, y, a = radius, b = 1 set off by another weapon, 0 burned off |
| `RATTLE` | 50 | x, y (you): the Watchman's Rattle fires every weapon |
| `LEAP` | 51 | x, y (where it lands), a = 1 up (b = seconds in the air), 0 down, c = 1 stuck in mud, d = enemy handle |

`STATUS` adds `SALT` 5, `TAR` 6, `FEVER` 7, `SOAK` 8, `THAW` 9, and `DAZE` 10 (the status event's code). Every name `FIRST_SIGHT` can carry is in `SIGHT_NAMES`.

## Constants the view reads (`sim/constants.js`, `sim/terrain.js`)

- `GROUND` kinds 9 to 17: `SALT`, `MUD`, `REEDS`, `PEAT`, `STUMP` (solid), `DEEP` (solid), `CAUSEWAY`, `BOARDWALK`, `LANDING`. Until B5 draws them, `groundFrame` falls back to floor.
- `EF.AIR` is 256; enemy `flags` is now a `Uint16Array`. `AI.hopper` is 7 and `AI.eel` 8; `LEECH`, `HOP`, and `EEL` are the enemy states. `EMIT.spout` is 10. `FX` adds `daze` 13, `spill` 14, `tar` 15, `fever` 16, and `spike` 17. `ZONE` adds `PUDDLE` 8, `SPIKE` 9, and `STRIKE` 10 (a warned ring: draw it like a hazard).

## State the view can read (read-only)

- `world.terrain`: `wet`, `pillar`, `base`, `kinds`, `version` (bumps on every ground change; redraw the water then).
- `waterNow(world)` (`sim/marsh.js`): `{ level, phase, high }`, or null off the Marsh. `world.marsh.herbTile` and `world.marsh.herbLeft` are the beds; `world.marsh.g.island` and `world.marsh.g.causeway` are the secret's ground.
- `world.storm`: `pillarTile`, `pillarUntil` (16 slots, -1 empty), and `eyeOpen(world)`.
- `world.well`: `{ open, x, y, given }`. It opens only with the run's `well` layer (the overtime Salt Watch's captain included), and the water moves an open well to dry ground as it does a chest.
- `world.allies` (thralls): `n`, `x`, `y`, `type`, and `life`.
- Enemy fields: `crust`, `saltT`, `tarT`, `feverT`, `thawT`, and the `AIR` flag (a toad's or the Old Grey's shadow: the landing spot is `ax`, `ay`; for a creek eel `ax`, `ay` is where its lunge began, and `lunge` the px it has left). `world.latched` is how many leeches are on you. The player is sunk while `isSunk(world)` (`sim/player.js`).
- Bosses: `bossWeak(world, b)` (`sim/bosses.js`, `b` a boss record from `world.bosses`) is true in a weak window; `ATTACK_CODE` names the new attack types for `rigInput`.

## The run result (`sim/run-result.js`)

New fields: `quenched` (burning enemies hit by Sea or Frost, each once), `crowdSec` (the longest time among at least 40 enemies within 56 px), `wellGiven` (relic id or null), `sighted` (`'enemy:<id>'` or a thing's name, in order of meeting), `thralls`, `tryPotLevels`, `herbsPicked`, and `layers`.

## Tools and tests

- `tests/marsh.test.js`: the map, the water, rule 8 (a pillar on the way home falls; the overtime cap), the flow fields at high water, the herbs, the storm (a burst of 7 over salt crowds) and the Eye (the short run's too), the pillars, the Well and its undo, layers, and first sightings. It takes about 2.9 s.
- `tests/marsh-fight.test.js`: the enemies (holds against each: salt on a crust, a toad in the air, an eel's warning), the bosses, the weapons, the relics, the runes, the statuses, and the characters. It takes about 0.6 s.
- `tools/marsh/rule8.mjs`: the full rule 8 sweep (every tile at 6 levels, up to the overtime cap, and six overtime walks among pillars). It takes about 35 s and exits 1 on a failure.
- `tools/soak/soak.mjs --map salt_marsh`: the Marsh soak, whose report adds the rule 8 searches and the ground rebuilds.
