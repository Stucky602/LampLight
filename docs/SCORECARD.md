# Lamplight: Component scorecard

Every component is scored out of 100 by an **independent judge** (a separate agent that didn't write the code: Fable 5.1 in Phase 1; Opus 5.5 in Phase 2, after the Fable limit ran out), using the rubric in `tools/judge/JUDGE.md`. A component passes above 90. Below that, Claude fixes the judge's findings and the same judge re-scores. When a component can't pass 90 without Kevin (a playtest, real hardware), it pauses with the reason, and work moves on.

Art and music are scored too, but the 90 bar doesn't apply to them yet (Kevin's call, Sep 27 2026).

**Status key:** PASS (above 90) · ITERATING · PAUSED (needs Kevin: reason given) · LATER (not built yet)

## Phase 1: Foundation

| ID | Component | Files | Baseline | Current | Status |
|---|---|---|---|---|---|
| F1 | Build, deploy config, version check | package.json, vite.config.js, wrangler.jsonc, public/_headers, .node-version, index.html, src/app/version-check.js | 86 | 97 | PASS |
| F2 | Test gate, boundary and workflow tests | tests/boundary.test.js, tests/workflow.test.js, tests/helpers/jsscan.js, package.json scripts | 83 | 98 | PASS |
| F3 | Determinism primitives | src/lib/rng.js, fmath.js, hash.js, inputframe.js | 85 | 94 | PASS |
| F4 | Loop driver | src/app/loop.js | 83 | 96 | PASS |
| F5 | Input system | src/input/*.js | 79 | 94 | PASS |
| F6 | Boot, scenes, renderer foundation | src/main.js, src/app/scenes.js, platform.js, pauses.js, errors.js, smoke.js, scenes/lampyard.js, src/render/*.js, src/ui/* | 74 | 97 | PASS |
| F7 | Saves, migrations, export codes | src/save/*.js, desktop/savefs.cjs | 81 | 92 | PASS |
| F8 | Electron shell | desktop/main.cjs, preload.cjs, shell.cjs, package.json | 77 | 93 | PASS |
| F9 | Packaging and smoke test | tools/pack-desktop.mjs, tools/smoke/, tools/icon/, tools/shots/, tools/lib/ | 80 | 95 | PASS |

Phase 1 result: all nine above 90. Components that passed also got the judge's smaller suggestions done afterwards (listed in the history), so their code has moved on since the score.

What only Kevin can check (none of it blocks the scores): the first real deploy's `cache-control: no-store` on `/` and `/version.json`, and an update loading on focus; real-GPU frame rate; the DualSense on the lampyard, including unplugging it; fullscreen, F11/Alt+Enter, and his monitor's Windows scaling in the .exe.

## Phase 2: Combat core

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| C1 | Pools and handles | src/sim/pools.js, src/sim/constants.js | sim-core | 94 | 98 | PASS |
| C2 | Spatial hash | src/sim/spatial.js | sim-core | 88 | 96 | PASS |
| C3 | Terrain and flow field | src/sim/terrain.js, src/sim/flowfield.js | sim-core, combat | 84 | 94 | PASS |
| C4 | Enemies: AI types, crowds, knockback, status effects, teleport-ahead, contact | src/sim/enemies.js, src/sim/attacks.js, src/data/enemies.js | combat | 74 | 93 | PASS |
| C5 | Director: timelines, scripted events, scaling, overtime, short mode | src/sim/director.js, src/data/maps.js | run | 81 | 94 | PASS |
| C6 | Stats and tags | src/sim/stats.js, src/sim/build.js, src/data/passives.js, src/data/tuning.js | stats | 84 | 98 | PASS |
| C7 | Weapon pipeline and runes | src/sim/weapons.js, src/data/runes.js | combat, content | 72 | 98 | PASS |
| C8 | The four starter weapons and their evolutions | src/data/weapons.js | combat, content | 81 | 96 | PASS |
| C9 | Gems, magnet, pickups, drops | src/sim/pickups.js, src/data/materials.js | combat, drops | 91 | 96 | PASS |
| C10 | Draft: cards, reroll, banish, skip | src/sim/draft.js | draft | 86 | 97 | PASS |
| C11 | Chests, evolutions, relic and character hooks | src/sim/chests.js, src/sim/hooks.js, src/data/relics.js, src/data/characters.js | draft, combat | 66 | 97 | PASS |
| C12 | Bosses and elites | src/sim/bosses.js, src/data/bosses.js | combat | 78 | 94 | PASS |
| C13 | Event buffer and RunResult | src/sim/events.js, src/sim/run-result.js | sim-core, run | 89 | 98 | PASS |
| C14 | World, player, tick order, determinism, replays | src/sim/world.js, src/sim/player.js, src/sim/replay.js | determinism, player, combat | 80 | 95 | PASS |
| C15 | Headless runs, bots, soak | tests/run.test.js, tests/helpers/simworld.js, src/sim/bot.js, tools/bots/, tools/soak/ | run | 89 | 94 | PASS |

Phase 2 result: all fifteen above 90. The C1 baseline is from its first complete review, after the other judges' first fixes.

Balance is not scored here: the numbers in `src/data/` are a first pass for the feel gate (Phase 3) and the balance phase (9). What is scored is that the systems do what the architecture says, survive bad input, are tested, and stay inside the performance budget.

## Phase 3: Feel and presentation

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| P1 | Run scene and game flow | src/app/scenes/run.js, src/app/runlogic.js, src/main.js, src/app/smoke.js, src/app/settings-flow.js, src/app/icons.js, src/app/scenes/lampyard.js | runlogic, desktop smoke | 83 | 94 | PASS |
| P2 | Run view: layers, feel toolkit, light, fog, warnings, numbers | src/render/runview.js, src/render/feel.js, src/render/renderer.js, src/render/layout.js | feel | 81 | 92 | PASS |
| P3 | Placeholder art, atlas, pixel font, palette | src/render/placeholder.js, pixels.js, sheet.js, atlas.js, font.js, src/data/palette.js | art | 83 | 94 | PASS |
| P4 | HUD | src/render/hud.js, src/render/hudtext.js | feel | 78 | 93 | PASS |
| P5 | Controller UI framework and screens | src/ui/focus.js, screens.js, dom.js, menus.js, describe.js, ui.css | ui | 81 | 94 | PASS |
| P6 | Sound | src/audio/audio.js, src/audio/zzfx.js, src/data/sfx.js | feel | 86 | 95 | PASS |
| P7 | Debug overlay, tuning panel, dev commands | src/sim/dev.js, src/ui/tuning.js, src/ui/tuningmodel.js, src/ui/overlay.js | dev, ui | 84 | 94 | PASS |
| P8 | Replays and reports | src/save/replay.js, tools/replay/replay.mjs, report code in src/main.js | runlogic | 81 | 95 | PASS |

Phase 3 result: all eight above 90 (judged by Opus 5.5). The feel itself is Kevin's call at the feel gate; what is scored is that each part does what the architecture says, survives bad input, is tested where it can be, and stays inside the budgets.

## Phase 4: Art pipeline and art pass

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| A1 | Pack decision | docs/DECISIONS.md (Kevin's ruling, Sep 27 2026) | | | | DONE (Kevin) |
| A2 | Atlas builder and the runtime atlas | tools/atlas/build.mjs, atlas.mjs, treat.mjs, mask.mjs, color.mjs, png.mjs, sources.mjs; src/render/atlas.js, atlasdata.js, atlasimage.js, playerframe.js, textures.js; src/assets/; atlas loading in src/main.js; src/app/icons.js | art, atlas | 84 | 97 | PASS |
| A3 | The art: manifest, palette, code-drawn sprites | art/manifest.js, art/draw/*.js, src/data/palette.js, src/data/credits.js | art, atlas | 80 | 92 | PASS (no 90 bar) |
| A4 | Procedural animation, boss rigs, the HUD's layout | src/render/rigs.js, rigpose.js, rigview.js, runview.js, viewstate.js (animation helpers), hud.js, hudmodel.js (layout), src/app/scenes/lampyard.js | atlas, view | 81 | 95 | PASS |
| A5 | Readability, contrast, and the screenshot review | tests/art.test.js (the rules on real pixels), tools/shots, src/app/smoke.js, tools/atlas/rig-preview.mjs, ARCHITECTURE §16.4 and §16.5 | art | 86 | 98 | PASS |
| A6 | The Harpooner's daze (Kevin's request) | src/sim/hooks.js, src/sim/enemies.js, src/sim/bosses.js, src/sim/dev.js (character tuning), src/data/characters.js, src/render/viewstate.js, tools/bots/harpooner-trials.mjs | draft, dev, view, determinism | 80 | 97 | PASS |

Phase 4 result: all five above 90 (judged by Opus 5.5; the art has no 90 bar but passed it anyway). The look itself is Kevin's call at the art check.

## Phase 5: Meta and hub

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| M1 | Meta core and profile v2 | src/meta/*.js, src/save/schema.js, migrations.js, src/app/profileboot.js, keeper.js, tests/fixtures/saves/ | meta, save, app | 74 | 96 | PASS |
| M2 | Meta content data | src/data/buildings.js, research.js, upgrades.js, npcs.js, meta.js, hub.js, tuning.js (HUB_TUNING and its ranges), the `unlock` fields | content | 87 | 98 | PASS |
| M3 | The harbor world (pure) | src/hub/map.js, world.js, tuning.js | hub, content, hubview (the range sweep) | 86 | 97 | PASS |
| M4 | The harbor's art and view | art/manifest.js and art/draw/hub.js (the harbor), tools/atlas (town, building, and npc kinds; hub-preview.mjs), src/render/hubview.js, hubtiles.js, src/assets/ | hubview, harbor, art, atlas | 88 | 95 | PASS |
| M5 | The harbor's screens and the game's flow | src/ui/hubscreens.js, hubhud.js, hubtext.js, menus.js, ui.css, src/app/scenes/hub.js, hublogic.js, flow.js, keeper.js, settings-flow.js, version-check.js, src/main.js, desktop/shell.cjs and main.cjs (the close question) | hubscene, app, harbor, desktop | 63 | 94 | PASS |
| M6 | The pacing simulator | tools/pacing/*.mjs, yields.json | pacing | 79 | 95 | PASS |

Phase 5 result: all six above 90 after five rounds (judged by Opus 5.5). How the harbor feels on the pad and looks on a real screen, and whether the pacing's hours match Kevin's own runs, are his to judge.

## Phase 6: MVP content

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| D1 | The Drowned Docks, fully built | src/sim/terrain.js, src/data/maps.js (layout), src/render/viewstate.js groundFrame, src/render/runview.js drawGround, art/draw/tiles.js | docks, art, view | 79 | 94 | PASS |
| D2 | The secret (Wreck Cache) end to end | src/sim/chests.js, pickups.js, world.js, dev.js, hooks.js, src/meta/state.js, apply.js, src/ui/hubtext.js, menus.js, src/app/runlogic.js | docks, content, voice | 86 | 96 | PASS |
| D3 | The elite event and the real bosses | src/sim/director.js, enemies.js, bosses.js, player.js, bot.js, src/data/bosses.js, src/render/rigpose.js | docks, combat, atlas | 81 | 94 | PASS |
| D4 | The MVP run content: 8 weapons, research, art | src/data/weapons.js, research.js, runes.js, sfx.js, art/draw/effects.js, sprites.js, src/render/viewstate.js bolts, runview.js | content, docks, art | 67 | 91 | PASS |

Phase 6 result: all four above 90 after two rounds (judged by Opus 5.5). Whether it's fun is the MVP gate, Kevin's.

## 0.6.1: Kevin's notes on 0.6.0

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| J1 | The harbor's fog back, the first-timer guide, walking off the quay | src/hub/world.js, map.js, src/app/scenes/hub.js, run.js, src/meta/guide.js, src/ui/hubhud.js, menus.js, src/render/hubview.js, the fog files from 0.5.1 | hubscene, ascend, hubview, hub, harbor, content, voice | 81 | 92 | PASS |
| J2 | The run's minimap, the HUD around it, its settings | src/render/minimapmodel.js, minimap.js, hud.js, src/save/schema.js, src/app/settings-flow.js | minimap, view | 80 | 93 | PASS |
| J3 | Embers and ascensions, Stats, the Lodestone | src/data/ascensions.js, src/sim/ascend.js, weapons.js, chests.js, world.js, pickups.js, src/app/runlogic.js, src/ui/menus.js, src/render/hud.js | ascend, hubscene, content, pacing | 75 | 92 | PASS |

0.6.1 result: all three above 90 after four rounds (judged by Opus 5.5). Whether the guide, the minimap, and the ascensions feel right is Kevin's, at the MVP gate.

## 0.6.2: Kevin's notes on 0.6.1

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| G1 | Forms: three a weapon line, one of each kind, kept through the evolution | src/data/ascensions.js, src/sim/forms.js, weapons.js, enemies.js, world.js, ascend.js | forms, ascend, content, determinism | first review (defects only) | 91 | PASS |
| G2 | The two-step Ascend screen, Stats with DPS and Total Damage, materials off the HUD | src/ui/menus.js, src/app/runlogic.js, src/ui/ui.css, src/render/hud.js | ascend, hubscene, voice, view | first review (defects only) | 94 | PASS |

0.6.2 result: both above 90 (judged by Opus 5.5 as F1 and F2). How the Forms feel is Kevin's.

## Phase 7: Every building's system

| ID | Component | Files | Tests | Baseline | Current | Status |
|---|---|---|---|---|---|---|
| P7-A | Run tasks, relics, Sea Glass, the Ferryman | src/sim/tasks.js, relics.js, places.js, hooks.js, pickups.js, terrain.js, world.js, player.js, enemies.js, run-result.js, bot.js, src/data/relics.js, maps.js, tuning.js, src/app/runlogic.js, src/ui/menus.js, src/render/runview.js, minimap*.js, hud*.js | tasks, draft, minimap, view, content, determinism, run | 83 | 95 | PASS |
| P7-B | The meta systems: gear, rune stones, the Market, consumables, Tides and curses, arcana, bestiary rewards, mastery and kits, feats, challenge runs, short runs, the v3 save | src/meta/workshop.js, feats.js, apply.js, runconfig.js, state.js, reconcile.js, next.js, src/save/schema.js, migrations.js, src/data/gear.js, consumables.js, tide.js, arcana.js, challenges.js, feats.js, mastery.js, market.js, buildings.js, research.js, src/app/setup.js | workshop, meta, save, content, pacing | 78 | 95 | PASS |
| P7-C | The harbor's Phase 7 screens, words, and art | src/ui/hubscreens.js, hubtext.js, menus.js, ui.css, src/app/scenes/hub.js, setup.js, src/data/hub.js, npcs.js, art/draw/hub.js, sprites.js, art/manifest.js, tools/atlas/atlas.mjs | hubscene, harbor, voice, hub, art, atlas | 62 | 91 | PASS |

Phase 7 result: all three above 90 after two rounds (judged by Opus 5.5). What only Kevin can judge: whether the first-guess numbers feel right (the Reliquary's rate, the tier weights, the Ferryman's prices, Tides, curses, gear), whether the six new buildings read as different places at play size, and how the panels and the gate feel on the DualSense.

## Score history

(newest last: date, component, score, what changed)

- 2026-09-27, all nine, baselines 74 to 86. Blockers found: saves could overwrite an unreadable newest save; the loop could double its frame chain; the tuning chord also fired Pause; the smoke test never wrote saves through the bridge; layout in CSS pixels instead of device pixels; the world sprite drew into the letterbox bars; `isSafePoint` true mid-transition; the version check could re-throttle forever and never reload.
- 2026-09-27, F3 94, F4 96, F5 94: fmath trig no longer allocates (private constants), loop generation counter and error pause, one-button tuning hold, vendor-anchored controller detection, `releaseAll`.
- 2026-09-27, F7 92, F8 93, F9 95: quarantine of an unreadable main save, single write queue, IndexedDB marker, IPC sender checks, three display modes, smoke round trip checked on disk.
- 2026-09-27, F1, F2, F6 fixes (re-judge pending): forced deferred version checks, reload-loop guard, update marker; lexer-based boundary checks with data/ui/render/audio rules, JSONC reader, recursive test scan; device-pixel placement with bars, strict safe point, separate save notices, smoke save space.
- 2026-09-28, suggestions done on passed components: F3 allocation docs corrected from new measurements (every fmath function is 0 B per call in the sim's pattern; the earlier 16 B results came from the benchmark's own loop); F5 mouse-travel decay and the §7 fallback sentence; F7 quarantine dedupe, one short read retry, IndexedDB-marker test, codec message for trailing characters; F8 DPI-aware windowed size, aborted loads ignored, mode follows F11, crash restart after a healthy boot, exact Windows path cases; F9 stderr tail and kept folder on failure, settings round trip.
- 2026-09-28, F1 96, F2 97, F6 88: the judge found one regression (unplugging the pad in use paused and then instantly resumed, because the prompt fallback emitted a device change), plus minors.
- 2026-09-28, F1 97, F2 98, F6 97: device changes come only from real input; pause wiring moved to `src/app/pauses.js` with tests on the real modules; IndexedDB marker only after a profile exists; self-healing "stuck" update state; detach cancels a waiting check; scanner reads imports with template text blanked and handles a regex after an if/while condition; the shot tool checks every letterbox pixel.
- 2026-09-28, suggestions done after the pass: pause on losing the pad in use even with a spare pad plugged in, and resume on picking up the spare; one bounded reload retry per 5-minute window for an update that was stuck mid-deploy; the scanner's known ASI limit pinned by a test.
- 2026-09-28, Phase 2 baselines (Opus 5.5 judges): C1 94, C2 88, C3 84, C4 74, C5 81, C6 84, C7 72, C8 81, C9 91, C10 86, C11 66, C12 78, C13 89, C14 80, C15 89. Blocker: kills from a relic blast in step 10 were removed uncounted (no gem, loot, chest, or boss result; a final boss killed that way blocked the end of the run). Majors: runes checked against the weapon's original emitter; chains revisiting targets; Tide Bell waves sharing one cooldown (Undertow's extra wave did nothing); boss chests evolving at most one weapon; the Harpooner pushing instead of pulling; enemies trapped at crate corners; roster swarmers flooding the pool; missing chest event; untested death, revival, dash, reserve(), big items in nearest(), passive stacking, slot rules.
- 2026-09-28, fixes: deaths resolved until none are left; runeFits against the current emitter, one copy per rune; an 8-hit memory with chains inheriting it; per-wave hit marks; evolutions per chest item; knockback pulls for the Harpooner (blasts too); the flow field taken wherever the straight step hits a wall, plus a wall-grown field for big bodies; roster, event, overtime, RunConfig, and tuning checks at world creation; the chest event; corner-safe elite and boss spots; anchored warnings; a capped crowd shove; greed at pickup; alternate-tick separation (p99 above 2,000 enemies from about 6 to about 5 ms); the soak judged by enemy bracket and p99.9; about 60 new tests (gate 290 tests, about 24 s).
- 2026-09-28, final: C1 98, C2 96, C3 94, C4 93, C5 94, C6 98, C7 98, C8 96, C9 96, C10 97, C11 97, C12 94, C13 98, C14 95, C15 94. Minors left open are listed in HANDOFF.
- 2026-09-28, Phase 3 baselines: P1 83, P2 81, P3 83, P4 78, P5 81, P6 86, P7 84, P8 81. Majors: god mode written into the RunConfig so a cheated run's replay desynced; a crashing tick's input frame not recorded; the borderless display mode not persisting (the save was debounced past the window swap); chest reels and the pause build not saying what relics and evolutions do; player sprites dimmer than the commonest enemies and grey harpoon shots against the readability rules.
- 2026-09-28, Phase 3 rescored: P1 94, P2 92, P3 94, P4 93, P5 94, P6 95, P7 94, P8 95. God mode is a world flag and replays start from the starting config; frames recorded before stepping; settings saved before a display switch and flushed on quit and reload; runs saved the moment they end; the run view's memory and the HUD's content split into pure, tested modules (viewstate.js, hudmodel.js); feel numbers moved into tuning; art ramps fixed and tested; menu sounds, Back, pause over halts, and card wording fixed; real enemy-shot sounds and a rate-limited warning beep. Minors fixed after the scores: the tuning panel's god label, back sounds only where Back does something, layout writes only on change, a voice freed if it fails to start, pause-build and enemy-shot tests.
- 2026-09-28, Phase 4 baselines (Opus 5.5 judges): A2 84, A3 80 (art: no 90 bar), A4 81, A5 86, A6 80. Majors: a harpoon hit (or the Storm Bell's freeze) on a crab winding up or a gunner aiming held it, so it struck after its warning had ended (A6); the atlas fingerprint listed its inputs by hand and missed `src/lib/hash.js` (A2); readability was measured only on each enemy's first frame, not the second animation frame or the elites (A5); the Harpooner's hair was the color of her face, so she read as bald (A3). Minors included: animations kept playing under pause and level-ups, and frozen or dazed enemies kept flapping; a change to how a rig moves made the atlas stale; the materials row could run into the boss's bar; the daze dimmed enemies below the contrast rule; the Tidecaller's hand was hidden by its staff; the floor's variant pick repeated every 4 tiles; untested helpers (frame choice, the hop, the rig input) and no way to rerun the Harpooner trials.
- 2026-09-28, fixes: `midAttack` keeps warned attacks on time under daze and freeze (tested with twin runs: the same dash and shot ticks, hit or not), the daze never adds up, and a two-minute Harpooner replay with dazed enemies is in the gate; the fingerprint follows the builder's imports and keeps string contents exactly; readability over every animation frame and every elite; sim-time animation through pure helpers (`animFrameIndex`, `stepHop`, `dazeWobble`), tested; poses split into `rigpose.js`, fed from the sim by `rigInput`; the HUD's layout moved into data (`HUD_LAYOUT`, `placeHud`) with an overlap test at the longest texts, which found the materials rows overlapping (14 px apart for 16 px icons, now 17); the daze shown as a wobble; the crab's claws opened, the Tidecaller's hand and tentacle redrawn; `tools/bots/harpooner-trials.mjs` plays the trials again.
- 2026-09-28, Phase 4 rescored: A2 97, A3 92, A4 95, A5 98, A6 97. The remaining minors were fixed after the scores: the fingerprint ignores formatter spacing (a space counts only where closing it up could join two tokens), the feet room moved to its own file (src/render/playerframe.js), and the scanner is no longer an input; the art test measures enemy saturation, gem brightness, the hue of hostile shots and warnings, and the ground's own contrast; every effect names its reference; the Glass Lantern's handle is see-through; the title's floor uses the run's picker (floorVariant, shared and tested); the rat's rim is a step lighter (2.8:1 against the floor); a test keeps the Tidecaller's hand visible; the rig lights moved out of the fingerprinted layout; warning pulses and status flickers run on sim time; a source check keeps the run view calling the animation helpers with each enemy's phase; a boss warning or charging isn't frozen, and a warned charge runs its course (twin-run test); the Harpooner trials describe holding her ground honestly and add standing still only when it's safe.
- 2026-09-29, Phase 5 baselines (Opus 5.5 judges): M1 74, M2 87, M3 86, M4 88, M5 63, M6 79. Blocker: runes never entered the codex. Majors: orphaned content was never restored; "map 1 pays for everything" was checked against each material's declared maps, not the drop tables; in the harbor ✕ both confirmed and dashed; a save from a newer build stopped the game from starting; an update could reload the page the moment the harbor was entered, over the results or a failed save; research's refusal sentence was never shown; the pacing report didn't say what its hours stood on.
- 2026-09-29, round 2: M1 86, M2 95, M3 95, M4 88, M5 81, M6 88. Majors: nothing checked that an update keeps a seasoned save's progress, or that an upgrade or a project takes its cost; Settings in the harbor could never reach a safe point, so a display switch there never happened.
- 2026-09-29, round 3: M1 90, M2 96, M3 96, M4 92, M5 92, M6 94. Major: no test held each profile writer to leaving the rest of the profile alone.
- 2026-09-30, round 4: M1 94, M2 96, M3 96, M4 86, M5 93, M6 95. Major: the harbor's fog showed its density squared (measured in the browser: a region halfway through its peel showed a quarter of its fog). Also: a newcomer brightened about 30% on the tick she stepped off her boat, and the view's code between its tested helpers was untested.
- 2026-09-30, fixes: the fog drawn whole and then erased by how clear each tile is; the newcomer lit as the light map would light her, in the boat and stepping off; the harbor view run in the gate on Pixi's own scene graph with stand-ins for the GPU and the canvas; every harbor tuning number held to a range; closing the page while a save fails asks first; the pacing windows pooled over players.
- 2026-09-30, round 5: M1 96, M2 98, M3 97, M4 95, M5 94, M6 95, no blocker or major. After the scores: the end screen no longer opens over the error screen, the chimney waits for the last stage, the close question says only what happened, the pacing model names the bosses a run killed, the boat is lit like its newcomer, the scaffold sits on its plot, and every surviving mutation the judges listed has a test that catches it.
- 2026-10-14, Phase 6 baselines (Opus 5.5 judges): D1 79, D2 86, D3 81, D4 67. Majors: the Oil Flask always landed 110 px out, whatever it aimed at; every second flask left no oil, and Burning Ground on the flask did nothing (one zone pace per weapon); a Signal Mirror's +1 Projectile added nothing (every beam took the same target); the Wreck Lantern's every-5th rule was tested only to the first pool; the Maw could lure from off screen; nothing in the rune sweep caught a rune that changes nothing.
- 2026-10-14, round 2: D1 94, D2 96, D3 94, D4 91, no blocker or major. After the scores: boss phases and summon enemies checked at 0:00, a split from a still shot flies outward, the docks' clear radius checked and built fresh in its test, the secret's tile checked open in the content test, the secret's and the muster's effects tested, and §16.5's Phase 6 references written.
- 2026-10-14, 0.6.1 baselines (Opus 5.5 judges): J1 81, J2 80, J3 75. Majors: closing the gate's screen with the stick still held west reopened it (the screen fed an empty frame, which re-armed the walk-off); no scene tests for the walk-off, the guide, or the tips; the HUD overlap test never placed the minimap; an ascension joined to a weapon's own effect added every number, so Barbed Line on the Kraken Line made each hop stronger than the hit (3.3 times the damage); runes ignored ascensions (Backfire on Signal Pair did nothing); the pause offered Ascend over another screen, and pressing it threw.
- 2026-10-14, fixes: the walk-off re-arms only on a real frame; per-field rules for joining effects (amounts add, reaches take the larger, a chain's multiplier never adds); runes and ascensions checked against each other both ways; Ascend only with nothing waiting; an Ember picked up at once when the pool is full; the stats screen's items and the character's own weapon; the minimap's reveal from the camera, whole-pixel Nearby, marks by shape; pacing re-measured and costs re-fit to 1.5 times Phase 5's (8.3 hours).
- 2026-10-14, round 2: J1 89, J2 85, J3 92. Major: the minimap could hide a player cornered under it. J3 passed; after its score, a second Ember on the same tick with nothing left to take is kept rather than opening an empty screen, and three cards were reworded to match what they do.
- 2026-10-14, round 3: J1 89, J2 88, no blocker or major. The guide's arrow now follows the walk around the fog, and a short haul sends you back to the gate; the minimap and the materials fade while you're under them.
- 2026-10-14, round 4: J1 92, J2 93, no blocker or major. After the scores: an on-screen target under a corner panel gets an arrow just past the panel, the How to play card fades while you stand under it, the guide's short-haul line is pinned by a test, the minimap's mark shapes are data (`MARK_SHAPES`) with a test that no two look alike, the fade's edges are pinned a pixel either side, and the guide's and the minimap's tests have files of their own.
- 2026-10-16, 0.6.2: F1 91, F2 94 after the first review's defects were fixed (Tether with Orbiting, Great Toll's floor, Burning Glass, self-feeding hangs and wards, Mortar's burst, Salvo's count, Pyre's cap, the hash, Stats overflowing, sentences on screens).
- 2026-10-16, Phase 7 baselines (Opus 5.5 judges): P7-A 83, P7-B 78, P7-C 62. Majors: the Phase 7 relics' and arcana's rules had no behavior tests; the next-3 list ignored every Phase 7 purchase; a rune stone the run's first weapon couldn't take was offered and used up for nothing; bestiary claims set aside never came back; static rows in three panels (the Chapel, the Tavern's feats, the Cartographer's challenges) couldn't be reached by pad; arcana, curses, and challenges were picked at the gate by name only; the gate offered challenges whose character hadn't arrived, which landed on the error screen.
- 2026-10-16, fixes: behavior tests for every new relic and arcana, tier shares by minute, the Ferryman's stocks; onDash hooks run after the tick's enemy grid; a shielded hit counts as a hit; an empty Reliquary gives Sea Glass; no stronger tier early when the weak run out; waiting pickups moved off solid ground; Phase 7 goals in the next-3; stones filtered by fit and checked before they're used; claims restored; the Tide record fitted on load; one Tide at a time; unknown bosses count for nothing; per-item re-roll offers; every panel row focusable; a detail line for the gate's focused value; challenges filtered, the kit row hidden, Start checked on the screen; the gear header, row layout, and the Chapel's labels; the Docks' lines from tuning; DOM tests for every Phase 7 panel, the gear screen, and the gate; Phase 7 text pinned word for word.
- 2026-10-16, Phase 7 rescored: P7-A 95, P7-B 95, P7-C 91, no blocker or major. After the scores: a pickup's snap off solid ground and the true nearest open tile tested, the real minimap's lamp reveal tested, Phase 7 notices in the HUD overlap test, Brine's test read from its params, the place helpers in their own module (no import cycle), a purchase keeps an item it can't read, per-item re-rolls documented, a fixed row presses silently, the gate's rows scroll at 720p, and a d-pad walk down the Chapel's whole list.
