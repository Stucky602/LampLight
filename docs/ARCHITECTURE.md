# Lamplight: Architecture

Version 1, Sep 27 2026. Written in Phase 0 (Opus 5.5, max).

This is the "how" document. `BRIEF.md` says what the game is and why. `HANDOFF.md` says where the work currently stands. Every session reads all three completely before touching anything.

When documents disagree: the brief wins on what the game is, this document wins on how it is built, and a real conflict between them goes to Kevin as a question. Never resolve it silently.

---

## 1. The constraints that shape every decision

| Constraint | What it forces |
|---|---|
| The product is a Windows PC game played with a controller | Electron desktop build, Gamepad API first, a UI that works without a mouse, no touch or phone considerations anywhere |
| Kevin has no terminal and deploys through GitHub and Cloudflare web dashboards | All building, testing, and packaging happens in Claude's workspace. The repo must build on Cloudflare with `npm run build && npx wrangler deploy` and nothing else |
| No GitHub Actions, ever | The .exe is packaged in Claude's workspace and sent as a download |
| Tests gate every deploy | Tests are fast (the whole gate under about 60 s), deterministic, and never measure performance. Every zip carries every test file that `package.json` names |
| GitHub web upload limits | At most 100 files per zip and 25 MB per file. The repo is designed to stay compact: content lives in a few large data files, not one file per weapon |
| Claude cannot play the game | Every feel value lives in data and can be changed live from an in-game tuning panel. Every run can be replayed exactly from a small file. Claude verifies visuals through screenshots, and verifies behavior through a headless simulation and bots |
| Kevin is away for a stretch | The phase plan front-loads everything that doesn't need a playtest. Feel sign-off is a gate that waits for him |

---

## 2. Stack

Versions checked against the npm registry on Sep 27 2026. Pin the major version and let minor versions float.

| Piece | Choice | Version | Why |
|---|---|---|---|
| Language | Plain JavaScript, ES modules, JSDoc types where useful | Node 22 | No compile step, so the simulation runs directly in Node for tests and bots. TypeScript would add a toolchain and gain little for a single builder |
| Bundler | Vite | 8.x | Fast, simple, and already used on Kevin's other projects |
| Renderer | PixiJS (WebGL) | 8.x | v8's ParticleContainer draws about 1,000,000 particles at 60 fps on the PixiJS team's benchmark. Rendering will not be the bottleneck; simulation is |
| Desktop shell | Electron | 44.x | Chromium-based like the Edge or Chrome that runs the playtest build, so the two behave nearly the same. Where they differ, the .exe is the reference |
| Packager | @electron/packager | 20.x | Tested Sep 27 2026: produces a working Windows folder with `Lamplight.exe` from this Linux workspace, with no Wine. About 368 MB unzipped and 151 MB zipped |
| Sound effects | ZzFX | 1.3.x | A tiny procedural synth. Sounds are parameter arrays in data |
| Save export compression | fflate | 0.8.x | Small and fast deflate |
| Deploy | wrangler | 4.x | Kevin's existing Cloudflare pattern |
| Tests | Node's built-in `node:test` | built in | Zero dependencies, so there is nothing extra for Cloudflare to install |
| Workspace-only tools | pngjs, maxrects-packer, playwright-core (with the preinstalled Chromium) | current | For the atlas builder, screenshots, and bots. They live in `tools/package.json`, which Cloudflare never installs |

Rejected: Phaser (it would fight the sim/render split), a heavyweight engine (the brief forbids it), and Godot (Claude can't run or verify it in the workspace).

---

## 3. Repo layout

The repo is named `lamplight`, and the playtest site will be `lamplight.strickland-kevinj.workers.dev`.

```
lamplight/
  package.json            "type": "module"; scripts: test = node --test "tests/**/*.test.js" (quoted glob, verified on Node 22),
                          build = npm test && vite build --mode web; deps: pixi.js, fflate, zzfx; devDeps: vite, wrangler;
                          engines.node ">=22" (Cloudflare reads it; a GitHub web upload drops dotfiles)
  package-lock.json
  vite.config.js          two modes: web (playtest) and desktop
  wrangler.jsonc          assets.directory "dist", workers_dev true
  .node-version           22 (optional: the upload can lose it, so package.json engines says it too)
  .gitignore
  index.html
  public/
    _headers              index.html and version.json never cached; hashed assets cached forever
  docs/
    BRIEF.md  ARCHITECTURE.md  HANDOFF.md  DECISIONS.md
    WRITING.md            how every word the player reads is written (tests/voice.test.js checks it)
  src/
    main.js               boot: platform detect, load save, start the scene manager
    app/                  scene manager and scenes (title, hub, run), loop driver, version check; the app
                          logic the scenes share, pure where it can be (runlogic.js; hublogic.js: what a
                          purchase plays out as in the harbor, the prompts and lines); the profile kept and
                          saved (keeper.js), and the flow between screens (flow.js: a run's end folded in
                          and saved, the results for the harbor, every way off the page, through the keeper)
    lib/                  shared pure helpers: rng, math, hash, pools
    sim/                  THE GAME RULES. Pure and deterministic. No DOM, no Pixi
      world.js  pools.js  spatial.js  flowfield.js  director.js  player.js
      weapons.js (pipeline)  stats.js  draft.js  hooks.js (relics, characters)  bosses.js
      events.js  run-result.js  ascend.js (Embers)  bot.js (scripted players for tests and balance)
    meta/                 PROGRESSION RULES. Pure: state.js (everything derived from the profile), costs.js,
                          actions.js (restore, upgrade, research), apply.js (applyRunResult), next.js (the
                          next three), runconfig.js (a run's pools and modifiers), reconcile.js (saves from
                          other builds), dev.js (the harbor's dev commands, §15), guide.js (a new player's
                          goal in the harbor, §10.4)
    hub/                  THE HARBOR YOU WALK (Phase 5). Pure: map.js (walkable tiles, fog regions, props,
                          reachability), world.js (walking and the dash, the keepers, the ceremonies, arrivals),
                          tuning.js (the harbor's live tuning, which its tuning panel changes)
    data/                 ALL CONTENT AND TUNING, as plain objects
      weapons.js  passives.js  relics.js  runes.js  characters.js  enemies.js  bosses.js
      maps.js  buildings.js  research.js  upgrades.js  materials.js  hub.js  npcs.js  meta.js
      sfx.js  tuning.js  palette.js  credits.js  ascensions.js (what an Ember does to a weapon)
      index.js (the one entry point tests load)
      (later phases add gear.js, tide.js, curses.js, arcana.js, consumables.js, challenges.js, feats.js,
      cycles.js, renames.js)
    assets/               the sprite atlas, generated by tools/atlas and committed: atlas.png (one page) and
                          atlas.json (frame table, animations, rig parts, source fingerprint). Vite
                          fingerprints the PNG's name, so a page and its atlas always arrive together
    render/               Pixi: run view (runview.js: every layer, the feel toolkit, light, fog, warnings,
                          damage numbers; what it remembers between frames is viewstate.js, pure), HUD
                          (hud.js; what it shows and where is hudmodel.js, pure; its minimap, minimap.js, with
                          what it shows and where in minimapmodel.js, pure), the atlas (atlas.js; its table,
                          read without Pixi, atlasdata.js; the glow and fog made at boot, textures.js; the
                          character frame's shape, shared with the builder, playerframe.js),
                          boss rigs (rigs.js the layout, rigpose.js how they move and glow, both pure; rigview.js
                          draws them), pixel frames
                          (pixels.js, sheet.js), the 5 x 7 pixel font (font.js), feel math (feel.js); the
                          harbor (hubview.js draws it, its parts labeled for the tests; hubtiles.js, pure:
                          each tile's frame, a building's stage and lights, the light map at a point, an
                          arrival's boat and newcomer, the camera's limits, the fog's density and mask)
    input/                gamepad, keyboard, action mapping, glyphs, recorded input frames
    ui/                   DOM overlays: the focus framework (focus.js), the screen stack (screens.js), the
                          screens (menus.js), the tuning panel (tuning.js, tuningmodel.js), card text
                          (describe.js); the harbor's screens (hubscreens.js: a building's panel, the gate,
                          the results, the harbor's menu), what sits over the harbor (hubhud.js), and their
                          words (hubtext.js, pure); ui.css and the bundled font (fonts/)
    audio/                SFX rendered at boot (zzfx.js, the ZzFX generator) and played with voice limits
                          and volume buses (audio.js)
    save/                 store (desktop file, web IndexedDB), migrations, export/import codec, replays, reports
  tests/                  the deploy gate (see §14)
    fixtures/saves/       one save from every schema version, kept forever
    helpers/              stand-ins the tests share: a DOM (fakedom.js), a sim world (simworld.js), a code
                          scanner (jsscan.js), and the harbor view on Pixi's scene graph in Node (hubrig.js)
  art/                    sprite sources that ARE committed: manifest.js (sprite id → pack tile and palette ramp
                          or colors, or a drawing), draw/ (sprites drawn in code: effects, the gull and crab,
                          icons the packs lack, the bosses' parts, the dock boards; hub.js: the harbor's sea,
                          pier, quay, boat, setts, the town lamp, and the buildings' stages). Raw pack files
                          are never committed
  desktop/                Electron shell. Own package.json so Cloudflare never installs Electron
    main.cjs  preload.cjs  savefs.cjs (save files)  shell.cjs (testable pure helpers)  package.json
  tools/                  workspace-only. Own package.json. Never run by Cloudflare
    atlas/  bots/  soak/  shots/  pacing/  smoke/  bench/  icon/  judge/  lib/  replay/  golden/  pack-desktop.mjs
    (atlas/: build.mjs the command, atlas.mjs the core, treat.mjs, mask.mjs, color.mjs, png.mjs,
     sources.mjs the fingerprint, rig-preview.mjs a picture of the rigs, hub-preview.mjs a picture of
     the harbor at any building levels;
     bots/: bots.mjs the balance sweep, harpooner-trials.mjs the standing-still trials of §20 call 44;
     shots/: shot.mjs screenshots and the whole-loop check, harbor-probe.mjs the harbor's fog and a
     newcomer's step off the boat measured on the GPU;
     pacing/: pacing.mjs measures run yields with the bots and prints the report, report.mjs the
     report's text, model.mjs the simulated players and greedy buyer (both tested by the gate),
     yields.json the committed yields and yields.mjs their fingerprint)
```

Rules:
- `.exe` files, raw art packs, and `node_modules` are never committed.
- The generated atlas is committed (src/assets/), so Cloudflare never runs the art pipeline.
- Content stays in one file per category until a file passes about 2,000 lines. Then it splits by map (for example `data/weapons/docks.js`), still in few files.

---

## 4. How the pieces fit

```
 controller/keyboard ──► input ──► InputFrame (one per tick, recorded)
                                        │
 meta: profile ──► RunConfig ──►  ┌─────▼────────────────────────┐
                                  │  sim  (pure, fixed 60 Hz)    │
                                  │  typed-array world state     │──► event buffer ──► render / audio / HUD
                                  └─────┬────────────────────────┘
                                        │ on run end
                                        ▼
                                    RunResult ──► meta.applyRunResult(profile) ──► new profile ──► save
                                                                                        │
 the harbor: hub world (pure: walk, doors, set pieces) ◄── derived state (fog, people, props, stages)
             a purchase ──► meta actions (restore, upgrade, research) ──► new profile ──► save ──► ceremony
```

### Import boundaries

These are enforced by `tests/boundary.test.js`. It reads each file with a small scanner (`tests/helpers/jsscan.js`) that separates code from comments, strings, template text, and regex literals, so a comment that mentions `window` or an import in a doc example can't fail the gate, and real code can't hide in a template's `${...}`. The layer table in the test is the source of truth; this table mirrors it.

| Layer | May import | Must never touch |
|---|---|---|
| `data/` | other `data/` files | anything else |
| `lib/` | other `lib/` files | DOM, Pixi, clocks |
| `sim/` | `data/`, `lib/` | Pixi, DOM, `render/`, `ui/`, `audio/`, `input/`, `save/`, `Math.random`, `Date`, `performance.now`, timers, and the engine math functions whose results can vary between JavaScript engines (`Math.sin`, `cos`, `tan`, `atan2`, `exp`, `pow`, `log`, `hypot`, and relatives, and the `**` operator, which is `pow` by another name); use `lib/fmath.js` instead |
| `meta/` | `data/`, `lib/` | the same list as `sim/` |
| `hub/` | `sim/` (its tile collision), `data/`, `lib/` | the same list as `sim/` |
| `input/` | `lib/` | everything else |
| `save/` | `lib/`, `data/`, fflate | everything else |
| `render/` | reads `sim/` and `hub/` state and `meta/`'s derived state; `data/`, `lib/`, Pixi | `ui/`, `app/`, `save/`, `input/`, `audio/`; writing sim, hub, or profile state |
| `audio/` | `data/`, `lib/` | everything else |
| `ui/` | `input/` (for glyphs), `meta/` actions, `data/`, `lib/` | `sim/`, `render/`, `save/`, `audio/` |
| `app/`, `main.js` | everything | nothing |

Why this matters: because `sim/`, `meta/`, and `hub/` are pure, the whole game can run in Node with no screen. That powers the deploy tests, the balance bots, the progression-pacing simulator, exact replays, and bug reports Claude can reproduce without playing.

---

## 5. The simulation (`src/sim/`)

### 5.1 Loop and time
- The sim runs at a fixed 60 ticks per second (`dt = 1/60`). Rendering runs at the monitor's refresh rate and interpolates positions between the previous and current tick, so 144 Hz monitors look smooth.
- The loop driver (in `app/`) uses an accumulator and runs at most 5 sim ticks per frame, so a slow frame can't snowball.
- **Hit-stop** lives in the loop driver, not in the sim. It holds the sim for a few frames while rendering continues. The sequence of ticks is unchanged, so replays stay exact. Hit-stop fires only on big events (boss hits, elite kills, the player getting hurt, level-ups), never on ordinary hits. In a horde game, per-hit hit-stop would freeze the screen constantly.
- The level-up draft, chest reels, and pause all stop the sim entirely.

### 5.2 Determinism
- All randomness goes through seeded PRNG streams (`lib/rng.js`, sfc32), forked by purpose: `spawn`, `combat`, `draft`, `loot`, `boss`. Separate streams mean a change to the draft code doesn't reshuffle enemy spawns, which keeps balance comparisons stable.
- Same build + same seed + same input frames = the same run, bit for bit. `tests/determinism.test.js` checks this with a state hash at 60 seconds.
- **Cross-engine determinism.** Replays are recorded in Electron (or the player's browser) and replayed by Claude in Node. Those run different V8 versions, and functions like `Math.sin` and `Math.pow` are not guaranteed to return identical bits across versions. So `sim/` and `meta/` use `lib/fmath.js`: polynomial sin, cos, atan, atan2, exp, log, and pow after exact range reduction (no lookup tables), built only from `+ - * /`, `Math.sqrt` (which IEEE 754 requires to be exactly rounded), and exact bit operations. Verified in Phase 1: the outputs hash identically under Node 22 (V8 12.4), Electron 44 (V8 15.2), and Bun (JavaScriptCore). The boundary test forbids the engine versions. `tests/determinism.test.js` also checks a stored hash from a fixed replay, so any drift fails the gate.
- Replays record the build ID. A replay from a different build is refused with a plain message instead of silently desyncing.

### 5.3 Entity storage
There are hundreds or thousands of enemies, projectiles, gems, and particles, so they live in **structure-of-arrays pools**: one typed array per field, one index per entity. There are no per-entity objects, and numbers stored into typed arrays are never boxed, so the hot loops create no garbage of their own. The soak test holds the whole sim to the budget in §17.

| Pool | Capacity | Fields (examples) |
|---|---|---|
| Enemies | 4,096 | x, y, prevX, prevY, vx, vy, hp, maxHp, type, flags (elite, boss, telegraphing), knockback x/y, flash timer, status timers (burn, slow, freeze, rot), anim phase |
| Projectiles | 4,096 | x, y, vx, vy, life, weapon slot, damage, pierce left, radius, motion type, motion params |
| Gems | 4,096 | x, y, value, state (idle or magnet). Above 1,500 on the field, new gems merge into one large gem |
| Zones | 256 | auras, burning ground, tide pools (few, so small structs are fine) |
| Pickups | 256 | chests, materials, healing, the magnet item |

Visual particles (sparks, embers) are not sim state. They live in a render-side pool (§6.2).

- The pickup pool keeps its last 32 slots for heals, magnets, and chests. Materials past that line go straight into the run's haul, a chest that finds the pool full opens where it fell, and a heal or magnet that finds it full replaces the one lying farthest from the player. Nothing the player earned is lost to a full pool.

- Removal is swap-with-last, so arrays stay dense.
- Anything that holds a reference to another entity (homing targets, chain hops) uses a **handle** (index plus a generation counter), which becomes invalid automatically when the entity dies.
- Multi-hit control: each enemy stores, per weapon slot, the tick it was last hit by that slot. A weapon can't hit the same enemy again until its hit cooldown passes. This is the standard survivors-genre approach, and it stops piercing projectiles and auras from shredding everything in one frame.

### 5.4 Spatial hash
- A uniform grid with 16 px cells over a 128×128-cell window (2,048 px square) that follows the player, rebuilt every tick into flat typed arrays: a linked list per cell (a head per cell, a next per item), and only the cells the last build used are reset, so a build costs O(items), not O(cells). There's no allocation. Items outside the window clamp into its edge cells, which keeps queries exact (every candidate is distance-checked) and only costs speed for rare stragglers. Elites and bosses (radius over 8 px) skip the grid, and every query checks them directly.
- (Phase 0 planned a counting sort. Phase 2 measured the full-grid pass it needs as the larger cost at these counts and switched to the linked list.)
- It's used for projectile-vs-enemy hits, enemy separation, contact damage, zone damage, and the gem magnet.
- **Measured in the Phase 0 prototype** on this 2-CPU container (enemy seek plus separation plus projectile hits, all densely packed): 1,000 enemies with 300 projectiles took 0.46 ms per tick, 2,000/500 took 1.1 ms, and 3,000/800 took 2.0 ms. The budget is 16.7 ms per frame. The brief's 1,000-enemy target has plenty of headroom, and 2,000+ is realistic.

### 5.5 Tick order
This order is fixed, and it's part of determinism:

1. Read this tick's InputFrame
2. Player movement and dash
3. Weapons fire (cooldowns tick, emitters create projectiles and zones)
4. Projectiles move
5. Projectile hits (spatial hash queries, on-hit effects)
6. Zones tick
7. Enemies act (AI, flow field, separation, knockback decay, status effects)
8. Contact damage to the player (i-frames after a hit)
9. Deaths resolve (drops, relic and character hooks, kill counts)
10. Gems and pickups (magnet, collection, XP); then the run's tasks and the Ferryman (§10.8), and the deaths those caused
11. Level-up check (queues drafts; the loop driver opens the level-up screen)
12. Director spawns (timeline, density target, scripted events)
13. Events flush to the event buffer

In code (`stepWorld` in `sim/world.js`), a few bookkeeping steps sit between those: weapon and player stats are rebuilt first if the build changed; after step 2 the flow field updates, the enemy grid is built, and `onTick` hooks run; the grid is rebuilt after step 7 (enemies moved) for contact; dead enemies are removed after step 12. When a step queues a decision (a draft, a chest, a rune, the overtime choice), the sim halts after the tick and the next halt gets its cards.

### 5.6 Enemies and movement
- **AI types** (data picks one per enemy): `chase` (walks at the player), `swarm` (spawns as a wall or ring and crosses the screen in a straight line), `charger` (telegraphs, then dashes), `hazard` (drops a telegraphed zone), `splitter` (splits on death), `ranged_slow` (rare, slow, readable shots only; this is not a bullet hell).
- **Separation:** a soft push from neighbors, taken from the spatial hash, so crowds read as a mass and not as a single stacked blob. Half the crowd separates each tick (alternating), at twice the strength, which gives the same spread for fewer grid queries.
- **Obstacles:** maps with obstacles use a **flow field**: a breadth-first search over the tile grid from the player's tile, recomputed when the player changes tile, and limited to 48 tiles (768 px) around the player, well past the 400 px spawn ring. Enemies read their direction from their tile and follow it where it disagrees with the straight line to the player by more than 45°, and wherever the straight step would run into a wall (a probe just past the body, so big enemies see walls too); elsewhere they walk the straight line, so movement in the open stays smooth. Chasers, chargers walking in or recovering, and bosses between attacks all path this way. Bodies wider than a tile (elites, bosses) read a second field whose walls are grown by one tile, so it leads them down corridors they fit through instead of along a wall's edge into its corner. Open areas use a direct chase.
- **Teleport-ahead:** an enemy that ends up far behind the player (more than 1.5 screen widths away) moves to the spawn ring ahead of the player. The horde stays around you instead of trailing behind.
- **Knockback:** a velocity impulse divided by the enemy's mass, decaying over a few ticks. It's tunable per weapon and globally.

### 5.7 Spawn director
- Each map has a **timeline** in data: bands of time, each with a roster of enemy weights and a density curve (target number of enemies alive), plus scripted events at fixed times (swarm walls, rings, elites, chests, the 10:00 boss, the 20:00 boss).
- The director keeps the enemy count near the density target. It spawns on a ring just outside the view and never spawns on screen. The logical view is 640×360, whose half-diagonal is about 367 px, so the ring sits at about 400 px (the half-diagonal plus a 32 px margin).
- The density target climbs until the late game passes 1,000 enemies alive. The `density` stat and Tide levels multiply it.
- **The three phases of a standard run** (brief §5.1) are timeline bands: 0:00 to 10:00 (build-up, ending in the first boss), 10:00 to 20:00 (pressure, ending in the harder boss), and 20:00 onward (overtime, if chosen).
- **The honest limit on "1,000+ on screen":** at 640×360, a 16 px enemy covers 256 px², so 1,000 of them cover about 1.1 times the screen's area. A thousand enemies *on screen at once* therefore means an overlapping mass, which is how this genre looks at its peak. Readability comes from separation (crowds read as a mass, not a single stack), smaller swarm enemies (8 to 12 px), and a contrast ramp that keeps the player and the hazards on top. The feel gate judges it. If late-game density turns to mush, the levers are, in order: fewer but tougher enemies (the density curve), smaller swarm sprites, and a "wide view" setting at 960×540 (integer ×2 at 1080p and ×4 at 4K, but letterboxed at 1440p).
- Scripted event types: `wall` and `ring` (swarmers fly straight through; anything else walks at you from where the line or ring stood), `elite`, `muster` (an elite captain past the spawn ring by the crew's radius and a ring of its crew around him, so none appear on screen, walking in together; the captain pays a boss chest: the elite event, brief §7, at 15:00 on the Drowned Docks as the Bosun's Muster), `boss`, and `chest` (a one-item chest on open ground a short walk away). Elites and bosses always find a spot on the ring, even with the player in a map corner. A map's timeline and overtime data are checked when the run starts.
- **Overtime:** after the 20:00 boss, the player picks Leave or Stay. Staying escalates density, enemy HP, and material yield every minute, per the map's overtime data, until the player dies or leaves from the pause menu.
- **The ground** (`sim/terrain.js`): a map's `layout` builds its tiles once, from its own seed. `open`, `rects`, and `scatter` (crate clusters) are for tests and simple maps; `docks` builds the Drowned Docks: a wharf with flooded slips in it (basins 4 tiles wide and 10 to 22 long, open wharf all round each, a footbridge across the long ones), sheds, crates kept off every edge, and a wreck beached in the far northeast. Any open pocket a walker couldn't reach from the start is filled in, so every open tile is reachable. The sim keeps only solid or open; `terrain.kinds` says what each tile is (boards, crate, water, roof, wall, hull, bridge, deck) for the run view, which picks each frame by its kind and neighbors (`render/viewstate.js groundFrame`).
- **Secrets:** a map's `secrets` are caches at set tiles. Each opens once a run when you reach it: its relic while you can take it (not owned or banished), otherwise one chest item, shown as a chest reel titled Secret cache. It's recorded in the run result (`secretsFound`), and meta adds `secret:<id>` to the codex, which unlocks what is keyed `unlock: 'secret:<id>'` (the Wreck Lantern) from the next run on. Nothing points the way: the cache glows faintly violet through the dark once you're near.
- **Short run mode:** a data flag compresses the timeline to 10:00 (bosses at 5:00 and 10:00) and scales rewards down.

### 5.8 Weapons: the pipeline
This is the most important design in the sim, because the brief requires runes and relics to change *behavior*, not numbers.

A weapon is a composition of three stages, all named in data:

| Stage | Types |
|---|---|
| **Emitter**: where and how it fires | `nearest` (auto-targets the nearest enemy), `facing` (movement direction), `radial` (N directions), `orbit` (bodies circling the player), `aura` (a zone on the player), `strike` (hits a random enemy on screen), `drop` (left behind at the player's position), `wave` (an expanding ring), `beam` (a line), `summon` (a minion with simple AI) |
| **Motion**: how the projectile moves | `linear`, `homing`, `boomerang`, `orbit`, `stationary`, `arc` (lobbed), `bounce` (off the screen edges), `chain` (hops between targets) |
| **On-hit list**: what happens on contact | `damage`, `knockback`, `status` (burn, slow, freeze, rot), `split` (N children), `chain` (N hops), `explode` (radius), `pull` (toward the player), `zone` (leaves ground effect), `light` (emits light for a moment) |

- Nothing is ever aimed by the player. `nearest` and `strike` are automatic targeting, which the brief allows. A `facing` emitter may bend its volley onto the nearest enemy within `assist` degrees of the facing direction (the Harpoon Chain uses 40°), because a stick pointed roughly at the crowd should hit it. The whole volley keeps the direction of its first shot, so it fans out evenly even if the player turns mid-volley.
- Shots, the player's and the enemies' alike, fly over obstacles (crates and rubble are low, and weapons in this genre ignore terrain). Only bodies collide with walls.
- **Runes are patches** on this composition. "Splits on hit" appends a `split` to the on-hit list. "Orbits you instead of firing" replaces the emitter and motion with `orbit`. "Fires backward too" adds a mirrored emitter. "Leaves burning ground" appends a `zone`. Each rune declares which emitters it's valid on, and invalid pairs are never offered.
- **Evolutions:** a maxed weapon, plus its partner passive at the required level (`passiveLevel` in data; gear affixes can lower it), plus opening a boss chest produces the evolved weapon, which is its own weapon definition. Hidden evolutions exist; the Library reveals partial hints.
- **Which runes fit:** a rune must be valid on the emitter the weapon has *now*, after the runes already in it (Orbiting turns a Flare Gun into an orbit, so Backfire no longer fits), and a rune that changes the emitter can only go in if every rune already there still fits the new one. Chests, placement, and runes carried through an evolution all use this rule, so no socketed rune ever does nothing.
- **Hit memory:** a shot remembers the last 8 enemies it hit, so a piercing or chaining shot never hits one twice, and pierce is capped at 8. A chain hop inherits everything the chain has hit. Each wave hits each enemy once as it passes, so every wave of a volley counts.
- **Test:** `tests/content.test.js` builds every valid weapon × single-rune combination at max level and runs each for 600 ticks, checking for crashes, NaN, and a weapon that never hurts anything. Each rune runs on the same seed and crowd as its bare weapon, and a rune whose damage comes out exactly the bare weapon's fails the gate (a rune that does nothing). It also runs every allowed pair of runes on every two-socket weapon (in socket order, by the rule above) for 120 ticks each. Both stay cheap enough for the gate; if content grows past that, the pairs move to a sampled gate test plus the full sweep in `tools/soak`. The full two-rune sweep runs in the workspace (`tools/soak`). As content grows, this is the test that keeps the combinatorial space from rotting without blowing the gate's time budget.

### 5.9 Stats and tags
- Stat IDs: `might` (damage), `area`, `speed` (projectile), `duration`, `amount` (projectile count), `cooldown`, `pierce`, `knockback`, `crit`, `critMult`, `moveSpeed`, `maxHp`, `regen`, `armor`, `magnet`, `luck`, `growth` (XP), `greed` (materials), `density` (enemy count; called "Curse" in Vampire Survivors, renamed here so it can't be confused with the Chapel's Curses), `revival`, `reroll`, `banish`, `skip`, `dashCooldown`.
- A modifier looks like `{ stat, op: 'add' | 'pct' | 'more', value, tags?: [...] }`.
- **The formula, used everywhere:** `final = (base + Σadd) × (1 + Σpct) × Π(1 + more)`, then caps from `data/tuning.js` apply (for example, cooldown can't drop below 10% of base).
- **Tag scoping:** a modifier with tags applies to a weapon that shares *at least one* of those tags. Player-level stats (move speed, max HP) have no tags. Passives and relics mostly scale tags, per the brief, so stacking a tag is a build.
- Weapon stats are recalculated only when the build changes (level-up, relic, rune), never every tick.

### 5.10 XP and the draft
- The XP curve lives in `data/tuning.js`.
- **The draft** (`sim/draft.js`) runs on the `draft` RNG stream:
  1. Candidates: level-ups for owned weapons and passives that aren't maxed, and new weapons and passives if slots are free. Relics are never cards (Phase 7, §10.8).
  2. Banished items are removed.
  3. A weighted draw without replacement produces 3 cards (4 with the hub upgrade).
  4. An early-run rule: until the player owns two weapons, at least one card is a new weapon when possible, so every build gets going. This is tunable.
  5. When everything is maxed, fallback cards appear (heal, coin).
- Each card shows its tags and how many of those tags the build already has. When a card is an evolution partner the player has researched, the card says so.
- Reroll, banish, and skip charges come from the profile (the Apothecary and the Lamp Post tree).

### 5.11 Chests, runes, and relics
- **Elites** drop a chest with 1 item.
- **Bosses** drop a chest that checks for evolutions first, then rolls 1, 3, or 5 items (weighted by luck) with a slot-machine reel.
- Chest items can be level-ups on owned items and **runes** (the player chooses which weapon's open socket gets it, which is a real decision moment).
- Relics never come from chests (Phase 7, Kevin): they come from Reliquaries, Lantern Night's vault, the Ferryman, and a map's secret cache (§10.8).
- The last boss's chest opens on the spot, before the stay-or-leave choice, so leaving right away can never skip it. The first boss's chest drops on the ground like any other.
- Each item in a boss chest is an evolution while any weapon can evolve, then an ordinary item, so a 3- or 5-item chest can evolve several weapons (as in Vampire Survivors).
- A chest never rolls more runes than there are open sockets they fit.

### 5.12 Characters and relics as hooks
- Unique character mechanics and relic rules are small functions in a **hook registry** (`sim/hooks.js`). Data names a hook ID plus parameters.
- The hook points are: `onTick`, `onLevelUp`, `onKill`, `onBossKill`, `onHit`, `onGemCollect`, `onHeal` (can transform healing, e.g. into shield), `onDash` (run once the tick's enemy grid is built, so a burst finds this tick's enemies), `onHurt` (a hit taken, a shielded one too), `onChestOpen`, and `modifyStats`. Gear's hook affixes and the arcana use the same registry (Phase 7).
- Examples from the brief: the Lamplighter's damaging light radius is an `aura` weapon that scales with level. The Tide Priest's no-healing rule is an `onHeal` that returns 0, and her 60-second wave is an `onTick`. The Drowned Man gets an extra weapon slot per boss killed through `onBossKill`.
- Every hook is deterministic and uses only sim APIs. Every hook in data must exist in the registry, and each hook lists the parameters it needs; the content test checks both.
- The Harpooner's weapons pull: her hook makes their knockback drag toward her instead of pushing away, plus an extra tug. What she hits is also **dazed** for `params.daze` seconds (0.4): it can't walk or act, and it deals no contact damage (it is still pushed out of her). Each hit restarts the daze at its full length; it never adds up. Bosses are immune, and so is an enemy in the middle of a warned attack (a crab winding up or dashing, a gunner aiming: `midAttack` in `sim/enemies.js`), because holding it would stop its attack's clock and it would strike after its warning had ended. Freeze follows the same rule, for bosses too (a boss warning or charging isn't frozen, and a charge, once warned, runs its course). This answers Kevin's point that pulling the crowd in means more hits (Phase 4): a bonus for standing still was tested first and dropped (§20 call 44; `tools/bots/harpooner-trials.mjs` plays the trials again).

### 5.13 Bosses and elites
- **Elite:** any enemy with the elite modifier gets more HP, a larger size, an outline, and a chest.
- **Boss:** an enemy definition with phases and attacks drawn from a pattern library: ground slam ring, charge line, summon wave, slow projectile fan, and hazard pools, plus each MVP boss's own: the Harbor Maw's **lure** (its bite's ring shows, and for the whole warning you're drawn toward it, slower than you walk, through `world.pull`, which a dash ignores; then it bites inside the ring; it starts only while the whole ring is on screen, and otherwise waits its turn, and ends with its own Maw) and the Tidecaller's **tide lanes** (rows of pools across where you stand, each row warning a moment after the last; stand between two rows). Every boss's attack data is checked by type when a run starts (`checkBossDef`): a lure slower than you walk with its ring able to fit on screen, tide rows far enough apart to stand between. **Every attack telegraphs for at least 0.8 s** with a clear shape (a pulsing ring or line), so the game stays playable while half-watching TV. Bosses get an HP bar at the top of the screen.
- Big bosses are **code rigs**: several sprites (body, jaw, tentacle segments) animated by code, which is how a small sprite pack produces big bosses. `render/rigs.js` holds each rig's layout (parts, pivots, what follows what); `render/rigpose.js` holds the pure pose function, driven by the boss's state (walking, which attack it is warning of and how far into the warning, charging) read straight from the sim (`rigInput`, which uses the sim's own warning time), and each rig's own light; `render/rigview.js` draws it. The atlas builder reads only the layout, so changing how a rig moves or glows never makes the atlas stale. The Harbor Maw is an anglerfish head: its jaw drops as a slam's warning fills, its fins spread for a summon, and its lure glows like a lamp in the light map. The Tidecaller is a hooded bell-ringer: its bell swings hard while it rings up a fan or a summon, the robe rises before a slam, and tentacles reach from under the hem before its pools, further before its tide lanes. The Maw's lure swells and flickers fast while it lures. The atlas builder draws each boss's resting pose as one frame too (for the death pop).

### 5.14 Events out of the sim
- The sim writes to a preallocated **event buffer** of typed arrays: a type plus six numbers (x, y, a, b, c, d) whose meaning depends on the type (`sim/events.js` lists them), with room for 8,192 events: hit, kill, player hurt, gem collected, level-up, chest, boss spawn, telegraph start, and so on. The headless runner clears it every tick; the game clears it once per rendered frame, which can hold several ticks.
- Render, audio, and the HUD read the buffer. Nothing they do flows back into the sim.
- The sim sends one event per hit. Render groups damage numbers per enemy over a few ticks (Phase 3), so a thousand hits don't become a thousand numbers.
- The last 1,024 slots are kept for events that matter (kills, hurts, level-ups, telegraphs). When the buffer is that full, low-priority events (hit numbers, status sparks, shot flashes, light pops) are dropped first and counted for the debug overlay.

### 5.15 RunConfig and RunResult
- **RunConfig** (from meta): seed, map, run mode (standard, short, or challenge), character, equipped gear, mastery perks and alt kit, resolved content pools, Tide level, chosen curses, chosen arcana, starting consumables, the prestige relic, reroll, banish, and skip charges, and the hub upgrades that affect a run. The sim checks it in plain words: the pools come all four (weapons, passives, relics, runes) or not at all (then everything, for tests and the bots), each id listed once, known, and one that can be drawn (never an evolution or a character's own weapon).
- **Arcana** (brief §5.3, unlocked later) is one run-wide rule chosen at run start, built as a hook like a relic but active from 0:00. **Consumables** (from the Apothecary) apply at run start (for example, an extra revival or a magnet pulse at 0:00). There is no active item button; dash stays the only active input, per the brief.
- **RunResult** (from the sim): time survived, how the run ended (died, left, or cleared), kills per enemy type, bosses killed and with what weapons, the highest level reached by each weapon, the tags in the final build, materials collected, damage taken, dash kills, secrets found, the feat evaluation inputs, and whether the tuning panel or its dev commands were used (`devTools`, which marks the save when the run is folded in, §15). It must be rich enough to evaluate every feat in data without rerunning anything.

---


### 5.16 Embers and Forms
- An **Ember** (`sim/ascend.js`) is a rare pickup: every boss drops one, a muster's captain drops one, and an elite now and then (`tuning.embers.eliteChance`, 15%). Like Nordic Ashes' ascension crystal, it changes one weapon for the rest of the run, with a choice. (In the code a Form is an "ascension", the Ember's choice; the player sees Forms.)
- Picking one up adds it to your Embers and, if a weapon you carry can still take a Form, stops the run for **Ascend** in two steps: the weapons that can (each with how many of its Forms it has), then the chosen weapon's three Forms, each labeled with its kind; Back returns to the weapons, and **Keep for later** keeps the Ember. A kept Ember is spent from the pause menu's **Ascend (N)** (a logged `{ kind: 'ember' }` decision queues the screen). A weapon with every Form taken leaves an Ember kept without stopping. The halt's view (`app/runlogic.js` `haltView`) gives each weapon all three Forms with `taken` and `why` (the runes that rule one out), so the screen shows them rather than hiding them.
- **Forms change how a weapon works**, one part each, so a weapon can hold all three of its line's at once and they combine in any order (`data/ascensions.js`, 8 lines × 3; the mechanics in `sim/forms.js`):
  - *delivery*, when and from where it fires: Salvo (a ring of 8 every 4th shot, counted in shots, each ring turned half a gap from the last), Eclipse (the orbs merge into one that grows with kills and bursts), Lunge (each dash throws four harpoons), Great Toll (one huge ring every 6 s, each kill brings the next sooner, by at most half the wait), Full Circle (the beam sweeps all round), Slick Trail (burning oil where you walk), Planted Rod (strikes fall around a rod you plant, 2 more at a time), Pyre (the flames gather in a pyre that erupts every one of them together);
  - *flight*, how its shots travel: Mortar (lobbed onto the thickest crowd, bursting where they land), Hunting Lights (orbs leave you to chase), Skewer (the first enemy hit is carried as a ram and bursts at the end), Breakers (waves roll in from the screen's edge, dragging enemies), Relay (the beam jumps enemy to enemy), Firebomb (each flask bursts into 4), Storm Front (each strike marches on away from you), Will-o'-Wisps (flames lure enemies toward them);
  - *payoff*, what a hit or a kill leaves: Hanging Flare (a flare hangs and rains sparks), Wards (a lantern stays where an orb kills), Tether (the harpoon sticks; its chain to you hurts what crosses it), Riptide (struck enemies are thrown and hurt where they land), Burning Glass (the beam sets enemies on fire, hotter each time it finds one again within 2.5 s, up to 3x; its own hits only, not a chain's hops or a pool's pulses), Fuel Line (touching pools link; a new pool sets the linked ones off), Static (struck enemies zap their neighbors), Vigil (each kill leaves a flame).
- A Form is built in up to four places, and no two of a line touch the same one: the pipeline as the slot is built (before the runes: a motion, an on-hit effect, a flag the emitter reads), the slot's numbers after its level (`formStats`: Eclipse's one orb, Great Toll's ring, Mortar's slower throw), when it fires (`formsTick`, `formsAfterVolley`, the emitters), and its kills (`formKill`, from `resolveDeaths`). A slot keeps its Forms in the order taken, a map of them by mechanic (`fx`), and their running state (`fs`: the Salvo's count, the Eclipse's growth, the rod, the pyre, how many marks and wards are out), kept through level-ups and the evolution. Effects that would fire per enemy hit fire once where they should: a Mortar or a Firebomb bursts where it lands (a Mortar with a Hanging Flare hangs one there too), a Storm Front marches from a strike's first hit. What a Form leaves doesn't feed itself: Hanging Flare and Burning Glass are on the parent's list only (`PARENT_ONLY_FX`), and a ward's kill (a zone's pulse: `killedByZone`) leaves no ward. Marks and wards are capped per weapon, so a crowd can't fill the zone pool. A shot spent any way (an Orbiting ring replaced by the next) ends as any shot does, so a Skewer bursts and a Tether sticks; a Tether whose hit killed sticks where the enemy fell.
- **Forms stack and survive**: more Embers take more of a line's three (each once), on the same weapon or another. A weapon's evolution keeps them (each line names the base weapon and its evolution). The HUD shows a violet pip on a weapon's icon for each, and Stats and the pause menu name them. An on-hit effect a Form adds joins the weapon's own of that type (`addEffect`, `MERGE`: amounts add, reaches take the larger, a chain's per-hop multiplier is never added, a slow is held to 80%).
- **Forms and runes never cancel each other** (the §5.8 rule extended): a Form's `needs` names a motion the weapon must have or must not have after its runes. A Form is offered only if it works on the weapon as its runes have made it (`ascensionWorks` on `runeShape`; the Forms screen shows one that doesn't as "Not with Orbiting"), and a rune fits only if every Form taken still works after it (`runeFits`: no Orbiting under a Skewer, a Mortar, a Salvo, or a Lunge; a Firebomb needs a flask that's lobbed). An Ember that finds the pickup pool full is picked up at once.
- The gate (`tests/forms.test.js`): each line has one Form of each kind, a mechanic `sim/forms.js` knows, and a name no weapon, passive, rune, or relic shares; each Form leaves its own mark on a scripted fight that no weapon without it leaves, alone and beside every rune that fits it; every combination of a line's Forms on its base weapon and its evolution runs, changes the fight, and turns no shot or zone away; and the targeted checks (Skewer's carry and burst, Lunge's four, Pyre's eruption, Burning Glass's steps and reset, Fuel Line's linking, the numbers Forms change, rune refusals).

## 6. Rendering (`src/render/`)

### 6.1 Resolution and scaling
- The world renders into an offscreen **640×360** canvas with nearest-neighbor filtering, then scales up by a whole number: ×3 at 1080p, ×4 at 1440p, and ×6 at 4K. All three are exact. Odd resolutions letterbox with fog-colored bars. Settings offer an optional "fill screen" mode that isn't pixel-perfect.
- Everything in the world, including rotated projectiles, is pixel-correct at that resolution. There's no mixing of pixel sizes.
- **Smooth camera:** the offscreen canvas has a 1 px margin (642×362), and the final upscale is shifted by the camera's sub-pixel remainder. Slow camera moves don't stair-step on high-refresh monitors.

### 6.2 Layers (bottom to top)
1. Ground: the tiles in view (about 1,100) in one ParticleContainer, rebuilt only when the camera crosses a tile. (Phase 0 planned pre-baked chunk textures; the tile layer measured cheaper and needs no texture memory per chunk. Phase 3 change, §20 call 30.)
2. Decals: scorch marks and splashes (pooled, fading)
3. Blob shadows: one ParticleContainer
4. Gems
5. Enemies: one ParticleContainer, no y-sorting among themselves (overlapping swarms read fine in this genre). A v8 ParticleContainer holds lightweight Particles that must share **one texture source**, so every enemy frame, flash silhouette, outline, and ramp variant lives on one atlas page (up to 4096×4096, which holds about 65,000 sprites at 16 px). The same rule applies to the gem and projectile container and the effects container. Phase 2 prototypes one container with tint and a per-frame texture swap before building on it.
6. Projectiles
7. Elites and bosses (boss rigs), y-sorted against each other
8. Effects: sparks, embers, death puffs (one ParticleContainer, additive blend, 4,096 pooled particles)
9. **Lighting:** a light map at half resolution (321×181, covering the 1 px margin) with smooth filtering, cleared to the map's ambient light. Lights (the player's lamp, fire and light shots, burning ground, hazard pools, chests, explosions, gem glow; at most `feel.light.maxLights`) draw additively as soft radial sprites from one glow texture. The light map multiplies over the world. The result is soft light over crisp sprites, and the cost is almost nothing at this resolution.
10. **Fog:** drifting tileable noise (a generated texture, anchored to the world) drawn into a second half-resolution texture, with the same lights then *erased* out of it, so its density drops wherever there is light. **Light literally pushes the fog back** in runs, which is the theme. v1 needs no custom shader. In the hub, a fog mask texture driven by restoration state does the same thing.
11. **Warnings** (boss attack shapes, charger and gunner lines, hazard pools filling in) are drawn after the light and fog, unlit, so a hazard is never lost in the dark (§20 call 35).
11b. **The player**, drawn over all of that, unlit (her lamp lights her spot anyway), so she is never lost under a stack of warning shapes or in the fog (§20 call 46; found in the Phase 4 screenshot review, where ten crab charge lines at 10:00 hid her completely).
12. World text: damage numbers built from digit sprites in the atlas, grouped per enemy over `feel.numbers.groupMs`, capped at 150 on screen, and switchable off.
13. HUD: drawn at 640×360 in its own layer, so it never jitters with the camera or the shake. It shows HP (and shield), the dash cooldown, the XP bar, the timer, level, kills, weapon and passive icons with levels (a violet pip for each Form), the minimap, the boss's health, overtime, and short notices. Materials found are on the pause menu and Stats, not the HUD (they drew the eye from the fight for a number that only matters after the run). Its text is a code-drawn 5×7 pixel font in the atlas, at the world's own pixel size. Where each piece sits is data in `render/hudmodel.js` (`HUD_LAYOUT`, `placeHud`); the view test places every piece at its longest text (every weapon and passive slot, the longest boss name and notice), at every minimap setting, and fails if any two overlap or one leaves the screen.
    - **The minimap** (`render/minimap.js`, its model `render/minimapmodel.js`), part of the HUD: top right under the kills. The ground is a texture a pixel a tile, filled in as you see it: a tile shows once it's been on screen (`revealView`, from the run view's camera, which is kept inside the map), so the map is yours to uncover and the wreck stays a secret until you've been near. It keeps uncovering with the minimap off, and newly seen ground goes to the GPU at most every 150 ms. It fades to a quarter while you stand under it (a corner of the map pins the camera, and you can end up beneath it), and its marks are clipped to its box. Marks, each its own shape (never told apart by color alone), drawn materials first, then the other drops, elites and bosses, and you on top (your slot is always kept): you a ring with a dot, a boss a filled diamond and an elite a hollow one (red), a chest a hollow box wider than tall (amber), an Ember a big plus with a dark middle (violet), food a small plus (green), a magnet a U (blue), a material a 2 px dot (rare ones brighter) (`MARK_SHAPES`); never the experience gems or ordinary enemies. Settings: Minimap Nearby, Whole map, or Off; size Small (72 px) or Large (120 px). Nearby is whole pixels a tile (Small 1, 72 tiles across, about two screens; Large 2, 60 tiles), its corner on a whole pixel, so it never shimmers as it slides; the whole map is smaller than a pixel a tile and is smoothed.

### 6.3 Feel toolkit
Every value below lives in `data/tuning.js` (the render-only ones under `feel`, which the sim never reads) and appears in the tuning panel.
- **Hit flash:** the atlas builder generates a white-silhouette version of every enemy frame, and the renderer swaps to it for a few frames. It stays in the same atlas, so batching isn't broken.
- **Knockback:** visible displacement, from §5.6.
- **Hit-stop:** from §5.1, per event type.
- **Screen shake:** a trauma model (shake = trauma², decaying), set per event type and switchable off.
- **XP vacuum:** gems accelerate toward the player on an easing curve, with a sparkle trail and a rising pitch when many are collected in a row.
- **Death:** a pop plus particles plus a short scale-down. Big kills get extra.
- **Squash and stretch** on hit and on spawn.
- **Chest reel:** a slot-machine animation with sound and light.
- **Level-up:** the sim freezes, a light burst plays, and the cards appear. Inputs are ignored for 300 ms, so a dash press can't accidentally pick a card.
- **Warning pulse:** an enemy about to act (a charger winding up, a gunner aiming) pulses warm and swells, on top of its warning line.

### 6.4 Procedural animation
Free packs are often single-frame. Enemies get code-driven life: a bob (vertical sine with a random phase per enemy), a lean in the movement direction, a horizontal flip on direction change, squash on hit, a telegraph pulse (scale plus tint), and spawn and death tweens. Multi-frame animation is supported: an entry with `frames` in the manifest becomes `<id>`, `<id>@1`, ... in the atlas (with flash and elite versions of each), the table lists it under `anims`, and the run view steps each enemy through its frames at the entry's `fps`, starting from its own phase so a crowd never flaps in step (the gull's wingbeat, the crab's scuttle); a frozen or dazed enemy holds its frame. The player hops a pixel every other step while walking (`feel.bob.stepsPerSec`). Bosses move by their rigs (§5.13).

These motions run on **sim time** (the world's tick), not the render clock, so the actors stand still whenever the sim does: under a level-up, a chest, the pause menu, and a hit-stop. That covers the bob, the frames, the hop, the rigs, the daze wobble, the warning pulse, and the status flickers; a frozen or dazed enemy stops on one frame (its own, by its phase). The feel effects that should carry on through a hit-stop stay on the render clock: hit squash, particles, the screen shake, and the fog's drift. The pieces are pure functions in `render/viewstate.js` (`animFrameIndex`, `stepHop`, `dazeWobble`, `simSeconds`), tested in Node, and a source check keeps the run view calling them with each enemy's own phase. Status tints show what's happening to an enemy: the warning pulse, then frozen, burning, slowed, rotting. A dazed enemy isn't tinted (dimming it would break its contrast, §16.4); it reels instead, a quick sway on its own phase.

---

## 7. Input and controls (`src/input/`)

- Actions are abstract (`move`, `dash`, `confirm`, `back`, `reroll`, `banish`, `skip`, `pause`, `tuning`, `debug`), and bindings map devices to actions.
- The Gamepad API is polled once per frame. Movement is sampled once per sim tick into an **InputFrame** (move x and y quantized to 8-bit signed integers, plus a button bitmask). That is what gets recorded for replays.
- The left stick uses a radial deadzone (tunable, 0.2 by default). The d-pad also moves.
- **Controller type:** a gamepad ID containing Sony's vendor ID `054c` or "DualSense" shows PlayStation glyphs; anything else shows Xbox glyphs. The glyphs are drawn in code. Steam Input can disguise a DualSense as an Xbox pad, so Settings has a "Button prompts" override (Auto, PlayStation, Xbox, Keyboard).
- A Sony pad whose `mapping` isn't `"standard"` (a DualShock 4 or DualSense over DirectInput) is read through a remap table, hat switch included. Any other pad is read as if standard. On Windows, Chromium and Electron report every XInput pad as standard, so that case is rare.
- Disconnecting the controller in use pauses the game, even with a spare pad still plugged in; reconnecting it, or using the keyboard, the mouse, or the other pad, resumes. Pulling out a pad nobody was using changes nothing. Losing window focus pauses the game. (`src/app/pauses.js`, tested with the real input module and loop.)

| Action | DualSense | Xbox | Keyboard |
|---|---|---|---|
| Move | Left stick or d-pad | Left stick or d-pad | WASD or arrows |
| Dash | R1, or ✕ during a run | RB, or A during a run | Shift, or Space during a run |
| Confirm | ✕ | A | Enter |
| Back | ○ | B | Esc |
| Reroll (level-up) | □ | X | R |
| Banish (level-up) | △, then pick a card | Y, then pick a card | B, then pick |
| Skip (level-up) | Hold L1 for 0.5 s | Hold LB | Hold Tab |
| Pause | Options | Menu | Esc or P |
| Tuning panel | Hold Create for 1 s | Hold View for 1 s | F1 |
| Debug overlay | none | none | F3 |

In the harbor, ✕, A, and Space are confirm only (walking up to a door and pressing it must not also dash you away from it); the dash there is R1, RB, or Shift (`sampleFrame({ dashOnly: true })`).

Skip is a hold so it can't happen by accident. The tuning panel is a hold on one button (Create, or View on Xbox), not a two-button chord, so it can never also fire Pause (changed in Phase 1; see §20).

---

## 8. UI (`src/ui/`)

- **The world and the HUD are Pixi. Menus are DOM overlays** above the canvas: level-up cards, pause, results, hub building panels, research tree, codex, bestiary, settings, and the dev panel. DOM makes text-heavy screens far faster to build and keeps text crisp at native resolution. Atlas icons appear in the DOM through CSS with `image-rendering: pixelated`.
- **Controller navigation framework** (built once in Phase 3, because the feel gate is played on a DualSense and needs working level-up, chest, pause, and tuning screens; every later screen uses it): every interactive element registers with a focus system. Directional input moves focus to the nearest element in that direction, with explicit overrides where layout needs them. Focus is always visible (a thick, high-contrast frame). Back always backs out. The mouse also works, and hovering moves focus.
- Menus are sized in game pixels (a CSS variable `--u` is one pixel of the 640×360 view), so they scale with the game and stay aligned to it. The screens: title (with Credits), level-up (reroll, banish mode, hold-to-skip with a fill), chest reel, rune placement, the overtime choice, Ascend (an Ember's choice in two steps: a weapon, then one of its three Forms, each labeled How it fires, How it flies, or What it leaves, with any taken or ruled out by a rune shown and marked; or Keep for later; §5.16), pause (with the build, the materials found this run, Stats, Ascend (N) when a kept Ember can be spent and nothing else is waiting, and Save bug report), Stats (your character's numbers, what reaches every weapon, each weapon's numbers with its DPS (its Total Damage over the time since it was taken) and Total Damage, its runes and Forms, the materials found, and the passives and relics you carry), run end, settings, confirmations, the error screen, and the tuning panel. A first run also shows How to play in the corner for its first seconds. Menu sounds come from `data/sfx.js`.
- **Visual rules** (Kevin's standing UI preferences apply here): dark panels, 1 px pixel borders, square corners, colors only from the game palette (`data/palette.js`; a test checks `ui.css` against it), one bundled pixel font (Jersey 10, SIL Open Font License, in `src/ui/fonts/`), and plain labels, worded as `docs/WRITING.md` says (the genre's stat lines and labels; `tests/voice.test.js` checks it). The title of a screen is the name of the thing. No cream or paper backgrounds, no serif type, no small-caps labels, no rounded pill buttons, and no gradient buttons. This game must not share a look with Kevin's other apps.
- Accessibility toggles: screen shake, damage numbers, flash reduction (caps full-screen flashes), and telegraphs that use shape as well as color.

---

## 9. Audio (`src/audio/`)

- Sound effects are ZzFX parameter arrays in `data/sfx.js`, rendered once at boot into audio buffers, so playback is cheap. The generator is ZzFX's own sample function, vendored into `audio/zzfx.js` with its MIT notice (the npm package opens an AudioContext when imported, which the game doesn't want). Weapons name their fire and hit sounds in data.
- **Voice limiting:** each sound has a maximum number of simultaneous voices (hits: 4 with pitch variation; the gem pickup: 1, with pitch rising through combos) and a global cap of 24. Without this, 1,000 enemies make white noise.
- Three volume buses: master, music, and SFX. Music is optional, must be free-licensed, and gets credited.
- In Electron, autoplay restrictions are turned off. On the web, audio starts on the first input.

---

## 10. Meta-progression and the hub (`src/meta/`, hub scene)

### 10.1 The profile
The profile is the save's core (schema v3 since Phase 7, §12.2):
- material counts
- building levels
- research (completed, and active with runs remaining; how many can run at once comes from the Library's level)
- the Lamp Post's upgrade ranks
- characters (unlocked, mastery XP, perks)
- gear (the items held, what's worn in each slot, the next item's number, and a count of re-rolls)
- consumables and rune stones held
- bestiary kill counts, and the milestones claimed
- codex discoveries
- feats completed and found, challenge runs won
- Tide levels unlocked and the one last chosen, and the gate's other last choices
- prestige cycle and prestige relics
- lifetime stats
- dialogue and first-time flags

Everything that can be *derived* is derived, never stored (`src/meta/state.js`, `next.js`):
- `resolveContent(profile)`: what's in the weapon, passive, relic, and rune pools, which characters are available, and what the harbor can make or sell (gear recipes, consumables, arcana). One source of truth: each content item's `unlock` says where it comes from ('starter', 'research:<id>', 'building:<id>:<level>', 'secret:<id>', 'feat:<id>', 'challenge:<id>', or 'evolution' and 'innate', never in a pool), and the content test checks every key resolves
- `researchSlots`, `researchTier`, `treeTier`: what the Library's and the Lamp Post's levels open
- `nextAffordable(profile, 3)`: the three purchases closest to affordable, across building levels, research, upgrade ranks, and Phase 7's goals (gear not made yet, a worn item's next tier, a perk its character has the rank for, a consumable none of is held; re-rolls and rune stones, bought again and again, are left out)
- `buildingStage(level)`: which visual stage to draw
- `revealedFog`, `hubPeople`, `shownProps`, `npcLine`: what the harbor shows for a profile (the fog's cleared regions, who is out and where, the props, what a keeper says)
- `completion(profile)`: the completion percentage on the title screen (building levels, upgrade ranks, research, the codex, feats, challenge runs, and Tides)
- `masteryOf`, `tideAvailable`, `cursesAvailable`, `heldOf`, and what each Phase 7 building opens (`levelEffect`)

A save from another build is fitted on load (`meta/reconcile.js`): anything it names that this build doesn't know moves to `orphans` (kept, never deleted, restored if the content comes back), and counts out of range are brought back in.

### 10.2 Run lifecycle
1. Run setup at the gate: the character, then (once the harbor opens any) the kit, the mode, the Tide or a challenge, curses, an arcana, consumables, and a rune stone (`app/setup.js`); worn gear and trained perks come along
2. `RunConfig` goes to the sim
3. `RunResult` comes back
4. `applyRunResult(profile, result)` returns the new profile plus a **change list**: materials gained, research advanced or finished (with what it unlocked), a note when projects are running but the run didn't count, new codex entries, bestiary milestones, a new longest run, and Phase 7's: Sea Glass sold, a mastery rank, the next Tide opened, a challenge won, feats done or found. It runs the moment the run ends, and the profile is saved then, so closing the game on the end screen loses nothing
5. The run's end screen (the run's numbers), then **Return to harbor** (or **Run again**, straight into the next run)
6. The results screen ("Results"), over the harbor: how the run ended, what came home, the news, and the next three things you can nearly afford; **Start run** goes straight to the gate. After Run again, every run since the harbor reads as one visit: the materials add up, each finished project and milestone is said once, and the heading says how many runs it was (`app/hublogic.js mergeRuns`)
7. The harbor

`applyRunResult` is a pure function with heavy test coverage.

- **Materials on death:** the player keeps everything collected. Dying costs time, not progress, which fits the brief's "does this make Kevin want to do one more run?" test. (Builder's call; see §20.)
- **Research progress:** each finished run advances active research by one run, if the run **reached 5:00 or killed a boss**. That blocks instant-quit farming without punishing a real attempt. (Builder's call.)

### 10.3 Materials and the Graveyard Keeper loop
- Every map drops its own materials (from the brief's table). Elites and bosses drop the rare ones. The greed stat multiplies drops.
- Recipes deliberately mix materials from different maps, so a goal in one system points at a run somewhere else.
- **Content test:** every material has at least one source, and every cost is obtainable using only content unlocked before it's needed. A dead-end economy fails the build. A later map's materials (the Salt Marsh's, the Sunken Chapel's) are in the data before their map is, with no source yet: the test holds every built map's drops to a use, every cost to a built map's drops, and the MVP harbor to map 1's alone; a later map's materials join the check when their map is built.
- **The pacing simulator** (`tools/pacing/`) uses material yields measured by the bots to simulate hundreds of runs with a greedy buyer, and reports hours to each milestone. Starting targets, all for Kevin to adjust:

| Milestone | Target |
|---|---|
| First building level | End of run 1 |
| Something new in the hub | Every 1 to 2 runs early on, every 3 to 4 later |
| MVP hub fully restored (3 buildings × 5 levels) | 6 to 10 hours |
| Lighthouse lit (v1.0) | 60 to 80 hours |
| Unlocks still arriving | Past 100 hours, counting Tide 20, mastery, and prestige |

The report says what its hours stand on before it gives them: the yields are bot runs (one character, the three archetypes in turn, each run lasting until the bot dies, clears the map after the 20:00 boss, or reaches 25:00), the bots outlast a new player, the range is the spread of draws from those runs rather than between players, yields don't grow with the player except for greed (the upgrades' greed through the sim's own stat formula), 1.5 minutes in the harbor per run, and the buyer's order (building levels, then research, then upgrades, the cheapest first). It says what its numbers are: each column's own median (the players' runs to a milestone, and their hours, so a row's two needn't be one player's), and the 10th to 90th percentile of the players' hours. Each milestone with a target says met or missed, on the median, and a milestone some player never reached is missed; "something new" counts building levels and finished research, not upgrade ranks, as the runs a window spans over the runs in it that brought something (pooled over the players, so a dry stretch at a window's end counts in that window); the early window is runs 1 to 10 and the later one runs from run 11 to each player's own last new thing (the report names where that is for the median player). "The MVP harbor" is the MVP buildings (`META.mvpBuildings`), so buildings a later phase adds never move it. A sensitivity line gives the MVP harbor's hours if every run were like the shortest third measured. The yields are kept in the repo (`tools/pacing/yields.json`) with a fingerprint of the measuring code and everything it imports (the sim, the data, the meta layer), and a report on yields measured on other code says so.

Phase 5's reading (`tools/pacing`, 40 players on 12 bot runs from a fresh profile, averaging 21.7 minutes: 1 cleared, 6 died, 5 still going at 25:00): the first building level at the end of run 1 (met), the Harpooner at run 2, the first research at run 2, something new every 1.2 runs over the first 10 runs (met), the MVP harbor fully restored in 7.1 hours (5.6 to 8.6; met). If every run were like the shortest third measured (12:53 to 19:01, all deaths), the MVP harbor takes 17.7 hours: that is the side real play will fall on until the costs are tuned to Kevin's own runs. Every 2.0 runs over runs 11 to 18 (where the median player's new things end) misses the long-game target (sooner), but the MVP harbor holds 22 new things over about 18 runs; the later target is for the whole game (§20 call 59). A fresh profile's pools hold 42% of the run content (10 of 24; §20 call 60).

Phase 7's reading (12 bot runs averaging 19.4 minutes: 4 cleared, 6 died, 2 lasted to 25:00): the MVP harbor in 9.4 hours (6.8 to 10.8; met), now that the greedy buyer also spends on the six Phase 7 buildings (each has a row of its own; the whole harbor of nine takes about 13.5 hours, the Chapel last); all research in 10.3; something new every 1.1 runs over the first 10 (met) and every 1.6 runs after, to run 39. The simulated player doesn't buy gear, perks, or consumables (they don't change what a measured run brings home), so those hours are the town's, research's, and the upgrades'. The shortest third (9:01 to 16:01, all deaths) would take 54 hours to the MVP harbor. A fresh profile's share is 34% (12 of 35).

### 10.4 The hub scene (built in Phase 5)
- **The map** (`data/hub.js`, 60 x 36 tiles): the town between the forest and the sea, around the square where the one lamp still burns. Building plots with their doors, the ruined plots of the buildings to come (Phase 7, and the Lighthouse in Phase 10), the fog's regions and the milestone that clears each, the keepers' posts and walks, the waiting spots on the square, the pier and the boat's route, the gate, and the props that appear as the town comes back. The content test checks it all fits: every door and the gate reachable from the start and with every prop out, every walk and arrival path straight and open when it's used, props out of everyone's way, and at every mix of building levels each building and ruin either clear with clear ground all round it or in the fog with fog all round it (the fog's soft edge is a tile wide, so the tile of margin keeps it off the building: never half fogged).
- **Walking** (`hub/world.js`, pure): the run's movement and dash (distance and time), at your character's speed; only the dash's cooldown is the harbor's own (0.9 s). You walk as the Lamplighter (`hub.avatar`); the other characters you have wait on the square. The fog is a wall: you can't walk into a region that hasn't cleared. Props and the small lamps (the gate's, the pier's) are solid; a prop that appears where you stand moves you to the nearest open tile, and one that only reaches your edge pushes you clear of it at once.
- **What's in reach**: the nearest door, the gate, or person within 14 px. Confirm opens the building's panel (restore its next level, and the Lamp Post's upgrades, the Library's research, or who comes back to the Tavern), the gate's screen (choose who sets out), or a line in a speech bubble. In the harbor ✕ (A, Space, Enter) only confirms; the dash is on R1 (RB, Shift). The pause button opens the harbor's menu (set out from anywhere, settings, the title) and closes it again.
- **In a panel**, something you can't do yet (short of materials, the Library busy, a tier not open) still takes focus and a press: it shows dimmed with the reason under it, and pressing it says the reason with the menu's "no" sound. A purchase keeps your place: the same row stays focused and the list doesn't scroll.
- **Five visual stages per building**, after the ruin: 1 a scaffold goes up over the ruin, 2 the roof with the windows boarded, 3 lit windows, 4 the keeper at the door with a sign and a lantern by it, 5 fully alive (window boxes, chimney smoke, the keeper walking the streets). Each stage is the pack's building (Tiny Town tiles in a layout) with the stage done in code (§16): a ruin is the building looked down into with its roof gone.
- **Level-up ceremony**: the camera pans to the building (0.7 s), the new stage rises over the old from the ground up with dust along the line while the fog peels back from its streets (1.4 s and 2 s), the keeper steps out and the props appear, a banner names what the level brought, and the camera comes back. Confirm or back skips it; what it leaves behind lands at once. Set pieces queue: a level that brings a character plays its ceremony and then the arrival.
- **Arrivals by boat**: the camera finds the boat out in the fog, its stern lantern showing through; it sails the harbor's route and ties up with its bow at the pier's edge, the newcomer, standing in the bow, steps off from where she stood (the walk starts on the boat's deck, at the height she was drawn, so nothing jumps), walks up to the square, and waits there from then on, facing the square's middle (her waiting figure takes over on the tick she stops walking, so she never blinks out). While she's in the boat she is drawn over the fog with it, lit as the light map lights the spot she's in where the fog is clear and in the boat's shade where it's thick; stepping off, she's drawn over the boat as well as under the light map while she's in front of it (the hull drawn again over her feet, so its bow never covers her), and that figure fades out over her next few steps (`look.stepOffFade`), so her shade carries straight on. Every later arrival reuses it.
- **Over the harbor** (DOM, `ui/hubhud.js`): your materials (the ones the harbor asks for, top left), the **next three you can nearly afford** (bottom left, clear of the buildings up the hill and of the page's status notice) with how close each is and what's short, the prompt over what's in reach, speech bubbles, the banner, and how to skip a set piece. A corner panel fades while you walk under it.
- **The guide for a new player** (`meta/guide.js`, `ui/hubhud.js`): one goal across the top and a marker: a bobbing triangle where the target's prompt would show (over the gate's sign, the lamp, a door), or at the screen's edge, slid clear of the corner panels and the goal line. Off screen it follows the walk there (`hub/map.js routeTo`: where the route leaves the screen), so it never points through the fog. A target on screen but under a corner panel gets an arrow just past the panel, pointing at it. Once the target is in reach its prompt takes over. With no run yet: go to the gate at the bottom left of town. After a run, with the Lamp Post still a ruin: restore it, or, home with too little for it, go back out through the gate. Then it's gone (Next up says the rest). A first run also shows How to play in the corner for its first `feel.firstRunTipsSec` seconds (40: move, dash, weapons fire on their own, gems level you up, survive); it fades while you stand under it, as the minimap does.
- **Walking off the quay** at the gate (its row or the one below, `timing.walkOff` seconds, 0.15, pushing west against the map's edge) opens the gate's screen, as confirm at the gate does. It fires once a push: only a real frame with west let go arms it again, and while a screen is open the scene steps the harbor with no frame, so backing out of the gate with the stick still held west doesn't reopen it.
- **Night and fog** (`render/hubview.js`): a light map multiplies the town down to a blue dusk (lighter than 0.5.1's, since 0.6.0: Kevin wants a dingy town where what's cleared is easy to see); the town lamp's pool grows with each Lamp Post level; lit windows, door lanterns, the gate's lamp, and the pier's lamp glow; the fog over uncleared regions is thick, soft-edged (a texel a tile, scaled up smooth), ragged where it meets clear ground (a fog tile there thins and a clear one takes a little fog, each by its own hash, never on a building or the ring around it), and drifts. The fog is drawn whole (a fill at the look's thickness, the drifting wisps over it) and then erased by how clear each tile is, so a tile shows its density times the thickness, a region peeling back thins in step with its fade, and the ragged edge shows as tuned. A boat coming in is drawn over the fog and the light map: where the fog is clear it's lit as the light map lights the water at its middle (its own lantern and the pier's lamp with the rest, as its newcomer is, so she never reads brighter than her boat), and out in the fog it keeps its own shade (never brighter than the night's, darker the thicker the fog, read smoothly between tile middles as it's drawn); it rises and falls on the swell with its lantern. How it all looks is data (`HUB_TUNING.look`, on the harbor's tuning panel, §15): the lights and the fog, the flicker's two waves, the boat's halo and bob, the camera's lift, a prop's pop, and the dust and smoke. What each building shows during a ceremony, how its lights come up, the lamp's swell, the light map at a point, and an arrival's boat and newcomer are pure and tested (`render/hubtiles.js`), and the view itself runs in the gate on Pixi's own scene graph, its drawing checked part by part against them (`tests/hubview.test.js`). Everything that moves (you, the people, the camera, the boat, a newcomer walking up) is drawn between its last two ticks.
- NPCs speak short lines keyed to milestones (`data/npcs.js`): the newest line that applies.
- **MVP buildings: the Lamp Post, the Library, and the Tavern.** The Lamp Post opens the capped stat tree, one tier a level. The Library runs research, which is what makes materials point at the next thing. The Tavern brings the Harpooner (level 1) and the relics (levels 2 to 5). (Builder's call.)

### 10.5 Buildings, materials, and when each arrives

Starting material assignment (a builder's call; each content pass can adjust it):

| Source | Materials |
|---|---|
| Every map | Coin, Oil |
| The Drowned Docks (map 1) | Timber, Rope, Drowned Pages, Rum; Iron from elites (salvage) |
| The Salt Marsh | Marsh Herbs, Salt Glass |
| The Sunken Chapel | Bone, Candles |
| The Cliff Lighthouse and the Reef | Their own rare materials, set in their content passes |
| Elites and bosses everywhere | Map Scraps, plus each map's rare material |

With this assignment, **everything the three MVP buildings need drops on map 1**, so the MVP economy has no dead ends. With a single map, the MVP proves the brief's "materials point at the next thing to build". "Where to run next" arrives with map 2.

| Building | Built in | Restores with | Opens |
|---|---|---|---|
| Lamp Post | Phase 5 | Oil | Capped stat tree; Wayside Lamps light faster (levels 3 and 5); it clears the fog from the six Phase 7 plots |
| Library | Phase 5 (basic), Phase 7 (full tree) | Drowned Pages | Research slots and tiers (tier 4 at level 5), evolution hints |
| Tavern | Phase 5 (characters), Phase 7 (mastery, feats) | Coin, Rum | Characters, the feat list (level 1), mastery training and kits (level 2), the relics |
| Docks | Phase 7 | Timber, Rope | The Ferryman in every run (§10.8): 2 relics on sale from level 2, cheaper at 3, a faster stock at 4, better relics at 5. Each map's boat joins its levels when that map is built |
| Smithy | Phase 7 | Iron, Timber, Rope | Gear crafting and tiers (up to 5), affix re-rolls (level 3), rune stones (level 4); the 5th and 6th gear slots at levels 3 and 5 |
| Chapel | Phase 7 | Drowned Pages, Oil | Tides 1 to 10 (2 more a level), the curses (one more a level), a wider Fog Bell ring (level 3) |
| Market | Phase 7 | Coin | Trading at a deliberately bad rate (better at levels 3 and 5); buying leftover Sea Glass as Coin (levels 2 and 4) |
| Apothecary | Phase 7 | Rum, Oil | Consumables, reroll, banish, and skip charges among them; 1 to 3 a run |
| Cartographer | Phase 7 | Map Scraps, Drowned Pages | Tasks on the minimap from 0:00, bestiary rewards, challenge runs, short runs, secrets on the minimap |
| Lighthouse | Phase 10 | Everything | The endgame and Prestige |

Phase 7 builds every building's system thinly, which already meets the v0.5 column's 7 buildings. Content passes fill them in. With one map built, the six restore with map 1's materials (the content test holds every cost to a built map's drops); Salt Glass, Candles, Bone, and Marsh Herbs move into their costs as their maps arrive. The six stand in the fog until the Lamp Post clears it: the Docks from the start, the Chapel at the Lamp Post's level 3, the Smithy and the Apothecary at 4, the Market and the Cartographer at 5 (a building in the fog can't be restored: `Requires Lamp Post Lv 4`).

### 10.6 Details of the Phase 7 systems
Each building's purchases are pure functions in `src/meta/workshop.js` with a `whyNot...` twin the panel shows (§10.4: a refusal is a label), returning `{ doc, changes }` as `meta/actions.js`'s do; nothing there is random the way a drop is (what a new item rolls and what a re-roll offers come from a seed of the item and the profile's own counters, so a reload never rerolls an offer).
- **Research** (the Library): 9 more nodes, tiers 1 to 4, open the gear recipes, the relics, the arcana, and more of the Library's tree. Unchanged otherwise (§10.2).
- **Equipment** (the Smithy, `data/gear.js`): six slots, the brief's four (Lantern, Coat, Boots, Charm) and a Ring and a Pendant at the Smithy's levels 3 and 5. A recipe is opened by research, a challenge, or a feat, and costs materials. An item is a tier (1 to 5) and its affixes: the recipe's own first, one more at tier 1, a third at tier 3. Affixes are of four kinds, and every recipe's own is one that changes the build (brief §6.3), never a flat stat: a **build** affix is a number a tag's weapons fire with (`+1 Projectile (Fire)`, `+1 Pierce (Steel)`), the same at every tier; a **hook** affix is a rule with its own code in `sim/hooks.js` (`Dash leaves burning oil`, `Level-ups send out a wave`), its listed params grown by the tier; a **rule** affix is a number the run is built with (`Level-ups offer 4 cards`, `Evolutions need 1 less passive level`), only on the small things you carry; a **stat** affix is a passive's modifier times the tier (×1 to ×3). A tier up costs the recipe times the new tier. A **re-roll** (level 3) picks one affix past the recipe's own, pays materials times the tier, and chooses from 3 offered (never the recipe's own, never one already on the item); the offer holds until one is taken. There is no random drop grinding. Worn gear goes into every run (`gearForRun`): its modifiers, its rules once each, its hooks once each at the best tier worn (`RunConfig.gearHooks`).
- **Rune stones** (the Smithy, level 4): a rune you've found, cut for materials, held, and placed in a weapon at 0:00 of a run you take it into (the run opens on the rune's screen).
- **The Market:** a fixed table: 5 commons for a common, 30 for a rare, a rare for 3 commons, and a rare for a rare at the common rate (5), better at levels 3 and 5 (4, 24, 4; then 3, 18, 5). It deals in map 1's materials. The next-3 list counts only materials in hand (call 84). From level 2 it buys the Sea Glass left at a run's end as Coin (half a Coin each, then one).
- **The Apothecary** (`data/consumables.js`): consumables bought before a run and spent as it sets out (`startRunProfile`), applied at 0:00: stat modifiers (a revival, XP, Max HP, Pickup Range), extra reroll, banish, and skip charges, and starting Sea Glass. One slot, two at level 3, three at level 5.
- **The Chapel** (`data/tide.js`): Tides 1 to 10 and 5 curses. A Tide multiplies enemy health (bosses too), damage, numbers, and speed, and adds to the materials a run brings home; clearing the map at the highest Tide opened opens the next, and the Chapel's level caps which can be chosen. A curse is a modifier list or a multiplier (Hunger: no food drops) plus its own share more materials. Both are chosen at the gate.
- **Arcana** (`data/arcana.js`): one chosen at the gate, a hook plus params like a relic's (some with a price in modifiers). From research, a challenge, and a feat.
- **The Cartographer:** the tasks on the minimap from 0:00 (level 1, §10.8), bestiary rewards (level 2), challenge runs (level 3), short runs (level 4), and the map's secrets on the minimap (level 5). **Bestiary milestones** (10, 100, 1,000, 10,000 kills of a kind) are claimed one at a time for materials; the third and fourth each add 3% damage against that kind, at most 6% (`RunConfig.bestiaryBonus`). **Challenge runs** (`data/challenges.js`) set the character, a Tide, curses, and pools to empty (no new weapons from level-ups, no passives), a goal (survive to a time, or kill a boss), and a reward: something opened, or materials. Won once each. The map-select screen's hints (the brief's) wait for a map select (Phase 8): with one map, the Cartographer shows the secrets on the minimap instead.
- **Character mastery** (`data/mastery.js`): each run gives the character played mastery XP (a point a minute, 5 a boss; `tuning.mastery`). Ranks 1 to 6 open that character's perks, trained at the Tavern (level 2) for materials and kept for every run as them; rank 4 opens the other starting kit (another first weapon), chosen at the gate.
- **Feats** (`data/feats.js`, `meta/feats.js`): conditions read from a run's result and the lifetime numbers, judged as the run is folded in once the Tavern keeps the list (level 1). Each has a visibility: `visible` is always listed; `after_found` appears once its discovery condition is met in a run (Untouched: a minute without a hit); `hidden` shows nothing until it's done. A reward is materials or something opened ('feat:<id>'). A condition this build can't judge is never met. **Secret characters** will be feats with `hidden` visibility (none yet).
- **The gate** (`app/setup.js`): once the harbor opens a choice beyond the character, the gate's second step lists only the rows open now (the kit, Standard, Short, or Challenge, the Tide or the challenge, each curse, the arcana, each consumable slot, a rune stone), starting from the last choices that are still open, with a line for what the focused row's value does (a Tide's numbers, a curse's or arcana's rule, a challenge's rules and reward) and what the Tide and curses add to the materials. Every value is one `runConfigFor` accepts: only the challenges whose character has arrived (a challenge sets out as its own character, so the screen's title follows it and the kit row goes), and only rune stones the run's first weapon can take (a stone is used up as the run sets out). Start checks the run as the run would, so a refusal stays on the screen.
- **The 70% rule** (brief §6.4): the pacing tool reports the share of run content in a fresh profile's pools (the weapons that go in the pools, the passives, relics, and runes; characters come from the Tavern and feats, so they don't count). The target is 30% or less. Phase 5 shipped at 42% (10 of 24) and Phase 6 at 34% (10 of 29); Phase 7 holds it at 34% (12 of 35: two starter Trinkets, the other new relics locked; §20 calls 60 and 82). The gate pins the share exactly, so any change to it is a deliberate one, and the report marks it missed until it's under 30%.

### 10.7 Prestige: New Tide (Phase 10)
- **Kept** (brief): one Prestige Relic per cycle, character mastery, and the bestiary. **Also kept** (builder's call): character unlocks, codex discoveries, feats, lifetime stats, and settings.
- **Reset:** buildings, materials, research, gear, Tide unlocks, and map access.
- **The Prestige Relic** is picked from a set when the cycle ends and is active in every run of every later cycle. They accumulate, one per cycle.
- `data/cycles.js` defines each cycle's building variant set, NPC story lines, enemy ramp variants, and new boss, so the town comes back different but still authored.
- **The hidden map:** the Reef has a secret interaction (for example, standing in a sunken bell's light for several seconds). It records the discovery in the profile, and the Docks then shows the route. This is built in Phase 10.

---

### 10.8 Run tasks, relics, Sea Glass, and the Ferryman (Phase 7)
Things to do on the map, a currency of the run's own, and where relics come from, as Kevin set them out for Phase 7 (`sim/tasks.js`, `sim/relics.js`; the numbers in `tuning.tasks`, `tuning.relics`, `tuning.glass`, `tuning.ferry`).
- **No timers.** A task moves only while you're doing it and waits for you when you leave. What it asks and what it gives are set by the minute you start it (a base plus so much a minute), so one left until late costs more and pays more.
- **Wayside Lamp** (5 on the Drowned Docks): stand within 30 px until it's lit (3 s, plus 0.3 s a minute). Each lit lamp is a stack of **Kindled** for the rest of the run (+6% XP and +6% Area), uncovers the minimap 20 tiles round it, and gives Sea Glass. Lighting every lamp brings **Lantern Night**: for 40 s the fog lifts, your light (220 px) burns everything in it twice a second, and a **vault** opens where the last lamp stood (a pick of 3 relics, a tier better). The Lamp Post's levels 3 and 5 light lamps 25% and 50% faster.
- **Fog Bell** (3): walk into its ring (84 px) to wake it; from then every kill inside the ring counts, wherever you are, until it rings (20 kills, plus 4 a minute): Sea Glass and an elite's chest. The Chapel's level 3 widens the ring by a quarter.
- **Sea Glass** is the run's own currency: from tasks, elites (3 to 5) and bosses (15), and the Glass Pouch. It is spent with the Ferryman; what's left at the end is lost, unless the Market buys it (§10.6).
- **Relics** come in three tiers, Trinket, Charm, and Relic (`data/relics.js`), and you carry every one you find: no slots. They never come from level-ups or chests. They come from a **Reliquary**, a rare drop from ordinary enemies (a chance per kill times luck, at least 150 s apart, certain after 1,800 kills since the last), the vault, and the Ferryman. Walking over a Reliquary stops the run for a pick of 3. What's offered leans on the minute (`tierWeights`: Trinkets and the odd Charm at first, the first Relics from 5:00, Relics more likely than Trinkets from 10:00 and the likeliest from 15:00), so the strong ones arrive late. Carrying everything there is, a Reliquary gives Sea Glass instead. Actives answer a dash (Spark Flint), a hit taken (Barnacle Shell), a kill streak (Bloodied Hook), and every Nth kill (Drowned Bell).
- **The Ferryman** (the Docks): a skiff tied up at the water's edge near the start. Standing still beside it for 0.6 s opens the trade, once a visit. He sells a relic (two from the Docks' level 2), food, a reroll, and an Ember, for Sea Glass, priced by tier; his stock turns over every 5:00 (4:00 from level 4), a little better each time. The Ember is dear (70).
- **The harbor's part** (`RunConfig.harbor`): the Ferryman's level, how fast lamps light, how wide bells ring, and whether the tasks and secrets show on the minimap from the start (the Cartographer).
- The minimap marks lamps (lit and unlit), bells, the skiff, a Reliquary, and the secret (§6.2); the HUD shows the Sea Glass held beside the kills.

## 11. Content data (`src/data/`)

Conventions:
- Every entry has an `id` (snake_case and **permanent**, because saves reference it), a `name`, and a `desc` in plain speech.
- IDs are never reused. A rename goes through `data/renames.js`, which the save loader applies.
- Kevin directs tuning by name ("Harpoon Chain cooldown 20% lower at level 3"). The builder edits data only, and the tests prove the change is valid.
- `tests/content.test.js` validates every file against the schemas below: unique IDs, every reference resolves, every sprite exists in the atlas, every hook exists, the evolution and research graphs are valid, and there are no dead materials.

```js
// weapons.js
{
  id: 'lantern_orb', name: 'Lantern Orb', desc: 'Orbs of lamplight circle you and burn what they touch.',
  tags: ['light', 'fire'], sprite: 'proj_lantern_orb', icon: 'icon_lantern_orb',
  unlock: 'starter',                 // or a research node id
  maxLevel: 8,
  base: { damage: 8, cooldown: 3.0, amount: 2, area: 1, speed: 1, duration: 2.5, pierce: -1, knockback: 0.4, hitCooldown: 0.5 },
  levels: [null, { amount: 1 }, { damage: 4 }, { area: 0.25 }, { duration: 0.5 }, { amount: 1 }, { damage: 6 }, { cooldown: -0.5 }],
  pipeline: {
    emit:   { type: 'orbit', radius: 36 },
    motion: { type: 'orbit', angularSpeed: 3.2 },
    onHit:  [{ type: 'damage' }, { type: 'knockback' }, { type: 'light', radius: 20, ms: 150 }],
  },
  runeSlots: 2,
  evolution: { passive: 'wick_oil', passiveLevel: 3, into: 'lantern_orb_x', hidden: false, hint: 'research:evo_hints_1' },
  sfx: { fire: 'orb_spawn', hit: 'hit_soft' },
}

// runes.js
{ id: 'splitting', name: 'Splitting', desc: 'Projectiles split in two when they hit.', rarity: 2,
  validOn: { emit: ['nearest', 'facing', 'radial'] },
  patch: { onHitAppend: [{ type: 'split', count: 2, damageMul: 0.5 }] } }

// relics.js (tier: 1 Trinket, 2 Charm, 3 Relic; a hook, or modifiers)
{ id: 'volatile_gems', name: 'Volatile Gems', desc: 'XP gems explode when collected.', tier: 3,
  hook: 'gem_explode', params: { damage: 12, radius: 26, every: 0.1 }, unlock: 'research:volatile_salts' }
{ id: 'brass_button', name: 'Brass Button', desc: '+6% Damage.', tier: 1, unlock: 'starter',
  mods: [{ stat: 'might', op: 'pct', value: 0.06 }] }

// passives.js
{ id: 'undertow', name: 'Undertow', desc: 'Tide weapons fire one extra projectile.', maxLevel: 5, tags: ['tide'],
  levels: [null, [{ stat: 'amount', op: 'add', value: 1, tags: ['tide'] }], /* ... */], unlock: 'research:tide_1' }

// enemies.js
{ id: 'drowned_sailor', name: 'Drowned Sailor', sprite: 'en_sailor', ramp: 'drowned',
  hp: 12, speed: 38, contact: 5, mass: 1, xp: 1, ai: { type: 'chase' },
  drops: [{ material: 'rope', chance: 0.01 }, { material: 'drowned_pages', chance: 0.008 }], tags: ['undead', 'water'] }

// maps.js
{ id: 'drowned_docks', name: 'Drowned Docks', size: [256, 256], layout: 'docks_1', ambient: 0.35,
  materials: ['timber', 'rope', 'drowned_pages', 'rum'],   // plus coin and oil, which drop on every map
  timeline: [
    { from: 0,   to: 60,  roster: { fog_wisp: 1 },                      density: [20, 60] },
    { from: 60,  to: 180, roster: { fog_wisp: 3, drowned_sailor: 1 },   density: [60, 150] },
    { at: 300,  event: 'elite', enemy: 'drowned_bosun' },
    { at: 600,  event: 'boss',  enemy: 'harbor_maw' },
    { at: 1200, event: 'boss',  enemy: 'the_tidecaller' },
  ],
  overtime: { densityPerMin: 1.12, hpPerMin: 1.15, materialsPerMin: 1.10 },
  secrets: [{ id: 'wreck_cache', name: 'Wreck Cache', at: [212, 40], radius: 10, relic: 'wreck_lantern' }] }

// buildings.js (the plot and the door are the harbor map's, data/hub.js)
{ id: 'library', name: 'Library', desc: '...', npc: 'librarian', material: 'drowned_pages',
  levels: [
    { cost: { drowned_pages: 10, coin: 20, timber: 5 }, researchSlots: 1, researchTier: 1 },
    { cost: { drowned_pages: 30, coin: 45, timber: 12 }, researchTier: 2 },
    /* 3 more: every building has 5 */ ] }
// A level's effects are `tree` (the Lamp Post's upgrade tier), `researchTier`, and `researchSlots`;
// what else it brings says so itself: the Harpooner's `unlock` is 'building:tavern:1'.

// research.js (what a project adds says so itself: Lantern Orb's `unlock` is 'research:orbwright')
{ id: 'tide_charts', name: 'Tide Charts', desc: 'The old harbormaster\'s charts, and what the tide does to things.',
  tier: 1, cost: { drowned_pages: 12, coin: 30 }, runs: 2, requires: [] }

// upgrades.js (the Lamp Post's capped stat tree)
{ id: 'thick_blood', name: 'Thick Blood', desc: '8 more health.', tier: 1, ranks: 5,
  mods: [{ stat: 'maxHp', op: 'add', value: 8 }], cost: { oil: 8, coin: 6 } }   // rank r costs r times this

// npcs.js
{ id: 'lamp_keeper', name: 'Old Wick', desc: '...', sprite: 'npc_lamp_keeper', home: 'lamp_post',
  lines: [{ when: 'lamp_post:4', text: 'Forty years I lit these streets. Nice to have help.' }, /* ... */] }

// characters.js
{ id: 'harpooner', name: 'Harpooner', sprite: 'pc_harpooner', start: 'harpoon_chain',
  base: { maxHp: 110, moveSpeed: 0.95 },
  mechanic: { hook: 'harpooner', params: { armorPerNear: 0.2, nearRadius: 40, cap: 10, pull: 0.6, daze: 0.4 } },
  unlock: 'building:tavern:1',
  hubLine: 'Tide\'s turning. Say the word and I\'ll take the next run.' }
  // mastery (perks, the alternate kit) arrives in Phase 7

// feats.js (when: conditions on the run's result and the lifetime numbers, all of them met)
{ id: 'untouched', name: 'Untouched', desc: 'Reach 5:00 without taking a hit.', visibility: 'after_found',
  found: { untouchedSec: 60 }, when: { untouchedSec: 300 }, reward: { materials: { rum: 10, coin: 100 } } }

// gear.js (an affix: stat, build, hook, or rule; §10.6)
{ id: 'storm_lantern', name: 'Storm Lantern', slot: 'lantern', icon: 'gear_lantern', base: 'fire_volley',
  pool: [/* stat and build affixes */], cost: { iron: 2, oil: 16, coin: 40 }, unlock: 'research:smiths_ledger' }
{ id: 'fire_volley', kind: 'build', name: 'Projectile (Fire)', mod: { stat: 'amount', op: 'add', tags: ['fire'] }, value: 1 }
{ id: 'oil_wake', kind: 'hook', name: 'Dash leaves burning oil', hook: 'dash_trail', grow: ['damage', 'dps'], params: { /* ... */ } }

// challenges.js
{ id: 'flood', name: 'Flood', desc: 'Lamplighter at Tide 4 with Swarm. Survive 8:00.', character: 'lamplighter',
  tide: 4, curses: ['swarm'], goal: { surviveSec: 480 }, reward: { materials: { map_scraps: 6, iron: 8 } } }

// maps.js, Phase 7's part
tasks: [{ kind: 'lamp', at: [128, 100] }, { kind: 'bell', at: [176, 84] }, /* ... */], ferry: { at: [120, 136] }
```

Other files follow the same pattern:
- `tide.js`: the Tides and the curses, multipliers and modifier lists plus a reward share
- `arcana.js`: a hook plus parameters, like relics
- `consumables.js`: applied at 0:00 (modifiers, charges, or starting Sea Glass)
- `mastery.js`: perks (a character's, at a rank) and kits
- `market.js`: what the Market trades and its rates by level
- `cycles.js`: per-cycle prestige content
- `hub.js`: the harbor's map (ground, plots, ruins, fog regions, props, the pier, the gate, the keepers' posts and walks, the waiting spots, the avatar); its checks are in the content test
- `meta.js`: the meta layer's numbers (what counts as a research run, the bestiary's milestones)
- `materials.js`, `sfx.js`, `palette.js`, and `credits.js`
- `tuning.js`: every feel value and curve
- `index.js`: imports and exports everything, and is the single entry point for the game and the tests

---

## 12. Saves, replays, and reports (`src/save/`)

### 12.1 Where saves live
| Build | Save | Settings |
|---|---|---|
| PC release | `%APPDATA%\Lamplight\profile.json`, through the preload bridge | `settings.json` in the same folder |
| Playtest | IndexedDB (localStorage as fallback) | IndexedDB |

- Settings are kept separate so display preferences don't travel inside an exported save.
- **Atomic writes** on the desktop: write to `profile.json.tmp`, flush, then rename (retried for about a second if Windows antivirus or a sync tool briefly locks the file). A crash mid-write can't corrupt the save. On every run end the previous save rotates into `profile.bak1.json` through `profile.bak5.json`.
- **Quarantine:** if the main save exists but can't be used (damaged, locked, or from a migration that failed), it is copied to `profile.unreadable-<time>.json` before anything else happens, so no later save can overwrite the newest progress. A save from a newer build is never overwritten either: this build can't read it, so the game doesn't start (a blank profile could never be saved). It says so in one plain sentence ("This save was made by a newer version of Lamplight... Your save is untouched."), from `app/profileboot.js`; the web build keeps checking for the newer version and reloads into it, and the desktop build says to open the newest Lamplight.
- **A failed save** keeps the progress in memory and shows a notice that stays up until a save works; the next change saves it. Nothing that leaves the page goes over progress that isn't on disk (`app/keeper.js`, through `app/flow.js`): an update's reload, Quit, reopening the window for a display mode, and reloading after an error all wait for the writes in flight and save again first. If that fails too, Quit and the error screen's reload ask ("Quit anyway" or "Stay"), and the others stay put. Closing the page any other way while a save still fails (a browser tab, the window's X, Alt+F4) asks first too. The desktop shell asks the game's own question (Stay by default) from its main process, which the page tells whenever a save starts or stops failing, so it asks even when only the pad has been used (a page can hold a close only after a mouse or keyboard press). In the browser the page holds the close (`beforeunload`) and the browser asks in its own words, which it does only after such a press: a browser tab closed having used only the pad closes without asking.
- **One write queue:** a run-end save and a hub save can't interleave and land out of order.
- Autosave after every run and every hub action.

### 12.2 Versioning and migrations
- The save document has a schema version `v`. `migrations[n]` converts version n to n+1, and loading runs every step needed.
- **A fixture save from every schema version is kept in `tests/fixtures/saves/` forever.** The gate loads each one, migrates it, and validates the result. An update can never wipe progress without failing the build first.
- Content IDs the game no longer knows go into an `orphans` bucket instead of being deleted, so progress is never thrown away (`meta/reconcile.js`, run on every load; the fixture `profile-v1.txt` carries a research id that no longer exists).
- **Version 2 (Phase 5)**: the Lamp Post's `upgrades` (id → rank); research keeps `done` and `active` (with `runsLeft`), and its slot count moved out of the save (it comes from the Library's level). The v1 → v2 migration adds the upgrades and drops the stored slots; `profile-v2.txt` is the v2 fixture.
- **Version 3 (Phase 7)**: gear gains `next` (the next item's number, past the highest held) and `rolls` (every re-roll made), and an item may carry its own `rolls` (its re-rolls, the seed of its next offer; anything but a whole number reads as 0); new parts: `consumables` (held counts, rune stones as 'rune:<id>'), `bestiaryClaimed`, `featsFound`, `challenges`, `setup` (the gate's last choices), and four lifetime numbers (boss kills, clears, lamps lit, bells rung). The v2 → v3 migration adds them empty and moves nothing. Reconcile sets aside gear of an unknown recipe whole, feats, challenges, and consumables it doesn't know, and claims for an unknown enemy, and brings them back when a build knows them; a worn item must be held and in its own slot; the gate's choices are preferences, so anything this build can't use is reset. `profile-v3.txt` is the v3 fixture.

### 12.3 Export and import
- The code is `LAMP1.` + base64url(deflate(JSON)) + `.` + a CRC32 checksum.
- Import checks the checksum, then the version, then migrates. It shows a summary (hub progress, playtime, characters) before overwriting, and backs up the old save first.
- Export covers the profile only, not settings.

### 12.4 Replays and bug reports
- Every run records seed + build + RunConfig + input frames. Input compresses well; a 20-minute run is expected to be tens of KB. The last 3 replays are kept in `%APPDATA%\Lamplight\replays\`.
- **Pause menu → "Save bug report"** (also on the error screen) writes a report file with the replay, the tuning he changed, settings, the last 300 events that matter, any captured errors, and a snapshot of the run, then shows where it went. On the desktop it goes to `%APPDATA%\Lamplight\reports\`; the web build downloads it (a browser's database can't be attached to a chat). Kevin attaches that one file. Claude plays it with `node tools/replay/replay.mjs <file>` to the exact moment and sees what he saw.
- Tuning changes and dev commands made mid-run are logged decisions like draft picks (§15), so a report from a tuned or cheated run still replays exactly.
- `window.onerror` and unhandled promise rejections are captured into an error log that goes into reports.
- **The error screen** ("Error": Save bug report, Reload) opens once, over whatever was showing, for a crash in the sim (which pauses it), a scene that couldn't start, or a run's end that couldn't be folded into the profile; it says whether a run was stopped. Reloading from it goes through the keeper like any way off the page (§12.1).

---

## 13. Builds

### 13.1 Playtest build (web, Cloudflare)
- `vite build --mode web`. The package.json `build` script runs the test gate first, then Vite.
- The build writes `dist/version.json`. The page checks it with `cache: 'no-store'` on load and whenever the window regains focus.
- **If a new version appears during a run, the page does not reload mid-run.** It shows a small "update ready" marker and reloads at the next return to the hub or title screen. This departs from the brief's literal "reloads when it changes", because a reload mid-run would throw the run away (§20).
- **The harbor is a reload point only while it's idle:** no screen open (the results after a run, a building's panel, the gate, the menu) and no set piece running; the scene says when it becomes idle again, and a waiting update loads then. The results always get read. Before any reload, a save that failed is tried again, and the page stays if it still fails (§12.1). (Reopening the window for a display mode goes by the scene instead: at the title or anywhere in the harbor, since the settings themselves are a screen.)
- `public/_headers` makes `index.html` and `version.json` uncacheable, and makes hashed assets cache forever. Phase 1 confirms Workers static assets honor `_headers` after the first deploy. The fallback is a small Worker script (`main` plus `assets.run_worker_first` for those two paths in `wrangler.jsonc`) that sets the headers.

### 13.2 PC release (Electron)
- `vite build --mode desktop`: relative asset paths and no version check.
- `desktop/main.cjs`:
  - single-instance lock
  - a fullscreen window by default (setting-driven), with a black background and no menu bar
  - `contextIsolation` on, `nodeIntegration` off, sandbox on
  - files served from a custom `app://` protocol instead of `file://`, which avoids module-loading and fetch quirks. The scheme is registered with `protocol.registerSchemesAsPrivileged` (standard, secure, fetch support) before the app is ready, then served with `protocol.handle`
  - F11 and Alt+Enter toggle fullscreen
  - the build number shows in the window title and on the title screen (brief §9.2)
  - display settings: **fullscreen** (default; Chromium's fullscreen is already borderless, there is no exclusive mode), **borderless window** (frameless, covering the display, not flagged fullscreen), and **windowed** (a whole multiple of 640×360, centered). Switching to or from borderless opens a new window, which reloads the page, so the settings screen offers it only at the title or hub. Vsync stays on (Chromium syncs `requestAnimationFrame` to the display)
  - every IPC call is checked to come from the game page itself; a page that fails to load or a renderer that dies shows a plain error page instead of leaving an invisible process
- `desktop/preload.cjs` exposes a narrow bridge through `contextBridge`: read and write the save and settings, write replays and reports, open the saves folder, toggle fullscreen, quit, and get the version. The preload is sandboxed and can't touch the file system, so every call goes over IPC to `main.cjs`, which does the actual file work.
- `tools/pack-desktop.mjs` runs the desktop Vite build, stages every `desktop/*.cjs` file plus the build, packages win32-x64 with asar and Windows metadata (name, version, and icon, all set without Wine: confirmed in Phase 1), zips it as `Lamplight-win-x64-v<version>.zip`, and checks the zip's contents. `--split-mb N` also cuts a split zip if a size limit ever blocks delivery.
- **Smoke test** (`tools/smoke/smoke.mjs`): the same app packaged for Linux, launched under Xvfb with a throwaway save folder. It plays itself for 30 seconds, saves through the real bridge (with a backup rotation), reloads the save, writes a replay and a report, and the main process checks those files exist on disk. It must pass before any .exe is sent. The Windows .exe itself can't be launched here, so Kevin's first launch is the Windows check.
- Delivery: about 150 MB zipped. Files sent in the chat are capped at 30 MB, so the zip goes as a split zip in 25 MB pieces (`.zip` plus `.z01`, `.z02`, ...), which Kevin opens with 7-Zip. The workspace tests the pieces with 7-Zip before sending (Phase 3).
- The .exe is unsigned, so SmartScreen warns on first launch ("More info", then "Run anyway"). Signing and Steam integration are later decisions and aren't built now.

---

## 14. Testing

### 14.1 The deploy gate (`tests/`, every Cloudflare build, under about 60 s total)
| Test | Checks |
|---|---|
| `boundary.test.js` | Import rules from §4; no forbidden globals or engine math (the `**` operator included) in `sim/`, `meta/`, `hub/`, `data/`, or `lib/` |
| `content.test.js` | Every schema; unique IDs; references resolve; hooks exist; the evolution graph is valid; bosses only come from boss events; every weapon × valid rune runs 600 ticks cleanly, plus 200 seeded two-rune builds. Phase 5: buildings (five levels, real costs in their own material, effects that only grow, a keeper each), research (a tier the Library opens, earlier requirements only, no loops, each adds something), upgrades (capped, small, real modifiers, every tier filled), every unlock key resolves, the MVP economy has no dead ends (map 1 pays for everything, and everything it drops has a use), the townsfolk's lines key to real levels, the harbor's tuning (every number with its range in `HUB_TUNING_RANGE` and within it, every brightness, thickness, and share within 0..1, colors from the palette or a tint), every keeper line heard once its keeper is out, the MVP harbor paid from map 1 alone, an upgrade's modifiers on one stat, together as a run stacks them (the value times the ranks), capped at 25% of it, one revival in the whole tree and that in the last tier, each tuning range's kind named (above 0 for what the harbor divides by or waits on, either sign only for a direction), a rare material only from elites and bosses, and the harbor map (below, §10.4; the gate's lamp on the sea wall beside the gate, the pier's on the pier, each prop on a tile of its own, each door below its building or, for the Lamp Post, beside it, ruin ids their own) |
| `sim-core.test.js` | Pools and handles, the spatial hash against brute force, terrain collision and layouts, the flow field, the event buffer's drop rules |
| `ascend.test.js` | Embers: stopping the run for the choice, the two-step view (each weapon's three Forms with taken and why), refusals, spending, stacking, kept Embers spent from the pause (never over another screen), a weapon with all three keeping an Ember without stopping, the hash, a replay with Embers taken, kept, and spent, an Ember picked up at once when the pickup pool is full, evolutions keeping Forms (and the Form still working), drops (bosses, elites at their chance); two Embers on one tick with one Form left; the Stats numbers (DPS over the time a weapon was held, kept through a rebuild; Total Damage; materials found as whole counts on the pause menu and Stats) |
| `forms.test.js` | Forms (§5.16): one of each kind a line, known mechanics, real weapons, names of their own; each Form's own mark on a scripted fight (and none without it); every combination on every weapon of a line runs, changes the fight, and keeps the pools in bounds; the numbers Forms change; Skewer, Tether, Lunge, Pyre, Wisps, Vigil, Burning Glass, Fuel Line up close; runes and Forms never cancelling each other |
| `guide.test.js` | The harbor's guide for a new player: its steps (the gate; the Lamp Post; back out through the gate, saying what's short, when a run brought home too little; then nothing), its marker (over the target, at the edge pointing to it, slid to the nearest clear end of a corner panel or the goal line and keeping its angle, moved off a panel that covers an on-screen target), the walk around the fog (`routeTo`, `routeExit`); walking off the quay (after `timing.walkOff`, once a push, not re-armed by a screen, on the gate's row and the one below and only there, only against the edge, not during a dash, open from a fresh profile) |
| `minimap.test.js` | The run's minimap: its place top right (off, Small, Large), no materials on the HUD, its marks (every drop kind, elites, bosses, you; no gems, plain enemies, dead elites, or what's outside the window; materials drawn under the rest; your slot kept), its whole-pixel window at both sizes and at the map's corners, uncovering exactly what the camera shows, fading while you're under it, its settings rows reaching the HUD live; and the real Pixi minimap and HUD in Node (the harbor rig's stand-ins): uncovering while Off, new ground sent at most every 150 ms, the clip, marks drawn, Whole map smoothed |
| `docks.test.js` | Phase 6 on the Drowned Docks: the layout's data checked in plain words (and a shortfall of slips or sheds an error), one door a shed, a bow narrower than the stern, the docks layout (the same every time, solid exactly where a kind is an obstacle, every kind present, every open tile reachable, the wreck closed but for its two-tile gap, no water run longer than a short slip), the run view's frame for each tile by kind and neighbors, the secret cache (opens once on reaching it, gives its relic or else one item, the reel, the notice, the state), the Wreck Lantern, the Bosun's Muster (captain, crew in a ring, the notice, a boss chest) and its timeline checks, the Maw's lure (drawn in, bitten; walking away escapes; never from off screen; a dash free of it; ended by its own Maw only), the Tidecaller's tide lanes (rows across you, each warned, staggered; the band between rows safe; a row hurting only after its own warning), boss data checks, the muster's crew all off screen, the Oil Flask landing on near and far targets, a Signal Mirror volley's beams on separate targets, lightning bolts only on a strike's own hits, the secret's meta (the codex key, its relic in the pools from then on, the results said once, kept through reconcile), and the dev warp |
| `player.test.js` | Movement, the dash (distance, one per press, cooldown, i-frames), walls, death and revival, regen, the XP curve, several levels in one tick; RunConfig, tuning, and InputFrame checks; the state hash's coverage |
| `combat.test.js` | Every enemy AI type, status effects, knockback, crowds, walls, teleport-ahead, contact; every emitter, motion, and on-hit effect; runes; the starter weapons; gems, the magnet, pickups; boss attacks, phases, and chests |
| `stats.test.js` | The formula, caps, and tag scoping, against hand-computed tables |
| `drops.test.js` | Drop tables are valid; seeded expected values land within tolerance; a full pickup pool loses nothing the player earned |
| `draft.test.js` | Banish, reroll, and skip; slot rules; the early-weapon rule; relics never as cards or from chests; chests, evolutions, rune placement (no invalid runes offered); every relic and character hook, including the Harpooner's daze (it never adds up, and a crab or gunner mid-attack goes off on the tick its warning said, with or without her hits; freeze too, and a boss's charge keeps its time even if a freeze got in first) |
| `meta.test.js` | Unlock keys, what building levels open, `resolveContent`, costs and their messages, restoring, upgrading, and research (each refusal with its sentence; the document passed in never changes), `applyRunResult` (materials, research ticking and finishing, the qualifying rule, the codex, bestiary milestones, the best time, junk results), the next three, a run's config (pools and upgrades as modifiers from 0:00, checked in a real world), completion, the fog, reconciling, every fixture save migrating, every writer (a run, a restore, an upgrade, a new project, both dev commands, and reconcile itself on every load, after the v1 migration too) leaving the rest of a seasoned profile alone, a hand-built profile missing a part still buying and unlocking (the part made new, never a crash), a project listed twice kept at the one further along (known or not, 'done' over running), only a boss this build has counting for research, research finished in a newer build coming back finished, and the harbor's dev commands (add materials, unlock everything: like a purchase, its changes shaped as a purchase's and a run's, marked in the save, a project this build doesn't know kept; a run that used the panel marks it too) |
| `workshop.test.js` | Phase 7's purchases and rules (§10.6): gear made, worn, raised, and re-rolled (the same offer until one is taken, never the recipe's own), its affixes' text and what worn gear sends into a run (rules and hooks once, the hook at its best tier, closed slots out), rune stones, the Market's terms, consumables, bestiary claims and the capped bonus, mastery ranks, perks, and kits, every feat condition and visibility, challenge runs, the Phase 7 part of `applyRunResult` (Sea Glass sold, mastery, the next Tide, a challenge won once, feats only with the Tavern), the run config's checks of every gate choice, the gate's rows (only what's open, every value one the run config takes), and v3 reconcile (set aside, held to this build, brought back) |
| `tasks.test.js` | Phase 7 in a run (§10.8): a lamp lights only while you stand by it and waits when you leave, Kindled, a bell counts kills in its ring wherever you are, cost and reward by the minute started, Lantern Night's burn, its vault and its end, the relic pick (none carried, none twice, a tier better from the vault, Sea Glass when nothing's left), a Reliquary's gap and pity count, Sea Glass from elites, the Ferryman's stock by the Docks' level, his clock, the trade (once a visit, each refusal), what relics are offered at 0, 5, 10, and 15 minutes (never a stronger tier early when the weak ones run out), each Ferryman stock better than the last, the Phase 7 relics' rules (Spark Flint, Barnacle Shell and its cooldown, a shielded hit, Bloodied Hook's window and end, Drowned Bell), the arcana's (High Water, Brine's cap, Kindling), a Tide's and curses' multipliers (bosses too), Hunger, a rune stone at 0:00, a kit, the bestiary bonus, gear's hooks, and a replay with all of it. `minimap.test.js` adds the Phase 7 marks and a lit lamp's reach; `view.test.js`'s HUD overlap check includes the Sea Glass |
| `hub.test.js` | The harbor world: walking and the dash at the run's feel (the dash any way you last moved, the camera on you), walls, buildings, the fog, props, and the small lamps as walls, what's in reach, the keepers' walks, a ceremony (its camera gliding in and out, when the fog peels and the keeper and props appear), an arrival (the camera's glide, the newcomer stepping off from the bow's deck; one without a tile to wait at, refused plainly), skipping and queuing set pieces (a skip mid-peel ends the fog's fade; a skipped level's keeper and props land at once), nothing in reach during a ceremony even at a door, a keeper stepping out when the build is done, a prop reaching your edge pushing you clear at once, a dash held through a set piece not firing after it, last tick's positions kept for you and the people, each world's own timing read every tick (a tuned world's ceremony, build, and fog on its own clock, a ceremony retimed while it plays, an arrival's pans and walk, a keeper's pause, and the dash's cooldown; the live tuning holding every number to its range at both edges), the map's checks (no squeezing between two corners, a lamp or a prop off the map), and the same run of the harbor every time |
| `harbor.test.js` | The harbor's presentation: every tile, stage, prop, and townsperson on the atlas page (and every frame the hub view names), the path edges and fences, stages and lights by level, what a building shows and how its lights come up during a ceremony, the lamp's swell and the boat's shade, every light from the look (its colors as palette names or tints, the night's ambient and boost), an arrival's stand, halo, and bob, and the newcomer's hand-off at one height, the flicker's two waves, the light map at a point, a newcomer's shade and her boat's (lit alike where the fog is clear, in its shade in the fog) and when she's clear of it, the fog's clear mask and when it's drawn again, the fog at a point (smooth between tile middles), the camera's limits, the fog's density, and every sentence the panels, the next three, and the results say (a cleared map by its name); what a purchase plays out as |
| `hubview.test.js` | The harbor view itself, run on Pixi's scene graph with stand-ins for the GPU and the canvas (`tests/helpers/hubrig.js`), each part of the scene checked against the pure helpers it draws from: the layers' order, the light map and the fog each drawn into its layer's texture and cleared first every frame, the fog drawn whole and erased so each tile shows its density times the thickness, the fog redrawn every frame of a peel and once after, you and the people between ticks each hopping in their own time and a keeper fading in, each person, prop, and passenger in their own picture (people on their feet, props on their tiles, a building on its plot, the stages and the scaffold sorted by the building's front edge), the prompts placed from the camera, every light into the light map where harborLights puts it (flickering unless steady, the windows coming up through a ceremony, your lantern between ticks), a stage rising behind its mask (the town lamp's where the lamp stands) and the scaffold rising into place (its drawing on the plot, its outline a pixel past), a chimney smoking only once the last stage is up, an arrival from the boat out in the fog to her place on the square (cut at the gunwale, she and the boat lit as the light map would light them, over the boat with the hull over her feet and fading out as she walks clear, her waiting figure taking over, no light left where the boat's lantern was), every light on the glass its drawing has where the view stands each thing (every lit window's too), the look read live (the sea's swell, the wisps' drift, the camera's lift, a prop's pop, the puffs), every harbor number at the edges of its range (what must stay above 0 at a thousandth, a speed at a thousand) drawing a whole ceremony and arrival with nothing broken, a prop popping and a keeper fading in, and the sea and the wisps drifting, and the atlas left whole when the harbor goes |
| `hubscene.test.js` | The harbor scene as a player drives it: the real input module with a stand-in DualSense, the real menu layer over a stand-in DOM (`tests/helpers/fakedom.js`). ✕ at a person says their line and at a door opens the panel, without dashing (R1 still dashes); what can't be bought says why when pressed; a purchase keeps the focused row and the list's scroll and updates the materials and the next three; the d-pad moves through a panel by where things are; the prompt, the corner panels, the skip hint, a keeper's bubble, and the banner come and go; the Tavern lists who comes back; Options opens and closes the harbor's menu; the gate sets out with the focused character; skipping a ceremony still shows its banner; the results come up over the harbor, and their Start run goes to the gate; the harbor is a safe point only while idle; a borderless switch works in the harbor and waits for progress to be saved; the harbor's tuning panel (hold Create) changes the harbor live, copies its changes, refuses a number the harbor can't run on, and its dev commands save to the profile and redraw the harbor where you stand; the view gets the new levels at a purchase, the Tavern's first level brings the boat, Circle skips, the gate offers only who has arrived, a panel redraws its ranks and reasons, an empty Next up hides, a corner panel fades under you, the results ignore a press at first and say what's short; a run's end is saved on its tick and the end screen's buttons go where they say (the run scene), a run is the app's config for it and Run again asks for the same character's again (never everything), the end screen ignores a press as it comes up, and a run that can't be folded in goes to the error screen and no end screen covers it; the title's Continue, the question before leaving over a failed save (Stay focused, Back is Stay), the desktop's Quit in the harbor's menu, the materials bar listing only what the harbor asks for, Next up's ready line, and the update notice held clear of Next up in the CSS; the Borderless switch through the real flow and keeper, the refused mode not left on disk, a switch between fullscreen and a window saved first; research started from the Library's panel (saved, its row under way), what a cost is short of marked, a building with nothing left saying so; after Run again the results counting the runs and naming the map cleared; the error screen's words in a run and out of one; the layer's root carrying the view's unit and left edge; walking off the quay opens the gate and backing out with west still held doesn't reopen it; the guide's goal and marker (gone under a screen and once the target's prompt is up); a first run's How to play (under screens, fading while you stand under it, gone after its seconds); the guide's arrow aiming where the walk to the gate leaves the screen, clear of the corner panels and the goal line; an Ember's Ascend screen, Keep for later, the pause's Ascend (never over the Ascend screen), and Stats from the pause |
| `pacing.test.js` | The pacing model on made-up yields: the greedy buyer's order (buildings, research, upgrades) and spending, greed scaling a run's haul (and players using their own), a simulated player finishing the harbor with every level, project, and rank once and in order, the cheapest first within a kind (by cost, whatever order the data lists them in), done meaning every rank too, players drawing their own runs, greed through the stat formula (add, pct, more, the cap), the report's arithmetic pinned on hand-built players at three paces (medians, percentiles, runs between new things with a dry stretch counted in its own window and where the later window ends, each verdict and its edges, a first level after run 1 missed, a player who never finishes making the MVP missed), the MVP row counting the MVP buildings only, a haul rounded down once, the fresh share at exactly 10 of 24 (pool content), the assumptions it prints (greed, overtime either way), a measured run on a fresh profile's config with the bot MEASURE describes (the archetypes in turn), a halt the bot can't answer stopping with an error, the report on the committed yields (its simulations with the players, harbor minutes, and caps it names, each row's medians, range, and verdict, the lines' numbers, other targets giving other verdicts), the report's reached count, and the yields' fingerprint (the files it follows, every data category the sim plays with, a comment edit kept, a code, map, or drop edit caught, stale or fresh) |
| `save.test.js` | Store round trips, atomic-write logic, migration of every fixture, export/import round trip, corrupt codes rejected, and the boot's profile (a save from a newer build stops the game with the store's sentence; any other is fitted to this build) |
| `run.test.js` | The director's curve, events, scaling, overtime, and short mode; RunResult. A scripted kiting bot plays a full 20:00 run with the density cap lowered to 100 for speed: no NaN, pools within capacity, bosses at 10:00 and 20:00, a sane RunResult. Also half a minute at the full late-game density (1,500 enemies). The full-density 30-minute run lives in `tools/soak`, which Claude runs before every zip. Together they cover the brief's "scripted 20-minute run that stays stable" without making every Cloudflare build take minutes |
| `art.test.js` | The committed atlas as the game loads it: each building stage showing what it says (every stage unlike the one before, the ruin roofless and dark inside, boarded panes dark with a plank's lit edge across, lit panes lamp-colored and brightest at the top, the sign and the lantern from the keeper on, window boxes at the last level, a layout cell's own colors, the town lamp dimmer before its first level, the townsfolk in the characters' 22 x 22 frame with their feet 3 px above its bottom); every building stage and ruin its plot's size, and the scaffold its plot's with a pixel of outline round it; its table is sound and matches the image; it is **up to date with its sources** (the fingerprint of every file the builder imports, followed through the tree, plus each icon's tag; comments and any spacing that can't change what the code says don't count, but the insides of strings do), so a stale atlas can't deploy; every sprite and icon the data names is on the page; actors have same-size flashes, enemies elites for every animation frame; every rig part and pivot; the readability rules and contrast (§16.4) measured on the real pixels of every animation frame and every elite; materials outlined and each its own picture; warnings red-orange; the player's layer above the light, fog, and warnings; frames never touch; every color on the page is a palette color; the font; the glow and fog textures; `ui.css` uses only palette colors |
| `atlas.test.js` | The atlas builder without the packs: PNG reading and writing (palette images, damage, interlacing), mask drawing, tint (light, shade, holes, outline), layers, remap, the flash and elite variants, icon frames, the manifest's shape and Kevin's pack split, a whole build over stand-in packs (every entry gives its frames and variants; a bad entry, a spaced or short sheet, is named), the fingerprint's import walk, and the boss rigs (finite poses, the Maw's jaw drops, the lure stays on its stalk, the Tidecaller's bell swings harder when it rings, each attack's pose, the rig input read from a real boss, the rig's own light) |
| `dev.test.js` | Tuning and dev commands as logged decisions: live values, nothing leaks into the defaults or another run, refused changes leave no trace, every command, and a tuned run replays exactly |
| `feel.test.js` | Packed colors, screen shake, damage-number grouping, render particles, HUD text, voice limits and the gem pitch climb, and every sound rendering finite samples |
| `ui.test.js` | Controller navigation geometry, card text for every weapon and passive level (word for word, each stat line signed and without a period), and the tuning panel's model and copy text |
| `voice.test.js` | The words against `docs/WRITING.md` §8: every name, description, and line in the data and the credits, every card at every level, every level's effects, refusal, prompt, next-up line, and results line the builders make from the shipped content, the run's end screen, and the string literals in the screen code. It fails on a banned word or construction, an exclamation mark, an em dash, a lowercase tag, "Claude" outside the credits, a line narrating the player, "The" before a building, map, or character name (bosses keep theirs), "your" in a pick's description, a stat line without its sign, and a heading or button over four words; it checks its own checks on made-up lines |
| `view.test.js` | The HUD's layout at every minimap setting (nothing overlaps; see §6.2 item 13). The run view's memory fed by real worlds: which events make which effects, warnings ending on the tick their hit lands, the dying keeping their facing, bounded stores, the tuned damage-number limit, enemy looks (dazed included); animation on sim time (frames staggered and held, the hop, the daze wobble) and a source check that the run view calls those helpers with each enemy's phase; the floor's variants (no pattern, the right mix, one picker for the run and the title); what the HUD says, and that no two HUD pieces overlap at their longest |
| `uistack.test.js` | The menu stack's routing with a stand-in document: the input delay, released buttons on open and close, one Esc doing one thing, closing a screen that isn't on top, menu sounds |
| `runlogic.test.js` | Hit-stop, sounds per event, what each halt's screen shows, the pause and end summaries, the report event log, and a replay file and report that play back to the same state |
| `lib.test.js` | The RNG (golden sequences for every named stream, forks, state round trips, seed checks), `lib/fmath.js` against the engine's math and its bit-identical golden values, and the hashes against published test vectors |
| `input.test.js` | Glyphs from real controller ids, the deadzone, the DirectInput table for Sony pads, keyboard and pad movement, presses and holds (skip, the tuning panel's hold), menu repeat, devices coming and going, released buttons between screens, focus loss |
| `loop.test.js` | The fixed 60 Hz loop: steps per simulated second at any frame rate, alpha, stalls clamped, pause reasons, hit-stop, stop and start from inside a frame, a throwing step or render |
| `pauses.test.js` | When losing the controller or the window's focus pauses the game, and what resumes it |
| `app.test.js` | The screen layout at the common resolutions and display scalings, the scene manager (order, queued transitions, errors, safe points), the version check (reloads only at a safe point, never twice for one build, heals when stuck), the progress keeper (a failed save kept and shown, nothing leaves the page unsaved, checked after the flush, a settings write failing on the way out not holding the player), and the game's flow (`app/flow.js`: a run's end folded in and saved rotating the backups, then its replay, Run again's news added up and shown once, a run's config from the profile, the title's first button to the harbor, the window reopened only settled at the title or in the harbor, and every way off the page through the keeper: Quit and the error's reload ask, an update's reload and the display switch stay; closing the page another way asks while a save still fails, but not after a way off that asked); and a source check that `main.js` wires the scenes, the title, the error screen, settings, and updates through the flow and the keeper (each wire as a piece of code, its spacing and line breaks aside) |
| `desktop.test.js` | The Electron shell's pure helpers: app:// paths kept inside the game folder, the bridge only for our page, window sizes under display scaling, no restart loops, display modes, the title's build stamp, IPC payload checks, content types, the error page escaped, and the question when the window closes while a save still fails (the game's own words, Stay by default; asked by the main process from what the page last said, not twice after the game's Quit asked, and once for one close) |
| `workflow.test.js` | The build and deploy config: tests before the build, the quoted glob, every test file real, minimal runtime dependencies, wrangler serving `dist/`, caching headers, Node 22 said in package.json's engines (a GitHub web upload drops dotfiles, so nothing the build or gate needs is one), the desktop and tools packages kept apart, the Content-Security-Policy |
| `determinism.test.js` | Same seed and inputs produce the same state hash at 60 s, twice; a recorded run replays tick for tick, and so does a Harpooner run with enemies dazed on hundreds of ticks; a replay from another build is refused; the random streams are separate; and a fixed run on a frozen copy of the data (`tests/fixtures/sim-golden-data.json`) matches a stored hash, so only sim code or the math under it can move it (this catches math drift between engines; `tools/smoke` also runs it inside the packaged Electron) |

The gate never asserts timings. Cloudflare's build machines vary, and a flaky gate blocks deploys. Claude measures the gate's total time in the workspace before every zip and trims tests if it passes 45 s.

### 14.2 Workspace-only checks (run by Claude before zips)
| Tool | Purpose |
|---|---|
| `tools/soak` | A full run at full density with an invulnerable bot: both bosses killed, then 10 minutes of overtime, up to the 3,000-enemy cap. Reports ms per tick by how many enemies were alive (against §17), garbage per tick, memory growth, and pool high-water marks, and fails on any budget miss, pool refusal, or a boss left alive. Run for both characters before every zip |
| `tools/bots` | `harpooner-trials.mjs` plays the Harpooner trials of §20 call 44 again (her Phase 3 kit, holding her ground with and without armor for it, twice the crowd armor, and the daze, on the same seeds) and prints the table in HANDOFF.md. `bots.mjs`: balance sweeps: N runs per character and per **build archetype** (orbit tank, projectile storm, burning-ground kiter, summoner, chain lightning, speed glass cannon), spread over worker threads. Reports survival time, how many runs cleared and killed the first boss, deaths by minute, the level at 10:00 and at the end, and kills. v1 (Phase 2) plays one careful bot (`sim/bot.js`: it scores 16 directions by danger and wants, circles the crowd at weapon range, fights bosses up close between their attacks, and dashes out of trouble) with draft preferences per archetype; DPS by minute and per-archetype play styles come with the balance phase. This is how the brief's "6 archetypes viable at the top difficulty" gets checked |
| `tools/pacing` | The progression simulator from §10.3: bots measure what a run from a fresh profile brings home (`measure.mjs`; kept in the repo in `tools/pacing/yields.json` with the fingerprint of the code that measured them, `yields.mjs`), then 40 simulated players each play until the harbor has nothing left, through the real meta layer (`model.mjs`), and the report (`report.mjs`, which the gate runs on the committed yields) says what it stands on, then gives each milestone's median hours and range against its target, the runs between new things, the MVP hours on the shortest third of the runs, and the fresh profile's share of the run content |
| `tools/shots` | Headless Chromium screenshots of scenes at set moments, so Claude can check visuals by looking (`--query "shot=levelup&busy=1"`: title, levelup, chest, pause, settings, tuning, end, or run; busy adds a crowd; `jump=596` starts late, to meet a boss; `char=harpooner`; the harbor: hub, building, gate, results, ceremony, arrival, with `levels=library:3,...`). `shot=loop` plays the whole loop through the real screens and saves (restore the Lamp Post, its ceremony, set out from the gate with the profile's own pools, leave, back to the harbor, the results) and fails if any step doesn't happen. The renderer is software, so these say nothing about frame rate. `harbor-probe.mjs` measures, on that renderer with the page's clock stopped between frames, the fog's share of the picture at known densities and a newcomer's brightest pixel tick by tick across her step off the boat |
| `tools/atlas` | Builds the atlas from the packs (`build.mjs`; `--check` says whether the committed one is current), writes a 4x contact sheet of every frame to look at, `rig-preview.mjs` draws each boss rig in its poses, and `hub-preview.mjs` draws the harbor at any building levels, by day or by night |
| `tools/replay` | Plays a report or replay file Kevin attached and prints the run's state at the end or at `--until m:ss`. A replay starts from the RunConfig the run started with, and records each tick's input before stepping, so a crash reproduces at its tick |
| `tools/smoke` | The desktop smoke test from §13.2 |

---

## 15. The feedback loop: how Kevin directs what Claude can't feel

- **F3 debug overlay:** fps, frame time, sim time per tick, entity counts, draw calls, dropped events, seed, and build.
- **Tuning panel** (F1, or hold Create / View for 1 s; the run pauses while it's open): left and right change every number in `data/tuning.js`, such as knockback, flash length, hit-stop per event, shake per event, magnet radius and pull curve, gem merge threshold, player speed, enemy speed, density multiplier, XP curve multiplier, and dash distance and cooldown. It also shows the run's character's own numbers, under `character.<id>` (the Harpooner's daze, pull, and crowd armor; the Lamplighter's growth per level), which live in `data/characters.js` rather than the tuning (Phase 4). Changes apply live. **"Copy tuning"** puts a text block on the clipboard (and, on the desktop, writes it to a file) that Kevin pastes into the chat. Claude folds it into `tuning.js`. "Reset" restores the defaults.
- **Dev commands** (inside the tuning panel): spawn 500 or 2,000 enemies, jump to 9:50 or 19:50, give any weapon, passive, relic, or rune, level up, god mode, heal, and clear the screen. They stay in every build, hidden behind the panel.
- Every tuning change and dev command is a logged decision (`sim/dev.js`), so replays and reports stay exact.
- **In the harbor** (Phase 5) the same panel opens the same way and lists the harbor's own numbers (`HUB_TUNING` in `data/tuning.js`, under `hub.`: the set pieces' timing, the walks, the reach, and the whole look of the night and the fog, its dust, smoke, and puffs in groups of their own). They change live (`hub/tuning.js`: the world reads its timing every tick, the view its look every frame) and last until the game closes; the harbor doesn't pause. Each number keeps within its range (`HUB_TUNING_RANGE`, beside it in the data: above 0 for what the harbor divides by, 0 to 1 for a brightness, a thickness, or a share, either sign for a boost, a drift, or an offset, 0 or more for the rest), so the panel can't set one the harbor can't draw. Its dev commands are **Add 100 (or 1,000) of every material** the maps drop and **Unlock everything** (every building at its last level and every research project done, the harbor redrawn at once without ceremonies). They change the saved profile like a purchase (`meta/dev.js`) and mark it (`profile.flags.devTools`), so a save or report that shows fast progress says why; a run that used the tuning panel or its commands marks it the same way when it's folded in. "Copy tuning" there gives the harbor's changes; a report carries both. Colors and the one list (the night's ambient color) are changed in the data, not stepped.
- **Reports** from §12.4.
- **How Kevin gives feedback:** plain words plus the time in the run ("at 14:00 the screen turns to mush"). The report file or copied tuning when it's available. Claude never asks him to describe numbers he can adjust himself with a slider.

---

## 16. Art pipeline

### 16.1 Division of labor (approved by Kevin, Sep 27 2026)
- **Kevin's ruling on packs (Sep 27 2026):** the **Kenney 1-Bit Pack** for everything in runs (enemies, props, run maps), and **Kenney Tiny Dungeon + Tiny Town** for the player and every playable character, the hub buildings, and the hub NPCs. Both are remapped into one palette, on the same 16 px grid, with the same outline treatment. The style change happens at the scene boundary (run vs hub); in a run, the player's richer sprite standing out from the flat 1-Bit horde is the readability rule working. The hub's water, pier, and boats (which Tiny Town lacks) are drawn in code in B's style. Limit: Tiny Dungeon has about 15 human characters, so a few of the 16 playable characters at v1.0 will be recolors.
- **CC0 packs:** characters, enemies, buildings, NPCs, and tiles.
- **Code:** every effect, the lighting, the fog, the construction stages in the hub, telegraphs, UI frames, glyphs, and gap sprites.

### 16.2 Pack choice (decided Sep 27 2026; the analysis that led there)
The shortlist, all 16×16 and CC0:
- **Kenney Tiny Dungeon + Tiny Town.** Kenney announced Tiny Town as a pack that "perfectly fits the previous Tiny Dungeon release." It covers buildings, terrain, characters, and monsters in one style. It's small (about 130 files each), and the harbor and sea coverage is unverified.
- **Kenney 1-Bit Pack.** 1,078 monochrome tiles. Because every sprite is one color on transparent, it recolors perfectly into any palette. That gives full palette control for the fog-and-lamplight mood, and the coverage is broad. The cost is less color detail per sprite.

These are two alternatives, not a mix. The brief requires one pack family, and Tiny Dungeon plus Tiny Town count as one family because Kenney made them to match. Code fills the gaps in whichever one is chosen, in the same style.

Selection criteria: coverage of docks, boats, water, sea creatures, drowned sailors, and fog things; readability at 16 px in a crowd of 1,000; and how many gaps code would have to fill.

The workspace can't reach kenney.nl. Kevin downloads the zips and attaches them.

### 16.3 The atlas builder (`tools/atlas/`)
Built in Phase 4. `node tools/atlas/build.mjs` (workspace only: it needs the packs).
- **Inputs:** the raw pack files (kept in the workspace, never committed; `--packs` or `$LAMPLIGHT_PACKS`, default `../packs`), `art/manifest.js`, `art/draw/`, `src/data/palette.js`, `src/render/rigs.js` (the rigs' layout, not how they move), and the data (each icon's first tag picks its border and default colors). The committed inputs are found, not listed: every file the builder imports, followed through the tree (`tools/atlas/sources.mjs`), so a drawing that starts using another helper is covered the day it does.
- **One-color sprites** (the 1-Bit Pack, and every sprite drawn in code as a mask) are colored with a **ramp**: light on the top and left edges, the body color, shade on the bottom and right, enclosed holes (eyes, mouths, carved runes) filled so they read as features, then a one-pixel night-0 outline. Code-drawn sprites go through exactly the same treatment, which is what makes them match the pack. A boss part is several masks, each in its own ramp, outlined as one shape.
- **Full-color sprites** (Tiny Dungeon, Tiny Town) are **remapped**: the colors an entry lists go where it says (the pack's plum outline becomes night-0; the Lamplighter's purple dress becomes amber), anything else goes to the nearest palette color in OKLab.
- **Generated variants:** a white flash silhouette of every actor and part; an elite version of every enemy frame (twice the size, pixels still square, with a dark line and a gold line around it); animation frames (`<id>@<k>`); each boss's resting pose as one frame (from its rig); icons framed at 18 x 18 with a border in their tag's color. **Ramp swaps** are one manifest entry each: the same tile with another ramp (a drowned sailor and a frozen one), for the content passes.
- **Output:** `src/assets/atlas.png` (one page, 512 x 256 at Phase 4) and `src/assets/atlas.json` (each frame's rectangle, animations, rig parts, and two fingerprints). The atlas lives in `src/assets/` rather than `public/`, because Vite gives the PNG a content-hashed name: the page and its atlas can never come from different builds, and the file is cached forever like the rest of the bundle (§20 call 37). The builder also writes `tools/out/atlas-review.png`, every frame at 4x, to look at.
- **Automatic checks** (the gate, `tests/art.test.js`): the committed atlas's **source fingerprint** must match its committed inputs (code only: comments don't count, and neither does spacing wherever closing it up couldn't join two tokens, so a formatter pass is free; the insides of strings and templates do count, since a sprite drawn as text rows counts its spaces), so a manifest, drawing, palette, or builder change can't deploy with a stale atlas; the failure names the inputs and says to rebuild in the workspace. Every sprite referenced in data exists, every color on the page is a palette color, and the readability and contrast rules below are measured on the real pixels. The packs' own fingerprint is recorded too, for the workspace to compare.

### 16.4 Readability rules
Checked by `tests/art.test.js` on the atlas's pixels.
- The player is warm and the highest-contrast thing on screen, and is never tinted: every character is brighter on average than every enemy, warm (red well above blue), and at least 4.5:1 against the floor (WCAG's contrast ratio of relative luminance).
- Enemies use cool, desaturated ramps (more blue than red, OKLab chroma at most 0.1), at least 2:1 against the floor; the lamp and the outline carry them in the dark. Every animation frame and every elite's body is measured.
- XP gems are bright cyan (blue and green well above red, and clearly brighter than any enemy).
- Materials get distinct icons with outlines (no two share a picture).
- Projectiles are warm and light; enemy shots are red-orange (red over green over blue, with a hue redder than any lamp color, so they never read as the player's amber).
- Hazards pulse red-orange (the same hue test) for at least 0.8 s before they hurt.
- The ground is always darker and lower-contrast than every actor (its own lightest and darkest pixels are under 1.5:1 apart); obstacles sit between the floor and the actors.

### 16.5 Code-drawn sprites
Code-drawn sprites follow Kevin's DCD render-and-look discipline. A pass counts only if it names one concrete comparison against a real reference (for example, "a real harpoon's barb is a single rear-facing hook; mine has two, fixing"). Technical checks are necessary, and they are never reported as having looked. Each drawing in `art/draw/` names its reference in a comment. Phase 4's comparisons, and what they changed:
- **Harpoon shot:** a whaling harpoon has one barb swept back; the placeholder's head was an arrowhead with two. Now one.
- **Dock boards:** a pier's boards run several feet before they end; the first boards put an end in every board of every tile and the deck read as a brick wall. Now a tile shows one end at most, half the floor none, staggered, and the tiles are placed by a well-mixed hash (the first hash repeated every 4 tiles, so the whole map was one 4 x 4 block).
- **Crab:** a shore crab seen from above is wider than long, claws up in front, legs out to the sides; the pack's nearest creature stood upright like a bear with raised arms. Drawn in code. The first drawing closed each claw into a ring and the claws read as eyes; the pincers are open now (the gap between the fingers shows).
- **Gull:** a herring gull in flight has long narrow wings bent at the wrist (the V of the upstroke, the M of the glide).
- **Ship's bell** (Tide Bell, Storm Bell, Seventh Bell, the Tidecaller's bell): the lip is the widest, thickest part, and the flare starts low, not at the top like a cup.
- **Anchor** (Ballast): ring, stock, straight shank, arms curving up into flukes. **Horseshoe magnet** (the Lodestone): a U, its two arms straight and parallel down to one round bend, red body, pale bare poles at the tips; the first drawing didn't read as a U (Kevin, 0.6.1). **Hurricane lamp** (Glass Lantern): bail handle, vented cap (the first cap was solid; the vents are gaps now), bulging globe between guards, squat tank. **Street lamp** (the title): four-sided lantern under a peaked cap, a ladder bar, a tall post, a flared base.
- **Salt Glass:** salt glass breaks into long, narrow, pointed shards; the first drawing was a gem-cut diamond with a dark middle and read as an eye. Now a shard.
- **The Lamplighter's lantern:** a hand lantern's glass is its widest, brightest part, under a dark cap, on an open loop handle; the first one was a blob at her side. **The Harpooner's harpoon:** one swept-back barb, and a shaft much longer than the iron.
- **The Harbor Maw:** an anglerfish's lower jaw juts past the upper, its teeth are thin needles slanting inward, its eyes are small and high, and its lure is a spine with a glowing bulb.
- **The Tidecaller:** a monk's cowl is its own pointed shape resting on the shoulders, and the opening is the darkest thing on the figure. The first rig left the staff floating beside the robe; the sleeve now reaches it, and a bony hand (its own rig part, drawn over the staff) grips the pole with its knuckles in a row. An octopus arm tapers from a thick root to a fine curled tip; the first tentacle was a short hooked stub and read as a claw.
- Phase 6's comparisons, and what they changed:
  - **Signal Mirror:** a heliograph mirror is round with a sighting hole in the middle and a short grip; the icon has the hole and the grip, and rays off the rim. Its shot (the glint) is a four-point star, brightest in the middle, as sunlight off a mirror looks.
  - **Oil Flask:** a fire bottle is lit before it's thrown, so the flask in flight carries a burning rag at the neck; it's drawn upright (a flask tumbling end over end at this size read as a smear).
  - **Lightning Rod:** a lightning rod is a pointed iron rod on a base; a bolt comes down in sharp, uneven steps, never a smooth curve (the bolt line in the run view jags in six uneven steps).
  - **Corpse Candles:** a will-o'-the-wisp is a small flame narrow at its tip with no candle under it; the shot is that flame, upright (a flame turned to face its flight read as upside down). The icon's candle stubs stand on a skull's crown; the judges read it as a candelabra, which it nearly is.
  - **Wreck Lantern:** a ship's lantern has a ring on top, a cage of bars round the glass, and a heavy base; this one has a pane gone.
  - **The wreck:** a beached hull from above is a long boat shape, its sides closing to a point at the bow, the stern square; the first wreck was a box with its corners cut and read as a pen. Now it tapers to an east bow.
  - **The wharf's water:** a slip at night is near black, lit only where a lamp reaches; its stone lip shows along the quay with the quay's shadow on the water below it.
  - **Phase 7's signs** (one each, over the door from the keeper stage on): the Docks an anchor (the ring, the stock, the shank, the two arms curving up); the Smithy an anvil (the flat face lit, the horn tapering to a point on the left, the narrow waist, the wide foot); the Chapel a bell (the round crown, the flared lip, the clapper); the Market a pair of scales (the post, the beam, a pan from each end); the Apothecary a stoppered bottle (the cork, the narrow neck, the round body, green showing through); the Cartographer a compass rose (four points, north in red). The six buildings are the pack's house with their own sign and keeper, which is the pack's limit; whether they read as different places at play size is Kevin's call.
  - **The Ferryman's skiff:** a rowing skiff from the side is shallow and wider than tall, its bow raked up higher than its stern, a pole standing in it.
  - **A Reliquary:** a reliquary box is smaller and more ornate than a sea chest, its lid rounded, a lock plate at the front.
  - **Gear:** a storm lantern has a ring on top, a square frame round a lit pane, and a heavy base (drawn, since the pack's lamp reads as a post); a ring is a band with a square stone set on top, its middle empty; the rest are the pack's (a coat, a cloak, boots, a compass, a charm, a bell for the pendant).

### 16.6 Placeholder art
Until Phase 4, placeholder art was simple code-drawn tokens (retired in Phase 4; the effects, particles, font, and gems it drew moved to `art/draw/effects.js` and into the atlas).

### 16.7 The harbor's art (Phase 5)
- **Pack B, strictly remapped.** Tiny Town's ground, trees, fences, props, and buildings, and Tiny Dungeon's townsfolk, go through one color table (`TOWN_COLORS` in the manifest) in the palette's middle values; the hub view's light map makes the night. The table is strict: a color nobody listed stops the build, so the harbor's look is chosen, never a nearest match by accident. A few entries recolor their own tiles (the paths a step darker than the planks the same colors make on a wall; a stone gable on the Library, a timber one on the Tavern).
- **Buildings are layouts**: rows of Tiny Town tiles (two rows of roof with a chimney or dormer and the gable, then the walls, windows up and down, the door in the middle), one frame per stage. The stages are done in code on the composed building (`art/draw/hub.js`): boarded windows, lit windows, a sign and a door lantern, window boxes; the ruin; and a scaffold drawn over the ruin. The windows' glass sits at the same pixels in the pack's window tiles, so lighting and boarding find it by position.
- **Drawn in code in the pack's style**: the sea (three frames of swell), the pier, the quay and its sea wall, the square's setts, the town lamp, the boat. Each names its reference, as in §16.5:
  - **Water at night:** nearly black, short broken crests catching what light there is, uneven and drifting; never regular stripes.
  - **The pier:** the deck boards run across the pier (they sit on stringers that run along it), seams dark, nails over the stringers, pilings with round tops along the outside edges.
  - **The quay:** big granite setts in courses, the joints staggered, worn lighter on their top edges. **The sea wall:** coping stones on top, rough courses below, wet and darker toward the water with a line of weed.
  - **The square's setts:** small stones in running bond, one in a few darker, moss in the joints. (Tiny Town's cobble tile is stepping stones in grass; on a square it read as a field of flowers.)
  - **The town lamp:** a four-sided lantern with a domed cap and finial, glazing bars, a cone under it, the ladder bar, a tall column with a collar, a stepped plinth. It is dim until the Lamp Post's first level.
  - **The boat:** the sheer sweeping up to bow and stern, a mast about as long as the hull, the mainsail aft of it on a boom, a jib forward, a lantern at the stern, dark at the waterline.
  - **A ruin:** with the roof gone you look down into it: the dark inside, the tops of the side and back walls (broken low in places, in the walls' own material), a floor of boards with some gone and weeds through it, fallen timbers and stones; the front wall ragged at the top and cracked, windows empty or boarded, the door boarded.
  - **The scaffold:** standards every couple of meters, ledgers at each lift with planks, braces in the bays, a ladder to the first lift. **The wall lantern:** a cap, three lit panes brightest at the top, a frame, a finial (the first was a one-pixel sliver and read as an exclamation mark). **Window boxes**, **the Tavern's sign** (a tankard), **the Library's sign** (an open book).
- `tools/atlas/hub-preview.mjs` draws the whole harbor from the committed atlas at any building levels, by day or by night, with the game's own picks: tiles, building stages, lights, the lamp's reach, props, people, the fog's density, and the look (`render/hubtiles.js`, `meta/state.js`, `HUB_TUNING.look`); `--boat` adds a boat tied up at the pier with its newcomer stepping off, in the shade the view gives her.

## 17. Performance budgets

| Item | Budget | Status |
|---|---|---|
| Sim tick at 1,000 enemies | ≤ 2 ms in the workspace | Phase 2 soak: p99 1.3 ms with up to 1,000 alive (Phase 0 prototype: 0.46 ms) |
| Sim tick at 2,000 enemies | ≤ 4 ms in the workspace | Phase 2 soak: p99 2.7 to 3.0 ms with 1,001 to 2,000 alive |
| Sim tick above 2,000, up to the 3,000 cap (late overtime only) | ≤ 6 ms in the workspace | Phase 2 soak: p99 4.8 to 5.4 ms. Crowd separation runs on alternate ticks (half the crowd each tick, at twice the strength), which cut the busiest ticks by about a third |
| Frame at 1,000 enemies on a mid-range PC | ≤ 8 ms total | Kevin reads it from the F3 overlay. Phase 3, in the workspace (software GPU): the run view's own JavaScript takes about 1.3 ms a frame at 1,500 enemies, in 16 draw calls |
| Garbage from the sim | No per-entity objects; total garbage under 64 KB per tick | Phase 2 soak: about 10 KB per tick over 33 to 38 minutes (everything allocated while stepping, the bot and the level-up draws included), heap growth under 4 MB. The rule that got it there from 65 to 100 bytes per enemy per tick: **V8 boxes every fractional number passed as an argument to a call it doesn't inline, or returned from one (16 bytes each)**, and it inlines within a per-function budget, so nothing guarantees a given call is inlined. Hot loops (per enemy, per shot, per hit) therefore pass numbers through typed-array registers in `world.scratch` (`reg`, `qreg`, `hit`, `num`, `xreg`), each with one owner, and call the `...R` variants (`queryR`, `collideR`, `dirR`, `damageEnemyR`, `impulseR`, `explodeR`); events are written in place (`events.reserve`). Cold paths (a few calls per tick) pass numbers normally. Phase 1 measured every `lib/fmath.js` function at 0 bytes per call in the sim's pattern (`tools/bench/fmath-alloc.mjs`). Pools copy fields on removal in one loop per array type, because a loop over mixed typed arrays boxes the floats it reads |
| Pools | 4,096 each for enemies, projectiles, and gems (sim); 4,096 particles (render) | Checked in the soak test: every pool's high-water mark, and any refusal fails it (Phase 2: enemies up to 3,028, gems 1,501 with merging, pickups under 256, nothing refused) |
| Damage numbers on screen | ≤ 150 | Aggregated |
| Deploy gate | ≤ about 60 s | Measured in Phase 1 |

---

## 18. Phases and model settings

"Needs Kevin" means the phase can't finish without him. Everything else can run while he's away.

| # | Phase | Delivers | Exit check | Needs Kevin | Setting |
|---|---|---|---|---|---|
| 0 | Architecture | This document | Kevin reads it | No | **Opus 5.5 max** (done) |
| 1 | Foundation | Repo skeleton, build and deploy config, version check, test gate with boundary test, RNG, loop driver, input with recording and glyph detection, scene manager, save stores, migrations scaffold, export codec, Electron shell, packaging script, Linux smoke test, first .exe (a lamp you move with the controller) | Gate passes, wrangler dry-run passes, smoke test passes, .exe packaged | No | **Opus 5.5 high** |
| 2 | Combat core | Pools, spatial hash, flow field, enemy AI types, director and timelines, stats and tags, the weapon pipeline, 4 weapons, gems and magnet, the draft with reroll, banish, and skip, evolution mechanism, chests, boss framework with 2 placeholder bosses, overtime, RunResult, event buffer, determinism, headless run tests, bots v1, soak | 20:00 headless run stable; soak within budget; determinism holds | No | **Opus 5.5 max** |
| 3 | Feel and presentation | The full renderer (§6), feel toolkit, particles, lighting and fog v1, HUD, the controller UI navigation framework (§8), level-up, chest, and pause screens, SFX with voice limits, debug overlay, tuning panel, reports, replays, placeholder art | **FEEL GATE:** Kevin plays the web build and the .exe and signs off | **Yes, for sign-off** | **Opus 5.5 high** |
| 4 | Art pipeline and art pass | Pack decision, atlas builder, palette, variants, sprite manifest, gap sprites, procedural animation, boss rigs, contrast checks, screenshot review | Screenshots reviewed by Claude, then by Kevin | Packs attached; later a look at screenshots | **Opus 5.5 max** |
| 5 | Meta and hub (MVP systems) | Profile, `applyRunResult`, materials and drops, the walkable hub, Lamp Post, Library (basic research), and Tavern with 5 stages each, fog clearing, ceremonies, arrivals by boat, NPC basics, next-3 panel, results screen, title, settings, save integration | A run feeds the hub, and the hub changes | No | **Opus 5.5 high** |
| 6 | MVP content | Brief §7 MVP column: 1 map fully built, 2 characters, 8 weapons with 4 evolutions, 8 passives, 6 relics, 4 runes, 2 real bosses, the elite event, a secret | **MVP GATE:** Kevin plays it and it's fun | **Yes** | **Opus 5.5 high** |
| 7 | Systems pass (§10.5 and §10.6) | Six more buildings built thinly (Docks, Smithy, Chapel, Market, Apothecary, Cartographer); full research tree; equipment with research gates, upgrades, affix re-rolls, and the 5th and 6th slots; rune crafting; all relic hooks; arcana; Tide 1 to 10 and curses; consumables; character mastery and alt kits; feats with visibility; challenge runs; bestiary rewards; short run mode; a save migration for each | Content kept thin; all gates pass | Rulings only | **Opus 5.5 high** |
| 8a | Content design (per map, ×4) | Map concept, roster, materials, boss design, and new weapons, relics, and runes, using Kevin's idea-generation method | Kevin approves the design list | Approval | **Opus 5.5 high** |
| 8b | Content build (per map, ×4) | Data entries, sprite mapping, and new behaviors built on the existing pipeline | Gates pass; bots show the map is survivable | No | **Sonnet 5 high** |
| 8c | New bosses and new pipeline stages | Boss rigs and attack patterns; any emitter, motion, or on-hit type that doesn't exist yet | Gates and soak pass | No | **Opus 5.5 high** |
| 9 | Balance and pacing (after each content pass) | Bot sweeps, archetype viability, economy curves, proposed changes | Kevin approves the changes | Approval | **Opus 5.5 high** |
| 10 | Endgame | The Lighthouse, the final boss, Prestige (New Tide) with its authored variants, Tide 11 to 20, secrets (hidden map, secret characters, secret evolutions), codex, bestiary, completion % | A full cycle from New Tide back to the Lighthouse works in the pacing sim | Playtest | **Opus 5.5 max** |
| 11 | Release polish | Settings completeness, credits, icon, exe metadata, performance tuning from Kevin's F3 numbers, accessibility | Kevin's call | Yes | **Sonnet 5 high** |
| — | Tuning rounds from Kevin's notes | Numbers changed by name, gate, zip | | | **Sonnet 5 medium** |
| — | Bugs outside the sim core and saves | | | | **Sonnet 5 high** |
| — | Bugs in the sim core, determinism, or saves and migrations | | | | **Opus 5.5 high** |
| — | "Delta the repo", zips, doc updates | | | | **Sonnet 5 medium** |

**Order while Kevin is away:** 1 → 2 → 3 (built, then waiting for the feel gate) → 4 (as soon as the packs are attached) → 5.

This bends the brief. Brief §10 says to stop after the feel prototype and tune before building the MVP slice, and Phase 5 is part of that slice. The reason for bending it: Phases 4 and 5 don't depend on how combat feels. Anything the feel gate turns up gets fixed in `sim/` and `tuning.js`, without touching the art pipeline or the hub. Content (Phase 6 on) still waits for the gate. This is builder's call 16 in §20; if Kevin overturns it, work stops after Phase 4.

**How the phases map to the brief's content milestones (§7 of the brief):**

| Milestone | Reached after | Content added per content pass (8a + 8b + 8c) |
|---|---|---|
| MVP | Phase 6 | (the MVP column) |
| v0.5 | Phase 7, plus content passes for maps 2 and 3, plus Phase 9 | Each pass: +1 map, +2 characters, +6 weapons and +4 evolutions, +5 passives, +7 relics and +4 runes, +2 bosses |
| v1.0 | Content passes for maps 4 and 5, plus Phase 10 | Each pass: +1 map, +4 characters, +8 weapons and +6 evolutions, +6 passives, +12 relics and +6 runes, +2 bosses. Phase 10 adds the secret map, the secret characters (+2), and the final bosses |

When phases compete for time or polish, priority follows the brief's scoring weights (§11 of the brief): core combat 25, progression depth 20, quality 15, longevity 10, build variety 10, hub 8, session fit 5, originality 4, presentation 3.

**Settings grouped:**

| Setting | Work |
|---|---|
| Opus 5.5 max | 0 Architecture (done), 2 Combat core, 4 Art, 10 Endgame |
| Opus 5.5 high | 1 Foundation, 3 Feel, 5 Meta and hub, 6 MVP content, 7 Systems, 8a Content design, 8c Bosses and new pipeline stages, 9 Balance, bugs in the sim core or saves |
| Sonnet 5 high | 8b Content build, 11 Release polish, other bugs |
| Sonnet 5 medium | Tuning rounds, delta and zip chores, doc updates |

Nothing is on Opus medium or Haiku. Work clear enough for Opus medium is done as well by Sonnet high for less usage. Haiku is too likely to trip the zip and test rules, and a broken gate blocks every deploy until it's fixed. If Fable 5.1 is available and usage isn't a concern, the Opus max group is where it pays off most; nothing requires it.

---

## 19. Session protocol

**Starting a phase:** a new chat on the setting from §18. Attach the latest `lamplight` zip and say "Run phase N." The session then:
1. Reads `BRIEF.md`, `ARCHITECTURE.md`, `HANDOFF.md`, and `DECISIONS.md` completely.
2. Confirms the setting fits the phase. If the work turns out to need a higher setting (for example, a Sonnet session hits a sim-core bug), it stops and says so rather than pushing through.
3. Posts a task list.

**Before every zip, at the end of a phase or not** (tuning rounds and bug fixes included):
- Run the gate, the production build, `npx wrangler deploy --dry-run`, and `tools/soak`.
- If a file was deleted or renamed, list the exact paths Kevin must delete in GitHub, because a zip can only add and replace. Avoid deletions and renames where possible, and record pending deletions in `HANDOFF.md` until Kevin confirms them.

**Ending a phase:**
1. Runs the checks above. For milestone phases (1, 3, 6, and later on request) it also packages the .exe and runs the smoke test.
2. **Drift check:** compares the work against the phase's row in §18 and against the brief's hard rules (§2 of the brief), and says plainly if anything drifted.
3. Updates `HANDOFF.md` (state, what's done, what's next, questions for Kevin) and appends new builder's calls to `DECISIONS.md`, each with date and phase, so Kevin can veto them.
4. Bumps the version (`0.<phase>.<n>`).
5. Delivers **one** repo zip, the newest only. Until Kevin's first push, every zip is the full repo, because the baseline hasn't been reset yet. After he says "delta the repo," zips contain only files changed since then. Zips stay at 100 files or fewer and 25 MB per file; a larger set is split into numbered parts with the push order stated. When the test script changes, the zip carries every test file it names.
6. The .exe zip, when there is one, is a separate delivery.

**Split uploads:** each GitHub web upload is one commit, and each commit triggers a Cloudflare build. When a delivery must be split, a build triggered by an early part can fail. A failed build doesn't deploy, so the last good version keeps serving (Phase 1 confirms this in Cloudflare's documentation). Kevin's first push will likely be a split, because the repo will pass 100 files around Phase 3. That's harmless: there is no previous deployment to lose, and the build after the last part is the one that counts.

The workspace may be wiped between sessions, so the zip is the only state that carries over. Nothing important lives only in the workspace, except raw art packs, which Kevin re-attaches when needed.

---

## 20. Builder's calls for Kevin to confirm or overturn

Each is also logged in `DECISIONS.md`. Silence means accepted.

1. A web playtest build exists alongside the .exe, purely for fast iteration.
2. Plain JavaScript, not TypeScript.
3. DOM menus over a Pixi world and HUD.
4. The world renders at 640×360 and scales by whole numbers. Lighting is soft; sprites are crisp.
5. Dash is in the feel prototype, on by default, with a tunable cooldown and distance. It gives brief invulnerability, and it's never an attack.
6. The player keeps all materials on death.
7. Research advances only on runs that reach 5:00 or kill a boss.
8. The MVP buildings are the Lamp Post, the Library, and the Tavern.
9. Maps are bounded at about 256×256 tiles (4,096 px square, about 6 screens across) with a fog wall at the edge.
10. Relics come from elite and boss chests plus a rare draft card. (Overturned by Kevin in Phase 7: Reliquaries, the vault, the Ferryman, and secrets instead, §10.8 and call 82.)
11. A new version never reloads the playtest build mid-run. It waits for the hub or title screen. (This departs from the brief's literal wording.)
12. Enemies don't y-sort among themselves.
13. Skip on the level-up screen is a hold, so it can't happen by accident.
14. The Library starts with one research slot, and later levels add more.
15. "Lamplight" is the working theme. Swapping it is cheapest before Phase 6, because content names come from the theme.
16. Phases 4 (art) and 5 (meta and hub) run before the feel gate, while Kevin is away. Content still waits for the gate (§18).
17. Prestige also keeps character unlocks, codex discoveries, feats, lifetime stats, and settings, on top of the brief's list (§10.7).
18. Materials are assigned to maps per §10.5, so everything the MVP needs drops on map 1.
19. The engine's "Curse" stat is named `density`, so it can't be confused with the Chapel's Curses.
20. Cross-engine determinism uses the sim's own math functions (`lib/fmath.js`) instead of the engine's trig.
21. The tuning panel opens on a 1-second hold of Create (View on Xbox), not the Create + Options chord, so it can't also trigger Pause (Phase 1).
22. Display mode changes to or from borderless reopen the window (and reload the page), so they're offered only at the title or hub (Phase 1).
23. Weapons that fire the way you face bend their shots onto the nearest enemy within 40° of that direction (§5.8). The player still never aims (Phase 2).
24. Contact damage comes from the hardest-hitting enemy touching you, then 0.5 s of invulnerability; a crowd jostles you at most 9 px a second, and bosses and warned enemies don't budge (Phase 2).
25. Enemies gain 12% of base health and 3% of contact damage per minute, in a straight line; overtime compounds on top; bosses keep their listed health (Phase 2).
26. The last boss's chest opens on the spot, before the stay-or-leave choice (§5.11, Phase 2).
27. Nothing earned is lost to a full pool: big gems past 1,500, materials straight into the haul (§5.3, Phase 2).
28. Swarm walls vanish without counting as kills once they're far off screen (Phase 2).
29. Tuning changes and dev commands are logged decisions, so a run tuned mid-way still replays exactly (Phase 3).
30. The ground is a live layer of the tiles in view, not pre-baked chunks (§6.2, Phase 3).
31. Fog v1 is drifting noise with the lights erased out of it, with no custom shader (§6.2, Phase 3).
32. The menus use Jersey 10 (a free pixel font, SIL Open Font License); the HUD and damage numbers use a code-drawn 5×7 font (Phase 3).
33. Until the hub exists (Phase 5), a run's materials and totals go straight into the profile, so nothing earned in playtests is lost (Phase 3; since Phase 5, `applyRunResult` does this, and the results show in the harbor).
34. A minimal title screen (the lampyard behind it), a character choice, and Credits, so the feel gate can start runs; Phase 5 builds the real title and results (Phase 3; since Phase 5 the title's Start or Continue goes to the harbor, and you choose who sets out at the gate).
35. Warnings are drawn above the light and fog, so a hazard is never lost in the dark (§6.2, Phase 3).
36. The web build's Save report downloads the file (Phase 3).
37. The atlas ships in `src/assets/` (Vite fingerprints the PNG) instead of `public/atlas/`, so a page can never load an atlas from another build (§16.3, Phase 4).
38. The characters come from Tiny Dungeon: the Lamplighter is its tile 99 (recolored to an amber dress and auburn hair, with a lantern drawn in her hand), the Harpooner tile 100 (white hair, a red coat, a harpoon drawn upright in her hand) (Phase 4).
39. The enemies come from the 1-Bit Pack: the fog wisp (419), drowned sailor (471), bloater (367), bilge rat (423), lantern eater (271, a moth), wreck gunner (74), and drowned bosun (466). The gull and the mud crab are drawn in code, animated, because the pack has no bird in flight and no crab that reads as one (Phase 4).
40. Elites stay twice the size, pixels still square, with a dark and a gold line around them. It is the one place the world mixes pixel sizes: a bigger silhouette is what says "this one carries a chest" (Phase 4).
41. The bosses are rigs drawn in code: the Harbor Maw an anglerfish whose lure glows like a lamp (it lures lamplighters), the Tidecaller a hooded figure ringing a green bronze bell on a crook, with tentacles under its robe (Phase 4).
42. Icons are 18 x 18: a 16 px picture (mostly from the 1-Bit Pack) on a dark square, framed in the item's tag color, and tinted in that tag's colors (Phase 4).
43. The palette gains a skin ramp and a wood ramp (for the characters, props, and later the hub) (Phase 4).
44. The Harpooner: what she hits is dazed for 0.4 s (it can't walk or hurt her; bosses are immune), in place of Kevin's suggested bonus for standing still, which was tested and dropped. In the bot trials (`tools/bots/harpooner-trials.mjs`: 12 runs of up to 24 minutes per version, same seeds), no standing-still version beat plain kiting (14.5 minutes alive on average): holding her ground in the crowd she reels in gave 10.2 to 12.3 minutes with armor, healing, or extra damage for standing still, and standing still only when nothing was near gave 11.0 to 13.2. The game also gives too many reasons to move. The daze took her to 21.3 minutes and 3 deaths in 12 (from 9). In the standard 24-minute sweep she clears 8 of 12 and dies in 1, against the Lamplighter's 7 and 3 (§5.12, Phase 4).
45. The atlas's source fingerprint ignores comments and spacing that can't change the code, so editing a comment or running a formatter never asks for a rebuild that needs the art packs (Phase 4).
46. The player is drawn above the light, the fog, and the warnings, so she is never hidden by them; she no longer sorts behind elites and bosses (§6.2, Phase 4).
47. An enemy in the middle of a warned attack (a crab winding up or dashing, a gunner aiming, a boss warning or charging) is neither dazed nor frozen: holding it would stop its attack's clock, and it would strike after its warning had ended. Its attack goes off when the warning said, and a boss's charge, once warned, runs its course (§5.12, §5.13, §16.4, Phase 4).
48. A dazed enemy reels (a quick sway) instead of dimming, because a dimmed enemy would break the contrast rule for enemies (§6.4, §16.4, Phase 4).
49. The Lamp Post's upgrades (the capped stat tree): ten upgrades over five tiers, one tier a level; each rank costs its first rank times the rank; at most 25% from any one of them at its last rank (a percent, a "more", or a flat bonus against its base), except Second Wind, the last tier's one revival, by design. They are the one place the harbor adds bigger numbers (§10.4, Phase 5).
50. The Library's research (tier 1 to 3, one to three projects at a time with its levels): seven projects that put things into your runs (the Lantern Orb, the Tide Bell and Undertow, runes, the Ballast, the Almanac and the Lucky Knot, the Backfire rune, Volatile Gems). A project finishes after its number of runs that last 5:00 or kill a boss (§10.2, §10.6, Phase 5).
51. The Tavern brings the Harpooner at level 1 (she arrives by boat) and the four relics at levels 2 to 5 (§10.4, Phase 5).
52. You walk the harbor as the Lamplighter; the other characters you have wait on the square, and you choose who sets out at the gate at the quay's west end (or from the harbor's menu, or "Set out again" on the results) (§10.4, Phase 5).
53. The harbor's keepers are Old Wick (the Lamp Post), Silas (the Library; the pack's townsman in a long ink-violet coat, since its robed scholar read as a wizard; the librarian is a man where the first draft had a woman, because the pack's two women are the playable characters), and Bram (the Tavern). Each stands by the door from level 4 and walks the streets from level 5 (§10.4, Phase 5).
54. The fog is a wall: you can't walk into a region that hasn't cleared, and a building comes out of it all at once (never half fogged) (§10.4, Phase 5). Kevin had it taken out in 0.6.0, then, seeing it was how the town shows its progress, had it put back (0.6.1). The night stays the lighter dusk he asked for, so what's cleared is easy to see.
55. Props appear as the town comes back (a well, a tub, a cart on the square; a cart by the Library; barrels by the Tavern), and they are solid (§10.4, Phase 5).
56. A ruin is drawn as the building looked down into with its roof gone (the pack has no ruins), and level 1 puts a scaffold over it before level 2 puts the roof back (§10.4, §16.5, Phase 5).
57. The boat bringing someone in is drawn over the fog, its lantern showing through, so the camera following it never shows a screen of fog (§10.4, Phase 5; back with the fog in 0.6.1).
58. The run's end screen offers "Back to the harbor" (the results show there) and "Run again" (straight out, the results already saved) (§10.2, Phase 5).
59. The first costs, from the pacing simulator with the bots' yields (a fresh profile's run, measured through the 20:00 boss: about 22 minutes, 141 Coin, 81 Oil, 44 Drowned Pages, 36 Timber, 23 Rope, 12 Rum, 4 Iron, 2 Map Scraps): the first building level at the end of run 1, the Harpooner at run 2, the first research at run 2, the MVP harbor fully restored in about 7 hours (5.6 to 8.6). The bots last longer than a new player will, so real play will be slower: on the shortest third of the bots' runs it is about 18 hours. The costs are one data file, and Kevin's own first runs set them (§10.3, Phase 5).
60. A fresh profile's pools hold 42% of the run content (10 of 24 weapons, passives, relics, and runes), above the brief's 30%. It falls as the content passes add more behind research and buildings; until then, a first run with fewer choices than this felt too thin to be fair to the combat (§10.6, Phase 5).
61. Every word the player reads follows `docs/WRITING.md`: labels and stat lines as the genre writes them (`+1 Pierce`, `-0.15s Cooldown`, `Requires Library Lv 2`, `Survived 7:11`), names without "The" except the bosses', flavor only on materials, enemies, and the keepers' speech, and no screen that names Claude (Kevin, 0.5.0's screenshots: "it sounds completely AI"; the language pass, 0.5.1).

62. The Drowned Docks is built by its own layout kind (`docks`): slips, footbridges, sheds, crates, and a wreck from one seed, every open tile reachable. The water is solid like the crates; swarmers still fly over it. The slips are basins with open wharf all round, not channels across the map: with channels every 32 tiles the bots' runs fell from about 22 minutes to 12 (pinned against the water); with basins they average about 19 (§5.7, Phase 6).
63. The elite event is the **Bosun's Muster** at 15:00: the Drowned Bosun as an elite captain with 24 Drowned Sailors in a ring around him, and the captain pays a boss chest (so a third evolution can come mid-run). It replaces the 14:00 sailor ring; the Lantern Eater's elite moves to 17:00 (§5.7, Phase 6).
64. The MVP secret is the Wreck Cache: a cache aboard a wreck in the map's far northeast, about 35 seconds' walk from the start in a straight line (far longer through a crowd), with no marker. It gives the Wreck Lantern (every 5th kill leaves burning oil), and finding it once puts the relic in the pools for good (§5.7, Phase 6).
65. The new weapons (Signal Mirror, Oil Flask, Lightning Rod, Corpse Candles) come from research, two at tier 1, one each at tiers 2 and 3, and have no evolutions yet: the MVP's 4 evolutions are the starting four's. Their evolutions come with the content passes (Phase 6).
66. The bosses' own attacks, the lure and the tide lanes, sit in each boss's rotation beside the shared ones rather than replacing them (§5.13, Phase 6).
67. A fresh profile's share of the run content falls to 10 of 29 (34%), still above the brief's 30% (call 60; Phase 6).
68. The costs of every building level after the first, and of every upgrade rank, are 1.5 times Phase 5's (1.15 in 0.6.0; raised in 0.6.1 because ascensions add to what a strong run kills and brings home) (rare materials rounded up), which puts the bots' MVP harbor at 8.3 hours (6.6 to 9.9), inside the brief's 6 to 10. The bots' yields swing a lot between measurements (one measurement on Phase 5's costs gave 5.2 hours, the next 9 or so), so this is a rough fit. Kevin's own runs still set them (call 59; §10.3, Phase 6).

69. Embers and ascensions (§5.16) are Phase 7 systems pulled forward at Kevin's ask (0.6.1): three ascensions a weapon line, every drafted weapon has a line, and evolutions share their base's. The Ember drops are 1 a boss, 1 a muster captain, and 15% an elite, so a run that reaches 20:00 sees about 3 to 5.
70. The minimap uncovers the ground as you see it rather than showing the whole map from the start, so the wreck and its cache stay a secret until you've been near (§6.2).
71. Stats lives in the pause menu: your character's numbers, what reaches every weapon, and each weapon's own with its DPS and Total Damage (§8; 0.6.2 changed "dealt this run" to these, call 78).
72. The harbor's guide covers the first steps only (the gate; then the Lamp Post, or back out through the gate when a run brought home too little for it); after that the Next up panel already says what's within reach (§10.4).
73. The minimap's "small icons" are small shapes, a few pixels each, one per kind of thing (a hollow red diamond for an elite, a filled one for a boss, a hollow amber box for a chest, and so on; §6.2 item 13), rather than the drops' own sprites: at 1 to 2 px a tile a 16 px sprite would cover a sixth of the map. Kevin can ask for the sprites, drawn small.

74. Forms replace 0.6.1's ascensions (Kevin, 0.6.2): three a line, one for each part of how a weapon works (how it fires, how it flies, what it leaves), so all three stack on one weapon; the Ember screen picks a weapon, then its Form; the evolution keeps them (§5.16). Their numbers are first guesses for playtesting: Kevin hasn't played them yet.
75. Burning Glass sets fire (what it leaves) and counts the beam finding the same enemy within 2.5 s (not "held in the beam"): the Signal Mirror's beam lasts a quarter second every 1.5 to 1.8 s, so a hold window shorter than its cooldown would never build. Great Toll's kills can take at most half the wait off the next ring: uncapped, a 1,000-enemy crowd had it ringing every tick.
76. Three Forms were renamed so no name is shared: Breakers (not Undertow, a passive), Full Circle (not Lighthouse, beside Lighthouse Lens), Vigil (not Wake, beside the Reaper's Wake relic). The gate checks it.
77. Planted Rod's strikes only fall within its ring (150 px): with nothing near the rod it waits, and walking 260 px off replants it where you stand. That is the Form's trade (strikes you place, not strikes that find enemies).
78. Stats shows each weapon's DPS as its Total Damage over the seconds since it was taken (kept through level-ups and the evolution), a whole number past 10 and one decimal under it (§8).

79. The six Phase 7 buildings restore with map 1's materials (Timber, Rope, Iron, Oil, Drowned Pages, Rum, Map Scraps, Coin) rather than the brief's Salt Glass, Candles, Bone, and Marsh Herbs, which have no map yet: a cost nothing drops would be a dead end. Their costs move as those maps arrive (§10.5).
80. The Docks run the Ferryman until there are maps to sail to; each map's boat joins the Docks' levels when that map is built (§10.5, §10.8).
81. Gear's slots are the brief's four (Lantern, Coat, Boots, Charm) plus a Ring and a Pendant. Every recipe's own affix changes the build (a tag's projectiles or pierce, a hook, a rule), never a flat stat; stats come only as the rolled extras; a rule affix only on a Charm, Ring, or Pendant (§10.6).
82. Relics as Kevin set them (three tiers, carry everything, never from level-ups or chests, actives on a dash, a hit taken, a kill streak), from a Reliquary, Lantern Night's vault, and the Ferryman. The Reliquary's numbers (a 0.06% chance a kill, at least 150 s apart, certain after 1,800 kills) and the tier weights by minute are first guesses for playtesting. Two plain Trinkets (Gull Feather, Brass Button) start in the pool so a first run's Reliquary has something to offer (the fresh share stays at 34%, 12 of 35, call 60).
83. Sea Glass left at a run's end is lost unless the Market buys it (half a Coin each from its level 2, one from level 4), so it is spent in the run, which is what it's for.
84. The next-3 list counts only materials in hand, not what a Market trade could make: at these rates a trade is a last resort, and a "with the Market" mark would point at it first (§10.6 had planned the mark).
85. Feats are judged only once the Tavern keeps the list (its level 1); before that, nobody's counting. Mastery XP builds from the first run, though perks are trained from the Tavern's level 2.
86. Tides open one at a time by clearing the map at the highest Tide opened (Tide 1 from a first clear), and the Chapel's level caps which can be chosen. A Tide's health multiplier reaches the bosses too.
87. A challenge run keeps the harbor's upgrades, worn gear, and trained perks: its restrictions are the pools it empties, its Tide, and its curses. Each is won once.
88. The Cartographer's hints are the map's secrets on the minimap (level 5) until there is a map select to put them on; its level 1 shows the tasks on the minimap from 0:00 (without it a task shows once you've been near).

---

## 21. Where every part of the brief lands

| Brief | Covered in | Phase |
|---|---|---|
| §2 hard rules | §1, §5.8 (no aiming), §7 (movement only), §13 (PC) | Checked at every phase end (§19) |
| §5.1 run shape, overtime, short runs | §5.7 | 2; short runs in 7 |
| §5.2 controls, dash | §7 | 1 to 3 |
| §5.3 slots, draft, evolutions, tags, runes, relics, arcana | §5.8 to §5.12, §5.15 | 2 (mechanisms), 6 (MVP set), 7 (arcana, all hooks) |
| §5.4 characters and mastery | §5.12, §10.6 | 2 (hooks), 6 (2 characters), 7 (mastery), 8 (more) |
| §5.5 feel, 1,000+ enemies, toggles | §5.4, §5.7, §6, §8 | 2, 3 |
| §6.1 the hub and all 10 buildings | §10.4, §10.5 | 5, 7, 10 |
| §6.2 materials loop, next 3 | §10.3, §10.5 | 5, 7 |
| §6.3 equipment | §10.6 | 7 |
| §6.4 research, 70% locked | §10.6 | 5 (basic), 7 |
| §6.5 characters by feats, secrets | §10.6 | 7, 10 |
| §6.6 Tide levels, curses, challenges | §10.6 | 7 (Tide 1 to 10), 10 (11 to 20) |
| §6.7 prestige | §10.7 | 10 |
| §6.8 bestiary, codex, secrets, completion % | §10.1, §10.6, §10.7 | 7, 10 |
| §7 content targets | §18 milestone table | 6, 8, 10 |
| §8 anti-goals | §1, §7, §20 | Checked at every phase end |
| §9.1 to §9.3 setup, builds, delivery | §1, §3, §13, §19 | 1, and every zip |
| §9.4 tech, input, display, data, art, audio, tests | §2, §5, §6, §7, §9, §11, §14, §16 | 1 to 4 |
| §9.5 saves | §12 | 1, 5 |
| §10 build order | §18 (with one flagged deviation, call 16) | All |
| §11 scoring lens | §18 priority line | All |

## 22. Change log

- Oct 2026, 0.7.0, Phase 7 (every building's system): §10.1 and §10.2 (the v3 profile, the gate), §10.5 (the six buildings as built), §10.6 (rewritten as built), §10.8 (new: tasks, relics, Sea Glass, the Ferryman), §11 (relic tiers, gear, challenges, the map's tasks), §12.2 (v3), §14 rows (`workshop.test.js`, `tasks.test.js`), §20 calls 79 to 88.
- Oct 2026, 0.6.2, Kevin's notes on 0.6.1: Forms replace ascensions (§5.16, two-step Ascend in §8); materials found leave the HUD for the pause menu and Stats (§6.2 item 13); DPS and Total Damage in Stats (§8); §14 rows (`forms.test.js`); §20 calls 74 to 78.
- Oct 2026, 0.6.1, Kevin's notes on 0.6.0: the harbor's fog is back (§10.4, call 54); a guide for a new player and walking off the quay to set out (§10.4); the Lodestone drawn as a U (§16.5); the run's minimap (§6.2, item 13); Stats in the pause menu (§8); Embers and ascensions (§5.16); §14 rows; §20 calls 69 to 73.
- Oct 2026, 0.6.0, Phase 6 (MVP content), after judging: the content test's rune sweep now fails a rune that changes nothing about a weapon (same seed, same crowd, same damage); a zone effect keeps its own pace per list position (a weapon's own pool and a rune's); a lobbed shot lands on its target (its range the most it throws); a beam volley takes a target per beam; a HIT event marks a strike's own hit (c bit 2).
- Oct 2026, 0.6.0, Phase 6 (MVP content): §3 (docks.test.js), §5.7 (the docks layout, secrets, the muster), §5.13 (the lure and the tide lanes), §6.2 and §10.4 (no fog in the harbor, Kevin's ruling), §14 (rows), §20 calls 54 and 57 overturned, 62 to 67.
- Sep 30 2026, 0.5.1, the language pass: §3 (docs/WRITING.md), §8 (the screens' words), §14.1 (`voice.test.js`, `ui.test.js`), §20 call 61; the quoted strings in §10.2 and §9 follow the new wording.

- Sep 30 2026, Phase 5 judged and closed: §3 (tests/helpers, tools/shots' harbor probe, tools/pacing's report), §10.3 (each median its column's own; windows pooled over the players), §10.4 (the fog drawn whole and erased; a newcomer and her boat lit as the light map would light them; every look number in the data with its range), §12.1 (closing the window or tab while a save fails; the desktop shell asks from its main process), §12.4 (errors outside the loop's step), §14 (the harbor view run in the gate, and the rows for each test file as they stand), §15 (the harbor's ranges).

- Sep 29 2026, Phase 5: §3 (hub/, meta's files, render's hubview and hubtiles, ui's hub screens, app/hublogic, art/draw/hub.js, tools/pacing, the hub preview), §4 (the hub layer; render reads meta's derived state), §10.1, §10.2, and §10.4 as built, §11 (buildings, research, upgrades, npcs, hub, and meta data), §12.2 (schema v2), §14 (meta, hub, harbor, and pacing tests; the content test's harbor checks; the loop smoke), §16.7 (the harbor's art), §20 calls 49 to 60.

- Sep 28 2026, Phase 4: §3 (src/assets, art/, render's atlas, rig, pose, and texture files, tools/atlas, the Harpooner trials), §5.12 (the Harpooner's daze, and the rule that a warned attack is never held), §5.13 (boss rigs: layout, poses, and input from the sim), §6.2 (layer 7, the player on top, the HUD's layout as tested data), §6.4 (animation frames, the player's step, sim-time animation, the daze wobble, status tints), §14 (art, atlas, view, draft, and replay tests, tools/atlas, tools/bots, shot options), §16.3 to §16.6 (the builder as built, the fingerprint's import walk, contrast thresholds, the code-drawn comparisons, placeholder retired), §17 (render measurement), §20 calls 37 to 48.

- Sep 28 2026, Phase 3: §3 (render, ui, audio files), §4 (audio no longer waits for Phase 5), §6.2 (ground tile layer, how light and fog are drawn, unlit warnings, HUD contents), §6.3 (feel values under `tuning.feel`, the warning pulse), §8 (menus in game pixels, the screens, the font), §9 (vendored ZzFX generator), §12.4 (report contents and where they go, tools/replay), §14 (new tests and tools), §15 (dev commands as decisions), §17 (render measurement), §20 calls 29 to 36.

- Sep 27 2026, v1: first version (Phase 0). Reviewed against the brief by a separate agent. Fixes from that review: the Docks and five other buildings placed in Phase 7; the MVP material economy; cross-engine determinism through `lib/fmath.js`; the test script; the ParticleContainer texture rule; the controller UI framework moved to Phase 3; prestige keep and reset rules; split-upload and deletion rules; the honest limit on 1,000 enemies on screen; and this coverage table.
