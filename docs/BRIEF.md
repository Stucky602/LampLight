# The Ultimate Survivors-Like: Build Brief

This brief is for a Claude chat that will build the game. It says what the game is, why each part is there, what to avoid, and how Kevin works. Kevin directs and Claude builds. Where this brief makes a call, follow it. Where it says "builder's call", decide, then say what you decided.

---

## 1. The target in one paragraph

The game combines **Vampire Survivors' combat**, **Soulstone Survivors' build depth**, **Heroes of Hammerwatch's persistent town**, and **Graveyard Keeper's interlocking progression**. You only move, and your weapons fire on their own. The screen fills with enemies until you are absurdly powerful. Runs take 20 to 30 minutes and are full of choices that actually change the build. Between runs you go back to a ruined, authored hub that you rebuild piece by piece. Every building you restore opens a new system, and every system feeds the others. After 100 hours there should still be things to unlock.

The test for every feature: *does this make Kevin want to do one more run?*

---

## 2. Hard rules (break one and the game fails)

| Rule | Meaning |
|---|---|
| **Auto-fire only** | There is no attack button. The player moves, positions, dodges, collects XP, and picks upgrades. Nothing is aimed by hand. |
| **A PC game** | The product is a Windows desktop game played with a controller, keyboard as backup. It is not a phone game, a web app, or a cross-platform compromise. No touch controls, no phone layouts, no phone performance targets. |
| **Top-down 2D** | A top-down or slightly angled 2D camera. Never first-person, never 3D third-person. |
| **An actual game, not an idle game** | Nothing progresses while the game is closed. No timers you wait out, no AFK income, no "come back in 4 hours". Progress comes from playing runs. |
| **Horde combat** | Enemy density keeps climbing until the screen is packed. The fantasy is one person against a thousand. |
| **Meaningful run choices** | Level-ups offer choices that change *how* you play: new weapons, synergies, evolutions, rule-changing relics. A run of "+5% damage or +5% health" is a failure. |
| **Authored hub, never freeform** | The game decides where every building goes. The player unlocks set improvements, with no plot picking, furniture placement, decorating, or city management. |

---

## 3. What Kevin has played (the reference points)

**He owns or has played:** Vampire Survivors, Soulstone Survivors, Spirit Hunters: Infinite Horde, Yet Another Zombie Survivors, Death Must Die, Halls of Torment, Army of Ruin, Deep Rock Galactic: Survivor, Ball x Pit, Funguys Swarm, Nordic Ashes, Vampire Crawlers.

**He strongly dislikes:** Brotato, Megabonk, Citizen Sleeper. Don't borrow their signature structures: Brotato's wave-and-shop arena, Megabonk's 3D.

**Benchmarks and what to take from each:**

- **Vampire Survivors / Yet Another Zombie Survivors:** the combat feel. Movement-only play, huge hordes, XP gems, weapon evolutions, power that escalates fast, and a big catalog of unlocks.
- **Soulstone Survivors:** build depth. A large skill pool, skill tags that interact, runes that modify skills, and a long meta-progression.
- **Heroes of Hammerwatch:** a persistent town that grows in set places, with each building a working service, plus classes and difficulty tiers.
- **Graveyard Keeper:** interlocking progression. Resources from one system are the inputs of another, so you always have a next goal and a reason to go somewhere specific.
- **Hub examples he loved:** Heroes of Hammerwatch's town, Huntsman Against Darkness's ruined village that comes back to life, Funguys Swarm's sanctuary that visibly develops.

The emotional arc of the hub, in his words: *"There was nothing here." → "I unlocked something." → "Now there's a blacksmith." → "Now there are NPCs." → "Now the whole place is alive."*

---

## 4. Theme (a proposal; Kevin can swap it)

**Working title: *Lamplight*.**

A harbor town has been swallowed by a fog that comes off the sea every night, and things come out of the fog. You are the last lamplighter. The town is ruins: lamps dark, docks broken, houses empty.

The theme is built around the hub. **Restoring the town literally pushes the fog back.** Each relit lamp and repaired building clears more of the hub map, and townsfolk return by boat. Progress is visible from across the whole screen.

- Weapons are light, fire, harbor tools, and old lighthouse tech: lantern orbs, flare guns, harpoon chains, signal mirrors, tide bells, and so on.
- Enemies are fog creatures, drowned sailors, sea things, and lantern-eaters.
- Maps are parts of the coast: the Drowned Docks, the Salt Marsh, the Sunken Chapel, the Cliff Lighthouse, the Reef.

If Kevin picks a different theme, keep the structure: **a ruined authored hub that visibly comes back, where every piece of restoration is also a new system.**

---

## 5. The run

### 5.1 Shape
- **Standard run: 20 minutes.** It has three phases, with a boss at 10:00 and a harder boss at 20:00.
- **Overtime (optional):** after the 20:00 boss you can leave, or stay in escalating overtime for bonus materials until you die. That gives sessions from 20 to 60 minutes at the player's choice.
- **Short run mode (unlocked later):** a 10-minute run for quick sessions, with smaller rewards.
- Each map has its own enemy roster, its own materials (see 6.2), one elite event, and at least one secret.

### 5.2 Controls
- **Movement only.** Left stick, or WASD as backup. No attack input.
- A **dash** is allowed as a movement tool, with a cooldown, and it can be unlocked. Nothing else is active. Builder's call whether it's in the MVP. It is never an attack.
- Level-up choices use the d-pad or stick. Pause, reroll, banish, and skip each get a button.

### 5.3 Run building (the Soulstone layer on the VS base)
- **6 weapon slots + 6 passive slots.**
- **Level-up offers 3 cards** (4 with a hub upgrade). **Reroll**, **Banish** (remove a card from the pool for the rest of the run), and **Skip** have limited uses, and the hub adds more.
- **Evolutions:** a maxed weapon plus a specific passive, then open a boss chest, gives an evolved weapon, as in VS. Some evolutions are secret and hinted at only in the Library (see 6.1).
- **Tags:** every weapon carries 1 to 3 tags (Light, Fire, Tide, Frost, Steel, Echo, Rot, and so on). Passives and relics scale tags, not "all damage". Stacking a tag is a build.
- **Runes (the Soulstone idea):** chests can drop runes that attach to a weapon and change its behavior, not its numbers. Examples: "projectiles split on hit", "leaves burning ground", "orbits you instead of firing", "chains to 3 targets", "fires backward too". Each weapon has 2 rune sockets.
- **Relics:** rare picks that change the rules. Examples: "XP gems explode when collected", "healing is converted to shield", "every 7th level-up is a free evolution check", "enemies you kill while dashing drop double XP".
- **Arcana-style run modifiers** (unlocked later): one chosen at the start of a run that bends the whole build.

**Build diversity target:** at least 6 clearly different archetypes should be viable at the top difficulty. Examples: orbit tank, projectile storm, burning-ground kiter, summoner, chain-lightning, and a pure-speed glass cannon.

### 5.4 Characters
- **8 at launch, 16+ by v1.0.** Each has a **unique mechanic**, not just a different starting weapon. Examples:
  - The Lamplighter: a light radius that damages anything inside it and grows with level.
  - The Harpooner: her weapons pull enemies in; she gains armor for each enemy near her.
  - The Tide Priest: she can't heal, but every 60 seconds a wave clears half the screen.
  - The Drowned Man: gains an extra weapon slot for each boss killed in the run.
- **Character mastery:** each character levels on their own across runs and unlocks 5 or 6 character-only perks and an alternate starting kit.

### 5.5 Feel (the part clones get wrong)
- 1,000+ enemies on screen at 60 fps on a mid-range Windows PC.
- Hit flash, knockback, and a satisfying XP vacuum pull. Chest openings get a short reel with slot-machine energy. Level-ups pause and read clearly.
- Mostly contact damage and a few telegraphed hazards. It should be a game you can play half-watching TV. Reading the screen should never feel like a bullet-hell test.
- Damage numbers can be switched off. Screen shake can be switched off. Density on screen is the reward, so never hide the horde.

---

## 6. The meta: interlocking progression (the part that matters most)

The rule of the meta: **most unlocks add new things, not bigger numbers.** Percentage upgrades exist, but they are capped and make up a minority of the tree.

### 6.1 The hub: the Harbor
A fixed, hand-built town map you walk around between runs. It starts buried in fog with one lamp lit. Every building has a **set plot**, **5 levels**, and a **visible change at every level**: scaffolding, then a roof, then lit windows, then an NPC at the door, then the building fully alive with its own ambient animation. The fog clears street by street.

| Building | Restores with | What it opens |
|---|---|---|
| **The Lamp Post** (start) | Oil | Permanent stat tree (the capped % upgrades) |
| **The Smithy** | Iron, Salt-glass | Equipment crafting (6.3), then rune crafting |
| **The Library** | Drowned Pages | Research (6.4): new weapons, relics, and evolution hints enter the pool |
| **The Tavern** | Coin, Rum | New characters arrive here as they're unlocked; mastery is trained here |
| **The Docks** | Timber, Rope | New maps. Each dock level repairs a boat that reaches a new stretch of coast |
| **The Chapel** | Candles, Bone | Difficulty tiers and curses (6.6) |
| **The Market** | Coin | Converts materials at a bad rate, so you're never hard-stuck |
| **The Apothecary** | Marsh Herbs | Starting consumables and reroll/banish/skip charges |
| **The Lighthouse** | Everything | The endgame. Relighting it fully is the "credits" moment and opens Prestige (6.7) |
| **The Cartographer** | Map Scraps | Map secrets, challenge runs, and the bestiary rewards |

NPCs come back as buildings are restored, and they walk the streets, talk, and react to milestones. **No building placement, no decorating, no furniture.** Ever.

### 6.2 Materials tie the systems together
- Each map drops **different materials**. Timber and Rope come from the Docks map, Marsh Herbs from the Salt Marsh, Bone and Candles from the Sunken Chapel, and so on. Buildings need **mixes**, so you choose where to run based on what you're building next.
- Bosses and elites drop the rare materials.
- **Research needs materials, Equipment needs materials plus research, and new maps need Dock levels.** So a goal in one system always points at a run somewhere else. That's the Graveyard Keeper loop.
- The hub always shows **the next 3 things you can nearly afford**, so there's always a "one more run".

### 6.3 Equipment (the Smithy)
- **4 gear slots** (Lantern, Coat, Boots, Charm), and later a 5th and 6th from Smithy levels.
- Crafted pieces carry **affixes that change builds**, not flat stats. Examples: "+1 projectile on Tide weapons", "your dash leaves a fire trail", "evolutions also need one fewer passive level".
- Gear can be upgraded and re-rolled with materials. No random-drop grinding with a slot machine of stats. Crafting is deliberate.

### 6.4 Research (the Library)
- A **research tree** where each node costs materials and **finishes after a set number of runs**, never after real time.
- Research adds weapons, passives, relics, and runes to the pools, and it reveals evolution recipes as partial hints.
- About **70% of all run content is locked behind research at the start**, so the first 20 hours keep adding things.

### 6.5 Characters and mastery
Characters are unlocked by in-run feats. Examples: "survive 15 minutes without a weapon above level 3", "kill the Reef boss with only Tide weapons". The requirement shows in the Tavern once you've found it. Some characters are secret.

### 6.6 Difficulty (the Chapel)
- **Tide Levels 1–20**, like Heat in Hades or the curses in Halls of Torment. Each level adds a modifier (faster enemies, elites spawn in pairs, less healing) and raises material rewards.
- **Curses:** optional modifiers you pick yourself for extra rewards.
- **Challenge runs:** fixed builds or restrictions with unique rewards (Cartographer).

### 6.7 Prestige: "New Tide"
- Once the Lighthouse is fully lit and the final boss is beaten, you can choose **New Tide**. The fog returns and the town goes back to ruins. You keep one **Prestige Relic** per cycle, permanent character mastery, and the bestiary.
- Each New Tide adds **new building variants and new NPC stories**, and the town comes back *different*, still authored. Each cycle also adds new enemy variants and a new boss.
- Prestige is optional. Kevin wants it as a bonus layer, not a wall.

### 6.8 Collection and secrets
- **Bestiary:** kill counts per enemy, with rewards at milestones.
- **Codex:** every weapon, evolution, relic, and rune, with blanks for undiscovered ones.
- **Secrets:** hidden characters, secret evolutions, and a hidden map reached from the Reef. The VS "what is THAT" energy is part of the appeal.
- **A completion percentage** on the title screen.

---

## 7. Content targets

| | MVP (vertical slice) | v0.5 | v1.0 |
|---|---|---|---|
| Maps | 1 | 3 | 5 + 1 secret |
| Characters | 2 | 6 | 16 |
| Weapons / evolutions | 8 / 4 | 20 / 12 | 36 / 24 |
| Passives | 8 | 18 | 30 |
| Relics / runes | 6 / 4 | 20 / 12 | 45 / 25 |
| Buildings (×5 levels) | 3 | 7 | 10 |
| Bosses | 2 | 6 | 12 |
| Tide levels | 0 | 10 | 20 |
| Prestige | no | no | yes |

**What the MVP proves:** the combat feels good at 1,000 enemies; a run offers real choices; the hub visibly changes after the first few runs; and materials from the run clearly point at the next thing to build. If the MVP isn't fun, stop and fix feel before adding content.

---

## 8. Anti-goals (don't build these)

- An attack button, aiming, or a twin-stick mode.
- Idle income, real-time timers, energy systems, daily login rewards, or anything that punishes not playing.
- Freeform building, plot choice, decorating, or town management.
- A big grid of +3% upgrades posing as depth.
- A small arena with a shop between waves (Brotato's structure).
- 3D.
- Anything built for phones: touch controls, portrait layouts, phone performance budgets.
- Monetization of any kind: no store, no premium currency, no ads.
- Online accounts. Saves are local, with export and import (see 9.5).

---

## 9. How to build it (Kevin's setup)

### 9.1 Kevin's constraints
- He works from an **iPhone and a Windows PC**. The iPhone is for directing the work, not for playing: the game is PC-only. Never a Mac, and **never a local terminal**. He can't run `npm`, `wrangler`, or anything else locally.
- **Don't use GitHub Actions.** He's on the free tier, and a CI job once used up the whole month in a day. Nothing in this project may depend on Actions, including building the .exe or downloading assets.
- **Any test in the build must pass, or the site doesn't deploy.** If `package.json` runs tests during the build, every zip must include every test file it names.

### 9.2 Two builds from one codebase
The product is the Windows game. The web build exists only so Kevin can playtest fast.

| | Playtest build | PC release |
|---|---|---|
| What it is | The game running in Chrome or Edge on Kevin's PC | The same code in an Electron desktop wrapper, as a Windows .exe |
| How it gets to him | He pushes the repo zip to GitHub; Cloudflare builds and deploys it | Claude packages it in its own workspace and sends it as a download |
| When | Every iteration | At milestones, or whenever Kevin asks for a PC build |
| Controller | Gamepad API in the browser | Gamepad API in Electron |

**Playtest build (Cloudflare):**
- His Cloudflare account is on Workers Paid. It deploys as a **Worker with static assets**, with deploy command `npm run build && npx wrangler deploy`. The repo carries a `wrangler.jsonc` with `assets.directory: "dist"` and `workers_dev: true`. The site lives at `<name>.strickland-kevinj.workers.dev`.
- **It must always load the newest version.** Add a version check that fetches `version.json` without cache on load and on focus, and reloads when it changes. Also make sure `index.html` is never cached.

**PC release (Electron):**
- Package with `@electron/packager --platform=win32 --arch=x64` in Claude's workspace. Tested Sep 27 2026: this works from the Linux workspace with no Wine, and produces a folder with `Lamplight.exe` (about 150 MB zipped).
- Keep the Electron wrapper in its own folder (`desktop/`) with its own `package.json`, so Cloudflare's build never installs Electron.
- The .exe never goes in the GitHub repo. It is too large for GitHub's web upload, and it is a build output, not source.
- Deliver it as a zip Kevin unzips anywhere and runs. It is unsigned, so Windows SmartScreen warns on first launch ("More info", then "Run anyway"). Code signing is a later decision.
- The build number shows on the title screen and in the window title, so Kevin always knows which build he is playing.
- Launches fullscreen by default. Settings offer fullscreen, borderless window, and windowed.

### 9.3 Delivery rules
- Deliver code as **one zip with the repo directory structure inside it** (e.g. `lamplight/src/game/weapons.js`), so he can drop the whole thing into GitHub at once.
- **The first delivery is the full repo.** After that, zips contain **only the files changed since he last said "delta the repo"**, with the directory structure intact. "Delta the repo" is his reset marker: it means everything is pushed. If nothing has changed, say so instead of sending a zip.
- Present only the newest zip. The .exe zip is a separate delivery and doesn't count against this.
- Before every repo zip, run the tests, the production build, and `npx wrangler deploy --dry-run` in your own environment. Before every .exe, package it, then build the Linux version of the same app and run its smoke test in your workspace. The Windows .exe itself can't be launched there (no Windows, no Wine), so Kevin's first launch is the Windows check. Don't ship a build you haven't seen pass.
- Keep every zip GitHub-web-uploadable: at most 100 files per zip (GitHub's web uploader refuses more in one go) and no file over 25 MB. If a full-repo delivery would exceed 100 files, split it into numbered parts and say the push order.
- Explain things plainly. He directs the design and makes the calls. You execute and flag trade-offs.

### 9.4 Tech (builder's call within these lines)
- **Vite + plain JavaScript (or TypeScript) + PixiJS (WebGL)** for rendering thousands of sprites. Canvas 2D is acceptable if it holds 1,000 enemies at 60 fps. Don't use a heavyweight engine.
- Performance basics: object pools for enemies, projectiles, and gems; a spatial hash for collisions; a fixed-timestep simulation separate from rendering; batched sprites.
- **Input: controller first.** The Gamepad API handles a PS5 DualSense and Xbox controllers in both builds. Keyboard is the backup. Every screen, menu, and the hub must be fully usable with a controller alone. Show PlayStation button prompts when a DualSense is connected, Xbox prompts otherwise.
- **Display:** 16:9, built for 1080p and scaling cleanly to 1440p and 4K. Pixel art scales by whole numbers so it stays crisp. Vsync on.
- **All content is data.** Weapons, passives, relics, runes, characters, enemies, maps, buildings, research nodes, and tide modifiers live in data files, so Kevin can direct tuning by name without anyone digging through logic.
- **Art (approved by Kevin, Sep 27 2026): free CC0 pixel packs for the sprites, code for everything else.**
  - **Which packs (Kevin's ruling, Sep 27 2026):** the Kenney 1-Bit Pack for everything in runs (enemies, props, run maps); Kenney Tiny Dungeon + Tiny Town for the player and all playable characters, the hub buildings, and the hub NPCs. Both are remapped to one palette, on the same 16 px grid, with the same outline treatment, so they read as one game. The hub's water, pier, and boats are drawn in code in Tiny Town's style.
  - Code supplies all effects: projectiles, particles, hit flash, knockback, trails, explosions, the XP vacuum, chest reels, lighting, the fog, and lamplight. Code also builds the hub's in-between stages (scaffolding, boarded windows, lit windows) on top of the pack's buildings.
  - Recolor every pack sprite through one palette so the whole game reads as one set. The fog and lamplight contrast carries the mood.
  - Claude's workspace can't reach Kenney, itch.io, or OpenGameArt. Kevin downloads the pack zips and attaches them (done Sep 27 2026).
  - Credit every pack on a credits screen, even where CC0 doesn't require it.
- **Audio:** synthesized WebAudio sound effects are fine for the MVP. Music is optional and must be free-licensed and credited.
- **Tests:** balance math (damage, scaling, drop tables), save/load and save migration, and a headless simulation that runs a scripted 20-minute run and checks it stays stable. Keep them quick. They run on every deploy.

### 9.5 Saves
- Autosave after every run and every hub action. The PC release saves to a file in the player's AppData folder. The playtest build saves to IndexedDB (localStorage as fallback).
- **Export and import a save as a text code**, so Kevin can move progress between the playtest build and the PC release, and keep backups.
- Save format is versioned, with migrations, so updates never wipe progress.

---

## 10. Build order

1. **Feel prototype:** one map, one character, 4 weapons, the XP and level-up loop, and 1,000 enemies. Kevin plays it on PC with a controller. Stop and tune until it feels right.
2. **MVP slice:** the section 7 MVP column, with the hub, 3 buildings, materials, and saves.
3. **Systems pass:** research, equipment, runes, relics, and Tide levels, with content kept thin.
4. **Content passes:** maps, characters, weapons, and bosses toward v0.5 and then v1.0, one map at a time with its materials, enemies, and boss.
5. **Endgame:** the Lighthouse, Prestige, secrets, and completion tracking.

At every stage, check the game against section 2's hard rules and section 1's test.

---

## 11. The scoring lens (how Kevin judges it)

The weights he uses to rate games in this genre, useful for deciding what to polish first:

| Area | Weight |
|---|---|
| Core combat (auto-fire, horde, escalation) | 25 |
| Progression depth (systems that change play) | 20 |
| Game quality (polish, performance, no bugs) | 15 |
| Content longevity | 10 |
| Build variety | 10 |
| Authored hub | 8 |
| Session fit (20–60 min) | 5 |
| Originality | 4 |
| Presentation | 3 |

The same scale subtracts 20 for shallow progression and 25 for freeform building. First-person, a manual primary attack, or idle design is an automatic zero.

**The ideal, in one line:** Vampire Survivors' automatic horde combat, plus Soulstone Survivors' build depth, plus Heroes of Hammerwatch's persistent progression and authored hub, plus Graveyard Keeper's interlocking progression, plus a long runway of unlocks that matter, in 20 to 60 minute sessions, at high quality.
