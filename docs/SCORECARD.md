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
