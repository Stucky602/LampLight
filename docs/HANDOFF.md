# Lamplight: Handoff

Updated Sep 30 2026. Phase 5 (meta and hub) is done, version 0.5.1: every component judged above 90, then the language pass (every word the player reads, rewritten the way games in the genre word them). The Phase 3 **feel gate** and Phase 4's **art check** still wait for Kevin, and the harbor joins them. Content (Phase 6 on) waits for the gate (§18).

## Where things stand
- **Phases 1 to 4 are done** (see `SCORECARD.md`). Phase 3's exit check, the feel gate, and Phase 4's, the art check, need Kevin.
- **Phase 5 (Meta and hub) is done** (meta core 96, meta content 98, the harbor world 97, the harbor's art and view 95, the harbor's screens and flow 94, the pacing simulator 95; five rounds of judging). What it adds:
  - **The harbor.** Between runs you walk a small harbor town at night as the Lamplighter, with the run's movement and dash (R1). ✕ at a door opens the building's panel; at a person, their line. The pause button opens the harbor's menu. The gate at the quay's west end is where you choose who sets out.
  - **Three buildings, five levels each:** the Lamp Post (its light pushes the fog back, and its levels open the upgrade tree: ten small upgrades over five tiers, Second Wind at the top), the Library (research: seven projects that put new weapons, passives, runes, and a relic into your runs; a project moves on with each run that lasts 5:00 or kills a boss), and the Tavern (the Harpooner arrives by boat at level 1, the four relics at levels 2 to 5). Each level plays a short ceremony: the camera goes to the building, the new stage rises over the old, the fog peels back from its streets, the keeper steps out at level 4 and walks the streets at level 5. ✕ or Circle skips it.
  - **Materials from runs.** A run brings home Coin, Oil, Timber, Rope, Drowned Pages, Rum, Iron, and Map Scraps, and the results screen says what came home, what's new, and the next three things you can nearly afford. "Next up" stays in the harbor's bottom left.
  - **Your pools start small.** A fresh profile has 10 of the 24 weapons, passives, relics, and runes; research and the buildings add the rest.
  - **The profile is saved the moment a run ends and after every purchase.** A failed save keeps the progress in memory and says so, and nothing leaves the game over unsaved progress without asking (Quit, the error screen's reload, and closing the window).
  - **The title** says Continue once there's progress.
  - **The harbor's tuning panel** (hold Create, or F1): its timing and look live (the night, the fog, the lamps, the boat, the ceremonies), Copy tuning, and two dev commands: add materials, and unlock everything.
- **The language pass (0.5.1).** Kevin, on 0.5.0's screenshots: the words sounded like an AI, not a game. `docs/WRITING.md` now sets how every word is written: the house voice from the CQV handbook, and the genre's conventions checked on the Vampire Survivors and Brotato wikis. Cards read `+1 Projectile`, `-0.15s Cooldown`, `+12% Damage (Fire)`; the harbor reads `Requires Library Lv 2`, `Need 10 Coin, 5 Timber`, `New relic: Tide Clock`; the results read `Survived 7:11`, `New best time: 7:11 (was 5:00)`. Names drop "The" (Lamp Post, Drowned Docks, Harpooner) except the bosses'. One name per action (`Start run` everywhere). No screen names Claude; reports still come here. `tests/voice.test.js` checks all of it that a machine can, and a fresh-eyes review scored the result and its findings were taken (see DECISIONS.md for what changed and why).
- **Pacing** (`node tools/pacing/pacing.mjs`): with the bots' runs, the whole MVP harbor takes about 7 hours (5.6 to 8.6); if every run were like the shortest third they played (13 to 19 minutes), about 18 hours. Real runs will be shorter than the bots', so the costs are to be tuned to your own first runs (§20 call 59).
- Gate: 538 tests in about 40 s. Web build and `wrangler deploy --dry-run` pass, and the whole loop plays through the real screens and saves in the browser (title, harbor, a restore and its ceremony, a run from the profile's own pools, the results, back in the harbor). The 30-minute soaks at full density pass for both characters (p99 per tick at most 1.6, 3.0, and 4.9 ms by crowd size, against budgets of 2, 4, and 6). The desktop smoke test passes on the packaged build (Electron 44.4.5: it played a run, answered its menus, saved and reloaded through the real bridge, wrote a replay and a report, and Electron's V8 reproduced the golden run hash 8e0ecd7e, same as Node).
- Nothing has been pushed to GitHub, so this delivery is the full repo again, in parts. No file from 0.4.0 was removed.

## What Kevin needs to do
**When back:**
1. Create a GitHub repo named `lamplight` and upload the parts in order (the delivery message lists them). The Cloudflare build after an early part fails because that part has no package.json yet; that's expected and harmless. The build after the last part is the one that counts.
2. In Cloudflare, create a Worker from that repo with deploy command `npm run build && npx wrangler deploy`.
3. On the first deploy, open DevTools, go to the Network tab, and check that `/` and `/version.json` show `cache-control: no-store`.
4. **The feel gate, the art check, and the harbor.** Play the web build with the DualSense, then the .exe. The .exe comes as split pieces (`Lamplight-win-x64-v0.5.1.zip` plus `.z01`, `.z02`, ...), because files sent in the chat are capped at 30 MB. Install 7-Zip (free, 7-zip.org) if you don't have it, put all the pieces in one folder, right-click the `.zip`, and choose 7-Zip, then "Extract Here". Then run `Lamplight-win32-x64\Lamplight.exe`. SmartScreen says "More info", then "Run anyway". (Windows' own unzip can't open split zips.)
   - Tell Claude what feels or looks wrong in plain words, with the time in the run or the place in the harbor ("at 14:00 the screen turns to mush", "the Tavern's windows are too bright").
   - For numbers you want changed, open the tuning panel (hold Create for 1 second, or F1), in a run or in the harbor, change them live, then press "Copy tuning" and paste the text into the chat.
   - If something breaks, open pause and choose "Save bug report", then attach the file (web: your Downloads folder; the .exe: `%APPDATA%\Lamplight\reports\`).
5. Check the .exe basics too: fullscreen, F11 and Alt+Enter, Settings, then Display (switch to Borderless at the title or in the harbor, close, reopen: it should stay borderless), and unplugging the DualSense (the game pauses and says why).
6. Read ARCHITECTURE.md §20 (calls 37 to 61 are new since Phase 3) and DECISIONS.md, and overturn anything you don't like.

## Questions for the feel gate and the art check
1. Light and fog in a run: too dark, too flat, or right? (Tuning: `feel.light.*`, `feel.fog.*`, and the map's `ambient`.)
2. Shake, hit-stop, and damage numbers in a big crowd (`feel.shake.*`, `feel.hitStop.*`, `feel.numbers.*`; numbers and shake can be switched off in Settings).
3. Movement speed, dash distance and cooldown, the XP vacuum, and the player's one-pixel step hop (`player.*`, `xp.magnet*`, `feel.bob.stepsPerSec`).
4. Do warnings (charger lines, boss rings, hazard pools filling in) read while half-watching? At 10:00 about ten crabs can wind up at once, and their lines stack into one big orange fan.
5. The Harpooner's daze: too safe, not enough, or right? Try it live: the tuning panel shows her own numbers at the bottom, under `character.harpooner` (`daze` in seconds; 0 turns it off), and "Copy tuning" includes them.
6. The art: does the horde read (fog wisps are the grey ghosts, sailors teal, crabs pale grey, rats dark with a pale rim, lantern eaters violet moths)? Do the two characters stand out enough in a big crowd? Do the bosses look like bosses? Does the dazed wobble read as dazed? Anything that reads as the wrong thing? (The judges flagged the enemy shot as a first-aid mark, the Lamp Glass icon as a coin, the Lantern Orb as a sun, and Backfire as a dumbbell.)
7. From Phase 2: should a boss chest be able to evolve several weapons at once? Should orbiting weapons hit enemies pressed right against you?

## Questions about the harbor
1. Walking and the dash on the pad, and moving through the panels with the d-pad: anything awkward?
2. The ceremonies' pace (0.7 s to the building, 1.4 s for the stage to rise, 2 s for the fog, half a second to look, 0.7 s back): too slow once you've seen a few? Their numbers are on the harbor's tuning panel under `timing`.
3. The night and the fog in the harbor: too dark, too thick? (`look.ambient`, `look.fogDensity`, the lamps' reach, on the same panel.)
4. What the judges saw that doesn't read yet: the Library's book sign reads as letters at its size; the dust along a rising stage is faint; at the Lamp Post's levels 2 to 5 the same lamp rises over itself (only its light and the fog change); the fog still shows its regions' straight edges from a distance; ruins in the fog show as faint outlines.
5. The pacing against the brief (§20 calls 59 and 60):
   - A fresh profile's pools hold 42% of the run content; the brief wants about 70% locked at the start (30% or less). It falls as content passes put more behind research.
   - Past run 10, something new comes every 2 runs, sooner than the brief's 3 to 4, but the MVP harbor has only so much to give (its new things end around run 18).
   - 35 of the harbor's 57 purchases are upgrade ranks; the brief wants the stat tree a minority. Does that count purchases, or what the tree does to a run?
   - The costs: tune them to your first runs, or keep the bots' 7 hours as the target?
6. The frame rate on your monitor in the harbor, at 1080p, 1440p, or 4K (F3 shows it): it draws the light and the fog into their own textures every frame.
7. The window's close question: if a save ever fails, closing the .exe (its X or Alt+F4) asks "Your progress isn't saved" with Stay as the default. In a browser tab the browser asks only if you've pressed a key or clicked since the page loaded, so a tab closed with only the pad used may close without asking.

## Kevin's Harpooner idea: what was tried, and what shipped
Kevin suggested buffs for standing still, to offset her pulling enemies onto herself, and said to drop it if it didn't work in practice or fought the reasons to move. It was built and tested with bots: 12 runs of up to 24 minutes for each version of her kit, on the same seeds. "Holding her ground" means she stands in the crowd she reels in, takes its bites, and steps only for a warned attack, a shot, a pool, or when her health drops below 40%. "Standing still only when nothing is near" means she stops whenever no enemy is within 36 px and nothing is warning. `node tools/bots/harpooner-trials.mjs` plays all of it again and prints this table.

| Her kit, how she's played | Average time alive | Died | Damage taken per minute |
|---|---|---|---|
| As in Phase 3, kiting | 14.5 min | 9 of 12 | 36 |
| Holding her ground, no bonus | 10.5 min | 9 of 12 | 40 |
| Holding her ground, +4 armor while still | 11.9 min | 11 of 12 | 34 |
| Holding her ground, +8 armor while still | 12.3 min | 9 of 12 | 31 |
| Holding her ground, +1 HP a second while still | 11.7 min | 8 of 12 | 43 |
| Holding her ground, +30% damage while still | 10.2 min | 9 of 12 | 39 |
| Standing still only when nothing is near, no bonus | 11.0 min | 11 of 12 | 25 |
| Standing still only when nothing is near, +30% damage while still | 13.2 min | 10 of 12 | 30 |
| Kiting, twice the armor per nearby enemy | 13.6 min | 9 of 12 | 28 |
| **Kiting, what she hits is dazed 0.4 s (shipped)** | **21.3 min** | **3 of 12** | **19** |

No standing-still version beat plain kiting, so it was scrapped. What shipped answers the fault itself: what her weapons reel in arrives dazed for 0.4 s. It can't walk or hurt her, and it reels (a quick sway). Bosses are immune, and so is anything in the middle of a warned attack, so an attack never lands after its warning has gone.

## Open minors (none block anything)
- Sound: a boss's charge line and hazard pools share the ordinary rate-limited warning beep, so one can be silent if an ordinary charger beeped in the 0.4 s before.
- The run view: some effect sizes (explosion and revive spark counts, flash-light radii) are still in code rather than in `tuning.feel`.
- Elites are drawn at 2x while their body is 1.6x, so the drawing overhangs its body a little (a deliberate trade for square pixels, §20 call 40).
- The pause menu shows an item's base description, not what its levels added.
- Replays are about 100 KB for a 20-minute run. Harmless.
- Words: the enemy, material, and research descriptions (the flavor lines) show nowhere yet; a bestiary or codex screen (Phase 6 or later) is where they'll appear. A cost in the harbor names its materials only on a mouse hover over the icon, so a controller player learns them from the "Need 10 Drowned Pages" line.
- The harbor: the pacing model replays a measured run's haul times its greed, so a percent of greed from the upgrades slightly overstates what the game gives (it multiplies the greed the bot found in the run too). The Lighthouse's plot is 3 tiles wide and the scaffold is drawn for 5 x 4 plots; Phase 10 draws its own.

## Next
- **The feel gate, the art check, and the harbor**, all Kevin's. Then **Phase 6 (MVP content)** on Opus 5.5 high, with whatever the gate changes.
- The atlas is rebuilt with `node tools/atlas/build.mjs` (needs the packs); `--check` says whether the committed one is current. `node tools/atlas/hub-preview.mjs` draws the harbor at any building levels, by day or night, with `--boat` for an arrival.
- `node tools/pacing/pacing.mjs` prints the pacing report from the committed yields in a few seconds; `--remeasure` plays the bots again (minutes).

## Confirmed in Phase 1
- Workers static assets honor `_headers` when the file sits in the assets folder (ours: `public/_headers`, copied to `dist/`).
- A failed build can't replace the live version: the deploy command stops before `wrangler deploy` if the tests or the build fail.
- Electron packaging works in the workspace (Electron 44 via @electron/packager), and the .exe icon is written without Wine.
- Files sent in the chat are capped at 30 MB (found in Phase 3). The .exe zip is about 150 MB, so it goes as a split zip in 25 MB pieces. The workspace checks it with 7-Zip before sending.

## Open questions for Kevin (none block work)
1. The brief disagrees with itself on characters: §5.4 says "8 at launch, 16+ by v1.0", while the §7 table says MVP 2, v0.5 6, v1.0 16. The plan follows the table. Is "launch" something else, like a public release between v0.5 and v1.0?
2. The builder's calls in ARCHITECTURE.md §20, especially 16 (building the art and hub before the feel gate), 44 (the Harpooner's daze instead of a standing-still bonus), and 59 and 60 (the first costs and the fresh profile's share).
